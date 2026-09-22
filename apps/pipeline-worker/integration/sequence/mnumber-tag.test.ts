/**
 * WP-100 FR-SEQ-012 — M 번호 lightweight 태그를 실제 PostgreSQL + 가짜 GHE(HTTP)로 잰다.
 *
 * 증명하는 것: (1) 생성은 `POST /git/refs` 하나이고 실제로 만든 경우에만 감사가 남는다,
 * (2) 같은 SHA면 쓰지 않는다(멱등), (3) 다른 SHA·annotated 태그는 **절대 옮기지 않고** 충돌로
 * 남긴다, (4) 권한·한도·미확정은 각각 차단·유예·`unknown` 뒤 재확인으로 끝난다, (5) 옛 에폭·
 * 다중 브랜치·해제 저장소는 만들지 않는다, (6) 잔여 스윕이 과거 채번분을 work로 되살린다,
 * (7) 대조는 누락만 다시 요청하고 불일치는 보고만 한다, (8) `sequence` 역할 러너는 `tag`를 집지 않는다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence/mnumber-tag`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobRepo, repositoryRepo, sequenceSpaceRepo, sequenceWorkRepo, type Pool } from '@prs/db';
import { WriteGate } from '@prs/github';
import { TagClient, resolveTagConfig } from '@prs/github-tag';
import { migratedPool } from '../../../../packages/db/integration/helpers.js';
import { generateTestKeyPair, startMockTagGhe, type MockTagGhe, type MockTagGheOptions } from '../../../../packages/github-tag/testing/mock-tag-ghe.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { materializeTag, runTagWorkOnce, sweepTagTargets, type TagDeps } from '../../src/mnumber-tag.js';
import { reconcileTags, runTagReconcileJob, TAG_RECONCILE_JOB } from '../../src/mnumber-tag-reconcile.js';
import { runSequenceWorkOnce } from '../../src/sequence-work-runner.js';

const KEYS = generateTestKeyPair();
const REPOSITORY_ID = 90_761;
const DUAL_ID = 90_762;
const OWNER = 'wp100org';
const NAME = 'smp1900';
const BRANCH = 'main';
const EPOCH = 3;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

let pool: Pool;
let mock: MockTagGhe | undefined;

async function seedRepository(id: number, name: string, branches: readonly string[] = [BRANCH]): Promise<void> {
  await repositoryRepo.upsertRepository(pool, { repository_id: id, owner: OWNER, name, org_id: 910, visibility: 'internal', sequence_branches: [...branches] });
  for (const branch of branches) {
    await sequenceSpaceRepo.ensureSequenceSpace(pool, id, branch);
    await pool.query('UPDATE sequence_space SET seq_epoch = $3 WHERE repository_id = $1 AND base_branch = $2', [id, branch, EPOCH]);
  }
}

async function seedNumberedRow(options: {
  repositoryId?: number;
  baseBranch?: string;
  mergeSeq: number;
  prNumber: number | null;
  mergeNumber: number | null;
  sha: string;
  epoch?: number;
  tagState?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO merge_sequence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at, merge_number, tag_state)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)`,
    [options.repositoryId ?? REPOSITORY_ID, options.baseBranch ?? BRANCH, options.epoch ?? EPOCH, options.mergeSeq, options.sha, options.prNumber, options.mergeNumber, options.tagState ?? null],
  );
}

async function tagRow(mergeSeq: number, repositoryId = REPOSITORY_ID, epoch = EPOCH): Promise<{ tag_state: string | null; tag_result_reason: string | null; tag_found_sha: string | null }> {
  const { rows } = await pool.query<{ tag_state: string | null; tag_result_reason: string | null; tag_found_sha: string | null }>(
    'SELECT tag_state, tag_result_reason, tag_found_sha FROM merge_sequence WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4',
    [repositoryId, BRANCH, epoch, mergeSeq],
  );
  return rows[0] ?? { tag_state: null, tag_result_reason: null, tag_found_sha: null };
}

async function requestTagWork(prNumber: number, epoch = EPOCH, repositoryId = REPOSITORY_ID) {
  return sequenceWorkRepo.requestWork(pool, { kind: 'tag', repositoryId, baseBranch: BRANCH, seqEpoch: epoch, keyExtra: [prNumber], payload: { pr_number: prNumber } });
}

async function audits(): Promise<{ action: string; target: string | null; result_code: string }[]> {
  const { rows } = await pool.query<{ action: string; target: string | null; result_code: string }>(
    `SELECT action, target, result_code FROM audit_record WHERE user_id = 'system:tag' ORDER BY occurred_at, audit_id`,
  );
  return rows;
}

async function startMock(options: MockTagGheOptions = {}): Promise<MockTagGhe> {
  mock = await startMockTagGhe(options);
  return mock;
}

function depsFor(ghe: MockTagGhe, extra: Record<string, string> = {}): TagDeps & { readonly metrics: ReturnType<typeof createWorkerMetrics> } {
  const config = resolveTagConfig({
    MNUMBER_TAG_ENABLED: 'true',
    GHE_API_URL: ghe.apiUrl,
    GHE_TAG_APP_ID: '99001',
    GHE_TAG_PRIVATE_KEY: KEYS.privateKey,
    GHE_TAG_INSTALLATIONS: `${OWNER}:5150`,
    GHE_TAG_REQUEST_TIMEOUT_MS: '1000',
    MNUMBER_TAG_BLOCK_COOLDOWN_MS: '60000',
    ...extra,
  });
  return {
    pool,
    config,
    metrics: createWorkerMetrics(),
    client: new TagClient({ config }),
    sleep: async () => {},
    log: () => {},
    gate: new WriteGate({ spacingMs: 1_000 }),
  };
}

const IDS = [REPOSITORY_ID, DUAL_ID];

beforeAll(async () => {
  pool = await migratedPool();
}, 180_000);

beforeEach(async () => {
  // `tag` work는 저장소가 아니라 kind로 claim된다 — 다른 파일(`mnumber.test.ts`)이 `ready`로 남긴 행이
  // 이 파일의 러너 시험에 섞이므로 kind 전체를 비운다(통합 시험 파일은 순차로 돈다).
  await pool.query(`DELETE FROM sequence_work WHERE kind = 'tag' OR repository_id = ANY($1::bigint[])`, [IDS]);
  await pool.query(`DELETE FROM job WHERE type = '${TAG_RECONCILE_JOB}'`);
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = ANY($1::bigint[])', [IDS]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1::bigint[])', [IDS]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [IDS]);
  await pool.query(`DELETE FROM audit_record WHERE user_id = 'system:tag'`);
  await seedRepository(REPOSITORY_ID, NAME);
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

afterAll(async () => {
  await pool?.query('DELETE FROM sequence_work WHERE repository_id = ANY($1::bigint[])', [IDS]);
  await pool?.query(`DELETE FROM job WHERE type = '${TAG_RECONCILE_JOB}'`);
  await pool?.query('DELETE FROM merge_sequence WHERE repository_id = ANY($1::bigint[])', [IDS]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1::bigint[])', [IDS]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [IDS]);
  await pool?.query(`DELETE FROM audit_record WHERE user_id = 'system:tag'`);
  await pool?.end();
});

describe('마이그레이션 035가 만든 열', () => {
  it('기존 저장소는 태그 허용이 기본이고 차단은 없다 (AC-9)', async () => {
    const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    expect(row?.tag_enabled).toBe(true);
    expect(row?.tag_blocked_at).toBeNull();
  });

  it('번호 없는 행에는 태그 상태를 둘 수 없다', async () => {
    await seedNumberedRow({ mergeSeq: 1, prNumber: null, mergeNumber: null, sha: SHA_A });
    await expect(pool.query(`UPDATE merge_sequence SET tag_state = 'done' WHERE repository_id = $1 AND merge_seq = 1`, [REPOSITORY_ID])).rejects.toThrow(/merge_sequence_tag_requires_number_chk/);
  });

  it('운영자 설정으로 끌 수 있고 차단은 설정과 별개다', async () => {
    const updated = await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { tag_enabled: false });
    expect(updated?.tag_enabled).toBe(false);
    expect(updated?.annotate_enabled).toBe(true);
    await repositoryRepo.blockTagging(pool, REPOSITORY_ID, '403 denied');
    const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    expect(row?.tag_blocked_reason).toBe('403 denied');
    expect(row?.tag_enabled).toBe(false);
    await repositoryRepo.clearTagBlock(pool, REPOSITORY_ID);
    expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))?.tag_blocked_at).toBeNull();
  });
});

describe('AC-1·AC-2·AC-6: 태그를 만들고 실제로 만든 경우에만 감사를 남긴다', () => {
  it('원격에 없으면 `POST /git/refs`에 `{ref, sha}`만 싣고 `created`로 남긴다', async () => {
    const ghe = await startMock({ knownShas: [SHA_A] });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const work = await requestTagWork(77);

    const outcome = await materializeTag(depsFor(ghe), work, { correlationId: '00000000-0000-4000-8000-000000000115' });

    expect(outcome.result).toBe('created');
    expect(ghe.refs().get('M-1900-1450')).toEqual({ sha: SHA_A, type: 'commit' });
    const post = ghe.requests.filter((one) => one.method === 'POST' && one.path.endsWith('/git/refs'));
    expect(post).toHaveLength(1);
    expect(JSON.parse(post[0]?.rawBody ?? '{}')).toEqual({ ref: 'refs/tags/M-1900-1450', sha: SHA_A });
    expect(await tagRow(5)).toMatchObject({ tag_state: 'done', tag_result_reason: 'created' });
    expect(await audits()).toEqual([{ action: 'merge_number.tag', target: `${OWNER}/${NAME}:refs/tags/M-1900-1450`, result_code: 'created' }]);
    expect(ghe.requests.filter((one) => one.method === 'PATCH' || one.method === 'DELETE')).toEqual([]);
  });

  it('**같은 SHA의 태그가 이미 있으면 쓰지 않고 감사도 남기지 않는다** (AC-3 멱등)', async () => {
    const ghe = await startMock({ initialRefs: { 'M-1900-1450': { sha: SHA_A, type: 'commit' } } });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A.toUpperCase() });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77));

    expect(outcome.result).toBe('already_done');
    expect(ghe.requests.filter((one) => one.method === 'POST' && one.path.endsWith('/git/refs'))).toEqual([]);
    expect(await tagRow(5)).toMatchObject({ tag_state: 'done', tag_result_reason: 'already_present' });
    expect(await audits()).toEqual([]);
  });

  it('저장소 코드를 정할 수 없으면 GHE를 부르지 않는다 (OD-009)', async () => {
    await seedRepository(DUAL_ID, 'payments');
    const ghe = await startMock();
    await seedNumberedRow({ repositoryId: DUAL_ID, mergeSeq: 5, prNumber: 77, mergeNumber: 1, sha: SHA_A });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77, EPOCH, DUAL_ID));
    expect(outcome.result).toBe('code_unavailable');
    expect(ghe.requests).toEqual([]);
    expect(await tagRow(5, DUAL_ID)).toMatchObject({ tag_state: 'failed', tag_result_reason: 'no_digits' });
  });
});

describe('AC-3·AC-8: 다른 것을 가리키는 태그는 절대 옮기지 않는다', () => {
  it('다른 SHA면 `conflict`로 남기고 아무 변경 요청도 보내지 않는다', async () => {
    const ghe = await startMock({ initialRefs: { 'M-1900-1450': { sha: SHA_B, type: 'commit' } }, knownShas: [SHA_A, SHA_B] });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const deps = depsFor(ghe);
    const outcome = await materializeTag(deps, await requestTagWork(77));

    expect(outcome.result).toBe('conflict');
    expect(ghe.refs().get('M-1900-1450')).toEqual({ sha: SHA_B, type: 'commit' });
    expect(ghe.requests.filter((one) => one.method !== 'GET' && !one.path.includes('/access_tokens'))).toEqual([]);
    expect(await tagRow(5)).toEqual({ tag_state: 'conflict', tag_result_reason: 'different_sha', tag_found_sha: SHA_B });
    expect(deps.metrics.render()).toMatch(/mnumber_tag_conflict_total\S* 1/);
    expect(await audits()).toEqual([]);
  });

  it('annotated 태그는 SHA가 무엇이든 충돌이다 — 남의 태그 객체를 덮지 않는다', async () => {
    const ghe = await startMock({ initialRefs: { 'M-1900-1450': { sha: SHA_C, type: 'tag' } } });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(outcome.result).toBe('conflict');
    expect(await tagRow(5)).toMatchObject({ tag_state: 'conflict', tag_result_reason: 'annotated_tag', tag_found_sha: SHA_C });
  });

  it('충돌로 남은 행은 다시 두드리지 않는다 — 대조가 다시 판정한다', async () => {
    const ghe = await startMock({ initialRefs: { 'M-1900-1450': { sha: SHA_B, type: 'commit' } } });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A, tagState: 'conflict' });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(outcome.result).toBe('conflict');
    expect(ghe.requests).toEqual([]);
  });

  it('**에폭이 올라 번호가 다른 커밋에 붙어도 기존 태그는 그대로다** — 새 번호는 충돌로 남는다 (AC-4)', async () => {
    const ghe = await startMock({ knownShas: [SHA_A, SHA_B] });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1, sha: SHA_A });
    expect((await materializeTag(depsFor(ghe), await requestTagWork(77))).result).toBe('created');

    // force-push: 에폭 4에서 같은 번호 1이 다른 커밋(B)·다른 PR(78)에 붙는다.
    await pool.query('UPDATE sequence_space SET seq_epoch = 4 WHERE repository_id = $1 AND base_branch = $2', [REPOSITORY_ID, BRANCH]);
    await seedNumberedRow({ mergeSeq: 5, prNumber: 78, mergeNumber: 1, sha: SHA_B, epoch: 4 });
    const stale = await materializeTag(depsFor(ghe), await requestTagWork(77, EPOCH));
    expect(stale.result).toBe('obsolete');
    const next = await materializeTag(depsFor(ghe), await requestTagWork(78, 4));
    expect(next.result).toBe('conflict');
    expect(ghe.refs().get('M-1900-1')).toEqual({ sha: SHA_A, type: 'commit' });
    expect(await tagRow(5, REPOSITORY_ID, 4)).toMatchObject({ tag_state: 'conflict', tag_found_sha: SHA_A });
  });

  it('**쓰기 직전에 정본을 다시 묻는다** — 조회와 쓰기 사이에 에폭이 오르면 만들지 않는다 (AC-4)', async () => {
    /*
     * `findTagTarget`은 통과했는데 원격 조회가 도는 동안 재채번이 에폭을 올린다. 태그는 되돌릴 수
     * 없으므로 무효가 된 번호를 내보내면 안 된다 — `POST` 직전의 `isTagTargetCurrent`가 그 창을 닫는다.
     * 목의 `onRequest`가 `GET ref` 시점에 정본을 바꾼다(await되므로 결정적이다).
     */
    const ghe = await startMock({
      knownShas: [SHA_A],
      onRequest: async (request) => {
        if (request.method === 'GET' && request.path.includes('/git/ref/tags/')) {
          await pool.query('UPDATE sequence_space SET seq_epoch = 4 WHERE repository_id = $1 AND base_branch = $2', [REPOSITORY_ID, BRANCH]);
        }
      },
    });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1, sha: SHA_A });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(outcome.result).toBe('superseded');
    expect(ghe.requests.filter((one) => one.method === 'POST' && one.path.endsWith('/git/refs'))).toHaveLength(0);
    expect(ghe.refs().has('M-1900-1')).toBe(false);
    expect(await tagRow(5)).toMatchObject({ tag_state: null });
    expect(await audits()).toEqual([]);
  });
});

describe('실패 경로 — 권한·한도·미확정·SHA 없음', () => {
  it('변경 요청의 403은 저장소를 차단하고 `failed(permission_blocked)`로 남긴다', async () => {
    const ghe = await startMock({ postScript: [{ status: 403, body: { message: 'Resource not accessible by integration' } }] });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(outcome.result).toBe('permission_blocked');
    expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))?.tag_blocked_reason).toContain('403');
    expect(await tagRow(5)).toMatchObject({ tag_state: 'failed', tag_result_reason: 'permission_blocked' });

    // 쿨다운 안에는 GHE를 부르지 않고 미룬다.
    const deferred = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(deferred.result).toBe('deferred');
    expect(deferred.retryAt).toBeInstanceOf(Date);
  });

  it('429는 게이트를 멈추고 `rate_limited`로 돌려준다 — 정본에 실패를 적지 않는다', async () => {
    const ghe = await startMock({ postScript: [{ status: 429, body: { message: 'rate' }, headers: { 'retry-after': '30' } }] });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const deps = depsFor(ghe);
    const outcome = await materializeTag(deps, await requestTagWork(77));
    expect(outcome.result).toBe('rate_limited');
    expect(outcome.retryAt).toBeInstanceOf(Date);
    expect(deps.gate?.pausedUntil()).toBeInstanceOf(Date);
    expect(await tagRow(5)).toMatchObject({ tag_state: null });
  });

  it('**시한 초과 뒤에는 같은 work 안에서 원격을 다시 읽는다** — 서버가 처리했으면 호출 없이 끝난다', async () => {
    /*
     * 첫 POST는 1.5초 뒤에야 답하므로 클라이언트(시한 1초)가 끊는다. 재시도는 요청이 아니라 판단
     * 전체를 다시 지나므로 두 번째 시도의 GET이 서버가 만든 ref를 보고 `already_done`으로 끝낸다 —
     * 목은 scripted 응답에서 ref를 만들지 않으므로 그 사실을 시험이 대신 만든다.
     */
    const ghe = await startMock({
      postScript: [{ status: 201, body: { ref: 'refs/tags/M-1900-1450', object: { type: 'commit', sha: SHA_A } }, delayMs: 1_500 }],
      onRequest: (request, control) => {
        if (request.method === 'POST' && request.path.endsWith('/git/refs')) control.setRef('M-1900-1450', { sha: SHA_A, type: 'commit' });
      },
    });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(outcome.result).toBe('already_done');
    expect(ghe.requests.filter((one) => one.method === 'POST' && one.path.endsWith('/git/refs'))).toHaveLength(1);
    expect(await tagRow(5)).toMatchObject({ tag_state: 'done', tag_result_reason: 'already_present' });
  }, 15_000);

  it('**시도를 다 써도 결과를 모르면 `unknown`으로 남고, 다음 work가 원격을 읽어 호출 없이 끝낸다**', async () => {
    const ghe = await startMock({ postScript: Array.from({ length: 5 }, () => ({ status: 502, body: { message: 'bad gateway' } })) });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const first = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(first.result).toBe('outcome_unknown');
    expect(await tagRow(5)).toMatchObject({ tag_state: 'unknown', tag_result_reason: 'outcome_unknown_server' });
    expect(await audits()).toEqual([]);

    // 게이트웨이 뒤에서 서버는 사실 처리했다.
    ghe.setRef('M-1900-1450', { sha: SHA_A, type: 'commit' });
    const second = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(second.result).toBe('observed_after_unknown');
    expect(ghe.requests.filter((one) => one.method === 'POST' && one.path.endsWith('/git/refs'))).toHaveLength(5);
    expect(await tagRow(5)).toMatchObject({ tag_state: 'done', tag_result_reason: 'observed_after_unknown' });
    expect(await audits()).toEqual([{ action: 'merge_number.tag', target: `${OWNER}/${NAME}:refs/tags/M-1900-1450`, result_code: 'observed' }]);
  }, 15_000);

  it('원격에 없는 SHA는 `unprocessable`이다 — 태그 이름을 다른 커밋에 붙이지 않는다', async () => {
    const ghe = await startMock({ knownShas: [SHA_B] });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77));
    expect(outcome.result).toBe('unprocessable');
    expect(ghe.refs().size).toBe(0);
    expect(await tagRow(5)).toMatchObject({ tag_state: 'failed', tag_result_reason: 'sha_not_in_remote' });
  });
});

describe('만들지 않는 경우 — 에폭·브랜치·해제', () => {
  it('옛 에폭의 work는 `obsolete`다', async () => {
    const ghe = await startMock();
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A, epoch: EPOCH - 1 });
    expect((await materializeTag(depsFor(ghe), await requestTagWork(77, EPOCH - 1))).result).toBe('obsolete');
    expect(ghe.requests).toEqual([]);
  });

  it('시퀀스 브랜치가 둘이면 만들지 않는다 — 태그 이름에 브랜치가 없다 (OD-015)', async () => {
    await seedRepository(DUAL_ID, 'dual1900', ['main', 'release']);
    const ghe = await startMock();
    await seedNumberedRow({ repositoryId: DUAL_ID, mergeSeq: 5, prNumber: 77, mergeNumber: 1, sha: SHA_A });
    const outcome = await materializeTag(depsFor(ghe), await requestTagWork(77, EPOCH, DUAL_ID));
    expect(outcome.result).toBe('multiple_sequence_branches');
    expect(ghe.requests).toEqual([]);
    expect(await tagRow(5, DUAL_ID)).toMatchObject({ tag_state: 'disabled', tag_result_reason: 'multiple_sequence_branches' });
  });

  it('운영자가 끈 저장소는 채번은 되어도 태그를 만들지 않는다 (AC-9)', async () => {
    await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { tag_enabled: false });
    const ghe = await startMock();
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    expect((await materializeTag(depsFor(ghe), await requestTagWork(77))).result).toBe('disabled');
    expect(ghe.requests).toEqual([]);
    expect(await tagRow(5)).toMatchObject({ tag_state: 'disabled', tag_result_reason: 'repository_tag_disabled' });
  });
});

describe('durable 러너와 잔여 스윕 (AC-2)', () => {
  it('러너가 `tag` work를 집어 끝내고, 결과에 따라 상태를 정한다', async () => {
    const ghe = await startMock({ knownShas: [SHA_A], postScript: [] });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const work = await requestTagWork(77);
    const round = await runTagWorkOnce(depsFor(ghe), { claimLimit: 8, leaseMs: 60_000 });
    expect(round.claimed).toBe(1);
    expect(round.outcomes).toEqual({ created: 1 });
    expect((await sequenceWorkRepo.findWork(pool, work.work_key))?.state).toBe('done');
  });

  it('권한 차단은 `parked`로, 미확정은 `retry`로 남긴다', async () => {
    const ghe = await startMock({
      postScript: [{ status: 403, body: { message: 'denied' } }],
    });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const work = await requestTagWork(77);
    await runTagWorkOnce(depsFor(ghe));
    expect((await sequenceWorkRepo.findWork(pool, work.work_key))).toMatchObject({ state: 'parked', last_reason: 'permission_blocked' });
  });

  it('**`sequence` 역할의 러너는 `tag`를 집지 않는다** — 쓰기 자격이 없는 프로세스다', async () => {
    await seedNumberedRow({ mergeSeq: 5, prNumber: 77, mergeNumber: 1450, sha: SHA_A });
    const work = await requestTagWork(77);
    // 러너는 저장소가 아니라 kind로 claim한다 — 다른 파일이 남긴 행을 먼저 치워 `claimed`가 이 work만 말하게 한다(파일은 순차로 돈다).
    await pool.query('DELETE FROM sequence_work WHERE work_key <> $1', [work.work_key]);
    const metrics = createWorkerMetrics();
    // M 기능이 꺼진 형상(`mnumber: null`)과 켜진 형상 둘 다 본다 — 러너의 kinds 목록이 둘이다.
    for (const mnumber of [null, {} as never]) {
      const round = await runSequenceWorkOnce({ pool, sequence: {} as never, mnumber, metrics });
      expect(round.claimed).toBe(0);
      // 잘못 집었다면 `case 'tag'`가 `not_this_role`로 돌려놓으며 사유 `tag_role_only`를 남긴다.
      expect(round.outcomes['not_this_role']).toBeUndefined();
    }
    const after = await sequenceWorkRepo.findWork(pool, work.work_key);
    expect(after?.state).toBe('ready');
    expect(after?.last_reason).not.toBe('tag_role_only');
    expect(after?.attempt_count).toBe(0);
  });

  it('잔여 스윕이 결과 없는 행·`failed`·`unknown`에만 work를 되살린다 — 과거 채번분의 backfill', async () => {
    const ghe = await startMock();
    await seedNumberedRow({ mergeSeq: 1, prNumber: 71, mergeNumber: 1, sha: SHA_A });
    await seedNumberedRow({ mergeSeq: 2, prNumber: 72, mergeNumber: 2, sha: SHA_B, tagState: 'done' });
    await seedNumberedRow({ mergeSeq: 3, prNumber: 73, mergeNumber: 3, sha: SHA_C, tagState: 'failed' });
    await seedNumberedRow({ mergeSeq: 4, prNumber: 74, mergeNumber: 4, sha: 'd'.repeat(40), tagState: 'conflict' });
    await seedNumberedRow({ mergeSeq: 5, prNumber: 75, mergeNumber: 5, sha: 'e'.repeat(40), tagState: 'unknown' });
    await seedNumberedRow({ mergeSeq: 6, prNumber: null, mergeNumber: null, sha: 'f'.repeat(40) });

    const requested = await sweepTagTargets(depsFor(ghe), { repositoryId: REPOSITORY_ID });

    expect(requested).toBe(3);
    const works = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH, ['tag']);
    expect(works.map((one) => (one.payload as { pr_number: number }).pr_number).sort((a, b) => a - b)).toEqual([71, 73, 75]);
    expect(works.every((one) => one.state === 'ready')).toBe(true);
  });

  it('차단된 저장소는 쿨다운 전에는 스윕이 건너뛰고 지난 뒤에는 되살린다', async () => {
    const ghe = await startMock();
    await seedNumberedRow({ mergeSeq: 1, prNumber: 71, mergeNumber: 1, sha: SHA_A });
    await repositoryRepo.blockTagging(pool, REPOSITORY_ID, '403 denied');
    expect(await sweepTagTargets(depsFor(ghe), { repositoryId: REPOSITORY_ID })).toBe(0);
    await pool.query(`UPDATE repository SET tag_blocked_at = now() - interval '2 days' WHERE repository_id = $1`, [REPOSITORY_ID]);
    expect(await sweepTagTargets(depsFor(ghe), { repositoryId: REPOSITORY_ID })).toBe(1);
  });
});

describe('AC-10: 정본 ↔ 원격 대조', () => {
  async function seedForReconcile(): Promise<MockTagGhe> {
    const ghe = await startMock({
      initialRefs: {
        'M-1900-1': { sha: SHA_A, type: 'commit' },
        'M-1900-3': { sha: 'd'.repeat(40), type: 'commit' },
        'M-1900-99': { sha: 'e'.repeat(40), type: 'commit' },
        'M-1901-2': { sha: SHA_B, type: 'commit' },
      },
      knownShas: [SHA_A, SHA_B, SHA_C],
    });
    await seedNumberedRow({ mergeSeq: 1, prNumber: 71, mergeNumber: 1, sha: SHA_A });
    await seedNumberedRow({ mergeSeq: 2, prNumber: 72, mergeNumber: 2, sha: SHA_B });
    await seedNumberedRow({ mergeSeq: 3, prNumber: 73, mergeNumber: 3, sha: SHA_C });
    return ghe;
  }

  it('dry-run은 원격을 읽기만 하고 정본·작업 큐에 아무것도 쓰지 않는다', async () => {
    const ghe = await seedForReconcile();
    const repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;
    const outcome = await reconcileTags({ pool, client: depsFor(ghe).client }, { repository, baseBranch: BRANCH }, { dryRun: true });

    expect(outcome.kind).toBe('summary');
    if (outcome.kind !== 'summary') return;
    expect(outcome.summary).toMatchObject({ code: '1900', db_numbered: 3, remote_refs: 3, ok: 1, missing: 1, enqueued: 0, conflict: 1, unexpected: 1, dry_run: true });
    expect(outcome.summary.examples).toEqual({ missing: ['M-1900-2'], conflict: [{ tag: 'M-1900-3', expected: SHA_C, found: 'd'.repeat(40), type: 'commit' }], unexpected: ['M-1900-99'] });
    expect(await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH, ['tag'])).toEqual([]);
    expect(await tagRow(3)).toMatchObject({ tag_state: null });
    expect(ghe.requests.filter((one) => one.method !== 'GET' && !one.path.includes('/access_tokens'))).toEqual([]);
  });

  it('실제 대조는 누락만 work로 되살리고 불일치는 기록·보고만 한다 — 태그를 옮기지 않는다', async () => {
    const ghe = await seedForReconcile();
    const repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;
    const outcome = await reconcileTags({ pool, client: depsFor(ghe).client }, { repository, baseBranch: BRANCH }, { dryRun: false });

    expect(outcome.kind).toBe('summary');
    if (outcome.kind !== 'summary') return;
    expect(outcome.summary).toMatchObject({ missing: 1, enqueued: 1, conflict: 1, ok: 1 });
    const works = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH, ['tag']);
    expect(works.map((one) => (one.payload as { pr_number: number }).pr_number)).toEqual([72]);
    expect(await tagRow(1)).toMatchObject({ tag_state: 'done', tag_result_reason: 'reconciled' });
    expect(await tagRow(3)).toMatchObject({ tag_state: 'conflict', tag_found_sha: 'd'.repeat(40) });
    expect(ghe.refs().get('M-1900-3')).toEqual({ sha: 'd'.repeat(40), type: 'commit' });
    expect(ghe.requests.filter((one) => one.method === 'PATCH' || one.method === 'DELETE' || (one.method === 'POST' && one.path.endsWith('/git/refs')))).toEqual([]);

    // 되살린 work를 러너가 실제로 만든다.
    const round = await runTagWorkOnce(depsFor(ghe));
    expect(round.outcomes).toEqual({ created: 1 });
    expect(ghe.refs().get('M-1900-2')).toEqual({ sha: SHA_B, type: 'commit' });
  });

  it('잡 러너가 요약을 잡 진행률에 남기고 `completed`로 끝낸다 — 충돌은 실패가 아니라 보고다', async () => {
    const ghe = await seedForReconcile();
    const jobId = await jobRepo.enqueueJob(pool, TAG_RECONCILE_JOB, `${OWNER}/${NAME}@${BRANCH}`, 'prsctl:tester', { repository_id: REPOSITORY_ID, base_branch: BRANCH });
    const job = await jobRepo.claimNextJob(pool, TAG_RECONCILE_JOB, 1);
    expect(job?.job_id).toBe(jobId);
    const result = await runTagReconcileJob({ pool, client: depsFor(ghe).client, log: () => {} }, job!);
    expect(result).toBe('completed');
    const row = await jobRepo.findJobById(pool, jobId);
    expect(row?.state).toBe('completed');
    expect(row?.progress).toMatchObject({ ok: 1, missing: 1, enqueued: 1, conflict: 1, unexpected: 1 });
  });

  it('**사람이 GHE에서 지운 뒤에는 대조가 `conflict` 행을 다시 열어 재생성한다** — 정정 절차의 마지막 단계 (RUNBOOK 7.F)', async () => {
    // 원격에는 M-1900-2가 없고 정본은 `conflict`로 남아 있다(앞선 회차가 다른 SHA를 봤고 사람이 그 태그를 지웠다).
    const ghe = await startMock({ initialRefs: { 'M-1900-1': { sha: SHA_A, type: 'commit' } }, knownShas: [SHA_A, SHA_B] });
    await seedNumberedRow({ mergeSeq: 1, prNumber: 71, mergeNumber: 1, sha: SHA_A, tagState: 'done' });
    await seedNumberedRow({ mergeSeq: 2, prNumber: 72, mergeNumber: 2, sha: SHA_B, tagState: 'conflict' });

    // work를 되살리는 것만으로는 만들지 않는다 — 실행자는 `conflict` 행을 원격 조회 없이 건너뛴다.
    const work = await requestTagWork(72);
    expect((await materializeTag(depsFor(ghe), work)).result).toBe('conflict');
    expect(ghe.refs().has('M-1900-2')).toBe(false);

    const repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;
    const outcome = await reconcileTags({ pool, client: depsFor(ghe).client }, { repository, baseBranch: BRANCH }, { dryRun: false });
    expect(outcome.kind).toBe('summary');
    if (outcome.kind !== 'summary') return;
    expect(outcome.summary).toMatchObject({ ok: 1, missing: 1, enqueued: 1, reopened: 1, conflict: 0, unblocked: false });
    expect(await tagRow(2)).toMatchObject({ tag_state: null, tag_result_reason: 'reconcile_missing', tag_found_sha: null });

    const round = await runTagWorkOnce(depsFor(ghe));
    expect(round.outcomes).toEqual({ created: 1 });
    expect(ghe.refs().get('M-1900-2')).toEqual({ sha: SHA_B, type: 'commit' });
    expect(await tagRow(2)).toMatchObject({ tag_state: 'done', tag_result_reason: 'created' });
  });

  it('**운영자의 대조 실행은 권한 차단을 푼다** — 조회 성공이 아니라 명시적 재개이며, dry-run은 풀지 않는다', async () => {
    const ghe = await startMock({ knownShas: [SHA_A] });
    await seedNumberedRow({ mergeSeq: 1, prNumber: 71, mergeNumber: 1, sha: SHA_A, tagState: 'failed' });
    await pool.query(`UPDATE repository SET tag_blocked_at = now(), tag_blocked_reason = '403 forbidden' WHERE repository_id = $1`, [REPOSITORY_ID]);
    // 차단 중에는 실행자가 쿨다운까지 미룬다.
    expect((await materializeTag(depsFor(ghe), await requestTagWork(71))).result).toBe('deferred');

    const repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;
    const dry = await reconcileTags({ pool, client: depsFor(ghe).client }, { repository, baseBranch: BRANCH }, { dryRun: true });
    expect(dry).toMatchObject({ kind: 'summary', summary: { missing: 1, enqueued: 0, unblocked: false } });
    expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!.tag_blocked_at).not.toBeNull();

    const outcome = await reconcileTags({ pool, client: depsFor(ghe).client }, { repository, baseBranch: BRANCH }, { dryRun: false });
    expect(outcome).toMatchObject({ kind: 'summary', summary: { missing: 1, enqueued: 1, unblocked: true, reopened: 0 } });
    expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!.tag_blocked_at).toBeNull();
    const round = await runTagWorkOnce(depsFor(ghe));
    expect(round.outcomes).toEqual({ created: 1 });
    expect(ghe.refs().get('M-1900-1')).toEqual({ sha: SHA_A, type: 'commit' });
  });

  it('시퀀스 브랜치가 둘인 저장소는 대조하지 않는다 (OD-015)', async () => {
    await seedRepository(DUAL_ID, 'dual1900', ['main', 'release']);
    const ghe = await startMock();
    const repository = (await repositoryRepo.findRepositoryById(pool, DUAL_ID))!;
    const outcome = await reconcileTags({ pool, client: depsFor(ghe).client }, { repository, baseBranch: BRANCH }, { dryRun: true });
    expect(outcome).toMatchObject({ kind: 'error', reason: expect.stringContaining('multiple_sequence_branches') });
    expect(ghe.requests).toEqual([]);
  });
});
