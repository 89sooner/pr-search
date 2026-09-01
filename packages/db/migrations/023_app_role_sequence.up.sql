-- 애플리케이션 롤에 시퀀스 사용 권한을 준다 (CR-061, DEV-518).
--
-- ## 022가 표만 보았다
--
-- 005는 `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prs_app`을 하는데
-- `ALL SEQUENCES`는 **그 시점에 존재하는 것**만 뜻한다. 022가 같은 사각지대를
-- 표에 대해 메우면서 **시퀀스는 세지 않았다.**
--
-- 실측하면 하나가 남는다 — `repository_registration_request_request_id_seq`
-- (마이그레이션 016). 그 표의 `request_id`가 `BIGSERIAL`이고
-- `registration-request.ts`의 `INSERT`가 그 열을 생략하므로 PostgreSQL이
-- `nextval()`을 부르는데, 표 권한만으로는 **`permission denied for sequence`**다.
-- 022가 표를 열어 준 덕에 `INSERT`가 시퀀스까지 가서 거기서 막힌다.
--
-- 나머지 일곱은 005 이전에 만들어졌거나(002의 `bisect_session` 등) 자연키를 써서
-- 시퀀스를 갖지 않는다.

GRANT USAGE, SELECT ON SEQUENCE repository_registration_request_request_id_seq TO prs_app;
