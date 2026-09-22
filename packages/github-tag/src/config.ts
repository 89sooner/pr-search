/**
 * 태그 전용 GitHub App의 설정 (WP-100 / FR-SEQ-012 AC-6, ADR-026).
 *
 * ## 조회용 Data App·표기용 App의 값을 읽지 않는다
 *
 * `GHE_APP_*`·`GHE_ANNOTATE_*`를 이 파일은 **읽지 않는다.** 태그 생성은 `contents: write`를
 * 요구하고 그것은 제목 갱신(`pull_requests: write`)보다 넓은 권한이다 — 한 자격이 두
 * 반경을 갖는 순간 `THR-047`·`THR-061`의 완화 근거(자격마다 다른 행으로 관리되고 유출의
 * 피해 범위가 다르다)가 사라진다. 운영자가 두 변수에 같은 App을 넣는 것은 운영자의
 * 선택이지만, 코드는 그것을 전제하지 않는다. 공유하는 것은 **호스트 주소뿐**이다.
 *
 * ## 기본값은 꺼짐이다
 *
 * 이 코드를 받는 것만으로 원격 저장소에 태그가 생겨서는 안 된다(ADR-022가 표기에
 * 세운 규율 그대로). 전역 스위치가 없으면 꺼진 것으로 본다.
 */

import { TOKEN_REFRESH_LEAD_MS, parseInstallations } from '@prs/github';
import type { GitHubEnv, InstallationBinding } from '@prs/github';

/** 잔여 스윕 간격의 기본값 (일 1회, JOB-SEQ-007). 과거 채번분의 backfill과 유실 복구가 여기서 돈다. */
export const DEFAULT_TAG_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
/** 한 번의 스윕이 work로 만드는 최대 행 수. 첫 스윕이 전체 이력을 한 번에 큐에 넣지 않게 한다. */
export const DEFAULT_TAG_SWEEP_LIMIT = 500;
/** 권한 차단을 이만큼 지난 뒤 스윕이 한 번 다시 본다. */
export const DEFAULT_TAG_BLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
/** 한 work 시도 안의 전체 요청 횟수 상한(첫 시도 + 재시도 넷). 일시 실패에만 쓴다. */
export const TAG_MAX_ATTEMPTS = 5;
/**
 * 변경 요청 사이의 최소 간격 — 공식 문서의 하한(변경 요청 사이 최소 1초, 직렬)이다.
 * 표기와 같은 근거이며 설정으로도 이 아래로 내릴 수 없다.
 */
export const MIN_TAG_WRITE_SPACING_MS = 1_000;

export interface TagConfig {
  /** `MNUMBER_TAG_ENABLED`. 기본 `false`. */
  readonly enabled: boolean;
  /** GHE REST 루트. 조회·표기 경로와 같은 호스트를 가리킨다. */
  readonly apiUrl: string;
  /** 태그 **전용** App의 ID. */
  readonly appId: string;
  /** 태그 전용 App의 PEM 개인 키. 로그·오류·URL 어디에도 남기지 않는다. */
  readonly privateKey: string;
  /** `org -> installationId`. 태그 전용 App의 설치다. */
  readonly installations: readonly InstallationBinding[];
  readonly requestTimeoutMs: number;
  readonly tokenRefreshLeadMs: number;
  readonly sweepIntervalMs: number;
  readonly sweepLimit: number;
  readonly blockCooldownMs: number;
  /** 실제로 쓴 뒤 다음 쓰기까지의 간격. 하한은 1초다. */
  readonly writeSpacingMs: number;
}

function readBoundedInt(env: GitHubEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = (env[key] ?? '').trim();
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key}는 ${String(min)}..${String(max)}의 정수여야 한다: ${raw}`);
  }
  return value;
}

/**
 * 전역 태그 스위치.
 *
 * **`MNUMBER_ENABLED`·`MNUMBER_ANNOTATE_ENABLED`와 다른 값이다.** 채번은 켜고 태그는
 * 끄는 형상, 표기는 켜고 태그는 끄는 형상이 모두 정상이며 반입의 단계마다 다르다.
 * 빈 문자열은 꺼짐이고 그 밖의 값은 기동을 거부한다 — 오타가 조용히 꺼짐으로 접히면
 * 운영자가 켰다고 믿는 쓰기가 일어나지 않고 그것을 알 신호도 없다.
 */
export function resolveTagEnabled(env: GitHubEnv = process.env): boolean {
  const raw = (env['MNUMBER_TAG_ENABLED'] ?? 'false').trim();
  if (raw === 'true') return true;
  if (raw === 'false' || raw === '') return false;
  throw new Error(`MNUMBER_TAG_ENABLED는 true 또는 false여야 한다: ${raw}`);
}

function withBlankFallback(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? fallback.replace(/\/+$/, '') : trimmed;
}

export function resolveTagConfig(env: GitHubEnv = process.env): TagConfig {
  const baseUrl = withBlankFallback(env['GHE_BASE_URL'], 'https://ghe.example.com');
  return {
    enabled: resolveTagEnabled(env),
    apiUrl: withBlankFallback(env['GHE_API_URL'], `${baseUrl}/api/v3`),
    appId: (env['GHE_TAG_APP_ID'] ?? '').trim(),
    // `.env` 한 줄에 담으려고 개행을 이스케이프한다. 다른 두 App 키와 같은 관례다.
    privateKey: (env['GHE_TAG_PRIVATE_KEY'] ?? '').replace(/\\n/g, '\n'),
    installations: parseInstallations(env, 'GHE_TAG_INSTALLATIONS'),
    requestTimeoutMs: readBoundedInt(env, 'GHE_TAG_REQUEST_TIMEOUT_MS', 10_000, 1_000, 30_000),
    tokenRefreshLeadMs: TOKEN_REFRESH_LEAD_MS,
    sweepIntervalMs: readBoundedInt(env, 'MNUMBER_TAG_SWEEP_MS', DEFAULT_TAG_SWEEP_INTERVAL_MS, 60_000, 7 * DEFAULT_TAG_SWEEP_INTERVAL_MS),
    sweepLimit: readBoundedInt(env, 'MNUMBER_TAG_SWEEP_LIMIT', DEFAULT_TAG_SWEEP_LIMIT, 1, 5_000),
    blockCooldownMs: readBoundedInt(
      env,
      'MNUMBER_TAG_BLOCK_COOLDOWN_MS',
      DEFAULT_TAG_BLOCK_COOLDOWN_MS,
      60_000,
      30 * DEFAULT_TAG_BLOCK_COOLDOWN_MS,
    ),
    writeSpacingMs: readBoundedInt(env, 'MNUMBER_TAG_WRITE_SPACING_MS', MIN_TAG_WRITE_SPACING_MS, MIN_TAG_WRITE_SPACING_MS, 60_000),
  };
}

/** 쓰기를 시도할 수 있는 자격이 갖춰졌는가. 값의 유효성이 아니라 존재만 본다. */
export function hasTagCredentials(config: TagConfig): boolean {
  return config.appId !== '' && config.privateKey !== '' && config.installations.length > 0;
}

/**
 * 켜 놓고 자격이 없는 배포를 **쓰기 전에** 막는다. 사유만 돌려주고 던지지 않는다 —
 * 값을 문구에 넣지 않는다: 없는 값은 보여 줄 것이 없고 있는 값은 비밀이다.
 */
export function tagConfigFailure(config: TagConfig): string | null {
  if (!config.enabled) return null;
  const missing: string[] = [];
  if (config.appId === '') missing.push('GHE_TAG_APP_ID');
  if (config.privateKey === '') missing.push('GHE_TAG_PRIVATE_KEY');
  if (config.installations.length === 0) missing.push('GHE_TAG_INSTALLATIONS');
  if (missing.length === 0) return null;
  return `MNUMBER_TAG_ENABLED=true인데 태그 전용 App 자격이 없다: ${missing.join(', ')}`;
}
