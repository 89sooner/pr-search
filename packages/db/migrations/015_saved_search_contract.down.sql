-- 015 되돌리기 (CR-049).
DROP INDEX IF EXISTS saved_search_team_idx;
DROP INDEX IF EXISTS saved_search_owner_idx;
ALTER TABLE saved_search DROP CONSTRAINT IF EXISTS saved_search_team_target_chk;

-- 외래 키를 004의 형태(CASCADE 없음)로 되돌린다.
ALTER TABLE saved_search DROP CONSTRAINT IF EXISTS saved_search_owner_user_id_fkey;
ALTER TABLE saved_search
  ADD CONSTRAINT saved_search_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app_user(user_id);
