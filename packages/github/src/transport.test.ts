/**
 * 전송 계층의 원시 창·취소·기한 (CR-132, FR-SRC-003).
 *
 * 가짜 fetch로 본문 스트림을 조각 단위로 흘려, 창 밖을 받지 않고 끊는지와 취소·기한이 어느 단계에서든 같은 오류 모양으로
 * 끝나는지 본다. 실제 HTTP 서버에서의 동작은 통합 시험(`apps/search-api/integration/source/`)이 본다.
 */

import { describe, expect, it } from 'vitest';
import { GitHubApiError } from './errors.js';
import { RequestScheduler } from './scheduler.js';
import type { TokenPool } from './token-pool.js';
import { GitHubTransport, RAW_MIN_BYTES_PER_MS, RAW_READ_CONCURRENCY } from './transport.js';

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
