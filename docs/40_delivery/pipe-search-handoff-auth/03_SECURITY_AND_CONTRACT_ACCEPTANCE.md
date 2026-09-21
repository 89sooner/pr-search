# PIPE ↔ pr-search 공통 보안·계약 수용 테스트

이 파일은 실행할 테스트의 요구사항이다. 아래 항목을 실제로 수행했다는 보고서가 아니다.
기준 계약: `PSI-1.0`. pr-search와 PIPE 담당자는 같은 ID를 테스트 이름 또는 결과 원장에 연결한다.

## 1. 필수 테스트 구성

- canonical user A/B 및 각자 다른 저장소 scope, operator 역할 사용자, 서로 다른 로그인 context를 합성한다.
- clock 주입, 합성 JWT key와 TLS CA/cert, 실제 저장소 표준 Redis/DB test 환경을 사용한다. 테스트 key는 운영 credential이 아니다.
- private endpoint 자체의 authentication과 public/ordinary 경로의 우회 차단을 모두 검증한다.
- 원본 데이터 DTO fixture는 pr-search 코드의 schema에서 추출해 합성하며 회사 PR 본문·source·계정으로 채우지 않는다.
- 회사 CA/GHE/실제 proxy가 없는 환경에서 실행 못 하는 항목은 구현된 테스트와 별개로 `NOT_RUN`을 기록한다.

## 2. 테스트 목록

### A. 서비스 인증·assertion

| ID | 책임 | 시나리오 | 수용 기준 |
|---|---|---|---|
| PSI-A01 | pr-search | 유효한 mTLS/서명/claim | 승인된 client와 active binding에만 최대 300초 grant 발급 |
| PSI-A02 | pr-search | mTLS client cert 없음 | TLS/인증 단계에서 거절; 유효 JWT만으로 통과하지 못함 |
| PSI-A03 | 공동 | 신뢰하지 않는 CA·다른 client cert | 승인 client로 가장할 수 없음; no verify=False fallback |
| PSI-A04 | 공동 | TLS 종료 metadata 위조 | public/header spoof 및 backend port 우회에서 거절 |
| PSI-A05 | pr-search | 서명 불량·alg:none·HS/RS 혼동 | ASSERTION_INVALID; 공개키/HS256 secret 혼용 없음 |
| PSI-A06 | pr-search | 다른 issuer/audience/typ/purpose | 정확한 profile 외 전부 거절; 일반 PIPE JWT 거절 |
| PSI-A07 | pr-search | 알 수 없는 kid 및 token key URL | 등록되지 않은 key 거절; jku/x5u/jwk outbound 0회 |
| PSI-A08 | 공동 | 필수 claim 누락·타입 불량·oversized | 명시적 입력 오류; 저장소/API 호출 전 제한 |
| PSI-A09 | pr-search | TTL>60·exp<=iat·미래 iat·expired | frozen clock 기준 지정 경계대로 거절 |
| PSI-A10 | pr-search | jti 동시 재사용: 두 replica | 한 요청만 발급; 나머지는 ASSERTION_REPLAYED |
| PSI-A11 | pr-search | replay 저장소 장애 | 503; 기존 scope fallback과 달리 신규 발급 fail-open 없음 |
| PSI-A12 | 공동 | dev key/cert/token을 prod에 제시 | 환경이 다른 issuer/client/key/cert 거절 |

### B. Identity binding

| ID | 책임 | 시나리오 | 수용 기준 |
|---|---|---|---|
| PSI-B01 | 공동 | PIPE stable subject의 정상 매핑 | 같은 existing prs_user_id 사용; GHE login은 서버 정본에서 획득 |
| PSI-B02 | PIPE | 브라우저 userId/role/login 위조 | signed sub/context가 바뀌지 않음; body를 authority로 사용하지 않음 |
| PSI-B03 | pr-search | 매핑 없음 | IDENTITY_BINDING_REQUIRED; 가짜 계정/role/empty-success 생성 안 함 |
| PSI-B04 | pr-search | 매핑 disabled/conflict | 403/409 분리; 자동 계정 합치기·재발급 없음 |
| PSI-B05 | pr-search | 같은 login의 개명·재사용 | 숫자 GHE ID/canonical identity 충돌 검출; 이전 사용자 가장 차단 |
| PSI-B06 | pr-search | 동일 숫자 ID의 다른 GHE host | 호스트 문맥 없이 계정 병합하지 않음 |
| PSI-B07 | pr-search | 기존 canonical app_user 없음 | 명시적인 연결/provisioning 필요; 실패를 0건 검색으로 변환하지 않음 |
| PSI-B08 | pr-search | 매핑 변경 중 이전 grant 사용 | 변경 완료 후 판정되는 요청은 binding_version 불일치로 차단 |
| PSI-B09 | pr-search | mapping import dry-run/충돌 | 변경 계획만 출력; 실제 데이터 자동 덮어쓰기 없음 |

### C. Grant·로그인 문맥·회수

| ID | 책임 | 시나리오 | 수용 기준 |
|---|---|---|---|
| PSI-C01 | pr-search | grant raw token 저장 위치 | 서버에는 hash lookup; 일반 SessionStore namespace와 분리 |
| PSI-C02 | 공동 | 수명 상한 | grant expiry<=now+300초 및 auth_exp/cert 만료; 요청 때마다 연장 안 함 |
| PSI-C03 | pr-search | 다른 mTLS cert로 유효 grant 사용 | GRANT_BINDING_MISMATCH; 발급 credential의 sender binding 확인 |
| PSI-C04 | pr-search | grant를 ordinary cookie/Bearer로 사용 | 기존 /api/v1 검색·관리 API에서 인증 실패 |
| PSI-C05 | pr-search | ordinary browser cookie로 Integration 접근 | grant/mTLS를 대체하지 못함 |
| PSI-C06 | 공동 | 서명키/client 긴급 회수 | 기발급 grant도 새 요청에서 사용 불가 |
| PSI-C07 | pr-search | 개별 revoke 반복 | 해당 grant만 종료; 안전한 멱등 응답; 다른 문맥 보존 |
| PSI-C08 | 공동 | context revoke 대 exchange race | 회수 완료 뒤 새 active grant나 늦은 cache write 발생 안 함 |
| PSI-C09 | 공동 | logout 뒤 같은 옛 PIPE JWT | 검색 전용 context tombstone에 의해 재연결 차단 |
| PSI-C10 | 공동 | 다른 기기 로그인 및 refresh | 독립 문맥 유지; 검증된 family 없는 token refresh는 자동 grant 승계 안 함 |

### D. 인가·읽기 전용 경계

| ID | 책임 | 시나리오 | 수용 기준 |
|---|---|---|---|
| PSI-D01 | 공동 | 사용자 A/B 접근 저장소 차이 | 각 사용자 권한에 맞는 결과; client 공용 권한 조회 없음 |
| PSI-D02 | pr-search | operator 사용자의 Integration grant | read allowlist 밖 관리자·감사·workflow·Job·bisect 작업 모두 거절 |
| PSI-D03 | 공동 | 명시되지 않은 GET/POST/HEAD/OPTIONS | 자동 prefix proxy나 HEAD fallback으로 다른 기능이 열리지 않음 |
| PSI-D04 | pr-search | client allowlist와 사용자 권한 교집합 | repo_ids/org_team 모두 조회 전 교집합; q OR로 확장 불가 |
| PSI-D05 | pr-search | count/facet/resolver의 비공개 누출 | 허용 scope 밖 자료가 total/facets/candidates에 나타나지 않음 |
| PSI-D06 | pr-search | source tree/history/file/diff 직접 접근 | scope 확인 전에 GHE의 비공개 소스 조회를 시작하지 않음 |
| PSI-D07 | pr-search | M resolver 권한·epoch 검사 순서 | 권한 밖 저장소의 code/branch/epoch 유무를 오류로 노출하지 않음 |
| PSI-D08 | pr-search | fresh 권한 cache의 정상 사용 | 매 요청 인가, 매 요청 GHE 강제 호출 아님; 현재 cache 계약 유지 |
| PSI-D09 | pr-search | 만료 scope cache + GHE 실패 | 503 PERMISSION_UNAVAILABLE; stale 허용 및 [] 성공 없음 |
| PSI-D10 | pr-search | 권한 invalidation과 late refresh | 기존 DB version fence/Redis 무효화 검증; 최대 반영 지연 기록 |

### E. PIPE BFF·캐시·오류

| ID | 책임 | 시나리오 | 수용 기준 |
|---|---|---|---|
| PSI-E01 | PIPE | PIPE 인증 없음·만료·disabled user | upstream 호출 0회; PIPE 자체 인증만 browser 401 |
| PSI-E02 | PIPE | 사용자·환경·문맥별 grant cache | A/B 또는 다른 로그인·환경·cert 간 grant 섞임 없음 |
| PSI-E03 | PIPE | 20개 동시 첫 검색 | 문맥별 exchange single-flight; 다중 worker에서 폭주 제한 |
| PSI-E04 | PIPE | GRANT_EXPIRED | 재exchange와 원래 GET 재전송 각각 최대 1회; 서버의 짧은 만료 메타데이터 보존으로 EXPIRED/INVALID 구분 |
| PSI-E05 | PIPE | GRANT_REVOKED/CONTEXT_REVOKED/403 | 자동 재발급 0회; 회수 상태를 만료로 변환하지 않음 |
| PSI-E06 | 공동 | exchange 응답 유실 | 같은 jti 재사용 없음; 허용된 새 assertion 1회/총 deadline 이내 |
| PSI-E07 | PIPE | upstream 401과 기존 Axios interceptor | 검색 인증 오류는 503/403로 구분; PIPE 전체 login redirect 없음 |
| PSI-E08 | PIPE | scope 503·429·timeout | 빈 결과/fixture 성공으로 위장 안 함; Retry-After/deadline 준수 |
| PSI-E09 | PIPE | 새 identity context로 UI 이동 | 이전 사용자의 결과/캐시가 placeholder로 노출되지 않음 |

### F. DTO·경로·cursor

| ID | 책임 | 시나리오 | 수용 기준 |
|---|---|---|---|
| PSI-F01 | 공동 | 모든 10개 데이터 operation parity | 원본 정상 응답의 field/null/부분 상태·조회 의미 유지 |
| PSI-F02 | 공동 | M resolver 포함 여부 | PR/SHA resolver로 대체하지 않고 실제 M API 연결 |
| PSI-F03 | 공동 | owner/repo와 정상 branch/file slash | HAProxy/Django/pr-search를 지나 논리값이 한 번만 decode됨 |
| PSI-F04 | 공동 | double encoding·dot segment·CRLF·잘못된 escape | operation/host 우회 및 header injection 거절 |
| PSI-F05 | 공동 | 중복 single-value query key | 양쪽 parser가 다른 값을 선택하지 않음; 명시적 거절 |
| PSI-F06 | pr-search | cursor scope/client policy 변경 | 새 권한보다 넓은 데이터에 접근 불가; 자동 첫 페이지 합침 없음 |
| PSI-F07 | 공동 | upstream 30x/HTML/Set-Cookie | redirect 따라가지 않음; 로그인 HTML/쿠키를 browser에 전달하지 않음 |
| PSI-F08 | 공동 | source partial/changed·epoch stale | 원본 200 상태 또는 명시 오류 의미 유지; 무단 재해석 없음 |

### G. 운영·비밀·출시

| ID | 책임 | 시나리오 | 수용 기준 |
|---|---|---|---|
| PSI-G01 | 공동 | public ingress/Next proxy에서 private 접근 | internal 경로 이름뿐 아니라 실제 연결·인증으로 거절 |
| PSI-G02 | 공동 | fixed host·egress allowlist | 사용자 url/Host query로 다른 서버 호출 불가 |
| PSI-G03 | 공동 | 로그/APM/redaction | PIPE JWT/assertion/grant/private key/Cookie가 결과·로그에 없음 |
| PSI-G04 | 공동 | 감사 연결 | service actor/canonical user/operation/correlation 안전하게 추적 |
| PSI-G05 | 공동 | key/cert 정상 rotation | 새 인증으로 재연결; 이전 key/cert 처리와 유예 창 확인 |
| PSI-G06 | 공동 | 운영 flag ON 필수 설정 누락 | startup/활성화 차단; test key/auth-disabled fallback 없음 |
| PSI-G07 | 공동 | rollback flags OFF | 통합만 중단; 기존 pr-search 로그인/Search와 PIPE Job API 유지 |
| PSI-G08 | 공동 | 단계별 실검증 보고 | 코드/local/mTLS/실 GHE 검증 구분; 미실행은 NOT_RUN |

## 3. 결과 기록 형식

각 담당자는 아래 형태의 `TEST_RESULTS.md`를 생성한다. 테스트 이름만 나열하지 말고 실제 실행·검증 증거를 연결한다.

```text
Contract version / checksum:
Repo / baseline HEAD / implementation HEAD:
Toolchain / environment:
Commands actually run:

Acceptance ID | test path/name | result(PASS/FAIL/NOT_RUN) | evidence | limitation
```

회사 환경 검증을 하지 않았으면 “mTLS 지원 코드를 구현했다”와 “회사 proxy를 거쳐 mTLS를 검증했다”를 구분한다. 이전 baseline 실패를 이번 변경 성공으로 덮지 않는다.

## 4. 출시 차단 항목

인증 우회, scope 누출, operator 쓰기 접근, replay fail-open, 회수 후 재활성화, private 경로의 public 노출, credential 노출 중 하나라도 재현되면 활성화하지 않는다. 정상 화면이나 성공 검색만으로 수용하지 않는다.

정상 권한 캐시가 유효한 동안의 GHE 반영 지연은 현재 계약에 맞게 계측한다. 미해결 보안 결함과 의도된 bounded cache freshness를 혼동하지 않는다.

예정 수용 시나리오 수: 66개. 실행 결과가 아니라 작성된 검증 항목 수다.
