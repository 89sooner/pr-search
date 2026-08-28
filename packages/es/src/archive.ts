/**
 * 원본 아카이브 레인의 Elasticsearch 쪽 (FR-ING-010, ADR-002 레인 B, ADR-003).
 *
 * Filebeat 사이드카가 `prs-raw-events-{yyyy.MM}`으로 색인하고, 여기 정의한
 * **인덱스 템플릿**이 그 인덱스에 매핑·설정·별칭·수명 정책을 붙인다. 템플릿을
 * 쓰는 이유는 인덱스를 만드는 주체가 애플리케이션이 아니라 적재기이기
 * 때문이다 — 엔티티 인덱스처럼 부트스트랩이 미리 만들 수 없다.
 *
 * ## 엔티티 인덱스와 섞지 않는다 (AC-1)
 *
 * `ENTITY_INDICES`에 넣지 않는다. 별칭도 매핑도 수명 정책도 다르고, 무엇보다
 * **엔티티 인덱스는 지우지 않고 여기는 ILM이 통째로 지운다.** 한 목록에 두면
 * 재색인·부트스트랩·정합성 점검이 그 차이를 매번 분기해야 한다.
 */

import type { Client, estypes } from '@elastic/elasticsearch';
import { RAW_EVENT_MAPPING } from './mappings/raw-events.js';

/** 조회가 참조하는 별칭. 템플릿이 월별 인덱스마다 붙인다. */
export const ARCHIVE_ALIAS = 'prs-raw-events' as const;

export type ArchiveAlias = typeof ARCHIVE_ALIAS;

/** 적재기가 쓰는 인덱스 이름 패턴. */
export const ARCHIVE_INDEX_PATTERN = 'prs-raw-events-*' as const;

export const ARCHIVE_ILM_POLICY_NAME = 'prs-raw-events' as const;
export const ARCHIVE_TEMPLATE_NAME = 'prs-raw-events' as const;

/**
 * ILM 정책 — hot 7일 → warm 90일 → delete (ADR-003, 창 약 97일).
 *
 * **이 창은 `raw_event`의 3년 보존(OD-003)과 별개 값이다** (AC-1, AC-2). 보존
 * 보증은 PostgreSQL이 지고 아카이브는 최근 구간 조회 편의를 위한 파생 사본이라
 * 백업 대상이 아니다. 이전 판이 이 창을 OD-003에 묶어 둔 것은 참조 오류였고
 * CR-004가 정정했다.
 *
 * rollover를 쓰지 않는다 — 인덱스 이름이 월 단위로 이미 갈리므로 크기 기반
 * 전환을 겹치면 `{yyyy.MM}` 이름과 실제 구간이 어긋난다.
 */
export const ARCHIVE_ILM_POLICY = {
  phases: {
    hot: {
      min_age: '0ms',
      actions: { set_priority: { priority: 100 } },
    },
    warm: {
      min_age: '7d',
      actions: { set_priority: { priority: 50 } },
    },
    delete: {
      min_age: '97d',
      actions: { delete: {} },
    },
  },
} as const;

/**
 * 아카이브 인덱스 설정.
 *
 * 샤드 3은 ADR-003의 **샤드당 30~50GB 가정**을 월별 구간에 적용한 값이다 —
 * 인프라 5장이 아카이브 전체를 약 700GB(복제본 포함)로 잡으므로 한 달치는
 * 약 100GB다. 엔티티 인덱스와 달리 `index.sort`도 분석기도 두지 않는다:
 * 정렬은 `received_at` 하나이고 전문 검색은 이 인덱스의 범위가 아니다.
 */
export const ARCHIVE_INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 3,
  number_of_replicas: 1,
  refresh_interval: '30s',
  lifecycle: { name: ARCHIVE_ILM_POLICY_NAME },
};

export interface ArchiveBootstrapResult {
  readonly policyApplied: boolean;
  readonly templateApplied: boolean;
}

/**
 * ILM 정책과 인덱스 템플릿을 적용한다.
 *
 * 멱등이다 — 두 API 모두 같은 이름에 덮어쓴다. 이미 만들어진 인덱스의 매핑은
 * 건드리지 않는다: 템플릿은 **앞으로 만들어질** 인덱스에만 적용되며, 기존
 * 인덱스의 필드 추가는 엔티티 쪽과 같은 이유로 `put_mapping`의 일이다
 * (CR-013, DEV-034).
 */
export async function bootstrapArchive(client: Client): Promise<ArchiveBootstrapResult> {
  await client.ilm.putLifecycle({
    name: ARCHIVE_ILM_POLICY_NAME,
    policy: ARCHIVE_ILM_POLICY as unknown as estypes.IlmPolicy,
  });

  await client.indices.putIndexTemplate({
    name: ARCHIVE_TEMPLATE_NAME,
    index_patterns: [ARCHIVE_INDEX_PATTERN],
    template: {
      settings: ARCHIVE_INDEX_SETTINGS,
      mappings: RAW_EVENT_MAPPING,
      aliases: { [ARCHIVE_ALIAS]: {} },
    },
  });

  return { policyApplied: true, templateApplied: true };
}

/**
 * 아카이브 별칭이 실제로 존재하는지.
 *
 * `false`는 오류가 아니다 (`API-ADM-008`의 `index_available`). 아직 이벤트가
 * 없거나 ILM이 전 구간을 지운 상태이며, **레인 B의 부재가 운영 콘솔을 막으면
 * 두 레인의 독립(AC-3)이 조회 쪽에서 깨진다.**
 */
export async function archiveAvailable(client: Client): Promise<boolean> {
  const response = await client.indices.exists({ index: ARCHIVE_ALIAS }, { ignore: [404] });
  return response === true;
}
