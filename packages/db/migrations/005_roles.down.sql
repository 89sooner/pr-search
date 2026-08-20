-- 롤은 클러스터 전역이라 DROP하지 않는다. 권한만 회수한다.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM prs_app, prs_admin;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM prs_app, prs_admin;
REVOKE USAGE ON SCHEMA public FROM prs_app, prs_admin;
