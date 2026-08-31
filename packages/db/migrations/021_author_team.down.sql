-- 021 되돌리기 (CR-058).
--
-- 색인은 표와 함께 사라지지만 순서를 명시해 두면 되돌리기가 무엇을 없애는지
-- 읽힌다. `team_membership`이 `team`을 참조하므로 먼저 지운다.

DROP INDEX IF EXISTS team_membership_login_idx;
DROP TABLE IF EXISTS team_membership;
DROP TABLE IF EXISTS org_team_sync;
