-- 029 회수 (REL-007 / WP-078, CR-088).
--
-- 검증 기록과 스냅숏을 **통째로** 지운다 — 「언제 어떤 해시의 자료로 확인했는가」의 이력이 사라진다.
-- 실행 이력(028)과 실행 허용에는 영향이 없다. 실행기는 기동마다 자기 바이너리·manifest를 스스로
-- 대조하므로 이 표가 없어도 잘못된 gh로 실행하지는 않는다 — 다만 그 사실이 화면(A-006)에서 사라진다.
--
-- 이 회수는 기능을 끄는 수단이 아니다. 끄는 것은 `GH_OPERATIONS_ENABLED=false`다.

DROP TABLE IF EXISTS gh_capability_verification;
DROP TABLE IF EXISTS gh_capability_snapshot;
DROP FUNCTION IF EXISTS gh_capability_verification_immutable();
DROP FUNCTION IF EXISTS gh_capability_snapshot_guard();
