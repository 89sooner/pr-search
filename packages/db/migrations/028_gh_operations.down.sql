-- 028 회수 (REL-007 R0 / WP-077).
--
-- 실행 이력과 위임 연결을 **통째로** 지운다. 되돌린 뒤 사용자는 Operations App을
-- 다시 연결해야 한다 — 봉인된 토큰이 사라지므로 그 토큰으로 할 수 있는 일도 함께
-- 사라진다. GitHub 쪽 인가는 남는다(`gh auth`가 아니라 App 인가다). 사용자가 GitHub
-- 설정에서 직접 철회하거나, 되돌리기 전에 `DELETE /gh/identity`로 철회하는 것이 옳다.
--
-- 이 회수는 기능을 끄는 수단이 아니다. 끄는 것은 `GH_OPERATIONS_ENABLED=false`다.

DROP TABLE IF EXISTS gh_execution_idempotency;
DROP TABLE IF EXISTS gh_execution;
DROP TABLE IF EXISTS gh_identity_secret;
DROP TABLE IF EXISTS github_identity_connection;
