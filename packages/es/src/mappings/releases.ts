/**
 * `prs-releases` 매핑 (데이터 모델 4.4, ENT-REL-001).
 *
 * 릴리스 포함 판정은 간선이 아니라 시퀀스 비교다 — 같은 시퀀스 공간에서
 * `commit.merge_seq <= release.merge_seq` (FR-REL-002 AC-5). 릴리스 하나당
 * 수만 개 `contains` 간선을 만드는 대신 정수 비교 하나로 끝난다.
 */

import type { estypes } from '@elastic/elasticsearch';
import { LOWERCASE_NORMALIZER } from '../settings.js';

export const RELEASE_MAPPING: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    release_id: { type: 'keyword' },
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

    tag_name: { type: 'keyword' },
    display_name: { type: 'keyword' },
    commit_sha: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    base_branch: { type: 'keyword' },
    merge_seq: { type: 'long' },
    seq_epoch: { type: 'integer' },
    sequence_space: { type: 'keyword' },
    released_at: { type: 'date' },
    // git_tag | github_release | ci_deployment (OD-004)
    source: { type: 'keyword' },
    indexed_at: { type: 'date' },
  },
};
