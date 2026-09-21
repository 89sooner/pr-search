# pr-search 담당 Claude — PIPE 인증 수신·검색 API 연결 구현 지시서

## 실행할 작업

너는 `pr-search` 저장소에 연결된 구현 담당이다. PIPE의 별도 서버가 사용자 신원을 위임하여 기존 Search 조회 기능을 사용할 수 있도록 수신부를 구현하라. 이번에는 조사 문서만 쓰고 끝내지 않는다. 계약을 확인·동결한 후 코드, 마이그레이션, 테스트, 배포 설정 예시와 PIPE 담당자용 인수인계 자료를 작성하라.

필수 입력은 이 문서, `00_SHARED_INTEGRATION_CONTRACT.md`, `03_SECURITY_AND_CONTRACT_ACCEPTANCE.md`다. `05_SOURCE_EVIDENCE.md`는 조사 출발점이다. 이전 대화나 PIPE 저장소 접근 권한이 있다고 가정하지 마라. Stage 1 Search UI 포팅 인수인계가 실제로 있으면 그 데이터 계약도 확인하라.

현재 사용자 요청은 작업 지시서의 구현 범위만 허용한다. commit/push/PR 생성, 운영 배포, 실제 사용자 매핑 등록, 인증서 발급·회수는 추가 명시 지시 없이는 하지 않는다. 테스트용 키와 계정만 사용한다.

## 1. 목표와 변경 금지 범위

목표 흐름:

```text
PIPE Django
  → private mTLS + signed user assertion
  → pr-search /internal/integrations/pipe/v1/auth/exchange
  ← 서버 전용 opaque 검색 grant
  → /internal/integrations/pipe/v1/read/<고정 operation>
  → canonical user 권한 + PIPE 허용 범위
  → 기존 검색/source/M 번호 서비스
```

반드시 유지한다:

- 현재 pr-search 웹과 Search 화면, 기존 `/api/v1/*` HTTP 계약, 일반 로그인 쿠키 방식.
- 기존 데이터 수집·indexing·M 번호/sequence 의미·source diff/history 판정.
- 기존 search/source/resolve/repository/mnumber의 입력 검증·권한·cursor·rate limit·감사 처리.
- PIPE의 역할이나 브라우저 헤더를 기존 인증의 우회 경로로 사용하지 않는 원칙.

추가하지 않는다: PIPE 화면, App Shell, MDVP/bisect/job/workflow 실행, 관리자 조회 프록시, 검색 결과의 PIPE 동기화, 공용 서비스 사용자, 원본 로그인 쿠키를 PIPE에 전달하는 경로.

이번 계약에서 `grant`는 일반 `prs_session`과 다른 자격이다. `authenticateSession`에 “PIPE 헤더도 받아준다”는 분기를 넣지 마라. ordinary endpoint가 grant를 받지 않는 negative test를 유지하라.

## 2. 착수 전 실제 저장소 확인

1. 적용되는 AGENTS.md/CLAUDE.md/기타 저장소 지침, git status, HEAD, 작업 브랜치를 기록한다. 공유 checkout의 미커밋 변경을 reset/clean/stash/checkout으로 덮지 않는다.
2. 이 지시서 사전 조사 HEAD는 `5f0d7e0e5f2a0f492d56ffb0c39ddd7a618f42a6`다. 실제 구현 HEAD가 다르면 인증/권한/route/계약 차이를 확인하고 기준선을 기록한다.
3. 저장소의 CR/ADR/작업 패키지 규칙을 따른다. 과거 번호를 재사용하거나 임의로 완료 상태를 만들지 않는다. 관련 문서 등록은 이 작업의 보안 경계 추가로 한정한다.
4. 아래 파일·심벌에서 시작하되 실제 import/call chain을 확인한다.

| 조사 시작점 | 확인할 내용 |
|---|---|
| `apps/search-api/src/auth/principal.ts` | ordinary session 인증과 관리용 token 예외의 실제 경계 |
| `apps/search-api/src/auth/context.ts` | session/scope 조립, 의존성/배포 조건 |
| `apps/search-api/src/auth/registration.ts` | canonical user 등록과 요청별 DB 역할 합성 |
| `packages/authz/src/session.ts`, `session-store.ts` | 쿠키/세션 namespace, 수명, 삭제·검증 |
| `packages/authz/src/scope.ts`, `scope-source.ts` | 5분 권한 캐시·실제 fallback·version fence·GHE 실효권한 |
| `apps/search-api/src/source/routes.ts`, `service.ts` | source 접근 확인→GHE 조회 순서, 검증, 감사 |
| `apps/search-api/src/resolve/routes.ts` | 식별자·PR/commit 상세 권한 및 오류 |
| `apps/search-api/src/repositories/routes.ts` | repository scope·빈 페이지·cursor fingerprint |
| `apps/search-api/src/sequence/merge-numbers.ts` | M resolver 검증 순서·snapshot·epoch |
| 실제 검색 route/service/schema | mandatory filter·total/facet·cursor·감사 |
| `apps/web/lib/proxy.ts`, `app/api/[...path]/route.ts` | public proxy가 새 private 기능을 노출하지 않는지 |
| 실제 server bootstrap/config/infra | plugin 등록 경계, TLS/ingress, auth-disabled 개발 모드 |
| `apps/search-api/integration/authz/` 및 관련 테스트 | 기존 fail-closed/권한 위조 차단/무효화 불변식 |

파일이 없으면 실제 위치를 찾아 보고하라. 아직 읽지 않은 파일이 존재한다고 보고하지 마라. private gateway route가 이미 있을 수도 있으므로 먼저 찾아 중복 구현하지 않는다.

## 3. 먼저 동결할 계약

`00_SHARED_INTEGRATION_CONTRACT.md`의 PSI-1.0을 기준으로 다음을 확정하라.

- private prefix, endpoint method, assertion schema와 profile, opaque grant 응답, error mapping.
- 기존 10개 조회 operation의 exact query/response schema. repositories/search/resolve/M-resolve/PR 상세/commit 상세/source 4종이다.
- `repository=owner/repo` 인코딩, 단일 query의 중복 거절, Source path/ref의 유효값, size/page 상한, nullable/partial/epoch 상태.
- 사용자별 cursor와 통합 client 정책 교집합이 cursor fingerprint에 미치는 영향.
- scope revocation 최대 지연, binding/client/grant의 회수 시점, audit correlation 흐름.

필수 산출물은 `pipe-integration-v1.openapi.yaml`, machine-readable operation map, 정상/오류 JSON example, contract version/checksum이다. 내부 경로와 기존 원본 경로를 구분해서 적어라.

OpenAPI는 검증 도구로 파싱하고 실제 route/schema와 계약 테스트를 연결하라. 아직 필요한 source DTO를 모르는데 `{}`나 `any`로 덮어 “계약 완료”라고 하지 마라. 알 수 없는 데이터는 source의 참조 schema를 추출해서 포함한다.

사소한 path/config 명명 차이는 문서에 반영할 수 있다. 사용자 매핑 검증 생략, 일반 로그인 쿠키 전용 경계 파괴, 공용 사용자 조회, private route 공개, grant를 broader token으로 교체하는 변경은 승인 없이 하지 마라. 사내 표준 위임 서버가 확인되면 적합성과 변경점을 ADR로 제시하고, 한쪽 저장소만 프로토콜을 바꾸지 마라.

## 4. 권장 모듈 분리

아래는 제안 위치다. 실제 구조에 맞춰 이름을 바꾸되 책임은 유지한다.

```text
apps/search-api/src/integrations/pipe/
  config.ts                 기본 OFF, issuer/client/key/cert/profile 검증
  routes.ts                 auth/context/read의 고정 route 등록
  transport-auth.ts         신뢰된 mTLS 정보→service client
  assertion.ts              JOSE signature/claims/purpose 검증
  replay-store.ts           분산·원자 jti 소비
  identity-binding.ts       승인 매핑→기존 canonical user
  grant-store.ts            별도 opaque grant/hash/expiry/context 회수
  read-context.ts           서버 내부 제한 principal/context
  read-dispatch.ts          고정 operation→공유 조회 facade
  errors.ts                 PSI-1.0 오류
  audit.ts                  actor+subject+correlation 안전한 기록
  *.test.ts

packages/db 또는 실제 DB 모듈
  additive binding/revocation migration 및 typed repository

apps/search-api/integration/integrations/pipe/
  auth, grants, identities, readonly, search-parity, source-parity tests
```

새 Gateway를 독립 서비스로 배포해야만 한다고 가정하지 마라. 기존 search-api에 격리 plugin/private listener로 구현할 수 있으면 그것을 우선 검토한다. 새 운영 프로세스를 추가하는 경우 필요성과 TLS·DB·Redis 접근 범위 증가를 ADR로 기록한다.

## 5. 서비스 인증 구현

공통 계약 §5 그대로 구현한다. RS256 허용 알고리즘 고정, distinct typ, 정확한 issuer/audience/client, purpose, auth context, TTL·skew·jti를 검증한다. 키 선택은 등록된 registry로 한정한다. JWT 자체의 key URL은 사용하지 않는다.

mTLS client 인증은 실제 TLS 상태에서 얻어야 한다. proxy가 종료한 경우 app이 신뢰하는 transport만 전달하도록 하고 외부 같은 이름의 헤더를 제거한다. middleware에서 header 문자열만 검사하는 mock을 production 검증으로 올리지 마라.

기능 ON인데 신뢰할 key/client/transport 정책이 없으면 startup 또는 활성화를 실패시킨다. 기존 AUTH_ENABLED=false 개발 설정으로 신규 Integration이 자동 허용되지 않도록 한다. 테스트 우회는 production build/config에 접근할 수 없는 test fixture factory에 격리한다.

서명 검증 전에 jti를 무조건 저장해 공격자가 저장소를 채우게 하지 마라. 크기 제한→signature/claim 검증→원자 replay 소비 순서를 적용한다. 두 replica 동시 소비에서 하나만 성공해야 한다. replay 저장소 장애는 503이다.

## 6. Identity binding 구현

1차 운영 정책은 승인된 `(PIPE issuer, stable subject) → existing prs_user_id`다. canonical user가 없거나 GHE 숫자 ID가 검증되지 않으면 연결을 차단한다. 가짜 OIDC sub나 PIPE user_id를 pr-search user_id로 그대로 채우지 않는다.

현재 app_user unique constraints와 실제 GHE/OIDC subject 구성을 조사하라. `RegisteringSessionStore`가 수행하던 canonical registration을 우회하면 첫 조회가 실패할 수 있다는 사실을 반영하라. 이번 통합은 기존 사용자를 연결하는 방식이 기본이므로, 신규 사용자 provisioning은 별도 승인된 경로 없이 자동 수행하지 않는다.

mapping import/disable은 기존 운영 절차에 맞는 CLI 또는 관리 기능으로 제한한다. dry-run, 중복·역방향 충돌, immutable GHE ID 대조, verified_by/reference, 변경 감사, binding_version 증가를 포함하라. 검색 grant로 mapping을 변경하는 HTTP endpoint는 만들지 마라.

identity mapping은 identity이고 repo allowlist는 서비스 범위다. 사내 username 문자열 규칙을 권한 근거로 사용하지 않는다. login rename/재사용과 매핑 충돌을 fixture로 시험한다.

## 7. opaque grant와 회수 구현

일반 SessionStore namespace에 세션을 쓰지 않는다. 새 grant store에 token digest를 키로 저장한다. raw token은 발급 응답 외에 서버 로그·DB 평문으로 남기지 않는다.

필수 binding: client_id, issuer/subject, canonical user, auth_context_id, certificate fingerprint, issued_kid, profile, binding/policy version, expires_at. 인증 유효기간 상한 300초와 원 PIPE 인증 만료를 동시에 적용한다. EXPIRED/INVALID를 구분할 짧은 만료 메타데이터 보존과 인증 유효기간은 분리한다. 현재 일반 세션의 8시간/12시간 값을 여기에 쓰지 마라.

매 조회에서 client/key/cert 상태, grant 만료/회수, context 회수, binding active/version을 확인한다. certificate fingerprint가 다른 client가 토큰을 가져도 사용할 수 없어야 한다. issuer/client/signing key가 회수되면 기존 grant도 살아 있지 않아야 한다.

`revoke`는 자기 client의 해당 grant에 한정한다. 반복·미존재 호출은 불필요한 token 존재 정보를 내보내지 않는다. `revoke-context`는 fresh signed assertion의 주체와 문맥을 확인하고 해당 문맥만 회수한다. 발급과 회수 경합을 다른 process/worker에서도 시험한다.

Context tombstone과 binding state는 grant store 장애나 재시작에서 어떻게 유지되는지 명시하라. Redis에 tombstone을 둔다면 persistence·복구와 authorization horizon을 검토하고, 휘발/복구가 옛 login context를 재활성화하지 않도록 DB 등 적절한 정본을 사용하라. 회수 중 장애는 새로운 grant를 허용하는 이유가 아니다.

## 8. 조회 기능 재사용 — 가장 중요한 구현 경계

새 인증 진입을 만들었어도 실제 검색 권한은 기존 로직으로 판정한다. opaque grant에 repository 목록을 넣고 5분간 그 목록만 믿는 새 권한 엔진을 만들지 마라.

권장 방식:

```text
기존 HTTP route
  기존 authenticateSession
    → 기존 입력/권한/서비스 facade

신규 Integration route
  verifyMtls + verifyGrant + canonicalIdentity
    → 제한된 read context
    → 같은 입력/권한/서비스 facade
```

shared facade를 추출한다면 기존 route가 쓰는 scope resolver와 mandatory filters, validator, source repository visibility check, M snapshot/epoch validation, cursor binding, rate limit, error mapping, audit recorder를 포함한다. “service 함수만 호출했다”는 이유로 route에 있던 보안 처리가 빠지지 않게 parity test를 둔다.

기존 역할 요구가 있으면 서버에서 canonical user와 앱 정책으로 계산한다. PIPE assertion에는 role을 받지 않는다. 실제 operator 역할이 있더라도 Integration profile은 조회 allowlist만 허용해야 한다. 권한을 `developer` 하나로 바꿔 안전하다고 선언하지 않는다.

`IntegrationReadContext`는 public DTO가 아니다. 네트워크 JSON을 해당 타입으로 cast해서 인증된 주체로 쓰지 않는다. 기존 세션을 흉내 내는 가짜 SessionRecord나 `.as any`로 authenticator를 우회하지 않는다.

권한 scope와 client repository allowlist를 데이터 조회 전에 교집합으로 강제한다. 기존 repo_ids/org_team 표현, empty scope, count/facet, PR/SHA resolver, M 번호, source 조회에 모두 성립해야 한다. 설정은 client가 접근할 등록 repo ID를 명시하며 기본 빈 목록은 거부다. 사용자 q에 OR가 있거나 브랜치/번호를 조작해도 client 범위를 넓히지 못해야 한다.

다음 방식은 금지한다:

- 운영 admin credential로 원본 API 전체 조회 후 PIPE에서 filtering.
- Integration route를 path 문자열로 일반 route에 자유롭게 전달하는 catch-all proxy.
- 브라우저 쿠키 또는 raw grant를 기존 웹의 /api proxy에 전달해 넓은 API를 호출.
- 새로운 route마다 권한 계산을 조금씩 복제해 서로 다른 결과를 만드는 방식.

## 9. protocol/data parity

원본 query builder를 서버에서 다시 발명하지 않는다. BFF가 보낸 q·sort·cursor 등의 의미는 원본과 같아야 한다. Search 50개 단위 조회, total.relation, facets, M pending/disabled, source partial/truncated, history PR unavailable, SOURCE_CHANGED, epoch stale 상태를 보존하라.

M resolver도 이 연결에 포함한다. 경로는 실제 `/api/v1/merge-numbers/resolve`에서 확인되며 그 권한→snapshot 검증 순서를 유지한다. 단순 PR/SHA resolver로 대체하지 않는다.

새 cursor는 canonical user, 실제 effective scope/client 제한 및 검색 조건에 맞게 검증되어야 한다. 기존 cursor 구현의 의미를 먼저 조사한다. 두 사용자가 우연히 동일 scope일 때 어떤 재사용을 허용하는지도 기존 계약과 통합 위험을 기준으로 명시한다. 최소한 scope/policy 변경 후 이전 cursor가 더 넓은 데이터를 읽는 것은 막는다. client 정책 fingerprint를 추가해야 하면 기존 public cursor를 깨지 않는 additive 전략을 사용한다.

## 10. 에러·리소스·로그

PSI-1.0 status/code를 실제 exception mapping과 연결한다. signature 오류/expired grant/revoked grant/identity 미매핑/scope 장애를 구분한다. pr-search 일반 endpoint의 401/503 의미는 바꾸지 않는다.

raw upstream error, token, Cookie, assertion body를 로깅하지 않는다. 기존 audit user_id에 canonical user를 유지하고 service actor를 추가로 식별하라. 회수/발급/거부 이벤트는 query 결과 없이 추적 가능해야 한다. high-cardinality metric label을 피한다.

검색/source 크기와 timeout/rate 제한을 계약에 적는다. HTTP transport에서 30x를 따라가거나 Set-Cookie를 넘기지 마라. 실패 시 null/[]/mock을 성공 응답으로 내지 않는다.

## 11. 검증 절차

저장소의 실제 test/lint/typecheck/build 명령을 확인하고 실행한다. 없는 명령을 실행했다고 보고하지 않는다. baseline 실패와 이번 변경으로 생긴 실패를 분리한다.

특히 아래 검증을 구현하라:

- 서명·aud·typ·key·mTLS·replay와 clock 경계 단위 테스트.
- 진짜 Redis/DB 또는 저장소 표준 통합 환경에서 발급/회수/version/single-flight 경합 테스트.
- 사용자 A/B, 같은 사용자 두 로그인 문맥, operator 사용자, 같은 숫자 ID가 있는 다른 GHE host 사례.
- 원본 route와 Integration route의 허용 데이터·오류 의미 parity; 자료 접근 밖 단건의 404와 collection empty 처리.
- 일반 `/api/v1/*`가 grant와 PIPE JWT를 여전히 거절함; 신규 private endpoint가 ordinary browser cookie를 거절함.
- public proxy/ingress를 통한 우회 차단; TLS 종료 metadata 위조 차단.
- GHE 권한 회수·기존 version fence·5분 TTL behavior를 fake clock과 실제 invalidation path로 검증.
- 기능 OFF와 rollback에서 기존 웹/검색/Jobs 관련 외부 계약 회귀 없음.

단위 mock으로 TLS 검증을 통과시킨 결과를 실제 mTLS 검증이라고 쓰지 않는다. 실 GHE·회사 CA·운영 HAProxy가 없으면 해당 smoke 항목을 NOT_RUN으로 남긴다.

## 12. PIPE 담당 Claude에게 넘길 산출물

권장 출력 디렉터리: `handoff/pipe-search-integration/v1/` 또는 저장소 지침이 허용한 위치.

1. `PIPE_INTEGRATION_HANDOFF.md`: 구현 HEAD, 신규 path, flag, config, 실제 변경, 남은 운영 입력.
2. `pipe-integration-v1.openapi.yaml`: auth/context/read/error의 실제 schema.
3. `operation-map.json`: 각 신규 path ↔ 원본 서비스, method, query, 제한, scope 요구.
4. `examples/`: 정상·미매핑·권한 없음·scope 장애·grant 만료·회수·source 부분 결과의 합성 JSON.
5. `conformance/`: frozen clock JWT payload·공개 테스트키 또는 안전한 생성 절차·기대 오류. 테스트 private key는 운영에서 절대 쓰지 않게 표시하고 공개 배포 여부는 repo 지침을 따른다.
6. `DEPLOYMENT_AND_ROLLBACK.md`: private listener/ingress/mTLS/trusted proxy, 키 교체, 회수, flags.
7. `CONTRACT_DIFF.md`: 제안 PSI-1.0과 최종 구현 차이, 없는 기능/확인 불가 항목.
8. `TEST_RESULTS.md`: 실제 실행 명령·결과·baseline·NOT_RUN, acceptance ID별 증거.
9. `manifest.json`: protocol version, baseline/implementation HEAD, 파일 checksum, fixture-only 여부.

완료 보고는 다음 순서로 한다: 구현된 경로 → 기존 behavior 불변 증거 → 검증 결과 → PIPE에 넘길 파일 → 운영 활성화에 필요한 실제 입력. “인증 구현 완료”와 “사내 두 서버 end-to-end 검증 완료”를 구분한다. handoff를 읽는 PIPE 세션이 이 저장소를 볼 수 없다고 가정하여 query/DTO와 오류 설명을 생략하지 마라.
