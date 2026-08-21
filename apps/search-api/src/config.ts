/**
 * search-api 설정 (WP-009).
 *
 * 값은 환경 변수에서만 읽는다. 토큰은 코드·로그·응답 어디에도 남기지 않는다
 * (보안 문서 6장, NFR-005).
 */

export interface SearchApiEnv {
  readonly [key: string]: string | undefined;
}

export interface SearchApiConfig {
  readonly port: number;
  /**
   * 관리 API 임시 공유 토큰 (CR-012, DEV-025).
   *
   * **최종 권한은 `operator` 역할이며 그 판정은 WP-012의 OIDC 세션이 세운다.**
   * REL-001에는 사용자 신원 자체가 없어 그때까지의 임시 통제다. 값이 없으면
   * `null`이고, 그러면 관리 경로를 아예 등록하지 않는다 — 인증 수단 없이 열린
   * 변경 API를 두는 것보다 없는 편이 낫다.
   */
  readonly adminToken: string | null;
}

export function resolveSearchApiConfig(env: SearchApiEnv = process.env): SearchApiConfig {
  const token = env['ADMIN_API_TOKEN'];
  return {
    port: Number(env['SEARCH_API_PORT'] ?? '3002'),
    adminToken: token === undefined || token === '' ? null : token,
  };
}
