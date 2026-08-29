-- 보존 잡이 파티션을 만들고 지울 수 있게 한다 (WP-039 / CR-054, PR #84 리뷰 P1).
--
-- ## 왜 005로 부족했나
--
-- 마이그레이션 005는 `prs_admin`에게 `USAGE ON SCHEMA public`과
-- `GRANT ALL ON ALL TABLES`를 준다. 그런데 PostgreSQL에서
--
--   - **파티션을 만들려면** 스키마의 `CREATE` 권한이 필요하고
--     (`GRANT ALL ON TABLE`은 스키마 권한이 아니다)
--   - **테이블을 드롭하려면 소유권이 필요하다**
--     (`GRANT ALL`은 `DROP`을 주지 않는다 — 어떤 `GRANT`도 주지 않는다)
--
-- 실측하면 `SET ROLE prs_admin` 뒤의 `CREATE TABLE ... PARTITION OF`가
-- `permission denied for schema public`으로 거절된다. 그 결과
-- **`JOB-AUD-001`이 자기 일의 어느 절반도 하지 못한다.**
--
-- 통합 시험이 이것을 놓친 이유는 **소유자 풀로 돌았기 때문**이다 —
-- 마이그레이션을 실행한 연결은 이미 소유자라 두 제약을 만나지 않는다.
-- `retention-role.test.ts`가 실제 롤로 다시 묻는다.
--
-- ## 소유권을 옮기되 접근 권한은 그대로 둔다
--
-- `ALTER TABLE ... OWNER TO`는 기존 `GRANT`를 유지한다. 실측으로 확인했다:
-- 소유권 이전 뒤에도 `prs_app`은 `audit_record`에 `INSERT`·`SELECT`만 갖는다.
-- **감사 불변성의 방어선은 그대로다** (FR-AUTH-004 AC-3) — `prs_app`에는
-- 여전히 `UPDATE`·`DELETE`가 없고, 이제 소유자도 아니라 드롭도 못 한다.
--
-- ## 두 표만 옮긴다
--
-- 파티션 테이블은 `raw_event`와 `audit_record` 둘뿐이다(데이터 모델 3.1·3.4).
-- 나머지 표의 소유권은 건드리지 않는다 — 관리 롤이 손댈 수 있는 범위를
-- 필요한 만큼으로 좁히는 것이 `SET ROLE`을 쓰는 이유와 같다.

GRANT CREATE ON SCHEMA public TO prs_admin;

ALTER TABLE raw_event OWNER TO prs_admin;
ALTER TABLE audit_record OWNER TO prs_admin;

-- 이미 만들어진 파티션도 함께 옮긴다. 부모의 소유권만 옮기면 기존 자식은
-- 옛 소유자에게 남아 **드롭할 수 없는 파티션이 생긴다.**
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
    EXECUTE format('ALTER TABLE %I OWNER TO prs_admin', child);
  END LOOP;
END
$$;
