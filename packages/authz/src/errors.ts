/**
 * 인증·권한 오류 (API 계약 6장).
 *
 * 오류 코드는 `@prs/contracts`가 소유한다. 이 패키지는 HTTP 상태 코드를 만들지
 * 않는다 — 그것을 아는 곳은 Fastify 어댑터다.
 */

import type { ErrorCode } from '@prs/contracts';

export class AuthError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** 세션이 없거나 만료됐다. 401 + OIDC 리다이렉트 힌트. */
export class UnauthenticatedError extends AuthError {
  constructor(reason: string) {
    super('UNAUTHENTICATED', `인증되지 않았다: ${reason}`);
    this.name = 'UnauthenticatedError';
  }
}

/** 역할이 부족하다. 403. 접근 범위와 무관하다. */
export class ForbiddenRoleError extends AuthError {
  readonly requiredRole: string;

  constructor(requiredRole: string) {
    super('FORBIDDEN_ROLE', `'${requiredRole}' 역할이 필요하다`);
    this.name = 'ForbiddenRoleError';
    this.requiredRole = requiredRole;
  }
}

/**
 * OIDC 흐름 자체가 실패했다.
 *
 * 토큰 서명·`iss`·`aud`·`exp`·`nonce` 중 하나라도 맞지 않으면 여기로 온다
 * (FR-AUTH-001 AC-4). **어느 검사가 실패했는지는 메시지에 남기되 토큰은
 * 남기지 않는다** (NFR-005: 로그·응답에 토큰 0건).
 */
export class OidcError extends Error {
  constructor(message: string) {
    super(`OIDC 인증 실패: ${message}`);
    this.name = 'OidcError';
  }
}
