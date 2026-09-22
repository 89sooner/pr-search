/**
 * PR 연결 전체 대조·복구 (WP-101 / CR-116, FR-SRCH-002 AC-6).
 *
 * ## 이 시험이 지키는 것
 *
 * 새 이벤트의 old → new 차이만으로는 **이미 굳은 오염**을 못 고친다. 사내 pilot.17의
 * PR #2355는 최신 스냅숏이 이미 2건이었고, 잘못 남은 110건은 그 차이 어디에도
 * 나타나지 않았다. 그래서 여기서는 **색인에만 있는 잉여**를 미리 심어 두고, 그것이
 * 전체 대조로 드러나고 복구되는지를 본다.
 *
 * 검증: `pnpm test:integration worker/link-repair`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { prCommitLinkRepo, repositoryRepo, withTransaction, type Pool, type RepositoryRow } from '@prs/db';
import { applyMappings, switchAliasesForTests, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import { commitDocId } from '@prs/domain';
import { applyLinkRepair, planLinkRepair } from '../../src/link-repair.js';
import { runCommitLinkOnce } from '../../src/commit-links.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 7117;
const SHA_A = 'aaaa222233334444555566667777888899990001';
const SHA_B = 'bbbb222233334444555566667777888899990002';
const SHA_C = 'cccc222233334444555566667777888899990003';

let pool: Pool;
let es: Client;
let repository: RepositoryRow;

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
    name: 'repair',
    org_id: 77,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
  const found = await repositoryRepo.findRepositoryBySlug(pool, 'acme', 'repair');
  if (found === undefined) throw new Error('저장소 등록이 실패했다');
  repository = found;
});

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
      repository: 'acme/repair',
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

/** 정본에 관계를 심는다. `verified`면 삭제 권한이 있는 관측이다. */
async function seedCanonical(prNumber: number, shas: readonly string[], verified: boolean): Promise<void> {
  await withTransaction(pool, async (client) => {
    await prCommitLinkRepo.adoptLinkObservation(client, {
      repositoryId: REPOSITORY_ID,
      prNumber,
      observedVersion: 1_000,
      sourceShas: shas,
      mergeSha: null,
      commitsComplete: verified,
      pullRequestAuthoritative: true,
      commitsErrorKind: null,
      apiCommitCount: verified ? shas.length : null,
      sourceCommitsTruncated: false,
      headSha: null,
      baseSha: null,
      baseBranch: 'main',
      prState: 'open',
      reason: null,
    });
  });
}

async function drain(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    const cycle = await runCommitLinkOnce({ pool, es, metrics: createWorkerMetrics(), withWrite: (run) => run({ shadows: {} }), repositoryId: REPOSITORY_ID });
    if (cycle.claimed === 0) break;
  }
  await es.indices.refresh({ index: 'prs-commits' });
}

async function indexedNumbers(sha: string): Promise<readonly number[] | undefined> {
  const found = await es.get<{ pull_request_numbers?: readonly number[] }>({
    index: 'prs-commits',
    id: commitDocId(REPOSITORY_ID, sha),
    routing: String(REPOSITORY_ID),
  });
  return found._source?.pull_request_numbers;
}

describe('전체 대조 (dry-run)', () => {
  it('최신 스냅숏의 차이에 없는 과거 오염도 찾아낸다', async () => {
    // 정본은 PR 100이 A만 담는다고 말한다. 색인에는 B·C에도 100이 남아 있다.
    await seedCanonical(100, [SHA_A], true);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);
    await seedPollutedCommit(SHA_C, [100]);

    const plan = await planLinkRepair({ pool, es }, repository);
    expect(plan.commitsChanged).toBe(2);
    expect(plan.edgesRemoved).toBe(2);
    expect(plan.edgesAdded).toBe(0);
    expect(plan.unchanged).toBe(1);
    expect(plan.blocked).toBe(0);
    expect(plan.failed).toBe(0);
  });

  it('고유 커밋 수와 관계 간선 수를 구분해 보고한다', async () => {
    await seedCanonical(100, [], true);
    await seedCanonical(200, [], true);
    // 커밋 하나에서 두 PR이 빠진다 — 커밋 1건, 간선 2건이다.
    await seedPollutedCommit(SHA_A, [100, 200]);

    const plan = await planLinkRepair({ pool, es }, repository);
    expect(plan.commitsChanged).toBe(1);
    expect(plan.edgesRemoved).toBe(2);
  });

  it('dry-run은 PostgreSQL·Elasticsearch·작업 큐에 아무것도 쓰지 않는다', async () => {
    await seedCanonical(100, [SHA_A], true);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);

    const plan = await planLinkRepair({ pool, es }, repository);
    // 바꿀 것이 **있는데도** 아무것도 쓰지 않는다는 것이 이 시험의 요지다.
    expect(plan.commitsChanged).toBe(1);

    const queue = await pool.query('SELECT count(*)::int AS count FROM commit_link_state WHERE repository_id = $1', [REPOSITORY_ID]);
    expect(queue.rows[0]?.count).toBe(0);
    expect(await indexedNumbers(SHA_B)).toEqual([100]);
    const links = await prCommitLinkRepo.countCommitLinks(pool, REPOSITORY_ID);
    expect(links.edges).toBe(1);
  });

  it('완전성 근거가 없는 PR의 번호는 지우지 않고 보류로 보고한다', async () => {
    // 관측이 불완전하다 — 목록에 없다는 사실이 소속이 아니라는 뜻이 되지 못한다.
    await seedCanonical(100, [SHA_A], false);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);

    const plan = await planLinkRepair({ pool, es }, repository);
    expect(plan.edgesRemoved).toBe(0);
    expect(plan.edgesAdded).toBe(0);
    expect(plan.commitsChanged).toBe(0);
    expect(plan.blocked).toBe(1);
    // 바꿀 것이 없으므로 표본도 없다. 보류는 "바뀔 것"이 아니라 "못 바꾼 것"이다.
    expect(plan.samples).toEqual([]);
    expect(plan.unverifiedPullRequests).toBe(1);
    /*
     * **어느 PR을 다시 읽어야 하는지 말한다.** 수만 알려 주면 운영자는 저장소 전체를
     * 다시 읽을 수밖에 없고, 그것은 확정되지 않은 모든 PR을 원격에서 읽는다는 뜻이다.
     */
    expect(plan.blockingPullRequests).toEqual([100]);
  });
});

describe('복구 (apply)', () => {
  it('바뀔 커밋만 큐에 넣고, 러너가 색인을 맞춘다', async () => {
    await seedCanonical(100, [SHA_A], true);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);

    // 계획이 먼저 말하고, 실행이 그것을 다시 계산해 같은 결론에 이른다.
    const plan = await planLinkRepair({ pool, es }, repository);
    expect(plan.commitsChanged).toBe(1);
    const result = await applyLinkRepair({ pool, es }, repository);
    expect(result.scheduled).toBe(1);

    await drain();
    expect(await indexedNumbers(SHA_A)).toEqual([100]);
    expect(await indexedNumbers(SHA_B)).toEqual([]);
  });

  it('반복 실행이 멱등이다 — 두 번째는 세울 것이 없다', async () => {
    await seedCanonical(100, [SHA_A], true);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);

    await applyLinkRepair({ pool, es }, repository);
    await drain();

    const second = await applyLinkRepair({ pool, es }, repository);
    expect(second.scheduled).toBe(0);
    expect(await indexedNumbers(SHA_B)).toEqual([]);
  });

  it('계획 뒤 정본이 바뀌면 실행이 그 새 사실을 따른다', async () => {
    await seedCanonical(100, [SHA_A], true);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);

    const plan = await planLinkRepair({ pool, es }, repository);
    expect(plan.edgesRemoved).toBe(1);

    /*
     * 계획과 실행 사이에 새 웹훅이 들어와 B가 다시 PR 100의 것이 되었다.
     * **낡은 계획을 그대로 실행하면 방금 생긴 정상 연결을 지운다.**
     */
    await seedCanonical(100, [SHA_A, SHA_B], true);
    const result = await applyLinkRepair({ pool, es }, repository);
    expect(result.scheduled).toBe(0);

    await drain();
    expect(await indexedNumbers(SHA_B)).toEqual([100]);
  });

  it('근거 없는 삭제 후보는 실행에서도 보류한다', async () => {
    await seedCanonical(100, [SHA_A], false);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);

    // 계획과 실행이 **같은 단위로** 센다 — 커밋 수다.
    const plan = await planLinkRepair({ pool, es }, repository);
    expect(plan.blocked).toBe(1);
    const result = await applyLinkRepair({ pool, es }, repository);
    expect(result.blocked).toBe(1);
    expect(result.scheduled).toBe(0);

    await drain();
    expect(await indexedNumbers(SHA_B)).toEqual([100]);
  });

  it('보류된 커밋을 다시 세운다 — 구버전 writer와 충돌해 멈춘 행이 복구의 대상이다', async () => {
    /*
     * **독립 검토 지적 A.** `parked`는 언제나 `projected_generation < generation`이라,
     * 「반영 완료인데 불일치」 조건만으로 세대를 올리면 **절대 매치되지 않는다.** 그리고
     * 러너는 `ready`·`retry`만 집는다. 그래서 그 행은 영영 멈추고, 그것이 바로 롤링
     * 업데이트 중 구버전 합집합 writer와 충돌해 보류된 커밋 — 이 CR이 지우려던 오염
     * 그 자체다.
     */
    await seedCanonical(100, [SHA_A], true);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);
    await applyLinkRepair({ pool, es }, repository);
    await drain();
    expect(await indexedNumbers(SHA_B)).toEqual([]);

    // 색인이 다시 오염되고, 그 커밋이 충돌로 보류된 상태를 만든다.
    await seedPollutedCommit(SHA_B, [100, 9999]);
    await pool.query(
      "UPDATE commit_link_state SET state = 'parked', projected_generation = generation - 1, last_reason = 'generation_conflict' WHERE repository_id = $1 AND commit_sha = $2",
      [REPOSITORY_ID, SHA_B],
    );
    // 러너만으로는 아무 일도 일어나지 않는다 — 보류는 집히지 않는다.
    await drain();
    expect(await indexedNumbers(SHA_B)).toEqual([100, 9999]);

    const result = await applyLinkRepair({ pool, es }, repository);
    expect(result.scheduled).toBe(1);
    await drain();
    expect(await indexedNumbers(SHA_B)).toEqual([]);
  });

  it('복구 전후로 서수·M 번호·에폭이 그대로다 — 관계 대입은 관계 재발견이 아니다', async () => {
    /*
     * 이 CR은 `pull_request_numbers`와 그 세대만 바꾼다. 시퀀스와 M 번호는 다른
     * 소유자의 것이고, 관계 갱신이 그 값을 되돌리면 CR-113·CR-115가 고친 것이 이
     * 변경 때문에 후퇴한다 — 그 후퇴는 전환 뒤에야 드러난다.
     */
    await seedCanonical(100, [SHA_A], true);
    await seedPollutedCommit(SHA_A, [100]);
    await seedPollutedCommit(SHA_B, [100]);
    // 다른 소유자가 쓴 값을 심는다.
    for (const sha of [SHA_A, SHA_B]) {
      await es.update({
        index: 'prs-commits',
        id: commitDocId(REPOSITORY_ID, sha),
        routing: String(REPOSITORY_ID),
        refresh: true,
        script: {
          lang: 'painless',
          source:
            'ctx._source.merge_seq = params.seq; ctx._source.seq_epoch = params.epoch;' +
            ' ctx._source.sequence_space = params.space; ctx._source.merge_number = params.mnum;' +
            ' ctx._source.merge_number_epoch = params.epoch; ctx._source.merge_number_state = params.state;',
          params: { seq: 42, epoch: 3, space: 'acme/repair@main', mnum: 7, state: 'assigned' },
        },
      });
    }

    await applyLinkRepair({ pool, es }, repository);
    await drain();

    expect(await indexedNumbers(SHA_B)).toEqual([]);
    for (const sha of [SHA_A, SHA_B]) {
      const found = await es.get<Record<string, unknown>>({
        index: 'prs-commits',
        id: commitDocId(REPOSITORY_ID, sha),
        routing: String(REPOSITORY_ID),
      });
      const doc = found._source as Record<string, unknown>;
      expect(doc['merge_seq'], sha).toBe(42);
      expect(doc['seq_epoch'], sha).toBe(3);
      expect(doc['sequence_space'], sha).toBe('acme/repair@main');
      expect(doc['merge_number'], sha).toBe(7);
      expect(doc['merge_number_epoch'], sha).toBe(3);
      expect(doc['merge_number_state'], sha).toBe('assigned');
      expect(doc['role'], sha).toBe('source_commit');
      expect(doc['document_version'], sha).toBe(1);
    }
  });

  it('선택한 PR만 고친다', async () => {
    await seedCanonical(100, [], true);
    await seedCanonical(200, [], true);
    await seedPollutedCommit(SHA_A, [100, 200]);

    const plan = await planLinkRepair({ pool, es }, repository, { prNumbers: [100] });
    expect(plan.edgesRemoved).toBe(1);
    await applyLinkRepair({ pool, es }, repository, { prNumbers: [100] });
    await drain();

    // 정본은 둘 다 없다고 말하지만 이번 실행은 100만 고치라고 했다.
    // 러너는 정본 전체를 대입하므로 결과는 빈 배열이다 — 필터는 **무엇을 큐에
    // 넣을지**를 정하지 무엇을 쓸지를 정하지 않는다. 그 사실을 여기서 고정한다.
    expect(await indexedNumbers(SHA_A)).toEqual([]);
  });
});
