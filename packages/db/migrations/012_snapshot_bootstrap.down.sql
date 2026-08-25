-- 012 되돌리기 (CR-037).

ALTER TABLE job DROP CONSTRAINT job_type_chk;

ALTER TABLE job ADD CONSTRAINT job_type_chk CHECK (type IN (
  'backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_reassign',
  'sequence_integrity', 'link_rebuild', 'export'
));

DROP INDEX IF EXISTS repository_snapshot_bootstrap_idx;

ALTER TABLE repository DROP COLUMN snapshot_bootstrapped_at;
