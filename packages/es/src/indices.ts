/**
 * 인덱스와 별칭 정의 (ADR-003).
 *
 * 애플리케이션은 **별칭만** 참조한다. 매핑을 바꿔야 하면 새 버전 인덱스를 만들고
 * 재색인한 뒤 별칭을 원자적으로 옮긴다 (FR-ING-008). 별칭을 거치지 않고 인덱스
 * 이름을 직접 쓰면 그 무중단 전환이 불가능해진다.
 */

import type { estypes } from '@elastic/elasticsearch';
import { COMMIT_MAPPING, LINK_MAPPING, PULL_REQUEST_MAPPING, RELEASE_MAPPING } from './mappings/index.js';
import { ENTITY_INDEX_SETTINGS, UNSORTED_INDEX_SETTINGS } from './settings.js';

export const ENTITY_ALIASES = ['prs-pull-requests', 'prs-commits', 'prs-links', 'prs-releases'] as const;

export type EntityAlias = (typeof ENTITY_ALIASES)[number];

export interface EntityIndexDefinition {
  /** 애플리케이션이 참조하는 이름. */
  readonly alias: EntityAlias;
  /** 실제 인덱스 이름. 매핑 변경 시 `-v2`로 올린다. */
  readonly index: string;
  readonly settings: estypes.IndicesIndexSettings;
  readonly mappings: estypes.MappingTypeMapping;
  /**
   * ADR-003의 `_routing` 대상 필드 이름.
   *
   * 색인·조회 요청마다 이 **필드의 값**을 `routing`으로 준다. 별칭에 고정
   * 라우팅으로 걸지 않는다 — 그러면 전 문서가 한 샤드로 몰린다 (DEV-021).
   */
  readonly routingField: 'repository_id';
  /** ADR-003이 정한 초기 샤드 수. OD-007 결정 후에도 변경하지 않는다 (CR-004). */
  readonly shards: number;
}

export const ENTITY_INDICES: readonly EntityIndexDefinition[] = [
  {
    alias: 'prs-pull-requests',
    /*
     * **v2 — WP-032가 올렸다** (FR-SRCH-011, CR-043 DEV-266·267).
     *
     * `title.partial` 등 부분 일치 서브필드가 `text_partial_index` 분석기를
     * 참조하는데, 그 분석기는 `index.analysis` 아래의 **비동적 설정**이라 열린
     * 인덱스에 넣을 수 없다. 그리고 분석기가 있더라도 `putMapping`으로 더한
     * 서브필드는 **기존 문서에서 비어 있다** — 배포는 성공하고 검색만 과거
     * 데이터에 조용히 적게 답한다.
     *
     * 그래서 새 번호다. 이미 v1이 서비스 중인 클러스터에서 여기로 옮기는 것은
     * **WP-035의 재색인**이며, `applyMappings`는 그 자리를 침범하지 않는다.
     */
    index: 'prs-pull-requests-v2',
    settings: ENTITY_INDEX_SETTINGS,
    mappings: PULL_REQUEST_MAPPING,
    routingField: 'repository_id',
    shards: 6,
  },
  {
    alias: 'prs-commits',
    // v2 — `message.partial`·`base_branch.partial` (WP-032). 위 주석 참조.
    index: 'prs-commits-v2',
    settings: ENTITY_INDEX_SETTINGS,
    mappings: COMMIT_MAPPING,
    routingField: 'repository_id',
    shards: 12,
  },
  {
    // DEV-007: `index.sort`를 적용하지 않는다. settings.ts 참조.
    alias: 'prs-links',
    index: 'prs-links-v1',
    settings: UNSORTED_INDEX_SETTINGS,
    mappings: LINK_MAPPING,
    routingField: 'repository_id',
    shards: 12,
  },
  {
    alias: 'prs-releases',
    index: 'prs-releases-v1',
    settings: ENTITY_INDEX_SETTINGS,
    mappings: RELEASE_MAPPING,
    routingField: 'repository_id',
    shards: 2,
  },
];

export function findIndexDefinition(alias: EntityAlias): EntityIndexDefinition {
  const found = ENTITY_INDICES.find((definition) => definition.alias === alias);
  if (found === undefined) throw new Error(`알 수 없는 별칭: ${alias}`);
  return found;
}
