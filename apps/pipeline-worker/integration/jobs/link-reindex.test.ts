/**
 * 재색인이 PR 연결을 **정본만으로** 복원한다 (WP-101 / CR-116, FR-ING-008 AC-9).
 *
 * ## 이 시험이 막는 것
 *
 * CR-116 이후 `pull_request_numbers`는 투영의 `params.doc`에도 `params.union`에도
 * 실리지 않는다. 그래서 재구축이 관계를 따로 비추지 않으면 **새 인덱스의 모든
 * 커밋이 연결 없이 시작한다** — FR-SRCH-002가 그 커밋들에 대해 "속한 PR 없음"으로
 * 답한다는 뜻이고, 전환 뒤에야 드러난다. 상류가 보고한 "재색인 뒤 `merge_seq`가
 * 사라진다"와 **같은 모양의 결함**이다.
 *
 * 웹훅도 러너도 돌리지 않는다. PostgreSQL에 있는 것만으로 복원되어야 한다 (ADR-004).
 *
 * 검증: `pnpm test:integration jobs/link-reindex`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  commitSnapshotRepo,
  jobRepo,
  mergeSequenceRepo,
  prCommitLinkRepo,
  prSnapshotRepo,
  reindexRepo,
  repositoryRepo,
  withTransaction,
  type Pool,
} from '@prs/db';
import { commitDocId } from '@prs/domain';
import {
  applyMappings,
  concreteIndexName,
  createEsClient,
  listIndexVersions,
  resolveServingIndex,
  switchAlias,
} from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import { runReindexJob, verifyBeforeCutover, type ReindexDeps } from '../../src/reindex.js';
import { migratedPool, removeOrphanCommitLinks } from '../helpers.js';

const ALIAS = 'prs-commits';
const REPOSITORY_ID = 9361;
const OWNER = 'acme';
const NAME = 'link-reindex';

const SHA_A = 'aaaa333344445555666677778888999900000001';
const SHA_B = 'bbbb333344445555666677778888999900000002';
const SHA_C = 'cccc333344445555666677778888999900000003';

let pool: Pool;
let es: Client;
let originalIndex: string;
const created = new Set<string>();

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient();
  await applyMappings(es);
  originalIndex = await resolveServingIndex(es, ALIAS);
}, 120_000);

afterAll(async () => {
  /*
   * 별칭을 원래 인덱스로 되돌리고 이 파일이 만든 인덱스를 지운다.
   *
   * **이미 원래 인덱스를 가리키고 있으면 건드리지 않는다.** 재색인 잡이 전환까지
   * 갔는지는 시험마다 다르고, 같은 인덱스로 `updateAliases`를 부르면 remove와 add가
   * 서로를 지워 요청 자체가 거부된다. 다른 파일들이 이 별칭을 함께 쓰므로 정리가
   * 실패해도 뒤 파일이 깨지지 않게 마지막까지 간다.
   */
  const serving = await resolveServingIndex(es, ALIAS).catch(() => originalIndex);
  if (serving !== originalIndex) {
    await switchAlias(es, ALIAS, serving, originalIndex).catch(() => undefined);
  }
  for (const index of created) {
    if (index === originalIndex) continue;
    await es.indices.delete({ index, ignore_unavailable: true }).catch(() => undefined);
  }
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM commit_link_state WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_commit_link WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_link_observation WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  // 재색인은 DB 전체를 본다 — 다른 파일이 남긴 근거 없는 관계 행이 판정을 막지 않게 한다 (CR-119, DEV-763).
  await removeOrphanCommitLinks(pool);
  // 체인 시험(CR-117)이 심은 시퀀스·커밋 정본. 다른 시험에 체인이 남으면 그 시험의 연결이 달라진다.
  await pool.query('DELETE FROM sequence_work WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query("DELETE FROM job WHERE type = 'reindex'");
  /*
   * **서비스 인덱스의 잔재까지 지운다.** 앞 시험이 남긴 문서의 관계 세대가 남아
   * 있으면 다음 시험의 재구축이 그 상태로 판정되어, 시험이 제품이 아니라 앞
   * 시험의 흔적을 재는 것이 된다.
   */
  await es.deleteByQuery({
    index: `${ALIAS}*`,
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
    ignore_unavailable: true,
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 71,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
});

/** 재구축이 커밋 문서를 만들 재료. 관계와 **따로** 둔다 — 둘의 정본이 다르다. */
async function seedSnapshot(prNumber: number, shas: readonly string[]): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    prNumber,
    documentVersion: 1_000,
    source: 'webhook',
    document: {
      document_version: 1_000,
      repository_id: REPOSITORY_ID,
      pr_number: prNumber,
      state: 'open',
      base_branch: 'main',
      source_commit_shas: [...shas],
      enrichment_pending: false,
    },
  });
}

/**
 * 관계 정본만 심는다. **세대 올림도 러너도 없다** — 마이그레이션 036이 seed한
 * 직후, 즉 이번 배포가 사내에 처음 올라간 순간의 모양 그대로다.
 */
async function seedLinks(prNumber: number, shas: readonly string[]): Promise<void> {
  await withTransaction(pool, async (client) => {
    await prCommitLinkRepo.adoptLinkObservation(client, {
      repositoryId: REPOSITORY_ID,
      prNumber,
      observedVersion: 1_000,
      sourceShas: shas,
      mergeSha: null,
      commitsComplete: true,
      pullRequestAuthoritative: true,
      commitsErrorKind: null,
      apiCommitCount: shas.length,
      sourceCommitsTruncated: false,
      headSha: null,
      baseSha: null,
      baseBranch: 'main',
      prState: 'open',
      reason: null,
    });
  });
  await pool.query(
    `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
     SELECT $1, sha, 1, 1, 'done' FROM unnest($2::text[]) AS sha
     ON CONFLICT DO NOTHING`,
    [REPOSITORY_ID, [...shas]],
  );
}

async function enqueueAndRun(): Promise<string> {
  const outcome = await reindexRepo.enqueueReindex(
    pool,
    {
      resolveServingIndex: (alias) => resolveServingIndex(es, alias),
      async nextTargetIndex(alias) {
        const versions = await listIndexVersions(es, alias);
        const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
        return concreteIndexName(alias, highest + 1);
      },
      isAlias: (value) => value === ALIAS,
    },
    ALIAS,
    'test',
  );
  if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
  created.add(outcome.targetIndex);
  await pool.query("UPDATE job SET state = 'running', started_at = now() WHERE job_id = $1", [outcome.jobId]);
  const row = await jobRepo.findJobById(pool, outcome.jobId);
  if (row === undefined) throw new Error('잡을 찾지 못했다');
  const deps: ReindexDeps = { pool, es };
  await runReindexJob(deps, row);
  await es.indices.refresh({ index: outcome.targetIndex });
  /*
   * **잡이 전환까지 갔는지 본다** (CR-119). 아래 판정들은 대상 인덱스를 직접 읽으므로 잡이 전환 전
   * 검증에서 실패해도 통과했다 — 전량 실행에서 넷 모두 실패한 채 통과한 적이 있다. 실패하면 잡의
   * 사유가 그대로 메시지에 나온다.
   */
  const after = await jobRepo.findJobById(pool, outcome.jobId);
  expect(after?.state, after?.error ?? '').toBe('completed');
  return outcome.targetIndex;
}

async function linksIn(index: string, sha: string): Promise<readonly number[] | undefined | null> {
  try {
    const found = await es.get<{ pull_request_numbers?: readonly number[] }>({
      index,
      id: commitDocId(REPOSITORY_ID, sha),
      routing: String(REPOSITORY_ID),
    });
    return found._source?.pull_request_numbers ?? undefined;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null;
    throw error;
  }
}

describe('재색인 관계 replay', () => {
  it('웹훅 없이 PostgreSQL만으로 새 인덱스의 PR 연결을 복원한다', async () => {
    await seedSnapshot(100, [SHA_A, SHA_B]);
    await seedLinks(100, [SHA_A, SHA_B]);

    const target = await enqueueAndRun();

    expect(await linksIn(target, SHA_A)).toEqual([100]);
    expect(await linksIn(target, SHA_B)).toEqual([100]);
  }, 120_000);

  it('연결이 0개인 커밋은 `[]`로 복원한다 — 필드 부재(아직 모름)와 다르다', async () => {
    // PR 100의 스냅숏은 C를 담지만 관계 정본은 C를 더 이상 담지 않는다.
    await seedSnapshot(100, [SHA_A, SHA_C]);
    await seedLinks(100, [SHA_A]);
    // C의 tombstone — 연결이 지워진 뒤에도 남는 행이다.
    await pool.query(
      `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
       VALUES ($1, $2, 2, 2, 'done') ON CONFLICT DO NOTHING`,
      [REPOSITORY_ID, SHA_C],
    );

    const target = await enqueueAndRun();

    expect(await linksIn(target, SHA_A)).toEqual([100]);
    expect(await linksIn(target, SHA_C)).toEqual([]);
  }, 120_000);

  it('전환 전 검증이 누락뿐 아니라 **잉여** PR 번호도 잡는다', async () => {
    await seedSnapshot(100, [SHA_A]);
    await seedLinks(100, [SHA_A]);

    const outcome = await reindexRepo.enqueueReindex(
      pool,
      {
        resolveServingIndex: (alias) => resolveServingIndex(es, alias),
        async nextTargetIndex(alias) {
          const versions = await listIndexVersions(es, alias);
          const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
          return concreteIndexName(alias, highest + 1);
        },
        isAlias: (value) => value === ALIAS,
      },
      ALIAS,
      'test',
    );
    if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
    created.add(outcome.targetIndex);
    await pool.query("UPDATE job SET state = 'running', started_at = now() WHERE job_id = $1", [outcome.jobId]);
    const row = await jobRepo.findJobById(pool, outcome.jobId);
    if (row === undefined) throw new Error('잡을 찾지 못했다');
    await runReindexJob({ pool, es }, row);

    /*
     * 대상 인덱스에 **정본에 없는 번호**를 심는다. 구버전 합집합 writer가 전환 중에
     * 끼어든 모양이다. 누락만 보는 검증은 이것을 통과시키고, 그러면 이 CR이 고치려던
     * 오염이 새 인덱스로 그대로 넘어간다.
     */
    await es.update({
      index: outcome.targetIndex,
      id: commitDocId(REPOSITORY_ID, SHA_A),
      routing: String(REPOSITORY_ID),
      refresh: true,
      script: { lang: 'painless', source: 'ctx._source.pull_request_numbers = params.n', params: { n: [100, 777] } },
    });

    const verdict = await verifyBeforeCutover({ pool, es }, outcome.jobId, null);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes('잉여=[777]'))).toBe(true);
  }, 120_000);

  it('**체인 커밋은 올린 PR만으로 복원하고 역할을 덮지 않는다** — `git merge dev`로 받아 온 PR의 번호가 새 인덱스로 넘어가지 않는다 (CR-117)', async () => {
    /*
     * B는 PR 200이 main에 squash로 올린 커밋이다. PR 300의 피처 브랜치가 main을 merge해 와서
     * 스냅숏의 원본 목록에 B가 섞여 있다(사내 보고의 `ebc781d` 모양). 버전은 운영과 같은 크기다 —
     * 웹훅 수신 시각(PR 스냅숏)이 커밋 시각(체인 문서의 생성 버전)보다 뒤다.
     */
    const committedAt = new Date('2026-09-01T00:00:00Z');
    await pool.query(
      `INSERT INTO sequence_space (repository_id, base_branch, seq_epoch, head_sha, head_seq, state)
       VALUES ($1, 'main', 1, $2, 1, 'ok')`,
      [REPOSITORY_ID, SHA_B],
    );
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: 'main',
      seq_epoch: 1,
      merge_seq: 1,
      commit_sha: SHA_B,
      pull_request_number: 200,
      committed_at: committedAt,
    });
    await commitSnapshotRepo.upsertCommitSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      commitSha: SHA_B,
      parentShas: [],
      message: 'B squash (#200)',
      author: 'dev',
      committer: 'dev',
      authoredAt: committedAt,
      committedAt,
      changedPaths: ['b.txt'],
      changedPathsTruncated: false,
      patchId: null,
      patchIdUnavailable: 'no_mirror',
      metadataSource: 'api',
    });
    const mergedVersion = Date.parse('2026-09-01T00:10:00Z');
    const laterVersion = Date.parse('2026-09-02T00:00:00Z');
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 200,
      documentVersion: mergedVersion,
      source: 'webhook',
      document: {
        document_version: mergedVersion,
        repository_id: REPOSITORY_ID,
        pr_number: 200,
        state: 'merged',
        merge_commit_sha: SHA_B,
        base_branch: 'main',
        source_commit_shas: [SHA_C],
        enrichment_pending: false,
      },
    });
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 300,
      documentVersion: laterVersion,
      source: 'webhook',
      document: {
        document_version: laterVersion,
        repository_id: REPOSITORY_ID,
        pr_number: 300,
        state: 'open',
        base_branch: 'main',
        source_commit_shas: [SHA_A, SHA_B],
        enrichment_pending: false,
      },
    });
    await withTransaction(pool, async (client) => {
      for (const [prNumber, shas, mergeSha] of [
        [200, [SHA_C], SHA_B],
        [300, [SHA_A, SHA_B], null],
      ] as const) {
        await prCommitLinkRepo.adoptLinkObservation(client, {
          repositoryId: REPOSITORY_ID,
          prNumber,
          observedVersion: 1_000,
          sourceShas: shas,
          mergeSha,
          commitsComplete: true,
          pullRequestAuthoritative: true,
          commitsErrorKind: null,
          apiCommitCount: shas.length,
          sourceCommitsTruncated: false,
          headSha: null,
          baseSha: null,
          baseBranch: 'main',
          prState: mergeSha === null ? 'open' : 'merged',
          reason: null,
        });
      }
    });
    await pool.query(
      `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
       SELECT $1, sha, 1, 1, 'done' FROM unnest($2::text[]) AS sha ON CONFLICT DO NOTHING`,
      [REPOSITORY_ID, [SHA_A, SHA_B, SHA_C]],
    );

    const target = await enqueueAndRun();

    // 잡이 전환까지 갔다 — 전환 전 검증(누락·잉여 양방향)이 유효 연결 기준으로 통과했다는 뜻이다.
    expect(await resolveServingIndex(es, ALIAS)).toBe(target);
    expect(await linksIn(target, SHA_B)).toEqual([200]);
    expect(await linksIn(target, SHA_A)).toEqual([300]);
    const b = await es.get<{ role?: string }>({ index: target, id: commitDocId(REPOSITORY_ID, SHA_B), routing: String(REPOSITORY_ID) });
    expect(b._source?.role).toBe('merge_commit');
  }, 120_000);
});
