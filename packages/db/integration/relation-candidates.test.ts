/**
 * 마이그레이션 014 후보 조회 인덱스 (WP-030 / CR-041, DEV-240).
 *
 * **인덱스가 존재하는지가 아니라, 실제 질의가 그 형태를 쓰는지**를 본다. 식 인덱스는
 * 질의 식과 **정확히 같아야** 잡히므로, 한쪽만 바뀌면 인덱스가 조용히 무시되고
 * 저장소 전체 스캔이 된다 — 그 상태로도 결과는 맞아서 시험이 초록이 된다.
 *
 * 검증: `pnpm run test:integration relation-candidates`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commitSnapshotRepo, prSnapshotRepo, repositoryRepo, withTransaction, type Pool } from '@prs/db';

import { migratedPool } from './helpers.js';

const REPOSITORY_ID = 4901;
const OTHER_ID = 4902;

let pool: Pool;

const INDEXES = [
  'commit_snapshot_patch_candidate_idx',
  'commit_snapshot_subject_idx',
  'pull_request_snapshot_title_idx',
  'pull_request_snapshot_open_head_idx',
  'pull_request_snapshot_base_branch_idx',
] as const;

async function seedCommit(sha: string, message: string, patchId: string | null, at: string, repositoryId = REPOSITORY_ID): Promise<void> {
  await commitSnapshotRepo.upsertCommitSnapshot(pool, {
    repositoryId,
    commitSha: sha,
    parentShas: [],
    message,
    author: 'dev',
    committer: 'dev',
    authoredAt: new Date(at),
    committedAt: new Date(at),
    changedPaths: [],
    changedPathsTruncated: false,
    patchId,
    patchIdUnavailable: patchId === null ? 'no_mirror' : null,
    metadataSource: 'mirror',
  });
}

async function seedPr(number: number, title: string, state: string, head: string, base: string): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    prNumber: number,
    documentVersion: Date.now() + number,
    source: 'webhook',
    document: { pr_number: number, title, state, head_branch: head, base_branch: base },
  });
}

describe('마이그레이션 014 — 관계 후보 조회 (CR-041)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    for (const id of [REPOSITORY_ID, OTHER_ID]) {
      await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [id]);
      await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [id]);
      await pool.query('DELETE FROM repository WHERE repository_id = $1', [id]);
      await repositoryRepo.upsertRepository(pool, {
        repository_id: id,
        owner: 'acme',
        name: `mig014-${String(id)}`,
        org_id: 1,
        visibility: 'private',
        sequence_branches: ['main'],
        mirror_enabled: false,
        status: 'active',
      });
    }
  });

  it('다섯 인덱스가 전부 존재한다', async () => {
    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
      [[...INDEXES]],
    );
    expect(new Set(result.rows.map((row) => row.indexname))).toEqual(new Set(INDEXES));
  });

  it('`patch_id` 인덱스는 **부분 인덱스**다 — 값이 없는 행은 후보가 아니다', async () => {
    const result = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'commit_snapshot_patch_candidate_idx'`,
    );
    expect(result.rows[0]?.indexdef).toContain('WHERE (patch_id IS NOT NULL)');
  });

  it('열린 PR head 인덱스도 부분 인덱스다 — 요구사항이 "열린 PR"을 말한다', async () => {
    const result = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'pull_request_snapshot_open_head_idx'`,
    );
    expect(result.rows[0]?.indexdef).toContain("'open'");
  });

  it('patch-id 후보가 **결정론적 순서**로 나오고 자기 자신은 빠진다', async () => {
    await seedCommit('a'.repeat(40), 'x', 'P', '2026-08-01T00:00:00.000Z');
    await seedCommit('b'.repeat(40), 'x', 'P', '2026-08-03T00:00:00.000Z');
    await seedCommit('c'.repeat(40), 'x', 'P', '2026-08-02T00:00:00.000Z');

    const rows = await commitSnapshotRepo.findCommitsByPatchId(pool, REPOSITORY_ID, 'P', 'c'.repeat(40), 10);
    expect(rows.map((row) => row.commit_sha)).toEqual(['b'.repeat(40), 'a'.repeat(40)]);
  });

  it('patch-id 후보가 **저장소를 넘지 않는다** (FR-REL-005 AC-3)', async () => {
    await seedCommit('d'.repeat(40), 'x', 'Q', '2026-08-01T00:00:00.000Z', OTHER_ID);
    const rows = await commitSnapshotRepo.findCommitsByPatchId(pool, REPOSITORY_ID, 'Q', 'z'.repeat(40), 10);
    expect(rows).toHaveLength(0);
  });

  it('커밋 제목 조회가 **첫 줄만** 본다', async () => {
    await seedCommit('e'.repeat(40), 'fix login\n\n본문에도 fix login 이 있다', null, '2026-08-01T00:00:00.000Z');
    expect(await commitSnapshotRepo.findCommitsBySubject(pool, REPOSITORY_ID, 'fix login', 10)).toHaveLength(1);
    expect(
      await commitSnapshotRepo.findCommitsBySubject(pool, REPOSITORY_ID, '본문에도 fix login 이 있다', 10),
    ).toHaveLength(0);
  });

  it('되돌림 역방향 조회가 SHA를 본문에서 찾고 자기 자신은 뺀다', async () => {
    const target = 'f'.repeat(40);
    await seedCommit(target, 'fix login', null, '2026-08-01T00:00:00.000Z');
    await seedCommit('0'.repeat(40), `This reverts commit ${target}`, null, '2026-08-02T00:00:00.000Z');

    const rows = await commitSnapshotRepo.findCommitsRevertingSha(pool, REPOSITORY_ID, target, 10);
    expect(rows.map((row) => row.commit_sha)).toEqual(['0'.repeat(40)]);
  });

  it('PR 제목 후보를 **하나로 좁히지 않는다** (DEV-237)', async () => {
    await seedPr(1, 'fix login', 'open', 'a', 'main');
    await seedPr(2, 'fix login', 'closed', 'b', 'main');
    expect(await prSnapshotRepo.findPullRequestsByTitle(pool, REPOSITORY_ID, 'fix login', 10)).toHaveLength(2);
  });

  it('스택 상위 후보는 **열린 PR만**이다', async () => {
    await seedPr(3, 'p', 'open', 'shared', 'main');
    await seedPr(4, 'p', 'merged', 'shared', 'main');
    const rows = await prSnapshotRepo.findOpenPullRequestsByHeadBranch(pool, REPOSITORY_ID, 'shared', 10);
    expect(rows.map((row) => row.pr_number)).toEqual([3]);
  });

  it('스택 역방향(child) 조회는 **상태로 거르지 않는다** — 닫힌 child도 detached 대상이다', async () => {
    await seedPr(5, 'c1', 'open', 'x', 'parent');
    await seedPr(6, 'c2', 'closed', 'y', 'parent');
    const rows = await prSnapshotRepo.findPullRequestsByBaseBranch(pool, REPOSITORY_ID, 'parent', 10);
    expect(rows.map((row) => row.pr_number)).toEqual([5, 6]);
  });

  it('**질의 식이 인덱스 식과 같다** — 계획에 인덱스 이름이 나온다', async () => {
    /*
     * 작은 데이터셋에서 planner가 seq scan을 고르는 것은 정상이므로 그것으로
     * 실패 판정하지 않는다. 확인하는 것은 **인덱스를 쓸 수 있는 형태인가**다:
     * 강제로 seq scan을 끄고 계획을 뽑아 인덱스 이름이 나오는지 본다.
     */
    await seedCommit('9'.repeat(40), 'fix login', 'P', '2026-08-01T00:00:00.000Z');
    /*
     * `SET LOCAL`은 트랜잭션 안에서만 뜻이 있다. 풀의 `query`는 문장마다 다른
     * 커넥션일 수 있으므로 **한 커넥션 안에서** 설정과 EXPLAIN을 함께 돌린다.
     */
    const text = await withTransaction(pool, async (client) => {
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT * FROM commit_snapshot
           WHERE repository_id = $1 AND split_part(message, E'\\n', 1) = $2`,
        [REPOSITORY_ID, 'fix login'],
      );
      return plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(text).toContain('commit_snapshot_subject_idx');
  });
});
