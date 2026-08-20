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
  batch: 'prs:batch',
  permission: 'prs:permission',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const CONSUMER_GROUPS = {
  [TOPICS.ingest]: 'enrich',
  [TOPICS.enriched]: 'project',
  [TOPICS.projected]: 'link',
  [TOPICS.sequence]: 'sequence',
  [TOPICS.batch]: 'batch',
  [TOPICS.permission]: 'authz',
} as const;

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
  [TOPICS.batch]: 3,
  [TOPICS.permission]: 4,
};

/** 토픽별 파티션 키가 무엇인지. 코드가 아니라 읽는 사람을 위한 표다. */
export const PARTITION_KEY_SOURCES: Readonly<Record<Topic, string>> = {
  [TOPICS.ingest]: 'repository_id',
  [TOPICS.enriched]: 'repository_id',
  [TOPICS.projected]: 'repository_id',
  [TOPICS.sequence]: 'repository_id:base_branch',
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

export function consumerGroup(topic: string): string {
  if (!isKnownTopic(topic)) {
    throw new Error(`알 수 없는 토픽이다: ${topic}`);
  }
  return CONSUMER_GROUPS[topic];
}

/** 파티션 하나에 대응하는 실제 스트림 이름. */
export function partitionStream(topic: string, partition: number): string {
  return `${topic}:${String(partition)}`;
}
