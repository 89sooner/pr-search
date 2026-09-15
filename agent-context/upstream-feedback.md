# Upstream Feedback

## DEV-scope-ghe — scope 계산이 GHE App 권한 부족으로 실패 → 저장소 목록 빈 화면

**발견**: 0.1.0-pilot.7 `AUTH_ENABLED=true` 전환 후 저장소 목록 접근 (2026-09-15)
**현상**: `GET /api/v1/me`가 503 `PERMISSION_UNAVAILABLE`을 반환. `permission_cache`(Redis·PostgreSQL)가 비어 GHE API 실시간 조회 시도 → `GheAccessScopeSource.fetch()` 실패 → `ScopeUnavailableError`. 실패 원인: GHE App(ID:16)이 `collaborator permission`, `isOrgMember`, `teamMembership` API를 호출할 `members:read` 권한 미보유로 추정. 결과적으로 저장소 목록이 완전히 빈 화면으로 표시됨
**사내 임시 조치**: `permission_cache` 테이블에 수동 INSERT (repo_ids, team_ids, org_ids)
**요청**: (1) GHE App에 `members:read` 권한 추가 또는 (2) scope-source를 GHE API 대신 DB의 `team_member`·`allowed_team_ids`를 사용하는 DB-기반 어댑터로 전환 (worker-authz가 이미 이 데이터를 관리함)

---

## DEV-authz-sync — 로그인 시 팀 멤버십 자동 동기화 안 됨

**발견**: 0.1.0-pilot.7 `AUTH_ENABLED=true` 전환 후 신규 세션 로그인 (2026-09-15)
**현상**: 사용자가 GHE OAuth2로 로그인해 `app_user`가 생성됐으나 `access_scope_version=0` 상태로 방치. `worker-authz` 큐에 작업이 쌓이지 않아 `team_member` 테이블이 비어 있음. 결과적으로 `allowed_team_ids`가 설정된 모든 저장소가 검색 결과에서 보이지 않음 (ADR-008 access-scope filter)
**사내 임시 조치**: `team_member`에 수동 INSERT + `access_scope_version` 수동 증가
**요청**: 세션 로그인 시 `worker-authz` 팀 멤버십 동기화 자동 트리거

---

## DEV-logout-redirect — 로그아웃 후 `localhost:3000`으로 리다이렉트

**발견**: 0.1.0-pilot.7 로그아웃 시도 (2026-09-15)
**현상**: `POST /auth/logout` 후 리다이렉트 대상이 `localhost:3000`으로 고정됨. 리버스 프록시(nginx) 뒤에서 서비스할 때 실제 접속 주소(`https://{호스트}`)로 돌아오지 않음
**요청**: 로그아웃 후 리다이렉트 URL을 `WEB_EXTERNAL_URL` 같은 환경 변수로 설정하거나 `Host`/`X-Forwarded-Host` 헤더 기반으로 동적 결정

---

## DEV-logout-button — 명시적 로그아웃 버튼 없음

**발견**: 0.1.0-pilot.7 로그아웃 시도 (2026-09-15)
**현상**: UI에 로그아웃 버튼이 없어 `POST /auth/logout`을 직접 호출해야 함. 브라우저 주소창에서 GET으로 접근하면 HTTP 405. 일반 사용자가 로그아웃 방법을 알 수 없음
**요청**: 상단 네비게이션 또는 프로필 메뉴에 로그아웃 버튼 추가

---

## DEV-smoke-healthz — `prsctl smoke` search-api healthz 오탐

**발견**: 0.1.0-pilot.7 반입 후 smoke 실행 (2026-09-15)
**현상**: `prsctl smoke`가 `✗ search-api /healthz → HTTP/1.1`을 보고하며 실패. `docker exec`로 직접 확인하면 `{"status":"ok","service":"search-api","version":"0.1.0"}` 정상 반환. pilot.7에서 smoke 스크립트가 `wget --server-response` + `awk '/HTTP\//{print $2}'`로 파싱 방식을 변경했는데 컨테이너 내 wget 출력 형식과 맞지 않아 `$2`가 `200` 대신 `HTTP/1.1`로 추출됨
**요청**: smoke의 healthz 파싱 로직 수정

---

## 시퀀스 대상 브랜치

**발견**: 수집 대상 레포지터리의 시퀀스 대상 브랜치가 'main'임
**요청**: `smp*`로 시작하는 레포지터리의 시퀀스 대상 브랜치는 'dev'임

---

## 디자인 시스템 개선

**발견**: 전체적으로 UI/UX 관점에서 굉장히 미관이 좋지 않음(특히 뱃지나 버튼의 모양)
**요청**: 상용 SaaS 수준의 고품질의 UI/UX 디자인으로 변경, 현재 사용하는 design-system 외에도 개선이 가능한 것은 최대한 스킬도 활용해서 미적으로나 경험적으로 뛰어난 시스템으로의 개선 필요
1
