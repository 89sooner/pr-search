# PIPE_INTEGRATION_HANDOFF — pr-search PIPE 연동 수신부 (PSI-1.0)

> 분류: 인수인계 자료(PIPE 담당 세션용). 이 세션은 pr-search 저장소를 볼 수 없다고 가정하고 썼습니다. 구현은 pr-search CR-112 / WP-097 / ADR-025 / `FR-INT-001`입니다. **기본 꺼짐이며 운영에 켜지 않았습니다.**

## 0. 읽는 순서

| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | 이 문서 | 상태, 경로, 자격, 요청·응답 규칙, 설정, 운영 입력 |
| 2 | `pipe-integration-v1.openapi.yaml` | **정본 계약.** 경로 14개, 파라미터, 성공·오류 스키마 전부 |
| 3 | `operation-map.json` | **정본 계약.** operation ↔ 원본 조회, query key, 상한, 연동 오류 코드 |
| 4 | `CONTRACT_DIFF.md` | 제안 계약 PSI-1.0과 다른 자리 20개(D-01~D-20)와 확인하지 못한 것 |
| 5 | `conformance/README.md`, `conformance/vectors.json` | assertion 서명기 대조용 벡터 22개와 시험 공개키(비밀키는 공개 저장소라 넣지 않음) |
| 6 | `examples/README.md`, `examples/*.json` | wire 예시 24개(정상·미매핑·권한 없음·범위 장애·만료·회수·부분 결과) |
| 7 | `DEPLOYMENT_AND_ROLLBACK.md`, `deploy-examples/` | pr-search 쪽 배포·키 교체·긴급 회수·binding 운영·롤백 |
| 8 | `TEST_RESULTS.md` | 실제로 실행한 명령과 수용 시험 ID별 결과, NOT_RUN |
| 9 | `manifest.json` | 파일별 SHA-256과 계약 checksum |
| – | `tools/` | OpenAPI 3.1 공식 스키마 사본과 manifest 생성기 |

OpenAPI·operation map과 이 문서가 어긋나면 **OpenAPI·operation map이 이깁니다.** 두 파일은 pr-search의 계약 시험이 코드와 대조하고, 통합 시험이 실제 응답을 OpenAPI 스키마로 검증합니다.

## 1. 상태와 기준

- 저장소 `89sooner/pr-search`, 기준 커밋 `52cf27f191abca4622bb4c8d408111b1efe538de`, 브랜치 `feature/pipe-integration-auth`. **미커밋 작업 트리입니다** — commit·push·PR은 사용자 지시 전입니다. 커밋되면 그 SHA를 여기에 적습니다.
- 계약 판 `PSI-1.0`. 계약 checksum은 `manifest.json`의 `contract_checksum`이며, OpenAPI와 operation map을 **그 순서로 이어 붙인 LF 바이트의 SHA-256**입니다. PIPE 쪽 계약 시험은 두 파일로 이 값을 다시 계산해 다르면 실패해야 합니다(공통 계약 14장).

| 단계 | 상태 |
|---|---|
| 1. 코드·마이그레이션·계약 구현 | 완료 (로컬) |
| 2. mock·로컬 DB·Redis 계약·보안 시험 | 완료 — 127.0.0.1의 **실제 TLS 핸드셰이크**와 PostgreSQL·Redis·Elasticsearch로 통합 시험 |
| 3. 실제 TLS 종료 경로(사내 CA·HAProxy)와 두 서버 간 mTLS 검증 | **NOT_RUN** |
| 4. 실제 사용자·GHE 권한·회수·화면 end-to-end | **NOT_RUN** |

"인증 수신부 구현 완료"이지 "사내 두 서버 end-to-end 검증 완료"가 아닙니다.

## 2. 경로

접두 `/internal/integrations/pipe/v1`. pr-search search-api 프로세스의 **private 리스너**(별도 포트, mTLS 필수)에만 있습니다. 공개 리스너·pr-search 웹의 `/api/*` 프록시에는 없습니다.

| operation | Method·경로 (접두 뒤) | 자격 | 실행하는 원본 | 성공 본문 |
|---|---|---|---|---|
| `auth.exchange` | `POST /auth/exchange` | mTLS + 본문 assertion(`purpose: grant`) | – | `ExchangeResponse` |
| `auth.revoke` | `POST /auth/revoke` | mTLS + Bearer grant | – | `RevokeResponse` |
| `auth.revoke_context` | `POST /auth/revoke-context` | mTLS + 본문 assertion(`purpose: revoke_context`) | – | `RevokeContextResponse` |
| `context` | `GET /context` | mTLS + grant | – | `IntegrationContextResponse` |
| `read.repositories` | `GET /read/repositories` | mTLS + grant | `GET /api/v1/repositories` | `RepositoryListResponse` |
| `read.search` | `GET /read/search` | mTLS + grant | `GET /api/v1/search` | `SearchResponseBody` (정상 또는 epoch_stale) |
| `read.resolve` | `GET /read/resolve` | mTLS + grant | `GET /api/v1/resolve` | `ResolveResponse` |
| `read.merge_numbers.resolve` | `GET /read/merge-numbers/resolve` | mTLS + grant | `GET /api/v1/merge-numbers/resolve` | `MergeNumberResolveResponse` |
| `read.pull_request` | `GET /read/pull-requests/{repository}/{pr_number}` | mTLS + grant | `GET /api/v1/pull-requests/…` | `PullRequestDetailResponse` |
| `read.commit` | `GET /read/commits/{repository}/{commit_sha}` | mTLS + grant | `GET /api/v1/commits/…` | `CommitDetailResponse` |
| `read.source.tree` | `GET /read/source/{repository}/tree` | mTLS + grant | `GET /api/v1/source/…/tree` | `SourceTree` |
| `read.source.history` | `GET /read/source/{repository}/history` | mTLS + grant | `GET /api/v1/source/…/history` | `SourceHistory` |
| `read.source.diff` | `GET /read/source/{repository}/diff` | mTLS + grant | `GET /api/v1/source/…/diff` | `SourceComparison` |
| `read.source.file` | `GET /read/source/{repository}/file` | mTLS + grant | `GET /api/v1/source/…/file` | `SourceFile` |

조회(`read.*`)는 원본 `/api/v1/*`의 **실행 코드를 그대로** 부릅니다. 성공 본문과 원본 조회의 오류 본문은 원본과 같은 모양·상태입니다(예외 하나: CONTRACT_DIFF D-20). Stage 1 Search UI가 원본 DTO로 만든 어댑터를 그대로 쓸 수 있습니다.

M 번호 기능이 꺼진 pr-search 배포에서는 `capabilities`에 `merge_number:read`가 없고 `/context`의 `operations`에서 `read.merge_numbers.resolve`가 빠지며, 그 경로를 부르면 원본처럼 404 `NOT_FOUND`(`detail.reason = feature_disabled`)입니다(D-07). 화면은 `capabilities`로 M 번호 기능의 표시를 정하십시오.

## 3. 자격 — PIPE가 구현할 것

### 3.1 mTLS

- pr-search private 리스너가 **직접 TLS를 끝냅니다.** 사이에 HAProxy를 둔다면 L4 passthrough(`mode tcp`)여야 합니다. `X-SSL-Client-*` 같은 전달 헤더는 읽지 않습니다(D-02).
- client 인증서는 pr-search 정책에 등록된 것만 인정합니다 — subjectAltName 정확 일치(`URI:…`·`DNS:…`) 또는 leaf DER의 SHA-256 지문. 인증서가 없거나 신뢰 CA가 발급하지 않았으면 HTTP 응답 없이 핸드셰이크가 실패하고, 신뢰 CA가 발급했지만 등록되지 않은 인증서는 401 `CLIENT_AUTH_FAILED`입니다.
- grant는 발급에 쓴 인증서의 지문에 묶입니다. 인증서를 바꾸면 grant 캐시를 버리고 새로 발급받습니다(옛 grant는 401 `GRANT_BINDING_MISMATCH`).

### 3.2 사용자 assertion

RS256 compact JWS입니다. 서명·X.509를 직접 구현하지 말고 검증된 JOSE 라이브러리를 쓰십시오.

```json
{"alg":"RS256","typ":"pipe-user-assertion+jwt","kid":"<등록한 kid>"}
```

```json
{
  "iss": "<등록한 issuer>",
  "aud": "<등록한 audience — 문자열 하나>",
  "sub": "<PIPE의 불변 사용자 ID>",
  "client_id": "<등록한 client_id — mTLS client와 같아야 한다>",
  "purpose": "grant",
  "profile": "search-read-v1",
  "auth_context_id": "<서버가 만든 비밀 아닌 로그인 문맥 ID>",
  "auth_expires_at": 2000003600,
  "iat": 2000000000,
  "nbf": 2000000000,
  "exp": 2000000060,
  "jti": "<128비트 이상 난수의 base64url>"
}
```

- 헤더는 `alg`·`typ`·`kid` **셋만**입니다. `jku`·`x5u`·`jwk`·`x5c`·`crit`·`b64`가 있으면 거절합니다. `typ`은 정확히 위 문자열입니다.
- claim 12개가 모두 필수이고 **그 밖의 claim은 거절합니다** — `roles`·`repositories`·`ghe_login` 같은 주장을 싣지 마십시오.
- 형식: `sub` 가시 ASCII 1~256자, `auth_context_id` `[A-Za-z0-9._~:-]{8,256}`, `jti` `[A-Za-z0-9_-]{22,128}`, 시각은 양의 정수 초. `exp - iat`는 60초 이하, 미래 `iat`는 5초까지, 만료 뒤 허용 오차 5초. 압축 JWS 8192자 이하, 요청 본문 16KiB 이하(JSON만).
- 발급(`purpose: grant`)은 `auth_expires_at`이 미래여야 합니다. 문맥 회수(`purpose: revoke_context`)는 지난 값도 받습니다.
- `jti`는 서명·claim 검증을 통과한 뒤 pr-search가 한 번 소비합니다. 같은 assertion을 다시 보내면 401 `ASSERTION_REPLAYED`입니다. **exchange 응답을 잃어버렸으면 같은 jti를 다시 보내지 말고** 새 assertion을 만듭니다(고아 grant는 최대 300초 안에 만료됩니다).
- 서명기는 `conformance/vectors.json`으로 대조합니다(`conformance/README.md`): 헤더·payload 직렬화로 만든 서명 입력이 벡터의 토큰과 바이트 단위로 같은지 보고, 시험 공개키로 서명을 검증합니다. 이 저장소는 공개 저장소라 시험 비밀키는 넣지 않았습니다. 운영 pr-search는 그 시험 공개키가 정책에 있으면 기동하지 않습니다.

### 3.3 grant

- `POST /auth/exchange` 본문은 `{"assertion":"<JWS>"}` 하나입니다. 이 요청에 `Authorization`·`Cookie`를 싣지 않습니다(있으면 400).
- 응답의 `access_token`(`psig1_` + 43자)은 이 응답에서 한 번만 보입니다. pr-search는 SHA-256만 저장합니다. **서버 전용 저장소**에 두고 브라우저·로그·APM에 싣지 마십시오.
- 수명은 `expires_in` 초(300 이하)입니다: `min(발급 + 300초, auth_expires_at, client 인증서 만료)`. 연장·refresh가 없습니다. 공통 계약 7장대로 15초 이하가 남으면 새로 발급받는 정책이면 됩니다.
- 조회: `Authorization: Bearer <access_token>`. 매 요청에서 인증서 지문, client·키·인증서의 긴급 회수, 로그인 문맥 회수, grant 회수, binding 상태·버전, 만료를 판정합니다.
- `POST /auth/revoke`는 `Authorization: Bearer <grant>`만 보냅니다. 본문은 없거나 `{}`이고, 본문이 없으면 `Content-Type`을 싣지 않습니다(D-06). 결과와 무관하게 같은 200입니다.
- 로그아웃은 `POST /auth/revoke-context`(새 assertion, `purpose: revoke_context`, 같은 `sub`·`auth_context_id`)입니다. 회수 표식은 pr-search PostgreSQL에 남아 같은 문맥의 발급을 이후 403 `CONTEXT_REVOKED`로 막습니다.

### 3.4 상관 ID

pr-search는 요청마다 자기 UUID를 만들어 응답 머리글 `X-Correlation-Id`와 본문 `correlation_id`로 돌려줍니다(source 성공 본문에는 `correlation_id` 키가 없습니다). PIPE가 보낸 `X-Correlation-Id`는 **UUID일 때만** pr-search 이벤트 기록에 함께 남습니다. 두 ID를 PIPE 로그에서 이으십시오.

## 4. 요청 규칙

- 각 조회가 받는 query key는 `operation-map.json`의 `query_keys`이며 OpenAPI 파라미터 설명에 이름·기본값·상한·빈 값 처리가 있습니다. **목록에 없는 key, 같은 key의 중복, 깨진 percent-encoding, C0 제어 문자, `#`는 400 `INVALID_REQUEST`입니다**(원본보다 엄격합니다, D-03). 빈 문자열·미지정·0의 원본 의미는 그대로입니다(예: `cursor=`는 첫 페이지).
- `{repository}`는 `owner/name`을 `%2F` **하나로** 인코딩한 한 조각입니다(`acme%2Fpayments`). 이중 인코딩(`%252F`)·dot segment(`..`)·제어 문자는 400이고, 풀린 값이 100자를 넘으면 404입니다(D-11). 파일 경로·브랜치의 `/`는 query 값이므로 일반 URL 인코딩입니다. query 값으로 오는 `repository`(저장소 목록 필터, 식별자 해석 힌트, M 번호 해석)는 원본 규칙 그대로입니다 — 특히 식별자 해석은 형식이 틀린 힌트를 오류 없이 버리므로, BFF가 잘못 만든 값을 400으로 알려 주지 않습니다(D-03).
- 커서는 grant의 client와 사용자에 결속됩니다. 공개 경로에서 받은 커서, 다른 사용자·다른 client의 커서, 접근 범위가 바뀐 뒤의 커서는 400 `CURSOR_QUERY_MISMATCH`입니다. 이때 첫 페이지로 자동으로 넘어가지 않습니다 — 사용자에게 새 검색을 요청합니다.
- HEAD·OPTIONS와 목록 밖 경로는 404입니다. redirect를 내지 않습니다. PIPE BFF도 redirect를 따라가지 말고 `Set-Cookie`를 브라우저로 넘기지 마십시오.

## 5. 응답·오류 처리

### 5.1 봉투가 둘이다

- **연동 고유 실패** — `{ "error": { "code", "message", "retryable" }, "correlation_id" }`. `retryable` 키가 있습니다.
- **원본 조회의 실패** — `{ "error": { "code", "message", "detail"? }, "correlation_id" }`. `retryable` 키가 없습니다. 코드는 원본 `ErrorCode`입니다(OpenAPI `ErrorCode`, 조회별로는 `*ErrorResponse`가 좁힙니다).

판정은 언제나 `error.code`로 합니다. `message`는 화면 문구로 쓰지 마십시오(연동 문구는 코드별 고정 영어, 원본 문구는 대부분 한국어).

### 5.2 연동 고유 코드와 PIPE 쪽 처리(제안)

| 코드 | HTTP | retryable | 뜻 | PIPE 브라우저 응답(공통 계약 8장) | 자동 재시도 |
|---|---|---|---|---|---|
| `CLIENT_AUTH_FAILED` | 401 | false | 등록되지 않은 client 인증서 | 503 `SEARCH_AUTH_UNAVAILABLE` | 없음 |
| `ASSERTION_INVALID` | 401 | false | 서명·claim·형식 불량, 수명 1초 미만 | 503 `SEARCH_AUTH_UNAVAILABLE` | 없음 |
| `ASSERTION_REPLAYED` | 401 | false | jti 재사용 | 503 `SEARCH_AUTH_UNAVAILABLE` | 없음 |
| `IDENTITY_BINDING_REQUIRED` | 403 | false | 매핑 없음(또는 pr-search 사용자 없음) | 403 `SEARCH_IDENTITY_REQUIRED` | 없음 |
| `IDENTITY_DISABLED` | 403 | false | 매핑 비활성 | 403 `SEARCH_IDENTITY_DISABLED` | 없음 |
| `IDENTITY_BINDING_CONFLICT` | 409 | false | 매핑 충돌, login의 현재 숫자 ID 불일치 | 409 `SEARCH_IDENTITY_CONFLICT` | 없음 |
| `GRANT_EXPIRED` | 401 | **true** | 만료 뒤 120초 진단 창 안 | 새 assertion으로 1회 재발급 후 원래 GET 1회 | **한 번** |
| `GRANT_INVALID` | 401 | false | 없음·변조·진단 창 지남 | 503 `SEARCH_AUTH_UNAVAILABLE` | 없음 |
| `GRANT_REVOKED` | 401 | false | 개별 회수, 또는 binding 버전 변경 | 403 `SEARCH_CONTEXT_REVOKED` | **금지** |
| `CONTEXT_REVOKED` | 403 | false | 로그인 문맥 회수 | 403 `SEARCH_CONTEXT_REVOKED` | **금지** |
| `GRANT_BINDING_MISMATCH` | 401 | false | 다른 인증서로 쓴 grant | 503 `SEARCH_AUTH_UNAVAILABLE` (알려진 인증서 교체면 캐시 폐기 후 새 연결) | 조건부 |
| `CLIENT_DISABLED` | 403 | false | client·서명 키·인증서 비활성 또는 긴급 회수 | 503 `SEARCH_AUTH_UNAVAILABLE` | 없음 |
| `PERMISSION_UNAVAILABLE` | 503 | **true** | 접근 범위를 확인하지 못함 | 503 `PERMISSION_UNAVAILABLE` | 짧은 backoff 뒤 한 번 |
| `AUTH_STORE_UNAVAILABLE` | 503 | **true** | 재생 방지·grant·binding 저장소 장애 | 503 `SEARCH_AUTH_UNAVAILABLE` | 짧은 backoff 뒤 한 번 |
| `INVALID_REQUEST` | 400 | false | 연동 계층의 입력 거절(D-03) | BFF 버그로 기록, 500 계열 | 없음 |
| `PAYLOAD_TOO_LARGE` | 413 | false | 본문 16KiB 초과 | BFF 버그로 기록 | 없음 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | false | JSON이 아닌 본문 | BFF 버그로 기록 | 없음 |
| `NOT_FOUND` | 404 | false | 목록 밖 경로 | 같은 의미의 거부 | 없음 |
| `INTERNAL_ERROR` | 500 | false | 예기치 못한 오류(원인은 응답에 없음) | 503 `SEARCH_AUTH_UNAVAILABLE` | 없음 |
| `OPERATION_NOT_ALLOWED`, `INTEGRATION_DISABLED` | 403, 503 | false | 목록에는 있으나 현재 어떤 경로도 내지 않는다 | – | – |

기능이 꺼진 pr-search는 private 리스너 자체가 없어 **연결 거부**로 보입니다(D-10). 공통 계약 8장의 "upstream 연결 실패 → 502 `SEARCH_UPSTREAM_UNAVAILABLE`"로 옮기면 됩니다.

### 5.3 같은 `PERMISSION_UNAVAILABLE`이 두 봉투로 온다

접근 범위 확인 실패는 **저장소 목록과 발급에서는 연동 봉투**(`retryable: true`), **나머지 조회에서는 원본 봉투**(`retryable` 없음)로 옵니다 — 원본 실행 코드가 그 실패를 먼저 잡기 때문입니다. `operation-map.json`의 각 operation `integration_error_codes`에 이 코드가 있는지가 곧 연동 봉투로 나오는지이며, pr-search 통합 시험이 실측으로 대조합니다. BFF는 두 모양을 모두 `error.code`로 처리하십시오. 이 503을 빈 결과나 fixture 성공으로 바꾸지 마십시오.

### 5.4 볼 수 있는 저장소가 없는 사용자 (D-01)

발급은 성공합니다. 조회는 원본이 0개 저장소 사용자에게 답하던 그대로입니다: 검색·식별자 해석·PR/커밋 상세 **503 `PERMISSION_UNAVAILABLE`**(원본 봉투), 저장소 목록 **200 `items: []`**, source 4종·M 번호 **404 `NOT_FOUND`**. 이 503은 권한 장애와 구분되지 않으므로 자동 재시도 대상으로 쓰지 말고, 화면은 먼저 `/read/repositories`를 불러 빈 목록이면 "연결된 저장소가 없음"을 안내하십시오.

## 6. 원본 조회의 세부 동작 — 바꾸지 않았으니 BFF가 알아야 한다

원본 DTO를 코드에서 추출하며 확인한 것입니다. OpenAPI 스키마가 이 동작을 그대로 적고 있습니다.

- source 성공 본문에는 `correlation_id`가 없고, source 오류 본문에는 `detail`이 없습니다. 429 `SOURCE_RATE_LIMITED`에는 GHE가 알려 준 경우 `Retry-After`(초)가 붙습니다 — 즉시 재시도하지 마십시오.
- 검색의 `facets`는 정확히 `true`일 때만 `facets`·`facets_omitted`·`facets_status` 세 키가 옵니다. `kind:` 조건이 서로 상쇄되면 ES를 부르지 않아 `facets=true`여도 세 키가 빠집니다.
- 파라미터 관용도가 조회마다 다릅니다. 저장소 목록의 `limit`은 범위 밖이면 400이고, 검색 `size`·해석 `limit`은 조용히 기본값이나 상한으로 바꿉니다. 커서는 저장소 목록이 trim하지 않고 검색은 trim합니다. 검색 `seq_epoch`의 빈 값은 "없음"이 아니라 400입니다.
- 식별자 해석: PR 번호로 읽히지 않는 순수 hex가 7자 미만이거나 **40자를 넘으면** 400 `SHA_PREFIX_TOO_SHORT`입니다. 해석이 둘인 입력(예: `1234567`)은 후보를 합친 뒤 잘라 `truncated`가 false일 수 있습니다.
- 검색 결과의 커밋 항목에서 `merged_at`은 실제로 커밋 시각입니다.
- PR 상세의 연결 PR `merge_commit_sha`는 머지되지 않은 PR에서 키가 없는 것이 아니라 `null`로 옵니다.
- 검색 504 `SEARCH_TIMEOUT`은 샤드가 실패한 부분 결과에서만 나옵니다. 검색 ES 마감은 3초입니다.
- 정렬 키는 9개입니다(`pr_number`·`merge_seq`·`merged_at`·`created_at`·`updated_at`·`changed_files_count`·`additions`·`lead_time_seconds`·`relevance`).

## 7. pr-search 쪽 설정과 PIPE가 넘겨야 하는 값

pr-search는 `PIPE_SEARCH_INTEGRATION_ENABLED=true`와 리스너·TLS·정책 파일 변수가 모두 있어야 기동합니다(하나라도 없으면 기동 거부). 상세는 `DEPLOYMENT_AND_ROLLBACK.md` 2~3장입니다. 정책 파일(`pipe-search-integration-policy/v1`)의 client 항목은 다음과 같습니다.

```json
{
  "client_id": "pipe-prod",
  "status": "active",
  "policy_version": 1,
  "issuer": "urn:corp:pipe:prod",
  "audience": "urn:corp:pr-search:pipe-integration:prod",
  "profile": "search-read-v1",
  "signing_keys": [{ "kid": "pipe-signing-2026-01", "public_key_file": "/run/secrets/pipe-integration/pipe-signing-2026-01.pub.pem" }],
  "tls_client": { "subject_alt_names": ["URI:spiffe://corp.example/pipe/prod"], "certificate_sha256": [] },
  "repository_ids": [101, 102]
}
```

PIPE가 pr-search 운영 담당에게 넘길 것: 환경별 `client_id`·`issuer`·`audience`, 서명 **공개키**(SPKI PEM, RSA 2048비트 이상)와 `kid`, client 인증서의 SAN 또는 지문과 그 발급 CA. 서명 키를 교체할 때는 새 키를 먼저 추가하고, 옛 키는 **최소 420초** 뒤에 뺍니다(D-05).

## 8. 운영 활성화에 필요한 실제 입력 (PENDING_OPERATOR_INPUT)

| 입력 | 책임 | 상태 |
|---|---|---|
| private 리스너 주소·포트, 사내 private 망에서만 닿는 경로 | 운영·보안 | 미정의 — 예시만 제공 |
| TLS 형상이 L4 passthrough로 가능한지(HAProxy `mode tcp`) | 운영·보안 | 미확인 (D-02) |
| 서버 인증서·client CA·client 인증서의 SAN 형식 | 운영·보안 | 미확인 |
| 환경별 issuer·audience·client_id와 서명 공개키·kid | PIPE + pr-search | 미정의 |
| PIPE 불변 사용자 ID·로그인 문맥 ID·로그인 만료의 추출 | PIPE | PIPE 담당 |
| 검증된 identity binding(PIPE subject ↔ pr-search 사용자, GHE 숫자 ID) | pr-search 운영 | 미등록 — CLI `bindings import`(기본 dry-run) |
| PIPE에 노출할 등록 저장소 ID 허용 목록 | 서비스 소유자 | 미정의 |
| 사내 GHES에서 설치 토큰으로 `GET /users/{login}`이 되는지 | pr-search 운영 | 미확인 (D-12) |

binding은 pr-search에 한 번 로그인해 사용자 행과 GHE 숫자 ID가 있는 사람만 연결할 수 있습니다. pr-search는 이 연동으로 사용자·역할을 새로 만들지 않습니다.

## 9. 잔여 위험과 한계

- **위임 위험.** 서명 키를 가진 PIPE는 승인된 binding의 사용자를 대신 주장할 수 있습니다. 허용 목록·binding·긴급 회수가 범위를 좁히지만 위험 자체는 받아들인 위험입니다. PIPE 키 보관과 유출 대응 절차가 필요합니다.
- **반영 지연.** pr-search의 권한 캐시는 최대 5분입니다(웹훅 무효화가 오면 다음 요청부터 반영). 발급 사이(최대 300초)의 GHE login 개명·재사용은 발급 때만 대조합니다.
- **회수 전송 실패.** 회수 호출이 닿지 않으면 이미 발급된 grant는 최대 300초 남습니다. 로컬 문맥 종료는 PIPE가 유지해야 합니다.
- **rate limit.** pr-search 조회에는 애플리케이션 수준 rate limit이 없습니다(원본에도 없음). 사용자·client별 제한, 연결 pool 상한, source 동시성 제한은 PIPE BFF가 둡니다(D-14).
- **미검증 환경.** 사내 CA·운영 HAProxy·실제 GHE·실제 사용자 매핑을 거친 검증은 하지 않았습니다(`TEST_RESULTS.md`의 NOT_RUN).

## 10. pr-search의 실제 변경 요약

- 새 모듈 `apps/search-api/src/integrations/pipe/`(private 리스너·mTLS·assertion·재생 방지·binding·grant·조회 문맥·운영 CLI·이벤트)와 CLI 진입점 `apps/search-api/src/pipe-integration-cli.ts`.
- 기존 조회 10종의 route 본문을 실행 함수로 꺼내 공유했습니다. 공개 route의 인증·검사 순서·응답은 그대로이며, 기존 통합·회귀 시험이 리팩터 전과 같게 통과합니다.
- 커서 지문에 선택적 결속을 더했습니다. 결속이 없는 공개 커서의 지문은 이전과 같습니다.
- 마이그레이션 033(추가 전용 표 다섯: binding·로그인 문맥·grant·긴급 회수·이벤트). 운영 롤백은 기능을 끄는 것이며 표를 지우지 않습니다.
- `@prs/github`에 읽기 전용 `getUser`(login → 숫자 ID). 런타임 의존 `jose@6.2.12`(정확 고정), 개발 의존 `ajv@8.20.0`·`ajv-formats@3.0.1`·`js-yaml@4.3.1`(계약 시험용).
- 기본 배포 파일(`deploy/`)은 바꾸지 않았고 예시만 `deploy-examples/`에 있습니다.
