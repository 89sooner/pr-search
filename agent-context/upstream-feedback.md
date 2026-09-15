# Upstream Feedback

> **2026-09-15: 아래 일곱 항목을 `CR-092`(PR #194, 병합 `ae9bf27`)로 처리했다. 넷은 코드를 고쳤고 셋은 코드를 바꾸지 않았다.** 네 항목은 사내가 적은 원인이나 전제가 실제와 달랐다 — 항목마다 아래에 적었다. **릴리스는 아직 발행하지 않았다**(결정자 지시). 다음 발행을 받으면 원장 6.91장의 「사내 확인 항목」을 보고 결과를 각 항목 아래에 적어 주기 바란다.

## DEV-scope-ghe — scope 계산이 GHE App 권한 부족으로 실패 → 저장소 목록 빈 화면

> **상류 반영 (`CR-092` / `DEV-698`) — 원인의 절반이 달랐다.** 흐름(`GheAccessScopeSource.fetch()` 실패 → 503)은 맞다. 그런데 **저장소가 500개 이하면 조직·팀 값은 어디에도 쓰이지 않는다**(검색 필터는 저장소 ID만 본다). 출처가 그 쓰이지 않는 조회(조직 구성원·팀 목록·팀 소속)까지 늘 불렀고, App에 조직 `Members` 권한이 없으면 그 조회 하나가 범위 전체를 503으로 만들었다. 이제 조직·팀은 저장소가 500개를 넘는 사용자에게만 조회한다 — **저장소 셋이면 `Members` 권한 없이도 `/me`가 200이다.** 권한 이름은 GitHub 문서 기준으로 협업자 권한 조회가 `Metadata: Read`, 조직·팀 조회가 조직 `Members: Read`다(`members:read`가 셋 모두의 원인은 아니었다). 조회가 실패하면 `search-api` 로그의 「접근 범위를 조회하지 못했다」 줄이 **실패한 단계·상태 코드·필요 권한**을 적는다(추정할 필요가 없다). 제안 (1) App 권한 추가는 런북 2.C 「수집용 GHE App에 줄 권한」 표로 받았다 — 작성자 팀 집계(`group_by=team`)를 쓸 계획이면 `Members: Read`를 여전히 준다. 제안 (2) DB 기반 어댑터는 택하지 않았다: 권한 판정 소스는 GHE 협업자·팀 API로 확정돼 있고(`OD-002`), `team_member`는 "로그인한 PR Search 사용자 중 팀원"일 뿐 저장소 권한(직접 협업자·조직 기본 권한)을 표현하지 못하며, 그 표를 채우는 동기화도 같은 `Members` 권한을 쓴다. **`permission_cache`에 손으로 넣은 행은 지운다** — 5분 뒤 만료되어 다시 조회하고, `refreshed_at`을 미래로 넣었다면 권한 회수가 반영되지 않는다. 사내 확인은 `NOT RUN`.

**발견**: 0.1.0-pilot.7 `AUTH_ENABLED=true` 전환 후 저장소 목록 접근 (2026-09-15)
**현상**: `GET /api/v1/me`가 503 `PERMISSION_UNAVAILABLE`을 반환. `permission_cache`(Redis·PostgreSQL)가 비어 GHE API 실시간 조회 시도 → `GheAccessScopeSource.fetch()` 실패 → `ScopeUnavailableError`. 실패 원인: GHE App(ID:16)이 `collaborator permission`, `isOrgMember`, `teamMembership` API를 호출할 `members:read` 권한 미보유로 추정. 결과적으로 저장소 목록이 완전히 빈 화면으로 표시됨
**사내 임시 조치**: `permission_cache` 테이블에 수동 INSERT (repo_ids, team_ids, org_ids)
**요청**: (1) GHE App에 `members:read` 권한 추가 또는 (2) scope-source를 GHE API 대신 DB의 `team_member`·`allowed_team_ids`를 사용하는 DB-기반 어댑터로 전환 (worker-authz가 이미 이 데이터를 관리함)

---

## DEV-authz-sync — 로그인 시 팀 멤버십 자동 동기화 안 됨

> **코드 변경 없음 (`CR-092`) — 현상은 사실이지만 원인이 아니다.** `access_scope_version=0`과 빈 `team_member`는 **정상 상태**다. 로그인은 권한 변경이 아니어서 버전을 올리지 않고(버전은 `member`·`team`·`repository` 웹훅의 무효화에서만 오른다, `FR-AUTH-003`), 로그인 때 팀 동기화를 시작하라는 요구도 없다. 볼 수 있는 저장소가 500개 이하인 사용자의 검색은 **저장소 ID로만** 거르므로 `team_member`와 `allowed_team_ids`가 가시성에 쓰이지 않는다. 저장소가 보이지 않은 원인은 위 항목의 503이었다. 손으로 넣은 `team_member` 행과 올린 버전은 필요하지 않았다. 런북 8장에 「정상이다」 행을 더했다.

**발견**: 0.1.0-pilot.7 `AUTH_ENABLED=true` 전환 후 신규 세션 로그인 (2026-09-15)
**현상**: 사용자가 GHE OAuth2로 로그인해 `app_user`가 생성됐으나 `access_scope_version=0` 상태로 방치. `worker-authz` 큐에 작업이 쌓이지 않아 `team_member` 테이블이 비어 있음. 결과적으로 `allowed_team_ids`가 설정된 모든 저장소가 검색 결과에서 보이지 않음 (ADR-008 access-scope filter)
**사내 임시 조치**: `team_member`에 수동 INSERT + `access_scope_version` 수동 증가
**요청**: 세션 로그인 시 `worker-authz` 팀 멤버십 동기화 자동 트리거

---

## DEV-logout-redirect — 로그아웃 후 `localhost:3000`으로 리다이렉트

> **상류 반영 (`CR-092` / `DEV-699`) — 리다이렉트한 것은 로그아웃이 아니라 로그인 콜백이었다.** `POST /auth/logout`은 리다이렉트하지 않는다(JSON 200). **GHE 로그인 콜백과 GitHub 계정 연결 콜백**이 복귀 주소를 서버가 들은 출처로 만들었고, `next start`는 역방향 프록시 뒤에서 그 출처를 `localhost:3000`으로 조립한다 — `0.1.0-pilot.7` web 이미지에 `Host`를 넘겨도 `https://localhost:3000/…`이었다(실측). 이제 복귀 주소는 **경로만** 보낸다(`Location: /search?…`) — 브라우저가 자기가 연 주소로 풀기 때문에 **`WEB_EXTERNAL_URL` 같은 설정도 nginx 변경도 필요 없다.** `Host`/`X-Forwarded-Host`로 동적 결정하는 안은 그 헤더를 고른 누구든 리다이렉트 목적지를 고르게 되어 택하지 않았다. 런북 6장 「역방향 프록시 뒤에서」. 사내 확인은 `NOT RUN`.

**발견**: 0.1.0-pilot.7 로그아웃 시도 (2026-09-15)
**현상**: `POST /auth/logout` 후 리다이렉트 대상이 `localhost:3000`으로 고정됨. 리버스 프록시(nginx) 뒤에서 서비스할 때 실제 접속 주소(`https://{호스트}`)로 돌아오지 않음
**요청**: 로그아웃 후 리다이렉트 URL을 `WEB_EXTERNAL_URL` 같은 환경 변수로 설정하거나 `Host`/`X-Forwarded-Host` 헤더 기반으로 동적 결정

---

## DEV-logout-button — 명시적 로그아웃 버튼 없음

> **상류 반영 (`CR-092` / `DEV-700`).** 화면 오른쪽 위의 **로그인 이름을 누르면** 사용자 메뉴가 열리고 「로그아웃」이 있다. 누르면 서버 세션을 끝내고 「로그아웃했습니다」 화면(`/auth/signed-out`)을 보인다 — 로그인 화면으로 곧장 보내면 GHE 세션이 살아 있어 곧바로 다시 로그인되기 때문이다. **GHE 로그인은 끝나지 않는다**(공용 PC라면 GHE에서도 로그아웃). 주소창의 `/auth/logout`은 여전히 405다(`GET`으로 로그아웃되면 다른 사이트가 링크 하나로 사용자를 로그아웃시킬 수 있다). 런북 6장 「로그아웃」. 사내 확인은 `NOT RUN`.

**발견**: 0.1.0-pilot.7 로그아웃 시도 (2026-09-15)
**현상**: UI에 로그아웃 버튼이 없어 `POST /auth/logout`을 직접 호출해야 함. 브라우저 주소창에서 GET으로 접근하면 HTTP 405. 일반 사용자가 로그아웃 방법을 알 수 없음
**요청**: 상단 네비게이션 또는 프로필 메뉴에 로그아웃 버튼 추가

---

## DEV-smoke-healthz — `prsctl smoke` search-api healthz 오탐

> **상류 반영 (`CR-092` / `DEV-697`) — pilot.7에서 바뀐 것은 아니었다.** 그 파싱은 `0.1.0-pilot.2`부터 같았다. `docker compose exec`가 컨테이너의 stdout(개행 없는 JSON 본문)과 stderr(헤더)를 따로 나르므로, 둘의 도착 순서가 바뀌면 한 줄이 `{"status":"ok",…}  HTTP/1.1 200 OK`가 되어 `$2`가 `HTTP/1.1`이다 — **간헐적**이라(pilot.7 이미지로 20회 중 8회 재현) 이전 반입에서 보이지 않았다. 이제 본문을 버리고 `HTTP/x.y` 바로 뒤의 상태 코드만 읽는다(새 이미지에서 20회 모두 200). 그 전까지는 `./prsctl health`로 판정한다. 런북 8장. 사내 확인은 `NOT RUN`.

**발견**: 0.1.0-pilot.7 반입 후 smoke 실행 (2026-09-15)
**현상**: `prsctl smoke`가 `✗ search-api /healthz → HTTP/1.1`을 보고하며 실패. `docker exec`로 직접 확인하면 `{"status":"ok","service":"search-api","version":"0.1.0"}` 정상 반환. pilot.7에서 smoke 스크립트가 `wget --server-response` + `awk '/HTTP\//{print $2}'`로 파싱 방식을 변경했는데 컨테이너 내 wget 출력 형식과 맞지 않아 `$2`가 `200` 대신 `HTTP/1.1`로 추출됨
**요청**: smoke의 healthz 파싱 로직 수정

---

## 시퀀스 대상 브랜치

> **코드 변경 없음 (`CR-092`, 결정자 결정) — 운영 화면에서 저장소마다 바꾼다.** 제품에는 `main` 기본값이 없다 — 시퀀스 대상 브랜치는 **저장소를 등록할 때 운영자가 적은 값**이다(저장소당 최대 10개). `smp`로 시작하는 저장소는 운영 콘솔 저장소 화면(`/ops/repositories`)에서 그 저장소를 편집해 목록을 `dev`로 고친다. 새로 더한 브랜치는 **채번을 자동으로 요청하고** 변경은 감사 기록에 남는다. 목록에서 뺀 `main`의 이미 붙은 번호는 지워지지 않고 그대로 남는다. 이름 규칙(`smp*` → `dev`)을 자동 적용하는 기능은 없다. 런북 2.C 「시퀀스 대상 브랜치 정하기·바꾸기」.

**발견**: 수집 대상 레포지터리의 시퀀스 대상 브랜치가 'main'임
**요청**: `smp*`로 시작하는 레포지터리의 시퀀스 대상 브랜치는 'dev'임

---

## 디자인 시스템 개선

> **이 판에서 다루지 않았다 (`CR-092`, 결정자 결정) — 별도 트랙이다.** 화면의 뱃지·버튼 모양은 외부 디자인 시스템 패키지(Conductor)에서 온다. 그 패키지의 개선과 발행을 먼저 하고 제품이 새 버전을 받는 순서로 따로 진행한다.

**발견**: 전체적으로 UI/UX 관점에서 굉장히 미관이 좋지 않음(특히 뱃지나 버튼의 모양)
**요청**: 상용 SaaS 수준의 고품질의 UI/UX 디자인으로 변경, 현재 사용하는 design-system 외에도 개선이 가능한 것은 최대한 스킬도 활용해서 미적으로나 경험적으로 뛰어난 시스템으로의 개선 필요
