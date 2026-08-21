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
import type { EntityIndexDefinition } from './indices.js';

export interface BootstrapResult {
  readonly alias: string;
  readonly index: string;
  readonly created: boolean;
  /** 이미 있던 인덱스에 하위 호환 매핑 갱신을 적용했으면 `true`. */
  readonly mappingUpdated: boolean;
  readonly aliasAttached: boolean;
}

async function ensureIndex(client: Client, definition: EntityIndexDefinition): Promise<BootstrapResult> {
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

/** 부트스트랩 대상 인덱스를 모두 지운다. 통합 테스트 정리용이며 운영에서 쓰지 않는다. */
export async function dropEntityIndices(client: Client): Promise<void> {
  for (const definition of ENTITY_INDICES) {
    await client.indices.delete({ index: definition.index, ignore_unavailable: true });
  }
}
