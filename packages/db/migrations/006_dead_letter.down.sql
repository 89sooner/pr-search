-- 되돌리기. resolved 행은 pending 으로 되돌린다 — 되돌린 스키마에는 그 상태가
-- 없으므로 CHECK 제약을 다시 걸기 전에 값을 옮겨야 한다.
DROP INDEX IF EXISTS dead_letter_repo_idx;

ALTER TABLE dead_letter DROP CONSTRAINT IF EXISTS dead_letter_state_chk;
UPDATE dead_letter SET state = 'pending' WHERE state = 'resolved';
ALTER TABLE dead_letter ADD CONSTRAINT dead_letter_state_chk
  CHECK (state IN ('pending', 'reprocessing', 'held'));

ALTER TABLE dead_letter DROP CONSTRAINT IF EXISTS dead_letter_delivery_stage_uk;
ALTER TABLE dead_letter DROP COLUMN IF EXISTS repository_id;
