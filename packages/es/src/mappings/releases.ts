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
