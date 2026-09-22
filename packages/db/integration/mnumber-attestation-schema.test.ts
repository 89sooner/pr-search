/**
 * 031 — 확인서 행과 그 근거가 있는 상태의 down·up (CR-100 / 독립 검토 minor 1).
 *
 * 스키마 왕복 파수꾼 시험은 빈 표에서 돈다. 여기서는 확인서와 `operator_attestation` 근거 행을 심은 채
 * 031을 내려, 근거 행이 지워지고 CHECK 제약이 옛 목록으로 좁혀지며 부여된 번호·checkpoint는 그대로인지 본다.
 * 확인서로 지나간 서수는 이미 checkpoint 뒤라 회차가 다시 보지 않는다 — down은 「채번을 다시 멈추게」 하지
 * 않고 근거 행만 없앤다. 그 서수를 다시 판정하게 하려면 에폭 재채번이 필요하다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts packages/db/integration/mnumber-attestation-schema`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/migrate.js';
import { ensureAllPartitions } from '../src/partitions.js';
import * as attestationRepo from '../src/repositories/mnumber-attestation.js';
import * as evidenceRepo from '../src/repositories/mnumber-evidence.js';
import * as mergeSequenceRepo from '../src/repositories/merge-sequence.js';
import * as sequenceSpaceRepo from '../src/repositories/sequence-space.js';
import { createTestPool, errorCode, truncate } from './helpers.js';

const REPO = 7402;
const BRANCH = 'main';
const SHA = (n: number): string => n.toString(16).padStart(40, '0');
const CHECK_VIOLATION = '23514';

let pool: Pool;

beforeAll(async () => {
  pool = createTestPool();
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
}, 120_000);

afterAll(async () => {
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'mnumber_attestation', 'mnumber_evidence', 'merge_sequence', 'sequence_space');
});

describe('031: 확인서 행이 있는 상태의 왕복', () => {
  it('**down이 operator_attestation 근거 행을 지우고 제약을 좁히되 번호·checkpoint는 그대로다**; up이 표와 제약을 되살린다', async () => {
    await sequenceSpaceRepo.ensureSequenceSpace(pool, REPO, BRANCH);
    for (const row of [{ seq: 1, pr: null }, { seq: 2, pr: 21 }]) {
      await mergeSequenceRepo.upsertMergeSequence(pool, {
        repository_id: REPO,
        base_branch: BRANCH,
        seq_epoch: 1,
        merge_seq: row.seq,
        commit_sha: SHA(row.seq),
        pull_request_number: row.pr,
        committed_at: new Date('2026-09-01T00:00:00Z'),
      });
    }
    await sequenceSpaceRepo.advanceHead(pool, REPO, BRANCH, SHA(2), 2);
    const attestation = await attestationRepo.createAttestation(pool, {
      repositoryId: REPO,
      baseBranch: BRANCH,
      seqEpoch: 1,
      throughSeq: null,
      graceSeconds: 0,
      actor: 'prsctl:fixture',
      reason: '왕복 시험',
    });
    await evidenceRepo.upsertEvidence(pool, {
      repositoryId: REPO,
      baseBranch: BRANCH,
      seqEpoch: 1,
      mergeSeq: 1,
      commitSha: SHA(1),
      state: 'direct_confirmed',
      prNumber: null,
      reason: null,
      sourceKind: 'operator_attestation',
      sourcePrVersion: null,
      mergedAt: null,
      proof: { schema_version: 1, profile: 'squash_only', attestation_id: attestation.attestation_id, attested_reason: 'negative_evidence_unavailable' },
    });
    await evidenceRepo.upsertEvidence(pool, {
      repositoryId: REPO,
      baseBranch: BRANCH,
      seqEpoch: 1,
      mergeSeq: 2,
      commitSha: SHA(2),
      state: 'pr_confirmed',
      prNumber: 21,
      reason: null,
      sourceKind: 'pr_detail',
      sourcePrVersion: null,
      mergedAt: new Date('2026-09-01T01:00:00Z'),
      proof: { schema_version: 1, profile: 'squash_only' },
    });
    expect(await mergeSequenceRepo.assignMergeNumbers(pool, REPO, BRANCH, 1, [{ mergeSeq: 2, prNumber: 21, mergeNumber: 1 }])).toBe(1);
    await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, REPO, BRANCH, 1, { headSeq: 2, headNumber: 1, blocked: null });

    // 031 위에 032(CR-101)와 033(CR-112)이 쌓였다 — 031을 내리려면 함께 내린다. 목록으로 단언하므로 새 마이그레이션이 생기면 여기서 깨진다.
    expect(await migrateDown(pool, 4)).toEqual(['034', '033', '032', '031']);
    // 확인서 근거 행만 사라지고, PR 근거·번호·checkpoint는 그대로다.
    expect(await evidenceRepo.findEvidence(pool, REPO, BRANCH, 1, 1)).toBeUndefined();
    expect(await evidenceRepo.findEvidence(pool, REPO, BRANCH, 1, 2)).toMatchObject({ state: 'pr_confirmed', pr_number: 21 });
    const numbers = await pool.query<{ merge_number: number | null }>('SELECT merge_number FROM merge_sequence WHERE repository_id = $1 ORDER BY merge_seq', [REPO]);
    expect(numbers.rows.map((row) => row.merge_number)).toEqual([null, 1]);
    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPO, BRANCH);
    expect(space).toMatchObject({ mnumber_head_seq: 2, mnumber_head: 1 });
    const tables = await pool.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE tablename = 'mnumber_attestation'`);
    expect(tables.rows).toEqual([]);
    // 좁혀진 제약: operator_attestation은 더 이상 허용되지 않는다.
    await expect(
      evidenceRepo.upsertEvidence(pool, {
        repositoryId: REPO,
        baseBranch: BRANCH,
        seqEpoch: 1,
        mergeSeq: 1,
        commitSha: SHA(1),
        state: 'direct_confirmed',
        prNumber: null,
        reason: null,
        sourceKind: 'operator_attestation',
        sourcePrVersion: null,
        mergedAt: null,
        proof: { schema_version: 1, profile: 'squash_only' },
      }),
    ).rejects.toSatisfy((error: unknown) => errorCode(error) === CHECK_VIOLATION);

    expect(await migrateUp(pool)).toEqual(['031', '032', '033', '034']);
    expect(await attestationRepo.listAttestations(pool, { includeRevoked: true })).toEqual([]);
    await expect(
      attestationRepo.createAttestation(pool, { repositoryId: REPO, baseBranch: BRANCH, seqEpoch: 1, throughSeq: null, graceSeconds: 0, actor: 'prsctl:fixture', reason: '되살아난 표' }),
    ).resolves.toMatchObject({ seq_epoch: 1 });
  });
});
