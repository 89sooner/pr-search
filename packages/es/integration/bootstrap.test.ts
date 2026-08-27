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

describe('매핑 버전이 올라간 별칭에는 손대지 않는다 (WP-032 / DEV-328)', () => {
  const ALIAS = 'prs-pull-requests';
  /** 이 스위트만 쓰는 번호. 정의된 버전과 겹치지 않게 높게 잡는다. */
  const LEGACY_VERSION = 8_100;

  /**
   * WP-032 **이전**의 스키마 — 부분 일치 분석기도 서브필드도 없다.
   *
   * 이 상태가 운영의 출발점이다: 클러스터에 이미 옛 인덱스가 있고 별칭이
   * 그것을 가리킨다. 코드는 새 매핑을 들고 있다.
   */
  function legacySchema(): {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
    shards: number;
  } {
    const definition = findIndexDefinition(ALIAS);
    const analysis = structuredClone(definition.settings.analysis ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    delete analysis['analyzer']?.['text_partial_index'];
    delete analysis['filter']?.['edge_ngram_2_20'];

    const properties = structuredClone(definition.mappings.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const title = properties['title'] as { fields?: Record<string, unknown> } | undefined;
    if (title?.fields !== undefined) delete title.fields['partial'];
    for (const field of ['base_branch', 'head_branch']) {
      const spec = properties[field] as { fields?: unknown } | undefined;
      if (spec !== undefined) delete spec.fields;
    }

    return {
      shards: definition.shards,
      settings: { ...definition.settings, analysis },
      mappings: { ...definition.mappings, properties },
    };
  }

  const legacyIndex = `${ALIAS}-v${String(LEGACY_VERSION)}`;
  let client: Client;
  let servingBefore: string;

  beforeAll(async () => {
    client = createTestClient();
    await waitForCluster(client);
    await applyMappings(client);
    servingBefore = Object.keys(await client.indices.getAlias({ name: ALIAS }))[0] as string;
    await client.indices.delete({ index: legacyIndex, ignore_unavailable: true });
    const schema = legacySchema();
    await client.indices.create({
      index: legacyIndex,
      settings: { ...schema.settings, number_of_shards: schema.shards },
      mappings: schema.mappings,
    });
    await client.indices.updateAliases({
      actions: [
        { remove: { index: servingBefore, alias: ALIAS } },
        { add: { index: legacyIndex, alias: ALIAS } },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    /*
     * **별칭을 먼저 떼고 정상 경로로 되돌린다.**
     *
     * 마지막 시험이 정의된 인덱스를 지우므로 `servingBefore`가 더는 없을 수
     * 있다 — 그 이름으로 바로 `add`하면 `index_not_found_exception`이다.
     * 별칭이 비면 `applyMappings`가 다시 만들어 붙인다: 이 파일이 시작할 때와
     * 같은 상태다.
     */
    await client.indices.updateAliases({
      actions: [{ remove: { index: legacyIndex, alias: ALIAS } }],
    });
    await client.indices.delete({ index: legacyIndex, ignore_unavailable: true });
    await applyMappings(client);
    void servingBefore;
    await client.close();
  });

  /*
   * **던지지 않는다.**
   *
   * 매핑 버전을 올리지 않았다면 `applyMappings`가 이 인덱스에 `putMapping`을
   * 걸고 `mapper_parsing_exception: analyzer [text_partial_index] has not been
   * configured in mappings`로 터진다 — 실제 Elasticsearch 8로 확인한 상태다.
   * 그것이 CR-043이 실측한 첫 번째 벽이며(DEV-266), 버전 상향이 그 벽을 피하는
   * 유일한 길이다.
   */
  it('옛 버전이 별칭을 들고 있으면 물러난다 — 터지지도, 건드리지도 않는다', async () => {
    const results = await applyMappings(client);
    const pr = results.find((one) => one.alias === ALIAS);

    expect(pr?.deferredToReindex, '버전을 올리지 않았거나 방어가 사라졌다').toBe(
      findIndexDefinition(ALIAS).index,
    );
    expect(pr?.created).toBe(false);
    expect(pr?.mappingUpdated).toBe(false);
    expect(pr?.aliasAttached).toBe(false);
  });

  /*
   * 별칭이 **정확히 하나**를 가리킨다.
   *
   * 방어가 없으면 `putAlias`가 새 버전을 함께 걸어 별칭이 둘을 가리키고,
   * `resolveServingIndex`가 던진다 — 전환의 뜻도 사라진다.
   */
  it('별칭을 두 인덱스에 걸지 않는다', async () => {
    await applyMappings(client);
    expect(Object.keys(await client.indices.getAlias({ name: ALIAS }))).toEqual([legacyIndex]);
  });

  /*
   * 빈 새 인덱스를 만들어 두지 않는다.
   *
   * 만들어 두면 `nextUnusedVersion`이 그 번호를 건너뛰고 재색인이 다음 번호를
   * 만든다 — 정본에서 채우지 않은 빈 인덱스가 영영 남는다.
   */
  it('정본에서 채우지 않은 빈 인덱스를 만들지 않는다', async () => {
    const target = findIndexDefinition(ALIAS).index;
    await client.indices.delete({ index: target, ignore_unavailable: true });
    await applyMappings(client);
    expect(await client.indices.exists({ index: target })).toBe(false);
  });
});
