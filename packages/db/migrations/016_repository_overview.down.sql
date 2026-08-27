-- 016 되돌리기 (CR-050).
DROP INDEX IF EXISTS repository_registration_request_slug_idx;
DROP TABLE IF EXISTS repository_registration_request;

ALTER TABLE repository DROP CONSTRAINT IF EXISTS repository_reconcile_missing_chk;
ALTER TABLE repository DROP COLUMN IF EXISTS last_reconcile_missing_count;
ALTER TABLE repository DROP COLUMN IF EXISTS last_reconciled_at;
