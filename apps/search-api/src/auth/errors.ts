/**
 * 인증·권한 오류를 HTTP로 옮긴다 (API 계약 6장, 백엔드 아키텍처 8장).
 *
 * | 상황 | 상태 | 코드 |
 * | --- | --- | --- |
 * | 세션 없음·만료 | 401 | `UNAUTHENTICATED` (+ OIDC 리다이렉트 힌트) |
 * | 역할 부족 | 403 | `FORBIDDEN_ROLE` |
 * | 접근 범위 밖 리소스 | 404 | `NOT_FOUND` |
 * | 접근 범위 조회 실패 | 503 | `PERMISSION_UNAVAILABLE` |
 *
 * **403과 404를 헷갈리면 정보가 샌다.** 역할이 부족한 것은 "당신이 못 한다"이고
 * 접근 범위 밖은 "그런 것이 없다"이다. 후자를 403으로 주면 접근 권한 없는
 * 저장소에 그 PR이 있다는 사실이 드러난다 (THR-004, FR-AUTH-002 AC-4).
 */

import { ForbiddenRoleError, ScopeUnavailableError, UnauthenticatedError } from '@prs/authz';
import type { ErrorResponse } from '@prs/contracts';
import type { FastifyReply } from 'fastify';

/** 접근 범위 밖 리소스. 존재 여부를 노출하지 않는다 (FR-AUTH-002 AC-4). */
export class NotFoundError extends Error {
  constructor(message = '대상을 찾을 수 없다') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface AuthErrorShape {
  readonly status: number;
  readonly body: ErrorResponse;
}

export interface AuthErrorOptions {
  readonly correlationId: string;
  /** 401에 실을 재인증 경로. `web`이 이것을 OIDC 리다이렉트로 바꾼다. */
  readonly loginPath?: string;
}

/**
 * 인증·권한 예외를 응답 모양으로 옮긴다. 그 밖의 예외는 `null`이다.
 *
 * **오류 메시지에 접근 범위를 싣지 않는다.** "저장소 4021에 권한이 없다"는
 * 메시지는 그 저장소가 존재한다는 사실을 알려 준다.
 */
export function toAuthError(error: unknown, options: AuthErrorOptions): AuthErrorShape | null {
  const { correlationId } = options;

  if (error instanceof UnauthenticatedError) {
    return {
      status: 401,
      body: {
        error: {
          code: 'UNAUTHENTICATED',
          message: '인증이 필요하다',
          // FLOW-000: 화면이 현재 경로를 보존해 재인증으로 보낸다.
          detail: { login_path: options.loginPath ?? '/auth/login' },
        },
        correlation_id: correlationId,
      },
    };
  }

  if (error instanceof ForbiddenRoleError) {
    return {
      status: 403,
      body: {
        error: {
          code: 'FORBIDDEN_ROLE',
          message: `'${error.requiredRole}' 역할이 필요하다`,
          detail: { required_role: error.requiredRole },
        },
        correlation_id: correlationId,
      },
    };
  }

  if (error instanceof NotFoundError) {
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: error.message }, correlation_id: correlationId },
    };
  }

  if (error instanceof ScopeUnavailableError) {
    return {
      status: 503,
      body: {
        error: {
          code: 'PERMISSION_UNAVAILABLE',
          // 사유는 남기지 않는다 — GHE 응답 본문이 섞여 들어올 수 있다.
          message: '접근 권한을 확인할 수 없어 조회를 거부한다',
        },
        correlation_id: correlationId,
      },
    };
  }

  return null;
}

export function sendAuthError(reply: FastifyReply, shape: AuthErrorShape): FastifyReply {
  return reply.status(shape.status).send(shape.body);
}
