/**
 * 표기 잡의 안전성 계약 (WP-075 안전성 보강).
 *
 * **이 파일은 실패 경로만 본다.** 정상 경로의 판정은 `annotate.test.ts`가 이미
 * 잰다. 여기서 묻는 것은 하나다 — 실패·재시작·설정 변경이 끼어들었을 때 이
 * 잡이 **오래된 제목을 다시 보내거나, 알려진 불일치를 성공으로 덮지 않는가.**
 *
 * 대역을 쓰지 않는 규율은 그대로다. 진짜 `AnnotateClient`가 진짜 로컬 HTTP
 * 서버를 부르므로 "무엇을 보냈는가"를 요청 본문 원문으로 잰다.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { AnnotateClient, WriteGate, resolveAnnotateConfig, type AnnotateConfig } from '@prs/github-annotate';
import {
  generateTestKeyPair,
  startMockAnnotateGhe,
  type MockAnnotateGhe,
  type MockAnnotateGheOptions,
} from '../../../packages/github-annotate/testing/mock-annotate-ghe.js';

import { annotateOne, runAnnotationPass, type AnnotateDeps } from './annotate.js';
import { createWorkerMetrics } from './metrics.js';

const KEYS = generateTestKeyPair();
const CORRELATION = 'c0ffee00-0000-4000-8000-000000000000';

interface TargetRow {
  repository_id: number;
  owner: string;
  name: string;
  base_branch: string;
  seq_epoch: number;
  merge_seq: number;
  pull_request_number: number;
  merge_number: number;
  annotate_state: string | null;
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

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface StatefulPool {
  readonly queries: RecordedQuery[];
  /** `markAnnotateState`가 남긴 마지막 상태. 다음 회차가 무엇을 보는지 이것으로 안다. */
  readonly states: string[];
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  /** 실행자 락이 쓰는 전용 커넥션. 대역도 그 경로를 지나야 운영과 같은 코드가 돈다. */
  connect: () => Promise<{ query: StatefulPool['query']; release: (destroy?: boolean) => void }>;
  /** 락을 내주지 않는다 — 다른 프로세스가 실행자인 상황을 만든다. */
  lockTaken?: boolean;
}

/**
 * 정본을 기억하는 대역.
 *
 * `annotate.test.ts`의 대역은 매 질의에 같은 답을 준다. 이 파일은 **회차 사이에
 * 무엇이 바뀌었는가**를 물으므로, 쓰기 직전 재확인의 답을 호출 순서에 따라
 * 바꿀 수 있어야 한다.
 */
function statefulPool(
  options: {
    targets?: readonly TargetRow[];
    epoch?: number;
    /** `isAnnotationCurrent`의 답. 호출 순서대로 소비하고, 다 쓰면 마지막 값을 이어 쓴다. */
    currentAnswers?: readonly boolean[];
    /** 실행자 락을 다른 프로세스가 쥐고 있다. */
    lockTaken?: boolean;
  } = {},
): StatefulPool {
  const queries: RecordedQuery[] = [];
  const states: string[] = [];
  const answers = [...(options.currentAnswers ?? [true])];
  let lastAnswer = answers[answers.length - 1] ?? true;
  const pool: StatefulPool = {
    queries,
    states,
    connect: async () => ({ query: async (text, values) => pool.query(text, values), release: () => {} }),
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: options.lockTaken !== true }], rowCount: 1 };
      }
      if (text.includes('pg_advisory_unlock')) return { rows: [], rowCount: 1 };
      if (text.includes('SELECT true AS ok')) {
        const next = answers.shift();
        const ok = next ?? lastAnswer;
        if (next !== undefined) lastAnswer = next;
        return { rows: ok ? [{ ok: true }] : [], rowCount: ok ? 1 : 0 };
      }
      if (text.includes('SET annotate_state')) {
        states.push(String(values[4] ?? values[values.length - 1]));
        return { rows: [], rowCount: 1 };
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
  return pool;
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

interface DepsOptions {
  /** 재시도·쓰기 간격 대기를 실제로 기다릴 것인가. 기본은 기록만 하고 건너뛴다. */
  readonly realSleep?: boolean;
  readonly sleeps?: number[];
  readonly configOverrides?: Record<string, string>;
}

function depsFor(pool: StatefulPool, options: DepsOptions = {}): AnnotateDeps {
  const config = configFor((mock as MockAnnotateGhe).apiUrl, options.configOverrides ?? {});
  return {
    pool: pool as never,
    bus: undefined as never,
    config,
    metrics: createWorkerMetrics(),
    sleep: async (ms: number) => {
      options.sleeps?.push(ms);
      if (options.realSleep === true) await new Promise<void>((resolve) => setTimeout(resolve, ms));
    },
    log: () => {},
    client: new AnnotateClient({ config }),
  };
}

async function startMock(options: MockAnnotateGheOptions): Promise<MockAnnotateGhe> {
  mock = await startMockAnnotateGhe(options);
  return mock;
}

/** 목이 실제로 받은 PATCH의 본문에서 제목만 뽑는다. */
function patchTitles(): string[] {
  return (mock?.requests ?? [])
    .filter((request) => request.method === 'PATCH')
    .map((request) => (JSON.parse(request.rawBody === '' ? '{}' : request.rawBody) as { title?: string }).title ?? '');
}

function patchTimes(): number[] {
  return (mock?.requests ?? []).filter((request) => request.method === 'PATCH').map((request) => request.receivedAt);
}

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('A. 변경 요청의 재시도는 최신 상태를 다시 확인한다', () => {
  it('첫 PATCH가 실패한 뒤 사람이 제목을 고치면 재시도는 새 제목 위에 붙인다', async () => {
    /*
     * **가장 값비싼 자리다.** 첫 PATCH를 보낸 뒤 응답이 5xx로 돌아오는 사이에
     * 사람이 제목을 고칠 수 있다. 재시도가 첫 시도의 문자열을 그대로 다시
     * 보내면 그 편집이 사라진다 — `AC-1`("원래 제목의 나머지는 바꾸지 않는다")이
     * 무너지는 자리이며, 제목은 되돌릴 수 없다.
     */
    let patchSeen = 0;
    await startMock({
      initialTitle: '원래 제목',
      patchScript: [{ status: 500, body: { message: 'boom' } }],
      onRequest: (request, control) => {
        if (request.method !== 'PATCH') return;
        patchSeen += 1;
        if (patchSeen === 1) control.setTitle('사람이 고친 제목');
      },
    });
    const pool = statefulPool();

    const result = await annotateOne(depsFor(pool), target() as never, CORRELATION);

    expect(result).toBe('updated');
    const titles = patchTitles();
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(titles[titles.length - 1]).toBe('[M-1900-1] 사람이 고친 제목');
    expect(mock?.currentTitle()).toBe('[M-1900-1] 사람이 고친 제목');
  });

  it('첫 PATCH가 실패한 뒤 다른 M 접두가 생기면 재시도가 그것을 덮지 않는다', async () => {
    let patchSeen = 0;
    await startMock({
      initialTitle: '원래 제목',
      patchScript: [{ status: 500, body: { message: 'boom' } }],
      onRequest: (request, control) => {
        if (request.method !== 'PATCH') return;
        patchSeen += 1;
        if (patchSeen === 1) control.setTitle('[M-1900-9] 원래 제목');
      },
    });
    const pool = statefulPool();

    const result = await annotateOne(depsFor(pool), target() as never, CORRELATION);

    expect(result).toBe('mismatch');
    expect(mock?.currentTitle()).toBe('[M-1900-9] 원래 제목');
    expect(patchTitles()).toHaveLength(1);
  });

  it('첫 PATCH가 실패한 뒤 정본이 바뀌면 재시도를 보내지 않는다', async () => {
    /*
     * 쓰기 직전 울타리는 **첫 요청 앞에서만** 물었다. 재시도가 그 사이의 재채번을
     * 모르면 무효가 된 번호가 나간다 — `DEV-621`이 목록 단위에서 막은 것과 같은
     * 결함이 재시도 단위에 남아 있다.
     */
    await startMock({
      initialTitle: '원래 제목',
      patchScript: [{ status: 500, body: { message: 'boom' } }],
    });
    /*
     * 한 시도는 정본을 **두 번** 묻는다 — 조회 앞과 쓰기 앞이다. 첫 시도는 둘 다
     * 통과해 PATCH를 보내고, 재시도의 첫 확인에서 정본이 바뀐 것을 본다.
     */
    const pool = statefulPool({ currentAnswers: [true, true, false] });

    const result = await annotateOne(depsFor(pool), target() as never, CORRELATION);

    expect(result).toBe('superseded');
    expect(patchTitles()).toHaveLength(1);
    expect(pool.states).toHaveLength(0);
  });
});

describe('B. 알려진 불일치를 다음 회차가 성공으로 덮지 않는다', () => {
  it('본문이 바뀐 채 저장된 행은 다음 회차에서도 done이 되지 않는다', async () => {
    /*
     * 서버가 본문을 자르거나 바꿔 저장하면 이 회차는 `title_body_changed`로 잡는다.
     * 그런데 다음 회차는 제목을 다시 읽고 **접두가 있다는 것만으로** `already_annotated`를
     * 판정한다. 그러면 "원래 제목이 사라졌다"는 사실이 한 회차 만에 성공으로 덮인다.
     */
    await startMock({
      initialTitle: '원래 제목',
      // 서버가 본문을 잘라서 저장했다.
      patchScript: [{ status: 200, body: { number: 1234, title: '[M-1900-1] 원래' } }],
    });
    const pool = statefulPool();

    const first = await annotateOne(depsFor(pool), target() as never, CORRELATION);
    // 「실패」가 아니라 「본문이 바뀌었다」로 남는다 — 둘은 다음 회차의 행동이 다르다.
    expect(first).toBe('body_changed');
    const recorded = pool.states[pool.states.length - 1];
    expect(recorded).toBe('body_changed');

    // 목의 제목은 이제 잘린 상태다. 다음 회차가 같은 행을 다시 본다.
    mock?.setTitle('[M-1900-1] 원래');
    const second = await annotateOne(
      depsFor(pool),
      target({ annotate_state: recorded ?? 'failed' }) as never,
      CORRELATION,
    );

    expect(second).not.toBe('already_done');
    expect(pool.states[pool.states.length - 1]).not.toBe('done');
  });
});

describe('C. 줄을 기다리는 동안에도 예산을 지킨다', () => {
  it('앞 회차가 붙들고 있어도 뒤에 선 회차는 예산 안에 손을 뗀다', async () => {
    /*
     * 예산을 **줄 서기 전부터 재는** 것만으로는 부족하다. 앞 회차가 끝나야
     * `previous.then(...)`이 돌므로, 뒤에 선 이벤트는 예산이 지난 것을 **앞 회차가
     * 끝난 뒤에야** 알아챈다. 버스는 그 사이에 이미 항목을 회수한다.
     *
     * 가짜 시계로는 이 자리를 잴 수 없다 — 재는 것이 "언제 반환하는가"이기 때문이다.
     */
    await startMock({ initialTitle: '제목' });
    let openGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const holding = statefulPool({ targets: [] });
    const originalQuery = holding.query;
    holding.query = async (text, values) => {
      if (text.includes('FROM merge_sequence ms')) await gate;
      return originalQuery(text, values);
    };

    const slow = runAnnotationPass(depsFor(holding), { limit: 10 }, CORRELATION);
    // 앞 회차가 줄을 쥔 뒤에 두 번째 회차가 줄을 선다.
    await new Promise((resolve) => setImmediate(resolve));
    const startedAt = Date.now();
    const queued = runAnnotationPass(depsFor(statefulPool({ targets: [target()] })), { limit: 10 }, CORRELATION, 150);

    const summary = await queued;
    const waited = Date.now() - startedAt;

    expect(summary.budgetExhausted).toBe(true);
    // 예산의 두 배 안에는 손을 떼야 한다. 앞 회차는 아직 끝나지 않았다.
    expect(waited).toBeLessThan(400);
    openGate();
    await slow;
  });
  it('예산이 없는 회차도 종료 신호에 응답한다', async () => {
    /*
     * 잔여 스윕은 예산이 없다 — 버스의 회수 시한에 묶이지 않기 때문이다. 그렇다고
     * 줄에서 **무한정** 기다리면 종료 요청이 와도 앞 회차가 끝날 때까지 프로세스가
     * 죽지 못한다. 예산과 종료는 다른 신호이고, 뒤의 것은 언제나 들어야 한다.
     */
    await startMock({ initialTitle: '제목' });
    let openGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const holding = statefulPool({ targets: [] });
    const originalQuery = holding.query;
    holding.query = async (text, values) => {
      if (text.includes('FROM merge_sequence ms')) await gate;
      return originalQuery(text, values);
    };

    const slow = runAnnotationPass(depsFor(holding), { limit: 10 }, CORRELATION);
    await new Promise((resolve) => setImmediate(resolve));

    const stopping = new AbortController();
    const startedAt = Date.now();
    // 예산을 주지 않고 종료 신호만 준다.
    const queued = runAnnotationPass(
      depsFor(statefulPool({ targets: [target()] })),
      { limit: 10 },
      CORRELATION,
      undefined,
      stopping.signal,
    );
    setTimeout(() => stopping.abort(), 100);

    const summary = await queued;
    const waited = Date.now() - startedAt;

    expect(summary.budgetExhausted).toBe(true);
    expect(waited).toBeLessThan(400);
    openGate();
    await slow;
  });
});

describe('D. 한 행의 처리도 예산 안에 머문다', () => {
  it('느린 응답 하나가 회차 예산을 넘기지 못한다', async () => {
    /*
     * 예산 검사는 **행과 행 사이**에만 있다. 한 행의 조회·재시도·쓰기가 모두 느리면
     * 그 행 하나가 예산을 통째로 넘기고, 버스는 그동안 이벤트를 회수한다.
     */
    await startMock({
      initialTitle: '제목',
      onRequest: async (request) => {
        // 조회부터 느리다. 실제 GHE가 느린 상황과 같은 자리에서 지연이 생긴다.
        if (request.method === 'GET') await new Promise<void>((resolve) => setTimeout(resolve, 400));
      },
    });
    const pool = statefulPool({ targets: [target()] });

    const startedAt = Date.now();
    const summary = await runAnnotationPass(depsFor(pool), { limit: 10 }, CORRELATION, 150);
    const elapsed = Date.now() - startedAt;

    expect(summary.budgetExhausted).toBe(true);
    expect(elapsed).toBeLessThan(400);
  });
});

describe('E. 쓰기 간격은 성공한 요청만의 것이 아니다', () => {
  it('실패해서 다시 보내는 PATCH 사이에도 최소 간격을 지킨다', async () => {
    /*
     * 공식 문서의 간격 권고는 **변경 요청 사이**의 것이다. 성공한 행 뒤에만 쉬면
     * 5xx가 이어질 때 백오프(200ms)만 남아 1초 하한이 무너진다 — 부 한도를 부르는
     * 바로 그 형태다.
     */
    await startMock({
      initialTitle: '제목',
      patchScript: [
        { status: 500, body: { message: 'boom' } },
        { status: 500, body: { message: 'boom' } },
      ],
    });
    const sleeps: number[] = [];
    const pool = statefulPool();

    /*
     * **실제로 기다린다.** 간격은 요청이 서버에 닿는 사이의 것이고, 그것은 목이
     * 기록한 수신 시각으로만 잴 수 있다. `sleep`을 건너뛰면 계약을 지켰는지
     * 알 수 없으므로 이 시험만 실제 시간을 쓴다 (그래서 느리다).
     */
    await annotateOne(depsFor(pool, { realSleep: true, sleeps }), target() as never, CORRELATION);

    const times = patchTimes();
    expect(times).toHaveLength(3);
    for (let index = 1; index < times.length; index += 1) {
      const gap = (times[index] as number) - (times[index - 1] as number);
      expect(gap, `PATCH ${String(index)}와 ${String(index + 1)} 사이가 너무 짧다`).toBeGreaterThanOrEqual(980);
    }
  }, 20_000);

  it('한도 신호를 받으면 그 뒤의 모든 쓰기가 함께 멈춘다', async () => {
    /*
     * 한 이벤트만 `defer`하고 다음 이벤트가 곧바로 같은 한도를 두드리면 유예가
     * 아무것도 아니다. 게이트가 **실행자 전체**를 멈춰야 한다.
     */
    await startMock({ initialTitle: '제목' });
    const gate = new WriteGate({ spacingMs: 1_000 });
    const until = new Date(Date.now() + 60_000);
    gate.pauseUntil(until);

    const pool = statefulPool({ targets: [target()] });
    const summary = await runAnnotationPass(
      { ...depsFor(pool), gate },
      { limit: 10 },
      CORRELATION,
    );

    expect(summary.rateLimitedUntil?.getTime()).toBe(until.getTime());
    expect(summary.processed).toBe(0);
    // 정본을 읽지도 않았고 GHE에 아무것도 보내지 않았다.
    expect(mock?.requests ?? []).toHaveLength(0);
  });
});

describe('F. 실행자는 하나다 (DEV-629)', () => {
  it('다른 프로세스가 락을 쥐고 있으면 아무것도 쓰지 않는다', async () => {
    await startMock({ initialTitle: '제목' });
    const pool = statefulPool({ targets: [target()], lockTaken: true });

    const summary = await runAnnotationPass(depsFor(pool), { limit: 10 }, CORRELATION);

    expect(summary.notRunner).toBe(true);
    expect(summary.processed).toBe(0);
    expect(mock?.requests ?? []).toHaveLength(0);
  });

  it('락을 쥐면 그 커넥션으로 정본을 묻는다 — 연결이 죽으면 쓰지 않는다', async () => {
    await startMock({ initialTitle: '제목' });
    const pool = statefulPool({ targets: [target()] });
    // 락 커넥션의 질의만 죽인다. 풀은 멀쩡하다.
    const originalConnect = pool.connect;
    pool.connect = async () => {
      const client = await originalConnect();
      return {
        ...client,
        query: async (text: string, values?: unknown[]) => {
          if (text.includes('SELECT true AS ok')) throw new Error('connection terminated');
          return client.query(text, values);
        },
      };
    };

    const summary = await runAnnotationPass(depsFor(pool), { limit: 10 }, CORRELATION);

    expect(summary.results['deferred']).toBe(1);
    // 정본을 확인하지 못했으므로 제목을 읽지도, 쓰지도 않았다.
    expect((mock?.requests ?? []).filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });
});

describe('G. 결과의 확실성을 기록으로 가른다', () => {
  it('변경 요청이 5xx로 끝나면 실패가 아니라 **모른다**로 남는다', async () => {
    /*
     * 게이트웨이가 답한 5xx 뒤에서 원본 요청이 처리됐을 수 있고, 공식 API는 그것을
     * 가릴 수단을 주지 않는다. `failed`로 적으면 「실패했다」가 거짓일 수 있다.
     */
    await startMock({
      initialTitle: '제목',
      patchScript: Array.from({ length: 6 }, () => ({ status: 500, body: { message: 'boom' } })),
    });
    const pool = statefulPool();

    const result = await annotateOne(depsFor(pool), target() as never, CORRELATION);

    expect(result).toBe('outcome_unknown');
    expect(pool.states[pool.states.length - 1]).toBe('unknown');
  });

  it('조회가 5xx로 끝나면 결과가 분명하므로 실패로 남는다', async () => {
    // 조회는 아무것도 바꾸지 않는다. 「모른다」를 남길 이유가 없다.
    await startMock({
      initialTitle: '제목',
      getScript: Array.from({ length: 6 }, () => ({ status: 500, body: { message: 'boom' } })),
    });
    const pool = statefulPool();

    const result = await annotateOne(depsFor(pool), target() as never, CORRELATION);

    expect(result).toBe('failed');
    expect(pool.states[pool.states.length - 1]).toBe('failed');
  });

  it('결과 불명에서 복구하며 접두를 관측하면 감사 결과 코드가 다르다', async () => {
    /*
     * 접두가 있다는 것이 **우리 요청이 성공했다**는 뜻은 아니다 — 다른 주체가 같은
     * 접두를 붙였을 수 있고 공식 API는 그것을 가려 주지 않는다. 관측했다는 사실만
     * 다른 코드로 남긴다.
     */
    await startMock({ initialTitle: '[M-1900-1] 제목' });
    const pool = statefulPool();

    const result = await annotateOne(
      depsFor(pool),
      target({ annotate_state: 'unknown' }) as never,
      CORRELATION,
    );

    expect(result).toBe('already_done');
    const audit = pool.queries.find((query) => query.text.includes('INSERT INTO audit_record'));
    expect(audit, '복구 관측에 감사가 없다').toBeDefined();
    expect(audit?.values[4]).toBe('annotated_observed');
  });

  it('한 번도 시도하지 않은 행에서 접두를 보면 감사를 남기지 않는다', async () => {
    // 쓰지 않았고 복구도 아니다. 감사 건수가 「제목이 바뀐 횟수」를 말해야 한다.
    await startMock({ initialTitle: '[M-1900-1] 제목' });
    const pool = statefulPool();

    await annotateOne(depsFor(pool), target() as never, CORRELATION);

    expect(pool.queries.some((query) => query.text.includes('INSERT INTO audit_record'))).toBe(false);
  });

  it('회차가 한도를 만나면 게이트 전체가 멈춘다', async () => {
    /*
     * 한 이벤트만 `defer`하고 다음 회차가 곧바로 같은 한도를 두드리면 유예가
     * 아무것도 아니다. 회차가 받은 한도 신호는 **실행자 전체**에 걸려야 한다.
     */
    await startMock({
      initialTitle: '제목',
      getScript: [{ status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '30' } }],
    });
    const gate = new WriteGate({ spacingMs: 1_000 });
    const pool = statefulPool({ targets: [target()] });

    const first = await runAnnotationPass({ ...depsFor(pool), gate }, { limit: 10 }, CORRELATION);
    expect(first.rateLimitedUntil).toBeDefined();

    // 같은 게이트를 쓰는 다음 회차는 정본을 읽지도 않는다.
    const requestsBefore = (mock?.requests ?? []).length;
    const second = await runAnnotationPass({ ...depsFor(pool), gate }, { limit: 10 }, CORRELATION);

    expect(second.rateLimitedUntil).toBeDefined();
    expect(second.processed).toBe(0);
    expect(mock?.requests ?? []).toHaveLength(requestsBefore);
  });
});
