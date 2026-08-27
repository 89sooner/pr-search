/**
 * `prs-commits` 매핑 (데이터 모델 4.2, ENT-CORE-003).
 *
 * `commit_sha`와 부모 SHA는 `lowercase_normalizer`를 쓴다. 축약 SHA 접두 검색이
 * 대소문자 무관하게 동작해야 하기 때문이다 (FR-SRCH-004 AC-4, ADR-012).
 */

import type { estypes } from '@elastic/elasticsearch';
import {
  LOWERCASE_NORMALIZER,
  PARTIAL_TEXT_FIELD,
  PATH_ANALYZER,
  SEARCHABLE_KEYWORD_FIELDS,
  TEXT_ANALYZER,
} from '../settings.js';

export const COMMIT_MAPPING: estypes.MappingTypeMapping = {
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
    repository_archived: { type: 'boolean' },

    commit_sha: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    parent_shas: { type: 'keyword', normalizer: LOWERCASE_NORMALIZER },
    patch_id: { type: 'keyword' },
    /**
     * patch-id를 **왜** 못 얻었는지 (FR-REL-005 AC-5, CR-024).
     *
     * boolean이었다가 keyword가 되었다. `true` 하나로는 운영자가 할 일을
     * 고를 수 없기 때문이다 — `no_mirror`는 저장소 설정을 보라는 뜻이고
     * `blob_fetch_disabled`는 보안 정책 판단이 필요하다는 뜻이며
     * `compute_failed`만이 실제 오류다. 기본 설정에서는 대다수 커밋이
     * `blob_fetch_disabled`이고 그것은 정상 상태다.
     *
     * 이 필드가 **없으면** patch-id를 정상적으로 얻었다는 뜻이다.
     * `null`을 쓰지 않는다 — 없는 것과 비어 있는 것을 구분한다.
     */
    patch_id_unavailable: { type: 'keyword' },

    /**
     * `partial`은 전문 검색의 부분 일치 축이다 (WP-032, FR-SRCH-011 AC-4).
     *
     * **이 필드가 점수를 내는 것은 `role`이 first-parent 체인일 때뿐이다** —
     * 원본 커밋 메시지는 AC-1이 정한 범위 밖이다 (DEV-283). 그 한정은
     * 질의 빌더가 걸고 매핑은 값을 갖는 데까지만 한다.
     */
    message: {
      type: 'text',
      analyzer: TEXT_ANALYZER,
      fields: {
        subject: { type: 'keyword', ignore_above: 512 },
        partial: PARTIAL_TEXT_FIELD,
      },
    },
    author: { type: 'keyword' },
    committer: { type: 'keyword' },
    authored_at: { type: 'date' },
    committed_at: { type: 'date' },

    // merge_commit | source_commit | direct_push (FR-SRCH-002 AC-1~AC-3)
    role: { type: 'keyword' },
    pull_request_numbers: { type: 'integer' },

    // PR 문서와 같은 모양이다. 전문 검색이 두 인덱스를 함께 돈다 (DEV-054).
    base_branch: { type: 'keyword', fields: SEARCHABLE_KEYWORD_FIELDS },
    merge_seq: { type: 'long' },
    seq_epoch: { type: 'integer' },
    sequence_space: { type: 'keyword' },

    changed_paths: {
      type: 'text',
      analyzer: PATH_ANALYZER,
      fields: { raw: { type: 'keyword', ignore_above: 1024 } },
    },
    /**
     * 변경 경로가 상한(300)에서 잘렸는가 (WP-067 / CR-038).
     *
     * **조용히 자르지 않는다.** 이 표식이 없으면 화면이 목록을 "이것이 전부"로
     * 읽고, 큰 커밋의 조사 결과가 조용히 반쪽이 된다. 매핑이 `strict`이므로 이
     * 필드가 선언되어 있지 않으면 보강 자체가 THR-010으로 거부된다.
     */
    changed_paths_truncated: { type: 'boolean' },
    additions: { type: 'integer' },
    deletions: { type: 'integer' },

    link_summary: {
      properties: {
        has_revert: { type: 'boolean' },
        is_reverted: { type: 'boolean' },
        has_cherry_pick: { type: 'boolean' },
        // WP-029 소유 (CR-039, DEV-219). PR 문서에는 있었고 커밋에는 없어서
        // W-003이 참조 수를 간선 인덱스 조회 없이 그릴 수 없었다.
        reference_count: { type: 'integer' },
      },
    },

    release_tags: { type: 'keyword' },
    // 비정규화가 PR·커밋 양쪽에 같은 짝(release_tags·unreleased)을 쓴다 (WP-024).
    unreleased: { type: 'boolean' },
    enrichment_pending: { type: 'boolean' },
    /**
     * 관계 파생이 아직 완결되지 않았다 (CR-039, DEV-218).
     *
     * FR-REL-003의 예외 처리는 PR **또는 커밋**을 대상으로 하는데 커밋 매핑에는
     * 이 필드가 없었다. 매핑이 `strict`이므로 표시 자체가 THR-010으로 거부되어,
     * 승인된 예외 처리를 커밋에 대해 표현할 수단이 없었다.
     *
     * **미해결 참조가 있다는 뜻이 아니다.** 미해결은 정상 상태다 — 이 표식은
     * "현재 본문에 대한 파생이 완결됐다고 보장할 수 없다"는 뜻이다.
     */
    links_pending: { type: 'boolean' },
    last_delivery_id: { type: 'keyword', index: false },
    indexed_at: { type: 'date' },
  },
};
