-- 034 되돌리기 (CR-113).
--
-- `project` work와 `sequence_reproject` 잡은 이 스키마에서만 뜻이 있으므로 함께 지운다.
-- 정본(`merge_sequence`·`sequence_space`)은 건드리지 않는다 — 되돌린 뒤에도 서수는 그대로이고,
-- 색인 복구 수단만 이전 판(채번 회차의 단발 `update_by_query`)으로 돌아간다.

DELETE FROM sequence_work WHERE kind = 'project';
DELETE FROM job WHERE type = 'sequence_reproject';

ALTER TABLE job DROP CONSTRAINT job_type_chk;
ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export', 'snapshot_bootstrap'
));

ALTER TABLE sequence_work DROP CONSTRAINT sequence_work_progress_size_chk;
ALTER TABLE sequence_work DROP COLUMN progress;

ALTER TABLE sequence_work DROP CONSTRAINT sequence_work_kind_chk;
ALTER TABLE sequence_work ADD CONSTRAINT sequence_work_kind_chk
  CHECK (kind IN ('refresh', 'reconcile', 'materialize', 'announce'));
