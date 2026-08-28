/**
 * 요청의 주체 (백엔드 아키텍처 6.1, CR-015 DEV-047·DEV-048).
 *
 * `search-api`가 신원을 얻는 길은 **하나뿐이다**: 세션 쿠키를 Redis에서 직접
 * 해석한다. 신원을 주장하는 헤더는 읽지 않는다 — 읽는 순간 그 헤더가 우회
 * 경로가 되고, 클러스터 안에서 이 서비스에 닿을 수 있는 무엇이든 `operator`가
 * 될 수 있다.
 *
 * 예외가 하나 있다. OIDC가 **구성되지 않은** 배포에서는 CR-012·CR-013이 세운
 * 이름 붙은 토큰이 관리 경로의 임시 통제로 남는다. 둘은 배타다 (DEV-048).
 */

import {
  ForbiddenRoleError,
  SESSION_COOKIE_NAME,
  UnauthenticatedError,
  hasRole,
  readSessionCookie,
  type Role,
  type SessionRecord,
  type SessionStore,
} from '@prs/authz';
import type { FastifyRequest } from 'fastify';
import type { AdminPrincipal } from '../config.js';

/** 세션으로 인증된 사람. */
export interface SessionPrincipal {
  readonly kind: 'session';
  readonly userId: string;
  readonly login: string;
  readonly roles: readonly string[];
  readonly session: SessionRecord;
}

/** OIDC 미구성 배포의 임시 관리 토큰 (CR-012 DEV-025, CR-013 DEV-030). */
export interface TokenPrincipal {
  readonly kind: 'token';
  readonly name: string;
}

export type Principal = SessionPrincipal | TokenPrincipal;

/** 감사 기록에 남는 주체 식별자 (WP-039가 쓴다). */
export function principalId(principal: Principal): string {
  return principal.kind === 'session' ? principal.userId : `admin:${principal.name}`;
}

export function principalLabel(principal: Principal): string {
  return principal.kind === 'session' ? principal.login : principal.name;
}

/**
 * 토큰 주체는 관리 경로를 위한 것이므로 `operator`로 친다.
 *
 * 그것이 이 통제가 대신하고 있는 역할이다. **`security_officer`는 주지 않는다**
 * — 감사 기록 조회는 사람 신원이 있어야 의미가 있다 (FR-AUTH-004 AC-5).
 */
export function principalRoles(principal: Principal): readonly string[] {
  return principal.kind === 'session' ? principal.roles : ['developer', 'operator'];
}

export function requireRole(principal: Principal, role: Role): void {
  if (!hasRole(principalRoles(principal), role)) throw new ForbiddenRoleError(role);
}

/**
 * 열거한 역할 중 **하나라도** 가지면 통과 (CR-052).
 *
 * 원본 아카이브 조회는 `operator`와 `security_officer` 둘 다 자격이 있다
 * (FR-ING-010 AC-5). 라우트에서 `requireRole`을 두 번 부르고 하나라도 통과하면
 * 넘기는 식으로 풀어 쓰면, 어느 쪽 하나를 빠뜨린 자리가 **오류 없이 조용히 좁게
 * 답한다** — DEV-353이 선택 인자에서 겪은 것과 같은 모양이다.
 *
 * 자격을 넓히는 것이지 접근 범위를 넓히는 것이 아니다. 무엇이 보이는지는
 * `ADR-008`의 필수 접근 범위 필터가 정한다 (AC-6).
 */
export function requireAnyRole(principal: Principal, roles: readonly Role[]): void {
  const held = principalRoles(principal);
  if (roles.some((role) => hasRole(held, role))) return;
  throw new ForbiddenRoleError(roles.join(' 또는 '));
}

/**
 * 요청에서 세션을 읽는다.
 *
 * @throws {UnauthenticatedError} 쿠키가 없거나 세션이 없거나 만료됐으면.
 */
export async function authenticateSession(
  request: FastifyRequest,
  store: SessionStore,
): Promise<SessionPrincipal> {
  const cookie = readSessionCookie(request.headers.cookie);
  if (cookie === null) throw new UnauthenticatedError('세션 쿠키가 없다');

  const loaded = await store.load(cookie);
  if (loaded === null) throw new UnauthenticatedError('세션이 없거나 만료됐다');

  return {
    kind: 'session',
    userId: loaded.session.userId,
    login: loaded.session.login,
    roles: loaded.session.roles,
    session: loaded.session,
  };
}

/** 상수 시간 토큰 비교. 길이 차이는 비밀이 아니므로 먼저 거른다. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}

/**
 * 토큰을 주체로 바꾼다.
 *
 * 일치하는 것을 찾아도 **끝까지 돈다.** 처음 일치에서 멈추면 비교 횟수가
 * 토큰 위치를 알려 준다.
 */
export function authenticateToken(
  request: FastifyRequest,
  tokens: readonly AdminPrincipal[],
): TokenPrincipal {
  const token = bearerToken(request);
  let matched: AdminPrincipal | null = null;
  if (token !== undefined) {
    for (const principal of tokens) {
      if (tokenMatches(token, principal.token)) matched = principal;
    }
  }
  if (matched === null) throw new UnauthenticatedError('관리 API 인증에 실패했다');
  return { kind: 'token', name: matched.name };
}

export { SESSION_COOKIE_NAME };
