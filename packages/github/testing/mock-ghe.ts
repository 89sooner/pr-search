/**
 * 가짜 GitHub Enterprise 서버.
 *
 * 실제 `node:http` 서버다. fetch를 목으로 바꾸지 않는 이유는, 이 WP에서 검증할
 * 것 대부분이 **HTTP 헤더와 상태 코드에 대한 반응**이기 때문이다 — rate limit
 * 헤더 파싱, 429 + `retry-after`, 401 후 토큰 재발급. fetch를 가로채면 그
 * 경로를 통째로 건너뛰고 아무것도 증명하지 못한다.
 *
 * WP-007 보강 워커도 같은 서버를 쓴다.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { SOURCE_BLAME_QUERY } from '../src/source-blame.js';
import { handleMockSource, mockBlame, type MockRawRead, type MockSourceOptions, type MockSourceRepository } from './mock-source.js';

/**
 * `GET /pulls/{n}/commits`가 한 PR에 대해 돌려주는 최대 건수 (CR-116).
 *
 * **GitHub API 자체의 상한**이다. 우리 클라이언트의 `MAX_PR_COMMITS`와 값이 같지만
 * 같은 것이 아니다 — 이쪽은 원격이 자르는 지점이고, 그쪽은 우리가 더 받지 않기로
 * 한 지점이다. 한쪽에서 다른 쪽을 가져다 쓰면 둘 중 하나가 움직인 날 나머지가
 * 조용히 따라 움직인다.
 *
 * 이 상한이 위험한 까닭은 **잘렸다는 표식을 남기지 않는다**는 데 있다. 400 커밋
 * PR의 마지막 페이지는 `per_page`보다 짧게 와서 `Link`의 `rel="next"`가 없고,
 * 그래서 `getAllPaged`의 `truncated`는 거짓이 된다. 응답만으로는 정확히 250 커밋인
 * PR과 구분되지 않는다 — 가르는 유일한 재료가 PR 상세의 `commits`다.
 */
export const GITHUB_PR_COMMITS_API_LIMIT = 250;

export interface RateLimitPlan {
  readonly limit: number;
  /** 요청마다 순서대로 적용할 잔여 값. 다 쓰면 마지막 값을 유지한다. */
  readonly remaining: readonly number[];
  /** epoch 초. */
  readonly resetAt: number;
}

export interface MockGheOptions {
  /** 설치 토큰의 수명(ms). 갱신 동작을 보려면 짧게 준다. */
  readonly tokenTtlMs?: number;
  readonly rateLimit?: RateLimitPlan;
  /** 이 횟수만큼 429를 돌려준 뒤 정상 응답한다. */
  readonly secondaryLimitTimes?: number;
  readonly retryAfterSeconds?: number;
  /** 429를 주되 `retry-after` 헤더를 빼고 보낸다. */
  readonly omitRetryAfter?: boolean;
  /** 이 횟수만큼 401을 돌려준 뒤 정상 응답한다. */
  readonly unauthorizedTimes?: number;
  /**
   * 오류 본문에 받은 Authorization 헤더를 그대로 되비춘다.
   *
   * 지어낸 상황이 아니다 — 잘못 구성된 프록시나 게이트웨이가 요청 헤더를 오류
   * 본문에 담아 돌려주는 일이 실제로 있다. redaction이 존재하는 이유가 이것이고,
   * 이 경로가 있어야 "토큰이 로그에 남지 않는다"를 시험으로 증명할 수 있다.
   */
  readonly echoAuthorizationInError?: boolean;
  /**
   * 목록 자원의 크기 (WP-007 절삭 시험).
   *
   * 생략하면 1건짜리 기본 목록을 준다. 값을 주면 그만큼 만들어 `per_page`대로
   * 페이지를 나눠 준다 — 절삭 판정이 진짜 페이지네이션 위에서 검증된다.
   */
  readonly resources?: {
    readonly commits?: number;
    readonly files?: number;
    readonly reviews?: number;
  };
  /**
   * 커밋 목록 끝점이 실제 GitHub처럼 `GITHUB_PR_COMMITS_API_LIMIT`에서 스스로
   * 자른다 (CR-116). PR 상세의 `commits`는 그래도 **전체 수**를 말하므로, 켜면
   * "목록은 250건인데 PR은 400건이라고 한다"는 실제 상황이 그대로 만들어진다.
   *
   * **기본으로 켜 두지 않은 까닭**이 있다. 우리 클라이언트의 `MAX_PR_COMMITS`
   * 절삭 판정은 250건을 **넘겨** 받아 봐야 검증되는데, 원격이 먼저 자르면 그런
   * 응답은 영영 오지 않는다. 그래서 이 목은 두 역할을 겸한다 — 켜면 GitHub을
   * 그대로 흉내 내고, 끄면 우리 상한을 시험할 수 있는 "250건을 넘겨 주는 서버"가
   * 된다. 끈 쪽은 실제로는 오지 않는 응답이라는 뜻이다.
   */
  readonly capCommitListAtApiLimit?: boolean;
  /** 특정 자원만 실패시킨다. 부분 보강 시험용. */
  readonly failures?: readonly ResourceFailure[];
  /**
   * source 조회용 저장소 (CR-132, `mock-source.ts`). 주면 그 저장소의 경로를 Git 객체 저장소로 답한다 — 다른 경로와
   * 기존 시험의 응답은 그대로다.
   */
  readonly source?: MockSourceOptions & { readonly repositories: readonly MockSourceRepository[] };
  /**
   * GraphQL 끝점 `POST /api/graphql` (CR-135). 고정 blame query(`SOURCE_BLAME_QUERY`)만 알아보고, `source.repositories`의
   * 이력에서 blame을 계산해 답한다. REST 쪽 옵션(`rateLimit`·`unauthorizedTimes`·`secondaryLimitTimes`)은 GraphQL에
   * 걸리지 않는다 — GraphQL의 실패는 이 옵션으로만 만든다.
   */
  readonly graphql?: MockGraphqlOptions;
}

/**
 * GraphQL 실패 흉내 (CR-135). 설정하면 **모든** GraphQL 요청에 적용된다.
 *
 * - `unauthorized`: 401. `secondary_429`·`secondary_403`: 부 한도 문구 + `retry-after: 30`. `server_502`: GitHub가 10초를
 *   넘긴 조회를 끊을 때의 502.
 * - `rate_limited`: 200 + `errors[].type: RATE_LIMITED` + `x-ratelimit-remaining: 0`(회복 시각은 `rateHeaders.reset`, 없으면
 *   한 시간 뒤). `secondary_200`: 200 + 부 한도 문구, `retry-after` 없음.
 * - `forbidden`·`not_found`: 200 + `data.repository: null` + 그 오류(`path: ['repository']`).
 * - `partial`: 계산한 blame에서 첫 구간의 `author.user`를 비우고 그 경로의 일반 오류를 함께 준다 — `data`와 `errors`가 같이 온다.
 */
export type MockGraphqlFailure =
  | 'rate_limited'
  | 'secondary_200'
  | 'secondary_403'
  | 'secondary_429'
  | 'forbidden'
  | 'not_found'
  | 'partial'
  | 'server_502'
  | 'unauthorized';

export interface MockGraphqlOptions {
  /** 기본 `compute`(이력에서 계산). `unsupported`는 `Commit.blame`이 없는 스키마의 검증 오류(`undefinedField`)를 준다. */
  readonly blame?: 'compute' | 'unsupported';
  readonly failure?: MockGraphqlFailure;
  /** 응답 전 지연(ms). 호출 기한·취소 시험용. */
  readonly delayMs?: number;
  /** GraphQL 한도 헤더. 주면 성공 응답을 포함한 모든 GraphQL 응답에 붙인다(`x-ratelimit-resource: graphql`). */
  readonly rateHeaders?: { readonly remaining: number; readonly reset: number };
}

/** 받은 GraphQL 요청 (CR-135). `fixedQuery`는 문서가 `SOURCE_BLAME_QUERY`와 같았는가다. */
export interface MockGraphqlRequest {
  readonly variables: Readonly<Record<string, unknown>> | null;
  readonly fixedQuery: boolean;
}

export type MockResource = 'pull_request' | 'commits' | 'files' | 'reviews';

export interface ResourceFailure {
  readonly resource: MockResource;
  readonly status: number;
  /** 이 횟수만큼만 실패하고 이후에는 정상 응답한다. 생략하면 계속 실패한다. */
  readonly times?: number;
}

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  /** 요청의 `Accept` (CR-132 — 원시·object 미디어 타입을 확인한다). */
  readonly accept?: string | undefined;
}

export interface MockGhe {
  readonly apiUrl: string;
  /** GHES 모양의 GraphQL 끝점 — REST 루트(`/api/v3`)의 형제인 `/api/graphql`이다 (CR-135). */
  readonly graphqlUrl: string;
  readonly requests: ReceivedRequest[];
  /** 받은 GraphQL 요청 (CR-135). 토큰 발급·REST 요청은 싣지 않는다. */
  readonly graphqlRequests: MockGraphqlRequest[];
  /** 설치 토큰 발급 횟수. */
  readonly tokenIssueCount: () => number;
  /** 지금까지 발급한 토큰 값. redaction 시험에서 "이 값이 로그에 없는가"를 본다. */
  readonly issuedTokens: () => readonly string[];
  /** 원시 본문 응답마다 보낸 바이트와 받는 쪽이 끊었는지 (CR-132). */
  readonly rawReads: () => readonly MockRawRead[];
  close(): Promise<void>;
}

export interface TestKeyPair {
  readonly privateKey: string;
  readonly publicKey: string;
}

/** 테스트용 RSA 키. 실제 App 키를 쓰지 않는다. */
export function generateTestKeyPair(): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey };
}

const PR = {
  number: 1234,
  title: 'feat: 결제 재시도 로직',
  body: '결제 실패 시 지수 백오프로 재시도한다.',
  state: 'closed',
  draft: false,
  labels: [{ name: 'payments' }, { name: 'bug' }],
  user: { login: 'jdoe' },
  merged: true,
  merge_commit_sha: 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5',
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-02T10:30:00Z',
  closed_at: '2026-08-02T10:30:00Z',
  merged_at: '2026-08-02T10:30:00Z',
  head: { ref: 'feature/retry', sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e' },
  base: { ref: 'main', sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e' },
};

/** `page`/`per_page`에 맞춰 잘라 준다. 실제 GitHub과 같은 규칙이어야 절삭 판정을 시험할 수 있다. */
function paginate<T>(items: readonly T[], url: URL): T[] {
  const page = Number(url.searchParams.get('page') ?? '1');
  const perPage = Number(url.searchParams.get('per_page') ?? '100');
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

function makeCommits(count: number): { sha: string; parents: { sha: string }[]; commit: { message: string } }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    sha: `c${String(index).padStart(39, '0')}`,
    parents: [{ sha: `p${String(index).padStart(39, '0')}` }],
    commit: { message: `commit ${String(index)}` },
  }));
}

function makeFiles(count: number): { filename: string; additions: number; deletions: number; status: string }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    filename: `src/file-${String(index)}.ts`,
    additions: 1,
    deletions: 0,
    status: 'modified',
  }));
}

function makeReviews(count: number): {
  id: number;
  state: string;
  user: { login: string };
  submitted_at: string;
}[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: index + 1,
    state: 'APPROVED',
    user: { login: `reviewer-${String(index)}` },
    submitted_at: '2026-08-20T00:00:00Z',
  }));
}

const GRAPHQL_DOCS = 'https://docs.github.com/graphql';
const SECONDARY_LIMIT_MESSAGE =
  'You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID 0000:1111:2222:3333.';
const GRAPHQL_FAILURE_MESSAGE =
  'Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug. Please include `0000:1111:2222:3333` when reporting this issue.';

type GraphqlReply = (status: number, body: unknown, headers?: Record<string, string>) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** GraphQL 한도 헤더 다섯 (CR-135). GitHub는 GraphQL 응답마다 이 모양으로 준다. */
function graphqlRateHeaders(remaining: number, reset: number): Record<string, string> {
  return {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-used': String(5000 - remaining),
    'x-ratelimit-reset': String(reset),
    'x-ratelimit-resource': 'graphql',
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * `POST /api/graphql` 한 건 (CR-135). GitHub의 순서를 따른다 — 인증·한도가 먼저, 그다음 문서 검증, 그다음 실행이다.
 * 고정 query가 아니면 실행하지 않는다.
 */
function answerGraphql(
  raw: string,
  options: MockGraphqlOptions,
  repositories: readonly MockSourceRepository[],
  received: MockGraphqlRequest[],
  reply: GraphqlReply,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const document = isRecord(parsed) && typeof parsed['query'] === 'string' ? parsed['query'] : undefined;
  const variables = isRecord(parsed) && isRecord(parsed['variables']) ? parsed['variables'] : null;
  received.push({ variables, fixedQuery: document === SOURCE_BLAME_QUERY });
  if (document === undefined) {
    reply(400, { message: 'Problems parsing JSON', documentation_url: GRAPHQL_DOCS });
    return;
  }

  switch (options.failure) {
    case 'unauthorized':
      reply(401, { message: 'Bad credentials', documentation_url: GRAPHQL_DOCS });
      return;
    case 'secondary_429':
      reply(429, { message: SECONDARY_LIMIT_MESSAGE, documentation_url: GRAPHQL_DOCS }, { 'retry-after': '30' });
      return;
    case 'secondary_403':
      reply(403, { message: SECONDARY_LIMIT_MESSAGE, documentation_url: GRAPHQL_DOCS }, { 'retry-after': '30' });
      return;
    case 'server_502':
      reply(502, { data: null, errors: [{ message: GRAPHQL_FAILURE_MESSAGE }] });
      return;
    case 'rate_limited': {
      // 주 한도: 상태는 200이고 잔여 0과 RATE_LIMITED 오류가 온다(GitHub GraphQL 문서).
      const reset = options.rateHeaders?.reset ?? Math.floor(Date.now() / 1000) + 3600;
      reply(200, { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit already exceeded for installation ID 42.' }] }, graphqlRateHeaders(0, reset));
      return;
    }
    case 'secondary_200':
      reply(200, { data: null, errors: [{ message: SECONDARY_LIMIT_MESSAGE }] });
      return;
    default:
      break;
  }

  if (document !== SOURCE_BLAME_QUERY) {
    reply(200, { errors: [{ message: 'Mock GHE executes only SOURCE_BLAME_QUERY', locations: [{ line: 1, column: 1 }], extensions: { code: 'mockUnknownDocument' } }] });
    return;
  }
  if (options.blame === 'unsupported') {
    // 스키마에 없는 필드는 정적 검증에서 걸린다 — 실행 전이라 `data`가 없다.
    reply(200, {
      errors: [{
        path: ['query SourceBlame', 'repository', 'object', '... on Commit', 'blame'],
        extensions: { code: 'undefinedField', typeName: 'Commit', fieldName: 'blame' },
        locations: [{ line: 6, column: 9 }],
        message: "Field 'blame' doesn't exist on type 'Commit'",
      }],
    });
    return;
  }
  const owner = variables?.['owner'];
  const name = variables?.['name'];
  const revision = variables?.['revision'];
  const path = variables?.['path'];
  if (typeof owner !== 'string' || typeof name !== 'string' || typeof revision !== 'string' || typeof path !== 'string') {
    reply(200, { errors: [{ extensions: { value: null, problems: [{ path: [], explanation: 'Expected value to not be null' }] }, locations: [{ line: 1, column: 19 }], message: 'Variable of type String! was provided invalid value' }] });
    return;
  }
  const repositoryNotFound = {
    data: { repository: null },
    errors: [{ type: 'NOT_FOUND', path: ['repository'], locations: [{ line: 2, column: 3 }], message: `Could not resolve to a Repository with the name '${owner}/${name}'.` }],
  };
  if (options.failure === 'forbidden') {
    reply(200, {
      data: { repository: null },
      errors: [{ type: 'FORBIDDEN', path: ['repository'], extensions: { saml_failure: false }, locations: [{ line: 2, column: 3 }], message: 'Resource not accessible by integration' }],
    });
    return;
  }
  if (options.failure === 'not_found') {
    reply(200, repositoryNotFound);
    return;
  }
  const repo = repositories.find((one) => one.owner === owner && one.repo === name);
  if (repo === undefined) {
    reply(200, repositoryNotFound);
    return;
  }
  const result = mockBlame(repo, revision, path);
  if (result.kind === 'no_object') {
    // 없는 oid는 오류 없이 `object: null`이다.
    reply(200, { data: { repository: { object: null } } });
    return;
  }
  if (result.kind === 'not_commit') {
    reply(200, { data: { repository: { object: { __typename: result.typename } } } });
    return;
  }
  if (result.kind === 'no_file') {
    // `blame(path:)`은 `Blame!`(non-null)이라, 그 오류는 가장 가까운 nullable 조상인 `object`를 비운다(GraphQL의 null 전파).
    reply(200, {
      data: { repository: { object: null } },
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'object', 'blame'], locations: [{ line: 6, column: 9 }], message: `Could not resolve file for path '${path}'.` }],
    });
    return;
  }
  const ranges = result.ranges.map((range) => ({
    startingLine: range.startingLine,
    endingLine: range.endingLine,
    age: range.age,
    commit: {
      oid: range.commit.sha,
      messageHeadline: range.commit.message.split('\n')[0] ?? '',
      authoredDate: range.commit.date,
      committedDate: range.commit.date,
      author: { name: range.commit.author, user: range.commit.login === null ? null : { login: range.commit.login } },
    },
  }));
  const data = { repository: { object: { __typename: 'Commit', oid: result.oid, blame: { ranges } } } };
  if (options.failure === 'partial') {
    // 일부 결과: 한 필드의 해석이 실패하면 그 nullable 필드만 비고 나머지 `data`는 그대로 온다.
    const first = ranges[0];
    if (first !== undefined) first.commit.author.user = null;
    reply(200, {
      data,
      errors: [{ message: GRAPHQL_FAILURE_MESSAGE, path: ['repository', 'object', 'blame', 'ranges', 0, 'commit', 'author', 'user'], locations: [{ line: 18, column: 17 }] }],
    });
    return;
  }
  reply(200, { data });
}

export async function startMockGhe(options: MockGheOptions = {}): Promise<MockGhe> {
  const requests: ReceivedRequest[] = [];
  const graphqlRequests: MockGraphqlRequest[] = [];
  const issuedTokens: string[] = [];
  let tokenIssueCount = 0;
  let secondaryLeft = options.secondaryLimitTimes ?? 0;
  let unauthorizedLeft = options.unauthorizedTimes ?? 0;
  let dataRequestCount = 0;
  const rawReads: MockRawRead[] = [];

  const commits = makeCommits(options.resources?.commits ?? 0);
  /**
   * PR 상세가 말하는 커밋 수.
   *
   * 목록이 상한에서 잘려도 이 값은 **전체**를 말한다. 실제 GitHub이 그렇고, 그
   * 어긋남이 "목록이 전부인가"를 알 수 있는 유일한 근거다. `resources.commits`를
   * 주지 않았으면 아래 기본 목록이 내보내는 1건이 곧 전체다.
   */
  const commitsTotal = commits.length > 0 ? commits.length : 1;
  /** 목록 끝점이 실제로 내보내는 커밋. 켜져 있으면 GitHub처럼 상한에서 자른다. */
  const servedCommits =
    options.capCommitListAtApiLimit === true
      ? commits.slice(0, GITHUB_PR_COMMITS_API_LIMIT)
      : commits;
  const files = makeFiles(options.resources?.files ?? 0);
  const reviews = makeReviews(options.resources?.reviews ?? 0);
  const failuresLeft = new Map<MockResource, number>();
  for (const failure of options.failures ?? []) {
    failuresLeft.set(failure.resource, failure.times ?? Number.POSITIVE_INFINITY);
  }
  const failureStatus = new Map<MockResource, number>(
    (options.failures ?? []).map((failure) => [failure.resource, failure.status]),
  );
  const shouldFail = (resource: MockResource): number | undefined => {
    const left = failuresLeft.get(resource);
    if (left === undefined || left <= 0) return undefined;
    failuresLeft.set(resource, left - 1);
    return failureStatus.get(resource);
  };

  const server: Server = createServer((request, response) => {
    const path = request.url ?? '/';
    requests.push({
      method: request.method ?? 'GET',
      path,
      authorization: request.headers.authorization,
      accept: request.headers.accept,
    });

    const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(body));
    };

    // --- 설치 토큰 발급 ---
    if (request.method === 'POST' && path.includes('/access_tokens')) {
      tokenIssueCount += 1;
      const token = `ghs_mock${String(tokenIssueCount).padStart(4, '0')}${'x'.repeat(28)}`;
      issuedTokens.push(token);
      const ttl = options.tokenTtlMs ?? 60 * 60 * 1000;
      send(201, { token, expires_at: new Date(Date.now() + ttl).toISOString() });
      return;
    }

    // --- GraphQL (CR-135) ---
    // REST 한도 장치보다 먼저 가른다. GraphQL은 한도 버킷이 다르고, REST 요청 순번(`dataRequestCount`)을 밀면 안 된다.
    if (new URL(path, 'http://localhost').pathname === '/api/graphql') {
      if (request.method !== 'POST') {
        send(404, { message: 'Not Found' });
        return;
      }
      const graphql = options.graphql ?? {};
      const base = graphql.rateHeaders === undefined ? {} : graphqlRateHeaders(graphql.rateHeaders.remaining, graphql.rateHeaders.reset);
      let closed = false;
      response.on('close', () => {
        closed = true;
      });
      const reply: GraphqlReply = (status, body, headers = {}) => {
        // 호출자가 기한으로 끊었으면 쓰지 않는다.
        const write = (): void => {
          if (!closed && !response.destroyed) send(status, body, { ...base, ...headers });
        };
        const delay = graphql.delayMs ?? 0;
        if (delay > 0) setTimeout(write, delay);
        else write();
      };
      void readRequestBody(request).then(
        (raw) => answerGraphql(raw, graphql, options.source?.repositories ?? [], graphqlRequests, reply),
        () => undefined,
      );
      return;
    }

    // --- rate limit 헤더 ---
    const plan = options.rateLimit;
    const rateHeaders: Record<string, string> = {};
    if (plan !== undefined) {
      const index = Math.min(dataRequestCount, plan.remaining.length - 1);
      rateHeaders['x-ratelimit-limit'] = String(plan.limit);
      rateHeaders['x-ratelimit-remaining'] = String(plan.remaining[index] ?? 0);
      rateHeaders['x-ratelimit-reset'] = String(plan.resetAt);
    }
    dataRequestCount += 1;

    if (unauthorizedLeft > 0) {
      unauthorizedLeft -= 1;
      const body =
        options.echoAuthorizationInError === true
          ? { message: 'Bad credentials', received_authorization: request.headers.authorization ?? '' }
          : { message: 'Bad credentials' };
      send(401, body, rateHeaders);
      return;
    }

    if (secondaryLeft > 0) {
      secondaryLeft -= 1;
      send(
        429,
        { message: 'You have exceeded a secondary rate limit' },
        options.omitRetryAfter === true
          ? rateHeaders
          : { ...rateHeaders, 'retry-after': String(options.retryAfterSeconds ?? 30) },
      );
      return;
    }

    if (plan !== undefined && Number(rateHeaders['x-ratelimit-remaining']) === 0) {
      send(403, { message: 'API rate limit exceeded' }, rateHeaders);
      return;
    }

    // --- source 저장소 (CR-132) ---
    if (options.source !== undefined && handleMockSource(options.source.repositories, request, response, options.source, rawReads, rateHeaders)) return;

    // --- 데이터 엔드포인트 ---
    const url = new URL(path, 'http://localhost');
    const page = Number(url.searchParams.get('page') ?? '1');
    if (url.pathname.endsWith('/commits') && url.pathname.includes('/pulls/')) {
      const status = shouldFail('commits');
      if (status !== undefined) {
        send(status, { message: 'commits unavailable' }, rateHeaders);
        return;
      }
      if (commits.length > 0) {
        send(200, paginate(servedCommits, url), rateHeaders);
        return;
      }
      send(200, page > 1 ? [] : [{ sha: 'aaa1', parents: [{ sha: 'bbb2' }], commit: { message: 'c1' } }], rateHeaders);
      return;
    }
    if (url.pathname.endsWith('/files')) {
      const status = shouldFail('files');
      if (status !== undefined) {
        send(status, { message: 'files unavailable' }, rateHeaders);
        return;
      }
      if (files.length > 0) {
        send(200, paginate(files, url), rateHeaders);
        return;
      }
      send(200, page > 1 ? [] : [{ filename: 'src/pay.ts', additions: 12, deletions: 3, status: 'modified' }], rateHeaders);
      return;
    }
    if (url.pathname.endsWith('/reviews')) {
      const status = shouldFail('reviews');
      if (status !== undefined) {
        send(status, { message: 'reviews unavailable' }, rateHeaders);
        return;
      }
      if (reviews.length > 0) {
        send(200, paginate(reviews, url), rateHeaders);
        return;
      }
      send(200, page > 1 ? [] : [{ id: 9, state: 'APPROVED', user: { login: 'reviewer' }, submitted_at: '2026-08-20T00:00:00Z' }], rateHeaders);
      return;
    }
    if (url.pathname.endsWith('/tags')) {
      send(200, page > 1 ? [] : [{ name: 'v1.2.3', commit: { sha: 'ccc3' } }], rateHeaders);
      return;
    }
    if (url.pathname.endsWith('/releases')) {
      send(200, page > 1 ? [] : [{ id: 5, tag_name: 'v1.2.3', draft: false, prerelease: false, published_at: '2026-08-20T00:00:00Z' }], rateHeaders);
      return;
    }
    if (url.pathname.endsWith('/collaborators')) {
      send(200, page > 1 ? [] : [{ login: 'dev', permissions: { pull: true, push: true, admin: false } }], rateHeaders);
      return;
    }
    if (url.pathname.endsWith('/teams')) {
      send(200, page > 1 ? [] : [{ id: 7, slug: 'payments', name: 'Payments' }], rateHeaders);
      return;
    }
    if (url.pathname.endsWith('/commits')) {
      send(200, page > 1 ? [] : [{ sha: 'ddd4', parents: [], commit: { message: 'root' } }], rateHeaders);
      return;
    }
    if (url.pathname.includes('/pulls/')) {
      const status = shouldFail('pull_request');
      if (status !== undefined) {
        send(status, { message: status === 404 ? 'Not Found' : 'pull request unavailable' }, rateHeaders);
        return;
      }
      // 커밋 수는 목록이 아니라 **PR 상세**가 말한다. 목록이 API 상한에서 잘려도
      // 이 값은 전체를 말하므로, 둘을 맞대 보는 것이 잘림을 아는 유일한 방법이다.
      send(200, { ...PR, commits: commitsTotal }, rateHeaders);
      return;
    }
    if (/\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      send(
        200,
        {
          id: 4021,
          full_name: 'acme/payments',
          private: true,
          default_branch: 'main',
          owner: { id: 77, login: 'acme' },
          // 사내 GHE의 저장소 대부분이 internal이다. `private: true`로는
          // 구분되지 않는 값이라 목이 실제 응답 모양을 그대로 갖는다 (DEV-033).
          visibility: 'internal',
        },
        rateHeaders,
      );
      return;
    }
    send(404, { message: 'Not Found' }, rateHeaders);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    apiUrl: `http://127.0.0.1:${String(address.port)}/api/v3`,
    graphqlUrl: `http://127.0.0.1:${String(address.port)}/api/graphql`,
    requests,
    graphqlRequests,
    tokenIssueCount: () => tokenIssueCount,
    issuedTokens: () => issuedTokens,
    rawReads: () => rawReads,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
