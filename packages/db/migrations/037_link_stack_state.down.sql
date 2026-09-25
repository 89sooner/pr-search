-- 037 되돌리기 (WP-104 / CR-121).
--
-- **`pull_request_stack`을 지우면 해제된 스택 이력이 사라진다.** 파생이 만든 행은 다시
-- 파생해도 성립 중인 관계만 돌아오고, `origin = 'imported'` 행(배포 전 서비스 인덱스에서
-- 옮긴 것)은 서비스 인덱스에서만 되찾을 수 있다. 내리기 전에 그 인덱스가 남아 있는지 본다.

DROP TABLE IF EXISTS reindex_link_pending;
DROP TABLE IF EXISTS pull_request_stack;
