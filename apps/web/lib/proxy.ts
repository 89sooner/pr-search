/**
 * `search-api` 프록시의 규칙 (WP-015 / 프런트엔드 문서 10장).
 *
 * ## 신원을 주장하는 헤더를 만들지 않는다 (CR-018, DEV-067)
 *
 * 예전 문서에는 "사용자 식별 헤더 부착"이 적혀 있었으나 그것은 CR-015
 * DEV-047이 정한 것과 정면으로 어긋난다. `search-api`는 `X-User-Id`·
 * `X-Forwarded-User`·`Authorization`·`X-Roles` 어느 것도 읽지 않고 **전부
 * 401로 거절한다** (WP-012가 시험으로 건다).
 *
 * 신원은 **세션 쿠키가 나르고** `search-api`가 같은 Redis 저장소에서 직접
 * 해석한다. 헤더를 믿기 시작하면 클러스터 안 무엇이든 신원을 위조할 수 있다.
 *
 * 이 파일은 라우트에서 떼어 낸 **순수 규칙**이다 — 무엇을 전달하고 무엇을
 * 막는가는 보안 판정이므로 Next.js 런타임 없이 시험할 수 있어야 한다.
 */

import { SESSION_COOKIE_NAME } from '@prs/authz';

/** 상관 ID를 실어 보내는 헤더. `search-api`가 응답에 같은 값을 돌려준다. */
export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * 클라이언트 → `search-api`로 **넘어가는** 헤더.
 *
 * 목록이 이렇게 짧은 것이 의도다. 여기 없는 것은 전부 버린다 — 허용 목록
 * 방식이라 새 헤더가 조용히 통과하지 못한다.
 */
const FORWARDED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'content-type',
]);

/**
 * **절대 만들지 않는** 헤더.
 *
 * 허용 목록이 이미 막지만 이름을 적어 둔다 — 누군가 목록을 넓힐 때 이
 * 상수가 왜 안 되는지를 말해 준다. 시험이 이 목록을 직접 건다.
 */
export const FORBIDDEN_IDENTITY_HEADERS: readonly string[] = [
  'x-user-id',
  'x-forwarded-user',
  'x-roles',
  'authorization',
  'x-access-scope',
];

/** 응답에서 클라이언트로 **돌려주는** 헤더. */
const FORWARDED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'cache-control',
  CORRELATION_HEADER,
]);

export interface ProxyRequestInput {
  /** 클라이언트가 보낸 헤더 전부. */
  readonly headers: Headers;
  /** 세션 쿠키 값. 없으면 프록시하지 않고 401이다. */
  readonly sessionId: string;
  readonly correlationId: string;
}

/**
 * `search-api`로 보낼 헤더를 만든다.
 *
 * 세션 쿠키를 **다시 조립한다** — 클라이언트가 보낸 `Cookie` 헤더를 그대로
 * 넘기면 다른 쿠키(분석 도구, 실험 플래그…)까지 백엔드로 새어 나간다.
 */
export function buildProxyHeaders(input: ProxyRequestInput): Headers {
  const headers = new Headers();

  for (const [name, value] of input.headers) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }

  headers.set('cookie', `${SESSION_COOKIE_NAME}=${input.sessionId}`);
  headers.set(CORRELATION_HEADER, input.correlationId);
  return headers;
}

/** 응답 헤더를 추린다. 백엔드의 `Set-Cookie`는 넘기지 않는다. */
export function buildResponseHeaders(upstream: Headers, correlationId: string): Headers {
  const headers = new Headers();
  for (const [name, value] of upstream) {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  headers.set(CORRELATION_HEADER, correlationId);
  return headers;
}

/**
 * 프록시할 대상 URL을 만든다.
 *
 * 경로 조각을 그대로 잇지 않고 **각각 인코딩한다** — `..`이나 `/`가 든
 * 조각이 `search-api`의 다른 경로로 빠져나가지 못하게 한다.
 */
export function buildUpstreamUrl(baseUrl: string, segments: readonly string[], search: string): string {
  const safe = segments
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment));

  const base = baseUrl.replace(/\/+$/, '');
  const path = safe.length === 0 ? '' : `/${safe.join('/')}`;
  return `${base}/api/v1${path}${search}`;
}
