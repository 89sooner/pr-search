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

/**
 * `MNUMBER_ENABLED` 하나만 읽는다 (WP-074 / DEV-607·DEV-608).
 *
 * ## 왜 따로 있는가
 *
 * `batch` 역할이 재색인 때문에 이 값을 알아야 하는데, `resolveMergeNumberConfig`를
 * 부르면 **채번 전용 값까지 검증하고 던진다** — `MNUMBER_BATCH_SIZE`의 오타 하나가
 * 채번과 무관한 정리·보존·재색인을 함께 멈춘다. K8s의 batch 매니페스트는
 * `envFrom: configMapRef`로 configmap 전체를 받으므로 그 경로가 실재한다.
 *
 * ## 켜짐의 정의는 여기 하나뿐이다
 *
 * `resolveMergeNumberConfig`도 이 함수를 부른다. 두 곳이 각자 판정하면 **같은 값에
 * 다른 답을 내는 날**이 오고, 그것이 역할 사이에서만 드러나 찾기 어렵다. 실제로
 * 그런 상태였다 — 인라인 판정은 `yes`를 조용히 꺼짐으로 접었고 설정 함수는 던졌다.
 *
 * 빈 문자열은 **꺼짐이다.** `??`는 `''`를 잡지 않아 그대로 내려오는데, compose는
 * 이미 빈 값을 `false`로 접고 있고 configmap의 빈 값 하나가 한 역할만 죽이는 것은
 * 얻는 것이 없다. `search-api`의 같은 함수와 규칙을 맞춘다.
 *
 * 그 밖의 값은 **기동을 거부한다.** 조용히 꺼진 채 돌면 운영자가 켰다고 믿는 기능이
 * 없는 상태가 되고 그것을 알아챌 신호가 없다.
 */
export function resolveMergeNumberEnabled(env: ConfigEnv = process.env): boolean {
  const raw = (env['MNUMBER_ENABLED'] ?? 'false').trim();
  if (raw === 'true') return true;
  if (raw === 'false' || raw === '') return false;
  throw new Error(`MNUMBER_ENABLED는 true 또는 false여야 한다: ${raw}`);
}

export function resolveMergeNumberConfig(env: ConfigEnv = process.env): MergeNumberConfig {
  // 켜짐의 정의를 다시 쓰지 않는다 — 갈라짐을 구조로 막는다 (DEV-608).
  const enabled = resolveMergeNumberEnabled(env);
  const profile = (env['MNUMBER_PROFILE'] ?? 'squash_only').trim();
  if (profile !== 'squash_only') {
    throw new Error(`MNUMBER_PROFILE은 squash_only만 지원한다: ${profile}`);
  }
  return {
    enabled,
    batchSize: readBoundedInt(env, 'MNUMBER_BATCH_SIZE', 100, 1, 1_000),
    pollMs: readBoundedInt(env, 'MNUMBER_POLL_MS', 1_000, 100, 60_000),
    retryMaxMs: readBoundedInt(env, 'MNUMBER_RETRY_MAX_MS', 60_000, 1_000, 3_600_000),
    profile: 'squash_only',
  };
}
