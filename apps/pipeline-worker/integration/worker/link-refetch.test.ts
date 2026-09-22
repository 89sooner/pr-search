/**
 * 근거 재수집 (WP-101 / CR-116, FR-SRCH-002 AC-6).
 *
 * ## 이 시험이 지키는 것
 *
 * 전체 대조는 **완전성 근거가 있는 PR의 번호만** 지운다. 그래서 사내에 이미 쌓인
 * 오염은 대부분 `blocked`로 보고될 뿐 풀리지 않는다 — 그것을 푸는 유일한 경로가
 * 재수집이다. 여기서 보는 것은 셋이다. 재수집이 근거를 세워 삭제를 가능하게
 * 하는가, 원격 조회 실패가 삭제의 근거가 되지 않는가, 그리고 **재수집한 관측이
 * 이미 저장된 관측을 실제로 이기는가.**
 *
 * 마지막이 가장 조용한 실패다. 순서 기준을 PR의 `updated_at`으로 잡으면 웹훅 수신
 * 시각(ms)으로 seed된 관측보다 언제나 이르고, 그러면 재수집이 전부 `stale`로 접혀
 * **아무 일도 일어나지 않은 채 끝난다.** 그 상태는 보고서에서도 성공과 구분되지
 * 않으므로, 여기서 관측 행을 직접 읽어 확인한다.
 *
 * 목 GHE는 실제 `node:http` 서버다 (WP-007과 같은 것). "실패는 삭제의 근거가
 * 아니다"는 상태 코드에 대한 반응이라, fetch를 목으로 바꾸면 그 경로를 통째로
 * 건너뛰고 아무것도 증명하지 못한다.
 *
 * 검증: `pnpm test:integration worker/link-refetch`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { prCommitLinkRepo, repositoryRepo, withTransaction, type Pool, type RepositoryRow } from '@prs/db';
import { applyMappings, switchAliasesForTests, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import { commitDocId } from '@prs/domain';
import { GitHubClient, GitHubTransport, InstallationTokenProvider, RequestScheduler, TokenPool } from '@prs/github';
import { generateTestKeyPair, startMockGhe, type MockGhe, type MockGheOptions } from '../../../../packages/github/testing/mock-ghe.js';
import { planLinkRepair, refetchLinkEvidence } from '../../src/link-repair.js';
import { migratedPool } from '../helpers.js';

const keys = generateTestKeyPair();

/** 이 파일만의 저장소. 이름 공간이 겹치면 다른 통합 파일의 정리 문장이 서로를 밟는다. */
const REPOSITORY_ID = 7118;
const PR_NUMBER = 100;

/** 색인에만 남은 잉여 — 합집합 시절이 남긴 그 모양이다. */
const SHA_POLLUTED = 'aaaa333344445555666677778888999900000001';
/** 정본이 알고 있던 커밋. 목 GHE는 이 SHA를 모른다. */
const SHA_STALE = 'bbbb333344445555666677778888999900000002';

let pool: Pool;
let es: Client;
let repository: RepositoryRow;
let ghe: MockGhe | undefined;

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-08'] });
  es = createEsClient(resolveClientOptions());
  for (let round = 0; round < 90; round += 1) {
    try {
      await es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  await dropEntityIndices(es);
  await applyMappings(es);
  await switchAliasesForTests(es);
}, 120_000);

afterAll(async () => {
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM commit_link_state WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_commit_link WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_link_observation WHERE repository_id = $1', [REPOSITORY_ID]);
  await es.deleteByQuery({ index: 'prs-commits', query: { term: { repository_id: REPOSITORY_ID } }, refresh: true, conflicts: 'proceed' });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'acme',
    name: 'refetch',
    org_id: 77,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
  const found = await repositoryRepo.findRepositoryBySlug(pool, 'acme', 'refetch');
  if (found === undefined) throw new Error('저장소 등록이 실패했다');
  repository = found;
});

afterEach(async () => {
  await ghe?.close();
  ghe = undefined;
});

/**
 * 목 GHE에 붙은 읽기 전용 클라이언트. 조립은 보강 워커(`enrich.test.ts`)와 같다.
 *
 * 재수집이 **보강과 같은 경로로** 읽는다는 것이 CR-116의 전제이므로, 시험도 그
 * 경로를 그대로 세운다 — 여기에만 있는 지름길을 만들면 규칙이 두 곳에 갈라진다.
 */
async function gheClient(options: MockGheOptions = {}): Promise<GitHubClient> {
  ghe = await startMockGhe(options);
  const provider = new InstallationTokenProvider({
    apiUrl: ghe.apiUrl,
    appId: '12345',
    privateKey: keys.privateKey,
    refreshLeadMs: 60_000,
    requestTimeoutMs: 5_000,
  });
  const tokenPool = new TokenPool(provider, {
    installations: [{ org: 'acme', installationId: 42 }],
    quarantineThreshold: 0.1,
  });
  return new GitHubClient(
    new GitHubTransport({
      apiUrl: ghe.apiUrl,
      requestTimeoutMs: 5_000,
      pool: tokenPool,
      scheduler: new RequestScheduler({ maxConcurrent: 4 }),
    }),
  );
}

/**
 * 관측 하나를 정본에 심는다.
 *
 * `observedVersion`을 **인자로 받는다.** 이 파일의 마지막 시험은 "웹훅 수신
 * 시각(ms)으로 seed된 관측"이라는 실제 모양을 만들어야 하는데, 그 값을 상수로
 * 고정해 두면 재수집의 순서 기준이 무엇이든 이겨서 시험이 아무것도 증명하지 못한다.
 */
async function seedObservation(options: {
  readonly prNumber: number;
  readonly sourceShas: readonly string[];
  readonly complete: boolean;
  readonly observedVersion: number;
}): Promise<void> {
  await withTransaction(pool, async (client) => {
    await prCommitLinkRepo.adoptLinkObservation(client, {
      repositoryId: REPOSITORY_ID,
      prNumber: options.prNumber,
      observedVersion: options.observedVersion,
      sourceShas: options.sourceShas,
      mergeSha: null,
      commitsComplete: options.complete,
      pullRequestAuthoritative: true,
      commitsErrorKind: null,
      apiCommitCount: options.complete ? options.sourceShas.length : null,
      sourceCommitsTruncated: false,
      headSha: null,
      baseSha: null,
      baseBranch: 'main',
      prState: 'open',
      reason: null,
    });
  });
}

/** 합집합 시절이 남긴 커밋 문서를 그대로 만든다 — 세대도 관계 상태도 없다. */
async function seedPollutedCommit(sha: string, numbers: readonly number[]): Promise<void> {
  await es.index({
    index: 'prs-commits',
    id: commitDocId(REPOSITORY_ID, sha),
    routing: String(REPOSITORY_ID),
    refresh: true,
    document: {
      document_version: 1,
      doc_id: commitDocId(REPOSITORY_ID, sha),
      repository_id: REPOSITORY_ID,
      repository: 'acme/refetch',
      org_id: 77,
      visibility: 'internal',
      allowed_team_ids: [],
      repository_archived: false,
      commit_sha: sha,
      role: 'source_commit',
      enrichment_pending: false,
      indexed_at: '2026-08-19T10:00:00.000Z',
      pull_request_numbers: [...numbers],
    },
  });
}

async function indexedNumbers(sha: string): Promise<readonly number[] | undefined> {
  const found = await es.get<{ pull_request_numbers?: readonly number[] }>({
    index: 'prs-commits',
    id: commitDocId(REPOSITORY_ID, sha),
    routing: String(REPOSITORY_ID),
  });
  return found._source?.pull_request_numbers;
}

describe('재수집이 삭제의 근거를 세운다', () => {
  it('근거가 선 뒤에야 전체 대조가 그 간선을 지울 수 있다', async () => {
    /*
     * 관측이 불완전한 PR 하나와, 정본이 모르는 채 색인에만 남은 번호 하나.
     * 재수집 전에는 이 둘이 만나도 아무 일도 일어나지 않는다 — 지울 근거가 없다.
     */
    await seedObservation({ prNumber: PR_NUMBER, sourceShas: [], complete: false, observedVersion: 1_000 });
    await seedPollutedCommit(SHA_POLLUTED, [PR_NUMBER]);

    const before = await planLinkRepair({ pool, es }, repository);
    expect(before.edgesRemoved).toBe(0);
    expect(before.blocked).toBe(1);
    expect(before.unverifiedPullRequests).toBe(1);

    const client = await gheClient({ resources: { commits: 2 } });
    const result = await refetchLinkEvidence({ pool, es, client }, repository);
    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.verified).toBe(1);
    // 원격이 말한 목록이 관계로 들어왔다. 근거만 갱신하고 관계를 두면 절반만 고친 것이다.
    expect(result.affectedCommits).toBeGreaterThan(0);

    const observation = await prCommitLinkRepo.findLinkObservation(pool, REPOSITORY_ID, PR_NUMBER);
    expect(observation?.verification_state).toBe('verified');

    /*
     * 같은 색인, 같은 정본인데 이번에는 지울 수 있다. **바뀐 것은 근거뿐이다** —
     * 그것이 이 명령이 존재하는 이유다.
     */
    const after = await planLinkRepair({ pool, es }, repository);
    expect(after.edgesRemoved).toBe(1);
    expect(after.blocked).toBe(0);
    expect(after.unverifiedPullRequests).toBe(0);
    expect(after.samples.find((sample) => sample.commitSha === SHA_POLLUTED)?.removed).toEqual([PR_NUMBER]);
  });
});

describe('실패는 삭제의 근거가 아니다', () => {
  /*
   * 권한 차단(403)·삭제된 PR(404)·rate limit·게이트웨이 오류는 전부 "모른다"이지
   * "속하지 않는다"가 아니다. 그런데 관측을 갱신해 버리면 그 빈 목록이 사실 주장이
   * 되고, 다음 대조가 근거 있는 삭제로 읽어 관계를 지운다. 두 조회 모두 이 규율을
   * 따라야 하므로 따로 본다 — 한쪽만 고쳐진 날이 있으면 그날 관계가 사라진다.
   */
  const cases: readonly { readonly label: string; readonly options: MockGheOptions }[] = [
    { label: 'PR 상세', options: { resources: { commits: 2 }, failures: [{ resource: 'pull_request', status: 403 }] } },
    { label: '커밋 목록', options: { resources: { commits: 2 }, failures: [{ resource: 'commits', status: 502 }] } },
  ];

  for (const testCase of cases) {
    it(`${testCase.label} 조회가 실패하면 관측도 관계도 그대로 둔다`, async () => {
      await seedObservation({ prNumber: PR_NUMBER, sourceShas: [SHA_STALE], complete: false, observedVersion: 1_000 });
      await seedPollutedCommit(SHA_POLLUTED, [PR_NUMBER]);
      await seedPollutedCommit(SHA_STALE, [PR_NUMBER]);

      const client = await gheClient(testCase.options);
      const result = await refetchLinkEvidence({ pool, es, client }, repository);
      expect(result.attempted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.verified).toBe(0);
      expect(result.affectedCommits).toBe(0);

      // 근거가 서지 않았으므로 다음 대조도 여전히 보류한다.
      const observation = await prCommitLinkRepo.findLinkObservation(pool, REPOSITORY_ID, PR_NUMBER);
      expect(observation?.verification_state).toBe('pending_refetch');
      expect(Number(observation?.observed_version)).toBe(1_000);

      // **관계는 하나도 줄지 않는다.** 실패가 삭제로 번지는 자리가 여기다.
      expect(await prCommitLinkRepo.countCommitLinks(pool, REPOSITORY_ID)).toEqual({ commits: 1, edges: 1 });
      expect(await indexedNumbers(SHA_POLLUTED)).toEqual([PR_NUMBER]);

      const plan = await planLinkRepair({ pool, es }, repository);
      expect(plan.edgesRemoved).toBe(0);
      expect(plan.blocked).toBe(1);
      expect(plan.unverifiedPullRequests).toBe(1);
    });
  }
});

describe('재수집한 관측의 순서', () => {
  it('웹훅 수신 시각으로 seed된 관측보다 새 것으로 채택된다', async () => {
    /*
     * **이 시험이 막는 것은 "아무 일도 일어나지 않음"이다** (CR-116 / DEV-749).
     *
     * 마이그레이션이 seed한 관측의 `observed_version`은 웹훅 수신 시각(ms)이고, 그
     * PR의 `updated_at`은 마지막 웹훅보다 이르다 — 재수집이 필요한 PR은 정의상
     * 전부 그 모양이다. 그래서 순서 기준을 `updated_at`으로 잡으면 모든 재수집이
     * `stale`로 접히고, 관측도 관계도 그대로인 채 명령만 성공으로 끝난다.
     *
     * 그 상황을 실제로 만든다: seed는 **지금에 가까운 큰 값**, 목 GHE의 PR은
     * `updated_at`이 한 달 전이다.
     */
    const seededVersion = Date.now() - 60_000;
    await seedObservation({ prNumber: PR_NUMBER, sourceShas: [SHA_STALE], complete: false, observedVersion: seededVersion });

    const client = await gheClient({ resources: { commits: 2 } });
    const result = await refetchLinkEvidence({ pool, es, client }, repository);

    /*
     * `stale`로 접혀도 `verified` 집계는 1이 된다 — 그 값은 원격이 완전했는가만
     * 말하고 채택 여부를 말하지 않는다. 그래서 **관측 행을 직접 읽는다.**
     */
    const observation = await prCommitLinkRepo.findLinkObservation(pool, REPOSITORY_ID, PR_NUMBER);
    expect(observation?.verification_state).toBe('verified');
    expect(Number(observation?.observed_version)).toBeGreaterThan(seededVersion);

    // 관계도 실제로 갈렸다. 원격이 모르는 옛 SHA는 이제 이 PR의 것이 아니다.
    expect(result.affectedCommits).toBeGreaterThan(0);
    expect(await prCommitLinkRepo.listLinkedPullRequestNumbers(pool, REPOSITORY_ID, SHA_STALE)).toEqual([]);
  });
});
