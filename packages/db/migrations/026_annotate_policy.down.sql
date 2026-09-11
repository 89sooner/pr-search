-- 026 회수 (WP-075 / CR-084).
--
-- `merge_sequence.annotate_state`는 025가 만든 열이므로 여기서 건드리지 않는다.
-- 되돌린 뒤 다시 up하면 모든 저장소가 기본 허용으로 돌아가지만, 전역 스위치
-- 기본값이 `false`라 그것만으로 쓰기가 시작되지는 않는다.

DROP INDEX repository_annotate_enabled_idx;

ALTER TABLE repository
  DROP CONSTRAINT repository_annotate_blocked_reason_len_chk,
  DROP CONSTRAINT repository_annotate_blocked_chk;

ALTER TABLE repository
  DROP COLUMN annotate_blocked_reason,
  DROP COLUMN annotate_blocked_at,
  DROP COLUMN annotate_enabled;
