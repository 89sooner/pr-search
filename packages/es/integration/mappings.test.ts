import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMappings, switchAliasesForTests } from '../src/bootstrap.js';
import { ENTITY_INDICES, findIndexDefinition } from '../src/indices.js';

/**
 * 인덱스 이름을 상수로 박지 않는다 (WP-032).
 *
 * 매핑 버전이 오르면 그 상수가 낡고, 이 시험은 **없는 인덱스를 묻는다**.
 * 정의에서 읽으면 버전이 올라도 같은 것을 본다.
 */
const COMMITS_INDEX = findIndexDefinition('prs-commits').index;
import { createTestClient, waitForCluster } from './helpers.js';

/**
 * WP-003 DoD 2: 코드의 매핑 정의와 실제 클러스터 매핑이 일치하는지 검증한다.
 *
 * 전체 객체를 통째로 비교하지 않는다. Elasticsearch가 기본값을 채워 넣기 때문에
 * 완전 일치를 요구하면 ES 버전이 올라갈 때마다 깨진다. 대신 **우리가 정의한
 * 속성이 정의한 대로 존재하는지**를 재귀적으로 확인한다 — 이쪽이 실제로 지키고
 * 싶은 계약이다.
 */
const CHECKED_KEYS = ['type', 'analyzer', 'normalizer', 'index', 'ignore_above', 'enabled'] as const;

type Props = Record<string, estypes.MappingProperty>;

function assertPropertiesMatch(expected: Props, actual: Props, path: string): void {
  for (const [name, definition] of Object.entries(expected)) {
    const live = actual[name];
    expect(live, `${path}.${name} 이(가) 클러스터에 없다`).toBeDefined();

    const expectedRecord = definition as unknown as Record<string, unknown>;
    const liveRecord = live as unknown as Record<string, unknown>;

    for (const key of CHECKED_KEYS) {
      if (expectedRecord[key] !== undefined) {
        expect(liveRecord[key], `${path}.${name}.${key}`).toBe(expectedRecord[key]);
      }
    }

    const nestedExpected = expectedRecord['properties'] as Props | undefined;
    if (nestedExpected !== undefined) {
      assertPropertiesMatch(nestedExpected, (liveRecord['properties'] ?? {}) as Props, `${path}.${name}`);
    }

    const fieldsExpected = expectedRecord['fields'] as Props | undefined;
    if (fieldsExpected !== undefined) {
      assertPropertiesMatch(fieldsExpected, (liveRecord['fields'] ?? {}) as Props, `${path}.${name}.fields`);
    }
  }
}

describe('매핑 일치 검증 (WP-003 DoD 2)', () => {
  let client: Client;

  beforeAll(async () => {
    client = createTestClient();
    await waitForCluster(client);
    await applyMappings(client);
    // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
    await switchAliasesForTests(client);
  }, 90_000);

  afterAll(async () => {
    await client.close();
  });

  for (const definition of ENTITY_INDICES) {
    it(`${definition.alias}의 매핑이 코드 정의와 일치한다`, async () => {
      const response = await client.indices.getMapping({ index: definition.index });
      const live = response[definition.index]?.mappings;

      expect(live?.dynamic, `${definition.alias}는 dynamic: strict 여야 한다`).toBe('strict');
      assertPropertiesMatch(
        (definition.mappings.properties ?? {}) as Props,
        (live?.properties ?? {}) as Props,
        definition.alias,
      );
    });
  }

  it('분석기와 정규화기가 클러스터에 설정되어 있다', async () => {
    const settings = await client.indices.getSettings({ index: COMMITS_INDEX });
    const analysis = settings[COMMITS_INDEX]?.settings?.['index']?.analysis;

    expect(analysis?.analyzer).toHaveProperty('text_ko_en');
    expect(analysis?.analyzer).toHaveProperty('path_analyzer');
    expect(analysis?.normalizer).toHaveProperty('lowercase_normalizer');
  });

  it('index.sort가 시퀀스 축으로 걸려 있다 (ADR-003)', async () => {
    const settings = await client.indices.getSettings({ index: COMMITS_INDEX });
    const sort = settings[COMMITS_INDEX]?.settings?.['index']?.sort;
    expect(sort?.field).toEqual(['repository_id', 'merge_seq']);
    expect(sort?.order).toEqual(['asc', 'desc']);
  });

  it('DEV-007: prs-links에는 index.sort를 걸지 않는다', async () => {
    // 매핑에 merge_seq가 없어 문서의 공통 설정을 그대로 적용하면 인덱스 생성이 실패한다.
    const settings = await client.indices.getSettings({ index: 'prs-links-v1' });
    expect(settings['prs-links-v1']?.settings?.['index']?.sort).toBeUndefined();
  });
});
