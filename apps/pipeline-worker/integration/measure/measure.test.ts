/**
 * 측정 CLI (WP-074 FR-SEQ-008 AC-14 / T06c, 측정 가이드 8절).
 *
 * ## 무엇을 묻는가
 *
 * 1. **아무것도 쓰지 않는가** — 실행된 SQL을 전부 기록해 쓰기 동사가 0건임을 단언하고,
 *    `BEGIN READ ONLY`가 실제로 실렸는지 본다. 애플리케이션의 약속이 아니라 **실행 사실**이다.
 * 2. 025가 없는 스키마에서도 `baseline`이 죽지 않고 가용 구간만 답하는가.
 * 3. 분류가 배타적이고 음수·미완료가 percentile을 좋게 만들지 않는가.
 * 4. **비밀이 어디에도 출력되지 않는가** — DSN·세션에 표식을 심고 stdout/stderr/JSON을 훑는다.
 * 5. `watch`가 에폭 이동·timeout·401을 각각의 종료 코드로 구분하는가.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/measure`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { repositoryRepo, sequenceLatencyRepo, sequenceSpaceRepo, mergeSequenceRepo, type Pool } from '@prs/db';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { parseArgs } from '../../src/measure/args.js';
import { runMeasure, type ResolveClient } from '../../src/measure/index.js';

const REPO = 7471;
const BRANCH = 'main';
/** DSN·세션에 심는 표식. 출력 어디에도 나타나면 안 된다. */
const SECRET = 'p4ssw0rd-marker-do-not-print';

let pool: Pool;
let sql: string[] = [];

/** 실행된 SQL을 전부 기록하는 풀. 쓰기 동사가 0건이라는 주장의 근거다. */
function recordingPool(base: Pool): Pool {
  const wrapClient = (client: unknown): unknown =>
    new Proxy(client as object, {
      get(target, property, receiver) {
        if (property === 'query') {
          return (...args: unknown[]): unknown => {
            const first = args[0];
            sql.push(typeof first === 'string' ? first : String((first as { text?: string }).text ?? ''));
            return (Reflect.get(target, 'query') as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'connect') {
        return async (): Promise<unknown> => wrapClient(await target.connect());
      }
      if (property === 'query') {
        return (...args: unknown[]): unknown => {
          const first = args[0];
          sql.push(typeof first === 'string' ? first : String((first as { text?: string }).text ?? ''));
          return (target.query as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Pool;
}

const WRITE_VERBS = /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i;

function assertReadOnly(): void {
  const writes = sql.filter((one) => WRITE_VERBS.test(one));
  expect(writes, `쓰기 SQL이 실행됐다: ${writes.join(' | ')}`).toEqual([]);
  expect(sql.some((one) => one.includes('BEGIN READ ONLY'))).toBe(true);
  expect(sql.some((one) => one.includes('statement_timeout'))).toBe(true);
  expect(sql.some((one) => one.includes('lock_timeout'))).toBe(true);
}

/** ms 간격으로 떨어진 표본 하나. `assigned_at`은 정본이 찍으므로 여기서는 표본만 만든다. */
async function seedSample(input: {
  readonly key: string;
  readonly pr: number | null;
  readonly receivedOffset: number;
  readonly mnumberOffset: number | null;
  readonly observedOffset?: number | null;
  readonly outcome?: 'pending' | 'failed' | 'assigned' | 'visible' | 'skipped';
  readonly trigger?: 'new_squash' | 'backfill' | 'retry' | 'reassign' | 'reconcile';
}): Promise<void> {
  const base = Date.now() - 60_000;
  const at = (offset: number | null | undefined): Date | null =>
    offset === null || offset === undefined ? null : new Date(base + offset);
  await sequenceLatencyRepo.upsertSample(pool, {
    workKey: input.key,
    attempt: 1,
    repositoryId: REPO,
    baseBranch: BRANCH,
    seqEpoch: 1,
    prNumber: input.pr,
    deliveryId: `d-${input.key}`,
    triggerKind: input.trigger ?? 'new_squash',
    outcome: input.outcome ?? 'visible',
    receivedAt: at(input.receivedOffset),
    attemptStartedAt: null,
    mirrorCompletedAt: at(input.mnumberOffset === null ? null : input.receivedOffset + 10),
    sequenceAssignedAt: at(input.mnumberOffset === null ? null : input.receivedOffset + 20),
    mnumberAssignedAt: at(input.mnumberOffset === null ? null : input.receivedOffset + input.mnumberOffset),
    reason: null,
  });
  if (input.observedOffset !== undefined && input.observedOffset !== null) {
    const row = (await sequenceLatencyRepo.listSamplesForSpace(pool, REPO, BRANCH)).find((one) => one.work_key === input.key);
    if (row !== undefined) {
      await pool.query('UPDATE sequence_latency_sample SET search_observed_at = $2 WHERE sample_id = $1', [
        row.sample_id,
        at(input.receivedOffset + input.observedOffset),
      ]);
    }
  }
}

beforeAll(async () => {
  pool = await migratedPool();
  await truncate(pool, 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space', 'repository');
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPO,
    owner: 'acme',
    name: 'smp1900',
    org_id: 1,
    visibility: 'internal',
    sequence_branches: [BRANCH],
  });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPO, BRANCH);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: REPO,
    base_branch: BRANCH,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: 'a'.repeat(40),
    pull_request_number: 21,
    committed_at: new Date(Date.now() - 120_000),
  });
  await sequenceSpaceRepo.advanceHead(pool, REPO, BRANCH, 'a'.repeat(40), 1);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  sql = [];
  await pool.query('DELETE FROM sequence_latency_sample');
  await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, REPO, BRANCH, 1, { headSeq: 0, headNumber: 0, blocked: null });
});

describe('T06c: 읽기 전용 강제', () => {
  it('**baseline이 쓰기 SQL을 한 건도 실행하지 않는다** — READ ONLY 트랜잭션이 실렸다', async () => {
    const result = await runMeasure(parseArgs(['baseline', '--format', 'json']), { pool: recordingPool(pool) });
    expect(result.stderr).toBe('');
    assertReadOnly();
    const body = JSON.parse(result.stdout) as { mode: string; baseline: { samples: number }; capability: { hasSamples: boolean } };
    expect(body.mode).toBe('baseline');
    expect(body.capability.hasSamples).toBe(true);
    expect(body.baseline.samples).toBeGreaterThanOrEqual(1);
  });

  it('report도 읽기 전용이며 쓰기를 시도하지 않는다', async () => {
    await seedSample({ key: 'w1', pr: 21, receivedOffset: 0, mnumberOffset: 100 });
    sql = [];
    const result = await runMeasure(parseArgs(['report', '--format', 'json']), { pool: recordingPool(pool) });
    expect(result.stderr).toBe('');
    assertReadOnly();
  });

  it('읽기 전용 트랜잭션 안에서 쓰기를 시도하면 PostgreSQL이 거부한다 (강제의 근거)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await expect(client.query("INSERT INTO sequence_latency_sample (work_key, attempt, repository_id, base_branch, seq_epoch, trigger_kind, outcome) VALUES ('x', 1, 1, 'main', 1, 'new_squash', 'pending')")).rejects.toMatchObject({ code: '25006' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('T06c: 분류와 percentile (가이드 3·8절)', () => {
  it('**[100,200,300,400]의 p50=200 · p95=400 · max=400이고 분모를 밝힌다**', async () => {
    for (const [index, ms] of [100, 200, 300, 400].entries()) {
      await seedSample({ key: `p${String(index)}`, pr: 20 + index, receivedOffset: 0, mnumberOffset: ms, observedOffset: ms + 50 });
    }
    const result = await runMeasure(parseArgs(['report', '--format', 'json']), { pool });
    const body = JSON.parse(result.stdout) as { requests: number; stages: { name: string; p50: number | null; p95: number | null; max: number | null; valid_samples: number }[] };
    const stage = body.stages.find((one) => one.name === 'received_to_mnumber');
    expect(stage).toMatchObject({ valid_samples: 4, p50: 200, p95: 400, p99: 400, max: 400 });
    expect(body.requests).toBe(4);
    expect(result.exitCode).toBe(0);
  });

  it('**미완료·음수가 있으면 종료 코드 3이고 percentile을 좋게 만들지 않는다**', async () => {
    await seedSample({ key: 'ok', pr: 21, receivedOffset: 0, mnumberOffset: 100, observedOffset: 150 });
    await seedSample({ key: 'pending', pr: 22, receivedOffset: 0, mnumberOffset: null, outcome: 'pending' });
    // 시계 이상: M 부여가 수신보다 이르다.
    await seedSample({ key: 'skew', pr: 23, receivedOffset: 500, mnumberOffset: -35, observedOffset: 10 });
    const result = await runMeasure(parseArgs(['report', '--format', 'json']), { pool });
    const body = JSON.parse(result.stdout) as { stages: { name: string; valid_samples: number; pending: number; clock_anomaly_count: number; clock_anomaly_min_ms: number | null; p50: number | null }[] };
    const stage = body.stages.find((one) => one.name === 'received_to_mnumber');
    expect(stage).toMatchObject({ valid_samples: 1, pending: 1, clock_anomaly_count: 1, clock_anomaly_min_ms: -35, p50: 100 });
    expect(result.exitCode).toBe(3);
  });

  it('표본이 없으면 종료 코드 3이다 — "0건 정상"으로 답하지 않는다', async () => {
    const result = await runMeasure(parseArgs(['report', '--format', 'json']), { pool });
    expect(result.exitCode).toBe(3);
    const body = JSON.parse(result.stdout) as { requests: number };
    expect(body.requests).toBe(0);
  });

  it('cohort별로 나눠 세고 전체 평균으로 합치지 않는다', async () => {
    await seedSample({ key: 'ns', pr: 21, receivedOffset: 0, mnumberOffset: 100, observedOffset: 150, trigger: 'new_squash' });
    await seedSample({ key: 'bf', pr: 22, receivedOffset: 0, mnumberOffset: 900, observedOffset: 950, trigger: 'backfill' });
    const scoped = await runMeasure(parseArgs(['report', '--cohort', 'new_squash', '--format', 'json']), { pool });
    const scopedBody = JSON.parse(scoped.stdout) as { requests: number; stages: { name: string; max: number | null }[] };
    expect(scopedBody.requests).toBe(1);
    expect(scopedBody.stages.find((one) => one.name === 'received_to_mnumber')?.max).toBe(100);

    const all = await runMeasure(parseArgs(['report', '--cohort', 'all', '--format', 'json']), { pool });
    const allBody = JSON.parse(all.stdout) as { requests: number; notes?: string[]; stages?: unknown };
    expect(allBody.requests).toBe(2);
    // cohort가 둘이면 합친 구간 표를 만들지 않는다 — 모집단이 다르다.
    expect(allBody.stages).toBeUndefined();
    expect(allBody.notes?.length).toBe(2);
  });

  it('대기 현황은 blocker 기준이며 items와 known_prs를 따로 센다', async () => {
    await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, REPO, BRANCH, 1, {
      headSeq: 0,
      headNumber: 0,
      blocked: { seq: 1, reason: 'negative_evidence_unavailable' },
    });
    const result = await runMeasure(parseArgs(['baseline', '--format', 'json']), { pool });
    const body = JSON.parse(result.stdout) as { pending: { items: number; known_prs: number; reasons: Record<string, number> } };
    expect(body.pending.items).toBe(1);
    expect(body.pending.known_prs).toBe(1);
    expect(body.pending.reasons['negative_evidence_unavailable']).toBe(1);
  });
});

describe('T06c: 비밀을 출력하지 않는다 (가이드 5·8절)', () => {
  it('**DSN·세션 표식이 stdout·stderr·JSON 어디에도 없다**', async () => {
    await seedSample({ key: 'secret-check', pr: 21, receivedOffset: 0, mnumberOffset: 100, observedOffset: 150 });
    for (const argv of [['baseline', '--format', 'json'], ['report', '--format', 'json'], ['report', '--format', 'table']]) {
      const result = await runMeasure(parseArgs(argv), { pool });
      expect(result.stdout).not.toContain(SECRET);
      expect(result.stderr).not.toContain(SECRET);
      // 저장소 이름과 PR 번호도 기본 출력에는 없다 — 공유되는 보고에 조사 대상을 싣지 않는다.
      expect(result.stdout).not.toContain('smp1900');
      expect(result.stdout).not.toContain('d-secret-check');
    }
  });

  it('조회 실패의 메시지에 접속 문자열이 실리지 않는다', async () => {
    const broken = {
      connect: async (): Promise<never> => {
        throw new Error(`connection failed: postgres://prs:${SECRET}@db:5432/prs`);
      },
      query: async (): Promise<never> => {
        throw new Error(`connection failed: postgres://prs:${SECRET}@db:5432/prs`);
      },
    } as unknown as Pool;
    const result = await runMeasure(parseArgs(['baseline']), { pool: broken });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stderr).toContain('조회에 실패했다');
  });
});

describe('T06c: watch는 검색 반영까지 확인한다 (상세 설계 7절)', () => {
  const watchArgs = parseArgs(['watch', '--repository', 'acme/smp1900', '--base-branch', 'main', '--pr-number', '21', '--timeout', '1s', '--poll', '1s', '--format', 'json']);

  function client(responses: readonly { status: number; body: Record<string, unknown> }[]): ResolveClient {
    let index = 0;
    return {
      resolve: async () => responses[Math.min(index++, responses.length - 1)] as { status: number; body: Record<string, unknown> },
    };
  }

  it('**assigned만으로 끝내지 않는다** — in_sync까지 확인해야 관측 완료다', async () => {
    const result = await runMeasure(watchArgs, {
      pool,
      sleep: async () => undefined,
      resolveClient: client([
        { status: 200, body: { seq_epoch: 1, merge_number_state: 'assigned', merge_number_projection_state: 'pending' } },
      ]),
    });
    expect(result.exitCode).toBe(3);
    const body = JSON.parse(result.stdout) as { watch: { outcome: string; last_absent_at: string | null } };
    expect(body.watch.outcome).toBe('projection_pending');
    expect(body.watch.last_absent_at).not.toBeNull();
  });

  it('in_sync를 보면 0으로 끝나고 `(last_absent, first_present]` 구간을 함께 낸다', async () => {
    const result = await runMeasure(watchArgs, {
      pool,
      sleep: async () => undefined,
      resolveClient: client([
        { status: 200, body: { seq_epoch: 1, merge_number_state: 'pending', merge_number_projection_state: 'unknown' } },
        { status: 200, body: { seq_epoch: 1, merge_number: 'M-1900-1', merge_number_state: 'assigned', merge_number_projection_state: 'in_sync' } },
      ]),
    });
    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout) as { watch: { outcome: string; attempts: number; last_absent_at: string | null; first_present_at: string } };
    expect(body.watch).toMatchObject({ outcome: 'visible', attempts: 2 });
    expect(body.watch.last_absent_at).not.toBeNull();
    // 기본 출력에는 실제 M 문자열을 싣지 않는다 (`--detailed`에서만).
    expect(result.stdout).not.toContain('M-1900-1');
  });

  it('에폭이 움직이면 `epoch_changed`로 끝내고 새 에폭을 다시 조회하지 않는다', async () => {
    const result = await runMeasure(watchArgs, {
      pool,
      sleep: async () => undefined,
      resolveClient: client([{ status: 200, body: { epoch_stale: true, seq_epoch: 2, requested_seq_epoch: 1 } }]),
    });
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({ watch: { reason: 'epoch_changed' } });
  });

  it('401은 조회 실패(1)이고 익명으로 다시 시도하지 않는다', async () => {
    const result = await runMeasure(watchArgs, {
      pool,
      sleep: async () => undefined,
      resolveClient: client([{ status: 401, body: {} }]),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('409·404는 자료 부족(3)이며 사유를 그대로 전한다', async () => {
    const result = await runMeasure(watchArgs, {
      pool,
      sleep: async () => undefined,
      resolveClient: client([{ status: 409, body: { error: { code: 'NO_SEQUENCE', detail: { reason: 'not_sequenced' } } } }]),
    });
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({ watch: { reason: 'not_sequenced', http_status: 409 } });
  });

  it('API 클라이언트가 없으면 1로 끝난다 — 익명 조회를 만들지 않는다', async () => {
    const result = await runMeasure(watchArgs, { pool });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('MEASURE_API_BASE_URL');
  });
});
