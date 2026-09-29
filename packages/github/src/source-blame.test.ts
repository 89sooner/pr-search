/**
 * blame 응답 분류 (CR-135, FR-SRC-005).
 *
 * 가짜 fetch로 실제 `GitHubTransport`를 거쳐 `readSourceBlame`을 부른다. GitHub GraphQL은 실패도 HTTP 200으로 주고
 * `errors`와 `data`를 **함께** 보내는 일이 흔하므로, 픽스처는 그 모양을 그대로 쓴다 — `data`가 없을 때만 `errors`를 보는
 * 분류는 여기서 걸린다. 실제 HTTP 위의 계산·오류 주입은 `testing/source-blame.test.ts`가 본다.
 */

import { describe, expect, it, vi } from 'vitest';
import { GitHubApiError } from './errors.js';
import { RequestScheduler } from './scheduler.js';
import { GitHubSourceReader } from './source-reader.js';
import { SOURCE_BLAME_QUERY, SOURCE_BLAME_TIMEOUT_MS, SourceBlameUnsupportedError, readSourceBlame, type SourceBlame } from './source-blame.js';
import type { TokenPool } from './token-pool.js';
import { GitHubTransport, type GraphqlResponse } from './transport.js';

const REF = { owner: 'acme', repo: 'app' } as const;
const PATH = 'src/pay.ts';
const REVISION = 'a'.repeat(40);
const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const NOW = new Date('2026-09-29T12:00:00.000Z');
const RESET = Math.floor(NOW.getTime() / 1000) + 900;

const fakePool = {
  availableAt: () => undefined,
  lease: async () => ({ installationId: 1, token: { token: 'ghs_test', expiresAt: new Date(Date.now() + 3_600_000) } }),
  observeResponse: () => undefined,
  observeSecondaryLimit: () => undefined,
  invalidate: () => undefined,
} as unknown as TokenPool;

function commit(sha: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oid: sha,
    messageHeadline: 'feat: 결제 재시도',
    authoredDate: '2026-01-01T00:00:00Z',
    committedDate: '2026-01-01T01:00:00Z',
    author: { name: 'Alice', user: { login: 'alice' } },
    ...overrides,
  };
}
function range(startingLine: unknown, endingLine: unknown, sha: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { startingLine, endingLine, age: 3, commit: commit(sha), ...extra };
}
function blameData(ranges: readonly unknown[], object: Record<string, unknown> = {}): Record<string, unknown> {
  return { repository: { object: { __typename: 'Commit', oid: REVISION, blame: { ranges }, ...object } } };
}
/** 온전한 blame 두 구간. */
const GOOD = blameData([range(1, 2, C1), range(3, 3, C2)]);

async function blame(status: number, body: unknown, headers: Record<string, string> = {}, pool: TokenPool = fakePool): Promise<SourceBlame | Error> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const fetchImpl = (async () => new Response(text, { status, headers })) as unknown as typeof fetch;
  const transport = new GitHubTransport({
    apiUrl: 'http://ghe.invalid/api/v3',
    graphqlUrl: 'http://ghe.invalid/api/graphql',
    requestTimeoutMs: 5_000,
    pool,
    scheduler: new RequestScheduler({ maxConcurrent: 4 }),
    now: () => NOW,
    fetchImpl,
  });
  return readSourceBlame(transport, REF, { revision: REVISION, path: PATH }).catch((error: unknown) => error as Error);
}
/** `GitHubApiError`의 종류와 회복 시각. 다른 오류면 이름을 돌려준다. */
function kindOf(result: SourceBlame | Error): { kind: string; retryAt?: number } {
  if (result instanceof GitHubApiError) return result.retryAt === undefined ? { kind: result.kind } : { kind: result.kind, retryAt: result.retryAt.getTime() };
  if (result instanceof Error) return { kind: result.name };
  return { kind: 'ok' };
}
const after = (seconds: number): number => NOW.getTime() + seconds * 1000;

describe('CR-135 FR-SRC-005 blame 성공', () => {
  it('GitHub 순서대로 구간을 옮기고, revision은 GitHub가 확인한 oid다', async () => {
    expect(await blame(200, { data: GOOD })).toEqual({
      revision: REVISION,
      path: PATH,
      ranges: [
        { startLine: 1, endLine: 2, age: 3, commit: { sha: C1, messageHeadline: 'feat: 결제 재시도', authorName: 'Alice', authorLogin: 'alice', authoredAt: '2026-01-01T00:00:00Z', committedAt: '2026-01-01T01:00:00Z' } },
        { startLine: 3, endLine: 3, age: 3, commit: { sha: C2, messageHeadline: 'feat: 결제 재시도', authorName: 'Alice', authorLogin: 'alice', authoredAt: '2026-01-01T00:00:00Z', committedAt: '2026-01-01T01:00:00Z' } },
      ],
    });
  });

  it('계정과 맞지 않는 작성자는 authorLogin이 null이고, 작성자가 없으면 이름도 null이다 — 지어내지 않는다', async () => {
    const data = blameData([
      range(1, 1, C1, { commit: commit(C1, { author: { name: 'Bob', user: null } }) }),
      range(2, 2, C2, { commit: commit(C2, { author: null }) }),
      range(3, 3, C1, { commit: commit(C1, { author: { name: null, user: { login: 'carol' } } }) }),
    ]);
    const result = await blame(200, { data });
    expect(kindOf(result).kind).toBe('ok');
    expect((result as SourceBlame).ranges.map((one) => [one.commit.authorName, one.commit.authorLogin])).toEqual([['Bob', null], [null, null], [null, 'carol']]);
  });

  it('빈 파일의 빈 ranges는 정상이다', async () => {
    expect(await blame(200, { data: blameData([]) })).toEqual({ revision: REVISION, path: PATH, ranges: [] });
  });

  it('성공 응답의 x-ratelimit-remaining: 0은 실패가 아니다 — 그 값은 한도 오류의 회복 시각에만 쓴다', async () => {
    const result = await blame(200, { data: GOOD }, { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(RESET), 'x-ratelimit-resource': 'graphql' });
    expect(kindOf(result).kind).toBe('ok');
    expect((result as SourceBlame).ranges).toHaveLength(2);
  });
});

describe('CR-135 FR-SRC-005 blame 분류 (a) HTTP 계층이 본문보다 먼저다', () => {
  it('401은 auth이고 그 설치 토큰을 무효화한다', async () => {
    const invalidate = vi.fn();
    const pool = { ...fakePool, lease: fakePool.lease.bind(fakePool), invalidate } as unknown as TokenPool;
    expect(kindOf(await blame(401, { message: 'Bad credentials' }, {}, pool))).toEqual({ kind: 'auth' });
    expect(invalidate).toHaveBeenCalledWith(1);
  });

  it('429는 secondary_rate_limited다 — retry-after가 없으면 60초 뒤, 본문이 온전한 blame이어도 같다', async () => {
    expect(kindOf(await blame(429, { data: GOOD }))).toEqual({ kind: 'secondary_rate_limited', retryAt: after(60) });
    expect(kindOf(await blame(429, { message: 'too many' }, { 'retry-after': '45' }))).toEqual({ kind: 'secondary_rate_limited', retryAt: after(45) });
  });

  it('403 + 부 한도 문구는 secondary_rate_limited이고 retry-after를 따른다 — REST 모양·GraphQL 모양·옛 문구 모두', async () => {
    const rest = { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.', documentation_url: 'https://docs.github.com' };
    expect(kindOf(await blame(403, rest, { 'retry-after': '30' }))).toEqual({ kind: 'secondary_rate_limited', retryAt: after(30) });
    const graphqlShape = { data: null, errors: [{ message: 'You have triggered an abuse detection mechanism.' }] };
    expect(kindOf(await blame(403, graphqlShape))).toEqual({ kind: 'secondary_rate_limited', retryAt: after(60) });
  });

  it('그 밖의 403은 auth다 — 본문이 JSON이 아니어도 같다', async () => {
    expect(kindOf(await blame(403, { message: 'Resource not accessible by integration' }))).toEqual({ kind: 'auth' });
    expect(kindOf(await blame(403, '<html>Forbidden</html>'))).toEqual({ kind: 'auth' });
  });

  it.each([500, 502, 504])('%i는 server다 — GitHub가 10초를 넘긴 조회를 끊은 경우를 포함한다', async (status) => {
    const body = { data: null, errors: [{ message: 'Something went wrong while executing your query. This may be the result of a timeout.' }] };
    expect(kindOf(await blame(status, body))).toEqual({ kind: 'server' });
  });

  it.each([400, 404, 422])('그 밖의 비2xx(%i)는 client다', async (status) => {
    expect(kindOf(await blame(status, { message: 'Problems parsing JSON' }))).toEqual({ kind: 'client' });
  });
});

describe('CR-135 FR-SRC-005 blame 분류 (b) 200 본문의 errors — data가 함께 와도 성공이 아니다', () => {
  it('RATE_LIMITED는 rate_limited이고 회복 시각은 x-ratelimit-reset, 없으면 60초 뒤다', async () => {
    const body = { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit already exceeded for installation ID 42.' }] };
    expect(kindOf(await blame(200, body, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(RESET) }))).toEqual({ kind: 'rate_limited', retryAt: RESET * 1000 });
    const byCode = { data: GOOD, errors: [{ message: 'rate limited', extensions: { code: 'RATE_LIMITED' } }] };
    expect(kindOf(await blame(200, byCode))).toEqual({ kind: 'rate_limited', retryAt: after(60) });
  });

  it('부 한도 문구는 secondary_rate_limited다 — retry-after가 없으면 60초 뒤', async () => {
    const body = { data: GOOD, errors: [{ message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }] };
    expect(kindOf(await blame(200, body))).toEqual({ kind: 'secondary_rate_limited', retryAt: after(60) });
    expect(kindOf(await blame(200, body, { 'retry-after': '20' }))).toEqual({ kind: 'secondary_rate_limited', retryAt: after(20) });
  });

  it('대상(저장소·리비전·경로)의 NOT_FOUND는 not_found다 — null이 전파된 모양과 blame만 빈 모양 모두', async () => {
    const repository = { data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], locations: [{ line: 2, column: 3 }], message: "Could not resolve to a Repository with the name 'acme/app'." }] };
    expect(kindOf(await blame(200, repository))).toEqual({ kind: 'not_found' });
    const fileNotFound = { type: 'NOT_FOUND', path: ['repository', 'object', 'blame'], message: "Could not resolve file for path 'src/pay.ts'." };
    // `blame`은 `Blame!`이라 실제로는 `object`가 빈다.
    expect(kindOf(await blame(200, { data: { repository: { object: null } }, errors: [fileNotFound] }))).toEqual({ kind: 'not_found' });
    expect(kindOf(await blame(200, { data: blameData([], { blame: null }), errors: [fileNotFound] }))).toEqual({ kind: 'not_found' });
  });

  it('대상이 아닌 경로의 NOT_FOUND는 파일 없음이 아니다 — server', async () => {
    const nested = { data: GOOD, errors: [{ type: 'NOT_FOUND', path: ['repository', 'object', 'blame', 'ranges', 0, 'commit'], message: 'Could not resolve to a node' }] };
    expect(kindOf(await blame(200, nested))).toEqual({ kind: 'server' });
  });

  it('FORBIDDEN은 auth다', async () => {
    const body = { data: { repository: null }, errors: [{ type: 'FORBIDDEN', path: ['repository'], extensions: { saml_failure: false }, message: 'Resource not accessible by integration' }] };
    expect(kindOf(await blame(200, body))).toEqual({ kind: 'auth' });
  });

  it('스키마에 blame이 없다는 검증 오류는 SourceBlameUnsupportedError다 — data가 없든 null이든 문구뿐이든', async () => {
    const validation = { path: ['query SourceBlame', 'repository', 'object', '... on Commit', 'blame'], extensions: { code: 'undefinedField', typeName: 'Commit', fieldName: 'blame' }, locations: [{ line: 6, column: 9 }], message: "Field 'blame' doesn't exist on type 'Commit'" };
    for (const body of [{ errors: [validation] }, { data: null, errors: [validation] }, { data: null, errors: [{ message: "Field 'blame' doesn't exist on type 'Commit'" }] }]) {
      const result = await blame(200, body);
      expect(result).toBeInstanceOf(SourceBlameUnsupportedError);
      expect(result).not.toBeInstanceOf(GitHubApiError);
    }
  });

  it('알아보지 못한 오류는 server다 — 온전해 보이는 data가 함께 와도, 한 필드만 빈 일부 결과여도', async () => {
    const unknown = { data: GOOD, errors: [{ message: 'Something went wrong while executing your query. Please include `A1:B2` when reporting this issue.' }] };
    expect(kindOf(await blame(200, unknown))).toEqual({ kind: 'server' });
    const partial = {
      data: blameData([range(1, 2, C1, { commit: commit(C1, { author: { name: 'Alice', user: null } }) }), range(3, 3, C2)]),
      errors: [{ message: 'Something went wrong', path: ['repository', 'object', 'blame', 'ranges', 0, 'commit', 'author', 'user'] }],
    };
    expect(kindOf(await blame(200, partial))).toEqual({ kind: 'server' });
  });

  it('여러 오류가 오면 (b)의 순서를 따른다 — 한도가 먼저, NOT_FOUND가 FORBIDDEN보다 먼저', async () => {
    const notFound = { type: 'NOT_FOUND', path: ['repository'], message: 'x' };
    const forbidden = { type: 'FORBIDDEN', path: ['repository'], message: 'y' };
    const limited = { type: 'RATE_LIMITED', message: 'z' };
    expect(kindOf(await blame(200, { data: { repository: null }, errors: [forbidden, notFound] }))).toEqual({ kind: 'not_found' });
    expect(kindOf(await blame(200, { data: { repository: null }, errors: [forbidden, notFound, limited] }, { 'x-ratelimit-reset': String(RESET) }))).toEqual({ kind: 'rate_limited', retryAt: RESET * 1000 });
  });

  it('원격 문구는 오류 메시지에 싣지 않는다', async () => {
    const secret = 'ghs_leakedtoken1234567890abcdef';
    for (const body of [
      { data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: `Could not resolve ${secret}` }] },
      { data: GOOD, errors: [{ message: `internal detail ${secret}` }] },
    ]) {
      const result = await blame(200, body);
      expect(result).toBeInstanceOf(GitHubApiError);
      expect((result as Error).message).not.toContain('Could not resolve');
      expect((result as Error).message).not.toContain('internal detail');
      expect((result as Error).message).not.toContain(secret);
    }
    const forbidden = await blame(403, { message: `Resource not accessible ${secret}` });
    expect((forbidden as Error).message).not.toContain('Resource not accessible');
  });
});

describe('CR-135 FR-SRC-005 blame 분류 (c) 오류 없이 data가 모자라다', () => {
  it('repository·object가 null이면 not_found다', async () => {
    expect(kindOf(await blame(200, { data: { repository: null } }))).toEqual({ kind: 'not_found' });
    expect(kindOf(await blame(200, { data: { repository: { object: null } } }))).toEqual({ kind: 'not_found' });
  });

  it.each([
    ['커밋이 아닌 객체', { data: { repository: { object: { __typename: 'Tree' } } } }],
    ['blame null', { data: blameData([], { blame: null }) }],
    ['blame 없음', { data: { repository: { object: { __typename: 'Commit', oid: REVISION } } } }],
    ['object.oid 없음', { data: blameData([], { oid: undefined }) }],
    ['data 없음', {}],
    ['data null', { data: null }],
    ['errors가 배열이 아님', { data: GOOD, errors: { message: 'x' } }],
    ['본문이 JSON이 아님', 'not json'],
  ])('%s은 server다', async (_label, body) => {
    expect(kindOf(await blame(200, body))).toEqual({ kind: 'server' });
  });

  it.each([
    ['시작 줄 0', [range(0, 1, C1)]],
    ['끝 < 시작', [range(3, 2, C1)]],
    ['내림차순', [range(3, 3, C1), range(1, 2, C2)]],
    ['겹침', [range(1, 3, C1), range(3, 4, C2)]],
    ['정수가 아닌 줄', [range(1.5, 2, C1)]],
    ['문자열 줄', [range('1', 2, C1)]],
    ['정수가 아닌 age', [range(1, 2, C1, { age: 'old' })]],
    ['귀속 커밋 없음', [range(1, 2, C1, { commit: null })]],
    ['귀속 커밋의 SHA가 이상함', [range(1, 2, C1, { commit: commit('xyz') })]],
    ['귀속 커밋의 시각이 없음', [range(1, 2, C1, { commit: commit(C1, { authoredDate: null }) })]],
    ['작성자 이름 필드가 빠짐', [range(1, 2, C1, { commit: commit(C1, { author: { user: null } }) })]],
    ['계정에 login이 없음', [range(1, 2, C1, { commit: commit(C1, { author: { name: 'A', user: {} } }) })]],
  ])('줄 구간이 %s이면 server다 — 순서·모양을 믿을 수 없는 결과를 내지 않는다', async (_label, ranges) => {
    expect(kindOf(await blame(200, { data: blameData(ranges) }))).toEqual({ kind: 'server' });
  });
});

describe('CR-135 FR-SRC-005 고정 query와 호출 모양', () => {
  it('SOURCE_BLAME_QUERY는 서버 소유 고정 query다 — blame(path:)·oid·login을 묻고 이메일은 묻지 않는다', () => {
    expect(SOURCE_BLAME_QUERY.startsWith('query SourceBlame($owner: String!, $name: String!, $revision: GitObjectID!, $path: String!)')).toBe(true);
    for (const piece of ['repository(owner: $owner, name: $name)', 'object(oid: $revision)', '__typename', '... on Commit', 'blame(path: $path)', 'startingLine', 'endingLine', 'age', 'messageHeadline', 'authoredDate', 'committedDate', 'login']) {
      expect(SOURCE_BLAME_QUERY, piece).toContain(piece);
    }
    expect(SOURCE_BLAME_QUERY).not.toMatch(/email/i);
    expect(SOURCE_BLAME_QUERY).not.toMatch(/\b(mutation|subscription|first|after)\b/);
  });

  it('reader.blame은 고정 query·변수 넷·realtime·기한 30초로 GraphQL을 한 번 부른다', async () => {
    const response: GraphqlResponse = { status: 200, body: { data: GOOD }, rateLimit: { remaining: null, reset: null, retryAfter: null, observedAt: NOW } };
    const postGraphql = vi.fn().mockResolvedValue(response);
    const reader = new GitHubSourceReader({ postGraphql } as unknown as GitHubTransport);
    await expect(reader.blame(REF, REVISION, PATH)).resolves.toMatchObject({ revision: REVISION, path: PATH });
    expect(postGraphql).toHaveBeenCalledTimes(1);
    expect(postGraphql).toHaveBeenLastCalledWith({ org: 'acme', query: SOURCE_BLAME_QUERY, variables: { owner: 'acme', name: 'app', revision: REVISION, path: PATH }, priority: 'realtime', timeoutMs: SOURCE_BLAME_TIMEOUT_MS });
    expect(SOURCE_BLAME_TIMEOUT_MS).toBe(30_000);
    const signal = new AbortController().signal;
    await reader.blame(REF, REVISION, PATH, { signal, timeoutMs: 5_000 });
    expect(postGraphql).toHaveBeenLastCalledWith(expect.objectContaining({ signal, timeoutMs: 5_000 }));
  });
});
