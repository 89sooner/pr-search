/**
 * `prs-commits` 매핑 (데이터 모델 4.2, ENT-CORE-003).
 *
 * `commit_sha`와 부모 SHA는 `lowercase_normalizer`를 쓴다. 축약 SHA 접두 검색이
 * 대소문자 무관하게 동작해야 하기 때문이다 (FR-SRCH-004 AC-4, ADR-012).
 */

import type { estypes } from '@elastic/elasticsearch';
import { LOWERCASE_NORMALIZER, PATH_ANALYZER, TEXT_ANALYZER } from '../settings.js';

export const COMMIT_MAPPING: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    document_version: { type: 'long' },
    repository_id: { type: 'long' },
    repository: { type: 'keyword' },
    org_id: { type: 'long' },
    visibility: { type: 'keyword' },
    allowed_team_ids: { type: 'long' },
    repository_archived: { type: 'boolean' },

    commit_sha: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    parent_shas: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    patch_id: { type: 'keyword' },
    patch_id_unavailable: { type: 'boolean' },

    message: {
      type: 'text',
      analyzer: TEXT_ANALYZER,
      fields: { subject: { type: 'keyword', ignore_above: 512 } },
    },
    author: { type: 'keyword' },
    committer: { type: 'keyword' },
    authored_at: { type: 'date' },
    committed_at: { type: 'date' },

    // merge_commit | source_commit | direct_push (FR-SRCH-002 AC-1~AC-3)
    role: { type: 'keyword' },
    pull_request_numbers: { type: 'integer' },

    base_branch: { type: 'keyword' },
    merge_seq: { type: 'long' },
    seq_epoch: { type: 'integer' },
    sequence_space: { type: 'keyword' },

    changed_paths: {
      type: 'text',
      analyzer: PATH_ANALYZER,
      fields: { raw: { type: 'keyword', ignore_above: 1024 } },
    },
    additions: { type: 'integer' },
    deletions: { type: 'integer' },

    link_summary: {
      properties: {
        has_revert: { type: 'boolean' },
        is_reverted: { type: 'boolean' },
        has_cherry_pick: { type: 'boolean' },
      },
    },

    release_tags: { type: 'keyword' },
    enrichment_pending: { type: 'boolean' },
    last_delivery_id: { type: 'keyword', index: false },
    indexed_at: { type: 'date' },
  },
};
