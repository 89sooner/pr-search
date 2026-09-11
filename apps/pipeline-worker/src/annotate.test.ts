/**
 * 표기 워커의 판정과 순서 (JOB-SEQ-005 / WP-075).
 *
 * **클라이언트를 대역으로 바꾸지 않는다.** 진짜 `AnnotateClient`가 진짜 로컬 HTTP
 * 서버를 부르므로, "GHE를 호출하지 않는다"를 요청 기록으로 직접 잴 수 있다 —
 * 함수 호출 횟수를 세는 대역이었다면 전송 계층이 통째로 빠진 채 통과한다
 * (WP-074가 대역 때문에 아무것도 증명하지 못한 시험을 넷 겪었다).
 *
 * PostgreSQL만 기록용 대역이다. 실제 SQL은 통합 시험이 잰다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnotateClient, resolveAnnotateConfig, type AnnotateConfig } from '@prs/github-annotate';
import {
  generateTestKeyPair,
  startMockAnnotateGhe,
  type MockAnnotateGhe,
  type ScriptedResponse,
} from '../../../packages/github-annotate/testing/mock-annotate-ghe.js';

import { annotateOne, handleMergeNumberAssigned, runAnnotationPass, type AnnotateDeps } from './annotate.js';
import { createWorkerMetrics } from './metrics.js';

const KEYS = generateTestKeyPair();

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface FakePool {
  readonly queries: RecordedQuery[];
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
}

interface TargetRow {
  repository_id: number;
  owner: string;
  name: string;
  base_branch: string;
  seq_epoch: number;
  merge_seq: number;
  pull_request_number: number;
  merge_number: number;
  annotate_state: 'failed' | 'disabled' | null;
}

function target(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    repository_id: 4021,
    owner: 'acme',
    name: 'smp1900',
    base_branch: 'main',
    seq_epoch: 3,
    merge_seq: 77,
    pull_request_number: 1234,
    merge_number: 1,
    annotate_state: null,
    ...overrides,
  };
}

/** SQL 문장으로 갈라 답한다. 통합 시험이 같은 문장을 실제 PostgreSQL에 건다. */
function fakePool(options: { targets?: readonly TargetRow[]; epoch?: number } = {}): FakePool {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes('FROM merge_sequence ms')) {
        return { rows: [...(options.targets ?? [])], rowCount: options.targets?.length ?? 0 };
      }
      if (text.includes('FROM sequence_space')) {
        return {
          rows: [{ repository_id: 4021, base_branch: 'main', seq_epoch: options.epoch ?? 3 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

function configFor(apiUrl: string, overrides: Record<string, string> = {}): AnnotateConfig {
  return resolveAnnotateConfig({
    MNUMBER_ANNOTATE_ENABLED: 'true',
    GHE_API_URL: apiUrl,
    GHE_ANNOTATE_APP_ID: '77001',
    GHE_ANNOTATE_PRIVATE_KEY: KEYS.privateKey,
    GHE_ANNOTATE_INSTALLATIONS: 'acme:5150',
    GHE_ANNOTATE_REQUEST_TIMEOUT_MS: '2000',
    ...overrides,
  });
}

let mock: MockAnnotateGhe | undefined;

function depsFor(pool: FakePool, options: { patchScript?: readonly ScriptedResponse[] } = {}): AnnotateDeps {
  const config = configFor((mock as MockAnnotateGhe).apiUrl);
  return {
    pool: pool as never,
    bus: undefined as never,
    config,
    metrics: createWorkerMetrics(),
    // 재시도 대기를 건너뛴다. 백오프 자체는 호출 횟수로 검증한다.
    sleep: async () => {},
    log: () => {},
    client: new AnnotateClient({ config }),
    ...options,
  };
}

function patches(): readonly { path: string; rawBody: string }[] {
  return (mock?.requests ?? []).filter((entry) => entry.method === 'PATCH');
}

afterEach(async () => {
  await mock?.close();
  mock = undefined;
  vi.restoreAllMocks();
});

describe('annotateOne — 한 행의 판정 (FR-SEQ-009)', () => {
  it('접두가 없으면 붙이고 done으로 남긴다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: 'Fix device initialization race' });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), '11111111-1111-4111-8111-111111111111');

    expect(result).toBe('updated');
    expect(mock.currentTitle()).toBe('[M-1900-1] Fix device initialization race');
    const states = pool.queries.filter((q) => q.text.includes('SET annotate_state'));
    expect(states).toHaveLength(1);
    expect(states[0]?.values[4]).toBe('done');
  });

  it('같은 접두가 이미 있으면 PATCH하지 않는다 (멱등)', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '[M-1900-1] Fix device initialization race' });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('already_done');
    expect(patches()).toHaveLength(0);
    expect(pool.queries.some((q) => q.text.includes('SET annotate_state') && q.values[4] === 'done')).toBe(true);
  });

  it('다른 M 넘버 접두는 덮지 않고 mismatch로 남긴다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '[M-1900-77] Fix device initialization race' });
    const pool = fakePool();
    const deps = depsFor(pool);
    const result = await annotateOne(deps, target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('mismatch');
    expect(patches()).toHaveLength(0);
    expect(mock.currentTitle()).toBe('[M-1900-77] Fix device initialization race');
    expect(deps.metrics.mnumberAnnotateMismatchTotal.render()).toContain('mnumber_annotate_mismatch_total 1');
  });

  it('저장소 코드를 못 정하면 요청을 한 번도 보내지 않는다', async () => {
    mock = await startMockAnnotateGhe();
    const pool = fakePool();
    const result = await annotateOne(
      depsFor(pool),
      target({ name: 'payments' }),
      'c0ffee00-0000-4000-8000-000000000000',
    );

    expect(result).toBe('code_unavailable');
    expect(mock.requests).toHaveLength(0);
    expect(pool.queries.some((q) => q.text.includes('SET annotate_state') && q.values[4] === 'failed')).toBe(true);
  });

  it('사용자가 그 사이 제목을 고쳤으면 새 제목을 보존한다', async () => {
    // 이벤트가 만들어질 때의 제목이 아니라 **지금** 제목에 붙는다.
    mock = await startMockAnnotateGhe({ initialTitle: 'New title after user edit' });
    await annotateOne(depsFor(fakePool()), target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(mock.currentTitle()).toBe('[M-1900-1] New title after user edit');
  });

  it('PATCH 성공 뒤 정본 갱신 전에 죽어도 접두가 두 번 붙지 않는다', async () => {
    /*
     * §14의 crash 시나리오를 그대로 만든다. 첫 회차는 PATCH까지 성공시키고 정본
     * 갱신에서 던져 죽은 것으로 만든 뒤, 같은 행을 다시 처리한다.
     */
    mock = await startMockAnnotateGhe({ initialTitle: 'Fix device initialization race' });
    const crashing = fakePool();
    const original = crashing.query;
    crashing.query = async (text, values) => {
      if (text.includes('SET annotate_state')) throw new Error('process died before commit');
      return original(text, values);
    };
    const deps = depsFor(crashing);
    await expect(annotateOne(deps, target(), 'c0ffee00-0000-4000-8000-000000000000')).rejects.toThrow();
    expect(mock.currentTitle()).toBe('[M-1900-1] Fix device initialization race');
    expect(patches()).toHaveLength(1);

    // 재전달. 제목을 다시 읽고 이미 붙은 것을 본다.
    const healthy = fakePool();
    const result = await annotateOne(depsFor(healthy), target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(result).toBe('already_done');
    expect(patches()).toHaveLength(1);
    expect(mock.currentTitle()).toBe('[M-1900-1] Fix device initialization race');
  });

  it('권한 오류면 저장소를 차단하고 운영자 설정은 건드리지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      getScript: [{ status: 403, body: { message: 'Resource not accessible by integration' } }],
    });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('permission_blocked');
    const blocked = pool.queries.filter((q) => q.text.includes('annotate_blocked_at = now()'));
    expect(blocked).toHaveLength(1);
    // 운영자의 `annotate_enabled`를 바꾸는 문장은 하나도 없어야 한다.
    expect(pool.queries.some((q) => q.text.includes('SET annotate_enabled'))).toBe(false);
    expect(pool.queries.some((q) => q.text.includes('annotate_enabled  ='))).toBe(false);
  });

  it('권한 오류는 재시도하지 않는다 — 한도를 태우지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      getScript: Array.from({ length: 6 }, () => ({ status: 404, body: { message: 'Not Found' } })),
    });
    await annotateOne(depsFor(fakePool()), target(), 'c0ffee00-0000-4000-8000-000000000000');
    // 토큰 발급 요청을 빼면 PR 경로 요청은 한 번뿐이다.
    expect(mock.requests.filter((entry) => entry.path.includes('/pulls/'))).toHaveLength(1);
  });

  it('일시 실패는 다섯 번까지 다시 시도한다 (JOB-SEQ-005)', async () => {
    mock = await startMockAnnotateGhe({
      getScript: Array.from({ length: 4 }, () => ({ status: 503, body: { message: 'unavailable' } })),
      initialTitle: 'Fix device initialization race',
    });
    const result = await annotateOne(depsFor(fakePool()), target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(result).toBe('updated');
    // 실패 넷 + 성공 하나 = 다섯 번의 GET.
    expect(mock.requests.filter((entry) => entry.method === 'GET')).toHaveLength(5);
  });

  it('다섯 번 모두 실패하면 failed로 남고 번호는 그대로다', async () => {
    mock = await startMockAnnotateGhe({
      getScript: Array.from({ length: 6 }, () => ({ status: 500, body: { message: 'boom' } })),
    });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('failed');
    expect(mock.requests.filter((entry) => entry.method === 'GET')).toHaveLength(5);
    expect(pool.queries.some((q) => q.text.includes('SET annotate_state') && q.values[4] === 'failed')).toBe(true);
    // `merge_number`를 되돌리는 문장은 없다 (AC-3).
    expect(pool.queries.some((q) => q.text.includes('merge_number ='))).toBe(false);
  });

  it('실제로 쓴 경우에만 감사를 남긴다 (FR-SEQ-009 AC-4)', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: 'Fix device initialization race' });
    const pool = fakePool();
    await annotateOne(depsFor(pool), target(), '11111111-1111-4111-8111-111111111111');

    const audit = pool.queries.filter((q) => q.text.includes('INSERT INTO audit_record'));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.values[0]).toBe('system:annotate');
    expect(audit[0]?.values[1]).toBe('pull_request.annotate');
    expect(audit[0]?.values[2]).toBe('acme/smp1900#1234');
    // 질의 칸은 비운다.
    expect(audit[0]?.values[3]).toBeNull();
    expect(audit[0]?.values[5]).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('쓰지 않은 회차는 감사를 남기지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '[M-1900-1] 제목' });
    const pool = fakePool();
    await annotateOne(depsFor(pool), target(), '11111111-1111-4111-8111-111111111111');
    expect(pool.queries.some((q) => q.text.includes('INSERT INTO audit_record'))).toBe(false);
  });

  it('감사 실패가 표기 성공을 뒤집지 않는다 (FR-AUTH-004 AC-6)', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: 'Fix device initialization race' });
    const pool = fakePool();
    const original = pool.query;
    pool.query = async (text, values) => {
      if (text.includes('INSERT INTO audit_record')) throw new Error('audit table unavailable');
      return original(text, values);
    };
    const result = await annotateOne(depsFor(pool), target(), '11111111-1111-4111-8111-111111111111');
    expect(result).toBe('updated');
    expect(mock.currentTitle()).toBe('[M-1900-1] Fix device initialization race');
  });

  it('상관 ID가 uuid가 아니면 감사가 사라지지 않도록 새로 만든다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const pool = fakePool();
    await annotateOne(depsFor(pool), target(), 'not-a-uuid');
    const audit = pool.queries.find((q) => q.text.includes('INSERT INTO audit_record'));
    expect(audit?.values[5]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('runAnnotationPass — 회차 (§15·§16)', () => {
  it('한도에 걸리면 회차를 멈추고 다시 할 시각을 돌려준다', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    mock = await startMockAnnotateGhe({
      getScript: [
        {
          status: 403,
          body: { message: 'API rate limit exceeded' },
          headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        },
      ],
    });
    const rows = [target(), target({ merge_seq: 78, pull_request_number: 1235, merge_number: 2 })];
    const summary = await runAnnotationPass(depsFor(fakePool({ targets: rows })), { limit: 10 });

    expect(summary.rateLimitedUntil?.getTime()).toBe(reset * 1000);
    expect(summary.processed).toBe(0);
    // 둘째 행으로 넘어가지 않았다.
    expect(mock.requests.filter((entry) => entry.path.includes('/pulls/'))).toHaveLength(1);
  });

  it('권한으로 막힌 저장소의 나머지 행을 그 회차에서 더 보지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      getScript: [{ status: 403, body: { message: 'Resource not accessible by integration' } }],
    });
    const rows = [
      target(),
      target({ merge_seq: 78, pull_request_number: 1235, merge_number: 2 }),
      target({ merge_seq: 79, pull_request_number: 1236, merge_number: 3 }),
    ];
    const summary = await runAnnotationPass(depsFor(fakePool({ targets: rows })), { limit: 10 });

    expect(summary.results.permission_blocked).toBe(1);
    expect(mock.requests.filter((entry) => entry.path.includes('/pulls/'))).toHaveLength(1);
  });

  it('결과를 지표로 센다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const deps = depsFor(fakePool({ targets: [target()] }));
    await runAnnotationPass(deps, { limit: 10 });
    expect(deps.metrics.mnumberAnnotateTotal.render()).toContain('result="updated"');
  });
});

describe('handleMergeNumberAssigned — 이벤트 경로 (§11)', () => {
  const event = (payload: Record<string, unknown>): Parameters<typeof handleMergeNumberAssigned>[1] =>
    ({
      event_id: 'e1',
      event_name: 'mnumber.assigned',
      correlation_id: '11111111-1111-4111-8111-111111111111',
      occurred_at: new Date().toISOString(),
      payload,
      delivery_count: 1,
    }) as never;

  it('이전 에폭의 이벤트는 아무것도 고치지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const pool = fakePool({ targets: [target()], epoch: 5 });
    const disposition = await handleMergeNumberAssigned(
      depsFor(pool),
      event({ repository_id: 4021, base_branch: 'main', seq_epoch: 3, pull_request_numbers: [1234] }),
    );

    expect(disposition).toEqual({ kind: 'ack' });
    expect(mock.requests).toHaveLength(0);
    expect(mock.currentTitle()).toBe('제목');
  });

  it('현재 에폭이면 표기한다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const pool = fakePool({ targets: [target()], epoch: 3 });
    const disposition = await handleMergeNumberAssigned(
      depsFor(pool),
      event({ repository_id: 4021, base_branch: 'main', seq_epoch: 3, pull_request_numbers: [1234] }),
    );

    expect(disposition).toEqual({ kind: 'ack' });
    expect(mock.currentTitle()).toBe('[M-1900-1] 제목');
  });

  it('같은 이벤트를 두 번 받아도 접두가 두 번 붙지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const deps = depsFor(fakePool({ targets: [target()], epoch: 3 }));
    const delivered = event({ repository_id: 4021, base_branch: 'main', seq_epoch: 3, pull_request_numbers: [1234] });

    await handleMergeNumberAssigned(deps, delivered);
    await handleMergeNumberAssigned(deps, delivered);

    expect(mock.currentTitle()).toBe('[M-1900-1] 제목');
    expect(patches()).toHaveLength(1);
  });

  it('한도에 걸리면 ack하지 않고 다시 받는다', async () => {
    mock = await startMockAnnotateGhe({
      getScript: [{ status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '30' } }],
    });
    const disposition = await handleMergeNumberAssigned(
      depsFor(fakePool({ targets: [target()], epoch: 3 })),
      event({ repository_id: 4021, base_branch: 'main', seq_epoch: 3, pull_request_numbers: [1234] }),
    );
    expect(disposition).toMatchObject({ kind: 'defer' });
  });

  it('다른 이벤트 이름은 무시한다', async () => {
    mock = await startMockAnnotateGhe();
    const disposition = await handleMergeNumberAssigned(depsFor(fakePool()), {
      ...event({ repository_id: 4021 }),
      event_name: 'sequence.assigned',
    } as never);
    expect(disposition).toEqual({ kind: 'ack' });
    expect(mock.requests).toHaveLength(0);
  });
});

describe('표기가 꺼진 배포', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('기본값은 꺼짐이며 자격이 없어도 설정이 성립한다', () => {
    const config = resolveAnnotateConfig({});
    expect(config.enabled).toBe(false);
    expect(config.appId).toBe('');
  });

  it('오타는 조용히 꺼지지 않고 던진다', () => {
    expect(() => resolveAnnotateConfig({ MNUMBER_ANNOTATE_ENABLED: 'yes' })).toThrow(/true 또는 false/);
  });
});
