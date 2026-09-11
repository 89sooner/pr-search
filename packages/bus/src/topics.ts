/**
 * 스트림·소비자 그룹·파티션 (비동기 문서 2장).
 *
 * 파티션 수는 그 문서의 "동시성" 열에서 그대로 왔다. 동시성 상한이 곧 파티션
 * 수인 이유는, 한 파티션을 한 소비자만 맡기 때문이다 — 파티션이 8개면 워커를
 * 아무리 늘려도 8개까지만 일한다.
 */

export const TOPICS = {
  ingest: 'prs:ingest',
  enriched: 'prs:enriched',
  projected: 'prs:projected',
  sequence: 'prs:sequence',
  release: 'prs:release',
  batch: 'prs:batch',
  permission: 'prs:permission',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const CONSUMER_GROUPS = {
  [TOPICS.ingest]: 'enrich',
  [TOPICS.enriched]: 'project',
  [TOPICS.projected]: 'link',
  [TOPICS.sequence]: 'sequence',
  [TOPICS.release]: 'release',
  [TOPICS.batch]: 'batch',
  [TOPICS.permission]: 'authz',
} as const;

/**
 * 한 토픽을 **독립적으로** 읽는 소비자들 (CR-038, DEV-205).
 *
 * ## 왜 필요한가
 *
 * consumer group은 broadcast가 아니라 **work sharing**이다 — 같은 group으로 두
 * 소비자가 붙으면 이벤트가 둘 사이에 나뉘고, 각자 절반씩만 본다. 그런데
 * `prs:projected`는 **두 가지 독립된 일**의 방아쇠다: 관계 간선 파생(WP-029)과
 * 커밋 메타데이터 보강(WP-067). 둘은 서로의 결과를 필요로 하지 않고 **같은
 * 이벤트를 각각 전부** 받아야 한다.
 *
 * 그래서 토픽별로 논리 소비자 이름을 카탈로그에 둔다. **기본 그룹 이름은 바꾸지
 * 않는다** — 기존 소비자의 group을 바꾸면 Redis에서 **읽던 자리를 잃고** 그 사이
 * 이벤트를 다시 읽거나 건너뛴다.
 *
 * 여기에 없는 이름을 쓰면 던진다. 오타 난 이름이 조용히 새 group을 만들면 그
 * 소비자는 처음부터 다시 읽고, 아무도 그 사실을 모른다.
 */
export const LOGICAL_CONSUMERS: Readonly<Record<Topic, readonly string[]>> = {
  [TOPICS.ingest]: ['enrich'],
  [TOPICS.enriched]: ['project'],
  // `link`는 기본값이라 이름이 그대로 group이 된다 (WP-029). `commit-enrich`는 WP-067.
  // `mnumber`는 WP-074 — sequence.assigned/reassigned 힌트로 durable 러너를 깨운다.
  [TOPICS.projected]: ['link', 'commit-enrich', 'mnumber'],
  [TOPICS.sequence]: ['sequence'],
  [TOPICS.release]: ['release'],
  [TOPICS.batch]: ['batch'],
  [TOPICS.permission]: ['authz'],
};

/**
 * 토픽별 파티션 수.
 *
 * `prs:sequence`만 비동기 문서에 전체 동시성 숫자가 없다 — "시퀀스 공간당 1
 * (advisory lock)"이라고만 적혀 있다. 순서 보장은 advisory lock이 이미 하므로
 * 여기 숫자는 처리량 조절값이고, 관계 파생과 같은 8로 두었다 (DEV-010).
 * 환경 변수로 덮어쓸 수 있게 해 두었으니 운영 실측 뒤 코드 변경 없이 바꾼다.
 */
export const PARTITION_COUNTS: Readonly<Record<Topic, number>> = {
  [TOPICS.ingest]: 16,
  [TOPICS.enriched]: 16,
  [TOPICS.projected]: 8,
  [TOPICS.sequence]: 8,
  // 저장소당 직렬 (CR-028, DEV-144). diff 갱신은 멱등이라 넓은 동시성이 필요 없다.
  [TOPICS.release]: 4,
  [TOPICS.batch]: 3,
  [TOPICS.permission]: 4,
};

/** 토픽별 파티션 키가 무엇인지. 코드가 아니라 읽는 사람을 위한 표다. */
export const PARTITION_KEY_SOURCES: Readonly<Record<Topic, string>> = {
  [TOPICS.ingest]: 'repository_id',
  [TOPICS.enriched]: 'repository_id',
  [TOPICS.projected]: 'repository_id',
  [TOPICS.sequence]: 'repository_id:base_branch',
  [TOPICS.release]: 'repository_id',
  [TOPICS.batch]: 'job_id',
  [TOPICS.permission]: 'user_id',
};

export function isKnownTopic(topic: string): topic is Topic {
  return Object.hasOwn(PARTITION_COUNTS, topic);
}

/**
 * 토픽의 파티션 수.
 *
 * 카탈로그에 없는 토픽은 던진다. 조용히 기본값을 쓰면 오타 난 토픽 이름이
 * 새 스트림을 만들어 버리고, 그 이벤트는 아무도 소비하지 않는다.
 */
export function partitionCount(topic: string, overrides: Readonly<Record<string, number>> = {}): number {
  const override = overrides[topic];
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 1) {
      throw new Error(`파티션 수는 1 이상의 정수여야 한다: ${topic}=${String(override)}`);
    }
    return override;
  }
  if (!isKnownTopic(topic)) {
    throw new Error(`알 수 없는 토픽이다: ${topic}. 비동기 문서 2장의 스트림 6종만 쓴다`);
  }
  return PARTITION_COUNTS[topic];
}

/**
 * 소비자 그룹 이름.
 *
 * `consumer`를 생략하면 토픽의 **기본 그룹**이다 — 기존 호출부의 이름이 그대로
 * 유지되어야 Redis에서 읽던 자리를 잃지 않는다 (CR-038, DEV-205).
 *
 * 두 번째 이후의 논리 소비자는 `<기본 그룹>:<소비자>` 형태의 **다른 group**을
 * 얻는다. 그래야 같은 토픽의 같은 이벤트를 각자 전부 받는다.
 *
 * @throws 카탈로그에 없는 소비자 이름이면 던진다. 조용히 새 group을 만들면 그
 * 소비자는 처음부터 다시 읽고 아무도 그 사실을 모른다.
 */
export function consumerGroup(topic: string, consumer?: string): string {
  if (!isKnownTopic(topic)) {
    throw new Error(`알 수 없는 토픽이다: ${topic}`);
  }
  const base = CONSUMER_GROUPS[topic];
  if (consumer === undefined || consumer === base) return base;

  const known = LOGICAL_CONSUMERS[topic];
  if (!known.includes(consumer)) {
    throw new Error(`알 수 없는 논리 소비자다: ${topic}/${consumer}. 카탈로그(LOGICAL_CONSUMERS)에 먼저 등록한다`);
  }
  return `${base}:${consumer}`;
}

/** 파티션 하나에 대응하는 실제 스트림 이름. */
export function partitionStream(topic: string, partition: number): string {
  return `${topic}:${String(partition)}`;
}
