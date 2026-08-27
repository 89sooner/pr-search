-- 015 되돌리기 (CR-049). 제약 하나와 인덱스 둘만 만들었다.
DROP INDEX IF EXISTS saved_search_team_idx;
DROP INDEX IF EXISTS saved_search_owner_idx;
ALTER TABLE saved_search DROP CONSTRAINT IF EXISTS saved_search_team_target_chk;
