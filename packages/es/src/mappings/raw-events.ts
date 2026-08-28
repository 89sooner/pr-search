/**
 * `prs-raw-events-{yyyy.MM}` 매핑 (데이터 모델 4.5, ENT-ING-003, FR-ING-010).
 *
 * 엔티티 인덱스와 **별칭·매핑·수명 정책이 모두 분리된다** (AC-1). 여기는
 * 시계열이고 ILM이 오래된 달을 통째로 지운다 — 엔티티 인덱스는 고정이고 지우지
 * 않는다 (ADR-003).
 *
 * `dynamic: false`인 것은 payload가 임의 JSON이기 때문이다. `strict`로 두면
 * 알 수 없는 필드 하나에 색인 자체가 거부되어 **레인 B의 실패가 늘어난다.**
 * `false`는 저장하되 색인하지 않는다.
 */

import type { estypes } from '@elastic/elasticsearch';

export const RAW_EVENT_MAPPING: estypes.MappingTypeMapping = {
  dynamic: false,
  properties: {
    delivery_id: { type: 'keyword' },
    event_type: { type: 'keyword' },
    action: { type: 'keyword' },
    /** 조사자가 읽는 값 (`owner/name`). */
    repository: { type: 'keyword' },
    /**
     * 접근 범위 필터가 결합하는 재료 (CR-052, DEV-366 / ADR-008).
     *
     * 이 필드가 없으면 `API-ADM-008`이 요청자의 범위로 결과를 좁힐 수 없다.
     * 미등록 저장소의 문서는 이 값이 비어 있고, 그래서 **어떤 접근 범위에도
     * 걸리지 않아 조회되지 않는다** — 내주면 그 응답이 곧 존재 신탁이 된다
     * (`FR-AUTH-002` AC-4).
     */
    repository_id: { type: 'long' },
    received_at: { type: 'date' },
    correlation_id: { type: 'keyword' },
    /**
     * 저장만 하고 색인하지 않는다 (데이터 모델 4.5).
     *
     * 색인하면 5억 건의 임의 JSON이 매핑 폭발을 일으킨다. payload 내부 검색은
     * WP-036의 제외 항목이다.
     */
    payload: { type: 'object', enabled: false },
  },
};
