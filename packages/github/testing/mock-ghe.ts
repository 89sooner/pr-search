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

import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';

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
}

export interface MockGhe {
  readonly apiUrl: string;
  readonly requests: ReceivedRequest[];
  /** 설치 토큰 발급 횟수. */
  readonly tokenIssueCount: () => number;
  /** 지금까지 발급한 토큰 값. redaction 시험에서 "이 값이 로그에 없는가"를 본다. */
  readonly issuedTokens: () => readonly string[];
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

export async function startMockGhe(options: MockGheOptions = {}): Promise<MockGhe> {
  const requests: ReceivedRequest[] = [];
  const issuedTokens: string[] = [];
  let tokenIssueCount = 0;
  let secondaryLeft = options.secondaryLimitTimes ?? 0;
  let unauthorizedLeft = options.unauthorizedTimes ?? 0;
  let dataRequestCount = 0;

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
    requests,
    tokenIssueCount: () => tokenIssueCount,
    issuedTokens: () => issuedTokens,
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
