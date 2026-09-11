/**
 * 쓰기 경로의 HTTP 계약 (WP-075 / FR-SEQ-009, ADR-022 결정 1·2).
 *
 * **실제 로컬 HTTP 서버로 잰다.** 이 판에서 증명할 것이 메서드·경로·헤더·본문이라
 * `fetch`를 대역으로 바꾸면 검사 대상이 통째로 사라진다.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { AnnotateApiError, AnnotateClient } from '../src/client.js';
import { resolveAnnotateConfig } from '../src/config.js';
import type { AnnotateConfig } from '../src/config.js';
import { generateTestKeyPair, startMockAnnotateGhe, type MockAnnotateGhe } from './mock-annotate-ghe.js';

const KEYS = generateTestKeyPair();
const REF = { owner: 'acme', repo: 'smp1900', pullRequestNumber: 1234 } as const;

let mock: MockAnnotateGhe | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

function configFor(apiUrl: string): AnnotateConfig {
  return resolveAnnotateConfig({
    MNUMBER_ANNOTATE_ENABLED: 'true',
    GHE_API_URL: apiUrl,
    GHE_ANNOTATE_APP_ID: '77001',
    GHE_ANNOTATE_PRIVATE_KEY: KEYS.privateKey,
    GHE_ANNOTATE_INSTALLATIONS: 'acme:5150',
    GHE_ANNOTATE_REQUEST_TIMEOUT_MS: '2000',
  });
}

function clientFor(apiUrl: string): AnnotateClient {
  return new AnnotateClient({ config: configFor(apiUrl) });
}

describe('제목 갱신 요청의 모양 (§20)', () => {
  it('PATCH로, 정확한 경로에, title만 담아 보낸다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: 'Fix device initialization race' });
    const client = clientFor(mock.apiUrl);

    const echoed = await client.updateTitle(REF, '[M-1900-1] Fix device initialization race');

    expect(echoed).toBe('[M-1900-1] Fix device initialization race');
    expect(mock.currentTitle()).toBe('[M-1900-1] Fix device initialization race');

    const patch = mock.requests.find((entry) => entry.method === 'PATCH');
    expect(patch, 'PATCH 요청이 없다').toBeDefined();
    expect(patch?.path).toBe('/api/v3/repos/acme/smp1900/pulls/1234');

    /*
     * **본문에 `title` 말고는 아무 키도 없어야 한다** (ADR-022 결정 2).
     * 같은 엔드포인트가 `body`·`state`·`base`·`maintainer_can_modify`도 받으므로,
     * 키 목록 자체를 단언한다 — "state가 없다"만 보면 나중에 `base`가 늘어도 통과한다.
     */
    const sent = JSON.parse(patch?.rawBody ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['title']);
    expect(sent['title']).toBe('[M-1900-1] Fix device initialization race');
  });

  it('제목 외의 필드를 GHE에서 바꾸지 않는다', async () => {
    mock = await startMockAnnotateGhe();
    await clientFor(mock.apiUrl).updateTitle(REF, '[M-1900-1] 제목');

    for (const forbidden of ['body', 'state', 'base', 'head', 'labels', 'maintainer_can_modify', 'assignees']) {
      const leaked = mock.requests.some((entry) => entry.rawBody.includes(`"${forbidden}"`));
      expect(leaked, `${forbidden}가 요청 본문에 실렸다`).toBe(false);
    }
  });

  it('토큰은 Authorization 헤더에만 있고 경로나 본문에 없다 (THR-009)', async () => {
    mock = await startMockAnnotateGhe();
    await clientFor(mock.apiUrl).updateTitle(REF, '[M-1900-1] 제목');

    const issued = mock.issuedTokens();
    expect(issued.length).toBeGreaterThan(0);
    const patch = mock.requests.find((entry) => entry.method === 'PATCH');
    expect(patch?.headers['authorization']).toBe(`Bearer ${issued[0] as string}`);
    for (const token of issued) {
      expect(patch?.path.includes(token)).toBe(false);
      expect(patch?.rawBody.includes(token)).toBe(false);
    }
  });

  it('GHES가 지원하는 API 버전 헤더를 보낸다', async () => {
    mock = await startMockAnnotateGhe();
    await clientFor(mock.apiUrl).updateTitle(REF, '[M-1900-1] 제목');
    const patch = mock.requests.find((entry) => entry.method === 'PATCH');
    expect(patch?.headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('제목 조회는 GET이며 본문을 보내지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '원래 제목' });
    const title = await clientFor(mock.apiUrl).readTitle(REF);
    expect(title).toBe('원래 제목');
    const get = mock.requests.find((entry) => entry.method === 'GET');
    expect(get?.path).toBe('/api/v3/repos/acme/smp1900/pulls/1234');
    expect(get?.rawBody).toBe('');
    expect(mock.currentTitle()).toBe('원래 제목');
  });

  it('설치가 없는 조직에는 요청 자체를 보내지 않는다', async () => {
    mock = await startMockAnnotateGhe();
    const client = clientFor(mock.apiUrl);
    await expect(client.updateTitle({ ...REF, owner: 'other' }, '[M-1900-1] 제목')).rejects.toMatchObject({
      kind: 'permission',
    });
    expect(mock.requests).toHaveLength(0);
  });
});

describe('실패 분류 (§15 · FR-SEQ-009 예외 처리)', () => {
  const reset = Math.floor(Date.now() / 1000) + 600;

  it('대기 신호 없는 403은 권한 문제다 — 재시도하지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      patchScript: [{ status: 403, body: { message: 'Resource not accessible by integration' } }],
    });
    const error = await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnnotateApiError);
    expect((error as AnnotateApiError).kind).toBe('permission');
    expect((error as AnnotateApiError).retryable).toBe(false);
  });

  it('잔여가 0인 403은 한도다 — reset 시각까지 기다린다', async () => {
    mock = await startMockAnnotateGhe({
      patchScript: [
        {
          status: 403,
          body: { message: 'API rate limit exceeded' },
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
          },
        },
      ],
    });
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.retryAt?.getTime()).toBe(reset * 1000);
  });

  it('retry-after가 있으면 그것이 먼저다 (공식 문서 순서)', async () => {
    mock = await startMockAnnotateGhe({
      patchScript: [
        {
          status: 403,
          body: { message: 'secondary rate limit' },
          headers: {
            'retry-after': '30',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
          },
        },
      ],
    });
    const before = Date.now();
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('rate_limited');
    // reset(10분 뒤)이 아니라 retry-after(30초)를 골랐다.
    const waitMs = (error.retryAt?.getTime() ?? 0) - before;
    expect(waitMs).toBeGreaterThan(25_000);
    expect(waitMs).toBeLessThan(40_000);
  });

  it('429는 신호가 없어도 한도이며 최소 1분을 기다린다', async () => {
    mock = await startMockAnnotateGhe({
      patchScript: [{ status: 429, body: { message: 'You have exceeded a secondary rate limit' } }],
    });
    const before = Date.now();
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('rate_limited');
    expect((error.retryAt?.getTime() ?? 0) - before).toBeGreaterThanOrEqual(55_000);
  });

  it('429에 retry-after가 있으면 그 값을 쓴다', async () => {
    mock = await startMockAnnotateGhe({
      patchScript: [{ status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '5' } }],
    });
    const before = Date.now();
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('rate_limited');
    expect((error.retryAt?.getTime() ?? 0) - before).toBeLessThan(20_000);
  });

  it('404는 권한 계열이다', async () => {
    mock = await startMockAnnotateGhe({ patchScript: [{ status: 404, body: { message: 'Not Found' } }] });
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('permission');
    expect(error.retryable).toBe(false);
  });

  it('422는 이 PR에 대해 영구 실패다 — 제목을 잘라 다시 시도하지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      patchScript: [{ status: 422, body: { message: 'Validation Failed' } }],
    });
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, `[M-1900-1] ${'x'.repeat(500)}`)
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('validation');
    expect(error.retryable).toBe(false);
    // 재시도도 절삭도 없다. 요청은 한 번뿐이다.
    expect(mock.requests.filter((entry) => entry.method === 'PATCH')).toHaveLength(1);
  });

  it.each([500, 502, 503])('%d는 일시 실패다', async (status) => {
    mock = await startMockAnnotateGhe({ patchScript: [{ status, body: { message: 'boom' } }] });
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('server');
    expect(error.retryable).toBe(true);
  });

  it('401을 받으면 토큰을 버려 다음 시도가 새로 받는다', async () => {
    mock = await startMockAnnotateGhe({ patchScript: [{ status: 401, body: { message: 'Bad credentials' } }] });
    const client = clientFor(mock.apiUrl);

    const error = (await client
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.kind).toBe('auth');
    expect(error.retryable).toBe(true);
    expect(mock.tokenIssueCount()).toBe(1);

    // 두 번째 시도는 캐시를 쓰지 않고 새로 발급받는다.
    await client.updateTitle(REF, '[M-1900-1] 제목');
    expect(mock.tokenIssueCount()).toBe(2);
  });

  it('오류 본문에 자격이 섞여 와도 메시지에 남지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      patchScript: [
        {
          status: 500,
          body: { message: 'proxy echoed', authorization: 'Bearer ghs_leaked000000000000000000000000000000' },
        },
      ],
    });
    const error = (await clientFor(mock.apiUrl)
      .updateTitle(REF, '[M-1900-1] 제목')
      .catch((caught: unknown) => caught)) as AnnotateApiError;
    expect(error.message).not.toContain('ghs_leaked');
    expect(error.message).toContain('<redacted>');
  });

  it('시간 초과는 일시 실패다', async () => {
    // 응답을 주지 않는 서버. `AbortSignal.timeout`이 끊는다.
    const { createServer } = await import('node:http');
    const hang = createServer(() => {
      /* 일부러 응답하지 않는다 */
    });
    await new Promise<void>((resolve) => {
      hang.listen(0, '127.0.0.1', resolve);
    });
    const port = (hang.address() as { port: number }).port;
    try {
      const config = resolveAnnotateConfig({
        MNUMBER_ANNOTATE_ENABLED: 'true',
        GHE_API_URL: `http://127.0.0.1:${String(port)}/api/v3`,
        GHE_ANNOTATE_APP_ID: '77001',
        GHE_ANNOTATE_PRIVATE_KEY: KEYS.privateKey,
        GHE_ANNOTATE_INSTALLATIONS: 'acme:5150',
        GHE_ANNOTATE_REQUEST_TIMEOUT_MS: '1000',
      });
      const error = (await new AnnotateClient({ config })
        .updateTitle(REF, '[M-1900-1] 제목')
        .catch((caught: unknown) => caught)) as AnnotateApiError;
      expect(error.kind).toBe('timeout');
      expect(error.retryable).toBe(true);
    } finally {
      hang.closeAllConnections();
      await new Promise<void>((resolve) => {
        hang.close(() => {
          resolve();
        });
      });
    }
  }, 20_000);
});
