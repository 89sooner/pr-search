/**
 * 태그 클라이언트 — 실제 HTTP로 건다 (WP-100 / FR-SEQ-012 AC-1·AC-3·AC-8).
 *
 * 목은 `node:http` 서버다. 여기서 증명할 것은 전송 그 자체다: 생성이 `POST /git/refs`에
 * `{ref, sha}` 둘만 싣는가, 토큰이 헤더에만 있는가, 422·404·403·429가 어느 오류 종류로
 * 옮겨지는가, 목록이 페이지를 끝까지 읽는가, 그리고 **이동·삭제 요청이 한 번도 없는가**.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TagApiError, TagClient, leavesOutcomeUnknown } from './client.js';
import { resolveTagConfig } from './config.js';
import { generateTestKeyPair, startMockTagGhe, type MockTagGhe } from '../testing/mock-tag-ghe.js';

const KEYS = generateTestKeyPair();
const REPO = { owner: 'acme', repo: 'smp1900' };
const SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';

let mock: MockTagGhe | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

function clientFor(ghe: MockTagGhe, extra: Record<string, string> = {}): TagClient {
  const config = resolveTagConfig({
    MNUMBER_TAG_ENABLED: 'true',
    GHE_API_URL: ghe.apiUrl,
    GHE_TAG_APP_ID: '99001',
    GHE_TAG_PRIVATE_KEY: KEYS.privateKey,
    GHE_TAG_INSTALLATIONS: 'acme:5150',
    GHE_TAG_REQUEST_TIMEOUT_MS: '1500',
    ...extra,
  });
  return new TagClient({ config });
}

describe('생성은 lightweight ref 하나다 (AC-1)', () => {
  it('`POST /git/refs`에 `{ref, sha}`만 싣고, 토큰은 헤더에만 있다', async () => {
    mock = await startMockTagGhe({ knownShas: [SHA] });
    const client = clientFor(mock);

    const created = await client.createTagRef(REPO, 'M-1900-1450', SHA.toUpperCase());

    expect(created.sha).toBe(SHA);
    const post = mock.requests.find((one) => one.method === 'POST' && one.path.endsWith('/git/refs'));
    expect(post).toBeDefined();
    expect(JSON.parse(post?.rawBody ?? '{}')).toEqual({ ref: 'refs/tags/M-1900-1450', sha: SHA });
    expect(post?.path).toBe('/api/v3/repos/acme/smp1900/git/refs');
    expect(post?.headers['authorization']).toMatch(/^Bearer ghs_tag/);
    expect(post?.path).not.toContain('ghs_');
    expect(mock.refs().get('M-1900-1450')).toEqual({ sha: SHA, type: 'commit' });
  });

  it('**이동·삭제 요청은 어떤 경로에서도 나가지 않는다** (AC-3·AC-8)', async () => {
    mock = await startMockTagGhe({ initialRefs: { 'M-1900-1': { sha: 'b'.repeat(40), type: 'commit' } }, knownShas: [SHA] });
    const client = clientFor(mock);

    await client.readTagRef(REPO, 'M-1900-1');
    await client.createTagRef(REPO, 'M-1900-2', SHA);
    await client.listTagRefs(REPO, 'M-1900-');

    expect(mock.requests.filter((one) => one.method === 'PATCH' || one.method === 'DELETE')).toEqual([]);
    // 코드 경로 자체가 없다 — 회귀 시험이 같은 사실을 소스에서 잠근다.
    const source = readFileSync(fileURLToPath(new URL('./client.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/'PATCH'|'DELETE'/);
  });
});

describe('조회 (AC-3 멱등의 재료)', () => {
  it('없는 ref는 `missing`이다', async () => {
    mock = await startMockTagGhe();
    expect(await clientFor(mock).readTagRef(REPO, 'M-1900-9')).toEqual({ kind: 'missing' });
  });

  it('있는 ref는 SHA(소문자)와 객체 유형을 준다 — annotated는 `tag`다', async () => {
    mock = await startMockTagGhe({ initialRefs: { 'M-1900-1': { sha: SHA, type: 'commit' }, 'M-1900-2': { sha: 'c'.repeat(40), type: 'tag' } } });
    const client = clientFor(mock);
    expect(await client.readTagRef(REPO, 'M-1900-1')).toEqual({ kind: 'found', sha: SHA, objectType: 'commit' });
    expect(await client.readTagRef(REPO, 'M-1900-2')).toEqual({ kind: 'found', sha: 'c'.repeat(40), objectType: 'tag' });
  });

  it('이름은 URL 경로에 인코딩되어 실린다', async () => {
    mock = await startMockTagGhe();
    await clientFor(mock).readTagRef(REPO, 'M-1900-1');
    expect(mock.requests.at(-1)?.path).toBe('/api/v3/repos/acme/smp1900/git/ref/tags/M-1900-1');
  });
});

describe('목록 — 대조의 재료', () => {
  it('접두로 거르고 100개씩 페이지를 끝까지 읽는다', async () => {
    const initial: Record<string, { sha: string; type: 'commit' }> = {};
    for (let n = 1; n <= 205; n += 1) initial[`M-1900-${String(n)}`] = { sha: String(n).padStart(40, '0'), type: 'commit' };
    initial['M-1901-1'] = { sha: 'd'.repeat(40), type: 'commit' };
    mock = await startMockTagGhe({ initialRefs: initial });

    const listed = await clientFor(mock).listTagRefs(REPO, 'M-1900-');

    expect(listed.truncated).toBe(false);
    expect(listed.refs).toHaveLength(205);
    expect(listed.refs.some((one) => one.name === 'M-1901-1')).toBe(false);
    const pages = mock.requests.filter((one) => one.path.includes('/git/matching-refs/tags/M-1900-'));
    expect(pages).toHaveLength(3);
    expect(pages[0]?.path).toContain('per_page=100&page=1');
  });
});

describe('오류 분류 — 문서가 보장하는 신호만 쓴다', () => {
  it('422는 `unprocessable`이다 — 본문 문구로 가르지 않고 호출부가 다시 읽는다', async () => {
    mock = await startMockTagGhe({ initialRefs: { 'M-1900-1': { sha: SHA, type: 'commit' } } });
    await expect(clientFor(mock).createTagRef(REPO, 'M-1900-1', SHA)).rejects.toMatchObject({ kind: 'unprocessable', status: 422, retryable: false });
    mock.deleteRef('M-1900-1');
  });

  it('모르는 SHA도 같은 422다', async () => {
    mock = await startMockTagGhe({ knownShas: [SHA] });
    await expect(clientFor(mock).createTagRef(REPO, 'M-1900-1', 'e'.repeat(40))).rejects.toMatchObject({ kind: 'unprocessable', status: 422 });
  });

  it('변경 요청의 404·403은 권한이다 — 재시도하지 않는다', async () => {
    mock = await startMockTagGhe({ postScript: [{ status: 404, body: { message: 'Not Found' } }, { status: 403, body: { message: 'Resource not accessible by integration' } }] });
    const client = clientFor(mock);
    await expect(client.createTagRef(REPO, 'M-1900-1', SHA)).rejects.toMatchObject({ kind: 'permission', status: 404, retryable: false });
    await expect(client.createTagRef(REPO, 'M-1900-1', SHA)).rejects.toMatchObject({ kind: 'permission', status: 403 });
  });

  it('대기 신호가 있는 403과 429는 한도다', async () => {
    mock = await startMockTagGhe({
      postScript: [
        { status: 403, body: { message: 'rate' }, headers: { 'retry-after': '7' } },
        { status: 429, body: { message: 'rate' } },
      ],
    });
    const client = clientFor(mock);
    const first = await client.createTagRef(REPO, 'M-1900-1', SHA).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(TagApiError);
    expect((first as TagApiError).kind).toBe('rate_limited');
    expect((first as TagApiError).retryAt).toBeInstanceOf(Date);
    const second = await client.createTagRef(REPO, 'M-1900-1', SHA).catch((error: unknown) => error);
    expect((second as TagApiError).kind).toBe('rate_limited');
  });

  it('5xx는 서버 오류이며 결과를 모르는 실패다', async () => {
    mock = await startMockTagGhe({ postScript: [{ status: 502, body: { message: 'bad gateway' } }] });
    const error = await clientFor(mock).createTagRef(REPO, 'M-1900-1', SHA).catch((one: unknown) => one);
    expect((error as TagApiError).kind).toBe('server');
    expect(leavesOutcomeUnknown((error as TagApiError).kind)).toBe(true);
  });

  it('시한 초과는 `timeout`이고 결과를 모르는 실패다', async () => {
    mock = await startMockTagGhe({ postScript: [{ status: 201, body: { ref: 'refs/tags/M-1900-1', object: { type: 'commit', sha: SHA } }, delayMs: 800 }] });
    const client = clientFor(mock, { GHE_TAG_REQUEST_TIMEOUT_MS: '1000' });
    await expect(client.createTagRef(REPO, 'M-1900-1', SHA)).resolves.toEqual({ sha: SHA });
    mock.deleteRef('M-1900-1');
  }, 10_000);

  it('설치가 없는 조직은 권한 계열이다 — GHE를 부르지 않는다', async () => {
    mock = await startMockTagGhe();
    await expect(clientFor(mock).readTagRef({ owner: 'other', repo: 'x' }, 'M-1-1')).rejects.toMatchObject({ kind: 'permission' });
    expect(mock.requests).toEqual([]);
  });
});
