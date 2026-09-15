import 'server-only';

/**
 * 화면이 쓸 실효 역할 (CR-091 / DEV-695).
 *
 * ## 무엇이 어긋나 있었나
 *
 * API-AUTH-001은 「셸이 역할 기반 내비게이션에 `/me`를 쓴다」고 적고, 그 응답의 `roles`가
 * IdP·팀 매핑과 **관리자 지정(`app_user.roles[]`)의 합집합**이라고 적는다. 그런데 관문은
 * Redis의 세션 레코드에서 역할을 직접 읽었다. 세션의 역할은 로그인 때 합성한 IdP 쪽 절반뿐이라
 * (`web`은 DB에 닿지 않는다), 관리자가 `operator`를 지정해도 화면은 끝내 운영 메뉴를 그리지
 * 않았다.
 *
 * 합집합을 아는 곳은 정본에 닿는 `search-api` 하나다. 그래서 관문이 `/me`에 묻는다 — `web`에
 * DB 연결을 주거나 같은 합성을 한 벌 더 두면 두 판정이 갈라진다.
 *
 * ## 실패하면
 *
 * **세션의 역할로 그린다** (fail closed). 지정값은 권한을 더하기만 하므로 빠뜨린 쪽의 결과는
 * 메뉴가 덜 보이는 것이지 더 보이는 것이 아니다. 실제 판정은 어차피 `search-api`가 모든
 * 요청에 한다. 원인은 로그에 남긴다 — 운영자가 「지정했는데 왜 안 보이지」를 로그 없이 겪지
 * 않게.
 */

import { randomUUID } from 'node:crypto';
import { isRole, type Role } from '@prs/authz/roles';
import { buildProxyHeaders } from '../proxy';

/** `/me`가 이보다 늦으면 세션 역할로 그린다. 화면 전체를 붙잡지 않는다. */
export const EFFECTIVE_ROLES_TIMEOUT_MS = 3_000;

export interface EffectiveRolesInput {
  readonly searchApiUrl: string;
  readonly sessionId: string;
  /** 세션 레코드의 역할 — 실패했을 때 쓴다. */
  readonly sessionRoles: readonly string[];
}

export interface EffectiveRolesDeps {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
}

export async function resolveEffectiveRoles(
  input: EffectiveRolesInput,
  deps: EffectiveRolesDeps = {},
): Promise<readonly Role[]> {
  const fallback = (): readonly Role[] => input.sessionRoles.filter(isRole);
  const correlationId = randomUUID();
  const log =
    deps.log ??
    ((message: string, detail: Record<string, unknown>): void => {
      console.warn(message, JSON.stringify(detail));
    });
  const fail = (reason: string, status?: number): readonly Role[] => {
    // 신원·역할 값은 싣지 않는다 (NFR-005). 상관 ID로 search-api 로그와 잇는다.
    log('실효 역할을 읽지 못해 세션의 역할로 그린다 (DEV-695)', {
      correlation_id: correlationId,
      reason,
      ...(status === undefined ? {} : { status }),
    });
    return fallback();
  };

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${input.searchApiUrl}/api/v1/me`, {
      method: 'GET',
      headers: buildProxyHeaders({
        headers: new Headers({ accept: 'application/json' }),
        sessionId: input.sessionId,
        correlationId,
      }),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs ?? EFFECTIVE_ROLES_TIMEOUT_MS),
    });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.name : 'fetch_failed');
  }

  if (!response.ok) return fail('rejected', response.status);

  const body: unknown = await response.json().catch(() => null);
  const roles = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['roles'] : undefined;
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string')) return fail('malformed');

  return (roles as string[]).filter(isRole);
}
