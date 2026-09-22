-- 035 되돌리기 (CR-115).
--
-- `tag` work와 `mnumber_tag_reconcile` 잡은 이 스키마에서만 뜻이 있으므로 함께 지운다.
-- **원격 GHE의 태그는 건드리지 않는다** — 이 마이그레이션은 정본 열을 지울 뿐이며, 이미
-- 만들어진 `refs/tags/M-*`는 불변 인용으로 남는다(ADR-026). 번호·서수·에폭도 그대로다.

DELETE FROM sequence_work WHERE kind = 'tag';
DELETE FROM job WHERE type = 'mnumber_tag_reconcile';

ALTER TABLE job DROP CONSTRAINT job_type_chk;
ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export', 'snapshot_bootstrap', 'sequence_reproject'
));

ALTER TABLE sequence_work DROP CONSTRAINT sequence_work_kind_chk;
ALTER TABLE sequence_work ADD CONSTRAINT sequence_work_kind_chk
  CHECK (kind IN ('refresh', 'reconcile', 'materialize', 'announce', 'project'));

DROP INDEX IF EXISTS repository_tag_enabled_idx;
ALTER TABLE repository
  DROP CONSTRAINT repository_tag_blocked_reason_len_chk,
  DROP CONSTRAINT repository_tag_blocked_chk;
ALTER TABLE repository
  DROP COLUMN tag_blocked_reason,
  DROP COLUMN tag_blocked_at,
  DROP COLUMN tag_enabled;

ALTER TABLE merge_sequence
  DROP CONSTRAINT merge_sequence_tag_found_sha_chk,
  DROP CONSTRAINT merge_sequence_tag_reason_len_chk,
  DROP CONSTRAINT merge_sequence_tag_requires_number_chk,
  DROP CONSTRAINT merge_sequence_tag_state_chk;
ALTER TABLE merge_sequence
  DROP COLUMN tag_found_sha,
  DROP COLUMN tag_result_reason,
  DROP COLUMN tag_attempt_id,
  DROP COLUMN tagged_at,
  DROP COLUMN tag_state;
