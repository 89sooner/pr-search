/**
 * WP-075 FR-SEQ-009 — 표기의 정본 접근을 실제 PostgreSQL로 잰다.
 *
 * ## 왜 단위 시험으로 충분하지 않은가
 *
 * 단위 시험의 Pool 대역은 `query`가 불렸는지만 본다 — 열 이름이 틀려도, 에폭
 * 조인이 빠져도, `ON CONFLICT` 대상이 어긋나도 통과한다 (WP-075 이전 라운드가
 * 같은 사각지대를 실제로 겪었다). 여기서 재는 것은 **SQL 자체**다.
 *
 * GHE는 로컬 HTTP 목이다. 사내 GHE도 public 저장소도 건드리지 않는다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence/annotate`
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { AnnotateClient, resolveAnnotateConfig } from '@prs/github-annotate';
import { migratedPool } from '../../../../packages/db/integration/helpers.js';
import {
  generateTestKeyPair,
  startMockAnnotateGhe,
  type MockAnnotateGhe,
} from '../../../../packages/github-annotate/testing/mock-annotate-ghe.js';
import { annotateOne, runAnnotationPass, type AnnotateDeps } from '../../src/annotate.js';
import { createWorkerMetrics } from '../../src/metrics.js';

const KEYS = generateTestKeyPair();
const REPOSITORY_ID = 90_751;
const OTHER_REPOSITORY_ID = 90_752;
/*
 * **`(owner, name)`이 유일하고 통합 시험은 DB 하나를 공유한다.** `acme/smp1900`은
 * `mnumber.test.ts`·`freshness.test.ts`가 이미 쓰므로 소유자를 이 파일 전용으로
 * 둔다 — 이름을 `smp1900`으로 유지하는 것은 저장소 **코드**가 이름에서만 나오기
 * 때문이다(`OD-009`). 단독 실행에서는 통과하고 전량 실행에서만 깨지는 자리다.
 */
const OWNER = 'wp075org';
const NAME = 'smp1900';
const BRANCH = 'main';
const EPOCH = 3;

let pool: Pool;
let mock: MockAnnotateGhe | undefined;

async function seedRepository(id: number, name: string): Promise<void> {
  await repositoryRepo.upsertRepository(pool, {
    repository_id: id,
    owner: OWNER,
    name,
    org_id: 907,
    visibility: 'internal',
    sequence_branches: [BRANCH],
  });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, id, BRANCH);
  await pool.query('UPDATE sequence_space SET seq_epoch = $3 WHERE repository_id = $1 AND base_branch = $2', [
    id,
    BRANCH,
    EPOCH,
  ]);
}

/** 번호가 붙은 행 하나. `merge_number`는 WP-074가 확정한 값을 흉내 낸다. */
async function seedNumberedRow(options: {
  repositoryId?: number;
  mergeSeq: number;
  pullRequestNumber: number;
  mergeNumber: number;
  epoch?: number;
  annotateState?: string | null;
}): Promise<void> {
  const repositoryId = options.repositoryId ?? REPOSITORY_ID;
  const epoch = options.epoch ?? EPOCH;
  await pool.query(
    `INSERT INTO merge_sequence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number,
        committed_at, merge_number, annotate_state)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)`,
    [
      repositoryId,
      BRANCH,
      epoch,
      options.mergeSeq,
      `${String(options.mergeSeq).padStart(40, 'a')}`.slice(0, 40),
      options.pullRequestNumber,
      options.mergeNumber,
      options.annotateState ?? null,
    ],
  );
}

async function stateOf(mergeSeq: number, repositoryId = REPOSITORY_ID): Promise<string | null> {
  const { rows } = await pool.query<{ annotate_state: string | null }>(
    `SELECT annotate_state FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND merge_seq = $3 AND seq_epoch = $4`,
    [repositoryId, BRANCH, mergeSeq, EPOCH],
  );
  return rows[0]?.annotate_state ?? null;
}

function depsFor(): AnnotateDeps {
  const config = resolveAnnotateConfig({
    MNUMBER_ANNOTATE_ENABLED: 'true',
    GHE_API_URL: (mock as MockAnnotateGhe).apiUrl,
    GHE_ANNOTATE_APP_ID: '77001',
    GHE_ANNOTATE_PRIVATE_KEY: KEYS.privateKey,
    GHE_ANNOTATE_INSTALLATIONS: `${OWNER}:5150`,
    GHE_ANNOTATE_REQUEST_TIMEOUT_MS: '2000',
  });
  return {
    pool,
    bus: undefined as never,
    config,
    metrics: createWorkerMetrics(),
    sleep: async () => {},
    log: () => {},
    client: new AnnotateClient({ config }),
  };
}

beforeEach(async () => {
  pool = pool ?? (await migratedPool());
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = ANY($1::bigint[])', [
    [REPOSITORY_ID, OTHER_REPOSITORY_ID],
  ]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1::bigint[])', [
    [REPOSITORY_ID, OTHER_REPOSITORY_ID],
  ]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [
    [REPOSITORY_ID, OTHER_REPOSITORY_ID],
  ]);
  await pool.query(`DELETE FROM audit_record WHERE user_id = 'system:annotate'`);
  await seedRepository(REPOSITORY_ID, NAME);
}, 180_000);

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

afterAll(async () => {
  await pool?.query('DELETE FROM merge_sequence WHERE repository_id = ANY($1::bigint[])', [
    [REPOSITORY_ID, OTHER_REPOSITORY_ID],
  ]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1::bigint[])', [
    [REPOSITORY_ID, OTHER_REPOSITORY_ID],
  ]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [
    [REPOSITORY_ID, OTHER_REPOSITORY_ID],
  ]);
  await pool?.query(`DELETE FROM audit_record WHERE user_id = 'system:annotate'`);
  await pool?.end();
});

describe('마이그레이션 026이 만든 정책 열', () => {
  it('기존 저장소는 표기 허용이 기본이다 (FR-SEQ-009 AC-6)', async () => {
    const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    expect(row?.annotate_enabled).toBe(true);
    expect(row?.annotate_blocked_at).toBeNull();
    expect(row?.annotate_blocked_reason).toBeNull();
  });

  it('운영자 설정으로 끌 수 있다', async () => {
    const updated = await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { annotate_enabled: false });
    expect(updated?.annotate_enabled).toBe(false);
    // 다른 설정을 함께 뒤집지 않는다.
    expect(updated?.mirror_enabled).toBe(true);
  });

  it('실행 중 차단은 운영자 설정과 별개로 기록된다', async () => {
    await repositoryRepo.blockAnnotation(pool, REPOSITORY_ID, '403 permission denied');
    const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    expect(row?.annotate_blocked_reason).toBe('403 permission denied');
    // **운영자 값은 그대로다.**
    expect(row?.annotate_enabled).toBe(true);

    await repositoryRepo.clearAnnotationBlock(pool, REPOSITORY_ID);
    expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))?.annotate_blocked_at).toBeNull();
  });

  it('사유 없는 차단 시각을 제약이 막는다', async () => {
    await expect(
      pool.query('UPDATE repository SET annotate_blocked_at = now() WHERE repository_id = $1', [REPOSITORY_ID]),
    ).rejects.toThrow(/repository_annotate_blocked_chk/);
  });
});

describe('listAnnotateTargets — 무엇을 고르는가', () => {
  it('번호가 있고 아직 표기하지 않은 행을 고른다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    const rows = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: OWNER, name: NAME, merge_number: 1, pull_request_number: 101 });
  });

  it('**이전 에폭의 행은 고르지 않는다** — 조인이 막는다 (§11)', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1, epoch: EPOCH - 1 });
    const rows = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID });
    expect(rows).toHaveLength(0);
  });

  it('`done`과 `mismatch`는 다시 보지 않는다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1, annotateState: 'done' });
    await seedNumberedRow({ mergeSeq: 11, pullRequestNumber: 102, mergeNumber: 2, annotateState: 'mismatch' });
    const rows = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID });
    expect(rows).toHaveLength(0);
  });

  it('`failed`와 `disabled`는 다시 본다 — 운영자가 다시 켰을 수 있다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1, annotateState: 'failed' });
    await seedNumberedRow({ mergeSeq: 11, pullRequestNumber: 102, mergeNumber: 2, annotateState: 'disabled' });
    const rows = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID });
    expect(rows.map((row) => row.merge_seq).sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('번호가 없는 행은 대상이 아니다 (AC-7)', async () => {
    await pool.query(
      `INSERT INTO merge_sequence (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at)
       VALUES ($1, $2, $3, 12, 'cccccccccccccccccccccccccccccccccccccccc', 103, now())`,
      [REPOSITORY_ID, BRANCH, EPOCH],
    );
    const rows = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID });
    expect(rows).toHaveLength(0);
  });

  it('해제된 저장소는 대상이 아니다 (AC-6)', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { annotate_enabled: false });
    const rows = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID });
    expect(rows).toHaveLength(0);
  });

  it('차단된 저장소는 쿨다운 전에는 보지 않고 지난 뒤에는 본다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    await repositoryRepo.blockAnnotation(pool, REPOSITORY_ID, '403 denied');

    // 기준 시각을 주지 않으면 차단된 저장소를 전부 제외한다 (이벤트 경로).
    expect(await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID })).toHaveLength(0);

    // 아직 쿨다운 전이다.
    const notYet = await mergeSequenceRepo.listAnnotateTargets(pool, {
      limit: 10,
      repositoryId: REPOSITORY_ID,
      blockedBefore: new Date(Date.now() - 60_000),
    });
    expect(notYet).toHaveLength(0);

    // 쿨다운이 지났다.
    const after = await mergeSequenceRepo.listAnnotateTargets(pool, {
      limit: 10,
      repositoryId: REPOSITORY_ID,
      blockedBefore: new Date(Date.now() + 60_000),
    });
    expect(after).toHaveLength(1);
  });

  it('보관된 저장소는 대상이 아니다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    await repositoryRepo.setRepositoryStatus(pool, REPOSITORY_ID, 'archived');
    expect(await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID })).toHaveLength(0);
  });
});

describe('스윕의 공평성 — 영구 실패가 목록을 독점하지 않는다 (리뷰 major)', () => {
  it('한 번도 시도하지 않은 행이 먼저다', async () => {
    /*
     * 코드를 정할 수 없는 저장소의 행은 몇 번을 봐도 `failed`다. 정렬이
     * `repository_id`로 시작하면 번호가 낮은 그런 저장소가 상한을 통째로 차지해
     * **높은 번호 저장소의 행에 스윕이 영영 닿지 않는다.**
     */
    await seedRepository(OTHER_REPOSITORY_ID, 'wp-annotate-nodigits');
    // 낮은 번호 저장소에 이미 손댄(실패한) 행 둘을 둔다.
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1, annotateState: 'failed' });
    await seedNumberedRow({ mergeSeq: 11, pullRequestNumber: 102, mergeNumber: 2, annotateState: 'failed' });
    await pool.query(
      `UPDATE merge_sequence SET annotated_at = now() - interval '1 hour'
        WHERE repository_id = $1 AND annotate_state = 'failed'`,
      [REPOSITORY_ID],
    );
    // 높은 번호 저장소에 한 번도 시도하지 않은 행 하나를 둔다.
    await seedNumberedRow({
      repositoryId: OTHER_REPOSITORY_ID,
      mergeSeq: 10,
      pullRequestNumber: 201,
      mergeNumber: 1,
    });

    const first = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 1 });
    expect(first).toHaveLength(1);
    expect(first[0]?.repository_id, '이미 손댄 행이 새 행보다 앞섰다').toBe(OTHER_REPOSITORY_ID);
  });

  it('오래전에 손댄 행이 방금 손댄 행보다 앞선다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1, annotateState: 'failed' });
    await seedNumberedRow({ mergeSeq: 11, pullRequestNumber: 102, mergeNumber: 2, annotateState: 'failed' });
    await pool.query(
      `UPDATE merge_sequence SET annotated_at = now() - interval '2 days' WHERE repository_id = $1 AND merge_seq = 11`,
      [REPOSITORY_ID],
    );
    await pool.query(
      `UPDATE merge_sequence SET annotated_at = now() WHERE repository_id = $1 AND merge_seq = 10`,
      [REPOSITORY_ID],
    );

    const rows = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID });
    expect(rows.map((row) => row.merge_seq)).toEqual([11, 10]);
  });
});

describe('isAnnotationCurrent — 쓰기 직전 울타리 (리뷰 P1)', () => {
  it('같은 에폭·같은 번호면 통과한다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    const key = { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, mergeSeq: 10 };
    expect(await mergeSequenceRepo.isAnnotationCurrent(pool, key, 1)).toBe(true);
  });

  it('**그 사이 에폭이 오르면 막는다**', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    const key = { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, mergeSeq: 10 };
    expect(await mergeSequenceRepo.isAnnotationCurrent(pool, key, 1)).toBe(true);

    // 재채번이 들어와 공간의 에폭이 올랐다. 뽑아 둔 행은 이제 옛 에폭이다.
    await pool.query('UPDATE sequence_space SET seq_epoch = $2 WHERE repository_id = $1', [
      REPOSITORY_ID,
      EPOCH + 1,
    ]);
    expect(await mergeSequenceRepo.isAnnotationCurrent(pool, key, 1)).toBe(false);
  });

  it('재채번 중인 공간은 막는다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    const key = { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, mergeSeq: 10 };
    await pool.query(`UPDATE sequence_space SET state = 'reassigning' WHERE repository_id = $1`, [REPOSITORY_ID]);
    expect(await mergeSequenceRepo.isAnnotationCurrent(pool, key, 1)).toBe(false);
    // 목록에서도 빠진다 — 애초에 집지 않는다.
    expect(await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 10, repositoryId: REPOSITORY_ID })).toHaveLength(0);
  });

  it('번호가 그 사이 바뀌면 막는다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    const key = { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, mergeSeq: 10 };
    expect(await mergeSequenceRepo.isAnnotationCurrent(pool, key, 2)).toBe(false);
  });

  it('그 사이 저장소가 해제되면 막는다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    const key = { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, mergeSeq: 10 };
    await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { annotate_enabled: false });
    expect(await mergeSequenceRepo.isAnnotationCurrent(pool, key, 1)).toBe(false);
  });

  it('회차 도중 에폭이 오르면 GHE를 부르지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 1234, mergeNumber: 1 });
    const [row] = await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 1, repositoryId: REPOSITORY_ID });

    // 목록을 뽑은 뒤, 처리하기 전에 재채번이 들어왔다.
    await pool.query('UPDATE sequence_space SET seq_epoch = $2 WHERE repository_id = $1', [
      REPOSITORY_ID,
      EPOCH + 1,
    ]);

    const result = await annotateOne(depsFor(), row as never, '11111111-1111-4111-8111-111111111111');
    expect(result).toBe('superseded');
    expect(mock.requests.filter((entry) => entry.method === 'PATCH')).toHaveLength(0);
    expect(mock.currentTitle()).toBe('제목');
  });
});

describe('markDisabledRepositoryTargets — 해제 표시', () => {
  it('해제된 저장소의 행만 disabled로 남기고 GHE는 부르지 않는다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { annotate_enabled: false });

    const marked = await mergeSequenceRepo.markDisabledRepositoryTargets(pool, 100);
    expect(marked).toBe(1);
    expect(await stateOf(10)).toBe('disabled');

    // 두 번째 호출은 아무것도 바꾸지 않는다 — 스윕마다 같은 행을 다시 쓰지 않는다.
    expect(await mergeSequenceRepo.markDisabledRepositoryTargets(pool, 100)).toBe(0);
  });

  it('켜진 저장소의 행은 건드리지 않는다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1 });
    expect(await mergeSequenceRepo.markDisabledRepositoryTargets(pool, 100)).toBe(0);
    expect(await stateOf(10)).toBeNull();
  });

  it('이미 쓴 행은 덮지 않는다 — 끈 것이 쓴 사실을 지우지 않는다', async () => {
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 101, mergeNumber: 1, annotateState: 'done' });
    await seedNumberedRow({ mergeSeq: 11, pullRequestNumber: 102, mergeNumber: 2, annotateState: 'mismatch' });
    await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { annotate_enabled: false });

    expect(await mergeSequenceRepo.markDisabledRepositoryTargets(pool, 100)).toBe(0);
    expect(await stateOf(10)).toBe('done');
    expect(await stateOf(11)).toBe('mismatch');
  });
});

describe('회차 전체 (실제 SQL + 실제 HTTP)', () => {
  it('표기하고 정본과 감사를 남긴다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: 'Fix device initialization race' });
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 1234, mergeNumber: 1 });

    const summary = await runAnnotationPass(
      depsFor(),
      { limit: 10, repositoryId: REPOSITORY_ID },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(summary.results.updated).toBe(1);
    expect(mock.currentTitle()).toBe('[M-1900-1] Fix device initialization race');
    expect(await stateOf(10)).toBe('done');

    const audits = await auditRepo.listAuditRecords(pool, { userId: 'system:annotate' }, 10);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('pull_request.annotate');
    expect(audits[0]?.target).toBe(`${OWNER}/${NAME}#1234`);
    expect(audits[0]?.query).toBeNull();
  });

  it('표기 실패가 merge_number를 되돌리지 않는다 (AC-3)', async () => {
    mock = await startMockAnnotateGhe({
      getScript: Array.from({ length: 6 }, () => ({ status: 500, body: { message: 'boom' } })),
    });
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 1234, mergeNumber: 1 });

    await annotateOne(
      depsFor(),
      (await mergeSequenceRepo.listAnnotateTargets(pool, { limit: 1, repositoryId: REPOSITORY_ID }))[0] as never,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(await stateOf(10)).toBe('failed');
    const { rows } = await pool.query<{ merge_number: number }>(
      'SELECT merge_number FROM merge_sequence WHERE repository_id = $1 AND merge_seq = 10 AND seq_epoch = $2',
      [REPOSITORY_ID, EPOCH],
    );
    expect(rows[0]?.merge_number).toBe(1);
  });

  it('권한 오류가 저장소를 차단하되 운영자 설정은 그대로다', async () => {
    mock = await startMockAnnotateGhe({
      getScript: [{ status: 403, body: { message: 'Resource not accessible by integration' } }],
    });
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 1234, mergeNumber: 1 });

    await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });

    const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    expect(row?.annotate_blocked_at).not.toBeNull();
    expect(row?.annotate_enabled).toBe(true);
    expect(await stateOf(10)).toBe('failed');
  });

  it('성공하면 이전 차단을 지운다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    await seedNumberedRow({ mergeSeq: 10, pullRequestNumber: 1234, mergeNumber: 1 });
    await repositoryRepo.blockAnnotation(pool, REPOSITORY_ID, '403 denied');

    await runAnnotationPass(depsFor(), {
      limit: 10,
      repositoryId: REPOSITORY_ID,
      blockedBefore: new Date(Date.now() + 60_000),
    });

    expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))?.annotate_blocked_at).toBeNull();
    expect(await stateOf(10)).toBe('done');
  });

  it('저장소 코드를 못 정하면 요청을 보내지 않는다 (OD-009)', async () => {
    mock = await startMockAnnotateGhe();
    // 숫자 구간이 없는 이름이다. `(owner, name)`이 유일하므로 다른 파일과 겹치지 않는 값을 쓴다.
    await seedRepository(OTHER_REPOSITORY_ID, 'wp-annotate-nodigits');
    await seedNumberedRow({
      repositoryId: OTHER_REPOSITORY_ID,
      mergeSeq: 10,
      pullRequestNumber: 1234,
      mergeNumber: 1,
    });

    const summary = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: OTHER_REPOSITORY_ID });

    expect(summary.results.code_unavailable).toBe(1);
    expect(mock.requests).toHaveLength(0);
    expect(await stateOf(10, OTHER_REPOSITORY_ID)).toBe('failed');
  });
});
