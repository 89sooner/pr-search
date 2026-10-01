/**
 * 전송 계층의 원시 창·취소·기한 (CR-132, FR-SRC-003).
 *
 * 가짜 fetch로 본문 스트림을 조각 단위로 흘려, 창 밖을 받지 않고 끊는지와 취소·기한이 어느 단계에서든 같은 오류 모양으로
 * 끝나는지 본다. 실제 HTTP 서버에서의 동작은 통합 시험(`apps/search-api/integration/source/`)이 본다.
 */

import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GitHubApiError } from './errors.js';
import { RequestScheduler } from './scheduler.js';
import { TokenPool } from './token-pool.js';
import type { InstallationTokenProvider } from './token-provider.js';
import { GitHubTransport, GRAPHQL_CONCURRENCY, RAW_MIN_BYTES_PER_MS, RAW_READ_CONCURRENCY, type TransportEvent, type TransportOptions } from './transport.js';

const fakePool = {
  availableAt: () => undefined,
  lease: async () => ({ installationId: 1, token: { token: 'ghs_test', expiresAt: new Date(Date.now() + 3_600_000) } }),
  observeResponse: () => undefined,
  observeSecondaryLimit: () => undefined,
  invalidate: () => undefined,
} as unknown as TokenPool;

interface StreamProbe { pulled: number; cancelled: boolean }
/** `chunks`를 한 번에 하나씩 내보내는 본문. 몇 조각을 당겼는지와 중단됐는지를 기록한다. */
function chunkedBody(chunks: readonly Uint8Array[], probe: StreamProbe): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index];
      index += 1;
      probe.pulled = index;
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
    cancel() {
      probe.cancelled = true;
    },
  }, { highWaterMark: 0 });
}
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function transport(fetchImpl: typeof fetch, extra: { requestTimeoutMs?: number; scheduler?: RequestScheduler; rawReads?: RequestScheduler } = {}): GitHubTransport {
  return new GitHubTransport({
    apiUrl: 'http://ghe.invalid/api/v3',
    requestTimeoutMs: extra.requestTimeoutMs ?? 10_000,
    pool: fakePool,
    scheduler: extra.scheduler ?? new RequestScheduler({ maxConcurrent: 8 }),
    ...(extra.rawReads ? { rawReads: extra.rawReads } : {}),
    fetchImpl,
  });
}
const request = { org: 'acme', path: '/repos/acme/app/git/blobs/abc', accept: 'application/vnd.github.raw+json' };

describe('CR-132 FR-SRC-003 원시 창', () => {
  it('offset 앞은 버리고 length만큼 모으면 뒤를 받지 않고 스트림을 끊는다', async () => {
    const probe: StreamProbe = { pulled: 0, cancelled: false };
    const chunks = ['0123', '4567', '89ab', 'cdef', 'ghij', 'klmn'].map(bytes);
    let accept: string | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      accept = new Headers(init.headers).get('accept');
      return new Response(chunkedBody(chunks, probe), { status: 200 });
    }) as unknown as typeof fetch;
    const window = await transport(fetchImpl).getRawWindow(request, { offset: 6, length: 5 });
    expect(new TextDecoder().decode(window.bytes)).toBe('6789a');
    expect(window.eof).toBe(false);
    expect(probe.cancelled).toBe(true);
    // '0123' '4567' '89ab' + 끝 판정용 한 조각. 뒤의 조각은 당기지 않았다.
    expect(probe.pulled).toBeLessThanOrEqual(4);
    expect(accept).toBe('application/vnd.github.raw+json');
  });

  it('창 안에서 본문이 끝나면 eof이고, 창 끝에서 딱 끝나도 한 번 더 읽어 eof로 안다', async () => {
    const make = (text: string[]) => (async () => new Response(chunkedBody(text.map(bytes), { pulled: 0, cancelled: false }), { status: 200 })) as unknown as typeof fetch;
    const short = await transport(make(['abc', 'de'])).getRawWindow(request, { offset: 1, length: 10 });
    expect(new TextDecoder().decode(short.bytes)).toBe('bcde');
    expect(short.eof).toBe(true);
    const exact = await transport(make(['abc', 'de'])).getRawWindow(request, { offset: 0, length: 5 });
    expect(new TextDecoder().decode(exact.bytes)).toBe('abcde');
    expect(exact.eof).toBe(true);
    const beyond = await transport(make(['abc'])).getRawWindow(request, { offset: 3, length: 4 });
    expect(beyond.bytes.length).toBe(0);
    expect(beyond.eof).toBe(true);
  });

  it('창을 채운 조각에 뒷부분이 남으면 그 조각이 마지막이어도 eof가 아니다 — 남은 바이트를 버리고 끝이라고 하지 않는다', async () => {
    const make = (chunks: string[]) => (async () => new Response(chunkedBody(chunks.map(bytes), { pulled: 0, cancelled: false }), { status: 200 })) as unknown as typeof fetch;
    // 한 조각에 본문 전체가 오고 창이 그 가운데에서 끝난다.
    const single = await transport(make(['abcdef'])).getRawWindow(request, { offset: 0, length: 5 });
    expect(new TextDecoder().decode(single.bytes)).toBe('abcde');
    expect(single.eof).toBe(false);
    // offset을 건너뛴 뒤의 마지막 조각에서도 같다.
    const skipped = await transport(make(['ab', 'cdefgh'])).getRawWindow(request, { offset: 3, length: 2 });
    expect(new TextDecoder().decode(skipped.bytes)).toBe('de');
    expect(skipped.eof).toBe(false);
    // 창이 조각 끝에서 딱 끝나고 뒤가 없으면 eof다.
    const exact = await transport(make(['abc', 'de'])).getRawWindow(request, { offset: 1, length: 4 });
    expect(new TextDecoder().decode(exact.bytes)).toBe('bcde');
    expect(exact.eof).toBe(true);
  });

  it('잘못된 창은 호출 전에 거절한다', async () => {
    const fetchImpl = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;
    await expect(transport(fetchImpl).getRawWindow(request, { offset: -1, length: 1 })).rejects.toThrow(RangeError);
    await expect(transport(fetchImpl).getRawWindow(request, { offset: 0, length: 0 })).rejects.toThrow(RangeError);
  });

  it('호출 기한은 기본 기한에 받아야 할 바이트 몫을 더한다 — 기본 기한만으로는 끝나지 않는 읽기가 끝난다', async () => {
    const slow = (async (_url: string, init: RequestInit) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 300);
        init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason); });
      });
      return new Response(chunkedBody([bytes('x')], { pulled: 0, cancelled: false }), { status: 200 });
    }) as unknown as typeof fetch;
    // 1 MiB를 받아야 하면 1,000ms가 더해진다 — 기본 50ms에서 300ms 걸리는 응답도 끝난다.
    const length = Math.round(1000 * RAW_MIN_BYTES_PER_MS);
    await expect(transport(slow, { requestTimeoutMs: 50 }).getRawWindow(request, { offset: 0, length })).resolves.toMatchObject({ eof: true });
    // 같은 응답이 JSON 조회(기본 기한)로는 시간 초과다.
    await expect(transport(slow, { requestTimeoutMs: 50 }).get({ org: 'acme', path: '/x' })).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('CR-138 FR-SRC-003 원시 창의 메모리 (DEV-803)', () => {
  it('창을 다 읽으면 받은 조각을 붙잡지 않는다 — 호출 신호의 기한이 아직 남아 있어도', async () => {
    // 강제 GC로 「아직 닿는 메모리」만 남긴다. 플래그 없이 띄운 시험 작업자에서도 쓸 수 있는 방법이다.
    v8.setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc') as () => void;
    const CHUNK = 256 * 1024;
    const WINDOW = 1024 * 1024;
    const SIZE = 16 * WINDOW;
    const fetchImpl = (async () => {
      let sent = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= SIZE) { controller.close(); return; }
          controller.enqueue(new Uint8Array(CHUNK).fill(0x61));
          sent += CHUNK;
        },
      }, { highWaterMark: 0 }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = transport(fetchImpl);
    gc();
    const before = process.memoryUsage().arrayBuffers;
    let received = 0;
    for (let offset = 0; offset < SIZE; offset += WINDOW) {
      const window = await client.getRawWindow(request, { offset, length: WINDOW });
      received += window.bytes.length;
    }
    expect(received).toBe(SIZE);
    // 창 k는 앞 k MiB를 다시 받으므로 모두 136 MiB를 받았다. 각 창 호출의 신호는 기한(10초 + 바이트 몫)까지 살아 있다 —
    // 수정 전에는 그 신호에 걸린 끝나지 않는 promise가 경합마다 받은 조각을 붙잡아, 기한이 끝날 때까지 136 MiB가 남았다.
    gc();
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(4 * WINDOW);
  });
});

describe('CR-132 FR-SRC-003 원시 읽기의 동시 상한과 취소', () => {
  it(`원시 읽기는 ${RAW_READ_CONCURRENCY}개까지만 동시에 돌고, 그동안 JSON 조회는 공용 슬롯에서 계속 나간다`, async () => {
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const fetchImpl = (async (url: string) => {
      started.push(new URL(url).pathname);
      if (url.includes('/json')) return new Response('{"ok":true}', { status: 200 });
      await new Promise<void>((resolve) => { releases.push(resolve); });
      return new Response(chunkedBody([bytes('z')], { pulled: 0, cancelled: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = transport(fetchImpl);
    const reads = [1, 2, 3].map((n) => client.getRawWindow({ ...request, path: `/raw/${n}` }, { offset: 0, length: 4 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual(['/api/v3/raw/1', '/api/v3/raw/2']);
    await expect(client.get({ org: 'acme', path: '/json' })).resolves.toEqual({ ok: true });
    releases.shift()?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toContain('/api/v3/raw/3');
    for (const release of releases.splice(0)) release();
    await new Promise((r) => setTimeout(r, 20));
    for (const release of releases.splice(0)) release();
    await Promise.all(reads);
  });

  it('원시 읽기 줄에서 기다리다 취소되면 GitHub를 부르지 않고 전송 오류로 끝난다', async () => {
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const fetchImpl = (async (url: string) => {
      started.push(new URL(url).pathname);
      await new Promise<void>((resolve) => { releases.push(resolve); });
      return new Response(chunkedBody([bytes('z')], { pulled: 0, cancelled: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = transport(fetchImpl, { rawReads: new RequestScheduler({ maxConcurrent: 1 }) });
    const first = client.getRawWindow({ ...request, path: '/raw/first' }, { offset: 0, length: 4 });
    await new Promise((r) => setTimeout(r, 10));
    const controller = new AbortController();
    const second = client.getRawWindow({ ...request, path: '/raw/second', signal: controller.signal }, { offset: 0, length: 4 });
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: 'GitHubApiError', kind: 'network' });
    releases.shift()?.();
    await first;
    expect(started).toEqual(['/api/v3/raw/first']);
  });

  it('공용 슬롯을 기다리다 취소돼도 같은 모양이다', async () => {
    const releases: (() => void)[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      await new Promise<void>((resolve) => { releases.push(resolve); });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = transport(fetchImpl, { scheduler: new RequestScheduler({ maxConcurrent: 1 }) });
    const first = client.get({ org: 'acme', path: '/a' });
    await new Promise((r) => setTimeout(r, 10));
    const controller = new AbortController();
    const second = client.get({ org: 'acme', path: '/b', signal: controller.signal });
    controller.abort(new DOMException('deadline', 'TimeoutError'));
    await expect(second).rejects.toMatchObject({ name: 'GitHubApiError', kind: 'timeout' });
    releases.shift()?.();
    await first;
    expect(calls).toBe(1);
  });

  it('본문을 읽는 중에 취소되면 스트림이 끊기고, 요청 기한이면 timeout·사용자 취소면 network로 알린다', async () => {
    for (const [reason, kind] of [[new DOMException('deadline', 'TimeoutError'), 'timeout'], [undefined, 'network']] as const) {
      const probe: StreamProbe = { pulled: 0, cancelled: false };
      const controller = new AbortController();
      const endless = new ReadableStream<Uint8Array>({
        pull: async (stream) => {
          probe.pulled += 1;
          if (probe.pulled === 2) controller.abort(reason);
          await new Promise((r) => setTimeout(r, 5));
          stream.enqueue(bytes('0123456789'));
        },
        cancel() { probe.cancelled = true; },
      }, { highWaterMark: 0 });
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        const response = new Response(endless, { status: 200 });
        init.signal?.addEventListener('abort', () => { void endless.cancel().catch(() => undefined); });
        return response;
      }) as unknown as typeof fetch;
      const error = await transport(fetchImpl).getRawWindow({ ...request, signal: controller.signal }, { offset: 0, length: 1_000_000 }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).kind).toBe(kind);
    }
  });

  it('getPage는 공용 요청 경로로 Link의 다음 페이지를 읽는다', async () => {
    const fetchImpl = (async () => new Response('[1,2]', { status: 200, headers: { link: '<http://ghe.invalid/api/v3/x?page=3>; rel="next"', 'x-github-request-id': 'r1' } })) as unknown as typeof fetch;
    const page = await transport(fetchImpl).getPage<number[]>({ org: 'acme', path: '/x' });
    expect(page).toEqual({ body: [1, 2], status: 200, nextPage: 3, requestId: 'r1' });
  });
});

/**
 * GraphQL 전송 (CR-135). REST와 같은 토큰·기한·취소를 쓰되, GraphQL 한도를 REST 토큰 상태에 섞지 않고 HTTP 상태를 분류하지
 * 않은 채 돌려주는지 본다. 분류는 `source-blame.test.ts`가 본다.
 */
describe('CR-135 FR-SRC-005 GraphQL 전송 (postGraphql)', () => {
  const GRAPHQL_URL = 'http://ghe.invalid/api/graphql';
  const QUERY = 'query Probe($owner: String!) { repository(owner: $owner, name: "app") { id } }';
  const NOW = new Date('2026-09-29T12:00:00.000Z');
  const call = { org: 'acme', query: QUERY, variables: { owner: 'acme' } };

  function graphqlTransport(fetchImpl: typeof fetch, extra: Partial<TransportOptions> = {}): GitHubTransport {
    return new GitHubTransport({
      apiUrl: 'http://ghe.invalid/api/v3',
      graphqlUrl: GRAPHQL_URL,
      requestTimeoutMs: 10_000,
      pool: fakePool,
      scheduler: new RequestScheduler({ maxConcurrent: 8 }),
      now: () => NOW,
      fetchImpl,
      ...extra,
    });
  }
  /** 실제 `TokenPool`(가짜 발급기) — 한도 상태가 섞이는지를 풀에서 직접 잰다. */
  function realPool(): TokenPool {
    const provider = {
      getToken: async () => ({ token: 'ghs_test', expiresAt: new Date(Date.now() + 3_600_000) }),
      invalidate: () => undefined,
    } as unknown as InstallationTokenProvider;
    return new TokenPool(provider, { installations: [{ org: 'acme', installationId: 7 }], quarantineThreshold: 0.1, now: () => NOW });
  }
  /** `init.signal`이 끊길 때까지 응답하지 않는 fetch. 끊기면 그 사유로 거절한다(실제 fetch와 같다). */
  const hanging = (calls: string[] = []) => (async (url: string, init: RequestInit) => {
    calls.push(url);
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as unknown as typeof fetch;

  it('POST JSON 한 건 — graphqlUrl에 Bearer 설치 토큰·content-type·accept·API 버전을 싣고 문서와 변수는 본문에만 둔다', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{"data":{"repository":{"id":"R_1"}}}', { status: 200, headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1790000000' } });
    }) as unknown as typeof fetch;
    const response = await graphqlTransport(fetchImpl).postGraphql(call);
    expect(seen?.url).toBe(GRAPHQL_URL);
    expect(seen?.init.method).toBe('POST');
    const headers = new Headers(seen?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer ghs_test');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(JSON.parse(String(seen?.init.body))).toEqual({ query: QUERY, variables: { owner: 'acme' } });
    expect(seen?.url).not.toContain('ghs_');
    expect(response).toEqual({
      status: 200,
      body: { data: { repository: { id: 'R_1' } } },
      rateLimit: { remaining: 4999, reset: new Date(1_790_000_000_000), retryAfter: null, observedAt: NOW },
    });
  });

  it('어떤 HTTP 상태든 던지지 않고 상태·본문·한도 헤더를 돌려준다 — JSON이 아닌 본문은 null이다', async () => {
    const cases: [number, string, Record<string, string>, unknown][] = [
      [401, '{"message":"Bad credentials"}', {}, { message: 'Bad credentials' }],
      [403, '{"message":"You have exceeded a secondary rate limit"}', { 'retry-after': '30' }, { message: 'You have exceeded a secondary rate limit' }],
      [429, '', { 'retry-after': '45' }, null],
      [502, '<html>Bad Gateway</html>', {}, null],
      [200, '{"errors":[{"type":"RATE_LIMITED"}]}', { 'x-ratelimit-remaining': '0' }, { errors: [{ type: 'RATE_LIMITED' }] }],
    ];
    for (const [status, text, headers, body] of cases) {
      const fetchImpl = (async () => new Response(text === '' ? null : text, { status, headers })) as unknown as typeof fetch;
      const response = await graphqlTransport(fetchImpl).postGraphql(call);
      expect(response.status, String(status)).toBe(status);
      expect(response.body, String(status)).toEqual(body);
      const retryAfter = headers['retry-after'];
      expect(response.rateLimit.retryAfter, String(status)).toEqual(retryAfter === undefined ? null : new Date(NOW.getTime() + Number(retryAfter) * 1000));
    }
  });

  it('401이면 그 설치 토큰을 무효화한다(REST와 같다) — 다른 상태에서는 무효화하지 않는다', async () => {
    const invalidate = vi.fn();
    const pool = { ...fakePool, lease: fakePool.lease.bind(fakePool), invalidate } as unknown as TokenPool;
    const respond = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;
    await graphqlTransport(respond(200), { pool }).postGraphql(call);
    await graphqlTransport(respond(403), { pool }).postGraphql(call);
    expect(invalidate).not.toHaveBeenCalled();
    await expect(graphqlTransport(respond(401), { pool }).postGraphql(call)).resolves.toMatchObject({ status: 401 });
    expect(invalidate).toHaveBeenCalledWith(1);
  });

  it('GraphQL 한도 헤더를 REST 토큰 상태에 넣지 않고, REST 격리도 보지 않는다 — 버킷이 다르다', async () => {
    const pool = realPool();
    const reset = String(Math.floor(NOW.getTime() / 1000) + 900);
    const graphqlCalls: string[] = [];
    const fetchImpl = (async (url: string) => {
      if (url === GRAPHQL_URL) {
        graphqlCalls.push(url);
        // 잔여 0인 성공과 429를 차례로 받는다.
        return graphqlCalls.length === 1
          ? new Response('{"data":{}}', { status: 200, headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } })
          : new Response('{}', { status: 429, headers: { 'retry-after': '120' } });
      }
      return new Response('{}', { status: 200, headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } });
    }) as unknown as typeof fetch;
    const client = graphqlTransport(fetchImpl, { pool });
    await client.postGraphql(call);
    await client.postGraphql(call);
    expect(pool.isAvailable('acme')).toBe(true);
    expect(pool.availableAt('acme')).toBeUndefined();
    expect(pool.remainingByInstallation().size).toBe(0);
    // 반대 방향: REST가 토큰을 격리해도 GraphQL은 나간다.
    await client.get({ org: 'acme', path: '/repos/acme/app' });
    expect(pool.isAvailable('acme')).toBe(false);
    await expect(client.get({ org: 'acme', path: '/repos/acme/app' })).rejects.toMatchObject({ kind: 'rate_limited' });
    await expect(client.postGraphql(call)).resolves.toMatchObject({ status: 429 });
    expect(graphqlCalls).toHaveLength(3);
  });

  it(`GraphQL은 ${String(GRAPHQL_CONCURRENCY)}개까지만 동시에 돌고, 그동안 REST 조회는 공용 슬롯에서 계속 나간다`, async () => {
    expect(GRAPHQL_CONCURRENCY).toBe(2);
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url !== GRAPHQL_URL) return new Response('{"ok":true}', { status: 200 });
      started.push(String(JSON.parse(String(init.body)).variables.n));
      await new Promise<void>((resolve) => { releases.push(resolve); });
      return new Response('{"data":{}}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = graphqlTransport(fetchImpl);
    const calls = [1, 2, 3].map((n) => client.postGraphql({ ...call, variables: { n } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual(['1', '2']);
    await expect(client.get({ org: 'acme', path: '/json' })).resolves.toEqual({ ok: true });
    releases.shift()?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual(['1', '2', '3']);
    for (const release of releases.splice(0)) release();
    await new Promise((r) => setTimeout(r, 20));
    for (const release of releases.splice(0)) release();
    await Promise.all(calls);
  });

  it('공용 슬롯이 다 차 있으면 GraphQL도 기다린다 — 별도 전송 줄이 아니라 공용 스케줄러를 쓴다', async () => {
    const order: string[] = [];
    const releases: (() => void)[] = [];
    const fetchImpl = (async (url: string) => {
      order.push(url === GRAPHQL_URL ? 'graphql' : 'rest');
      if (url !== GRAPHQL_URL) await new Promise<void>((resolve) => { releases.push(resolve); });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = graphqlTransport(fetchImpl, { scheduler: new RequestScheduler({ maxConcurrent: 1 }) });
    const rest = client.get({ org: 'acme', path: '/slow' });
    await new Promise((r) => setTimeout(r, 10));
    const graphql = client.postGraphql(call);
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['rest']);
    releases.shift()?.();
    await rest;
    await graphql;
    expect(order).toEqual(['rest', 'graphql']);
  });

  it('호출자가 취소하면 부르기 전·줄에서 기다리는 중·전송 중 모두 REST와 같은 GitHubApiError 모양이다', async () => {
    // 부르기 전
    const aborted = new AbortController();
    aborted.abort();
    const never = vi.fn();
    await expect(graphqlTransport(never as unknown as typeof fetch).postGraphql({ ...call, signal: aborted.signal })).rejects.toMatchObject({ name: 'GitHubApiError', kind: 'network' });
    expect(never).not.toHaveBeenCalled();

    // GraphQL 줄에서 기다리는 중 — 앞의 둘이 상한을 채웠다.
    const calls: string[] = [];
    const client = graphqlTransport(hanging(calls));
    const holders = [new AbortController(), new AbortController()];
    const held = holders.map((holder) => client.postGraphql({ ...call, signal: holder.signal }).catch((error: unknown) => error));
    await new Promise((r) => setTimeout(r, 10));
    const waiting = new AbortController();
    const third = client.postGraphql({ ...call, signal: waiting.signal });
    waiting.abort(new DOMException('deadline', 'TimeoutError'));
    await expect(third).rejects.toMatchObject({ name: 'GitHubApiError', kind: 'timeout' });
    expect(calls).toHaveLength(2);

    // 전송 중 — 사용자 취소는 network, 요청 기한은 timeout.
    holders[0]?.abort();
    holders[1]?.abort(new DOMException('deadline', 'TimeoutError'));
    const [first, second] = await Promise.all(held);
    expect(first).toBeInstanceOf(GitHubApiError);
    expect((first as GitHubApiError).kind).toBe('network');
    expect((second as GitHubApiError).kind).toBe('timeout');
  });

  it('호출 기한이 지나면 timeout이다 — timeoutMs를 주지 않으면 전송의 기본 기한이다', async () => {
    await expect(graphqlTransport(hanging()).postGraphql({ ...call, timeoutMs: 30 })).rejects.toMatchObject({ name: 'GitHubApiError', kind: 'timeout' });
    await expect(graphqlTransport(hanging(), { requestTimeoutMs: 30 }).postGraphql(call)).rejects.toMatchObject({ name: 'GitHubApiError', kind: 'timeout' });
    // 연결 오류는 network다.
    const refused = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(graphqlTransport(refused).postGraphql(call)).rejects.toMatchObject({ name: 'GitHubApiError', kind: 'network' });
  });

  it('graphqlUrl이 없거나 조회가 아닌 문서면 토큰을 빌리거나 부르기 전에 던진다', async () => {
    const fetchImpl = vi.fn();
    const lease = vi.fn();
    const pool = { ...fakePool, lease } as unknown as TokenPool;
    const bare = new GitHubTransport({ apiUrl: 'http://ghe.invalid/api/v3', requestTimeoutMs: 1_000, pool, scheduler: new RequestScheduler({ maxConcurrent: 1 }), fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(bare.postGraphql(call)).rejects.toThrow(/graphqlUrl/);
    const client = graphqlTransport(fetchImpl as unknown as typeof fetch, { pool });
    for (const query of [
      'mutation { addStar(input: {starrableId: "R_1"}) { clientMutationId } }',
      '# 주석\n  mutation Do { deleteRef(input: {refId: "x"}) { clientMutationId } }',
      'subscription { issueUpdated { id } }',
      'query A { viewer { login } } mutation B { addStar(input: {starrableId: "R_1"}) { clientMutationId } }',
      'fragment F on User { login }',
    ]) {
      await expect(client.postGraphql({ ...call, query }), query).rejects.toThrow(/mutation·subscription/);
    }
    // 괄호로 시작하는 익명 조회는 받는다.
    fetchImpl.mockResolvedValueOnce(new Response('{"data":{}}', { status: 200 }));
    lease.mockResolvedValueOnce({ installationId: 1, token: { token: 'ghs_test', expiresAt: new Date(Date.now() + 3_600_000) } });
    await expect(client.postGraphql({ ...call, query: '{ viewer { login } }' })).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(lease).toHaveBeenCalledTimes(1);
  });

  it('onResponse는 /graphql 경로와 GraphQL 잔여를 싣고 토큰은 싣지 않는다', async () => {
    const events: TransportEvent[] = [];
    const fetchImpl = (async () => new Response('{}', { status: 200, headers: { 'x-ratelimit-remaining': '17' } })) as unknown as typeof fetch;
    await graphqlTransport(fetchImpl, { onResponse: (event) => events.push(event) }).postGraphql(call);
    expect(events).toEqual([expect.objectContaining({ org: 'acme', installationId: 1, path: '/graphql', status: 200, remaining: 17, priority: 'realtime' })]);
    expect(JSON.stringify(events)).not.toContain('ghs_');
  });
});
