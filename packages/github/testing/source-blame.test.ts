/**
 * blame을 실제 HTTP 위에서 (CR-135, FR-SRC-005).
 *
 * GHE 대역의 `POST /api/graphql`에 실제 설치 토큰 발급·`GitHubTransport`·`GitHubSourceReader.blame`으로 묻는다. 대역은
 * mock-source 이력에서 blame을 계산하므로, 여기서는 줄 귀속이 이력과 맞는지와 오류 주입 옵션이 분류의 갈래로 끝나는지를 본다.
 * 분류 갈래 하나하나는 `src/source-blame.test.ts`가 본다.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  GitHubApiError,
  GitHubSourceReader,
  GitHubTransport,
  InstallationTokenProvider,
  RequestScheduler,
  SourceBlameUnsupportedError,
  TokenPool,
  resolveGitHubConfig,
  type SourceBlame,
} from '../src/index.js';
import { generateTestKeyPair, startMockGhe, type MockGhe, type MockGraphqlOptions } from './mock-ghe.js';
import { buildMockSource } from './mock-source.js';

const keys = generateTestKeyPair();
const REF = { owner: 'acme', repo: 'app' } as const;
const NOW = new Date('2026-09-29T12:00:00.000Z');

/**
 * `src/pay.ts`를 네 번 고친 이력. 마지막 커밋은 다른 파일만 고친다 — 귀속에 끼어들면 안 된다.
 *
 * | # | 작성자 | `src/pay.ts` |
 * | 0 | alice | a b c d |
 * | 1 | bob | a **B** c d |
 * | 2 | carol(계정 없음) | a B c d **e f** |
 * | 3 | dave | **z** a B d e f (c 삭제) |
 * | 4 | erin | (README만) |
 */
const REPO = buildMockSource({
  owner: 'acme',
  repo: 'app',
  commits: [
    { message: 'init: 결제 모듈\n\n본문은 제목에 싣지 않는다', author: 'alice', changes: { 'src/pay.ts': 'a\nb\nc\nd\n', 'README.md': 'readme\n', 'empty.txt': '' } },
    { message: 'fix: b를 고친다', author: 'bob', changes: { 'src/pay.ts': 'a\nB\nc\nd\n' } },
    { message: 'feat: 끝에 두 줄', author: 'carol', login: null, changes: { 'src/pay.ts': 'a\nB\nc\nd\ne\nf\n' } },
    { message: 'refactor: 머리에 z를 넣고 c를 지운다', author: 'dave', changes: { 'src/pay.ts': 'z\na\nB\nd\ne\nf\n' } },
    { message: 'docs: README', author: 'erin', changes: { 'README.md': 'readme v2\n' } },
  ],
});
const sha = (index: number): string => REPO.commitShas[index] ?? '';
const HEAD = sha(4);
const hour = (index: number): string => new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString();
const by = (index: number, headline: string, name: string, login: string | null) => ({
  sha: sha(index), messageHeadline: headline, authorName: name, authorLogin: login, authoredAt: hour(index), committedAt: hour(index),
});

interface Harness {
  readonly ghe: MockGhe;
  readonly reader: GitHubSourceReader;
  readonly transport: GitHubTransport;
  readonly pool: TokenPool;
  readonly provider: InstallationTokenProvider;
}
let current: Harness | undefined;

async function build(graphql?: MockGraphqlOptions, extra: { unauthorizedTimes?: number } = {}): Promise<Harness> {
  const ghe = await startMockGhe({ source: { repositories: [REPO] }, ...(graphql ? { graphql } : {}), ...extra });
  // 발급기는 실제 시계를 쓴다(대역이 실제 시각으로 만료를 계산한다). 한도 시각만 전송의 고정 시계로 잰다.
  const provider = new InstallationTokenProvider({ apiUrl: ghe.apiUrl, appId: '12345', privateKey: keys.privateKey, refreshLeadMs: 60_000, requestTimeoutMs: 5_000 });
  const pool = new TokenPool(provider, { installations: [{ org: 'acme', installationId: 42 }], quarantineThreshold: 0.1 });
  const transport = new GitHubTransport({ apiUrl: ghe.apiUrl, graphqlUrl: ghe.graphqlUrl, requestTimeoutMs: 5_000, pool, scheduler: new RequestScheduler({ maxConcurrent: 4 }), now: () => NOW });
  current = { ghe, reader: new GitHubSourceReader(transport), transport, pool, provider };
  return current;
}

afterEach(async () => {
  await current?.ghe.close();
  current = undefined;
});

const failure = (promise: Promise<SourceBlame>): Promise<unknown> => promise.then(() => 'ok', (error: unknown) => error);

describe('CR-135 FR-SRC-005 GHE 대역의 blame 계산 (실제 HTTP)', () => {
  it('네 번 고친 파일의 줄 귀속 — 바뀌지 않은 줄은 앞 커밋을 물려받고, 계정 없는 작성자는 login이 null이다', async () => {
    const { reader } = await build();
    expect(await reader.blame(REF, HEAD, 'src/pay.ts')).toEqual({
      revision: HEAD,
      path: 'src/pay.ts',
      ranges: [
        { startLine: 1, endLine: 1, age: 1, commit: by(3, 'refactor: 머리에 z를 넣고 c를 지운다', 'dave', 'dave') },
        { startLine: 2, endLine: 2, age: 10, commit: by(0, 'init: 결제 모듈', 'alice', 'alice') },
        { startLine: 3, endLine: 3, age: 7, commit: by(1, 'fix: b를 고친다', 'bob', 'bob') },
        { startLine: 4, endLine: 4, age: 10, commit: by(0, 'init: 결제 모듈', 'alice', 'alice') },
        { startLine: 5, endLine: 6, age: 4, commit: by(2, 'feat: 끝에 두 줄', 'carol', null) },
      ],
    });
  });

  it('이전 리비전을 고르면 그 리비전의 귀속이다 — 같은 커밋이 이어지는 줄은 한 구간이다', async () => {
    const { reader } = await build();
    const result = await reader.blame(REF, sha(1), 'src/pay.ts');
    expect(result.revision).toBe(sha(1));
    // 대문자로 청해도 소문자로 보낸다 — 대역은 대소문자를 가려 찾으므로, 그대로 보내면 없는 리비전이 된다.
    await expect(reader.blame(REF, sha(1).toUpperCase(), 'src/pay.ts')).resolves.toMatchObject({ revision: sha(1) });
    expect(result.ranges.map((range) => [range.startLine, range.endLine, range.commit.sha, range.age])).toEqual([
      [1, 1, sha(0), 10],
      [2, 2, sha(1), 1],
      [3, 4, sha(0), 10],
    ]);
  });

  it('빈 파일은 빈 ranges이고, 없는 경로·없는 리비전·커밋이 아닌 객체는 not_found다', async () => {
    const { reader } = await build();
    await expect(reader.blame(REF, HEAD, 'empty.txt')).resolves.toEqual({ revision: HEAD, path: 'empty.txt', ranges: [] });
    expect(await failure(reader.blame(REF, HEAD, 'src/nope.ts'))).toMatchObject({ name: 'GitHubApiError', kind: 'not_found' });
    expect(await failure(reader.blame(REF, 'f'.repeat(40), 'src/pay.ts'))).toMatchObject({ name: 'GitHubApiError', kind: 'not_found' });
    expect(await failure(reader.blame({ owner: 'acme', repo: 'nope' }, HEAD, 'src/pay.ts'))).toMatchObject({ name: 'GitHubApiError', kind: 'not_found' });
    const tree = REPO.commits.get(HEAD)?.tree ?? '';
    expect(await failure(reader.blame(REF, tree, 'src/pay.ts'))).toMatchObject({ name: 'GitHubApiError', kind: 'not_found' });
  });

  it('요청 — 고정 query 한 건에 변수 넷, 토큰은 Authorization 헤더로만 간다. GET /api/graphql은 404다', async () => {
    const { reader, ghe } = await build();
    await reader.blame(REF, HEAD, 'src/pay.ts');
    expect(ghe.graphqlRequests).toEqual([{ variables: { owner: 'acme', name: 'app', revision: HEAD, path: 'src/pay.ts' }, fixedQuery: true }]);
    const posted = ghe.requests.filter((request) => request.path === '/api/graphql');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.method).toBe('POST');
    expect(posted[0]?.authorization).toMatch(/^Bearer ghs_mock/);
    // 배포 설정이 REST 루트에서 도출하는 주소가 대역의 GraphQL 끝점과 같다 — search-api는 이 경로로 대역에 닿는다.
    expect(resolveGitHubConfig({ GHE_API_URL: ghe.apiUrl }).graphqlUrl).toBe(ghe.graphqlUrl);
    expect((await fetch(ghe.graphqlUrl)).status).toBe(404);
  });

  it('대역은 고정 query가 아닌 문서를 실행하지 않는다 — 검증 오류 모양으로 거절하고 기록에 남긴다', async () => {
    const { transport, ghe } = await build();
    const response = await transport.postGraphql({ org: 'acme', query: '{ viewer { login } }', variables: {} });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ errors: [{ extensions: { code: 'mockUnknownDocument' } }] });
    expect(response.body).not.toHaveProperty('data');
    expect(ghe.graphqlRequests).toEqual([{ variables: {}, fixedQuery: false }]);
  });

  it('REST 쪽 오류 주입은 GraphQL에 걸리지 않는다 — 401 한 번은 뒤따르는 REST 호출이 받는다', async () => {
    const { reader } = await build(undefined, { unauthorizedTimes: 1 });
    await expect(reader.blame(REF, HEAD, 'src/pay.ts')).resolves.toMatchObject({ revision: HEAD });
    await expect(reader.repository(REF)).rejects.toMatchObject({ kind: 'auth', status: 401 });
  });
});

describe('CR-135 FR-SRC-005 GHE 대역의 오류 주입이 분류의 갈래로 끝난다 (실제 HTTP)', () => {
  const RESET = Math.floor(NOW.getTime() / 1000) + 1_800;

  it.each<[string, MockGraphqlOptions, Record<string, unknown>]>([
    ['rate_limited', { failure: 'rate_limited', rateHeaders: { remaining: 100, reset: RESET } }, { kind: 'rate_limited', status: 200, retryAt: new Date(RESET * 1000) }],
    ['secondary_200', { failure: 'secondary_200' }, { kind: 'secondary_rate_limited', status: 200, retryAt: new Date(NOW.getTime() + 60_000) }],
    ['secondary_403', { failure: 'secondary_403' }, { kind: 'secondary_rate_limited', status: 403, retryAt: new Date(NOW.getTime() + 30_000) }],
    ['secondary_429', { failure: 'secondary_429' }, { kind: 'secondary_rate_limited', status: 429, retryAt: new Date(NOW.getTime() + 30_000) }],
    ['forbidden', { failure: 'forbidden' }, { kind: 'auth', status: 200 }],
    ['not_found', { failure: 'not_found' }, { kind: 'not_found', status: 200 }],
    ['partial', { failure: 'partial' }, { kind: 'server', status: 200 }],
    ['server_502', { failure: 'server_502' }, { kind: 'server', status: 502 }],
    ['unauthorized', { failure: 'unauthorized' }, { kind: 'auth', status: 401 }],
  ])('%s', async (_label, graphql, expected) => {
    const { reader } = await build(graphql);
    const error = await failure(reader.blame(REF, HEAD, 'src/pay.ts'));
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject(expected);
  });

  it('blame: unsupported는 SourceBlameUnsupportedError다 — 일시 장애·권한과 다른 오류다', async () => {
    const { reader } = await build({ blame: 'unsupported' });
    const error = await failure(reader.blame(REF, HEAD, 'src/pay.ts'));
    expect(error).toBeInstanceOf(SourceBlameUnsupportedError);
    expect(error).not.toBeInstanceOf(GitHubApiError);
  });

  it('401은 토큰을 무효화한다 — 다음 호출이 새 설치 토큰을 받는다', async () => {
    const { reader, provider } = await build({ failure: 'unauthorized' });
    await failure(reader.blame(REF, HEAD, 'src/pay.ts'));
    expect(provider.issueCount).toBe(1);
    await failure(reader.blame(REF, HEAD, 'src/pay.ts'));
    expect(provider.issueCount).toBe(2);
  });

  it('rateHeaders는 성공 응답에도 붙고, 잔여 0이어도 성공이며 REST 토큰 상태에 들어가지 않는다', async () => {
    const { reader, transport, pool } = await build({ rateHeaders: { remaining: 0, reset: RESET } });
    await expect(reader.blame(REF, HEAD, 'src/pay.ts')).resolves.toMatchObject({ revision: HEAD });
    const raw = await transport.postGraphql({ org: 'acme', query: '{ viewer { login } }', variables: {} });
    expect(raw.rateLimit).toMatchObject({ remaining: 0, reset: new Date(RESET * 1000) });
    expect(pool.isAvailable('acme')).toBe(true);
    expect(pool.remainingByInstallation().size).toBe(0);
    // REST 조회도 그대로 나간다.
    await expect(reader.repository(REF)).resolves.toMatchObject({ default_branch: 'main' });
  });

  it('delayMs가 호출 기한을 넘기면 timeout, 호출자가 끊으면 network다', async () => {
    const { reader } = await build({ delayMs: 300 });
    expect(await failure(reader.blame(REF, HEAD, 'src/pay.ts', { timeoutMs: 50 }))).toMatchObject({ name: 'GitHubApiError', kind: 'timeout' });
    const controller = new AbortController();
    const pending = failure(reader.blame(REF, HEAD, 'src/pay.ts', { signal: controller.signal }));
    setTimeout(() => controller.abort(), 30);
    expect(await pending).toMatchObject({ name: 'GitHubApiError', kind: 'network' });
  });
});
