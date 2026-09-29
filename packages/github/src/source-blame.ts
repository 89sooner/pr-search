/**
 * source blame — GraphQL `Commit.blame(path:)` (CR-135, FR-SRC-005).
 *
 * 선택한 리비전의 파일 하나에서 줄 구간마다 그 줄을 마지막으로 바꾼 커밋을 GitHub에게 묻는다. Time-lapse(관측한 라인
 * 이력의 추정)와 다른 기능이다 — 이쪽은 GitHub가 계산한 귀속을 옮길 뿐이고, 확실하지 않으면 결과를 내지 않는다.
 *
 * - **서버 소유 고정 query 하나만** 보낸다(`SOURCE_BLAME_QUERY`). 호출자가 정하는 것은 저장소·리비전·경로 변수뿐이다.
 *   작성자 이메일은 묻지 않는다.
 * - HTTP 200이어도 `errors`·일부 결과·`null`·한도를 본다. `errors`가 하나라도 있으면 `data`가 함께 와도 성공이 아니다.
 * - 원격 문구는 오류 메시지에 싣지 않는다 — 응답 본문은 신뢰 경계 밖이다(`safeMessage`와 같은 규칙).
 */

import type { RepoRef } from './client.js';
import { GitHubApiError } from './errors.js';
import { isFullSha } from './graph-plan.js';
import type { GitHubTransport, GraphqlRateLimit, GraphqlResponse } from './transport.js';

/**
 * blame 호출 하나의 기한 (CR-135). GitHub는 10초 넘게 처리하는 GraphQL 요청을 끊고 502·504를 준다 — 이 기한은 그
 * 응답과 큰 blame 본문의 전송까지 기다리는 몫이다.
 */
export const SOURCE_BLAME_TIMEOUT_MS = 30_000;

/**
 * 서버 소유 고정 query (CR-135, 설계 결정 7). 바꾸면 GHE 대역(`testing/mock-ghe.ts`)이 알아보지 못한다 — 의도한
 * 변경이면 ADR과 계약 문서를 함께 고친다. 이메일은 싣지 않는다.
 */
export const SOURCE_BLAME_QUERY = `query SourceBlame($owner: String!, $name: String!, $revision: GitObjectID!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(oid: $revision) {
      __typename
      ... on Commit {
        oid
        blame(path: $path) {
          ranges {
            startingLine
            endingLine
            age
            commit {
              oid
              messageHeadline
              authoredDate
              committedDate
              author {
                name
                user {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
}`;

export interface SourceBlameCommit {
  readonly sha: string;
  readonly messageHeadline: string;
  /** Git 커밋에 적힌 작성자 이름. GitHub가 주지 않으면 `null`이다 — 지어내지 않는다. */
  readonly authorName: string | null;
  /** 작성자 이메일과 맞는 GHE 계정의 로그인. 맞는 계정이 없으면 `null`이다. */
  readonly authorLogin: string | null;
  readonly authoredAt: string;
  readonly committedAt: string;
}

export interface SourceBlameRange {
  /** 1부터 센다. */
  readonly startLine: number;
  readonly endLine: number;
  /** GitHub의 최근성 등급. 1(최신)~10(오래됨)이다. */
  readonly age: number;
  readonly commit: SourceBlameCommit;
}

export interface SourceBlame {
  /** GitHub가 확인한 커밋 SHA(`object.oid`). */
  readonly revision: string;
  readonly path: string;
  /** GitHub가 준 순서 그대로다(시작 줄 오름차순·겹치지 않음을 확인했다). 빈 파일이면 빈 배열이다. */
  readonly ranges: readonly SourceBlameRange[];
}

export interface SourceBlameTarget {
  /** 커밋 SHA. 형식 검사는 호출자(API 경계)가 한다. */
  readonly revision: string;
  readonly path: string;
}

export interface SourceBlameOptions {
  /** 호출자의 취소·요청 기한. */
  readonly signal?: AbortSignal;
  /** 이 호출의 기한. 기본은 `SOURCE_BLAME_TIMEOUT_MS`다. */
  readonly timeoutMs?: number;
}

/**
 * 이 GHES의 GraphQL 스키마에 `Commit.blame`이 없다 (CR-135). 일시 장애가 아니다 — 다시 불러도 같다. 호출자는 권한 부족·
 * 일시 장애와 구분해 「이 GHES는 blame을 제공하지 않는다」로 안내한다.
 */
export class SourceBlameUnsupportedError extends Error {
  constructor() {
    super('이 GHES의 GraphQL 스키마에 Commit.blame이 없다');
    this.name = 'SourceBlameUnsupportedError';
  }
}

/**
 * 한 파일의 blame (CR-135, FR-SRC-005). 호출자가 저장소 권한을 먼저 확인했어야 한다.
 *
 * 실패는 `GitHubApiError`(`auth`·`not_found`·`rate_limited`·`secondary_rate_limited`·`server`·`client`, 그리고 전송의
 * `network`·`timeout`)와 `SourceBlameUnsupportedError`다. 분류 순서는 `classifyBlameResponse`를 본다.
 */
export async function readSourceBlame(
  transport: GitHubTransport,
  ref: RepoRef,
  target: SourceBlameTarget,
  options: SourceBlameOptions = {},
): Promise<SourceBlame> {
  const response = await transport.postGraphql({
    org: ref.owner,
    query: SOURCE_BLAME_QUERY,
    // GitObjectID는 소문자 hex로 보낸다 — GHES가 대문자를 받는지 확인하지 못했고(대역은 대소문자를 가린다), 받지 않으면
    // 영구적인 입력 오류가 502(다시 시도)로 나간다. 응답의 `revision`은 GitHub가 준 `oid`다.
    variables: { owner: ref.owner, name: ref.repo, revision: target.revision.toLowerCase(), path: target.path },
    priority: 'realtime',
    timeoutMs: options.timeoutMs ?? SOURCE_BLAME_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return classifyBlameResponse(response, target.path);
}

/** 한도 오류에 회복 시각이 없을 때 기다리게 하는 시간 — REST 경로의 429 기본값과 같다. */
const FALLBACK_RETRY_MS = 60_000;
/** 부 한도 문구. 옛 GHES는 「abuse detection」이라고 쓴다(사내 GHES 버전은 확인하지 않았다). */
const SECONDARY_LIMIT_TEXT = /secondary rate limit|abuse detection/i;
/** graphql-ruby의 정적 검증 문구 — 고정 query의 필드가 이 서버 스키마에 없다. */
const UNDEFINED_FIELD_TEXT = /Field '[^']+' doesn't exist on type '[^']+'/;
/** blame 대상을 가리키는 오류 경로의 이름들. 이 밖의 경로(예: `ranges[0].commit`)의 NOT_FOUND는 대상 없음이 아니다. */
const TARGET_PATH_NAMES: ReadonlySet<unknown> = new Set(['repository', 'object', 'blame']);

/**
 * 응답을 blame 결과나 오류로 가른다. **순서를 바꾸지 않는다**(설계 advisor 25차 확정):
 *
 * (a) HTTP 계층 — 401 `auth`(토큰 무효화는 전송이 했다), 429 `secondary_rate_limited`, 403+부 한도 문구
 *     `secondary_rate_limited`, 그 밖의 403 `auth`, 5xx `server`, 그 밖의 비2xx `client`.
 * (b) 본문의 `errors[]` — `RATE_LIMITED` `rate_limited`, 부 한도 문구 `secondary_rate_limited`, 대상 경로의
 *     `NOT_FOUND` `not_found`, `FORBIDDEN` `auth`, 스키마 검증 오류 `SourceBlameUnsupportedError`, 남는 것은 `server`.
 *     `data`가 함께 와도 성공으로 내지 않는다.
 * (c) `data` 결손 — 오류 없이 `repository`·`object`가 `null`이면 `not_found`, 그 밖(커밋 아님, `blame` 없음, 줄 구간
 *     순서 위반, 필드 모양)은 `server`.
 *
 * 성공 응답의 `x-ratelimit-remaining: 0`은 실패가 아니다 — 그 값은 한도 오류의 회복 시각을 정할 때만 쓴다.
 */
function classifyBlameResponse(response: GraphqlResponse, path: string): SourceBlame {
  const { status, body, rateLimit } = response;

  // (a) HTTP 계층
  if (status === 401) throw new GitHubApiError('auth', 'GitHub GraphQL이 설치 토큰을 거부했다 (401)', { status });
  if (status === 429) {
    throw new GitHubApiError('secondary_rate_limited', 'GitHub GraphQL 부 한도에 걸렸다 (429)', { status, retryAt: retryAfter(rateLimit) });
  }
  if (status === 403) {
    if (mentionsSecondaryLimit(body)) {
      throw new GitHubApiError('secondary_rate_limited', 'GitHub GraphQL 부 한도에 걸렸다 (403)', { status, retryAt: retryAfter(rateLimit) });
    }
    throw new GitHubApiError('auth', 'GitHub GraphQL이 요청을 거부했다 (403)', { status });
  }
  if (status >= 500) throw new GitHubApiError('server', `GitHub GraphQL 서버 오류 (${String(status)})`, { status });
  if (status < 200 || status > 299) throw new GitHubApiError('client', `GitHub GraphQL 요청 실패 (${String(status)})`, { status });

  // (b) 본문의 errors
  if (!isRecord(body)) throw malformed(status, '본문이 JSON 객체가 아니다');
  const errors = body['errors'];
  if (errors !== undefined && errors !== null) {
    if (!Array.isArray(errors)) throw malformed(status, 'errors가 배열이 아니다');
    if (errors.length > 0) throw classifyErrors(errors.map(readError), status, rateLimit);
  }

  // (c) data 결손
  const data = body['data'];
  if (!isRecord(data)) throw malformed(status, 'data가 없다');
  const repository = data['repository'];
  if (repository === null) throw new GitHubApiError('not_found', 'GitHub GraphQL이 저장소를 찾지 못했다', { status });
  if (!isRecord(repository)) throw malformed(status, 'repository의 모양이 다르다');
  const object = repository['object'];
  if (object === null) throw new GitHubApiError('not_found', 'GitHub GraphQL이 리비전을 찾지 못했다', { status });
  if (!isRecord(object)) throw malformed(status, 'object의 모양이 다르다');
  // 커밋이 아닌 객체(tree·blob·tag)의 SHA는 없는 리비전과 같다 — 다시 불러도 같으므로 502(다시 시도)로 답하지 않는다.
  if (object['__typename'] !== 'Commit') throw new GitHubApiError('not_found', 'GitHub GraphQL의 리비전이 커밋이 아니다', { status });
  const oid = object['oid'];
  if (typeof oid !== 'string' || !isFullSha(oid)) throw malformed(status, '커밋 SHA가 없다');
  const blame = object['blame'];
  if (!isRecord(blame) || !Array.isArray(blame['ranges'])) throw malformed(status, 'blame이 없다');
  return { revision: oid, path, ranges: readRanges(blame['ranges'], status) };
}

interface GraphqlErrorFields {
  readonly type: string | undefined;
  readonly code: string | undefined;
  readonly message: string;
  readonly path: readonly unknown[] | undefined;
}

function readError(value: unknown): GraphqlErrorFields {
  if (!isRecord(value)) return { type: undefined, code: undefined, message: '', path: undefined };
  const extensions = isRecord(value['extensions']) ? value['extensions'] : {};
  return {
    type: typeof value['type'] === 'string' ? value['type'] : undefined,
    code: typeof extensions['code'] === 'string' ? extensions['code'] : undefined,
    message: typeof value['message'] === 'string' ? value['message'] : '',
    path: Array.isArray(value['path']) ? value['path'] : undefined,
  };
}

/** (b)의 우선순위대로 본다. 알아본 것이 하나도 없으면 `server`다. */
function classifyErrors(errors: readonly GraphqlErrorFields[], status: number, rateLimit: GraphqlRateLimit): Error {
  const is = (kind: string) => (error: GraphqlErrorFields): boolean => error.type === kind || error.code === kind;
  if (errors.some(is('RATE_LIMITED'))) {
    return new GitHubApiError('rate_limited', 'GitHub GraphQL 주 한도가 소진됐다', { status, retryAt: rateLimit.reset ?? fallbackRetryAt(rateLimit) });
  }
  if (errors.some((error) => SECONDARY_LIMIT_TEXT.test(error.message))) {
    return new GitHubApiError('secondary_rate_limited', 'GitHub GraphQL 부 한도에 걸렸다', { status, retryAt: retryAfter(rateLimit) });
  }
  if (errors.some((error) => is('NOT_FOUND')(error) && isTargetPath(error.path))) {
    return new GitHubApiError('not_found', 'GitHub GraphQL이 저장소·리비전·경로를 찾지 못했다', { status });
  }
  if (errors.some(is('FORBIDDEN'))) return new GitHubApiError('auth', 'GitHub GraphQL이 저장소 접근을 거부했다', { status });
  if (errors.some((error) => error.code === 'undefinedField' || UNDEFINED_FIELD_TEXT.test(error.message))) {
    return new SourceBlameUnsupportedError();
  }
  return new GitHubApiError('server', 'GitHub GraphQL이 알 수 없는 오류를 돌려줬다', { status });
}

/** 경로가 없거나 `repository`에서 시작해 `object`·`blame`까지만 가리킨다. */
function isTargetPath(path: readonly unknown[] | undefined): boolean {
  if (path === undefined || path.length === 0) return true;
  return path[0] === 'repository' && path.every((segment) => TARGET_PATH_NAMES.has(segment));
}

/** 403 본문이 부 한도를 말하는가. REST 모양(`message`)과 GraphQL 모양(`errors[].message`)을 다 본다. */
function mentionsSecondaryLimit(body: unknown): boolean {
  if (!isRecord(body)) return false;
  if (typeof body['message'] === 'string' && SECONDARY_LIMIT_TEXT.test(body['message'])) return true;
  const errors = body['errors'];
  return Array.isArray(errors) && errors.some((error) => SECONDARY_LIMIT_TEXT.test(readError(error).message));
}

function retryAfter(rateLimit: GraphqlRateLimit): Date {
  return rateLimit.retryAfter ?? fallbackRetryAt(rateLimit);
}

function fallbackRetryAt(rateLimit: GraphqlRateLimit): Date {
  return new Date(rateLimit.observedAt.getTime() + FALLBACK_RETRY_MS);
}

function readRanges(values: readonly unknown[], status: number): SourceBlameRange[] {
  const ranges: SourceBlameRange[] = [];
  let previousEnd = 0;
  for (const value of values) {
    if (!isRecord(value)) throw malformed(status, '줄 구간의 모양이 다르다');
    const startLine = value['startingLine'];
    const endLine = value['endingLine'];
    const age = value['age'];
    if (!isLineNumber(startLine) || !isLineNumber(endLine) || endLine < startLine) throw malformed(status, '줄 구간이 1 이상·끝 ≥ 시작이 아니다');
    if (startLine <= previousEnd) throw malformed(status, '줄 구간이 오름차순이 아니거나 겹친다');
    if (typeof age !== 'number' || !Number.isInteger(age)) throw malformed(status, '줄 구간의 age가 정수가 아니다');
    previousEnd = endLine;
    ranges.push({ startLine, endLine, age, commit: readCommit(value['commit'], status) });
  }
  return ranges;
}

function readCommit(value: unknown, status: number): SourceBlameCommit {
  if (!isRecord(value)) throw malformed(status, '귀속 커밋이 없다');
  const sha = value['oid'];
  const messageHeadline = value['messageHeadline'];
  const authoredAt = value['authoredDate'];
  const committedAt = value['committedDate'];
  if (typeof sha !== 'string' || !isFullSha(sha)) throw malformed(status, '귀속 커밋의 SHA가 다르다');
  if (typeof messageHeadline !== 'string') throw malformed(status, '귀속 커밋의 제목이 없다');
  if (!isTimestamp(authoredAt) || !isTimestamp(committedAt)) throw malformed(status, '귀속 커밋의 시각이 없다');
  const author = value['author'];
  if (author === null) return { sha, messageHeadline, authorName: null, authorLogin: null, authoredAt, committedAt };
  if (!isRecord(author)) throw malformed(status, '작성자의 모양이 다르다');
  const name = author['name'];
  if (name !== null && typeof name !== 'string') throw malformed(status, '작성자 이름의 모양이 다르다');
  // 이메일과 맞는 계정이 없으면 GitHub가 `user: null`을 준다. 이름으로 로그인을 짐작하지 않는다.
  const user = author['user'];
  let authorLogin: string | null = null;
  if (user !== null) {
    const login = isRecord(user) ? user['login'] : undefined;
    if (typeof login !== 'string') throw malformed(status, '작성자 계정의 모양이 다르다');
    authorLogin = login;
  }
  return { sha, messageHeadline, authorName: name, authorLogin, authoredAt, committedAt };
}

function isLineNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(status: number, detail: string): GitHubApiError {
  return new GitHubApiError('server', `GitHub GraphQL blame 응답이 예상과 다르다: ${detail}`, { status });
}
