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
| `/read/source/…` 6종(blame은 D-26, paths는 D-27) | 404 `NOT_FOUND` | 저장소 가시성 판정이 먼저 거절한다. blame이 꺼진 배포는 그보다 앞의 게이트가 404 `feature_disabled`로 답한다 |
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

## D-21 `read.resolve`가 M 번호 문자열을 해석한다 — additive (CR-114, 2026-09-22)

PSI-1.0 제안과 CR-112 구현 시점의 `read.resolve`는 커밋 SHA·PR 번호·GHE URL만 판별했습니다. CR-114부터 `q`가 `M-<코드>-<번호>` 표기 문자열(제목 접두 `[M-…]`·소문자 `m-`도 받습니다)이면 `detected_kind`가 **`merge_number`**이고, 후보는 접근 범위 안에서 저장소 이름의 코드가 같은 저장소들의 **현재 에폭 PostgreSQL 정본**(`merge_sequence`)에서 찾은 `pull_request` 후보입니다. 바뀐 것은 전부 additive입니다.

| 자리 | 전 | 후 |
|---|---|---|
| `IdentifierKind` | `commit`·`pull_request`·`text` | `merge_number` 추가 |
| `ResolveResponse.reason_code` | `not_found`만 | `merge_number_disabled` 추가 — M 번호 문자열인데 pr-search 배포의 M 번호 기능이 꺼져 있을 때(`capabilities`에 `merge_number:read`가 없는 배포). 200이며 400이 아닙니다 |
| `ResolvePullRequestCandidate` | 시퀀스 세 키까지 | `merge_number`·`merge_number_epoch`·`merge_number_state`(세 키는 함께 있거나 함께 없습니다). 이 후보의 `merge_seq`·`seq_epoch`·`sequence_space`는 색인이 아니라 정본 값이며, 색인 문서가 아직 없어도 후보는 성립합니다(`display_name: null`, `state: merged`) |

같은 코드를 가진 저장소가 여럿이거나 시퀀스 브랜치가 둘 이상이면 후보가 여럿입니다 — 원본과 같이 자동 이동을 결정하지 않습니다. `read.merge_numbers.resolve`(저장소·브랜치·에폭을 명시한 정확 해석)는 그대로이며, 두 경로의 답은 같은 정본에서 나옵니다. 예시는 `examples/read.resolve.200.merge-number.json`(합성)입니다.

## D-22 원본 커밋은 그 PR이 새로 가져온 커밋이다 — `read.pull_request`에 키 하나 추가 (CR-117, 2026-09-24)

피처 브랜치가 대상 브랜치(사내에서는 dev)를 `git merge`로 받아 오면, GitHub의 PR 커밋 목록에 이미 그 브랜치에 오른 다른 PR의 머지 커밋이 섞입니다. CR-117부터 pr-search는 그런 커밋을 **그 커밋을 대상 브랜치에 올린 PR에만** 속하게 합니다(FR-SRCH-002 AC-7, OD-016). 원본 응답이 바뀌었으므로 연동 응답도 같이 바뀝니다(연동은 같은 실행 함수를 부릅니다 — FR-INT-001 AC-5).

| 자리 | 전 | 후 |
|---|---|---|
| `PullRequestDetailResponse.source_commits` | GitHub의 PR 커밋 목록 그대로(최대 250) | 그 PR이 **새로 가져온** 커밋만. 커밋 문서의 연결 PR에 이 PR이 없는 항목을 뺍니다. 연결이 아직 투영되지 않은 커밋은 빼지 않습니다 |
| `PullRequestDetailResponse.source_commits_excluded` | 없음 | **추가, 언제나 있음.** 뺀 수(정수 ≥ 0). 0이어도 싣습니다. 절삭됐으면 읽은 앞 250건 안에서 센 값입니다 |
| `PullRequestDetailResponse.source_commits_total` | 원시 목록 길이 | 뺀 뒤 남은 수. 절삭됐을 때 키가 없는 것은 그대로입니다 |
| `CommitDetailResponse.pull_requests`·`ResolveCommitCandidate.pull_request_numbers`·`SourceHistoryCommit.pull_request_numbers` | 모양 그대로 | 값의 뜻이 같은 규칙을 따릅니다 — 대상 브랜치에 이미 오른 커밋에는 그 커밋을 올린 PR만 남습니다. 키·타입은 바뀌지 않습니다 |

**PIPE에 필요한 조치.** `PullRequestDetailResponse`는 `additionalProperties: false`이므로, 이 스키마로 응답을 엄격하게 검증한다면 새 키를 받아들이도록 스키마를 갱신해야 합니다. 화면이 원본 커밋 수를 GitHub과 비교해 보여 준다면 `source_commits_excluded`로 차이의 이유를 안내하는 것을 권합니다 — pr-search 화면은 「이미 대상 브랜치에 있던 커밋 N개는 목록에 없고, 각각을 그 브랜치에 올린 PR 소속이다」라고 말합니다. 예시 `examples/read.pull_request.200.json`(captured)에 키를 더했습니다. `handoff/pipe-search-port`(2026-09-21 시점 고정 스냅숏)의 fixture에는 이 키가 없습니다.

## D-23 0건 검색의 완화 후보 — `kind:`가 든 0건이 500이 아니고, 세지 못한 후보를 밝힌다 (CR-128, 2026-09-28)

`kind:`와 다른 필터를 함께 쓴 검색은 결과가 0건일 때마다 완화 후보를 만들다 **500 `INTERNAL_ERROR`**로 끝났습니다(`retryable: false`). 원본 경로도 500이었습니다(DEV-783). 이 표의 오류 대응(`INTERNAL_ERROR` → 503 `SEARCH_AUTH_UNAVAILABLE`)을 따르는 BFF에서는 503으로 보였을 것입니다. CR-128부터 이 질의는 원본과 같은 200 · `total` 0 · 빈 `items` · `next_cursor: null`과 정확한 후보를 받습니다. 연동은 같은 실행 함수를 부르므로 원본과 같이 바뀝니다(FR-INT-001 AC-5).

| 자리 | 전 | 후 |
|---|---|---|
| `kind:` + 다른 필터 + 0건 | 500 `INTERNAL_ERROR` | 200. 후보마다 `kind:`를 원래 대상(PR·커밋)에서 다시 적용해 센다 — `kind:pull_request`를 빼는 후보는 그 조건의 커밋도 셉니다 |
| 모순된 `kind:`(`kind:pull_request -kind:pull_request …`)의 0건 | 200, `relaxation_hints: []`(계산하지 않았다) | 200, 후보를 센다. 연동 범위가 빈 사용자는 다른 검색처럼 503 `PERMISSION_UNAVAILABLE`(원본 봉투) |
| `SearchResponse.relaxation_hints_incomplete` | 없음 | **추가, 선택.** 0건이고 세지 못한 후보가 있을 때만 `true`로 나타납니다(`false`로는 나오지 않습니다). 목록의 `would_yield`는 모두 정확하고, 키가 있으면 빠진 후보가 있을 수 있습니다. **목록이 비었는데 이 키가 있으면 「추천을 계산하지 못했다」이지 「뺄 필터가 없다」가 아닙니다** |

추천 계산이 실패해도 본 조회의 200은 바뀌지 않습니다 — 후보 계산은 갈래마다 1.5초, 왕복 3초 상한이고 재시도하지 않습니다. 본 조회·접근 범위·입력의 실패는 전과 같은 코드입니다.

**PIPE에 필요한 조치.** `SearchResponse`는 `additionalProperties: false`이므로, 이 스키마로 응답을 엄격하게 검증한다면 새 키를 받아들이도록 스키마를 갱신해야 합니다. 화면이 후보를 보여 준다면 이 키가 있을 때 빈 목록을 「제안 없음」으로 그리지 말고 「제안을 계산하지 못함」으로 구분하는 것을 권합니다. 전에 `kind:` 0건 검색이 503 `SEARCH_AUTH_UNAVAILABLE`로 보였다면 이 변경 뒤에는 200 0건으로 바뀝니다 — 재시도·빈 결과로 대신하던 처리가 있으면 걷어 내십시오. 예시 `examples/read.search.200.relaxation-incomplete.json`(합성)을 더했습니다. `handoff/pipe-search-port`(2026-09-21 시점 고정 스냅숏)의 fixture에는 이 키가 없습니다.

## D-24 서버 오류는 `INTERNAL_ERROR`다 — `statusCode`가 4xx인 서버 예외를 `INVALID_REQUEST`로 분류하던 결함 (CR-129, 2026-09-29)

연동 리스너의 오류 처리기는 경로가 처리하지 못한 예외 가운데 `statusCode` 속성이 4xx인 것을 모두 **`INVALID_REQUEST`**(400, `retryable: false`)로 답했습니다. Elasticsearch 클라이언트의 `ResponseError`는 거절 상태를 `statusCode`로 내놓으므로, 서버가 조립한 질의를 Elasticsearch가 거절하면 PIPE에게는 입력 오류로 보였고 서버 로그도 남지 않았습니다(DEV-789). CR-129부터 입력 오류로 답하는 것은 **요청 본문·URL을 읽지 못한 경우**(본문 형식·크기·JSON·URL)뿐이고, 그 밖의 처리하지 못한 예외는 `INTERNAL_ERROR`(500, `retryable: false`)이며 서버가 correlation ID와 함께 기록합니다. 공개 `/api/v1/*`도 같은 분류를 씁니다.

| 자리 | 전 | 후 |
|---|---|---|
| 서버 예외 중 `statusCode`가 4xx인 것(예: Elasticsearch의 질의 거절) | 400 `INVALID_REQUEST`, 기록 없음 | 500 `INTERNAL_ERROR`, 서버 로그에 오류 이름과 correlation ID |
| 본문 1MiB 초과 · JSON이 아닌 본문 형식 | 413 `PAYLOAD_TOO_LARGE` · 415 `UNSUPPORTED_MEDIA_TYPE` | 같음 |
| 그 밖의 요청 읽기 오류(깨진 JSON 등) | 400 `INVALID_REQUEST` | 같음 |
| 원본 조회의 입력 오류(질의 문법·커서 등) | 원본 본문 그대로(예: 400 `QUERY_SYNTAX_ERROR`) | 같음 |

오류 코드·봉투·고정 문구·OpenAPI·operation map은 바뀌지 않습니다(계약 checksum 불변).

**PIPE에 필요한 조치.** 없습니다. 이 표의 오류 대응(`INTERNAL_ERROR` → 503 `SEARCH_AUTH_UNAVAILABLE`)을 따르는 BFF에서는 이 경우가 사용자의 입력 오류가 아니라 일시 장애로 보입니다. 사용자에게 보인 오류를 조사할 때는 응답의 `correlation_id`를 pr-search 운영자에게 전달합니다.

## D-25 source 조회의 총량 제한을 이어 읽기로 — `offset`·`listing=tree`·`related=all`, History 페이지 상한 해제 (CR-132, 2026-09-29)

pr-search 화면은 256KiB·4,000줄을 넘는 파일, 5,000개를 넘는 디렉터리, GitHub 목록 상한(3,000개)을 넘는 변경, 50,000번째 뒤의 경로 이력을 끝까지 보지 못했습니다. CR-132부터 원본 source API가 이어 읽기를 지원하고, 연동은 같은 실행 함수를 부르므로(FR-INT-001 AC-5) 같은 파라미터를 허용 목록에 더했습니다. **새 동작은 새 파라미터를 보낼 때만 켜집니다** — 보내지 않는 호출의 응답 모양과 값은 전과 같습니다. 예외는 둘입니다: History의 1,001번째 이후 페이지는 400이 아니라 200이고, 한 요청에 기한(120초)이 생겼습니다.

| 자리 | 전 | 후 |
|---|---|---|
| `read.source.file`의 `offset` | 없음(`query_unknown_parameter`) | 선택. 보내면 본문의 한 창(최대 1 MiB)과 `offset`·`next_offset`(끝이면 `null`). 창은 줄바꿈 뒤, 줄이 창보다 길면 UTF-8 문자 경계에서 끊깁니다. 크기 상한은 GitHub API의 100MB뿐이며(넘으면 `too_large`), `size`·`sha`는 파일 전체의 크기와 blob SHA입니다. 파일 끝을 넘거나 문자 가운데를 가리키는 offset은 원본의 400 `INVALID_PARAMETER` |
| `read.source.tree`의 `offset` | 없음 | 선택. 보내면 정렬한 목록(디렉터리 먼저, 이름 순)의 5,000개 페이지와 `tree_sha`·`offset`·`next_offset`·`total`. `truncated`는 GitHub가 목록을 잘랐을 때뿐입니다 |
| `read.source.diff`의 `listing=tree`(`head` 필수, `base`·`after` 선택) | 없음 | 선택. 두 커밋의 트리를 직접 비교한 목록을 1,000개씩 주고 `listing: "tree"`·`next_after`를 싣습니다. `additions`·`deletions`·`previous_path`는 `null`, `pull_requests`는 빈 배열, `pull_requests_unavailable`은 `false`입니다. `pr`·`commit`·`page`·`related`와 섞으면 400 |
| `read.source.diff`의 `related=all` | 없음 | 선택. commit 모드의 연결 PR을 다섯 개에서 자르지 않습니다 |
| `read.source.history`의 `page` | 1~1000(1,001부터 400) | 1 이상. 1,000번째 페이지가 알린 `next_page: 1001`을 이제 읽을 수 있습니다 |
| `SourceChange.additions`·`deletions` | `integer` | `integer` 또는 `null`(`listing=tree`에서만 `null`) |
| `SourceComparison.pull_requests` | `maxItems: 5` | 상한 없음(`related=all`일 때만 5개를 넘습니다) |
| 한 요청의 기한 | 없음 | 120초(`request_deadline_ms`). 넘으면 원본의 502 `SOURCE_UNAVAILABLE`입니다. PIPE가 연결을 끊으면 pr-search의 GHE 호출도 멈춥니다 |

operation map의 `query_keys`와 `limits`(`tree_page_entries`·`tree_listing_page`·`window_bytes`·`blob_bytes_max`·`request_deadline_ms` 추가, History의 `page_max` 삭제)가 바뀌었으므로 계약 checksum이 바뀝니다. `protocol_version`은 `PSI-1.0` 그대로입니다 — D-21~D-23과 같이 선택 입력과 선택 응답 키를 더한 변경이고, History는 거절하던 요청을 받아들이는 완화입니다.

**PIPE에 필요한 조치.** 새 파라미터를 보내지 않으면 응답은 전과 같습니다. 다만 예전 `read.source.diff`의 `truncated`로 목록의 완전성을 판단하고 있다면 주의하십시오 — GitHub는 변경 파일을 3,000개까지만 나열하고 그 페이지(30번째)에서 다음 링크를 주지 않으므로, 3,000개에서 잘린 목록도 `truncated: false`·`next_page: null`일 수 있습니다(DEV-793, 실제 GHES는 확인하지 못했습니다). 완전한 목록이 필요하면 30번째 페이지가 가득 찼는지(파일이 3,000개에 닿았는지)로 감지해 `listing=tree`로 이어 읽으십시오. 새 동작을 쓰려면 (1) `SourceTree`·`SourceFile`·`SourceComparison`·`SourceChange`를 엄격하게 검증하는 경우 새 키와 `null` 줄 수를 받도록 스키마를 갱신하고, (2) 창·페이지를 이어 읽을 때 앞 응답의 `revision`·`tree_sha`·`head`·`base`를 그대로 넘겨 다른 리비전과 섞이지 않게 하십시오. 합성 예시 `examples/read.source.file.200.window.json`·`read.source.tree.200.page.json`·`read.source.diff.200.tree-listing.json`을 더했습니다.

## D-26 source blame `read.source.blame` — 기능 게이트 뒤의 가법 operation, PSI-1.0 유지 (CR-135, 2026-09-29)

pr-search의 Time-lapse는 인접 리비전을 비교해 **추정한** 관측 라인 이력이라 blame이 아닙니다. CR-135부터 pr-search는 GitHub GraphQL `Commit.blame`을 **서버 소유 고정 query**로 묻는 원본 조회 `GET /api/v1/source/{repository}/blame`(API-SRC-006)을 두고, 연동은 같은 실행 함수를 부르는 `GET /read/source/{repository}/blame`(API-INT-015, operation `read.source.blame`)을 더했습니다(FR-INT-001 AC-5). 입력은 저장소·40자 커밋 SHA·파일 경로뿐입니다 — 임의 GraphQL 문서·endpoint·토큰을 받는 경로는 없습니다. Time-lapse와 Diff는 바뀌지 않았습니다.

| 자리 | 전 | 후 |
|---|---|---|
| 조회 operation | 10종 | `read.source.blame` 추가. query key는 `path`(필수, 비어 있지 않음)·`revision`(필수, 40자 hex) 둘뿐입니다. 줄 범위·페이지 인자는 없습니다 — GitHub의 `Blame.ranges`가 한 응답에 전부 옵니다 |
| 성공 본문 | 없음 | `SourceBlame`: `{ repository, revision, path, provider: "github_graphql", ranges: [{ start_line, end_line, age, commit: { sha, message_headline, author_name, author_login, authored_at, committed_at } }] }`. 구간은 GitHub 순서 그대로(시작 줄 오름차순, 겹치지 않음)이고 줄 번호는 1부터, `end_line`을 포함합니다. `author_name`·`author_login`은 GitHub가 주지 않으면 `null`입니다(이름으로 계정을 짐작하지 않습니다). 이메일·본문 텍스트·`correlation_id` 키는 없습니다 |
| `Capability` | `search:read`·`source:read`·`merge_number:read` | `source_blame:read` 추가 — `SOURCE_BLAME_ENABLED=true`인 배포에서만 광고합니다 |
| `/context`의 `operations`(`ReadOperationId`) | 조회 10종(M 번호 게이트 반영) | 켜진 배포에서만 `read.source.blame`이 더해집니다 |
| 원본 오류 코드(`ErrorCode`·`SourceErrorResponse`) | 61개 | `SOURCE_BLAME_UNSUPPORTED`(501) 추가 — 이 GHES의 GraphQL 스키마에 `Commit.blame`이 없습니다. 일시 장애·권한 부족이 아니며 다시 불러도 같습니다 |
| `SourceErrorResponse.error.detail` | 401의 `LoginRequiredErrorDetail`만 | blame이 꺼진 배포의 404에 `FeatureDisabledErrorDetail`(`{ "reason": "feature_disabled" }`)이 더해집니다 |
| operation map `limits` | – | `blame_call_timeout_ms` 30000(GitHub 호출 하나의 기한), `graphql_concurrency_max` 2(프로세스당 GraphQL 동시 상한 — REST 조회와 따로 셉니다), `request_deadline_ms` 120000(한 요청의 기한, D-25와 같음) |

**기능 게이트.** `SOURCE_BLAME_ENABLED`는 기본 꺼짐입니다(`true`·`false`·빈 값만 받고 그 밖의 값은 기동 거부). 꺼진 배포에서는 exchange·`/context`의 `capabilities`와 `operations`가 CR-135 전과 같고, 경로는 등록된 채 grant 검사와 엄격한 query 검사(목록 밖·중복 key는 400 `INVALID_REQUEST`) 뒤, **저장소 형식·접근 범위·파라미터를 보기 전에** 원본 봉투의 404 `NOT_FOUND`(`detail.reason = feature_disabled`, 문구 `Blame is not enabled on this deployment.`)로 답합니다. GHE를 부르지 않습니다. M 번호(D-07)와 같은 방식입니다. 켜진 배포의 검사 순서는 다른 source 조회와 같습니다: grant → 저장소 형식(400) → 접근 범위(사용자 범위 ∩ client 허용 목록 — 범위 밖·미등록은 같은 404이고 GHE를 부르지 않음) → 파라미터(400) → GHE. 감사는 다른 source 조회처럼 `entity.view`(대상 `source:blame:<repo>`, 경로·revision만 — 구간·커밋 제목은 남기지 않음)이고 응답은 no-store입니다.

**오류 매핑.** 모두 원본 봉투(`retryable` 없음)이며 GitHub 오류 원문은 응답·로그에 싣지 않습니다. `errors`가 있으면 `data`가 일부 있어도 성공으로 내지 않고, 실패했을 때 추정 결과를 blame인 것처럼 내지 않습니다.

| GitHub의 응답 | pr-search 응답 | PIPE가 할 일(제안) |
|---|---|---|
| GraphQL 스키마에 `Commit.blame`이 없음(필드 검증 오류) | 501 `SOURCE_BLAME_UNSUPPORTED` | 재시도하지 않습니다. 「이 GitHub Enterprise Server는 blame을 제공하지 않는다」로 안내하고 운영자 확인 대상으로 남깁니다 |
| 저장소·리비전·경로가 없음 | 404 `NOT_FOUND` | 같은 revision의 file 조회처럼 「없음」 |
| 주 한도(200 + `RATE_LIMITED`)·부 한도(200/403 + 부 한도 문구)·429 | 429 `SOURCE_RATE_LIMITED` + `Retry-After`(초) | 자동 재시도하지 않고 `Retry-After` 뒤에 사용자가 다시 요청하게 합니다 |
| 401·403(부 한도가 아님)·`FORBIDDEN` | 503 `SOURCE_PERMISSION_REQUIRED` | 일시 장애가 아닙니다. 운영자에게 GitHub App 권한 확인을 요청하게 안내합니다 |
| 5xx·일부 결과(`errors`와 `data`가 함께)·모르는 모양·호출 기한 30초·요청 기한 120초 | 502 `SOURCE_UNAVAILABLE` | 일시 장애로 안내하고 짧은 backoff 뒤 사용자가 다시 시도하게 합니다 |

**GraphQL 한도.** pr-search는 GraphQL 응답의 한도 헤더를 REST 토큰 상태에 넣지 않고, 프로세스 안에서 이후 호출을 막지도(격리) 않습니다 — 한도에 걸린 그 요청만 429와 `Retry-After`로 돌려주며 GitHub 호출을 재시도하지 않습니다. `Retry-After`를 지키는 것은 호출자의 몫입니다. blame은 프로세스당 동시 2개로 묶이므로 PIPE BFF의 source 동시성 제한(D-14)과 별도로 대기가 생길 수 있습니다.

**PSI-1.0을 유지하는 근거 — API 계약 8장 안정성 규칙의 예외.** 8장은 연동 계약을 바꿀 때 `protocol_version`을 함께 올리라고 합니다. 이번에는 올리지 않았습니다. 새 operation은 가법적이고, **기본 배포(게이트 꺼짐)의 exchange·`/context`가 CR-135 전과 같아** PSI-1.0 client가 받는 응답이 바뀌지 않기 때문입니다. 이 사실은 통합 시험 `apps/search-api/integration/integrations/pipe/blame-disabled.test.ts`가 CR-135 전의 능력·조회 목록을 그대로 적어 두고 실제 mTLS 응답과 대조합니다(게이트가 꺼진 경로의 404 봉투와 GHE 호출 0회도 같은 시험이 봅니다). 게이트를 켠 배포는 두 목록에 새 값이 더해집니다 — PIPE가 `Capability`·`ReadOperationId`를 엄격한 enum으로 검증한다면 **켜기 전에** 이 값을 받아들이도록 갱신해야 합니다. OpenAPI와 operation map이 바뀌었으므로 계약 checksum은 바뀝니다.

**PIPE에 필요한 조치.**

1. `capabilities`에 `source_blame:read`가 있을 때만 blame을 부르고 화면에 보입니다. 없으면 blame 기능을 숨깁니다(불러도 404 `feature_disabled`입니다).
2. blame 응답에는 본문이 없습니다. **같은 `revision`**으로 `read.source.file`을 읽어 줄 번호(1부터)로 구간과 조합합니다. `revision`은 브랜치 이름이 아니라 40자 SHA입니다 — 트리·이력 응답의 `revision`을 그대로 넘기십시오.
3. 501·503·429·502를 구분해 안내합니다(위 표). 501은 다시 불러도 같고, 429는 `Retry-After`를 지킵니다.
4. `SourceBlame`·`SourceBlameRange`·`SourceErrorResponse`·`Capability`·`ReadOperationId`를 엄격하게 검증한다면 새 스키마와 enum 값을 받아들이도록 갱신합니다.
5. Time-lapse(추정)와 blame(GitHub가 계산한 귀속)을 섞어 보이지 않습니다. blame이 실패했을 때 추정 결과를 blame인 것처럼 대신 보이지 마십시오.

합성 예시 `examples/read.source.blame.200.json`·`read.source.blame.404.feature_disabled.json`·`read.source.blame.501.json`을 더했습니다. **실제 GHES에서는 확인하지 못했습니다** — 사내 GHES 버전과 `Commit.blame` 지원, 필요한 GitHub App 권한(Contents read로 추정), 오류 본문의 실제 `type`·HTTP 상태, GraphQL 한도 설정, 큰 파일의 blame 지연은 GHE 대역으로만 검증했습니다(`TEST_RESULTS.md` 6장 NOT_RUN).

## D-27 source 경로 목록 `read.source.paths` — 게이트 없는 가법 operation, PSI-1.0 유지 (CR-137, 2026-10-01)

pr-search의 Files & folders 검색(CR-133)은 고정 revision의 파일 경로 목록 `GET /api/v1/source/{repository}/paths`(API-SRC-005)를 읽어 찾습니다. CR-133은 이 목록을 세션 조회로만 두었습니다(PIPE 경로는 404였습니다). CR-137부터 PIPE도 같은 목록을 읽습니다 — `GET /internal/integrations/pipe/v1/read/source/{repository}/paths?revision=&after=`(operation `read.source.paths`, API-INT-016, `mtls+grant`). 사용자가 0.1.0-pilot.21을 사내에 반입하면서 연동 코드에 이 조회를 더했고, pr-search는 계약·시험·문서를 그 코드에 맞췄습니다(사용자 결정 2026-10-01).

| 자리 | 전 | 후 |
|---|---|---|
| 조회 operation | 11종 | `read.source.paths` 추가. query key는 `revision`(필수, 40자 hex)·`after`(선택, 직전 응답의 `next_after`) 둘뿐입니다. 목록 밖 key·중복 key는 연동 계층의 400 `INVALID_REQUEST`이고, 형식이 틀린 `revision`·`after`(빈 값·4096자 초과·NUL)는 원본의 400 `INVALID_PARAMETER`입니다 |
| 성공 본문 | 없음 | `SourcePaths`: `{ repository, revision, paths: [{ path, kind }], next_after, incomplete }`. `kind`는 `file`·`symlink`이고 디렉터리·서브모듈은 싣지 않습니다. 원본과 같으며 `correlation_id` 키와 파일 본문이 없습니다 |
| `Capability` | `search:read`·`source:read`·(게이트) | 바뀌지 않습니다. 새 capability 없이 `source:read`로 부릅니다 |
| `/context`의 `operations`(`ReadOperationId`) | 조회 10종(M 번호 게이트 반영) + 켜진 배포의 blame | **모든 배포**에서 `read.source.paths`가 더해집니다(게이트 없음) |
| operation map `limits` | – | `paths_walk_page` 5000(걷기 한 페이지의 경로 수), `paths_walk_tree_calls` 100(걷기 한 페이지의 디렉터리 호출 수), `paths_recursive_timeout_ms` 45000(재귀 트리 호출 하나의 기한 — 넘으면 걷기로 넘어갑니다), `request_deadline_ms` 120000(D-25와 같습니다) |

**끝을 판정하는 규칙.** 재귀 트리 한 번이 잘리지 않으면 전부가 한 응답에 오고 `next_after`는 `null`입니다. GitHub가 재귀 목록을 잘랐거나(10만 항목·7MB) 45초 안에 답하지 않았거나 5xx로 답하면, pr-search는 디렉터리 단위로 걸어 같은 경로 순서의 페이지를 줍니다. 한 페이지는 경로 5,000개 또는 디렉터리 호출 100번에서 멈추므로 **`paths`가 적거나 비어 있어도 `next_after`가 있으면 끝이 아닙니다.** 끝은 `next_after: null`뿐입니다. `incomplete: true`는 GitHub가 어떤 디렉터리 목록을 잘라 빠진 경로가 있을 수 있다는 뜻입니다.

**접근 범위.** 검사 순서는 다른 source 조회와 같습니다: grant → 엄격한 query → 저장소 형식(400) → 접근 범위(사용자 범위 ∩ client 허용 목록 — 범위 밖·미등록은 GHE를 부르지 않는 동일 404) → 파라미터(400) → GHE. GitHub 실패의 봉투·코드도 다른 source 조회와 같습니다(원본 봉투).

**PSI-1.0을 유지하는 근거 — API 계약 8장의 두 번째 예외.** 8장은 연동 계약을 바꿀 때 `protocol_version`을 함께 올리라고 합니다. D-26(blame)은 기본 배포의 exchange·`/context`가 바뀌지 않아서 예외가 되었지만, 이번에는 그 근거가 없습니다 — 게이트가 없어 **모든 배포의 `/context` `operations`에 새 값이 나타납니다.** 그래도 `protocol_version`을 올리지 않았습니다(사용자 결정 2026-10-01). 변경은 가법적이고(기존 operation·capability·응답 본문의 뜻은 그대로입니다), 버전을 올리면 버전 상수·예시·발급 시험·적합성 벡터와 PIPE 쪽 버전 검사가 함께 바뀌어야 하기 때문입니다. capability 목록은 바뀌지 않습니다. 통합 시험 `blame-disabled.test.ts`는 이제 「CR-135 전의 목록 + `read.source.paths`」를 기본 배포의 조회 목록으로 적어 두고 실제 mTLS 응답과 대조합니다. OpenAPI와 operation map이 바뀌었으므로 계약 checksum은 바뀝니다.

**PIPE에 필요한 조치.**

1. `ReadOperationId`를 엄격한 enum으로 검증한다면 **이 판의 pr-search를 배포하기 전에** `read.source.paths`를 받아들이도록 갱신합니다. 갱신하지 않으면 `/context` 응답을 거절할 수 있습니다.
2. 이 조회를 쓰려면 `/context`의 `operations`에 `read.source.paths`가 있을 때만 부릅니다. CR-137 전 판에는 없고, 그 판에서 이 경로는 404입니다.
3. `next_after`가 `null`이 될 때까지 이어 읽고, 끝나기 전에는 「결과 없음」이라고 단정하지 않습니다. `incomplete: true`면 목록이 완전하지 않을 수 있다고 안내합니다.
4. `SourcePaths`를 엄격하게 검증한다면 새 스키마를 받아들이도록 갱신합니다.

캡처한 예시 `examples/read.source.paths.200.json`을 더했고, 기본 배포를 캡처한 `examples/context.200.json`의 `operations`에 `read.source.paths`를 더했습니다. **실제 GHES에서는 이 경로를 부르지 않았습니다** — PIPE 하네스의 대역 source reader로만 검증했습니다. 경로 목록 자체의 GitHub 동작(재귀·걷기·잘림)은 세션 조회 API-SRC-005와 같은 실행이며 CR-133이 검증한 그대로입니다.

## D-28 source 조회의 남은 총량 상한을 없앤다 — `offset` 없는 파일·디렉터리도 창·페이지, `limits`는 작업량만, PSI-1.0 유지 (CR-138, 2026-10-01)

CR-132(D-25)는 이어 읽기를 더했지만, `offset`을 보내지 않는 예전 호출에는 파일 256 KiB·4,000줄, 디렉터리 5,000개 상한을 그대로 두었습니다. CR-138부터 pr-search의 source 조회에는 **총량 상한이 없습니다.** `offset`을 보내지 않아도 첫 창·첫 페이지이고, 응답의 `next_offset`으로 끝까지 잇습니다. 변경 목록은 30번째 페이지의 `truncated`가 GitHub의 3,000개 원천 상한에 닿았는지를 제대로 알립니다(DEV-793). 한 번의 작업량(파일 1 MiB 창, 디렉터리 5,000개·이력 50개·변경 목록 100개·트리 비교 1,000개·경로 5,000개 페이지)과 한 요청의 기한(120초)은 그대로이고, 한 HTTP 응답에 전부를 합쳐 주는 경로는 만들지 않았습니다.

| 자리 | 전 | 후 |
|---|---|---|
| `read.source.file`, `offset` 없음 | 256 KiB·4,000줄을 넘으면 200 `too_large`. 1MB를 넘는 파일은 GitHub가 기본 미디어 타입에 준 403이 권한 오류로 분류되어 503 `SOURCE_PERMISSION_REQUIRED` | offset 0의 창입니다. 1 MiB에 들면 완전한 본문(`next_offset: null`), 넘으면 첫 창과 `next_offset`입니다 |
| `read.source.file`의 `too_large` | 256 KiB·4,000줄(예전 호출), GitHub API의 100MB | GitHub API가 본문을 주지 않는 100MB 초과뿐입니다. GitHub가 Contents를 403으로 거절하면 트리 항목의 크기로 가려, 크기 때문이면 `too_large`(`size`·`sha`는 트리 항목의 값), 아니면 원래 오류(503 `SOURCE_PERMISSION_REQUIRED`)입니다. 트리를 걷다가 한도·취소·일시 장애에 걸리면 그 오류(429와 `Retry-After` 등)로 답합니다 — 권한 오류로 바꾸지 않습니다 |
| `read.source.tree`, `offset` 없음 | 정렬 전 앞 5,000개에서 자르고 `truncated: true` | 정렬한 첫 페이지(5,000개)와 `next_offset`. `truncated`는 GitHub가 목록을 잘랐을 때뿐입니다 |
| `read.source.diff` 30번째 페이지의 `truncated` | GitHub가 다음 링크를 줄 때만 true — GitHub는 3,000개에서 멈추며 링크를 주지 않으므로 잘린 목록도 false였습니다 | 다음 링크, 가득 찬 30번째 페이지(PR·커밋 모두), PR의 `changed_files` > 3000 가운데 하나면 true입니다. 정확히 3,000개여도 true이고 `listing=tree`가 같은 목록을 줍니다. `changed_files`는 true를 더할 뿐 거르지 않습니다 — 실제 GHES가 경계에서 주는 값을 확인하지 못했으므로, 그 값이 틀려도 목록이 조용히 끊기지 않게 했습니다 |
| `SourceFile`의 `offset`·`next_offset` | 선택(`offset`을 보낸 요청에만) | 필수(늘 있습니다) |
| `SourceTree`의 `tree_sha`·`offset`·`next_offset`·`total` | 선택(`offset`을 보낸 요청에만) | 필수(늘 있습니다) |
| operation map | `limits`에 `entries_max` 5000, `file_bytes_max` 262144, `file_lines_max` 4000, `blob_bytes_max`, diff의 `page_max` 30 | 앞 셋을 지웠습니다. `blob_bytes_max`(file)와 `page_max`·새 `changed_files_max` 3000(diff)은 `upstream_limits`로 옮겼습니다 — GitHub API의 한계입니다. `limits`에는 한 요청·한 페이지·한 창의 작업량과 기한만 남습니다(`common.limits_meaning`) |
| 참고 구현 | 없음 | `reference/source-complete.mjs`와 타입 `reference/source-complete.d.mts` — `getCompleteFile`·`getCompleteTree`·`getAllPaths`·`getCompleteHistory`·`getCompleteDiffFiles`. 429·502·503(503 `SOURCE_PERMISSION_REQUIRED` 제외)과 보내지 못한 요청은 같은 위치에서 다시 부르고, 끝내 실패하면 `SourceReadError.resume`에 그때까지 받은 부분과 멈춘 위치를 싣습니다 — 같은 함수의 `options.resume`에 넘기면 받은 부분을 다시 받지 않고 잇습니다 |

**무엇이 그대로이고 무엇의 뜻이 바뀌었나.** 256 KiB·4,000줄 이하 파일과 5,000개 이하 디렉터리의 응답 값은 전과 같습니다(키만 더해집니다). 전에 거절되던 파일(`too_large`·503)은 이제 본문을 받습니다. 두 경우에 **기존 필드의 뜻이 바뀝니다.** (1) 1 MiB를 넘는 파일의 `offset` 없는 응답은 `status: text`이지만 `text`는 첫 창뿐입니다. (2) 5,000개를 넘는 디렉터리의 `offset` 없는 응답은 `truncated: false`이지만 `entries`는 첫 5,000개뿐입니다. **`text`와 `entries`는 `next_offset`이 `null`일 때만 완전합니다.** `next_offset`을 보지 않는 클라이언트는 두 경우를 완전한 결과로 오해합니다. 뒤 창이 텍스트가 아니면(NUL 등) 그 창의 `status`가 `binary`입니다 — 앞 창의 텍스트를 완전한 본문으로 쓰지 마십시오.

**PSI-1.0을 유지하는 근거 — API 계약 8장의 세 번째 예외(사용자 결정 2026-10-01).** 이번 변경은 가법적이지 않습니다(위 두 경우). 그래도 `protocol_version`을 올리지 않았습니다. D-27과 같이 버전을 올리면 버전 상수·예시·발급 시험·적합성 벡터와 PIPE 쪽 버전 검사가 함께 바뀌어야 하고, 뜻이 바뀌는 응답은 전에 거절되거나 절삭 표시가 붙던 것뿐이기 때문입니다. 대가는 아래 1번 조치입니다. OpenAPI와 operation map이 바뀌었으므로 계약 checksum은 바뀝니다.

**PIPE에 필요한 조치.**

1. **이 판의 pr-search를 켜기 전에** 파일·트리 응답의 `next_offset`을 따라 끝까지 읽도록 갱신합니다(`getCompleteFile`·`getCompleteTree`). 갱신하지 않으면 큰 파일의 첫 창, 큰 디렉터리의 첫 5,000개를 전부로 다룹니다.
2. `SourceFile`·`SourceTree`를 엄격하게 검증한다면 새로 필수가 된 키를 받아들입니다(값은 전에도 `offset`을 보내면 오던 것입니다).
3. 변경 목록이 완전해야 하면 30번째 페이지의 `truncated`가 참일 때 같은 `base`·`head`로 `listing=tree`를 `next_after`가 `null`이 될 때까지 읽습니다(`getCompleteDiffFiles`). GitHub 목록에 있던 파일은 줄 수·이전 경로가 그대로이고, 트리 비교로만 안 파일은 그 값이 `null`입니다.
4. 창·페이지를 이을 때는 앞 응답이 고정한 값(`revision`·`tree_sha`·`head`·`base`, 파일의 blob `sha`)을 넘기고, 다른 값이 오면 처음부터 다시 읽습니다.
5. 429·502·503은 한도·일시 장애입니다. `Retry-After`를 지켜 같은 위치에서 다시 부르고, 이미 받은 창·페이지를 버리지 않습니다(참고 구현의 `resume`). 503 `SOURCE_PERMISSION_REQUIRED`는 GitHub App 권한 설정 문제라 다시 불러도 같습니다. 사용자·client별 동시성 상한은 여전히 PIPE BFF가 둡니다(D-14) — 끝까지 읽기는 호출 수가 많으므로 큰 파일·큰 이력은 순차로 읽기를 권합니다.
6. operation map을 읽는 도구가 있다면 `limits`에서 사라진 세 키와 새 `upstream_limits`를 반영합니다.

**남은 원천 한계.** GitHub API는 100MB를 넘는 blob의 본문을 주지 않습니다(Contents·Blobs 문서). pr-search의 미러는 blob이 없는 부분 클론이고(보안 THR-015) 지연 인출을 막으며 search-api에는 미러가 없어, 그 파일을 다른 길로 읽을 수 없습니다 — git 프로토콜로 일시 인출하는 대안은 결정 대기입니다(OD-020). GitHub 목록의 3,000개(`listing=tree`가 잇습니다)와 재귀 트리의 10만 항목·7MB(경로 목록이 디렉터리 단위로 걷습니다)는 제품이 이어 읽습니다. GitHub는 바이트 범위를 받지 않으므로, 창 k는 파일 앞 k MiB를 다시 받습니다 — 100MB 파일을 끝까지 읽으면 GHE에서 모두 5GB 남짓을 받고, 마지막 창은 한 요청의 기한 120초 안에 100MB를 받아야 합니다(GHE가 초당 약 1MB 이상 내 주어야 합니다).

캡처 예시 `examples/read.source.file.200.json`·`read.source.tree.200.json`에 새 필수 키를 더했고, 합성 예시 `read.source.file.200.first-window.json`(offset 없는 1 MiB 초과 파일)·`read.source.file.200.too-large.json`(100MB 초과)·`read.source.diff.200.truncated.json`(30번째 페이지)을 더했습니다. `read.source.tree.200.truncated.json`은 이제 GHE가 목록을 자른 경우만 뜻합니다. **실제 GHES에서는 부르지 않았습니다** — 대형 픽스처는 GHE 대역(바이트 범위 없는 원시 본문, 3,000개 목록, 100MB 초과 거절 모형)과 실제 전송·실제 mTLS 리스너로 검증했습니다. 100MB를 넘는 파일에 GitHub가 주는 실제 상태 코드는 문서에 없어 대역은 403으로 두었습니다 — pr-search는 Contents가 403일 때만 트리 항목의 크기로 판정합니다. 다른 상태(예: 404)가 오면 이 판정을 타지 않고 그 상태의 뜻대로 답합니다.

## 확인하지 못한 것

| 항목 | 상태 | 이유 |
|---|---|---|
| 사내 CA가 발급한 실제 client 인증서의 subjectAltName 형식 | 미확인 | 사내 PKI를 볼 수 없다. 설정은 URI·DNS SAN 정확 일치나 SHA-256 지문 고정을 모두 받는다 |
| 사내 HAProxy가 L4 passthrough로 구성 가능한가 | 미확인 | 운영 구성을 볼 수 없다 (D-02) |
| 사내 GHES에서 설치 토큰으로 `GET /users/{login}`이 되는가 | 미확인 | 실 GHE에 닿지 않았다. GitHub REST 문서상 공개 사용자 조회다 |
| 사내 GHES의 GraphQL `Commit.blame` 지원과 필요한 GitHub App 권한 | 미확인 | 실제 GHES에 닿지 않았다. `SOURCE_BLAME_ENABLED`를 켜기 전에 운영자가 확인한다 (D-26) |
| 사내 GHES GraphQL의 실제 오류 모양(`type`·HTTP 상태)·한도 설정·큰 파일의 blame 지연 | 미확인 | GHE 대역으로만 검증했다 (D-26) |
| PIPE JWT의 로그인 문맥·만료 추출 | PIPE 담당 | pr-search가 볼 수 없다 |
| 사내 GHES가 100MB를 넘는 파일에 주는 실제 응답(상태 코드)과 저장소 업로드 한도(100MB를 넘는 blob이 있을 수 있는가) | 미확인 | GitHub 문서에 없다. 대역은 403으로 두었고 pr-search는 Contents가 403일 때만 트리 항목의 크기로 판정한다 — 다른 상태면 그 뜻대로 답한다 (D-28) |
| 사내 GHES가 변경 파일 3,000개 경계에서 주는 PR의 `changed_files` | 미확인 | GitHub 문서는 뜻을 적지 않는다. pr-search는 그 값으로 `truncated`를 거르지 않는다 — 30번째 페이지가 가득하면 늘 트리 비교로 확인한다 (D-28) |
| 사내 GHES가 원시 본문을 내 주는 속도 — 100MB 가까운 파일의 마지막 창이 기한 120초 안에 끝나는가 | 미확인 | GHE 대역으로만 쟀다 (D-28) |
| 사내 표준 위임 서버(OIDC Token Exchange 등)의 존재 | 미확인 | 있으면 ADR로 비교한다. 한쪽 저장소만 protocol을 바꾸지 않는다 |
