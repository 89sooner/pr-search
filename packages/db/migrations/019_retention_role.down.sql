-- 019 되돌리기 (CR-054). 소유권을 마이그레이션 실행 롤로 되돌린다.
DO $$
DECLARE
  child text;
BEGIN
  FOR child IN
    SELECT c.relname
      FROM pg_class parent
      JOIN pg_inherits i ON i.inhparent = parent.oid
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE parent.relname IN ('raw_event', 'audit_record')
  LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO CURRENT_USER', child);
  END LOOP;
END
$$;

ALTER TABLE raw_event OWNER TO CURRENT_USER;
ALTER TABLE audit_record OWNER TO CURRENT_USER;

REVOKE CREATE ON SCHEMA public FROM prs_admin;
