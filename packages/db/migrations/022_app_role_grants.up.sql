-- 마이그레이션 005 이후에 만들어진 표에 애플리케이션 롤 권한을 준다
-- (CR-060, DEV-517).
--
-- ## 무엇이 빠져 있었나
--
-- 005는 `prs_app`에게 **표 이름을 열거해** 권한을 준다. 그 뒤로 만들어진 표는
-- 자기 마이그레이션이 `GRANT`를 함께 적지 않으면 **아무 권한도 갖지 못한다** —
-- 실제로 008과 019만 그것을 했고 나머지는 하지 않았다. 실측하면 다섯 표가
-- `prs_app`에게 `SELECT`조차 없다:
--
--   commit_snapshot · pull_request_snapshot   (010, 013)
--   repository_registration_request           (016)
--   team_membership · org_team_sync           (021)
--
-- ## 왜 지금까지 드러나지 않았나
--
-- **통합 시험이 소유자 롤로 돈다.** 마이그레이션을 실행한 연결이 곧 소유자라
-- 권한 제약을 만나지 않는다 — `019`가 `prs_admin`에서 겪은 것과 **같은 사각지대**다.
-- 그리고 `prs_app`으로 실제 접속하는 배포가 이번(`WP-070` Profile A)이 처음이다.
--
-- 실행으로 증명했다. 복구 뒤 전량 재색인이 세 잡 모두
-- `permission denied for table pull_request_snapshot`으로 실패했다.
--
-- ## 기본 권한(ALTER DEFAULT PRIVILEGES)을 쓰지 않는다
--
-- 그렇게 하면 앞으로 만들어지는 **모든** 표에 `UPDATE`·`DELETE`가 자동으로 붙는다.
-- 언젠가 감사 성격의 표가 하나 더 생기면 그 순간 `FR-AUTH-004` AC-3의 방어선이
-- 조용히 사라진다 — **자동 부여는 그 예외를 표현할 수 없다.**
-- 대신 `audit-grants.test.ts`가 **모든 표를 훑어** 빠진 것을 즉시 잡는다.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  pull_request_snapshot, commit_snapshot,
  repository_registration_request,
  team_membership, org_team_sync
TO prs_app;

-- `schema_migration`은 주지 않는다. 그것을 읽고 쓰는 것은 마이그레이션 실행기뿐이고
-- 그 연결은 스키마 소유자다. 애플리케이션이 자기 스키마 이력을 고칠 이유가 없다.
