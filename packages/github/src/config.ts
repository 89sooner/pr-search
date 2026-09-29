/**
 * GitHub Enterprise 접속 설정 (SRS 10장 외부 인터페이스).
 *
 * 값은 환경 변수에서만 읽는다. App private key는 코드·로그·오류 어디에도
 * 남기지 않는다 (보안 문서 6장, THR-009).
 */

import type { InstallationBinding } from './token-pool.js';

export interface GitHubEnv {
  readonly [key: string]: string | undefined;
}

export interface GitHubAppConfig {
  /** GHE 웹 호스트. 예: `https://ghe.example.com` */
  readonly baseUrl: string;
  /** REST API 루트. GHE는 `/api/v3`가 붙는다 — github.com과 다른 지점이다. */
  readonly apiUrl: string;
  /**
   * GraphQL 끝점 (CR-135). GHES는 `/api/graphql`이다 — REST 루트 아래(`/api/v3/graphql`)가 아니다.
   * `GHE_GRAPHQL_URL`이 비면 `apiUrl`에서 도출한다(`deriveGraphqlUrl`).
   */
  readonly graphqlUrl: string;
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

/** 미러 볼륨 루트의 기본값. ADR-005의 예시 경로와 같다 (CR-023, DEV-109). */
export const DEFAULT_MIRROR_ROOT = '/mirrors';

export interface MirrorConfig {
  readonly root: string;
  /**
   * blob 지연 인출 허용 여부 (CR-023, DEV-111).
   *
   * **기본은 `false`다.** 켜면 `git patch-id`가 살아나 체리픽 탐지
   * (FR-REL-005 AC-2)가 가능해지지만, git이 promisor 원격에서 blob을 받아와
   * **미러 볼륨에 남긴다.** 그러면 THR-015의 완화 근거("blobless라 파일
   * 내용이 없음")와 인프라 5장의 용량 산정이 함께 무너진다. 끄면
   * FR-REL-005 AC-5가 정의한 `patch_id_unavailable` 경로로 간다.
   */
  readonly allowBlobFetch: boolean;
}

/**
 * 비어 있거나 공백뿐이면 기본값을 쓰고, 끝의 `/`를 떼어 낸다.
 *
 * **`.env`의 `KEY=`는 미설정이 아니라 빈 문자열이다** (`DEV-548`). `??`는
 * `undefined`만 걸러 내므로 빈 값이 그대로 값이 되고, URL 자리에서는 경로만 남은
 * 상대 요청이 `Failed to parse URL`로 죽는다. `.env.example`이 `GHE_BASE_URL`·
 * `GHE_API_URL`을 빈 값으로 배포하므로 **표준 GHE 배포에서도 밟는다** — 사내
 * 반입(2026-09-07)에서 설치 토큰 발급이 이 경로로 실패했다.
 *
 * `resolveMirrorConfig`는 빈 문자열만 걸러 내고 있었다. 공백뿐인 값은 그대로
 * 통과해 미러가 엉뚱한 경로에 쌓이므로 같은 규율로 모았다.
 */
function withBlankFallback(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? fallback.replace(/\/+$/, '') : trimmed;
}

export function resolveMirrorConfig(env: GitHubEnv = process.env): MirrorConfig {
  return {
    root: withBlankFallback(env['MIRROR_ROOT'], DEFAULT_MIRROR_ROOT),
    // 문자열 `'true'`만 켠다. 오타나 `'0'`이 켜짐으로 읽히면 조용히 소스가 볼륨에 쌓인다.
    allowBlobFetch: env['MIRROR_ALLOW_BLOB_FETCH'] === 'true',
  };
}

/** `GHE_BASE_URL`이 비었을 때 쓰는 값. 실제 배포는 이 값으로 동작하지 않는다. */
const DEFAULT_GHE_BASE_URL = 'https://ghe.example.com';

/**
 * REST 루트에서 GraphQL 끝점을 도출한다 (CR-135).
 *
 * GHES는 REST가 `/api/v3`, GraphQL이 `/api/graphql`로 **형제**다 — `${apiUrl}/graphql`로 붙이면 `/api/v3/graphql`이 되어
 * 없는 경로다. github.com은 REST 루트가 `https://api.github.com`이고 GraphQL이 그 아래 `/graphql`이다. 그래서 `/api/v3`로
 * 끝나면 그 꼬리를 바꾸고, 아니면 루트 아래에 붙인다.
 */
export function deriveGraphqlUrl(apiUrl: string): string {
  return /\/api\/v3$/.test(apiUrl) ? apiUrl.replace(/\/api\/v3$/, '/api/graphql') : `${apiUrl}/graphql`;
}

/**
 * `GHE_GRAPHQL_URL` (CR-135). 비었거나 공백뿐이면 도출하고(`DEV-548`과 같은 규율), 명시 값은 http(s) URL이어야 하며
 * query·fragment를 갖지 않는다 — 형식이 깨지면 기동 시점에 던진다(`parseInstallations`와 같은 규율). 값은 메시지에
 * 싣지 않는다: 주소에 사용자 정보가 붙어 있을 수 있다.
 */
function resolveGraphqlUrl(value: string | undefined, apiUrl: string): string {
  const explicit = withBlankFallback(value, '');
  if (explicit === '') return deriveGraphqlUrl(apiUrl);
  let parsed: URL;
  try {
    parsed = new URL(explicit);
  } catch {
    throw new Error('GHE_GRAPHQL_URL이 URL이 아니다 (http(s)://host/path)');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('GHE_GRAPHQL_URL은 http(s) URL이어야 한다');
  }
  // `https://x/a?`는 search가 빈 문자열로 읽힌다 — 해석 결과가 아니라 원문을 본다.
  if (explicit.includes('?') || explicit.includes('#')) {
    throw new Error('GHE_GRAPHQL_URL에 query나 fragment를 붙이지 않는다');
  }
  return explicit;
}

export function resolveGitHubConfig(env: GitHubEnv = process.env): GitHubAppConfig {
  const baseUrl = withBlankFallback(env['GHE_BASE_URL'], DEFAULT_GHE_BASE_URL);
  // GHE의 REST 루트는 `/api/v3`다. 명시 설정이 있으면 그것을 쓴다.
  const apiUrl = withBlankFallback(env['GHE_API_URL'], `${baseUrl}/api/v3`);
  return {
    baseUrl,
    apiUrl,
    graphqlUrl: resolveGraphqlUrl(env['GHE_GRAPHQL_URL'], apiUrl),
    appId: env['GHE_APP_ID'] ?? '',
    privateKey: (env['GHE_APP_PRIVATE_KEY'] ?? '').replace(/\\n/g, '\n'),
    requestTimeoutMs: Number(env['GHE_REQUEST_TIMEOUT_MS'] ?? '10000'),
    tokenRefreshLeadMs: Number(env['GHE_TOKEN_REFRESH_LEAD_MS'] ?? String(TOKEN_REFRESH_LEAD_MS)),
    quarantineThreshold: Number(env['GHE_QUARANTINE_THRESHOLD'] ?? String(QUARANTINE_THRESHOLD)),
    maxConcurrentRequests: Number(env['GHE_MAX_CONCURRENT_REQUESTS'] ?? '8'),
  };
}

/**
 * URL 참조를 인정할 GHE 호스트 (THR-036 / FR-REL-003 AC-1, CR-124).
 *
 * **`resolveGitHubConfig().baseUrl`을 쓰지 않는다.** 그 값은 `GHE_BASE_URL`이 비면
 * `https://ghe.example.com`으로 채워진다. 접속 설정에서는 그 대체값이 곧바로 연결 실패로
 * 드러나지만, 참조 추출에서는 **조용히 다른 호스트를 승인한다** — 실제 GHE의 URL은 거절하고
 * 쓰이지 않는 예시 호스트의 URL은 내부 대상으로 해석한다. 단일 호스트의 link·batch 역할이
 * 이 값을 받지 않아 사내 GHE의 PR·커밋 URL이 참조 0건으로 파생됐다(DEV-776).
 *
 * 비었거나 해석되지 않으면 `null`이다 — URL 참조를 만들지 않는다(fail closed). 돌려주는 것은
 * 비교에 쓰는 호스트(`host[:port]`, 소문자)뿐이며, 주소에 사용자 정보가 붙어 있어도 싣지 않는다.
 * 호스트를 코드에 두지 않는다 — 배포 설정이 유일한 출처다.
 */
export function resolveReferenceHost(env: GitHubEnv = process.env): string | null {
  const raw = (env['GHE_BASE_URL'] ?? '').trim();
  if (raw === '') return null;
  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).host.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

export function hasAppCredentials(config: GitHubAppConfig): boolean {
  return config.appId !== '' && config.privateKey !== '';
}

/**
 * `org -> installationId` binding의 출처 (CR-010, DEV-015).
 *
 * `GHE_INSTALLATIONS="acme:12345,contoso:67890"` 한 곳에서만 읽는다. 조직마다
 * 설치가 다르고 설치마다 rate limit이 따로 걸리므로, 이 표가 곧 "어느 한도를
 * 쓰는가"의 정의다. **임의의 고정 installation ID를 코드에 넣지 않는다** —
 * 그러면 다른 조직 저장소의 이벤트가 조용히 처리되지 않는다.
 *
 * 형식이 깨지면 기동 시점에 던진다. 잘못된 항목을 조용히 건너뛰면 그 조직의
 * 이벤트만 영문 모르게 실패 대기열로 간다.
 *
 * 장래에 저장소 등록(FR-ING-009) 기반 조회로 옮기더라도 호출 측은 이 함수
 * 하나만 바라보므로 교체 지점이 한 곳이다.
 *
 * ## 왜 변수 이름을 인자로 받는가 (WP-075 / CR-084)
 *
 * 표기 전용 App은 **자기 설치 표**를 갖는다 (`GHE_ANNOTATE_INSTALLATIONS`,
 * `FR-SEQ-009` AC-5). 형식도 검증도 같으므로 파서를 한 벌만 둔다 — 같은 형식에
 * 검사기가 둘이면 한쪽만 고쳐지는 날이 온다. **이 함수는 주어진 이름의 값을 읽어
 * 형태만 확인할 뿐 어떤 자격 증명도 다른 App으로 옮기지 않는다.**
 */
export function parseInstallations(
  env: GitHubEnv = process.env,
  variableName = 'GHE_INSTALLATIONS',
): InstallationBinding[] {
  const raw = (env[variableName] ?? '').trim();
  if (raw === '') return [];

  const bindings: InstallationBinding[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const item = entry.trim();
    if (item === '') continue;

    const separator = item.lastIndexOf(':');
    const org = separator === -1 ? '' : item.slice(0, separator).trim();
    const idText = separator === -1 ? '' : item.slice(separator + 1).trim();
    const installationId = Number(idText);
    if (org === '' || !/^[0-9]+$/.test(idText) || !Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new Error(`${variableName} 항목 형식이 잘못됐다: ${item} (org:installationId)`);
    }

    const key = org.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${variableName}에 조직이 두 번 나온다: ${org}`);
    }
    seen.add(key);
    bindings.push({ org, installationId });
  }
  return bindings;
}
