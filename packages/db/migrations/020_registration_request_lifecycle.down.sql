-- 020 되돌리기 (CR-055).
--
-- 인덱스와 제약을 먼저 지우고 열을 지운다. `DROP COLUMN`이 딸린 제약을 함께
-- 지우기는 하지만, 순서를 명시해 두면 되돌리기가 무엇을 없애는지 읽힌다.

DROP INDEX IF EXISTS repository_registration_request_queue_idx;

ALTER TABLE repository_registration_request
  DROP CONSTRAINT IF EXISTS repository_registration_request_note_chk,
  DROP CONSTRAINT IF EXISTS repository_registration_request_resolution_chk,
  DROP CONSTRAINT IF EXISTS repository_registration_request_status_chk;

ALTER TABLE repository_registration_request
  DROP COLUMN IF EXISTS resolution_note,
  DROP COLUMN IF EXISTS resolved_by,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS status;
