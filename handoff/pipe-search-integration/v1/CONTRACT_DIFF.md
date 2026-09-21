# CONTRACT_DIFF — 제안 계약 PSI-1.0과 pr-search 구현의 차이

> 분류: 인수인계 자료(PIPE 담당 세션용). 기준 제안: `docs/40_delivery/pipe-search-handoff-auth/00_SHARED_INTEGRATION_CONTRACT.md` (PSI-1.0 제안). 구현: main `e7b4cb4`(PR #220 squash 병합, 브랜치 `feature/pipe-integration-auth`의 `28a3c21`) (CR-112, ADR-025).

이 문서는 제안 계약과 실제 구현이 **다른 자리만** 적습니다. 적지 않은 항목은 제안 계약대로 구현했습니다. 인증 경계나 grant 용도 제한을 약화한 변경은 없습니다. 모든 차이는 같은 방향(더 좁게, 더 명시적으로)입니다.

PIPE 구현은 이 문서와 `pipe-integration-v1.openapi.yaml`을 함께 읽어야 합니다. 둘이 어긋나면 OpenAPI와 `operation-map.json`이 정본이며, 그 파일의 SHA-256은 `manifest.json`에 있습니다.

## D-01 교집합이 빈 사용자는 원본의 "기본 거부" 의미를 그대로 받는다

제안 계약 6.1은 "권한 조회 성공 후 0개 저장소인 사용자는 빈 검색 범위를 갖는다"고 적었습니다. 구현은 다음과 같이 두 단계로 나뉩니다.

- **발급은 성공합니다.** 권한 조회가 성공했다면 0개여도 grant를 발급합니다. 권한 조회 자체가 실패하면 503 `PERMISSION_UNAVAILABLE`입니다.
- **조회는 원본 경로가 0개 저장소 사용자에게 답하던 그대로 답합니다.** pr-search는 빈 범위를 "결과 없음(200)"이 아니라 "권한을 확인할 수 없음"으로 다루는 기본 거부 규칙(FR-AUTH-002 AC-3)을 이미 갖고 있고, 연동은 그 의미를 바꾸지 않습니다.

| 조회 | 사용자 범위 ∩ client 허용 목록이 비었을 때 | 근거 |
|---|---|---|
| `/read/search` | 503 `PERMISSION_UNAVAILABLE` | 필수 접근 범위 필터가 빈 목록에서 던진다 |
| `/read/resolve` | 503 `PERMISSION_UNAVAILABLE` | 같다 |
| `/read/pull-requests/…`, `/read/commits/…` | 503 `PERMISSION_UNAVAILABLE` | 같다 |
| `/read/repositories` | 200, `items: []`, `next_cursor: null` | 저장소 목록은 행 단위로 거른다 |
| `/read/source/…` 4종 | 404 `NOT_FOUND` | 저장소 가시성 판정이 먼저 거절한다 |
| `/read/merge-numbers/resolve` | 404 `NOT_FOUND` | 같다 |

PIPE는 이 503을 **자동 재시도 대상으로 쓰면 안 됩니다.** 권한 서비스 장애와 "볼 수 있는 저장소가 없음"을 이 코드만으로는 구분할 수 없습니다. 화면은 먼저 `/read/repositories`를 부르고, 빈 목록이면 "연결된 저장소가 없음"을 안내하는 기존 Stage 1 흐름을 따르면 됩니다. 통합 시험 `parity.test.ts`의 「0개 저장소」 사례가 이 표 전체를 공개 경로와 대조합니다.

## D-02 TLS는 pr-search 프로세스가 끝낸다 (passthrough만 지원)

제안 계약 3.3은 프록시가 TLS를 끝내고 신뢰된 metadata를 넘기는 형상도 허용했습니다. v1은 **이 형상을 지원하지 않습니다** (ADR-025). pr-search의 private 리스너가 Node(OpenSSL)로 직접 mTLS를 끝내고, `X-SSL-Client-*`·`X-Client-Cert`·`X-Forwarded-Client-Cert` 같은 헤더는 **읽지 않습니다.** HAProxy를 둔다면 L4 passthrough(`mode tcp`)여야 합니다. 프록시 종료 형상이 꼭 필요하면 두 저장소가 함께 계약을 고쳐야 합니다. 그때의 안은 "프록시→pr-search 구간도 mTLS로 두고, 고정한 프록시 인증서에서 온 요청만 전달 헤더를 읽는다"입니다. IP 허용 목록만으로 헤더를 믿는 안은 채택하지 않습니다.

## D-03 입력은 원본보다 엄격하다

| 입력 | 연동 경로 | 원본 `/api/v1/*` |
|---|---|---|
| 같은 query key가 두 번 (`q=a&q=b`) | 400 `INVALID_REQUEST` | 받는다. 배열이 되어 `q`는 빈 질의로 읽힌다 (DEV-731) |
| 목록에 없는 query key | 400 `INVALID_REQUEST` | 무시한다 |
| 깨진 percent-encoding, C0 제어 문자, `#` | 400 `INVALID_REQUEST` | 일부는 그대로 통과한다 |
| 이중 인코딩된 저장소 (`acme%252Fapp`) | 400 `INVALID_REQUEST` | 상세 경로가 한 번 더 풀어 받는다 (DEV-730) |
| 저장소의 dot segment (`acme/..`) | 400 `INVALID_REQUEST` | 상세 경로의 정규식이 받는다 (DEV-730) |
| `Cookie` 헤더가 있는 요청 | 400 `INVALID_REQUEST` (모든 연동 경로) | 세션 자격이다 |
| 발급·문맥 회수 요청의 `Authorization` | 400 `INVALID_REQUEST` | 해당 없음 |

각 조회가 받는 query key는 `operation-map.json`의 `query_keys`가 정본입니다. 값의 뜻(빈 문자열, 미지정, 0)은 바꾸지 않았습니다. 예를 들어 `cursor=`는 원본처럼 "첫 페이지"로 읽힙니다.

이중 인코딩·dot segment의 400은 **경로 파라미터 `{repository}`**에 대한 것입니다. query 값의 `repository`는 원본 규칙 그대로입니다 — 식별자 해석(`/read/resolve`)은 형식이 틀린 저장소 힌트(`x/..`, `acme%252Fpayments`)를 두 경로 모두 조용히 버리고 접근 범위 안에서 해석합니다. 저장소 목록과 M 번호 해석은 원본 규칙대로 `/`로 나뉜 두 조각이 아니면 400이고(`acme%252Fpayments`는 한 번 풀린 뒤에도 `/`가 없는 한 조각입니다), 두 조각이면 저장소 목록은 정확 일치 필터라 빈 목록, M 번호 해석은 범위 확인에서 404입니다. 어느 경우도 접근 범위 밖을 열지 않습니다(통합 시험 `parity.test.ts`가 식별자 해석의 두 사례를 공개 경로와 대조합니다). BFF는 query 값을 typed URL builder로 만들어 이런 값을 보내지 않아야 합니다.

## D-04 연동 오류 코드가 계약 표보다 다섯 개 많다

제안 계약 8장의 코드는 모두 구현했습니다. 입력·저장소 장애를 다른 코드로 위장하지 않으려고 다음을 더했습니다.

| 코드 | HTTP | retryable | 뜻 | PIPE가 할 일(제안) |
|---|---|---|---|---|
| `INVALID_REQUEST` | 400 | false | 연동 계층의 입력 거절 (D-03) | BFF 버그로 취급, 재시도 없음 |
| `PAYLOAD_TOO_LARGE` | 413 | false | 본문 16KiB 초과 | 재시도 없음 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | false | JSON이 아닌 본문 | 재시도 없음 |
| `AUTH_STORE_UNAVAILABLE` | 503 | true | 재생 방지(Redis)나 grant·binding 정본(PostgreSQL)이 답하지 않음 | 503 `SEARCH_AUTH_UNAVAILABLE`, 짧은 backoff 뒤 1회 |
| `INTERNAL_ERROR` | 500 | false | 예기치 못한 오류 (원인은 응답에 싣지 않는다) | 503 `SEARCH_AUTH_UNAVAILABLE` |

`PERMISSION_UNAVAILABLE`은 연동 봉투일 때 `retryable: true`입니다. 원본 조회가 낸 오류 본문은 원본 모양 그대로 나가며 `retryable` 키가 없습니다 (D-09).

## D-05 신원·키 변경은 자동 재발급 대상이 아니다

- binding이 **활성인 채로 버전만 바뀌면**(비활성화 뒤 다시 켜기 등) 옛 grant는 401 `GRANT_REVOKED`(내부 사유 `binding_changed`)입니다. 제안 계약 8장에 따라 PIPE는 자동 재발급하지 않습니다. 사용자가 PIPE에 다시 로그인해 새 문맥을 만들면 새 grant를 받습니다.
- 서명 키를 **설정에서 빼거나** DB로 긴급 회수하면, 그 `kid`로 발급된 grant는 남은 수명과 무관하게 403 `CLIENT_DISABLED`입니다. 정상 키 교체는 새 키를 먼저 추가하고 옛 키를 **최소 420초(grant 300초 + 진단 창 120초)** 더 남겨 둔 뒤 뺍니다. `DEPLOYMENT_AND_ROLLBACK.md` 4장을 따릅니다.

## D-06 `POST /auth/revoke`의 본문

본문은 **없거나** `{}`입니다. 본문이 없는데 `Content-Type: application/json`을 보내면 Fastify가 빈 JSON 본문으로 400을 냅니다. 본문 없이 보낼 때는 Content-Type을 싣지 않습니다. 응답은 grant가 있었든 없었든, 이미 회수됐든, 다른 client의 것이든 **같은 200 본문**입니다.

## D-07 capabilities에 `merge_number:read`가 더해질 수 있다

`MNUMBER_ENABLED=true`인 배포에서만 exchange·`/context` 응답의 `capabilities`에 `merge_number:read`가 들어가고, `/context`의 `operations`에 `read.merge_numbers.resolve`가 들어갑니다. 꺼진 배포에서 `/read/merge-numbers/resolve`는 원본처럼 404 `NOT_FOUND`(`detail.reason = feature_disabled`, 원본 봉투)입니다. 통합 시험 `mnumber-disabled.test.ts`가 꺼진 배포를 따로 세워 셋을 확인합니다.

## D-08 pr-search private `/context`의 모양

제안 계약은 private `/context`의 필드를 정하지 않았습니다. 구현은 다음을 돌려줍니다: `protocol_version`, `grant_id`, `expires_at`, `auth_context_id`, `binding_version`, `identity.ghe_login`, `capabilities`, `operations`, `correlation_id`. `ghe_login`은 pr-search 정본(`app_user.login`)의 현재 값입니다. 브라우저용 `/api/pr-search/v1/context`(제안 계약 12장)는 PIPE BFF가 이 값으로 만듭니다. `context_key`는 PIPE가 만드는 값이며 pr-search는 만들지 않습니다.

## D-09 두 오류 모양이 공존한다

- 연동 고유 실패: `{ "error": { "code", "message", "retryable" }, "correlation_id" }`. 메시지는 코드마다 고정 문구이며 원인을 싣지 않습니다.
- 원본 조회 실패(질의 문법, 커서, source, 에폭, 범위 밖 404, 조회 중 503 등): 원본 `/api/v1/*`와 같은 `{ "error": { "code", "message", "detail"? }, "correlation_id" }`입니다.

client 인증서가 없거나 신뢰 CA가 발급하지 않았으면 **HTTP 응답이 없습니다** (TLS 핸드셰이크 실패). 신뢰 CA가 발급했지만 등록되지 않은 인증서만 401 `CLIENT_AUTH_FAILED`를 받습니다.

## D-10 기능 OFF는 "리스너 없음"이다

제안 계약은 "503 `INTEGRATION_DISABLED` 또는 private route 미등록"을 허용했습니다. 구현은 후자입니다. `PIPE_SEARCH_INTEGRATION_ENABLED`가 `true`가 아니면 private 리스너를 **띄우지 않습니다.** PIPE에는 연결 거부(transport failure)로 보이며, 제안 계약 8장의 "upstream 연결 실패 → 502 `SEARCH_UPSTREAM_UNAVAILABLE`"로 옮기면 됩니다. 코드 `INTEGRATION_DISABLED`는 목록에 있지만 현재 어떤 경로도 내지 않습니다.

## D-11 저장소 경로 파라미터의 길이

`{repository}`는 `%2F` 하나로 인코딩한 `owner%2Fname` 한 조각입니다. Fastify 기본 `maxParamLength`(100) 때문에 **풀린 값이 100자를 넘으면 404**입니다. 원본 `/api/v1/*`도 같은 제한을 갖습니다. owner·name은 각각 `[A-Za-z0-9._-]{1,100}`만 받습니다.

## D-12 발급 때 GHE에서 login의 현재 숫자 ID를 확인한다

제안 계약 4장의 "현재 canonical user에서 최신 login을 읽고 숫자 ID와 충돌하면 실패"를 다음과 같이 구현했습니다. pr-search 정본의 `github_user_id`가 binding과 같은지 보고, 더해 **GHE `GET /users/{login}`로 그 login이 지금도 같은 숫자 ID인지** 발급마다 확인합니다. PIPE만 쓰는 사용자는 pr-search 로그인이 없어 정본의 login이 낡을 수 있고, 옛 이름을 다른 사람이 가져가면 접근 범위 조회가 다른 사람의 권한을 읽기 때문입니다. 결과는 다음과 같습니다.

- 숫자 ID가 다르거나 login이 없으면 409 `IDENTITY_BINDING_CONFLICT`입니다 (운영자가 정리할 때까지).
- GHE 사용자 조회가 실패하면 503 `PERMISSION_UNAVAILABLE`입니다. 권한 캐시가 따뜻해도 발급은 GHE 호출을 한 번 합니다. 조회는 프로세스당 동시 8개로 제한합니다.

발급 사이(최대 300초)와 권한 캐시(5분) 동안의 개명·재사용은 이 검사로 잡히지 않습니다. 이 한계는 `TEST_RESULTS.md`와 `PIPE_INTEGRATION_HANDOFF.md`의 잔여 위험에 적었습니다.

## D-13 grant 수명은 client 인증서 만료도 넘지 않는다

`min(now + 300초, auth_expires_at, client 인증서 notAfter)`입니다. 수명이 1초 미만이면 발급하지 않고 401 `ASSERTION_INVALID`입니다. 초 단위로 내림하므로 `expires_in`은 300 이하입니다.

## D-14 pr-search는 새 rate limit을 두지 않는다

원본 조회 API에는 애플리케이션 수준 rate limit이 없고, 연동도 새로 만들지 않았습니다. 429는 source 조회가 GHE rate limit에 걸렸을 때만 나옵니다(`SOURCE_RATE_LIMITED`, `Retry-After` 포함). 사용자·client별 제한, 연결 pool 상한, source 동시성 제한은 제안 계약 10장대로 **PIPE BFF가** 둡니다. pr-search 쪽 자원 상한은 `DEPLOYMENT_AND_ROLLBACK.md` 7장에 적었습니다.

## D-15 assertion 형식의 세부

제안 계약 5.2를 다음과 같이 확정했습니다.

- 헤더는 `alg`·`typ`·`kid` **셋만** 받습니다. `jku`·`x5u`·`jwk`·`x5c`·`crit`·`b64`가 있으면 거절합니다.
- `typ`은 정확히 `pipe-user-assertion+jwt`입니다 (대소문자·`application/` 접두 변형도 거절).
- `aud`는 **문자열 하나**입니다. 배열이면 우리 값이 들어 있어도 거절합니다.
- claim은 12개가 모두 필수이고 그 밖의 claim은 거절합니다: `iss`, `aud`, `sub`, `client_id`, `purpose`, `profile`, `auth_context_id`, `auth_expires_at`, `iat`, `nbf`, `exp`, `jti`.
- 형식: `sub`는 공백·제어 문자 없는 가시 ASCII 1~256자, `auth_context_id`는 `[A-Za-z0-9._~:-]{8,256}`, `jti`는 `[A-Za-z0-9_-]{22,128}`(128비트 이상), `kid`는 `[A-Za-z0-9._:-]{1,128}`, 시각은 양의 정수 초입니다.
- 압축 JWS 길이는 8192자 이하, 요청 본문은 16KiB 이하입니다.
- 서명 키는 RSA 2048비트 이상입니다.

## D-16 문맥 회수의 세부

- `revoke-context`는 binding을 요구하지 않습니다. 매핑이 꺼진 사용자의 문맥도 회수할 수 있습니다.
- 긴급 회수된 서명 키로 서명한 회수 assertion은 403 `CLIENT_DISABLED`입니다.
- 회수 표식은 `(issuer, subject, auth_context_id)` 단위이며 client를 가리지 않습니다. 같은 issuer의 다른 client가 발급한 grant도 함께 죽습니다.
- 응답: `{ protocol_version, auth_context_id, revoked: true, revoked_at, correlation_id }`. 이미 회수된 문맥이면 처음 회수 시각을 돌려줍니다.

## D-17 진단 창

만료 뒤 120초 동안은 401 `GRANT_EXPIRED`(retryable)이고, 그 뒤에는 행이 남아 있어도 401 `GRANT_INVALID`입니다. 이 창은 인증 수명이 아닙니다.

## D-18 correlation ID

pr-search는 요청마다 **자기 UUID를 만듭니다.** 응답 본문의 `correlation_id`와 응답 헤더 `X-Correlation-Id`가 그 값입니다. PIPE가 보낸 `X-Correlation-Id`는 UUID 형식일 때만 이벤트 기록(`upstream_correlation_id`)에 남기고 응답으로 되돌려 보내지 않습니다. 임의 문자열은 버립니다.

## D-19 method

HEAD·OPTIONS는 어느 경로에서도 404입니다 (HEAD 자동 경로를 껐습니다). 목록에 없는 경로는 method와 무관하게 404 `NOT_FOUND`이며, mTLS client 인증이 먼저라 등록되지 않은 client는 404 대신 401을 받습니다.

## D-20 접근 범위 확인 실패는 모든 조회에서 503이다 — 원본 저장소 목록만 500이다

제안 계약 8장은 "scope 확인 불가 → 503 `PERMISSION_UNAVAILABLE`"입니다. 연동은 조회 10종 모두 그렇게 답합니다(연동 봉투, `retryable: true`). 그런데 원본 `/api/v1/repositories`는 같은 실패를 잡지 않아 Fastify 기본 봉투 `{ "statusCode": 500, "error", "message" }`로 냅니다(pr-search 원장 DEV-732, 리팩터 전부터 같은 동작). 연동은 원본의 이 결함을 따라가지 않았습니다 — 따라가면 내부 사유 문장이 PIPE로 넘어가고, PIPE가 권한 장애를 서버 오류로 오인합니다. 이것이 **성공·원본 오류 본문을 원본과 같게 둔다는 원칙의 유일한 예외**이며, 통합 시험 PSI-D09가 `/read/repositories`를 포함한 다섯 조회와 발급에서 503을 확인합니다.

## 확인하지 못한 것

| 항목 | 상태 | 이유 |
|---|---|---|
| 사내 CA가 발급한 실제 client 인증서의 subjectAltName 형식 | 미확인 | 사내 PKI를 볼 수 없다. 설정은 URI·DNS SAN 정확 일치나 SHA-256 지문 고정을 모두 받는다 |
| 사내 HAProxy가 L4 passthrough로 구성 가능한가 | 미확인 | 운영 구성을 볼 수 없다 (D-02) |
| 사내 GHES에서 설치 토큰으로 `GET /users/{login}`이 되는가 | 미확인 | 실 GHE에 닿지 않았다. GitHub REST 문서상 공개 사용자 조회다 |
| PIPE JWT의 로그인 문맥·만료 추출 | PIPE 담당 | pr-search가 볼 수 없다 |
| 사내 표준 위임 서버(OIDC Token Exchange 등)의 존재 | 미확인 | 있으면 ADR로 비교한다. 한쪽 저장소만 protocol을 바꾸지 않는다 |
