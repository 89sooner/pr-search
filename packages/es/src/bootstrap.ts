/**
 * 인덱스 부트스트랩 (WP-003, FR-ING-005).
 *
 * 인덱스를 만들고 별칭을 붙인다. 이미 있으면 건드리지 않는다 — 기존 인덱스의
 * 매핑을 여기서 바꾸려 하면 안 된다. 매핑 변경은 새 버전 인덱스 + 재색인 +
 * 별칭 전환이다 (WP-035).
 */

import type { Client } from '@elastic/elasticsearch';
import { ENTITY_INDICES } from './indices.js';
import type { EntityIndexDefinition } from './indices.js';

export interface BootstrapResult {
  readonly alias: string;
  readonly index: string;
  readonly created: boolean;
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
  }

  const aliasExists = await client.indices.existsAlias({
    name: definition.alias,
    index: definition.index,
  });

  if (!aliasExists) {
    await client.indices.putAlias({
      index: definition.index,
      name: definition.alias,
      routing: definition.routingField,
    });
  }

  return {
    alias: definition.alias,
    index: definition.index,
    created: !exists,
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
