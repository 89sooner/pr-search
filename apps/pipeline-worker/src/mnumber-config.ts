/**
 * M 번호와 선행 freshness의 배포 설정 (WP-074 / CR-079, 상세 설계 4.2 · 10절).
 *
 * 값은 환경 변수에서만 읽는다. **잘못된 값은 기동을 거부한다** — 조용히 기본값으로
 * 돌면 운영자가 켰다고 믿는 기능이 꺼진 채 돈다 (CR-078이 세운 규율).
 */

export interface ConfigEnv {
  readonly [key: string]: string | undefined;
}

export type SequenceGraphMode = 'mirror' | 'api';

/**
 * `SEQUENCE_GRAPH_MODE` — sequence 역할이 head와 first-parent 체인을 어디서 읽는가.
 *
 * - `mirror` (Profile A 기본): 채번 전에 미러를 fetch해 최신으로 만든다. 미러 볼륨이 필요하다.
 * - `api` (Profile B): 미러 없이 GHE REST로 head를 다시 읽는다. 로컬 캐시의 존재를 가정하지 않는다.
 *
 * `repository.mirror_enabled = false`인 저장소는 어느 모드에서도 API 경로다.
 */
export function resolveSequenceGraphMode(env: ConfigEnv = process.env): SequenceGraphMode {
  const raw = (env['SEQUENCE_GRAPH_MODE'] ?? 'mirror').trim();
  if (raw === 'mirror' || raw === 'api') return raw;
  throw new Error(`SEQUENCE_GRAPH_MODE는 mirror 또는 api여야 한다: ${raw}`);
}

export interface MergeNumberConfig {
  /** 기본 `false`. 이 기능만 끈다 — DEV-576 freshness는 이 값과 무관하게 돈다. */
  readonly enabled: boolean;
  /** 한 회차의 batch 크기 (1..1000). */
  readonly batchSize: number;
  /** durable work poll 간격 (100..60000ms). */
  readonly pollMs: number;
  /** 재시도 백오프 상한 (ms). */
  readonly retryMaxMs: number;
  /** 적용 프로파일. 지금은 `squash_only`뿐이다. */
  readonly profile: 'squash_only';
}

function readBoundedInt(env: ConfigEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = (env[key] ?? '').trim();
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key}는 ${String(min)}..${String(max)}의 정수여야 한다: ${raw}`);
  }
  return value;
}

export function resolveMergeNumberConfig(env: ConfigEnv = process.env): MergeNumberConfig {
  const enabledRaw = (env['MNUMBER_ENABLED'] ?? 'false').trim();
  if (enabledRaw !== 'true' && enabledRaw !== 'false') {
    throw new Error(`MNUMBER_ENABLED는 true 또는 false여야 한다: ${enabledRaw}`);
  }
  const profile = (env['MNUMBER_PROFILE'] ?? 'squash_only').trim();
  if (profile !== 'squash_only') {
    throw new Error(`MNUMBER_PROFILE은 squash_only만 지원한다: ${profile}`);
  }
  return {
    enabled: enabledRaw === 'true',
    batchSize: readBoundedInt(env, 'MNUMBER_BATCH_SIZE', 100, 1, 1_000),
    pollMs: readBoundedInt(env, 'MNUMBER_POLL_MS', 1_000, 100, 60_000),
    retryMaxMs: readBoundedInt(env, 'MNUMBER_RETRY_MAX_MS', 60_000, 1_000, 3_600_000),
    profile: 'squash_only',
  };
}
