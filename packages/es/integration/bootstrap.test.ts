import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMappings, dropEntityIndices } from '../src/bootstrap.js';
import { ENTITY_INDICES } from '../src/indices.js';
import { createTestClient, waitForCluster } from './helpers.js';

describe('인덱스 부트스트랩 (WP-003 DoD 1, FR-ING-005)', () => {
  let client: Client;

  beforeAll(async () => {
    client = createTestClient();
    await waitForCluster(client);
    await dropEntityIndices(client);
    await applyMappings(client);
  }, 90_000);

  afterAll(async () => {
    await client.close();
  });

  it('엔티티 인덱스 4종을 만든다', async () => {
    for (const definition of ENTITY_INDICES) {
      expect(await client.indices.exists({ index: definition.index })).toBe(true);
    }
  });

  it('각 인덱스에 별칭을 붙인다', async () => {
    for (const definition of ENTITY_INDICES) {
      const exists = await client.indices.existsAlias({ name: definition.alias, index: definition.index });
      expect(exists).toBe(true);
    }
  });

  it('별칭이 라우팅 필드를 갖는다 (ADR-003)', async () => {
    const aliases = await client.indices.getAlias({ index: 'prs-commits-v1' });
    // 저장소 범위 질의를 단일 샤드로 좁히기 위한 라우팅이다.
    expect(aliases['prs-commits-v1']?.aliases['prs-commits']).toMatchObject({
      index_routing: 'repository_id',
      search_routing: 'repository_id',
    });
  });

  it('ADR-003이 정한 초기 샤드 수로 만든다 (CR-004 이후에도 불변)', async () => {
    const expected: Record<string, string> = {
      'prs-pull-requests-v1': '6',
      'prs-commits-v1': '12',
      'prs-links-v1': '12',
      'prs-releases-v1': '2',
    };

    for (const [index, shards] of Object.entries(expected)) {
      const settings = await client.indices.getSettings({ index });
      expect(settings[index]?.settings?.['index']?.number_of_shards).toBe(shards);
    }
  });

  it('두 번 실행해도 같은 상태다 (멱등)', async () => {
    const second = await applyMappings(client);
    expect(second.every((result) => !result.created && !result.aliasAttached)).toBe(true);
  });
});
