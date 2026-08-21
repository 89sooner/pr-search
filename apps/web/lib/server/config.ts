import 'server-only';

/**
 * `web` 서버 측 구성 (WP-015).
 *
 * `server-only`를 첫 줄에 두어 **클라이언트 컴포넌트가 이 파일을 가져오면
 * 빌드가 깨지게** 한다. 여기에는 `OIDC_CLIENT_SECRET`이 지나가므로 번들
 * 경계를 사람의 주의력에 맡기지 않는다 (NFR-005).
 */

import { resolveSessionReaderConfig, type SessionReaderConfig } from '@prs/authz';

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
