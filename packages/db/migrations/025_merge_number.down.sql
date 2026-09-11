-- 025 회수 (WP-074 / CR-079, 상세 설계 10절).
--
-- **번호 보존 rollback이 아니다.** 다시 up하면 M 번호·근거·전달 의도·표본이 모두
-- 초기화된다. 기존 공개 M 인용이 있는 운영에서는 앱 rollback(기능 off + 이전 앱
-- 기동)을 먼저 쓰고, 이 down은 백업과 생산자·소비자 중지 뒤에만 실행한다.
--
-- drop 순서: sample → work → evidence → 인덱스·제약 → 열. 기존 `merge_sequence`·
-- `sequence_space`·`pull_request_snapshot`과 기존 seq/SHA/PR/에폭은 보존한다.

DROP TABLE sequence_latency_sample;
DROP TABLE sequence_work;
DROP TABLE mnumber_evidence;

DROP INDEX pull_request_snapshot_merge_commit_idx;

ALTER TABLE sequence_space
  DROP CONSTRAINT sequence_space_mnumber_blocked_reason_len_chk,
  DROP CONSTRAINT sequence_space_mnumber_blocked_chk,
  DROP CONSTRAINT sequence_space_mnumber_checkpoint_chk;

ALTER TABLE sequence_space
  DROP COLUMN mnumber_blocked_since,
  DROP COLUMN mnumber_blocked_reason,
  DROP COLUMN mnumber_blocked_seq,
  DROP COLUMN mnumber_head,
  DROP COLUMN mnumber_head_seq;

DROP INDEX merge_sequence_numbered_pr_uk;
DROP INDEX merge_sequence_merge_number_uk;

ALTER TABLE merge_sequence
  DROP CONSTRAINT merge_sequence_annotate_requires_number_chk,
  DROP CONSTRAINT merge_sequence_annotate_state_chk,
  DROP CONSTRAINT merge_sequence_merge_number_pr_chk,
  DROP CONSTRAINT merge_sequence_merge_number_range_chk;

ALTER TABLE merge_sequence
  DROP COLUMN mnumber_assigned_at,
  DROP COLUMN annotated_at,
  DROP COLUMN annotate_state,
  DROP COLUMN merge_number;
