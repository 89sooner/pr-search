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

import {
  ANNOTATE_MAX_ATTEMPTS,
  AnnotateClient,
  resolveAnnotateConfig,
  type AnnotateConfig,
} from '@prs/github-annotate';
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
function fakePool(
  options: { targets?: readonly TargetRow[]; epoch?: number; stillCurrent?: boolean } = {},
): FakePool {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      // 쓰기 직전 재확인. 기본은 「그대로다」이며 시험이 명시적으로 뒤집는다.
      if (text.includes('SELECT true AS ok')) {
        const current = options.stillCurrent ?? true;
        return { rows: current ? [{ ok: true }] : [], rowCount: current ? 1 : 0 };
      }
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
    /*
     * **운영자의 값을 쓰는 문장이 하나도 없어야 한다.** 문자열 한 형태만 보면
     * 열 이름이나 공백이 바뀌는 것만으로 조용히 통과한다 (리뷰가 지적한 자리).
     * `annotate_enabled`가 대입 좌변에 오는 모든 형태를 정규식으로 막는다.
     */
    const writesPolicy = pool.queries.filter((q) => /annotate_enabled\s*=(?!=)/.test(q.text));
    expect(writesPolicy.map((q) => q.text), '운영자 정책을 쓰는 문장이 있다').toEqual([]);
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
    /*
     * **감사가 정본 표시보다 앞이다.** 표시를 먼저 하고 그 사이에 죽으면 제목은
     * 바뀌었는데 감사가 없는 행이 남고, 다음 회차는 `already_annotated`라 다시
     * 기록하지 않는다.
     */
    const auditIndex = pool.queries.findIndex((q) => q.text.includes('INSERT INTO audit_record'));
    const doneIndex = pool.queries.findIndex(
      (q) => q.text.includes('SET annotate_state') && q.values[4] === 'done',
    );
    expect(auditIndex).toBeGreaterThan(-1);
    expect(doneIndex).toBeGreaterThan(auditIndex);
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

describe('차단 해제 (리뷰 minor)', () => {
  it('이미 표기된 행에서도 GHE가 200이면 차단을 푼다', async () => {
    /*
     * 쓰기 성공에서만 풀면, 남은 대상이 모두 이미 표기된 저장소는 권한이
     * 복구돼도 차단이 남아 새 PR의 표기가 다음 스윕까지 밀린다.
     */
    mock = await startMockAnnotateGhe({ initialTitle: '[M-1900-1] 제목' });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('already_done');
    expect(patches()).toHaveLength(0);
    expect(pool.queries.some((q) => q.text.includes('annotate_blocked_at = NULL'))).toBe(true);
  });

  it('불일치에서도 차단을 푼다 — 읽기가 성공했기 때문이다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '[M-1900-77] 제목' });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('mismatch');
    expect(pool.queries.some((q) => q.text.includes('annotate_blocked_at = NULL'))).toBe(true);
  });

  it('권한 오류에서는 풀지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      getScript: [{ status: 403, body: { message: 'Resource not accessible by integration' } }],
    });
    const pool = fakePool();
    await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(pool.queries.some((q) => q.text.includes('annotate_blocked_at = NULL'))).toBe(false);
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

  it('결과를 지표와 요약에 **개수로** 센다', async () => {
    /*
     * 라벨이 있는지만 보면 오계상을 못 본다 — 한 행을 두 번 세거나 다른 결과를
     * 같은 라벨에 얹어도 통과한다 (리뷰가 지적한 자리).
     */
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const deps = depsFor(fakePool({ targets: [target(), target({ merge_seq: 78, pull_request_number: 1235 })] }));
    const summary = await runAnnotationPass(deps, { limit: 10 });

    // 첫 행은 붙이고, 둘째 행은 같은 PR 제목을 다시 읽어 이미 붙은 것을 본다.
    expect(summary.processed).toBe(2);
    expect(summary.results).toEqual({ updated: 1, already_done: 1 });
    const rendered = deps.metrics.mnumberAnnotateTotal.render();
    expect(rendered).toContain('mnumber_annotate_total{result="updated"} 1');
    expect(rendered).toContain('mnumber_annotate_total{result="already_done"} 1');
  });

  it('재시도 대기가 지수로 늘어난다 (JOB-SEQ-005)', async () => {
    /*
     * 횟수만 세면 **간격을 상수로 바꾼 변이가 살아남는다.** 수열 자체를 단언해야
     * 「지수 백오프」가 계약으로 지켜진다. 합은 회차 예산 30초 안이어야 한다.
     */
    mock = await startMockAnnotateGhe({
      getScript: Array.from({ length: 4 }, () => ({ status: 503, body: { message: 'unavailable' } })),
      initialTitle: '제목',
    });
    const slept: number[] = [];
    const deps = { ...depsFor(fakePool()), sleep: async (ms: number) => void slept.push(ms) };
    await annotateOne(deps, target(), 'c0ffee00-0000-4000-8000-000000000000');

    const backoff = slept.filter((ms) => ms !== deps.config.writeSpacingMs);
    expect(backoff).toEqual([200, 400, 800, 1600]);
    expect(backoff.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(30_000);
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

  it('예산이 다하면 ack하지 않고 곧 다시 받는다', async () => {
    /*
     * 버스가 30초 방치된 항목을 회수한다. 회차가 그보다 오래 붙들면 처리 중인
     * 이벤트를 가로채 같은 행을 다시 집는다. 예산을 넘기면 한 것까지 남기고
     * 돌아오되 **ack하지 않아** 남은 PR이 잔여 스윕까지 밀리지 않게 한다.
     */
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const rows = Array.from({ length: 3 }, (_unused, index) =>
      target({ merge_seq: 10 + index, pull_request_number: 1234 + index, merge_number: 1 + index }),
    );
    let now = 0;
    const deps = {
      ...depsFor(fakePool({ targets: rows, epoch: 3 })),
      // 느린 GHE를 흉내 낸다 — 첫 쓰기에만 간격이 붙고 그것이 예산을 넘긴다.
      sleep: async () => {
        now += 30_000;
      },
      now: () => new Date(now),
    };
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const disposition = await handleMergeNumberAssigned(
        deps,
        event({ repository_id: 4021, base_branch: 'main', seq_epoch: 3, pull_request_numbers: [1234, 1235, 1236] }),
      );
      expect(disposition).toMatchObject({ kind: 'defer', reason: 'annotate_budget_exhausted' });
    } finally {
      spy.mockRestore();
    }
    // 예산을 넘긴 뒤로는 요청을 더 보내지 않았다.
    expect(patches().length).toBeLessThan(3);
  });

  it('줄에서 기다리다 예산이 다하면 정본을 읽지도 않는다', async () => {
    /*
     * 잔여 스윕이 회차를 오래 쥐면 그 뒤에 선 이벤트는 **기다리기만 하다**
     * 버스의 회수 시한을 넘긴다. 대기 시간을 예산에 넣지 않으면 그 자리를
     * 막을 수 없다 — 내 예산 수정이 만든 자리다.
     */
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    let now = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    // 앞 회차를 붙들어 둘 문이다. 열릴 때까지 그 회차가 줄을 쥔다.
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const holding = fakePool({ targets: [], epoch: 3 });
    const originalQuery = holding.query;
    holding.query = async (text, values) => {
      if (text.includes('FROM merge_sequence ms')) await gate;
      return originalQuery(text, values);
    };

    try {
      const slow = runAnnotationPass(depsFor(holding), { limit: 10 }, 'c0ffee00-0000-4000-8000-000000000000');
      // 앞 회차가 줄을 쥔 상태에서 이벤트가 도착해 줄을 선다.
      const queuedPass = handleMergeNumberAssigned(
        depsFor(fakePool({ targets: [target()], epoch: 3 })),
        event({ repository_id: 4021, base_branch: 'main', seq_epoch: 3, pull_request_numbers: [1234] }),
      );
      // 줄을 서는 자리까지 실제로 도달하게 둔 뒤에 시계를 민다.
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      // 기다리는 동안 회수 시한을 넘길 만큼 시간이 흐른다.
      now += 30_000;
      open();
      await slow;
      expect(await queuedPass).toMatchObject({ kind: 'defer', reason: 'annotate_budget_exhausted' });
      // 정본을 읽지도 않았으므로 GHE 요청이 없다.
      expect(mock.requests).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
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

describe('쓰기 직전 재확인과 간격 (리뷰 P1·공식 지침)', () => {
  it('그 사이 정본이 바뀌면 PATCH하지 않고 상태도 남기지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const pool = fakePool({ stillCurrent: false });
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('superseded');
    expect(patches()).toHaveLength(0);
    expect(mock.currentTitle()).toBe('제목');
    // 다음 회차가 현재 정본으로 다시 판정하도록 상태를 비워 둔다.
    expect(pool.queries.some((q) => q.text.includes('SET annotate_state'))).toBe(false);
  });

  it('재확인은 조회 뒤·쓰기 앞에 온다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const pool = fakePool();
    await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    const recheck = pool.queries.findIndex((q) => q.text.includes('SELECT true AS ok'));
    expect(recheck).toBeGreaterThan(-1);
    // 재확인 시점에 제목 조회는 끝났고 PATCH는 아직이다.
    const beforeRecheck = mock.requests.slice(0, mock.requests.findIndex((r) => r.method === 'PATCH'));
    expect(beforeRecheck.some((r) => r.method === 'GET')).toBe(true);
  });

  it('본문이 잘려 돌아오면 성공으로 기록하지 않는다', async () => {
    /*
     * 공식 문서가 제목 길이 상한을 밝히지 않으므로 서버가 조용히 자르는 경로가
     * 있을 수 있다. 접두만 확인하면 **원래 제목이 잘린 것을 성공으로 기록한다** —
     * 「원래 제목의 나머지 부분은 바꾸지 않는다」(AC-1)가 무너지는 자리다.
     */
    mock = await startMockAnnotateGhe({ initialTitle: '아주 긴 원래 제목이 여기에 있다' });
    const pool = fakePool();
    const truncating = depsFor(pool);
    (truncating.client as unknown as { updateTitle: unknown }).updateTitle = async (): Promise<string> =>
      '[M-1900-1] 아주 긴 원래';

    const result = await annotateOne(truncating, target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(result).toBe('failed');
    expect(pool.queries.some((q) => q.text.includes('SET annotate_state') && q.values[4] === 'failed')).toBe(true);
  });

  it('재시도 대기의 총합이 회차 예산 안에 들어간다', () => {
    /*
     * 백오프 상한 상수를 없앴으므로 「이 상수를 키우지 말라」는 암묵 계약만 남는다.
     * 총합을 실제 상수에서 계산해 못 박아, 시도 횟수를 올리면 **그 순간** 깨지게
     * 한다 — 닿지 않는 가지를 두는 것보다 정직하다.
     */
    const total = Array.from({ length: ANNOTATE_MAX_ATTEMPTS - 1 }, (_unused, index) => 200 * 2 ** index).reduce(
      (sum, ms) => sum + ms,
      0,
    );
    expect(total, `백오프 총합 ${String(total)}ms가 JOB-SEQ-005의 30초 예산을 넘는다`).toBeLessThan(30_000);
  });

  it('토큰 발급의 인증 실패는 재시도하지 않고 저장소를 막는다', async () => {
    /*
     * 요청 경로의 401은 만료라 다시 받으면 되지만, 발급 자체가 인증에 실패하면
     * App ID나 개인 키가 틀린 것이다. 다섯 번을 두드려도 답이 같다.
     */
    mock = await startMockAnnotateGhe({
      tokenScript: Array.from({ length: 8 }, () => ({ status: 401, body: { message: 'Bad credentials' } })),
    });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');

    expect(result).toBe('permission_blocked');
    // 발급 시도는 한 번뿐이다 — 반복하지 않는다.
    expect(mock.requests.filter((entry) => entry.path.includes('/access_tokens'))).toHaveLength(1);
    expect(pool.queries.some((q) => q.text.includes('annotate_blocked_at = now()'))).toBe(true);
  });

  it('응답 제목의 뒤 공백만 다듬어져도 성공이다', async () => {
    /*
     * 공식 문서는 응답의 `title`이 보낸 값과 같다고 보장하지 않는다. 서버가 앞뒤
     * 공백을 다듬는 것만으로 성공한 표기가 실패로 기록되면 지표가 거짓을 말한다.
     */
    mock = await startMockAnnotateGhe({ initialTitle: '제목  ' });
    const pool = fakePool();
    const trimming = depsFor(pool);
    // 목이 저장한 값을 다듬는 서버를 흉내 낸다.
    const original = trimming.client.updateTitle.bind(trimming.client);
    (trimming.client as unknown as { updateTitle: unknown }).updateTitle = async (
      ref: Parameters<typeof original>[0],
      title: string,
    ): Promise<string> => (await original(ref, title)).trimEnd();

    const result = await annotateOne(trimming, target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(result).toBe('updated');
    expect(pool.queries.some((q) => q.text.includes('SET annotate_state') && q.values[4] === 'done')).toBe(true);
  });

  it('접두가 아예 없는 응답은 실패로 남긴다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const pool = fakePool();
    const hostile = depsFor(pool);
    (hostile.client as unknown as { updateTitle: unknown }).updateTitle = async (): Promise<string> => '다른 제목';

    const result = await annotateOne(hostile, target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(result).toBe('failed');
  });

  it('실제로 쓴 뒤에만 쉬고, 조회만 한 회차는 쉬지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const slept: number[] = [];
    const deps = {
      ...depsFor(fakePool({ targets: [target()] })),
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    };
    await runAnnotationPass(deps, { limit: 10 });
    expect(slept).toEqual([deps.config.writeSpacingMs]);
    expect(deps.config.writeSpacingMs).toBeGreaterThanOrEqual(1_000);

    // 이미 표기된 행만 있으면 쓰기가 없으므로 쉬지 않는다.
    await mock.close();
    mock = await startMockAnnotateGhe({ initialTitle: '[M-1900-1] 제목' });
    const idle: number[] = [];
    const quiet = {
      ...depsFor(fakePool({ targets: [target()] })),
      sleep: async (ms: number) => {
        idle.push(ms);
      },
    };
    await runAnnotationPass(quiet, { limit: 10 });
    expect(idle).toEqual([]);
  });

  it('회차는 겹치지 않는다 — 두 회차가 동시에 같은 행을 집지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    const deps = depsFor(fakePool({ targets: [target()] }));
    await Promise.all([
      runAnnotationPass(deps, { limit: 10 }),
      runAnnotationPass(deps, { limit: 10 }),
    ]);
    // 둘째 회차는 첫째가 붙인 접두를 보고 호출하지 않는다.
    expect(patches()).toHaveLength(1);
  });

  it('토큰 발급이 일시 실패하면 표기 재시도가 그것을 받는다', async () => {
    /*
     * 발급기는 `GitHubApiError`를 던진다. 그대로 올라가면 재시도가 알아보지 못해
     * 일시 장애가 영구 실패로 기록되고 회복이 다음 스윕까지 밀린다 (리뷰 P2).
     */
    mock = await startMockAnnotateGhe({
      tokenScript: [{ status: 500, body: { message: 'token endpoint down' } }],
      initialTitle: '제목',
    });
    const result = await annotateOne(depsFor(fakePool()), target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(result).toBe('updated');
    expect(mock.tokenIssueCount()).toBe(1);
    expect(mock.currentTitle()).toBe('[M-1900-1] 제목');
  });

  it('토큰 발급이 계속 실패하면 failed로 남는다', async () => {
    mock = await startMockAnnotateGhe({
      tokenScript: Array.from({ length: 8 }, () => ({ status: 500, body: { message: 'down' } })),
    });
    const pool = fakePool();
    const result = await annotateOne(depsFor(pool), target(), 'c0ffee00-0000-4000-8000-000000000000');
    expect(result).toBe('failed');
    expect(patches()).toHaveLength(0);
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
