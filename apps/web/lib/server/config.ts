import 'server-only';

/**
 * `web` 서버 측 구성 (WP-015).
 *
 * `server-only`를 첫 줄에 두어 **클라이언트 컴포넌트가 이 파일을 가져오면
 * 빌드가 깨지게** 한다. 여기에는 `OIDC_CLIENT_SECRET`이 지나가므로 번들
 * 경계를 사람의 주의력에 맡기지 않는다 (NFR-005).
 */

import {
  insecureCookiesAllowed,
  resolveAuthProvider,
  resolveGitHubAuthConfig,
  resolveOidcConfig,
  resolveSessionReaderConfig,
  resolveTeamRoleMap,
  type SessionReaderConfig,
} from '@prs/authz';

export interface WebConfig {
  /** `search-api`의 내부 주소. 브라우저에 노출되지 않는다. */
  readonly searchApiUrl: string;
  readonly session: SessionReaderConfig;
  /** OIDC 자격 증명이 있는가. 없으면 인증 라우트를 등록해도 503을 낸다. */
  readonly authEnabled: boolean;
}

export function resolveWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const session = resolveSessionReaderConfig(env);
  return {
    searchApiUrl: (env['SEARCH_API_URL'] ?? 'http://localhost:3002').replace(/\/+$/, ''),
    session,
    authEnabled: session.enabled,
  };
}

/**
 * 구성이 성립하지 않는 이유. 성립하면 `null`.
 *
 * **왜 판정을 따로 두는가** (`DEV-577`).
 *
 * `resolveWebConfig()`는 계약을 어기면 던진다. 그런데 이 앱에서 그 호출은
 * 화면과 라우트 핸들러 안, 즉 **요청마다** 일어난다. 그래서 던지는 것만으로는
 * 배포가 서지 않는다는 사실이 드러나지 않는다 — 프로세스는 기동하고
 * `/healthz`는 200을 내며 컨테이너는 `healthy`로 보이는데 **사람이 여는 화면만
 * 500이 된다.** 사내 반입(`0.1.0-pilot.3`)에서 실제로 그렇게 막혔고, 운영자는
 * 컨테이너가 전부 정상이라 원인을 웹 런타임의 모듈 문제로 오진했다.
 *
 * `resolveSessionReaderConfig`의 주석과 `playwright.config.ts`의 주석은 이미
 * 「기동을 거부한다」고 적고 있었다. **적힌 의도와 실제 동작이 달랐던 것이
 * 결함이다.** 그 의도를 실제로 이행하는 자리가 `instrumentation.ts`이고,
 * 헬스체크가 같은 판정을 다시 읽어 초록이 거짓말하지 못하게 한다.
 *
 * 판정을 여기 하나로 두는 이유는 단순하다 — 기동과 헬스체크가 각자 판정하면
 * 갈라지고, 갈라지는 순간 둘 중 하나가 다시 거짓말한다.
 */
export function webConfigFailure(env: NodeJS.ProcessEnv = process.env): string | null {
  let config: WebConfig;
  try {
    config = resolveWebConfig(env);
  } catch (cause) {
    return reason(cause);
  }

  /*
   * **인증을 켰다면 자격 증명이 있어야 한다** (`DEV-579`).
   *
   * `AUTH_ENABLED=true`인데 OIDC 값이 비면 화면이 전부 `/auth/login`으로
   * 리다이렉트되고 그 라우트가 `resolveOidcConfig()`에서 던져 500이 된다.
   * 컨테이너는 초록인데 **아무도 로그인할 수 없다** — `DEV-577`과 같은 모양이며,
   * `compose.yml`의 기본값이 `AUTH_ENABLED=true`이고 `.env.example`이 OIDC 값을
   * 비운 채로 배포되므로 **채우기를 잊으면 그대로 밟는다.**
   *
   * 키 목록을 여기 옮겨 적지 않고 **로그인 라우트가 실제로 부르는 함수를 그대로
   * 부른다.** 옮겨 적으면 한쪽이 키를 더할 때 갈라지고, 갈라지는 순간 이 검사가
   * 통과하는데 로그인은 500이 된다 — `OIDC_REDIRECT_URI`가 정확히 그렇게
   * 배포 정의에서 빠져 있었다.
   */
  if (config.authEnabled) {
    /*
     * **공급자마다 필요한 키가 다르다** (`CR-083`). GHE 배포에서 OIDC 키를
     * 요구하면 자격을 다 채운 배포가 서지 못하고, 반대로 OIDC 배포에서 GHE 키를
     * 요구하면 같은 일이 반대 방향으로 일어난다.
     *
     * 어느 쪽이든 **로그인 라우트가 실제로 부르는 함수를 그대로 부른다**는 규칙은
     * 같다. `AUTH_PROVIDER` 자체가 모르는 값이면 `resolveAuthProvider`가 던지고
     * 그것도 여기서 잡힌다 — 오타 하나로 GHE 설정이 OIDC로 조용히 떨어지지 않는다.
     */
    try {
      if (resolveAuthProvider(env) === 'github') {
        resolveGitHubAuthConfig(env);
      } else {
        resolveOidcConfig(env);
      }
    } catch (cause) {
      return `AUTH_ENABLED=true but authentication configuration is incomplete — ${reason(cause)}`;
    }

    /*
     * 팀·그룹 매핑의 형식 오류도 기동 전에 잡는다. `resolveSessionReaderConfig`가
     * `IDP_GROUP_ROLE_MAP`을 이미 파싱하지만 **GHE 쪽 변수는 그 경로에 없다** —
     * 여기서 부르지 않으면 형식이 틀린 매핑이 로그인 요청 시점에야 500으로 나타난다.
     */
    try {
      resolveTeamRoleMap(env);
    } catch (cause) {
      return `GHE_TEAM_ROLE_MAP is invalid — ${reason(cause)}`;
    }
  }

  return null;
}

/**
 * 성립하지만 **받아들인 위험을 담은** 구성의 경고 (CR-091 / DEV-694).
 *
 * **성립하지 않는 구성에서는 빈 목록이다** — 그 구성은 경고가 아니라 기동 거부의 대상이고,
 * 이유는 `webConfigFailure`가 말한다. 여기서 던지면 기동 검증이 거부 이유를 적기 전에 죽는다.
 * 지금은 하나다: 운영에서 인증을 켠 채 `ALLOW_INSECURE_COOKIES=true`로 평문 HTTP 세션을
 * 허용한 배포.
 */
export function webConfigWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  if (webConfigFailure(env) !== null) return [];
  const warnings: string[] = [];
  if (resolveWebConfig(env).authEnabled && insecureCookiesAllowed(env)) {
    warnings.push(
      'ALLOW_INSECURE_COOKIES=true — Session cookies are issued without Secure. Anyone on the same network can ' +
        'intercept sessions over plain HTTP. Pilot use only: after enabling TLS, restore SESSION_COOKIE_SECURE=true and remove this setting ' +
        '(FR-AUTH-001 AC-2, RUNBOOK chapter 6)',
    );
  }
  return warnings;
}

/** 던져진 것에서 사람이 읽을 이유만 꺼낸다. 값이 아니라 계약 문구다. */
function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
