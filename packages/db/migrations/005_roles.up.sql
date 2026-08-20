-- DB 롤과 권한 (FR-AUTH-004 AC-3, 보안 문서 4장).
--
-- 애플리케이션 롤은 audit_record에 INSERT/SELECT만 갖는다. UPDATE/DELETE를 주지
-- 않는 것이 감사 기록 불변성의 마지막 방어선이다. 보존 만료 삭제는 관리 롤이
-- 파티션 드롭으로 수행한다.
--
-- 롤은 클러스터 전역이므로 멱등하게 만들고 down에서 DROP하지 않는다.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prs_app') THEN
    CREATE ROLE prs_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prs_admin') THEN
    CREATE ROLE prs_admin NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO prs_app, prs_admin;

-- 애플리케이션 롤: 감사 기록을 제외한 테이블에 읽기·쓰기
GRANT SELECT, INSERT, UPDATE, DELETE ON
  raw_event, dead_letter,
  sequence_space, merge_sequence, safe_marker, bisect_session,
  repository, app_user, team, team_member, permission_cache,
  saved_search, job
TO prs_app;

-- 감사 기록: 추가와 조회만. UPDATE/DELETE 없음 (FR-AUTH-004 AC-3)
GRANT SELECT, INSERT ON audit_record TO prs_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prs_app;

-- 관리 롤: 보존 만료 파티션 드롭을 위해 소유권 수준 권한이 필요하다
GRANT ALL ON ALL TABLES IN SCHEMA public TO prs_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prs_admin;
