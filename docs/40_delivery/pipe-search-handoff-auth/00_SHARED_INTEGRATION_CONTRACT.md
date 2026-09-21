# PIPE ↔ pr-search Search Integration — 공통 구현 계약

계약 ID: `PSI-1.0`  
상태: 구현을 위한 제안 계약. 현재 운영 API가 아니다.  
작성 기준: 2026-09-20에 조회한 `89sooner/pr-search` main `5f0d7e0e5f2a0f492d56ffb0c39ddd7a618f42a6`.  
적용 대상: pr-search 수신부 Claude와 PIPE 인증·BFF Claude.  
문서 관계: 1단계 Search UI 포팅 작업과 병행할 수 있지만, 운영 인증 연결 완료 전까지 fixture와 실데이터를 혼동하지 않는다.

## 0. 무엇을 만들고 무엇을 만들지 않는가

만드는 것은 PIPE 사용자가 PIPE 화면에서 pr-search의 읽기 전용 Search 기능을 사용하는 서버 연결이다. PR·commit 검색, M 번호 해석, 저장소 선택, 파일 트리·이력·diff·파일 조회를 포함한다. Search UI와 App Shell 디자인을 다시 구현하지 않는다. Job/MDVP/승인/workflow 실행, Regression/bisect 쓰기, 관리자·감사 조회, 전체 API 프록시, 검색 색인 복제는 제외한다. 읽기 전용은 제품 데이터/Job/GitHub 작업의 변경을 금지한다는 뜻이다. 이번 인증 grant·매핑·회수 기록, 기존 권한 캐시와 감사 기록에 필요한 제한된 저장은 포함한다.

사용자가 앞서 받은 `PR_SEARCH_TO_PIPE_STAGE1_CLAUDE_PROMPT.md`는 UI 이식과 데이터 경계 문서다. 그 작업의 “인증은 다음 단계”가 바로 이번 작업이다. 실제로 생성된 Stage 1 인수인계 파일이 있으면 함께 읽되, 생성되지 않은 인터페이스나 파일이 이미 있다고 가정하지 않는다.

신규 인증 경로는 기존 검색 API의 인증을 교체하지 않는다. 기본 기능 플래그 OFF, 추가 경로·모듈·테이블 중심으로 구현한다. 불가피한 공유 함수 추출은 허용하지만 기존 HTTP 계약과 보안 판정을 보존한다.

## 1. 확인된 사실과 이번 설계 결정을 구분한다

### 1.1 확인된 pr-search 사실

- `apps/search-api/src/auth/principal.ts`의 일반 사용자 인증은 Redis 세션 쿠키를 읽는다. PIPE JWT를 받아들이는 경로로 확인되지 않았다. OIDC 미구성 시 관리용 토큰 예외는 사용자 검색 통합용이 아니다.
- `packages/authz/src/session.ts`의 정본 쿠키 이름은 `__Host-prs_session`; 평문 개발용 이름은 `prs_session`이다. 기존 세션의 유휴/절대 만료와 이번 통합 grant의 수명은 서로 다른 계약이다.
- `RegisteringSessionStore.load()`는 기존 세션의 역할에 DB의 관리자 지정 역할을 합친다. 단순히 세션 생성 때 `developer`를 넣는 것만으로 검색 전용 자격을 보장할 수 없다.
- `AccessScopeResolver`는 Redis/PostgreSQL/GHE 계층을 사용하며 현재 권한 캐시 TTL은 5분이다. 만료된 권한 캐시로 장애를 우회하지 않는다. 매 요청의 권한 판정이 매번 GHE를 직접 호출한다는 뜻은 아니다.
- source route는 권한으로 저장소를 확인한 뒤 GitHub source reader를 사용한다. 이 검사 순서와 감사 기록을 보존해야 한다.
- M 번호 해석 경로는 `/api/v1/merge-numbers/resolve`다. 권한 확인보다 저장소 코드·epoch 정보를 먼저 노출하지 않는 검증 순서가 있다.

근거 파일과 표준 문서는 `05_SOURCE_EVIDENCE.md`에 있다. PIPE의 사실은 사용자가 제공한 system-overview에 한정한다. 실제 PIPE Python/Django/DRF/JWT 라이브러리 버전, JWT claims, logout/revocation 구현, TLS 종료 지점, 회사 identity directory는 아직 확인되지 않았다.

### 1.2 이번에 확정하는 구현 방향

```text
브라우저
  PIPE 기존 로그인 JWT
       │ 같은 origin의 검색 API
       ▼
PIPE Django BFF
  기존 JWT 검증 → request.user
  로그인 문맥 확인 → 짧은 사용자 assertion 서명
  서버에만 검색 grant 보관
       │ 서버 간 HTTPS + mTLS
       ▼
pr-search 전용 Integration 경로
  PIPE 서버와 assertion 검증
  검증된 PIPE subject ↔ 기존 pr-search 사용자 매핑
  검색 전용 opaque grant 발급·검증
       │ 내부 공유 조회 서비스 / 기존 권한 로직
       ▼
기존 AccessScopeResolver + 검색/source/M 번호 서비스
       │ 사용자 권한 ∩ PIPE 허용 범위
       ▼
PostgreSQL / Elasticsearch / GHE
```

이전 설명의 “pr-search 세션을 재사용”은 권한·조회 기능의 재사용 취지로 유지하되, 운영용 `prs_session`을 PIPE에 발급해 전달하는 구현으로 고정하지 않는다. 이번 기본안은 별도 namespace의 검색 전용 grant다. 원본 쿠키 경로는 그대로 둔다. grant는 일반 `/api/v1/*` 및 기존 web 세션에서 사용할 수 없어야 한다.

이 문서의 exchange는 목적이 제한된 사내 위임 프로토콜이다. 경로명만으로 RFC 8693 OAuth Token Exchange를 구현했다고 주장하지 않는다. 사내에 이미 검증된 OIDC/OAuth 위임 제품이 있으면 원칙을 만족하는 대안을 ADR로 비교할 수 있지만, 두 저장소 중 하나만 wire protocol을 변경하지 않는다.

## 2. 신뢰 경계와 보안 불변식

| 경계 | 신뢰하는 것 | 신뢰하지 않는 것 |
|---|---|---|
| 브라우저 → PIPE | 기존 검증기를 통과한 PIPE 인증과 서버의 사용자 상태 | body/query/header의 userId, login, role 주장 |
| PIPE → Integration | 등록된 mTLS client와 별도 서명키로 검증한 assertion | 사내 IP라는 이유만의 신뢰, PIPE 로그인 JWT 재사용 |
| Identity binding | 승인된 `(issuer, subject)`와 canonical pr-search 사용자 연결 | Knox ID 문자열 치환, 이메일 일치만으로 계정 합치기 |
| Integration → 조회 서비스 | 검증 후 서버 내부에서 생성한 제한된 read context | 네트워크 입력으로 받은 principal/scope 객체 |
| 조회 서비스 → 데이터 | 기존 권한 필터와 통합 client의 저장소 허용 범위의 교집합 | service account로 전체 조회한 뒤 결과를 거르는 방식 |

반드시 유지할 불변식:

1. 원래 검색 API는 PIPE JWT/신원 헤더/grant를 일반 로그인 대체 수단으로 받지 않는다.
2. Integration 자격은 검색 관련 고정 operation 집합에서만 유효하다. HTTP GET이라는 이유만으로 모든 API를 열지 않는다.
3. 실제 사용자가 pr-search operator여도 이 연결에서는 관리자·실행·감사 조회 경로에 접근할 수 없다.
4. 허용 저장소 필터는 데이터 조회·count·facet·resolver·source 조회 전에 적용한다. 응답을 받은 뒤 제거하지 않는다.
5. PIPE는 검색 권한의 독립적인 정본이나 장기 권한 캐시를 만들지 않는다.
6. grant/assertion/서비스 비밀은 브라우저 응답, localStorage, URL, 로그에 넣지 않는다.
7. 기존 인증 OFF 개발 옵션, TLS 검증 OFF, 공용 사용자 계정으로 통합 경로의 운영 실패를 우회하지 않는다.
8. 계정 매핑·로그인 문맥·grant 회수 확인이 불가능하면 관련 요청은 실패한다. 권한 scope의 기존 정상 fallback과 이 원칙을 혼동하지 않는다.

## 3. 경로 분리와 operation 목록

### 3.1 브라우저가 호출하는 PIPE 경로 — 신규 제안

기본 prefix: `/api/pr-search/v1`.

| Method / suffix | 역할 |
|---|---|
| `GET /context` | 검색 연결 준비 및 검증된 GHE login·기능 목록 반환; 필요하면 BFF가 서버 간 exchange 수행 |
| `GET /repositories` | 허용된 수집 저장소·브랜치 문맥 |
| `GET /search` | 검색·정렬·cursor·facet |
| `GET /resolve` | PR/SHA 식별자 해석 |
| `GET /merge-numbers/resolve` | M 번호 ↔ PR 해석 |
| `GET /pull-requests/{repository}/{prNumber}` | PR 상세 |
| `GET /commits/{repository}/{sha}` | commit 상세 |
| `GET /source/{repository}/tree` | source tree |
| `GET /source/{repository}/history` | source history |
| `GET /source/{repository}/diff` | 비교 메타데이터 |
| `GET /source/{repository}/file` | 특정 revision 파일 |
| `POST /disconnect` | 현재 로그인 문맥의 검색 연결 종료; 전체 PIPE logout hook에서 사용할 수 있는 최소 경로 |

`repository`는 논리적으로 `owner/repo` 하나다. 기존 source API와 동일한 단일 인코딩 파라미터를 기본으로 하되, 실제 HAProxy·Django가 encoded slash를 어떻게 처리하는지 end-to-end 검증한다. 허용 경로를 안전하게 구성할 수 없는 배포라면 계약을 두 저장소에서 함께 개정한다. 무조건 double encoding하거나 경로를 반복 decode하지 않는다.

`/context`의 로그인 준비는 검색 데이터 쓰기 작업이 아니며 인증 캐시 준비에 한정한다. 토큰 발급 전용 브라우저 응답은 만들지 않는다. `/disconnect`는 UI 재설계 요구가 아니며 기존 logout 연결과 테스트용 최소 동작이다. 운영 JWT를 재활용하는 동일 문맥은 disconnect 이후 자동 재연결하지 않는다. 새 로그인/새로 검증된 자격 문맥에서 재연결한다.

### 3.2 PIPE 서버만 호출하는 pr-search 경로 — 신규 제안

기본 prefix: `/internal/integrations/pipe/v1`.

| Method / suffix | 인증 | 역할 |
|---|---|---|
| `POST /auth/exchange` | mTLS + body의 signed assertion | 검색 grant 발급 |
| `POST /auth/revoke` | mTLS + grant | 해당 grant 폐기; 반복 호출 안전 |
| `POST /auth/revoke-context` | mTLS + 새로운 revoke-context assertion | 해당 사용자의 해당 로그인 문맥을 회수 |
| `GET /context` | mTLS + grant | 검증된 검색 사용자·기능 표시 정보 |
| `GET /read/repositories` | mTLS + grant | 기존 repositories 조회 기능 |
| `GET /read/search` | mTLS + grant | 기존 search 기능 |
| `GET /read/resolve` | mTLS + grant | 기존 resolver |
| `GET /read/merge-numbers/resolve` | mTLS + grant | 기존 M resolver |
| `GET /read/pull-requests/{repository}/{prNumber}` | mTLS + grant | 기존 PR 상세 |
| `GET /read/commits/{repository}/{sha}` | mTLS + grant | 기존 commit 상세 |
| `GET /read/source/{repository}/{operation}` | mTLS + grant | operation은 tree/history/diff/file 정확히 4종 |

일반 pr-search web `/api/*`는 원래 search-api `/api/v1/*`로 프록시되는 별도 계층이다. 위 private prefix와 섞지 않는다. `/read/*`는 문서상의 묶음일 뿐 catch-all proxy 허가가 아니다. 각각 고정 route로 등록한다.

원본 데이터 요청/응답은 `apps/search-api`의 해당 route/schema를 정본으로 추출해 전달한다. 위 신규 path, 인증 필드, 오류 분기는 이번 계약이며 원본 DTO의 의미를 바꾸는 명분이 아니다. exact query key·상한·nullable·cursor·epoch·부분 결과 상태는 pr-search 담당자가 실제 코드와 테스트에서 확정한다. 생성된 OpenAPI에 이 부분을 `object: any`만으로 남기지 않는다.

### 3.3 공개 차단

- prefix에 internal이라는 이름이 있다는 이유만으로 private라고 간주하지 않는다.
- private listener/ingress에서만 노출하고, public ingress와 기존 Next proxy 우회 경로를 차단한다.
- 같은 Fastify process에 mount하더라도 모든 Integration route는 검증된 mTLS transport context를 요구한다. 일반 public listener를 통해 들어온 요청은 인증값을 알아도 허용하지 않는다.
- 프록시가 TLS를 종료하면 client certificate metadata를 외부 입력에서 제거하고 신뢰된 proxy만 재생성한다. app의 backend port는 그 proxy 또는 허용된 로컬 transport만 접근한다. 사용자 제공 `X-SSL-Client-Verify: SUCCESS`를 그대로 믿는 구현은 금지한다.
- existing web/API의 ordinary login path와 network exposure는 바꾸지 않는다. 배포 설정은 diff와 검증 절차로 제출하고 임의 운영 적용하지 않는다.

## 4. 사용자 매핑

권장 레코드의 논리 필드:

```text
integration_identity_binding
  issuer                    검증된 PIPE 통합 issuer
  subject                   PIPE 서버가 확인한 불변 사용자 ID
  prs_user_id               기존 app_user.user_id
  ghe_host                  계정이 속한 GHE 호스트
  ghe_user_id                검증된 GHE 숫자 ID
  status                    pending | active | disabled | conflict
  binding_version           변경 때 증가
  verified_by / verified_at / verification_reference
  created_at / updated_at
```

`UNIQUE(issuer, subject)`와 배포 identity 정책에 맞는 역방향 충돌 검사를 둔다. alias·개명·계정 통합은 자동 해결하지 않는다. 숫자 GHE ID가 맞더라도 기존 `prs_user_id`를 멋대로 재발급하지 않는다. 동일 사용자의 권한 캐시·감사·역할을 이어갈 canonical identity를 사용한다.

v1 활성화 기본안은 기존 pr-search에 등록된 사용자에 대한 검증된 매핑이다. 관리자용 dry-run/import/disable CLI 또는 기존 검증된 사내 identity source를 사용한다. 실제 데이터 매핑은 사람이 검증한다. 회사 identity directory가 이미 있다는 가정으로 코드를 작성하지 않는다. 공식 공급원이 확인되면 어댑터로 대체할 수 있다.

GHE login은 API 호출/표시에 필요하지만 identity anchor로 단독 사용하지 않는다. 현재 canonical user에서 최신 login을 읽고, 숫자 ID/매핑과 충돌하면 실패시킨다. `soonho.kim → soonho-kim` 같은 치환, 사용자가 입력한 GHE login, 이메일만 같은 계정에 자동 연결하는 것은 금지한다.

매핑 변경·비활성화는 binding_version을 변경하고 관련 grant를 무효화한다. 모든 read 요청에서 active/version을 확인한다. 매핑 회수의 관측 시점을 “변경 완료 뒤 새로 판정되는 요청”으로 정의하고 이미 실행 중인 응답을 소급 취소한다고 주장하지 않는다.

사용자 공급이 안 된 경우: 코드·합성 fixture 테스트는 진행하고 운영 연결은 `IDENTITY_BINDING_REQUIRED`로 멈춘다. 가짜 매핑으로 실서버를 연결하지 않는다.

## 5. 서비스 인증과 사용자 assertion

### 5.1 키와 환경 분리

- PIPE 로그인용 HS256 secret을 pr-search와 공유하지 않는다.
- PIPE Integration 전용 비대칭 서명키를 만든다. v1 알고리즘은 `RS256`으로 고정한다. 라이브러리는 실제 설치 환경과 회사 기준에 맞는 검증된 JOSE/JWT 구현을 사용한다. 서명·X.509 검증을 직접 구현하지 않는다.
- 공개키는 배포 설정 또는 고정된 승인 JWKS 위치에서 관리한다. 토큰의 `jku`, `x5u`, `jwk`를 따라 키를 가져오지 않는다. `kid`는 등록된 로컬 key registry에서만 선택한다.
- dev/stage/prod의 issuer, audience, client_id, CA, 키를 분리한다.
- mTLS는 서비스가 누구인지 확인하고, assertion은 PIPE가 검증한 사용자 신원을 전달한다. 네트워크 ACL은 추가 방어이며 둘의 대체물이 아니다.

아래 예시 이름은 운영 호스트가 아닌 계약 예시다.

```json
{
  "client_id": "pipe-prod",
  "issuer": "urn:corp:pipe:prod",
  "audience": "urn:corp:pr-search:pipe-integration:prod",
  "profile": "search-read-v1"
}
```

### 5.2 assertion 형식

JOSE header:

```json
{"alg":"RS256","typ":"pipe-user-assertion+jwt","kid":"pipe-signing-2026-01"}
```

payload — 정수 시간값은 테스트 clock으로 생성한다:

```json
{
  "iss": "urn:corp:pipe:prod",
  "aud": "urn:corp:pr-search:pipe-integration:prod",
  "sub": "fixture-corp-user-001",
  "client_id": "pipe-prod",
  "purpose": "grant",
  "profile": "search-read-v1",
  "auth_context_id": "opaque-server-derived-login-context",
  "auth_expires_at": 2000003600,
  "iat": 2000000000,
  "nbf": 2000000000,
  "exp": 2000000060,
  "jti": "at-least-128-bits-random-base64url"
}
```

`sub`와 `auth_expires_at`는 브라우저가 제공한 별도 body가 아니라 PIPE가 서명 검증한 로그인 자격과 서버 사용자 기록에서 얻는다. `auth_context_id`는 검증된 로그인 세션/토큰 문맥을 구분하는 비밀 아닌 불투명 값이다. 브라우저 query에서 받지 않는다.

기존 PIPE JWT에 안정적인 session ID가 있으면 검증 후 사용한다. 없으면 별도 서버 비밀로 검증된 토큰의 fingerprint를 HMAC 처리하는 등 재현 가능한 서버 측 문맥을 만든다. 원본 JWT나 단순 사용자 ID를 문맥 ID로 쓰지 않는다. token refresh를 기존 로그인 문맥으로 연결하려면 검증된 session family가 필요하다. 없으면 새 검증 토큰은 새 문맥으로 취급하고 이전 grant를 자동 승계하지 않는다. 만료 없는 JWT라면 운영 통합은 막고 인증 수명 정책의 승인을 먼저 받는다.

필수 검증:

- 등록된 alg/typ/kid, signature, issuer, 단일 정확한 audience, client_id↔mTLS 서비스 매핑.
- 필수 필드의 타입·길이, purpose/profile, `exp > iat`, `exp - iat <= 60초`, 미래 iat 제한, nbf/exp.
- clock skew 기본 허용 5초. grant 실제 만료는 skew로 연장하지 않는다.
- grant 목적이면 `auth_expires_at > now`; 이 값보다 grant가 오래 살지 않는다.
- `roles`, `repositories`, `operator`, `ghe_login` 같은 권한/사용자 매핑 주장 필드는 이 profile에 허용하지 않는다. 정해지지 않은 필드는 schema 정책대로 거절한다.
- 검증 성공 후 `(issuer, client_id, purpose, jti)`를 분산 저장소에서 원자적으로 1회 소비한다. 남은 assertion 유효시간+skew까지만 보관한다. 한 process의 Set만으로 replay를 막았다고 하지 않는다.
- replay 저장소가 실패하면 503이며 fail-open하지 않는다. `alg:none`, HS/RS 혼동, 미등록 key를 테스트한다.

서명키가 있는 PIPE는 승인된 subject를 대신 주장할 수 있는 신뢰 주체다. 이 위임 위험 자체가 암호화로 사라지는 것은 아니다. 접근 가능한 issuer/client·사용자 매핑·저장소 정책을 제한하고 PIPE 키 유출 대응 절차를 둔다.

## 6. grant 발급·사용

### 6.1 exchange

```http
POST /internal/integrations/pipe/v1/auth/exchange
Content-Type: application/json
X-Correlation-Id: <server-generated uuid>

{"assertion":"<signed-JWT>"}
```

이 요청에는 별도 사용자 Authorization/Cookie를 전달하지 않는다. mTLS client certificate는 TLS 계층에서 제공한다.

처리 순서: transport client 검증 → 요청 크기/schema → signature/claims → jti 원자 소비 → 로그인 문맥 회수 확인 → active identity binding/canonical user 확인 → 제한된 client 정책 확인 → 권한 context 조회 → grant 원자 저장.

권한 조회 성공 후 0개 저장소인 경우와 권한 조회 실패는 구분한다. 0개인 사용자는 빈 검색 범위를 갖는다. 후자는 503이다. grant에 권한 목록을 고정 복사해 이후 요청의 권한 판정을 생략하지 않는다.

성공 예:

```json
{
  "protocol_version": "PSI-1.0",
  "token_type": "Bearer",
  "access_token": "psig1_<32-random-bytes-base64url>",
  "grant_id": "11111111-1111-4111-8111-111111111111",
  "expires_in": 300,
  "expires_at": "2033-05-18T03:38:20Z",
  "auth_context_id": "opaque-server-derived-login-context",
  "binding_version": 1,
  "identity": {"ghe_login":"fixture-dev-a"},
  "capabilities": ["search:read", "source:read"]
}
```

숫자·시각은 형식 설명용 fixture다. 실제 예제 fixture에서는 `expires_at`, `expires_in`, clock의 일관성을 테스트한다. 성공은 `200`; `Cache-Control: private, no-store`; `Set-Cookie` 없음.

### 6.2 grant 의미와 저장

- raw token은 암호학적으로 안전한 최소 32 random bytes에 구분 prefix를 붙인 불투명 값이다.
- pr-search는 token hash로 조회하며 raw token을 평문 저장/로그하지 않는다. grant 레코드는 client_id, 발급 kid, mTLS leaf certificate SHA-256 fingerprint, issuer/subject, auth_context_id, canonical user ID, binding_version, client_policy_version, profile, issued_at, expires_at를 포함한다.
- 권한의 유효 수명은 `min(now+300초, auth_expires_at, binding/client의 유효한 상한, certificate 만료)` 이내다. sliding extension과 refresh token은 v1에 없다.
- credential 만료와 저장 레코드 보존은 분리한다. `GRANT_EXPIRED`와 `GRANT_INVALID`를 구분하려면 token hash/만료 메타데이터를 만료 후 120초 등 짧은 진단 창까지 보존할 수 있다. 이 보존은 인증 수명 연장이 아니다. 이후 기록까지 없어진 값은 INVALID이며, BFF는 오래된 local cache를 사용하지 않아야 한다. revoked/context tombstone은 회수 계약의 horizon까지 보존한다.
- PIPE는 서버 측 전용 저장소에 raw grant가 필요하다. 접근 제한·암호화된 캐시를 사용하고 로그/관측/APM에서 제거한다. PIPE Redis와 pr-search Redis를 공유하지 않는다.
- binding/client/key/certificate/로그인 문맥이 비활성화됐으면 아직 TTL이 남아도 거절한다.
- grant는 `SessionStore`의 일반 브라우저 세션이 아니다. 정상 Cookie로 변환해 public API에 통과시키지 않는다.

### 6.3 조회

```http
GET /internal/integrations/pipe/v1/read/search?q=<encoded-query>&sort=pr_number&order=desc&size=50
Authorization: Bearer psig1_<opaque>
X-Correlation-Id: <server-generated uuid>
```

`/auth/exchange` 및 `/context`를 포함한 전체 private surface에서 응답은 no-store로 처리한다.

mTLS는 이 GET에도 필수다. 발급에 사용한 client certificate fingerprint와 같아야 한다. cert rotation 시 새 cert로 이전 grant를 재사용하지 않고 새 grant를 얻는다. key/client 정책의 active 여부도 매번 확인한다.

검증 후 canonical user의 기존 권한 엔진을 호출하고 통합 client의 허용 범위를 강제 교집합으로 추가한다. scope_mode가 repo_ids 또는 org_team인 경우 모두 교집합이 실제 검색/SQL/source 판정에 반영돼야 한다. UI나 q 문자열에 repo 조건을 덧붙이는 것으로 대체하지 않는다.

내부 구현의 기본안은 검증된 `IntegrationReadContext`와 기존 서비스 함수를 공유하는 것이다. 일반 route는 기존 session 인증 후 같은 서비스로 들어간다. HTTP 내부 self-call이나 임의 cookie 주입은 기본안이 아니다. 직접 service 함수를 호출할 때 기존 route의 입력 검증, 제한, 권한 검사, rate limit, 감사 기록을 빠뜨리지 않게 공유 facade로 추출하고 회귀 테스트한다.

## 7. 사용자 문맥·BFF 캐시

PIPE 매 요청은 먼저 기존 JWTAuthentication과 서버 사용자 상태를 확인한다. 캐시에 grant가 있다는 이유로 PIPE 인증을 생략하지 않는다.

cache key의 논리 구성:

```text
upstream/environment + client_id + issuer + stable_subject
+ auth_context_id + profile + protocol_version + active_certificate_fingerprint
```

민감 식별자를 그대로 Redis key/log에 노출하지 않도록 내부 키 표현은 HMAC/해시로 만들 수 있다. 인증 사용자와 응답의 canonical binding·문맥이 맞는지 검증하고 캐시한다. `user_id` 하나만으로 모든 기기·로그인·사용자를 묶지 않는다.

동일 문맥의 동시 첫 요청은 single-flight로 합친다. 여러 Django worker에서도 폭주하지 않도록 distributed lock 또는 동등한 원자 처리를 둔다. lock 소유권을 검증하며 해제하고, lock timeout 후 권한 없이 진행하지 않는다. 다른 사용자의 요청은 이 lock을 공유하지 않는다.

grant 캐시 TTL은 응답 만료보다 짧게 잡는다. 15초 이하 남으면 새 grant를 요청하는 정책을 기본안으로 두되 전체 요청 deadline을 지킨다. canonical identity/version이 바뀌면 기존 검색 context 캐시도 버린다.

PIPE에서 결과·권한을 사용자 공용 캐시로 만들지 않는다. Stage 1 React Query cache는 확인된 search identity/context 변경 시 비우거나 분리한다. `My open PRs`는 `/context`의 GHE login을 쓴다. 일반 `author:` 조건으로 다른 작성자를 찾는 것은 정상 검색 기능이며 사용자 가장과 혼동하지 않는다.

## 8. 오류 계약 — PIPE 로그인을 망가뜨리지 않는다

Integration 오류 envelope:

```json
{
  "error": {
    "code": "IDENTITY_BINDING_REQUIRED",
    "message": "Search identity is not connected.",
    "retryable": false
  },
  "correlation_id": "<uuid>"
}
```

고정 mapping:

| 사건 | Integration HTTP / code | PIPE browser HTTP / code | 동작 |
|---|---|---|---|
| PIPE JWT 없거나 만료 | upstream 호출 없음 | 401 / 기존 PIPE 인증 오류 | 기존 PIPE 재로그인 |
| TLS client 인증 실패 | TLS 실패 또는 401 CLIENT_AUTH_FAILED | 503 SEARCH_AUTH_UNAVAILABLE | 자동 재로그인 없음 |
| assertion 서명/claim 불량 | 401 ASSERTION_INVALID | 503 SEARCH_AUTH_UNAVAILABLE | 설정 오류, 자동 반복 없음 |
| assertion replay | 401 ASSERTION_REPLAYED | 503 SEARCH_AUTH_UNAVAILABLE | 자동 재사용 없음 |
| identity 미연결 | 403 IDENTITY_BINDING_REQUIRED | 403 SEARCH_IDENTITY_REQUIRED | 계정 연결 안내 |
| identity conflict | 409 IDENTITY_BINDING_CONFLICT | 409 SEARCH_IDENTITY_CONFLICT | 운영자 확인 |
| identity disabled | 403 IDENTITY_DISABLED | 403 SEARCH_IDENTITY_DISABLED | 재발급 금지 |
| grant 시간 만료 | 401 GRANT_EXPIRED | 서버에서 1회 재발급; 실패 시 503 SEARCH_AUTH_UNAVAILABLE | 원래 GET 최대 1회 재전송 |
| grant 없거나 변조 | 401 GRANT_INVALID | 503 SEARCH_AUTH_UNAVAILABLE | 자동 재발급하지 않음 |
| grant 회수 | 401 GRANT_REVOKED | 403 SEARCH_CONTEXT_REVOKED | 자동 재발급 금지 |
| 로그인 문맥 회수 | 403 CONTEXT_REVOKED | 403 SEARCH_CONTEXT_REVOKED | 같은 문맥으로 재연결 금지 |
| cert/grant 불일치 | 401 GRANT_BINDING_MISMATCH | 503 SEARCH_AUTH_UNAVAILABLE | 알려진 로컬 cert 교체 시 캐시 폐기 후 새 연결, 무조건 재시도 금지 |
| client/key 비활성 | 403 CLIENT_DISABLED | 503 SEARCH_AUTH_UNAVAILABLE | 운영 복구 필요 |
| scope 확인 불가 | 503 PERMISSION_UNAVAILABLE | 503 PERMISSION_UNAVAILABLE | 결과 대신 오류 |
| 권한 없는 단건/없는 단건 | 원본 404 NOT_FOUND | 동일 404 NOT_FOUND | 존재 정보 추가 노출 금지 |
| 허용되지 않은 operation | 403 OPERATION_NOT_ALLOWED 또는 경로 404 | 같은 의미의 거부 | 다른 API로 fallback 금지 |
| 기능 OFF | 503 INTEGRATION_DISABLED 또는 private route 미등록 | 503 SEARCH_INTEGRATION_DISABLED | fixture 자동 전환 금지 |
| upstream 연결 실패 | 502 또는 transport failure | 502 SEARCH_UPSTREAM_UNAVAILABLE | 수동 재시도 |
| timeout | transport timeout | 504 SEARCH_UPSTREAM_TIMEOUT | 무한 재시도 금지 |
| rate limit | 429 + Retry-After | 동일 429와 안전한 Retry-After | 즉시 재시도 금지 |
| 기존 검색 입력/cursor/source/epoch 오류 | 원본 status/code | 의미 유지 | 기존 UI 처리 |

새 BFF의 401은 PIPE 인증 실패만을 뜻하도록 보장한다. upstream 401을 그대로 기존 전역 interceptor에 전달하지 않는다. 다른 PIPE API의 401 처리 규칙은 이번 작업에서 전역 변경하지 않는다.

권한이 없는 collection 질의는 기존 scope 계약에 따라 0건이 될 수 있다. 권한 서비스 장애를 0건으로 바꾸는 것은 금지다. 원본 응답이 200과 `epoch_stale` 같은 상태를 사용하는 경우 이를 새로운 임의 상태로 재해석하지 않는다.

GET의 자동 재전송은 `GRANT_EXPIRED`에 한해 새 exchange 후 1회다. `403`, `409`, `429`, 서명 오류, 회수 상태는 재발급으로 우회하지 않는다. exchange 응답을 잃어버렸으면 동일 jti를 재전송하지 않는다. 제한된 retry 정책으로 새 assertion을 한 번 만들 수 있고, 수신측은 orphan grant가 최대 300초 내 만료되도록 한다. 일반 transport library의 숨겨진 retry와 합쳐 총 시도 횟수가 늘지 않게 한다.

## 9. 로그아웃·회수·경합

- PIPE의 실제 logout 경로를 확인한다. 서버 logout이 있으면 hook을 재사용한다. localStorage 삭제뿐이라면 기존 logout 동작에서 최소한 `/disconnect`를 시도하고 항상 기존 local logout은 완료한다.
- disconnect는 현재 문맥을 PIPE 측에서 먼저 회수 처리하고 cache generation을 올린 뒤 grant cache를 삭제한다. 다른 기기/로그인의 grant는 지우지 않는다.
- 이 회수 상태는 검증된 로그인 자격 만료까지 유지한다. 단순히 Redis key 하나를 지웠다는 이유로 기존 JWT를 제시했을 때 즉시 새 grant를 발급하지 않는다. 현재 PIPE에 token revocation 기능이 없다면 검색 연동 전용 문맥 회수 저장소를 추가한다. 이것이 PIPE 전체 JWT를 취소하는 기능이라고 주장하지 않는다.
- 그다음 fresh assertion의 `purpose:"revoke_context"`로 `/auth/revoke-context`를 호출한다. profile/sub/auth_context_id는 원 문맥과 일치한다. 이 assertion에도 서명·audience·client·jti 검증을 적용한다. 과거 auth_expires_at는 회수 전용 호출에 한해 허용할 수 있다; grant 발급에는 허용하지 않는다.
- pr-search는 문맥 tombstone을 기록하고 현재 문맥의 모든 grant를 거절한다. 발급과 문맥 회수 경합에서는 회수가 완료된 뒤 grant가 다시 활성화되지 않도록 원자 연산/트랜잭션을 사용한다. 다른 process에서도 성립해야 한다.
- 회수 완료 뒤 늦게 끝난 exchange를 PIPE 캐시에 저장하지 않는다. 요청 시작 시의 local generation과 현재 generation을 비교한다.
- 전송 실패 시 회수를 성공했다고 표시하지 않는다. local 문맥 종료는 유지한다. 등록된 서버 인증과 grant 최대 300초 수명 때문에 생기는 잔여 노출 창을 문서화한다. 기존 재시도/outbox 인프라가 있으면 재사용하되 이번 작업을 거대한 배치 시스템으로 확대하지 않는다.
- 매핑·client/key 비활성화는 전체 사용자가 아니라 해당 binding/client 범위를 정확히 회수한다. 회수된 grant를 만료와 똑같이 처리해 자동 재발급하지 않는다.
- 현재 scope 캐시 TTL 5분과 webhook/version invalidation의 효과는 그대로다. “GHE에서 권한 회수하면 모든 경우 즉시 반영된다”고 보장하지 않는다. 실제 무효화 경로를 시험하고 최대 지연을 결과에 기록한다.

## 10. 데이터 전달·인코딩·자원 예산

조회 성공 DTO는 기존 검색 서비스의 구조를 유지한다. 새 envelope를 씌워 Stage 1 UI를 깨지 않는다. `/context`와 `/auth/*`만 이번 통합 전용 DTO다.

- query 값은 typed schema와 URL builder로 직렬화한다. GET body와 raw HTTP 요청을 넘기는 generic proxy를 만들지 않는다.
- 중복된 단일값 query key는 거절한다. 빈 문자열/null/미지정/0의 원본 의미를 보존한다.
- `%2F`, `%252F`, `..`, encoded dot segment, `?`, `#`, 역슬래시, CR/LF, 잘못된 percent escape를 테스트한다. 정당한 파일 path와 branch의 slash까지 무조건 거절하지 않는다.
- baseURL은 서버 고정 설정이다. `url=...`, `upstream=...`, 사용자 Host/X-Forwarded-Host로 대상을 결정하지 않는다. HTTP redirect는 따라가지 않는다. DNS/egress는 승인한 내부 목적지만 허용한다.
- Browser Authorization/Cookie/identity headers를 그대로 전달하지 않는다. BFF가 새 grant 인증과 correlation ID만 만든다.
- response는 필요한 content-type/cache-control/retry-after/correlation 정보를 allowlist한다. Set-Cookie, 내부 Location, server banner, HTML 로그인 페이지, 원시 exception은 브라우저로 전달하지 않는다.
- 검색/source 데이터는 JSON으로 처리한다. source text를 HTML 실행 가능한 응답으로 바꾸지 않는다.
- 입력 길이·page size·file/diff 크기 제한은 원본에서 추출한다. proxy의 response byte limit은 그 계약을 지원하도록 정하고 초과 시 명시적인 오류/원본 부분 결과를 사용한다. 응답을 조용히 truncate해 성공으로 처리하지 않는다.
- 초기 운영 제안: connect 3초, 전체 BFF deadline 35초, frontend deadline은 그보다 길게 설정. 구체적 auth/search/source budget은 원본과 PIPE 실측 기준으로 동결한다. timeout 값은 제품 계약 제안이지 현재 성능 보장이 아니다.
- 사용자/client별 rate limit, 제한된 HTTP connection pool, source 동시성 제한을 둔다. UI의 여러 파일 요청이 worker를 무제한 점유하지 않도록 한다.
- correlation ID는 BFF가 안전하게 생성하고 가능한 모든 계층으로 전달한다. 기존 서비스가 별도 ID를 만들면 양쪽 ID를 안전하게 연결한다. 하나의 요청에 임의 문자열을 그대로 로그 식별자로 쓰지 않는다.

## 11. 감사·진단·비밀 관리

감사 이벤트에는 actor(client_id), canonical user, operation, 대상 저장소의 안전한 식별, result code, correlation ID, grant_id(비밀 아닌 추적 ID), binding/policy version을 남긴다. 원본 audit recorder를 우회하지 않는다. 일반 운영 로그와 보안 감사의 상세 정도는 기존 정책을 따른다.

raw JWT/assertion/access_token/PIPE JWT/쿠키/private key/인증 헤더는 어느 계층에도 기록하지 않는다. 새 로그에는 PR 본문·파일 코드·검색어 전체를 기본 기록하지 않는다. 기존 감사 정책 변경은 이번 기능의 부수작업으로 하지 않는다. metrics label에 사용자/PR/query를 넣어 무한 cardinality를 만들지 않는다.

키는 참조 경로/secret manager로만 설정하고 예제에는 placeholder를 둔다. 테스트 키는 fixture 전용으로 표시하고 production boot에서 거절한다. TLS verify=False, rejectUnauthorized=false, wildcard CORS, 기본 공용 인증키는 금지한다.

키 교체는 old/new 검증 overlap과 최대 grant 수명을 고려한다. 강제 키 회수는 issued_kid에 연결된 grant도 거절한다. certificate 교체는 새 cert로 exchange를 다시 수행하며 환경별 smoke test를 한다.

## 12. `/context`의 브라우저 계약

성공 예:

```json
{
  "protocol_version": "PSI-1.0",
  "connection": "ready",
  "search_identity": {
    "ghe_login": "fixture-dev-a",
    "context_key": "opaque-noncredential-cache-key"
  },
  "capabilities": ["search:read", "source:read"]
}
```

`context_key`는 React Query cache 경계에 쓸 수 있는 불투명 비자격 식별자다. 이것을 API 인증으로 받지 않는다. grant와 PIPE subject를 브라우저에 싣지 않는다. identity 연결 오류와 서비스 장애는 §8의 HTTP 오류를 사용한다. mock 상태는 UI의 명시적인 개발 fixture 모드에만 존재하며 live API 실패를 ready/mock 성공으로 감추지 않는다.

## 13. 기본 설정과 출시 gate

기본 flag 예시: `PIPE_SEARCH_INTEGRATION_ENABLED=0`(pr-search), `PR_SEARCH_BFF_ENABLED=0`(PIPE). 이름은 각 저장소 명명 규칙에 맞춰 확정하고 함께 기록한다.

운영 활성화 필수 입력:

| 항목 | 책임 |
|---|---|
| 실제 PIPE/pr-search origin 및 private 주소 | 운영 담당 + 두 Claude의 설정 템플릿 |
| TLS 종료 지점, trusted proxy, service cert/CA | 운영/보안 담당 |
| issuer/audience/client_id 및 서명 공개키 | PIPE + pr-search |
| PIPE stable subject와 로그인 문맥 만료 추출 | PIPE 담당 |
| 검증된 identity binding과 canonical user | pr-search 운영 담당 |
| PIPE 통합에 노출할 등록 저장소 allowlist | 서비스 소유자 |
| 기존 scope 무효화와 최대 권한 반영 지연 | pr-search 담당 |
| fixture/live 선택과 UI client interface | PIPE 담당 + Stage 1 산출물 |

필수값이 없는 경우 코딩·로컬 테스트를 중단할 필요는 없지만, 운영 연결은 비활성 상태로 남긴다. 검증 불가 항목은 `NOT_RUN`/`PENDING_OPERATOR_INPUT`으로 보고한다.

출시 순서: 계약 동결 → pr-search 기능 OFF 배포 가능한 변경 → PIPE 기능 OFF 변경 → 테스트 사용자·테스트 저장소 → 실 mTLS/실 GHE 권한 확인 → 제한 활성화. 운영 배포, 실제 key/계정 매핑 등록, commit/push/PR 생성은 별도 명시 지시 없이 수행하지 않는다.

Rollback: 우선 양쪽 flag OFF, 통합 client/grant 회수, UI에 연결 비활성 표시. 기존 pr-search 로그인·검색·PIPE Jobs는 유지된다. additive migration을 즉시 drop해 데이터를 파괴하지 않는다. 회수 tombstone과 감사 기록 보존 기간을 유지한다.

## 14. 계약 동결 및 두 세션 간 전달

pr-search 담당은 구현 전에 기존 query/DTO schema를 실제 코드에서 채워 `pipe-integration-v1.openapi.yaml`, operation map, 오류 fixture, wire example, 계약 checksum을 생성한다. 본 문서의 제안과 차이가 생기면 `CONTRACT_DIFF.md`에 사유·호환성·보안 영향을 적는다. 인증 경계·grant 용도 제한을 약화하는 변경은 사용자 승인 없이 하지 않는다.

PIPE 담당은 그 동결 계약을 읽고 구현한다. 미도착 상태에서는 본 문서로 mock client와 단위 테스트를 만들 수 있으나 실서버 호환 완료라고 보고하지 않는다. contract_version/checksum이 다르면 조용히 추정하지 않고 integration test 실패로 처리한다.

공통 수용 테스트는 `03_SECURITY_AND_CONTRACT_ACCEPTANCE.md`에 있다. 성공 응답만 보이는 화면 데모는 인증·권한 연결 완료 증거가 아니다.
