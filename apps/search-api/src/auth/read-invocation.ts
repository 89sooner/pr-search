/**
 * 조회 한 건의 주체와 접근 범위 (CR-112 / ADR-025).
 *
 * ## 왜 있나
 *
 * PIPE 연동 경로는 기존 조회 10종을 **같은 코드로** 실행해야 한다 (지시서 8절). 라우트마다 권한
 * 계산을 복제하면 두 경로가 서로 다른 결과를 내는 날이 온다. 그래서 각 라우트의 본문을 실행 함수로
 * 꺼내고, 그 함수가 받는 것을 둘로 좁혔다.
 *
 * - `correlationId` — 요청의 상관 ID. 일반 경로는 지금처럼 요청마다 새로 만든다.
 * - `identify()` — 주체와 접근 범위. 일반 경로는 **지금과 같은 두 호출**이다:
 *   `authenticateSession` → `auth.scopes.resolveCached(userId)`.
 *
 * 연동 경로의 `identify()`는 grant 검증을 이미 끝낸 서버 내부 값을 돌려준다. 네트워크 입력으로
 * 이 타입을 만들지 않는다 — 공개 DTO가 아니다.
 *
 * ## 일반 경로에 새 분기를 만들지 않는다
 *
 * `authenticateSession`은 그대로다. 쿠키만 읽고 grant·PIPE 헤더를 받지 않는다. 일반 앱에는 연동의
 * `identify`가 등록되지 않으므로 그 경로로 grant가 통하는 길이 없다.
 */

import { randomUUID } from 'node:crypto';
import type { AccessScope, CachedScope } from '@prs/authz';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from './context.js';
import { authenticateSession } from './principal.js';

export interface ReadPrincipal {
  readonly userId: string;
  /**
   * 이 요청의 접근 범위 — 일반 경로는 `auth.scopes.resolve(userId)` 그대로다.
   *
   * 두 메서드는 원래 라우트가 부르던 두 호출에 **하나씩** 대응한다. 실행 함수가 원래 부르던 것을
   * 그대로 부르게 해서 5분 캐시·버전 울타리·GHE 실패 시 503이 모두 기존대로다. 연동 경로는 둘 다
   * 같은 교집합(사용자 범위 ∩ client 허용 목록)을 준다.
   */
  resolveScope(): Promise<AccessScope>;
  /** 버전이 필요한 경로(커서 지문) — 일반 경로는 `auth.scopes.resolveCached(userId)` 그대로다. */
  resolveCachedScope(): Promise<CachedScope>;
  /**
   * 커서 지문에 덧붙일 결속.
   *
   * **일반 경로는 없다** — 없으면 지문 재료가 이전과 한 글자도 다르지 않으므로 공개 커서가 그대로
   * 통한다. 연동 경로는 client와 canonical 사용자를 넣어 다른 사용자·다른 client의 커서를 받지 않는다.
   */
  readonly cursorBinding?: string;
}

export interface ReadInvocation {
  readonly correlationId: string;
  /** @throws 인증 실패 — 일반 경로는 `UnauthenticatedError`(401)다. */
  identify(): Promise<ReadPrincipal>;
}

/** 일반 `/api/v1/*` 조회. 세션 쿠키만 읽는다. */
export function sessionInvocation(request: FastifyRequest, auth: AuthContext): ReadInvocation {
  return {
    correlationId: randomUUID(),
    identify: async () => {
      const { userId } = await authenticateSession(request, auth.sessions);
      return {
        userId,
        resolveScope: () => auth.scopes.resolve(userId),
        resolveCachedScope: () => auth.scopes.resolveCached(userId),
      };
    },
  };
}
