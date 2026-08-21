/**
 * `prs-pull-requests` 매핑 (데이터 모델 4.1, ENT-CORE-002).
 *
 * `dynamic: strict`가 핵심이다. 웹훅 payload에서 예기치 않은 필드가 흘러들어
 * 소스 코드나 개인정보가 색인되는 것을 매핑 수준에서 차단한다 (NFR-005, THR-010).
 */

import type { estypes } from '@elastic/elasticsearch';
import { LOWERCASE_NORMALIZER, PATH_ANALYZER, TEXT_ANALYZER } from '../settings.js';

export const PULL_REQUEST_MAPPING: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    document_version: { type: 'long' },
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
    repository: { type: 'keyword' },
    org_id: { type: 'long' },
    visibility: { type: 'keyword' },
    allowed_team_ids: { type: 'long' },

    pr_number: { type: 'integer' },
    title: {
      type: 'text',
      analyzer: TEXT_ANALYZER,
      fields: { raw: { type: 'keyword', ignore_above: 512 } },
    },
    body: { type: 'text', analyzer: TEXT_ANALYZER },
    state: { type: 'keyword' },
    draft: { type: 'boolean' },

    author: { type: 'keyword' },
    author_team_ids: { type: 'long' },
    reviewers: { type: 'keyword' },
    approved_by: { type: 'keyword' },
    labels: { type: 'keyword' },

    base_branch: { type: 'keyword' },
    head_branch: { type: 'keyword' },
    base_sha: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    head_sha: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    merge_commit_sha: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    source_commit_shas: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    source_commits_truncated: { type: 'boolean' },

    merge_seq: { type: 'long' },
    seq_epoch: { type: 'integer' },
    sequence_space: { type: 'keyword' },

    created_at: { type: 'date' },
    updated_at: { type: 'date' },
    merged_at: { type: 'date' },
    closed_at: { type: 'date' },
    first_review_at: { type: 'date' },

    lead_time_seconds: { type: 'long' },
    first_review_wait_seconds: { type: 'long' },

    changed_files_count: { type: 'integer' },
    additions: { type: 'integer' },
    deletions: { type: 'integer' },
    changed_paths: {
      type: 'text',
      analyzer: PATH_ANALYZER,
      fields: { raw: { type: 'keyword', ignore_above: 1024 } },
    },
    files_truncated: { type: 'boolean' },

    // 목록 화면의 관계 배지를 간선 인덱스 조회 없이 그리기 위한 비정규화 (ADR-009).
    link_summary: {
      properties: {
        has_revert: { type: 'boolean' },
        is_reverted: { type: 'boolean' },
        has_cherry_pick: { type: 'boolean' },
        has_stack: { type: 'boolean' },
        reference_count: { type: 'integer' },
      },
    },

    release_tags: { type: 'keyword' },
    unreleased: { type: 'boolean' },

    enrichment_pending: { type: 'boolean' },
    links_pending: { type: 'boolean' },
    repository_archived: { type: 'boolean' },
    last_delivery_id: { type: 'keyword', index: false },
    indexed_at: { type: 'date' },
  },
};
