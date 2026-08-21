/**
 * 인증 라우트 (API-AUTH-001).
 *
 * `/me` 하나뿐이다. 로그인·콜백·로그아웃 라우트는 `web`이 소유한다 (WP-015) —
 * 인프라 문서의 아웃바운드 허용 목록이 IdP를 `web`에만 열어 준다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthContext } from './context.js';
import { buildMe } from './me.js';
import { authenticateSession } from './principal.js';
import { sendAuthError, toAuthError } from './errors.js';

export const ME_PATH = '/api/v1/me';

export interface AuthRouteOptions {
  readonly auth: AuthContext;
  readonly loginPath: string;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  app.get(ME_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    try {
      const principal = await authenticateSession(request, options.auth.sessions);
      return reply.send(await buildMe(principal, options.auth.scopes, correlationId));
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath: options.loginPath });
      if (shape !== null) return sendAuthError(reply, shape);
      throw error;
    }
  });
}
