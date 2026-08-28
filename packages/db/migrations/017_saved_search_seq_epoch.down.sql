-- 017 되돌리기 (CR-051).
ALTER TABLE saved_search DROP CONSTRAINT IF EXISTS saved_search_seq_epoch_chk;
ALTER TABLE saved_search DROP COLUMN IF EXISTS seq_epoch;
