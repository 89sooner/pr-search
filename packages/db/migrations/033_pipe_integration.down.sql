-- 033 회수 (CR-112). 개발·시험용 되돌림이다.
--
-- **운영 롤백은 이 파일이 아니다** (ADR-025). 운영은 `PIPE_SEARCH_INTEGRATION_ENABLED=false`로
-- 연동만 멈추고 표를 남긴다 — 회수 표식과 이벤트 기록을 보존 기간 동안 지워서는 안 된다.

DROP TABLE IF EXISTS pipe_integration_event;
DROP TABLE IF EXISTS pipe_integration_credential_revocation;
DROP TABLE IF EXISTS pipe_integration_grant;
DROP TABLE IF EXISTS pipe_integration_auth_context;
DROP TABLE IF EXISTS pipe_integration_identity_binding;
