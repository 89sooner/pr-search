import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMappings, dropEntityIndices } from '../src/bootstrap.js';
import { findIndexDefinition } from '../src/indices.js';
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

  it('별칭에 고정 라우팅을 걸지 않는다 (ADR-003, DEV-021)', async () => {
    // 인덱스 이름을 박지 않는다 — 매핑 버전이 오르면 그 상수가 낡는다 (WP-032).
    const commits = findIndexDefinition('prs-commits').index;
    const aliases = await client.indices.getAlias({ index: commits });
    const alias = aliases[commits]?.aliases['prs-commits'];
    // 별칭의 `routing`은 필드 이름이 아니라 **고정 값**이다. `repository_id`를
    // 걸면 전 문서가 문자열 하나의 샤드로 몰리고 문서별 라우팅이 거부된다.
    expect(alias).toBeDefined();
    expect(alias).not.toHaveProperty('index_routing');
    expect(alias).not.toHaveProperty('search_routing');
  });

  it('문서별 `_routing`으로 저장소 범위를 한 샤드에 모은다 (ADR-003)', async () => {
    // 라우팅은 색인 요청마다 `repository_id` 값으로 준다. 이것이 실제로 받아들여지고
    // 같은 라우팅으로 되찾을 수 있어야 ADR-003의 설계가 성립한다.
    await client.index({
      index: 'prs-commits',
      id: '4021:routing-probe',
      routing: '4021',
      document: { repository_id: 4021, commit_sha: 'routing-probe', document_version: 1 },
      refresh: true,
    });

    const found = await client.get({ index: 'prs-commits', id: '4021:routing-probe', routing: '4021' });
    expect(found.found).toBe(true);
    // 라우팅 값이 문서에 남아 저장소 범위 질의가 그 샤드만 본다.
    expect(found._routing).toBe('4021');

    await client.delete({ index: 'prs-commits', id: '4021:routing-probe', routing: '4021', refresh: true });
  });

  it('ADR-003이 정한 초기 샤드 수로 만든다 (CR-004 이후에도 불변)', async () => {
    /*
     * 별칭으로 적는다 — 샤드 수는 ADR-003이 정한 **불변**이고 매핑 버전과
     * 무관하다. 인덱스 이름을 박으면 버전이 오를 때마다 이 표가 낡는다.
     */
    const expected: Record<string, string> = {
      'prs-pull-requests': '6',
      'prs-commits': '12',
      'prs-links': '12',
      'prs-releases': '2',
    };

    for (const [alias, shards] of Object.entries(expected)) {
      const index = findIndexDefinition(alias as never).index;
      const settings = await client.indices.getSettings({ index });
      expect(settings[index]?.settings?.['index']?.number_of_shards, alias).toBe(shards);
    }
  });

  it('두 번 실행해도 같은 상태다 (멱등)', async () => {
    const second = await applyMappings(client);
    expect(second.every((result) => !result.created && !result.aliasAttached)).toBe(true);
  });
});
