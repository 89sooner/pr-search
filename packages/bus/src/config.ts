/**
 * Redis 접속 설정.
 *
 * 값은 환경 변수에서만 읽는다 (보안 문서 6장). 로컬 기본값은 저장소 루트의
 * `docker-compose.yml`과 `.env.example`에 맞춘다.
 */

export interface BusEnv {
  readonly [key: string]: string | undefined;
}

export interface RedisConnectionConfig {
  readonly url: string;
  /**
   * 명령 재시도 상한.
   *
   * 기본값(20)이면 Redis가 내려갔을 때 명령이 한참 매달린다. 게이트웨이의
   * 발행은 202를 막지 않아야 하므로(ADR-002 follow-up) 빨리 실패하고 아웃박스에
   * 맡기는 편이 낫다.
   */
  readonly maxRetriesPerRequest: number;
  readonly connectTimeoutMs: number;
  /**
   * 명령 하나가 매달릴 수 있는 시간(ms).
   *
   * 이 값이 없으면 Redis가 응답만 안 하는 상태에서 발행이 영영 끝나지 않는다.
   */
  readonly commandTimeoutMs: number;
}

export function resolveRedisConfig(env: BusEnv = process.env): RedisConnectionConfig {
  return {
    url: env['REDIS_URL'] ?? 'redis://localhost:6379',
    maxRetriesPerRequest: Number(env['REDIS_MAX_RETRIES'] ?? '1'),
    connectTimeoutMs: Number(env['REDIS_CONNECT_TIMEOUT_MS'] ?? '2000'),
    commandTimeoutMs: Number(env['REDIS_COMMAND_TIMEOUT_MS'] ?? '1000'),
  };
}

/** 토픽별 파티션 수 덮어쓰기. `PRS_PARTITIONS_prs:sequence=16` 형태로 준다. */
export function resolvePartitionOverrides(env: BusEnv = process.env): Readonly<Record<string, number>> {
  const overrides: Record<string, number> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('PRS_PARTITIONS_') || value === undefined || value === '') continue;
    overrides[key.slice('PRS_PARTITIONS_'.length)] = Number(value);
  }
  return overrides;
}
