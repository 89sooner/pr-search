/**
 * `prs-links` 매핑 (데이터 모델 4.3, ENT-REL-002).
 *
 * 간선은 정방향 1건만 저장하고 역방향 조회는 `to_id`로 한다 (ADR-009).
 * `precedes`와 `co_changes`는 저장하지 않는다 — 전자는 시퀀스 비교로, 후자는
 * 조회 시점 `changed_paths` 교집합으로 계산한다. 저장하면 커밋 수만큼의 간선이
 * 생긴다.
 *
 * `evidence`는 `index: false`다. 근거 텍스트는 화면에 보여주기 위한 것이지
 * 검색 대상이 아니다.
 */

import type { estypes } from '@elastic/elasticsearch';

export const LINK_MAPPING: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    // {link_type}:{from_type}:{from_id}:{to_type}:{to_id}의 결정론적 해시.
    // 재파생이 중복 간선을 만들지 않는다.
    link_id: { type: 'keyword' },
    /**
     * `_id`와 같은 값 (CR-016, DEV-059).
     *
     * Elasticsearch 8은 `_id`로 정렬하는 것을 금지한다 (fielddata 필요).
     * FR-SRCH-007 AC-4의 "문서 ID를 마지막 정렬 키로"를 성립시키려면 그
     * 값이 정렬 가능한 필드로 문서 안에 있어야 한다. `upsert`가 자동으로
     * 채우므로 투영이 잊을 수 없다.
     */
    doc_id: { type: 'keyword' },
    repository_id: { type: 'long' },
    org_id: { type: 'long' },
    visibility: { type: 'keyword' },
    allowed_team_ids: { type: 'long' },

    from_type: { type: 'keyword' },
    from_id: { type: 'keyword' },
    to_type: { type: 'keyword' },
    to_id: { type: 'keyword' },
    to_repository_id: { type: 'long' },

    link_type: { type: 'keyword' },
    confidence: { type: 'keyword' },
    evidence: { type: 'text', index: false },
    // 대상이 아직 색인되지 않은 참조는 false로 저장하고 나중에 해결한다 (FR-REL-003 AC-3).
    resolved: { type: 'boolean' },
    detached: { type: 'boolean' },
    created_at: { type: 'date' },
  },
};
