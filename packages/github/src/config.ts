/**
 * GitHub Enterprise 접속 설정 (SRS 10장 외부 인터페이스).
 *
 * 값은 환경 변수에서만 읽는다. App private key는 코드·로그·오류 어디에도
 * 남기지 않는다 (보안 문서 6장, THR-009).
 */

export interface GitHubEnv {
  readonly [key: string]: string | undefined;
}

export interface GitHubAppConfig {
  /** GHE 웹 호스트. 예: `https://ghe.example.com` */
  readonly baseUrl: string;
  /** REST API 루트. GHE는 `/api/v3`가 붙는다 — github.com과 다른 지점이다. */
  readonly apiUrl: string;
  readonly appId: string;
  /** PEM 형식 RSA private key. 이 값은 절대 로그에 남기지 않는다. */
  readonly privateKey: string;
  readonly requestTimeoutMs: number;
  /** 설치 토큰을 만료 몇 ms 전에 미리 갱신할지. */
  readonly tokenRefreshLeadMs: number;
  /** 잔여 한도가 이 비율 미만이면 토큰을 격리한다 (FR-ING-004 AC-2). */
  readonly quarantineThreshold: number;
  readonly maxConcurrentRequests: number;
}

/** 설치 토큰 만료 1시간 중 미리 갱신할 여유. */
export const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1_000;
/** FR-ING-004 AC-2가 정한 10%. */
export const QUARANTINE_THRESHOLD = 0.1;

export function resolveGitHubConfig(env: GitHubEnv = process.env): GitHubAppConfig {
  const baseUrl = (env['GHE_BASE_URL'] ?? 'https://ghe.example.com').replace(/\/+$/, '');
  return {
    baseUrl,
    // GHE의 REST 루트는 `/api/v3`다. 명시 설정이 있으면 그것을 쓴다.
    apiUrl: (env['GHE_API_URL'] ?? `${baseUrl}/api/v3`).replace(/\/+$/, ''),
    appId: env['GHE_APP_ID'] ?? '',
    privateKey: (env['GHE_APP_PRIVATE_KEY'] ?? '').replace(/\\n/g, '\n'),
    requestTimeoutMs: Number(env['GHE_REQUEST_TIMEOUT_MS'] ?? '10000'),
    tokenRefreshLeadMs: Number(env['GHE_TOKEN_REFRESH_LEAD_MS'] ?? String(TOKEN_REFRESH_LEAD_MS)),
    quarantineThreshold: Number(env['GHE_QUARANTINE_THRESHOLD'] ?? String(QUARANTINE_THRESHOLD)),
    maxConcurrentRequests: Number(env['GHE_MAX_CONCURRENT_REQUESTS'] ?? '8'),
  };
}

export function hasAppCredentials(config: GitHubAppConfig): boolean {
  return config.appId !== '' && config.privateKey !== '';
}
