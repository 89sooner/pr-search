/**
 * 마이그레이션 025와 M 번호 표의 제약 (WP-074 FR-SEQ-008 / T06a, T04a 일부).
 *
 * ## 무엇을 묻는가
 *
 * 1. **024 → 025 → 024 → 025 왕복**이 기존 서수·SHA·PR·에폭을 그대로 두는가 (T06a).
 * 2. 제약이 불변식을 **데이터베이스에서** 막는가 — 직접 푸시 행에 번호를 쓰는 것,
 *    같은 번호를 두 PR에 주는 것, 같은 PR에 두 번호를 주는 것, checkpoint가 head를
 *    넘는 것.
 * 3. `sequence_work`의 claim·lease·CAS — 늦은 ack는 0행이고, 실행 중 들어온 요청은
 *    완료로 덮이지 않는다 (T04a · T03b).
 * 4. `prs_app`이 새 표에 권한을 갖는다 (022의 사각지대를 되풀이하지 않는다).
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts packages/db/integration/merge-number-schema`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appliedVersions, migrateDown, migrateUp } from '../src/migrate.js';
import { ensureAllPartitions } from '../src/partitions.js';
import * as mergeSequenceRepo from '../src/repositories/merge-sequence.js';
import * as sequenceSpaceRepo from '../src/repositories/sequence-space.js';
import * as evidenceRepo from '../src/repositories/mnumber-evidence.js';
import * as workRepo from '../src/repositories/sequence-work.js';
import { clearMergeSequence } from './helpers.js';
import * as latencyRepo from '../src/repositories/sequence-latency.js';
import { createTestPool, errorCode, truncate } from './helpers.js';

const REPO = 7401;
const BRANCH = 'main';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

let pool: Pool;

async function seedSpace(rows: readonly { seq: number; sha: string; pr: number | null }[]): Promise<void> {
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPO, BRANCH);
  for (const row of rows) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPO,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: row.seq,
      commit_sha: row.sha,
      pull_request_number: row.pr,
      committed_at: new Date('2026-09-01T00:00:00Z'),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, REPO, BRANCH, rows[rows.length - 1]?.sha ?? 'x', rows.length);
}

const SHA = (n: number): string => n.toString(16).padStart(40, '0');

beforeAll(async () => {
  pool = createTestPool();
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
});

afterAll(async () => {
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space');
});

describe('T06a: 024 → 025 → 024 → 025 왕복', () => {
  it('**down이 기존 서수·SHA·PR·에폭을 보존하고 up이 M 열을 다시 만든다**', async () => {
    await seedSpace([
      { seq: 1, sha: SHA(1), pr: 21 },
      { seq: 2, sha: SHA(2), pr: null },
      { seq: 3, sha: SHA(3), pr: 25 },
    ]);
    // 번호 하나를 부여해 둔다 — down이 그것을 지우고 up이 NULL로 되돌리는 것이 계약이다.
    expect(await mergeSequenceRepo.assignMergeNumbers(pool, REPO, BRANCH, 1, [{ mergeSeq: 1, prNumber: 21, mergeNumber: 1 }])).toBe(1);

    const before = await pool.query(
      'SELECT merge_seq::int AS seq, commit_sha, pull_request_number, seq_epoch FROM merge_sequence ORDER BY merge_seq',
    );

    /*
     * **025까지 내리려면 그 위에 쌓인 것을 함께 내려야 한다** (WP-075 / CR-084).
     *
     * 이 시험이 묻는 것은 「025의 왕복」이고 025는 더 이상 마지막 마이그레이션이
     * 아니다. `migrateDown(pool, 1)`로 두면 가장 위의 것만 내려가고 025는 그대로 남아,
     * 아래 단언이 **025가 내려갔다고 믿으며 다른 것을 재는** 상태가 된다. 단계 수가
     * 아니라 **내려간 목록**으로 단언하므로 새 마이그레이션이 생기면 여기서 즉시 깨진다 —
     * `CR-085`의 027이 실제로 이 자리를 깨뜨렸고, `CR-086`의 028, `CR-088`의 029, `CR-090`의 030, `CR-100`의 031, `CR-101`의 032, `CR-112`의 033도 그랬다 — 그것이 이 형태의 목적이다.
     */
    expect(await migrateDown(pool, 9)).toEqual(['033', '032', '031', '030', '029', '028', '027', '026', '025']);
    expect((await appliedVersions(pool)).includes('025')).toBe(false);
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'merge_sequence'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('merge_number');
    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE tablename IN ('mnumber_evidence', 'sequence_work', 'sequence_latency_sample')`,
    );
    expect(tables.rows).toEqual([]);

    const after = await pool.query(
      'SELECT merge_seq::int AS seq, commit_sha, pull_request_number, seq_epoch FROM merge_sequence ORDER BY merge_seq',
    );
    expect(after.rows).toEqual(before.rows);

    expect(await migrateUp(pool)).toEqual(['025', '026', '027', '028', '029', '030', '031', '032', '033']);
    const restored = await pool.query<{ merge_number: number | null }>(
      'SELECT merge_number FROM merge_sequence WHERE merge_seq = 1',
    );
    // **번호 보존 rollback이 아니다** — 다시 up하면 M 값은 초기화된다 (상세 설계 10절).
    expect(restored.rows[0]?.merge_number).toBeNull();
    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPO, BRANCH);
    expect(space?.mnumber_head_seq).toBe(0);
    expect(space?.mnumber_head).toBe(0);
  });

  it('`prs_app`이 새 표 셋에 CRUD 권한을 갖는다 (022의 규율)', async () => {
    const result = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'prs_app'
          AND table_name IN ('mnumber_evidence', 'sequence_work', 'sequence_latency_sample')`,
    );
    for (const table of ['mnumber_evidence', 'sequence_work', 'sequence_latency_sample']) {
      const privileges = result.rows.filter((row) => row.table_name === table).map((row) => row.privilege_type).sort();
      expect(privileges, table).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    }
  });
});

describe('merge_sequence 제약 (AC-1 · AC-2 · AC-3)', () => {
  beforeEach(async () => {
    await seedSpace([
      { seq: 1, sha: SHA(1), pr: 21 },
      { seq: 2, sha: SHA(2), pr: null },
      { seq: 3, sha: SHA(3), pr: 25 },
      { seq: 4, sha: SHA(4), pr: 25 },
    ]);
  });

  it('**직접 푸시 행에는 번호를 쓸 수 없다** (AC-1)', async () => {
    let code: string | undefined;
    try {
      await pool.query('UPDATE merge_sequence SET merge_number = 1 WHERE merge_seq = 2');
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('같은 번호를 두 PR에 줄 수 없다 (AC-2)', async () => {
    await pool.query('UPDATE merge_sequence SET merge_number = 1 WHERE merge_seq = 1');
    let code: string | undefined;
    try {
      await pool.query('UPDATE merge_sequence SET merge_number = 1 WHERE merge_seq = 3');
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it('같은 PR이 두 번호를 가질 수 없다 — PR당 하나 (AC-1)', async () => {
    await pool.query('UPDATE merge_sequence SET merge_number = 1 WHERE merge_seq = 3');
    let code: string | undefined;
    try {
      await pool.query('UPDATE merge_sequence SET merge_number = 2 WHERE merge_seq = 4');
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it('assignMergeNumbers는 다른 번호를 덮지 못한다 — 갱신 행 수로 드러난다', async () => {
    expect(await mergeSequenceRepo.assignMergeNumbers(pool, REPO, BRANCH, 1, [{ mergeSeq: 1, prNumber: 21, mergeNumber: 1 }])).toBe(1);
    // 같은 번호 재실행은 멱등이다.
    expect(await mergeSequenceRepo.assignMergeNumbers(pool, REPO, BRANCH, 1, [{ mergeSeq: 1, prNumber: 21, mergeNumber: 1 }])).toBe(1);
    // 다른 번호도, 다른 PR도 0행이다.
    expect(await mergeSequenceRepo.assignMergeNumbers(pool, REPO, BRANCH, 1, [{ mergeSeq: 1, prNumber: 21, mergeNumber: 2 }])).toBe(0);
    expect(await mergeSequenceRepo.assignMergeNumbers(pool, REPO, BRANCH, 1, [{ mergeSeq: 3, prNumber: 99, mergeNumber: 2 }])).toBe(0);
  });

  it('safe-integer 상한을 넘는 번호는 거부된다 (C4)', async () => {
    let code: string | undefined;
    try {
      await pool.query('UPDATE merge_sequence SET merge_number = 9007199254740992 WHERE merge_seq = 1');
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('checkpoint는 head를 넘지 못하고 에폭 상향이 checkpoint를 0으로 돌린다', async () => {
    expect(await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, REPO, BRANCH, 1, { headSeq: 3, headNumber: 2, blocked: { seq: 4, reason: 'pr_evidence_pending' } })).toBe(true);
    let code: string | undefined;
    try {
      await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, REPO, BRANCH, 1, { headSeq: 5, headNumber: 2, blocked: null });
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(CHECK_VIOLATION);
    // 다른 에폭으로는 0행이다 — 락 사이에 에폭이 올랐으면 쓰지 않는다.
    expect(await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, REPO, BRANCH, 2, { headSeq: 1, headNumber: 1, blocked: null })).toBe(false);

    const since = (await sequenceSpaceRepo.findSequenceSpace(pool, REPO, BRANCH))?.mnumber_blocked_since;
    expect(since).not.toBeNull();
    // 같은 blocker면 since를 보존한다.
    await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, REPO, BRANCH, 1, { headSeq: 3, headNumber: 2, blocked: { seq: 4, reason: 'pr_evidence_pending' } });
    expect((await sequenceSpaceRepo.findSequenceSpace(pool, REPO, BRANCH))?.mnumber_blocked_since?.getTime()).toBe(since?.getTime());

    await sequenceSpaceRepo.bumpEpoch(pool, REPO, BRANCH);
    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPO, BRANCH);
    expect(space?.seq_epoch).toBe(2);
    expect(space?.mnumber_head_seq).toBe(0);
    expect(space?.mnumber_head).toBe(0);
    expect(space?.mnumber_blocked_seq).toBeNull();
  });
});

describe('mnumber_evidence 제약 (AC-10)', () => {
  beforeEach(async () => {
    await seedSpace([{ seq: 1, sha: SHA(1), pr: 21 }]);
  });

  it('pr_confirmed는 PR 번호와 merged_at을 요구하고, unresolved는 사유를 요구한다', async () => {
    const base = {
      repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, mergeSeq: 1, commitSha: SHA(1),
      sourcePrVersion: null, proof: { schema_version: 1 as const, profile: 'squash_only' as const },
    };
    await expect(evidenceRepo.upsertEvidence(pool, { ...base, state: 'pr_confirmed', prNumber: null, reason: null, sourceKind: 'pr_detail', mergedAt: new Date() })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(evidenceRepo.upsertEvidence(pool, { ...base, state: 'pr_confirmed', prNumber: 21, reason: null, sourceKind: 'pr_detail', mergedAt: null })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(evidenceRepo.upsertEvidence(pool, { ...base, state: 'unresolved', prNumber: null, reason: null, sourceKind: 'unresolved_lookup', mergedAt: null })).rejects.toMatchObject({ code: CHECK_VIOLATION });

    const pending = await evidenceRepo.upsertEvidence(pool, { ...base, state: 'unresolved', prNumber: null, reason: 'pr_evidence_pending', sourceKind: 'unresolved_lookup', mergedAt: null });
    expect(pending.first_pending_at).not.toBeNull();
    const again = await evidenceRepo.upsertEvidence(pool, { ...base, state: 'unresolved', prNumber: null, reason: 'pr_evidence_pending', sourceKind: 'unresolved_lookup', mergedAt: null });
    // 미확정이 처음 관측된 시각은 보존되고 버전은 오른다.
    expect(again.first_pending_at?.getTime()).toBe(pending.first_pending_at?.getTime());
    expect(again.evidence_version).toBe(2);
    const confirmed = await evidenceRepo.upsertEvidence(pool, { ...base, state: 'pr_confirmed', prNumber: 21, reason: null, sourceKind: 'pr_detail', mergedAt: new Date('2026-09-01T00:00:00Z') });
    expect(confirmed.first_pending_at).toBeNull();
    expect(confirmed.evidence_version).toBe(3);
  });

  /**
   * 반대 방향 (`DEV-590`).
   *
   * 근거가 남아 있으면 정본 행을 지울 수 없다 — `ON DELETE RESTRICT`다. 증거가 행과
   * 함께 조용히 사라지면 "무엇을 근거로 확정했는가"가 흔적 없이 없어지므로 그것이 옳다.
   *
   * **그래서 행을 지우려는 쪽이 증거를 먼저 회수해야 한다.** 시험의 정리도 예외가
   * 아니며, 그 순서를 한 곳에 모은 것이 `clearMergeSequence`다. 이 단언이 그 헬퍼가
   * 존재하는 이유이고, CI가 실제로 이 제약에 걸려 깨진 뒤에 생겼다.
   */
  it('**근거가 남아 있으면 정본 행을 지울 수 없다** — 증거를 먼저 회수해야 한다 (DEV-590)', async () => {
    await evidenceRepo.upsertEvidence(pool, {
      repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, mergeSeq: 1, commitSha: SHA(1),
      state: 'unresolved', prNumber: null, reason: 'pr_evidence_pending', sourceKind: 'unresolved_lookup',
      sourcePrVersion: null, mergedAt: null, proof: { schema_version: 1, profile: 'squash_only' },
    });

    await expect(
      pool.query('DELETE FROM merge_sequence WHERE repository_id = $1 AND merge_seq = 1', [REPO]),
    ).rejects.toMatchObject({ code: '23503' });

    // 순서를 지키면 지워진다.
    await clearMergeSequence(pool, 'repository_id = $1 AND merge_seq = 1', [REPO]);
    const left = await pool.query('SELECT 1 FROM merge_sequence WHERE repository_id = $1 AND merge_seq = 1', [REPO]);
    expect(left.rowCount).toBe(0);
  });

  it('근거는 정본 행 없이 존재할 수 없다 (FK)', async () => {
    await expect(
      evidenceRepo.upsertEvidence(pool, {
        repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, mergeSeq: 99, commitSha: SHA(99),
        state: 'unresolved', prNumber: null, reason: 'pr_evidence_pending', sourceKind: 'unresolved_lookup',
        sourcePrVersion: null, mergedAt: null, proof: { schema_version: 1, profile: 'squash_only' },
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('sequence_work claim · lease · CAS (T03b · T04a)', () => {
  it('**늦은 ack는 0행이다** — lease를 잃은 워커의 완료·재시도가 아무것도 바꾸지 않는다', async () => {
    await workRepo.requestWork(pool, { kind: 'reconcile', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, payload: { trigger_kind: 'test' } });
    const [claimed] = await workRepo.claimDueWork(pool, { kinds: ['reconcile'], limit: 10, leaseMs: 60_000 });
    expect(claimed?.state).toBe('leased');
    expect(claimed?.attempt_count).toBe(1);
    const lease = { workKey: claimed!.work_key, leaseToken: claimed!.lease_token! };

    // 두 번째 claim은 같은 행을 집지 못한다.
    expect(await workRepo.claimDueWork(pool, { kinds: ['reconcile'], limit: 10, leaseMs: 60_000 })).toEqual([]);

    // lease 만료 회수 뒤 다른 워커가 집는다.
    await pool.query(`UPDATE sequence_work SET lease_until = now() - interval '1 second' WHERE work_key = $1`, [lease.workKey]);
    expect(await workRepo.reclaimExpiredLeases(pool)).toBe(1);
    const [reclaimed] = await workRepo.claimDueWork(pool, { kinds: ['reconcile'], limit: 10, leaseMs: 60_000 });
    expect(reclaimed?.lease_token).not.toBe(lease.leaseToken);

    // 옛 토큰의 ack는 0행이다.
    expect(await workRepo.completeWork(pool, lease, claimed!.requested_generation)).toBe(false);
    expect(await workRepo.releaseWork(pool, lease, { state: 'retry', availableAt: new Date(), reason: 'late' })).toBe(false);
    expect(await workRepo.heartbeatWork(pool, lease, 1_000)).toBe(false);
    expect((await workRepo.findWork(pool, lease.workKey))?.state).toBe('leased');
  });

  it('**실행 중 들어온 요청은 완료로 덮이지 않는다** — generation CAS', async () => {
    const first = await workRepo.requestWork(pool, { kind: 'reconcile', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, payload: {} });
    expect(first.requested_generation).toBe(1);
    const [claimed] = await workRepo.claimDueWork(pool, { kinds: ['reconcile'], limit: 1, leaseMs: 60_000 });
    const lease = { workKey: claimed!.work_key, leaseToken: claimed!.lease_token! };

    // 실행 중에 새 요청 — lease는 그대로이고 generation만 오른다.
    const bumped = await workRepo.requestWork(pool, { kind: 'reconcile', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, payload: {} });
    expect(bumped.state).toBe('leased');
    expect(bumped.lease_token).toBe(lease.leaseToken);
    expect(bumped.requested_generation).toBe(2);

    // claim 시점의 generation(1)으로 완료하면 done이 아니라 ready로 돌아온다.
    expect(await workRepo.completeWork(pool, lease, claimed!.requested_generation)).toBe(true);
    const after = await workRepo.findWork(pool, lease.workKey);
    expect(after?.state).toBe('ready');
    expect(after?.completed_generation).toBe(1);

    // 다시 집어 generation 2로 완료하면 done이다.
    const [second] = await workRepo.claimDueWork(pool, { kinds: ['reconcile'], limit: 1, leaseMs: 60_000 });
    expect(await workRepo.completeWork(pool, { workKey: second!.work_key, leaseToken: second!.lease_token! }, second!.requested_generation)).toBe(true);
    expect((await workRepo.findWork(pool, lease.workKey))?.state).toBe('done');
  });

  it('refresh intent는 전달당 하나이고 covered 완료가 lease 토큰까지 닫는다', async () => {
    const at = (iso: string): Date => new Date(iso);
    expect(await workRepo.enqueueRefreshWork(pool, { deliveryId: 'd-1', repositoryId: REPO, baseBranch: BRANCH, headSha: SHA(1), receivedAt: at('2026-09-11T00:00:00Z'), correlationId: 'c-1' })).toBe(true);
    expect(await workRepo.enqueueRefreshWork(pool, { deliveryId: 'd-1', repositoryId: REPO, baseBranch: BRANCH, headSha: SHA(1), receivedAt: at('2026-09-11T00:00:00Z'), correlationId: 'c-1' })).toBe(false);
    expect(await workRepo.enqueueRefreshWork(pool, { deliveryId: 'd-2', repositoryId: REPO, baseBranch: BRANCH, headSha: SHA(2), receivedAt: at('2026-09-11T00:00:01Z'), correlationId: 'c-2' })).toBe(true);
    // 다른 공간의 intent는 덮이지 않는다.
    expect(await workRepo.enqueueRefreshWork(pool, { deliveryId: 'd-3', repositoryId: REPO, baseBranch: 'release', headSha: SHA(3), receivedAt: at('2026-09-11T00:00:02Z'), correlationId: 'c-3' })).toBe(true);

    const [claimed] = await workRepo.claimDueWork(pool, { kinds: ['refresh'], limit: 1, leaseMs: 60_000 });
    // fetch 직전에 덮을 집합을 고정한다 — 시각이 아니라 그 시점에 보이는 행이다 (DEV-670).
    const coverable = await workRepo.listCoverableRefreshWorkKeys(pool, { repositoryId: REPO, baseBranch: BRANCH, leaseToken: claimed!.lease_token });
    expect(coverable).toEqual(['push:d-1', 'push:d-2']);

    // fetch 시작 **뒤에** 도착한 push는 집합에 없으므로 남는다 — 같은 밀리초에 들어와도 같다.
    await workRepo.enqueueRefreshWork(pool, { deliveryId: 'd-4', repositoryId: REPO, baseBranch: BRANCH, headSha: SHA(4), receivedAt: new Date(), correlationId: 'c-4' });

    const covered = await workRepo.completeCoveredRefreshWorks(pool, { workKeys: coverable, leaseToken: claimed!.lease_token });
    expect(covered.map((one) => one.payload.delivery_id).sort()).toEqual(['d-1', 'd-2']);
    expect((await workRepo.findWork(pool, 'push:d-1'))?.state).toBe('done');
    expect((await workRepo.findWork(pool, 'push:d-3'))?.state).toBe('ready');
    expect((await workRepo.findWork(pool, 'push:d-4'))?.state).toBe('ready');

    // 빈 집합은 질의 없이 빈 결과다.
    expect(await workRepo.completeCoveredRefreshWorks(pool, { workKeys: [], leaseToken: null })).toEqual([]);

    // 집합에 있었어도 그 사이 다른 워커가 집어 간 행(lease 불일치)은 닫지 않는다.
    const others = await workRepo.claimDueWork(pool, { kinds: ['refresh'], limit: 2, leaseMs: 60_000 });
    expect(others.map((row) => row.work_key).sort()).toEqual(['push:d-3', 'push:d-4']);
    expect(await workRepo.completeCoveredRefreshWorks(pool, { workKeys: ['push:d-4'], leaseToken: null })).toEqual([]);
    expect((await workRepo.findWork(pool, 'push:d-4'))?.state).toBe('leased');
  });

  it('lease 상태와 lease 필드는 함께 있거나 함께 없다 (CHECK)', async () => {
    await workRepo.requestWork(pool, { kind: 'announce', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, payload: {}, keyExtra: [1, 2] });
    let code: string | undefined;
    try {
      await pool.query(`UPDATE sequence_work SET state = 'leased' WHERE kind = 'announce'`);
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(CHECK_VIOLATION);
  });
});

/**
 * 배치 요청이 단건과 **같은 뜻이어야 한다** (`DEV-605`).
 *
 * 재색인이 PR마다 부르면 왕복이 PR 수만큼이므로 한 문장으로 묶었는데, 그 과정에서
 * 의미가 달라지면 진행 중인 work를 빼앗거나 generation을 잃는다.
 */
describe('requestWorkBatch (DEV-605)', () => {
  it('**단건과 같은 행을 만든다** — 키·payload·generation이 같다', async () => {
    await workRepo.requestWorkBatch(pool, [
      { kind: 'materialize', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, keyExtra: [21], payload: { pr_number: 21 } },
      { kind: 'materialize', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, keyExtra: [25], payload: { pr_number: 25 } },
    ]);
    const single = await workRepo.requestWork(pool, {
      kind: 'materialize', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, keyExtra: [27], payload: { pr_number: 27 },
    });

    const rows = (await workRepo.listWorkForSpace(pool, REPO, BRANCH)).filter((one) => one.kind === 'materialize');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.state).toBe('ready');
      expect(row.requested_generation).toBe(1);
      expect(row.completed_generation).toBe(0);
    }
    expect(rows.find((one) => one.work_key === single.work_key)).toBeDefined();
  });

  it('같은 키를 다시 요청하면 generation만 오른다 — 단건과 같다', async () => {
    const input = { kind: 'materialize' as const, repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, keyExtra: [21], payload: { pr_number: 21 } };
    await workRepo.requestWorkBatch(pool, [input]);
    await workRepo.requestWorkBatch(pool, [input]);
    const row = (await workRepo.listWorkForSpace(pool, REPO, BRANCH)).find((one) => one.kind === 'materialize');
    expect(row?.requested_generation).toBe(2);
  });

  it('**진행 중인 work의 lease를 빼앗지 않는다**', async () => {
    await workRepo.requestWorkBatch(pool, [
      { kind: 'materialize', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, keyExtra: [21], payload: { pr_number: 21 } },
    ]);
    const [claimed] = await workRepo.claimDueWork(pool, { kinds: ['materialize'], limit: 10, leaseMs: 60_000 });
    expect(claimed?.state).toBe('leased');

    await workRepo.requestWorkBatch(pool, [
      { kind: 'materialize', repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, keyExtra: [21], payload: { pr_number: 21 } },
    ]);
    const after = await workRepo.findWork(pool, claimed?.work_key as string);
    // 상태와 lease는 그대로이고 새 요청은 generation으로만 남는다.
    expect(after?.state).toBe('leased');
    expect(after?.lease_token).toBe(claimed?.lease_token);
    expect(after?.requested_generation).toBe(2);
  });

  it('빈 입력은 아무 문장도 보내지 않는다', async () => {
    expect(await workRepo.requestWorkBatch(pool, [])).toBe(0);
  });
});

describe('sequence_latency_sample', () => {
  it('stage 시각은 비어 있는 것만 채우고 관측은 최초 값만 남긴다', async () => {
    const base = { workKey: 'reconcile:[1,"main",1]', attempt: 1, repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, prNumber: 21, deliveryId: null, triggerKind: 'new_squash' as const, receivedAt: null, attemptStartedAt: new Date(), reason: null };
    const first = await latencyRepo.upsertSample(pool, { ...base, outcome: 'pending', sequenceAssignedNow: true });
    expect(first.sequence_assigned_at).not.toBeNull();
    expect(first.mnumber_assigned_at).toBeNull();
    const second = await latencyRepo.upsertSample(pool, { ...base, outcome: 'assigned', mnumberAssignedNow: true });
    expect(second.sample_id).toBe(first.sample_id);
    expect(second.sequence_assigned_at?.getTime()).toBe(first.sequence_assigned_at?.getTime());
    expect(second.mnumber_assigned_at).not.toBeNull();

    expect((await latencyRepo.listUnobservedAssigned(pool, 10)).map((row) => row.sample_id)).toEqual([first.sample_id]);
    await latencyRepo.markAbsent(pool, first.sample_id, 2_000);
    await latencyRepo.markObserved(pool, first.sample_id, { indexUuid: 'idx', pollIntervalMs: 2_000 });
    const observed = (await latencyRepo.listSamplesForSpace(pool, REPO, BRANCH))[0];
    expect(observed?.outcome).toBe('visible');
    expect(observed?.observation_attempts).toBe(2);
    expect(observed?.last_search_absent_at).not.toBeNull();
    const firstObserved = observed?.search_observed_at;
    await latencyRepo.markObserved(pool, first.sample_id, { indexUuid: 'other', pollIntervalMs: 5_000 });
    const again = (await latencyRepo.listSamplesForSpace(pool, REPO, BRANCH))[0];
    expect(again?.search_observed_at?.getTime()).toBe(firstObserved?.getTime());
    expect(again?.observed_index_uuid).toBe('idx');
  });

  it('PR이 NULL인 표본도 같은 attempt에서 중복되지 않는다 (NULLS NOT DISTINCT)', async () => {
    const base = { workKey: 'push:d-9', attempt: 1, repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, prNumber: null, deliveryId: 'd-9', triggerKind: 'new_squash' as const, outcome: 'pending' as const, receivedAt: null, attemptStartedAt: new Date(), reason: null };
    const a = await latencyRepo.upsertSample(pool, base);
    const b = await latencyRepo.upsertSample(pool, base);
    expect(b.sample_id).toBe(a.sample_id);
  });

  /**
   * 한 요청은 한 행이다 (`DEV-593`).
   *
   * 수신 시점에는 PR을 몰라 `pr_number`가 비어 있다. M 번호가 붙어 PR을 알게 되면
   * **그 행을 이어받아야** 한다 — 새 행을 만들면 push 행이 영영 `mnumber_assigned_at`
   * 없이 남아 정상 채번에서도 `pending`으로 집계되고, 같은 push가 두 번 세어진다.
   */
  it('**push 표본이 PR 표본으로 승격되어 한 행으로 남는다** (DEV-593)', async () => {
    const push = {
      workKey: 'push:d-11', attempt: 1, repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1,
      prNumber: null, deliveryId: 'd-11', triggerKind: 'new_squash' as const, outcome: 'pending' as const,
      receivedAt: new Date('2026-09-01T00:00:00Z'), attemptStartedAt: null, reason: null,
    };
    const created = await latencyRepo.upsertSample(pool, { ...push, mirrorCompletedNow: true, sequenceAssignedNow: true });
    expect(created.pr_number).toBeNull();

    expect(await latencyRepo.promotePushSample(pool, { workKey: 'push:d-11', attempt: 1, seqEpoch: 1, prNumber: 21 })).toBe(true);

    const promoted = await latencyRepo.upsertSample(pool, {
      ...push, prNumber: 21, outcome: 'assigned' as const, mnumberAssignedNow: true,
    });
    // 같은 행이다. 수신·미러·시퀀스 시각이 보존되고 M 시각이 채워진다.
    expect(promoted.sample_id).toBe(created.sample_id);
    expect(promoted.received_at?.getTime()).toBe(created.received_at?.getTime());
    expect(promoted.mirror_completed_at?.getTime()).toBe(created.mirror_completed_at?.getTime());
    expect(promoted.mnumber_assigned_at).not.toBeNull();

    const rows = (await latencyRepo.listSamplesForSpace(pool, REPO, BRANCH)).filter((row) => row.delivery_id === 'd-11');
    expect(rows).toHaveLength(1);
  });

  it('같은 push가 PR 둘을 실어 오면 첫 PR이 그 행을 가져가고 둘째는 새 행이다', async () => {
    const push = {
      workKey: 'push:d-12', attempt: 1, repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1,
      prNumber: null, deliveryId: 'd-12', triggerKind: 'new_squash' as const, outcome: 'pending' as const,
      receivedAt: new Date('2026-09-01T00:00:00Z'), attemptStartedAt: null, reason: null,
    };
    await latencyRepo.upsertSample(pool, push);

    expect(await latencyRepo.promotePushSample(pool, { workKey: 'push:d-12', attempt: 1, seqEpoch: 1, prNumber: 21 })).toBe(true);
    // 비어 있던 행을 첫 PR이 가져갔으므로 둘째는 승격할 것이 없다.
    expect(await latencyRepo.promotePushSample(pool, { workKey: 'push:d-12', attempt: 1, seqEpoch: 1, prNumber: 25 })).toBe(false);

    await latencyRepo.upsertSample(pool, { ...push, prNumber: 21, outcome: 'assigned' as const, mnumberAssignedNow: true });
    await latencyRepo.upsertSample(pool, { ...push, prNumber: 25, outcome: 'assigned' as const, mnumberAssignedNow: true });

    // 행 수가 PR 수와 같다 — 남는 빈 행이 없다.
    const rows = (await latencyRepo.listSamplesForSpace(pool, REPO, BRANCH)).filter((row) => row.delivery_id === 'd-12');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.pr_number !== null)).toBe(true);
  });
});
