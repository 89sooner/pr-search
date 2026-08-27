/**
 * 인덱스 부트스트랩 (WP-003, FR-ING-005).
 *
 * 인덱스를 만들고 별칭을 붙인다.
 *
 * **필드 추가는 제자리에서 반영한다** (CR-013, DEV-034). Elasticsearch에서
 * 매핑에 새 필드를 더하는 것은 하위 호환 변경이라 재색인이 필요 없다. 재색인이
 * 필요한 것은 기존 필드의 **타입이나 분석기를 바꿀 때**이며, 그런 변경은
 * `put_mapping`이 `illegal_argument_exception`으로 거부하므로 조용히 넘어가지
 * 않는다. 거부되면 그때가 새 버전 인덱스 + 재색인 + 별칭 전환(WP-035, FR-ING-008)
 * 이 필요한 자리다.
 *
 * 필드 추가까지 재색인을 요구하면 `dynamic: strict` 인덱스에 필드 하나를 더할
 * 때마다 전량 재색인을 해야 한다 — 실제로 `repository_archived`를 커밋 문서에
 * 더할 때 그 벽에 부딪혔다 (DEV-028).
 */

import type { Client } from '@elastic/elasticsearch';
import { ENTITY_INDICES } from './indices.js';
import { parseIndexVersion } from './versioned-index.js';
import type { EntityIndexDefinition } from './indices.js';

export interface BootstrapResult {
  readonly alias: string;
  readonly index: string;
  readonly created: boolean;
  /** 이미 있던 인덱스에 하위 호환 매핑 갱신을 적용했으면 `true`. */
  readonly mappingUpdated: boolean;
  readonly aliasAttached: boolean;
  /**
   * 별칭이 **다른 버전**을 가리키고 있어 아무것도 하지 않았다 (WP-032, DEV-328).
   *
   * 그 전환은 재색인의 일이다 — 여기서 손대면 서비스 중인 별칭이 두 인덱스를
   * 가리키거나, 정본에서 채우지 않은 빈 인덱스가 검색 대상이 된다.
   */
  readonly deferredToReindex?: string;
}

/** 별칭이 이미 **다른** 인덱스를 가리키고 있으면 그 이름. 아니면 `null`. */
async function aliasHeldElsewhere(
  client: Client,
  definition: EntityIndexDefinition,
): Promise<string | null> {
  const response = await client.indices.getAlias({ name: definition.alias }, { ignore: [404] });
  const names = Object.keys(response).filter((name) => name !== 'status' && name !== 'error');
  if (names.length === 0) return null;
  if (names.includes(definition.index)) return null;
  return names[0] as string;
}

async function ensureIndex(client: Client, definition: EntityIndexDefinition): Promise<BootstrapResult> {
  /*
   * **버전이 올라간 별칭에는 손대지 않는다** (WP-032, DEV-328).
   *
   * `definition.index`가 `-v2`로 올라갔는데 별칭이 아직 `-v1`을 가리키는 상태는
   * 정상이다 — 그 전환은 WP-035의 재색인이 정본에서 채운 뒤에 하는 일이다.
   *
   * 여기서 그냥 진행하면 둘 중 하나가 된다.
   *   1. `putAlias`가 별칭을 **두 인덱스**에 걸어 `resolveServingIndex`가 던진다
   *   2. 빈 `-v2`를 만들어 두어 `nextUnusedVersion`이 그 번호를 건너뛰고,
   *      재색인이 `-v3`을 만든다 (빈 `-v2`는 영영 남는다)
   *
   * 둘 다 조용히 일어난다. 그래서 아무것도 하지 않고 그 사실을 돌려준다.
   */
  const heldElsewhere = await aliasHeldElsewhere(client, definition);
  if (heldElsewhere !== null) {
    return {
      alias: definition.alias,
      index: heldElsewhere,
      created: false,
      mappingUpdated: false,
      aliasAttached: false,
      deferredToReindex: definition.index,
    };
  }

  const exists = await client.indices.exists({ index: definition.index });

  if (!exists) {
    await client.indices.create({
      index: definition.index,
      settings: { ...definition.settings, number_of_shards: definition.shards },
      mappings: definition.mappings,
    });
  } else {
    // 하위 호환 변경(필드 추가)만 통과한다. 타입 변경은 여기서 예외로 터진다.
    await client.indices.putMapping({ index: definition.index, ...definition.mappings });
  }

  const aliasExists = await client.indices.existsAlias({
    name: definition.alias,
    index: definition.index,
  });

  if (!aliasExists) {
    // **별칭에 `routing`을 주지 않는다** (DEV-021). 별칭의 `routing`은 필드 이름이
    // 아니라 *고정 라우팅 값*이다. `repository_id`를 넘기면 모든 문서가 문자열
    // "repository_id" 하나의 샤드로 몰리고, 문서별 라우팅을 준 요청은
    // `illegal_argument_exception`으로 거부된다 — ADR-003의 설계가 정반대로 뒤집힌다.
    // `_routing`은 색인·조회 요청마다 `repository_id` **값**으로 준다 (`@prs/es`의 업서트).
    await client.indices.putAlias({ index: definition.index, name: definition.alias });
  }

  return {
    alias: definition.alias,
    index: definition.index,
    created: !exists,
    /** 이미 있던 인덱스의 매핑을 제자리에서 갱신했는지. */
    mappingUpdated: exists,
    aliasAttached: !aliasExists,
  };
}

/** 정의된 엔티티 인덱스 4종을 멱등하게 만든다. */
export async function applyMappings(client: Client): Promise<BootstrapResult[]> {
  const results: BootstrapResult[] = [];
  for (const definition of ENTITY_INDICES) {
    results.push(await ensureIndex(client, definition));
  }
  return results;
}

/**
 * 부트스트랩 대상 인덱스를 모두 지운다. 통합 테스트 정리용이며 운영에서 쓰지 않는다.
 *
 * **버전 전부를 지운다** (WP-032). 매핑 버전이 올라간 뒤로 `definition.index`
 * 하나만 지우면 별칭을 든 옛 버전이 살아남고, 그러면 이어지는 `applyMappings`가
 * "별칭이 다른 버전을 가리킨다"며 물러나 부트스트랩이 아무 일도 하지 않는다.
 */
export async function dropEntityIndices(client: Client): Promise<void> {
  for (const definition of ENTITY_INDICES) {
    /*
     * 이름을 **하나하나 지목한다.** Elasticsearch는 기본값
     * `action.destructive_requires_name: true`로 와일드카드 삭제를 거절한다 —
     * 그 설정이 있는 이유를 우회하지 않는다.
     */
    const found = await client.indices.get({
      index: `${definition.alias}-v*`,
      ignore_unavailable: true,
      expand_wildcards: 'all',
    });
    const names = Object.keys(found).filter((name) => parseIndexVersion(definition.alias, name) !== null);
    if (names.length === 0) continue;
    await client.indices.delete({ index: names, ignore_unavailable: true });
  }
}

/**
 * 별칭을 현재 정의된 인덱스로 옮긴다 — **통합 시험 전용** (WP-032).
 *
 * ## 왜 있는가
 *
 * 매핑 버전이 올라가면 `applyMappings`는 아무것도 하지 않고 물러난다(위 참조).
 * 운영에서 그 전환은 **정본에서 채우는 재색인**이며 그 경로는
 * `apps/pipeline-worker/integration/jobs/reindex.test.ts`가 실제로 증명한다.
 *
 * 시험 클러스터에는 지켜야 할 데이터가 없다 — 각 스위트가 자기 픽스처를 다시
 * 색인한다. 그러므로 여기서는 빈 새 인덱스로 별칭만 옮긴다.
 *
 * **운영에서 부르지 않는다.** 부르면 정본에서 채우지 않은 빈 인덱스가 검색
 * 대상이 되고, 그것은 오류 없이 "결과가 없다"로 보인다.
 */
export async function switchAliasesForTests(client: Client): Promise<void> {
  for (const definition of ENTITY_INDICES) {
    const held = await aliasHeldElsewhere(client, definition);
    if (held === null) continue;

    if (!(await client.indices.exists({ index: definition.index }))) {
      await client.indices.create({
        index: definition.index,
        settings: { ...definition.settings, number_of_shards: definition.shards },
        mappings: definition.mappings,
      });
    }
    await client.indices.updateAliases({
      actions: [
        { remove: { index: held, alias: definition.alias } },
        { add: { index: definition.index, alias: definition.alias } },
      ],
    });
  }
}
