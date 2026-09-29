# DEPLOYMENT_AND_ROLLBACK — PIPE 연동 private 리스너의 배포·키 교체·회수·롤백

> 분류: 인수인계 자료. 이 문서의 설정은 **예시**이며 운영에 적용하지 않았습니다. 실제 호스트·인증서·키·매핑은 운영 담당이 정합니다 (`PENDING_OPERATOR_INPUT`).

## 1. 형상 — TLS passthrough만 지원한다

```text
PIPE Django (서버)
   │  HTTPS + client 인증서 (mTLS)
   ▼
[선택] HAProxy  mode tcp  (L4 passthrough — TLS를 끝내지 않는다)
   │
   ▼
search-api 프로세스
   ├─ 공개 리스너  :3002  (기존 /api/v1/* — web만 부른다. 바뀌지 않았다)
   └─ private 리스너 PIPE_SEARCH_INTEGRATION_HOST:PORT  (TLS 1.2+, client 인증서 필수)
         /internal/integrations/pipe/v1/*  만 등록되어 있다
```

- private 리스너는 **search-api 프로세스 안의 별도 Fastify 인스턴스**입니다. 새 서비스·새 DB 연결·새 Redis를 만들지 않습니다. 공개 리스너와 같은 PostgreSQL pool, 같은 Redis, 같은 Elasticsearch, 같은 GHE App 자격을 씁니다 (ADR-025).
- 공개 리스너에는 `/internal/*` 경로가 **하나도 없습니다.** web의 프록시는 언제나 `/api/v1/*`만 만듭니다.
- TLS는 search-api가 끝냅니다. 프록시가 TLS를 끝내고 `X-SSL-Client-*` 헤더를 넘기는 형상은 지원하지 않습니다 (CONTRACT_DIFF D-02). HAProxy를 둔다면 `mode tcp`로 둡니다.
- private 포트는 **사내 private 망에만** 열어야 합니다. 공개 ingress·브라우저가 닿는 망에서 이 포트로 가는 경로를 만들지 않습니다. mTLS가 있더라도 네트워크 ACL은 추가 방어로 둡니다.

## 2. 환경 변수

| 변수 | 필수 | 뜻 |
|---|---|---|
| `PIPE_SEARCH_INTEGRATION_ENABLED` | – | `true`만 켭니다. 비었거나 `false`면 꺼짐(리스너 없음). 다른 값은 기동 거부 |
| `PIPE_SEARCH_INTEGRATION_HOST` | 켤 때 | 바인드 주소 (private 인터페이스 IP 또는 컨테이너 안 `0.0.0.0`) |
| `PIPE_SEARCH_INTEGRATION_PORT` | 켤 때 | 포트. `SEARCH_API_PORT`와 달라야 합니다 |
| `PIPE_SEARCH_INTEGRATION_TLS_KEY_FILE` | 켤 때 | private 리스너 서버 인증서의 비밀키 PEM |
| `PIPE_SEARCH_INTEGRATION_TLS_CERT_FILE` | 켤 때 | 서버 인증서 PEM (PIPE가 신뢰할 CA가 발급) |
| `PIPE_SEARCH_INTEGRATION_TLS_CLIENT_CA_FILE` | 켤 때 | PIPE client 인증서를 발급한 CA 묶음 PEM |
| `PIPE_SEARCH_INTEGRATION_POLICY_FILE` | 켤 때 | client 정책 JSON (3장) |
| `GHE_BASE_URL` | 켤 때 | 기존 값. 호스트가 binding의 `ghe_host` 대조 기준이다 |
| `AUTH_ENABLED` | – | `false`를 명시한 배포에서는 켤 수 없습니다 (기동 거부) |

켰는데 무엇 하나라도 없거나 틀리면 search-api가 **기동하지 않습니다.** 세션 인증(GHE App 자격)·Elasticsearch·Redis가 없는 배포에서도 기동하지 않습니다. 운영(`NODE_ENV=production`)에서는 handoff의 적합성 시험 공개키가 설정되어 있으면 기동하지 않습니다.

### 2.1 source blame (CR-135, 선택 — 기본 꺼짐)

`read.source.blame`(CONTRACT_DIFF D-26)은 연동과 별개인 기능 게이트 뒤에 있습니다. 두 변수는 공개 경로(API-SRC-006)와 연동 경로에 함께 적용됩니다.

| 변수 | 필수 | 뜻 |
|---|---|---|
| `SOURCE_BLAME_ENABLED` | – | `true`만 켭니다. 비었거나 `false`면 꺼짐(기본)이고, 그 배포는 PIPE에 `source_blame:read`·`read.source.blame`을 광고하지 않으며 blame 경로는 404 `feature_disabled`입니다(GHE 호출 없음). 다른 값은 기동 거부 |
| `GHE_GRAPHQL_URL` | – | GitHub GraphQL 끝점. 비우면 REST 루트(`GHE_API_URL`, 없으면 `GHE_BASE_URL` + `/api/v3`)에서 도출합니다 — `/api/v3`로 끝나면 그 꼬리를 `/api/graphql`로 바꾸고(GHES: `https://<host>/api/graphql`), 아니면 `<REST 루트>/graphql`입니다. 명시한다면 http(s) URL이고 query·fragment가 없어야 하며, 어기면 기동 거부 |

켜는 순서:

1. 사내 GHES의 GraphQL에서 `Commit.blame`이 되는지, search-api의 GitHub App 설치 토큰이 대상 저장소에 필요한 권한(Contents read로 추정)을 갖는지, search-api 호스트에서 GraphQL 끝점에 닿는지 확인합니다. pr-search는 이것을 실제 GHES에서 확인하지 못했습니다(`TEST_RESULTS.md` 6장 NOT_RUN).
2. 도출 주소가 사내 형상과 다르면(프록시 경로 등) `GHE_GRAPHQL_URL`을 명시합니다.
3. PIPE가 `Capability`·`ReadOperationId`를 엄격한 enum으로 검증한다면 새 값을 받아들이는 PIPE 판이 **먼저** 배포되어 있어야 합니다.
4. `SOURCE_BLAME_ENABLED=true`로 search-api를 재기동합니다.
5. 시험 사용자의 exchange·`/context`에 `source_blame:read`·`read.source.blame`이 있는지, 알려진 파일·revision의 `/read/source/{repository}/blame`이 200이고 구간이 GHES 웹 화면의 blame과 같은지 봅니다. 501 `SOURCE_BLAME_UNSUPPORTED`면 이 GHES는 blame을 제공하지 않으므로 되돌립니다. 503 `SOURCE_PERMISSION_REQUIRED`면 App 권한을 먼저 고칩니다.

되돌리기: `SOURCE_BLAME_ENABLED=false`(또는 빈 값)로 재기동합니다. 능력·조회 목록에서 blame이 빠지고 경로는 404 `feature_disabled`가 됩니다. 새 표·마이그레이션이 없어 지울 자료가 없습니다(조회 감사 기록은 남습니다). 재기동 전에 발급된 grant(최대 300초)의 능력 목록을 캐시한 PIPE는 그동안 blame을 불러 404 `feature_disabled`를 받을 수 있으므로 그 코드를 「기능 꺼짐」으로 처리하게 합니다. `GHE_GRAPHQL_URL`은 blame 말고는 쓰지 않으므로 남겨 둬도 됩니다.

## 3. client 정책 파일 (`pipe-search-integration-policy/v1`)

예시는 `deploy-examples/pipe-integration-policy.example.json`입니다. 규칙은 다음과 같습니다.

- 모르는 키는 기동 거부입니다 (오타가 기본값이 되지 않게).
- `signing_keys[].public_key_file`은 **공개키(SPKI PEM)만** 받습니다. 비밀키가 들어 있으면 기동 거부입니다. RSA 2048비트 이상만 받습니다.
- `tls_client`에는 `certificate_sha256`(leaf 인증서 DER의 SHA-256, 콜론 표기 허용)과 `subject_alt_names`(`URI:…`·`DNS:…`의 **정확 일치**) 중 하나 이상이 있어야 합니다. 같은 인증서가 두 client를 가리키면 기동 거부입니다.
- `repository_ids`는 비어 있을 수 없고 500개 이하입니다. pr-search에 **등록된 저장소 ID**를 적습니다. 실제로 보이는 저장소는 사용자의 기존 권한과 이 목록의 교집합입니다.
- `status: disabled`면 그 client의 모든 요청이 403 `CLIENT_DISABLED`입니다 (재기동 필요). 재기동 없는 즉시 차단은 6장의 긴급 회수를 씁니다.
- `policy_version`은 추적용입니다. 정책은 요청마다 다시 평가되므로 이 값으로 grant를 죽이지 않습니다.

## 4. 키와 인증서 교체

### 4.1 서명 키 정상 교체 (PIPE → pr-search)

1. PIPE가 새 RSA 키 쌍을 만들고 새 `kid`와 **공개키만** 넘깁니다.
2. pr-search 정책 파일의 `signing_keys`에 새 항목을 **추가**하고 배포합니다 (옛 키는 그대로 둡니다).
3. PIPE가 새 `kid`로 서명을 시작합니다.
4. 옛 키로 발급된 grant가 모두 끝나도록 **최소 420초**(grant 300초 + 진단 창 120초)를 기다린 뒤 옛 키를 뺍니다. 먼저 빼면 그 키로 발급된 grant가 `CLIENT_DISABLED`로 죽고, PIPE는 이를 자동 재발급하지 않습니다 (CONTRACT_DIFF D-05).

### 4.2 client 인증서 교체

- SAN 정확 일치로 client를 정했다면 같은 SAN의 새 인증서를 PIPE에 배포하기만 하면 됩니다. 지문 고정을 썼다면 새 지문을 먼저 **추가**합니다.
- grant는 발급에 쓴 인증서 지문에 묶입니다. PIPE는 인증서를 바꾸면 grant 캐시를 버리고 새 인증서로 다시 발급받아야 합니다. 옛 grant를 새 인증서로 쓰면 401 `GRANT_BINDING_MISMATCH`입니다.
- 서버 인증서 교체는 search-api 재기동이 필요합니다.

### 4.3 긴급 회수 (유출 대응)

재기동 없이 **모든 복제본에서 즉시** 효력이 있습니다. 회수는 되돌리지 않습니다. 새 키·새 인증서·새 client_id로 교체합니다.

```bash
# 계획만 본다 (기본 dry-run)
docker compose run --rm --no-deps -T search-api node dist/pipe-integration-cli.js \
  credentials revoke --client-id pipe-prod --kind signing_key --id pipe-signing-2026-01 \
  --reason "키 유출 의심 INC-1234" --actor "$(id -un)"
# 적용
docker compose run --rm --no-deps -T search-api node dist/pipe-integration-cli.js \
  credentials revoke --client-id pipe-prod --kind signing_key --id pipe-signing-2026-01 \
  --reason "키 유출 의심 INC-1234" --actor "$(id -un)" --apply
```

`--kind`는 `client`(그 client 전체), `signing_key`(그 `kid`로 발급된 grant와 새 assertion), `certificate`(그 인증서 지문의 연결과 grant)입니다. `credentials list`가 현재 회수 목록을 보입니다.

## 5. identity binding 운영

binding은 **사람이 검증한 매핑만** 넣습니다. pr-search에 한 번 로그인해 `app_user` 행과 GHE 숫자 ID가 있는 사용자만 연결할 수 있습니다. 새 사용자를 자동으로 만들지 않습니다.

```bash
# 1) 가져오기 파일 (JSON 배열)
[
  { "issuer": "urn:corp:pipe:prod", "subject": "<PIPE 불변 사용자 ID>",
    "prs_user_id": "github:<GHE 숫자 ID>", "ghe_host": "<GHE_BASE_URL의 호스트>",
    "ghe_user_id": <GHE 숫자 ID>, "verification_reference": "<검증 근거 문서 번호>" }
]
# 2) dry-run — 계획과 충돌만 출력한다
docker compose run --rm --no-deps -T -v "$PWD/bindings.json:/tmp/bindings.json:ro" search-api \
  node dist/pipe-integration-cli.js bindings import --file /tmp/bindings.json --actor "$(id -un)"
# 3) 검토 뒤 적용 — 충돌이 하나라도 있으면 아무것도 쓰지 않는다
... bindings import --file /tmp/bindings.json --actor "$(id -un)" --apply
# 끄기 (그 사용자의 grant가 다음 요청부터 거절된다)
... bindings disable --issuer urn:corp:pipe:prod --subject <subject> --reason "<사유>" --actor "$(id -un)" --apply
# 목록
... bindings list --issuer urn:corp:pipe:prod
```

충돌로 보고하는 것: 파일 안 중복, 배포 GHE 호스트와 다른 호스트, 없는 사용자, `app_user`의 GHE 숫자 ID와 다른 값, 같은 subject가 다른 사용자에 묶인 경우, 같은 사용자·GHE 계정이 다른 subject에 활성으로 묶인 경우. 기존 매핑은 자동으로 덮어쓰지 않습니다. 모든 변경은 `pipe_integration_event`에 `prsctl:<사용자>`와 함께 남습니다.

`prsctl`에는 아직 `pipe` 하위 명령이 없습니다. 위처럼 `docker compose run`으로 부르거나, `prsctl role`과 같은 방식의 하위 명령을 추가하는 것은 후속 작업입니다 (WP-097 범위 밖).

## 6. 보존과 정리

| 표 | 정리 | 명령 |
|---|---|---|
| `pipe_integration_grant` | 만료 뒤 보존 기간(기본 24시간)이 지난 행 | `purge --grant-retention-hours 24` |
| `pipe_integration_auth_context` | `auth_expires_at`·회수 시각 중 늦은 쪽에서 보존 기간(기본 30일)이 지나고 grant가 남지 않은 행 | `purge --context-retention-days 30` |
| `pipe_integration_event` | 애플리케이션 롤이 지울 수 없다 (추가 전용) | 보존 정책은 운영 결정. `prs_admin`으로 정리 |
| `pipe_integration_identity_binding`, `…_credential_revocation` | 지우지 않는다 | – |

`purge`도 기본이 dry-run입니다. 하루 한 번 `--apply`로 돌리는 것을 권합니다. 회수 표식(문맥)은 원 로그인 자격 만료 뒤에도 보존 기간만큼 남겨야 같은 옛 JWT의 재연결을 막습니다.

## 7. 자원 상한 (pr-search 쪽)

| 항목 | 값 | 근거 |
|---|---|---|
| 요청 본문 | 16KiB (JSON만) | private 리스너 설정 |
| assertion 길이 | 8192자 | `assertion.ts` |
| 요청 처리 상한 | 60초 | private 리스너 `requestTimeout` |
| 검색 ES 마감 | 3초 → 504 `SEARCH_TIMEOUT` | 원본과 같다 |
| 검색 `size` | 기본 25, 최대 200 (초과 시 절삭) | 원본과 같다 |
| source 파일 | 256KiB·4000줄, 초과 시 200 `status: too_large` | 원본과 같다 |
| source 트리 | 5000 항목, 초과 시 `truncated: true` | 원본과 같다 |
| source diff | 페이지 30까지 | 원본과 같다 |
| source 한 요청의 기한 | 120초 → 502 `SOURCE_UNAVAILABLE` | 원본과 같다 (CR-132, `SOURCE_REQUEST_DEADLINE_MS`) |
| source blame의 GitHub 호출 기한 | 30초 → 502 `SOURCE_UNAVAILABLE`, 재시도 없음 | 원본과 같다 (CR-135, `SOURCE_BLAME_TIMEOUT_MS`) |
| source blame의 GraphQL 동시성 | 프로세스당 2 (REST 조회와 따로 센다) | `@prs/github` `GRAPHQL_CONCURRENCY` (CR-135) |
| GHE 사용자 조회 동시성 | 프로세스당 8 | `boundedDirectory` |
| 접근 범위 GHE 갱신 동시성 | 프로세스당 20 | 원본 `AccessScopeResolver` |

사용자·client별 rate limit은 pr-search에 없습니다 (원본에도 없다). PIPE BFF가 둡니다 (CONTRACT_DIFF D-14).

## 8. 롤백

1. **연동만 멈춘다:** `PIPE_SEARCH_INTEGRATION_ENABLED=false`로 두고 search-api를 재기동합니다. private 리스너가 사라지고 공개 경로·기존 로그인·검색·Jobs는 그대로입니다.
2. **재기동 전에 즉시 막아야 하면:** 4.3의 `credentials revoke --kind client --apply`로 모든 복제본에서 곧바로 거절합니다.
3. **표를 지우지 않습니다.** 마이그레이션 033은 추가 전용이며, down 스크립트는 개발·시험용입니다. 운영에서 지우면 회수 표식과 이벤트 기록이 사라집니다.
4. PIPE 쪽은 `PR_SEARCH_BFF_ENABLED=0`(PIPE 명명 규칙에 맞춘 이름)으로 BFF를 끄고 연결 비활성을 표시합니다.

## 9. 활성화 전 smoke (이 세션에서 실행하지 않음 — NOT_RUN)

| 단계 | 확인 | 상태 |
|---|---|---|
| 1 | PIPE 서버에서 client 인증서 **없이** private 포트에 연결하면 TLS 핸드셰이크가 실패한다 | NOT_RUN |
| 2 | 공개 ingress·web 주소로 `/internal/integrations/pipe/v1/context`가 닿지 않는다 | NOT_RUN |
| 3 | 시험 사용자 binding 하나로 exchange → `/context` → `/read/repositories` → `/read/search`가 된다 | NOT_RUN |
| 4 | 그 사용자가 pr-search 웹에서 보는 저장소와 PIPE 연동 결과가 허용 목록 교집합으로 일치한다 | NOT_RUN |
| 5 | `revoke-context` 뒤 같은 문맥의 발급이 403 `CONTEXT_REVOKED`다 | NOT_RUN |
| 6 | `credentials revoke --kind client` 뒤 모든 요청이 403이고, 되돌림은 새 client_id로만 된다 | NOT_RUN |
| 7 | 롤백(1장) 뒤 공개 로그인·검색이 그대로다 | NOT_RUN |
