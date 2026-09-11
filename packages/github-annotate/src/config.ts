/**
 * 표기 전용 GitHub App의 설정 (WP-075 / FR-SEQ-009 AC-5, ADR-022 결정 1).
 *
 * ## 조회용 Data App의 값을 하나도 읽지 않는다
 *
 * `GHE_APP_ID`·`GHE_APP_PRIVATE_KEY`·`GHE_INSTALLATIONS`를 이 파일은 **읽지 않는다**.
 * 읽는 순간 "조회 자격으로도 쓸 수 있다"가 되고, 그러면 `THR-047`의 완화 근거
 * (두 App의 키가 서로 다른 행으로 관리된다)가 사라진다. 공유하는 것은 **호스트
 * 주소뿐**이다 — 같은 GHE를 가리키는 URL은 자격 증명이 아니다.
 *
 * ## 기본값은 꺼짐이다
 *
 * 이 제품이 사람의 지시 없이 GHE를 고치는 최초의 경로다 (ADR-022). 기존 배포가
 * 이 코드를 받는 것만으로 남의 PR 제목이 바뀌어서는 안 되므로, 전역 스위치가
 * 없으면 꺼진 것으로 본다.
 */

import { TOKEN_REFRESH_LEAD_MS, parseInstallations } from '@prs/github';
import type { GitHubEnv, InstallationBinding } from '@prs/github';

/** 잔여 스윕 간격의 기본값 (일 1회, JOB-SEQ-005). */
export const DEFAULT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
/** 한 번의 스윕이 보는 최대 행 수. GHE 한도를 한 회차가 다 쓰지 않게 한다. */
export const DEFAULT_SWEEP_LIMIT = 200;
/** 권한 차단을 이만큼 지난 뒤 스윕이 한 번 다시 본다. */
export const DEFAULT_BLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
/** JOB-SEQ-005의 재시도 횟수. 일시 실패에만 쓴다. */
export const ANNOTATE_MAX_ATTEMPTS = 5;

export interface AnnotateConfig {
  /** `MNUMBER_ANNOTATE_ENABLED`. 기본 `false`. */
  readonly enabled: boolean;
  /** GHE REST 루트. 조회 경로와 같은 호스트를 가리킨다. */
  readonly apiUrl: string;
  /** 표기 **전용** App의 ID. Data App의 것이 아니다. */
  readonly appId: string;
  /** 표기 전용 App의 PEM 개인 키. 로그·오류·URL 어디에도 남기지 않는다. */
  readonly privateKey: string;
  /** `org -> installationId`. 표기 전용 App의 설치다. */
  readonly installations: readonly InstallationBinding[];
  readonly requestTimeoutMs: number;
  readonly tokenRefreshLeadMs: number;
  readonly sweepIntervalMs: number;
  readonly sweepLimit: number;
  readonly blockCooldownMs: number;
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
 * 전역 표기 스위치.
 *
 * **`MNUMBER_ENABLED`와 다른 값이다.** 채번(`FR-SEQ-008`)은 켜고 표기
 * (`FR-SEQ-009`)는 끄는 형상이 정상이며, 사내 반입의 첫 단계가 바로 그 상태다.
 * 한 값으로 묶으면 "번호는 보고 싶은데 제목은 아직 건드리지 마라"를 표현할 수 없다.
 *
 * 빈 문자열은 꺼짐이다(`resolveMergeNumberEnabled`와 같은 규칙). 그 밖의 값은
 * 기동을 거부한다 — 오타가 조용히 꺼짐으로 접히면 운영자가 켰다고 믿는 쓰기가
 * 일어나지 않고 그것을 알 신호도 없다.
 */
export function resolveAnnotateEnabled(env: GitHubEnv = process.env): boolean {
  const raw = (env['MNUMBER_ANNOTATE_ENABLED'] ?? 'false').trim();
  if (raw === 'true') return true;
  if (raw === 'false' || raw === '') return false;
  throw new Error(`MNUMBER_ANNOTATE_ENABLED는 true 또는 false여야 한다: ${raw}`);
}

function withBlankFallback(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? fallback.replace(/\/+$/, '') : trimmed;
}

export function resolveAnnotateConfig(env: GitHubEnv = process.env): AnnotateConfig {
  const baseUrl = withBlankFallback(env['GHE_BASE_URL'], 'https://ghe.example.com');
  return {
    enabled: resolveAnnotateEnabled(env),
    apiUrl: withBlankFallback(env['GHE_API_URL'], `${baseUrl}/api/v3`),
    appId: (env['GHE_ANNOTATE_APP_ID'] ?? '').trim(),
    // `.env` 한 줄에 담으려고 개행을 이스케이프한다. 조회 App 키와 같은 관례다.
    privateKey: (env['GHE_ANNOTATE_PRIVATE_KEY'] ?? '').replace(/\\n/g, '\n'),
    installations: parseInstallations(env, 'GHE_ANNOTATE_INSTALLATIONS'),
    requestTimeoutMs: readBoundedInt(env, 'GHE_ANNOTATE_REQUEST_TIMEOUT_MS', 10_000, 1_000, 30_000),
    tokenRefreshLeadMs: TOKEN_REFRESH_LEAD_MS,
    sweepIntervalMs: readBoundedInt(
      env,
      'MNUMBER_ANNOTATE_SWEEP_MS',
      DEFAULT_SWEEP_INTERVAL_MS,
      60_000,
      7 * DEFAULT_SWEEP_INTERVAL_MS,
    ),
    sweepLimit: readBoundedInt(env, 'MNUMBER_ANNOTATE_SWEEP_LIMIT', DEFAULT_SWEEP_LIMIT, 1, 5_000),
    blockCooldownMs: readBoundedInt(
      env,
      'MNUMBER_ANNOTATE_BLOCK_COOLDOWN_MS',
      DEFAULT_BLOCK_COOLDOWN_MS,
      60_000,
      30 * DEFAULT_BLOCK_COOLDOWN_MS,
    ),
  };
}

/** 쓰기를 시도할 수 있는 자격이 갖춰졌는가. 값의 유효성이 아니라 존재만 본다. */
export function hasAnnotateCredentials(config: AnnotateConfig): boolean {
  return config.appId !== '' && config.privateKey !== '' && config.installations.length > 0;
}

/**
 * 켜 놓고 자격이 없는 배포를 **쓰기 전에** 막는다 (§7의 fail-fast).
 *
 * 사유만 돌려주고 던지지 않는다 — 무엇을 로그로 남기고 무엇을 던질지는 역할을
 * 세우는 쪽이 정한다. 사유 문구에 값을 넣지 않는다: 없는 값은 보여 줄 것이
 * 없고 있는 값은 비밀이다.
 */
export function annotateConfigFailure(config: AnnotateConfig): string | null {
  if (!config.enabled) return null;
  const missing: string[] = [];
  if (config.appId === '') missing.push('GHE_ANNOTATE_APP_ID');
  if (config.privateKey === '') missing.push('GHE_ANNOTATE_PRIVATE_KEY');
  if (config.installations.length === 0) missing.push('GHE_ANNOTATE_INSTALLATIONS');
  if (missing.length === 0) return null;
  return `MNUMBER_ANNOTATE_ENABLED=true인데 표기 전용 App 자격이 없다: ${missing.join(', ')}`;
}
