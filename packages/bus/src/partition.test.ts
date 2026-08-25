/** 파티션 배분 (ADR-002, 비동기 문서 2장). */

import { describe, expect, it } from 'vitest';
import { allPartitions, hashPartitionKey, partitionFor } from './partition.js';
import {
  CONSUMER_GROUPS,
  PARTITION_COUNTS,
  TOPICS,
  consumerGroup,
  LOGICAL_CONSUMERS,
  isKnownTopic,
  partitionCount,
  partitionStream,
} from './topics.js';

describe('파티션 키 해시', () => {
  it('같은 키는 항상 같은 파티션이다', () => {
    for (const key of ['4021', 'acme/payments@main', 'job-77']) {
      expect(partitionFor(key, 16)).toBe(partitionFor(key, 16));
    }
  });

  it('해시 값이 구현에 고정되어 있다 — 바뀌면 기존 순서 보장이 깨진다', () => {
    // FNV-1a 32비트 기준값. 이 숫자가 달라지면 배포 중 같은 저장소의 이벤트가
    // 두 파티션으로 갈라진다.
    expect(hashPartitionKey('')).toBe(0x811c9dc5);
    expect(hashPartitionKey('a')).toBe(0xe40c292c);
    expect(hashPartitionKey('foobar')).toBe(0xbf9cf968);
  });

  it('파티션 범위를 벗어나지 않는다', () => {
    for (let index = 0; index < 500; index += 1) {
      const partition = partitionFor(`repo-${String(index)}`, 8);
      expect(partition).toBeGreaterThanOrEqual(0);
      expect(partition).toBeLessThan(8);
    }
  });

  it('키가 고르게 퍼진다 — 한 파티션에 몰리면 그 저장소만 밀린다', () => {
    const counts = new Array<number>(16).fill(0);
    for (let index = 0; index < 1600; index += 1) {
      const partition = partitionFor(String(4000 + index), 16);
      counts[partition] = (counts[partition] ?? 0) + 1;
    }
    // 완전 균등은 100건. 절반~두 배 안에는 들어와야 쓸 만한 분산이다.
    for (const count of counts) {
      expect(count).toBeGreaterThan(50);
      expect(count).toBeLessThan(200);
    }
  });

  it('빈 파티션 키를 거부한다', () => {
    expect(() => partitionFor('', 4)).toThrow(/파티션 키가 비어/);
  });

  it('잘못된 파티션 수를 거부한다', () => {
    expect(() => partitionFor('a', 0)).toThrow();
    expect(() => partitionFor('a', 1.5)).toThrow();
  });

  it('allPartitions가 0부터 count-1까지를 준다', () => {
    expect(allPartitions(3)).toEqual([0, 1, 2]);
  });
});

describe('스트림 카탈로그 (비동기 문서 2장)', () => {
  it('스트림 7종과 소비자 그룹이 문서와 일치한다', () => {
    expect(Object.values(TOPICS)).toEqual([
      'prs:ingest',
      'prs:enriched',
      'prs:projected',
      'prs:sequence',
      'prs:release',
      'prs:batch',
      'prs:permission',
    ]);
    expect(CONSUMER_GROUPS['prs:ingest']).toBe('enrich');
    expect(CONSUMER_GROUPS['prs:enriched']).toBe('project');
    expect(CONSUMER_GROUPS['prs:projected']).toBe('link');
    expect(CONSUMER_GROUPS['prs:sequence']).toBe('sequence');
    expect(CONSUMER_GROUPS['prs:release']).toBe('release');
    expect(CONSUMER_GROUPS['prs:batch']).toBe('batch');
    expect(CONSUMER_GROUPS['prs:permission']).toBe('authz');
  });

  it('파티션 수가 문서의 동시성 값과 일치한다', () => {
    expect(PARTITION_COUNTS['prs:ingest']).toBe(16);
    expect(PARTITION_COUNTS['prs:enriched']).toBe(16);
    expect(PARTITION_COUNTS['prs:projected']).toBe(8);
    expect(PARTITION_COUNTS['prs:release']).toBe(4);
    expect(PARTITION_COUNTS['prs:batch']).toBe(3);
    expect(PARTITION_COUNTS['prs:permission']).toBe(4);
  });

  it('알 수 없는 토픽을 조용히 받아들이지 않는다', () => {
    expect(isKnownTopic('prs:typo')).toBe(false);
    expect(() => partitionCount('prs:typo')).toThrow(/알 수 없는 토픽/);
    expect(() => consumerGroup('prs:typo')).toThrow(/알 수 없는 토픽/);
  });

  it('환경 변수 덮어쓰기가 카탈로그 기본값을 이긴다', () => {
    expect(partitionCount('prs:sequence', { 'prs:sequence': 32 })).toBe(32);
    expect(() => partitionCount('prs:sequence', { 'prs:sequence': 0 })).toThrow();
  });

  it('파티션 스트림 이름이 토픽에 번호를 붙인 형태다', () => {
    expect(partitionStream('prs:ingest', 7)).toBe('prs:ingest:7');
  });
});

/**
 * 한 토픽을 독립적으로 읽는 소비자 (CR-038, DEV-205).
 *
 * consumer group은 broadcast가 아니라 **work sharing**이다. 같은 group으로 두
 * 소비자가 붙으면 이벤트가 나뉘고 각자 절반씩만 본다 — 관계 파생과 커밋 보강은
 * 같은 `prs:projected` 이벤트를 **각각 전부** 받아야 한다.
 */
describe('논리 소비자 그룹 (CR-038, DEV-205)', () => {
  it('기본 소비자는 기존 그룹 이름을 그대로 쓴다 — 읽던 자리를 잃지 않는다', () => {
    expect(consumerGroup(TOPICS.projected)).toBe('link');
    expect(consumerGroup(TOPICS.projected, 'link')).toBe('link');
  });

  it('두 번째 소비자는 **다른** 그룹을 얻는다', () => {
    const link = consumerGroup(TOPICS.projected, 'link');
    const enrich = consumerGroup(TOPICS.projected, 'commit-enrich');
    expect(enrich).not.toBe(link);
    expect(enrich).toBe('link:commit-enrich');
  });

  it('카탈로그에 없는 소비자는 던진다 — 오타가 조용히 새 그룹을 만들지 않는다', () => {
    expect(() => consumerGroup(TOPICS.projected, 'commit_enrich')).toThrow(/알 수 없는 논리 소비자/);
    expect(() => consumerGroup(TOPICS.enriched, 'commit-enrich')).toThrow(/알 수 없는 논리 소비자/);
  });

  it('카탈로그의 모든 소비자가 서로 다른 그룹으로 풀린다', () => {
    for (const topic of Object.values(TOPICS)) {
      const groups = LOGICAL_CONSUMERS[topic].map((name) => consumerGroup(topic, name));
      expect(new Set(groups).size).toBe(groups.length);
    }
  });
});
