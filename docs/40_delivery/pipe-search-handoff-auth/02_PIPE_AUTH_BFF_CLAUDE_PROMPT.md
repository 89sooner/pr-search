# PIPE 담당 Claude — pr-search 인증 요청·검색 BFF 연결 구현 지시서

## 실행할 작업

너는 PIPE 저장소에 연결된 구현 담당이다. 기존 PIPE 로그인을 유지한 채 pr-search 검색 서비스를 사용자별로 호출하는 backend BFF와 서버 간 인증 클라이언트를 구현하라. Search UI/App Shell을 새로 디자인하지 않는다. Stage 1의 Search 콘텐츠가 이미 구현돼 있으면 그 데이터 adapter 연결과 오류 분기만 필요한 범위로 수정한다.

필수 입력: 이 문서, `00_SHARED_INTEGRATION_CONTRACT.md`, `03_SECURITY_AND_CONTRACT_ACCEPTANCE.md`. 추가로 pr-search 담당자가 생성한 `PIPE_INTEGRATION_HANDOFF.md`, frozen OpenAPI, operation map, fixture, manifest를 함께 읽어라. 이전 대화나 pr-search repo 접근이 있다고 가정하지 마라.

pr-search 구현 handoff가 아직 없으면 제안 PSI-1.0 계약으로 mock 기반 BFF/auth unit tests와 adapter를 진행할 수 있다. 그 상태를 실 API 연결 완료라고 보고하지 마라. 최종 wire contract와 checksum을 확인한 뒤 live 연결을 완료한다.

commit/push/PR 생성, 운영 배포, 실제 키 발급·회수, 실제 직원 identity mapping 등록은 별도 명시 지시 없이는 하지 않는다.

## 1. 목표 구조

```text
기존 PIPE Search 콘텐츠
    │ 기존 PIPE 로그인 JWT
    ▼
GET /api/pr-search/v1/<고정 operation>
    │ 기존 JWTAuthentication + request.user
    ▼
서버 측 로그인 문맥/사용자 상태 검증
    │ grant cache hit 또는 exchange single-flight
    ▼
pr-search private Integration client (mTLS)
    │ 새 grant로 조회; PIPE JWT를 전달하지 않음
    ▼
응답 DTO 유지 + upstream 인증 오류 구분
    ▼
기존 Search 데이터 adapter
```

PIPE는 검색 데이터 정본·M 번호 발급·repository 권한 계산을 소유하지 않는다. `GithubPrJob`, 기존 `GitHubPullRequest` 수집 모델, MySQL search cache에 pr-search 결과를 복제하지 않는다. 기존 GitHub App private key/token을 검색 사용자 인증 수단으로 재사용하지 않는다.

## 2. 실제 PIPE 확인부터 한다

제공된 현황 문서는 React/Axios/Recoil/React Query, Django/DRF, MySQL/Redis, JWT HS256, 중앙 fetcher의 401 redirect를 설명한다. 정확한 버전·JWT claim·logout·라우트 등록·서버 라이브러리는 실제 저장소를 확인하라.

확인 목록:

- 저장소 지침, git status/HEAD, 미커밋 변경, backend/frontend 테스트 명령.
- JWTAuthentication 실제 위치·호출 조건, 서명/exp/issuer 검증, request.user 연결, 비활성 사용자 처리.
- token의 sub/user_id/jti/session ID/exp, refresh 시 token family, 실제 logout과 revocation.
- `frontend/src/apis/fetcher.js` 및 401 interceptor; 기존 Search client interface가 있으면 그것부터 확인.
- `services/global.js`, `commons/hooks/query/client.js` 등은 제공 문서의 조사 시작점이지 버전 확인 완료가 아니다.
- 서버 HTTP client(requests/httpx 등), JOSE/JWT(PyJWT 등), 암호화 저장소, Redis 분산 lock 사용 패턴.
- settings/env/secret 주입 방식, HAProxy의 경로·TLS·encoded slash·trailing slash behavior.
- Django URL namespace와 인증 decorator/permission class; 새 prefix가 기존 API를 가리지 않는지.

한 번의 작업 때문에 React/MUI/Django/JWT major를 전역 업그레이드하지 마라. 필요한 검증된 암호 라이브러리가 없으면 최소 의존성 변경과 호환성 이유를 기록한다. 보안 검증을 직접 구현하거나 verification=False로 우회하지 않는다.

## 3. 역할 분리와 API 경로

새 BFF prefix는 공통 계약 기준 `/api/pr-search/v1`다. 사용자는 PIPE 서버에만 요청한다. 브라우저에서 pr-search private 주소/서비스 assertion/grant/mTLS private key를 알아야 하는 구조를 만들지 않는다.

고정 API: `/context`, `/repositories`, `/search`, `/resolve`, `/merge-numbers/resolve`, PR 상세, commit 상세, source tree/history/diff/file, 그리고 현재 문맥을 종료하는 `POST /disconnect`.

원본 데이터 GET은 허용된 것만 구현한다. `proxy?url=...`, catch-all `<path:any>` HTTP 전달, 사용자가 upstream URL을 지정하는 경로는 금지한다. 이름만 같은 GET 관리자·로그·trigger endpoint도 허용하지 않는다.

URL의 slash 정책은 명시적으로 정한다. 인증 POST가 APPEND_SLASH나 upstream redirect로 다른 경로에 재전송되지 않게 한다. 클라이언트는 redirect를 따라가지 않는다. repository/path 인코딩은 OpenAPI와 operation map을 따른다.

## 4. 권장 코드 분리

아래 파일명은 제안이다. PIPE 기존 naming/레이어 규칙을 우선한다.

```text
backend/domain/pr_search/
  urls.py / views.py / serializers.py
  configuration.py
  principal.py             검증된 PIPE 사용자·로그인 문맥 추출
  assertion.py             Integration 전용 서명
  integration_client.py    mTLS 고정 host client; typed operation
  grant_cache.py           per-user+per-login+cert single-flight cache
  context_revocation.py    검색 연결 문맥 종료와 generation
  errors.py                upstream → PIPE 전용 오류 매핑
  models.py                필요한 문맥 회수 저장소만, 검색 데이터 저장 안 함
  tests/

frontend의 기존 Search adapter 영역
  endpoint/baseURL 연결
  context_key 기반 cache 경계
  upstream search 인증/연결 오류 구분
```

Search UI가 아직 없으면 backend/context와 주입 가능한 client adapter까지만 구현한다. UI를 임의로 새로 만들지 않는다. Stage 1 client 이름이 다르면 그 계약을 존중하고 adapter 하나로 연결한다.

## 5. PIPE 사용자 → assertion

BFF 매 요청에서 기존 JWT 검증을 먼저 수행한다. grant cache lookup을 이보다 앞에 두지 마라. disabled user 또는 만료된 PIPE 인증이면 upstream을 호출하지 않는다.

Assertion sub는 검증된 canonical PIPE 사용자에서 얻는다. 브라우저의 `github_user`, `knox_id`, `user_id`, `X-User-Id` 같은 별도 입력으로 변경할 수 없어야 한다. 검색 q의 author 조건은 데이터 필터일 뿐 assertion subject에 영향을 주면 안 된다.

로그인 문맥 ID는 실제 검증된 session ID를 우선 사용한다. 없으면 서버 비밀로 검증된 token을 HMAC fingerprint하여 사용하되 raw token을 캐시 key나 로그에 넣지 않는다. 같은 사용자라도 다른 로그인 token/기기 문맥은 분리한다. session family가 없다면 refresh 이후 새 문맥으로 취급한다. 임의 localStorage의 userInfo로 이 문맥을 생성하지 않는다.

`auth_expires_at`는 검증된 로그인 자격의 실제 만료를 따른다. 만료 없는 JWT를 발견하면 arbitrary 12시간을 채우지 말고 운영 활성화를 보류하며 bounded 인증 정책을 보고한다.

Integration 전용 RSA private key로 RS256 assertion을 서명한다. PIPE 로그인 HS256 secret, GitHub App key, Django SECRET_KEY를 사용하지 않는다. issuer/audience/client/profile/typ와 60초 이내 TTL·jti·목적은 공통 계약과 frozen OpenAPI 그대로다. 운영 host와 subject 매핑을 추측하지 않는다.

## 6. mTLS HTTP 클라이언트

서버 전용 fixed baseURL, 승인 CA, client cert/key, hostname verification을 설정한다. 요청마다 사용자 입력으로 주소를 고르지 않는다. HTTPS certificate 검증을 비활성화하지 않는다.

Exchange와 read 모두 같은 승인 mTLS certificate를 사용한다. cert rotation을 알게 되면 fingerprint가 cache key에 포함되므로 이전 grant를 새 cert에 재사용하지 않는다. 인증 실패를 무시하고 일반 pr-search `/api`로 우회하지 않는다.

Header는 새로 조립한다. 브라우저 Authorization/Cookie/Host/X-User-Id/X-Roles를 upstream으로 복사하지 않는다. exchange body에는 signed assertion만 보내고, read Authorization에는 신규 opaque grant만 넣는다. correlation ID는 BFF가 생성한다.

허용 HTTP client는 redirect OFF, connection/read/overall timeout, response size 제한, connection pool 상한을 명시해야 한다. source 다중 요청으로 worker나 socket이 무제한 증가하지 않도록 per-user/client 제한을 둔다. raw request/response logging 기능에서 토큰·본문이 노출되지 않는지 확인한다.

## 7. grant 캐시와 race 처리

키에는 environment/upstream/client/issuer/subject/auth_context/profile/protocol/cert fingerprint를 포함한다. 같은 사용자 ID 하나만 key로 쓰지 마라. raw token은 안전한 서버 저장소에 암호화하고 접근 ACL을 적용한다. schema와 키는 PIPE 소유이며 pr-search Redis에 직접 접속하지 않는다.

Exchange 응답을 schema로 검증한다. token_type/profile/version, expiry, auth_context, identity가 요청 문맥과 맞는지 확인한다. raw token과 canonical binding 정보는 browser에 반환하지 않는다. 300초 최대값과 실제 PIPE token exp를 다시 확인한다.

동일 문맥의 동시 첫 조회는 single-flight로 합친다. 프로세스 내 Promise/lock만으로 여러 Gunicorn/Django worker의 race를 해결했다고 하지 않는다. 분산 lock 또는 등가 처리의 owner token·deadline·release safety를 시험한다.

로그아웃/disconnect가 진행되는 동안 늦게 도착한 exchange를 저장하지 않도록 context generation을 확인한다. 캐시에서 만료/회수된 grant를 꺼내 정상으로 다루지 않는다. cache 장애가 발생하면 인증 없는 upstream 호출로 fallback하지 않는다.

첫 화면에서 /context/repositories/search가 동시에 호출돼도 같은 문맥의 중복 grant 발급이 폭증하지 않게 한다. 무조건 사용자 전체를 직렬화해 다른 사용자의 검색을 막지도 않는다.

## 8. 조회 proxy와 데이터 보존

BFF의 각 operation은 pr-search private `/read/<operation>`에 고정 매핑한다. 성공 DTO의 items/next_cursor/total/facets/candidates/source/epoch/M 상태를 재설계하지 않는다. 검색 문법과 M 번호를 PIPE에서 다시 계산하지 않는다.

다음을 특히 보존한다:

- PR/SHA identifier resolve와 일반 query search의 구분은 Stage 1 client 계약을 따른다.
- M 번호 양방향 resolver도 연결한다.
- cursor는 데이터 API 요청에만 사용하고 브라우저 공유 URL에 토큰·cursor를 추가하지 않는다.
- GHE PR 권한을 PIPE의 admin 여부로 대체하지 않는다. UI에서 숨겨도 서버에서 다시 판정한다.
- missing/null/0, pending/unavailable/not_applicable, partial/truncated/epoch_stale를 같은 상태로 뭉개지 않는다.
- source response는 JSON이며 코드를 HTML로 실행하거나 외부 script로 삽입하지 않는다.
- 같은 DTO를 PIPE DB에 장기 저장하지 않는다. HTTP private/no-store를 유지한다.

Operation map의 query allowlist/type을 적용한다. 단일값 parameter의 중복을 임의로 첫 값/마지막 값으로 고르지 않는다. source branch/file path의 정당한 slash는 보존하되 traversal·double decode 우회는 거절한다. 표준 URL builder를 사용한다.

## 9. 오류 처리와 재시도

핵심 규칙: PIPE browser에 전달하는 401은 PIPE 자체 인증 실패에만 사용한다. upstream 401이 기존 fetcher의 전역 /login redirect를 실행시키면 이 작업은 실패다.

공통 계약 §8의 code/status mapping을 그대로 구현한다. 최소 구분:

- identity 미연결 → 403 SEARCH_IDENTITY_REQUIRED.
- identity disabled/context revoked → 403; 자동 재연결 금지.
- identity conflict → 409; 계정 임의 병합 금지.
- service signature/mTLS/잘못된 grant → 503 SEARCH_AUTH_UNAVAILABLE; PIPE 로그아웃 없음.
- scope 확인 불가 → 503 PERMISSION_UNAVAILABLE; 빈 결과로 반환 금지.
- 429 → Retry-After 유지; 즉시 재시도 금지.
- 연결/timeout → 502/504 검색 영역 오류.
- 원본 입력/cursor/epoch/source 오류 → 계약의 의미 유지.

`GRANT_EXPIRED`만 cache 삭제→새 assertion/exchange→원래 GET 1회 재전송한다. 다른 401에도 무조건 이 로직을 실행하지 마라. 특히 revoked와 expired는 다르다.

Exchange가 timeout됐을 때 같은 jti를 재사용하지 않는다. 허용된 총 deadline/시도 횟수 안에서 새 assertion 1회로 제한한다. HTTP library와 React Query의 재시도가 곱해져 무한 인증 루프가 되지 않도록 계층별 retry 책임을 기록한다.

error response에는 안전한 message와 correlation ID만 넣는다. HTML 로그인 페이지, 내부 URL/stack trace, raw upstream exception을 노출하지 않는다. 일반 PIPE API의 기존 interceptor를 전역 변경하는 대신 신규 BFF error contract와 필요한 Search client 분기에 한정한다.

## 10. 로그인 종료와 통합 context 회수

실제 logout 경로에 최소 hook을 연결한다. 요청이 없으면 브라우저에서 logout했다고 서버가 즉시 알 수 있다는 가정을 하지 마라.

순서:

1. 현재 검증된 auth_context만 local integration-revoked 상태로 표시한다.
2. generation 증가 및 해당 grant cache 삭제.
3. fresh revoke-context assertion으로 pr-search에 회수 요청.
4. 성공/실패를 기록하되 기존 PIPE local logout은 완료한다.

회수 상태는 옛 PIPE JWT가 여전히 암호학적으로 유효하더라도 같은 문맥의 BFF 요청을 막아야 한다. 현재 PIPE에 global JWT revocation이 없다면 검색 연동에 필요한 좁은 context revocation을 추가하되, 이것이 전체 PIPE 로그인 토큰을 취소한다고 말하지 마라.

서버가 알 수 없는 offline logout의 경우에는 즉시 global 회수를 약속할 수 없다. 짧은 grant 최대 수명과 서버 재요청 시 PIPE 인증 검증의 한계·잔여 창을 README에 명시한다. 실 logout/revocation이 미구현이면 그 항목을 완료 처리하지 않는다.

동일 사용자의 다른 로그인 문맥은 유지한다. 브라우저가 user ID를 지정해 다른 문맥을 지우는 API를 만들지 않는다. disconnect 이후 동일 문맥으로 자동 exchange하지 않는다. 새 검증된 login context에서만 재연결한다.

## 11. Stage 1 UI와 접합하는 최소 변경

UI 데이터 adapter가 존재하면 base path와 method mapping을 이번 BFF에 맞춘다. `/context`에서 받은 GHE login으로 My 탭을 구성하되, 기존 전체 author 검색을 제한하지 않는다.

context_key가 달라지거나 PIPE logout/계정 변경이 발생하면 민감한 React Query cache를 분리·제거한다. 이전 사용자의 결과를 새 사용자 화면에서 placeholder로 보여주지 않는다. 새 전역 Recoil 저장소에 grant/token/검색 응답을 복제하지 않는다.

정상 연결은 ready, 미매핑은 계정 연결 필요, 권한 서비스 장애는 검색 서비스 오류로 표시한다. API 장애를 성공 fixture로 자동 대체하지 않는다. live/fixture mode는 명시적으로 분리한다.

App Shell, 새 로그인 폼, 별도 디자인 시스템, Job/MDVP 실행 버튼, PR 상태를 PIPE Job SUCCESS/FAIL로 변경하는 작업은 이번 범위에 없다.

## 12. 설정과 운영 입력

필요한 설정의 logical 이름:

```text
PR_SEARCH_BFF_ENABLED=0
PR_SEARCH_INTEGRATION_BASE_URL=<private-approved-https-host>
PR_SEARCH_CLIENT_ID=<registered-client>
PR_SEARCH_ASSERTION_ISSUER=<exact-issuer>
PR_SEARCH_ASSERTION_AUDIENCE=<exact-audience>
PR_SEARCH_ASSERTION_KEY_ID=<registered-kid>
PR_SEARCH_ASSERTION_PRIVATE_KEY_FILE=<secret-reference>
PR_SEARCH_MTLS_CERT_FILE=<secret-reference>
PR_SEARCH_MTLS_KEY_FILE=<secret-reference>
PR_SEARCH_CA_BUNDLE=<approved-ca>
PR_SEARCH_PROTOCOL_VERSION=PSI-1.0
PR_SEARCH_GRANT_CACHE_NAMESPACE=<isolated-namespace>
```

실제 naming은 PIPE conventions에 맞춰 확정한다. .env.example에는 비밀을 넣지 않는다. UI build 환경변수로 backend key/baseURL credential을 노출하지 마라. frontend가 알아야 할 것은 같은 origin의 BFF prefix뿐이다.

단위 테스트용 키·CA는 production에서 거절하도록 구분한다. 회사 CA/서비스 주소/identity mapping이 없으면 mock integration tests까지 진행하고 운영 flag는 OFF다.

## 13. 테스트·검증

공통 acceptance matrix를 구현하고 실제 결과를 기록한다. 최소 테스트:

- 인증 없음/만료/disabled PIPE user에서 upstream 호출 0회.
- 브라우저 user/role/header 조작이 signed sub에 영향을 주지 않음.
- 사용자 A/B와 동일 사용자 두 login context의 cache 격리.
- 20개 동시 첫 조회의 exchange single-flight와 timeout recovery.
- signed TTL/auth expiry/clock skew/cert rotation.
- 정상 grant reuse, expired 1회 재발급, revoked/mapping disabled/403/429의 재발급 0회.
- 늦은 exchange + logout 경합에서 캐시가 살아나지 않음.
- 같은 프런트엔드 fetcher 경로로 upstream 401을 유발해 PIPE login redirect가 발생하지 않음.
- 쿼리/DTO/cursor/M 번호/source response parity.
- encoded repository slash와 실제 Django URL resolution, 필요한 경우 HAProxy 통합 환경.
- raw token/assertion/Cookie/PII code가 logger/APM/response에 남지 않음.
- 기능 OFF에서 기존 `/github-jobs/*`, 기존 사용자 인증, 일반 API/메뉴 동작에 회귀 없음.

프런트엔드가 아직 없으면 해당 browser 검증은 NOT_RUN으로 명시한다. server unit 테스트를 브라우저 end-to-end 테스트로 바꿔 말하지 마라. 실제 회사 CA/GHE/서버 권한 검증은 배포 담당자가 승인한 테스트 환경에서만 한다.

## 14. 완료 산출물

- 구현 코드·테스트·필요한 additive migration.
- 실제 PIPE HEAD와 pr-search handoff HEAD, 사용한 protocol version/checksum.
- API mapping, 오류/재시도/caching/revocation 설정 문서.
- .env.example 및 secret/TLS 주입 절차; 실제 비밀 없음.
- TEST_RESULTS: 실행한 명령·결과·baseline·NOT_RUN, 공통 acceptance ID별 증거.
- DEPLOYMENT_AND_ROLLBACK: flag, 사용자/저장소 제한 파일럿, 로그 확인, 실패 시 검색 기능만 비활성화.
- 실제 연결을 위해 사람에게 필요한 값과 미해결 보안 항목.

완료를 네 수준으로 나눠 보고하라: 코드 구현 / local contract 테스트 / 실제 mTLS 검증 / 실제 사용자별 GHE 권한 연결. 네 수준을 하나의 “완료”로 합치지 마라.
