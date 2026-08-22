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

export function resolveMirrorConfig(env: GitHubEnv = process.env): MirrorConfig {
  const root = (env['MIRROR_ROOT'] ?? DEFAULT_MIRROR_ROOT).replace(/\/+$/, '');
  return {
    root: root === '' ? DEFAULT_MIRROR_ROOT : root,
    // 문자열 `'true'`만 켠다. 오타나 `'0'`이 켜짐으로 읽히면 조용히 소스가 볼륨에 쌓인다.
    allowBlobFetch: env['MIRROR_ALLOW_BLOB_FETCH'] === 'true',
  };
}

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
 */
export function parseInstallations(env: GitHubEnv = process.env): InstallationBinding[] {
  const raw = (env['GHE_INSTALLATIONS'] ?? '').trim();
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
      throw new Error(`GHE_INSTALLATIONS 항목 형식이 잘못됐다: ${item} (org:installationId)`);
    }

    const key = org.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`GHE_INSTALLATIONS에 조직이 두 번 나온다: ${org}`);
    }
    seen.add(key);
    bindings.push({ org, installationId });
  }
  return bindings;
}
