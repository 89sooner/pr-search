# TEST_RESULTS — pr-search PIPE 연동 수신부 (PSI-1.0)

> 분류: 인수인계 자료. 형식은 `03_SECURITY_AND_CONTRACT_ACCEPTANCE.md` 3장을 따릅니다. **이 문서의 PASS는 pr-search 저장소 안에서 실행한 시험의 결과입니다.** 사내 CA·운영 HAProxy·실제 GHE·실제 사용자 매핑·PIPE 서버와의 end-to-end는 실행하지 않았고 NOT_RUN으로 적었습니다.

```text
Contract version / checksum: PSI-1.0 / manifest.json의 contract_checksum (`3c7fbe925a8b861b53aeaa38fcb7c86938512808803d8fb001f5aaca5af01a1b`)
Repo / baseline HEAD / implementation HEAD: 89sooner/pr-search / 52cf27f191abca4622bb4c8d408111b1efe538de /
  미커밋 작업 트리 (브랜치 feature/pipe-integration-auth, commit·push·PR은 사용자 지시 전)
Toolchain / environment: Node 22.23.2, pnpm 10.33.0, Vitest 4.1.11, TypeScript 5.9.3, Linux(WSL2).
  PostgreSQL·Redis·Elasticsearch는 이 작업 전용 격리 컨테이너(prs-psi-postgres·prs-psi-redis·prs-psi-es, 127.0.0.1),
  시험 DB prs_test_psi. mTLS는 시험마다 openssl로 만든 시험 CA·서버·client 인증서로 127.0.0.1에서 실제 핸드셰이크.
Commands actually run: 2장
```

## 1. 결론

- 수용 시험 66개 중 **57개 PASS**(공동 항목은 pr-search 부분), **9개 N/A**(PIPE 책임: PSI-B02, PSI-E01~E04, PSI-E07~E09, PSI-G02)입니다. pr-search 책임 항목은 모두 시험 이름으로 연결했고 최종 실행에서 전부 통과했습니다.
- 기존 시험은 기준선 그대로 통과합니다 — 공개 `/api/v1/*` 경로의 동작은 바뀌지 않았습니다.
- 이 결과는 **"인증 수신부를 구현하고 127.0.0.1의 실제 mTLS로 검증했다"**입니다. 사내 CA·운영 HAProxy·실제 GHE·실제 사용자 매핑·PIPE 서버와의 end-to-end는 NOT_RUN이므로 **"사내 두 서버 사이를 검증했다"가 아닙니다**(6장).
- 독립 보안 검토는 차단·높음 등급 결함을 재현하지 못했습니다. 낮음 1건과 관찰 3건은 반영했습니다(5장).

## 2. 실행한 명령과 결과

| 명령 | 기준선 (변경 전, `52cf27f`) | 최종 (2026-09-21 14:47~14:57) |
|---|---|---|
| `pnpm typecheck` | 통과 | 통과 |
| `pnpm lint` | 오류 1 (기준선 결함) | 오류 1 — 기준선과 같은 1건, 새 오류 0. 병합 전 ESLint 설정으로 기준선 1건을 해소한 뒤 다시 돌려 **오류 0** |
| `pnpm run lint:deps` | 통과 | 통과 |
| `pnpm run test` (단위) | 168 파일(+1 skip) · 2,960 통과(+1 skip) | 178 파일(+1 skip) · 3,204 통과(+1 skip) — 새 시험 파일 10개, 244건 증가 |
| `pnpm build` | 통과 | 통과 |
| `pnpm run test:integration` | 121 파일 · 1,857 통과 | 129 파일 · 2,052 통과 — 새 시험 파일 8개, 195건 증가 |
| `pnpm run test:regression` | 11 파일 · 506 통과 | 11 파일 · 509 통과 — 운영 도달성 단언 3건 증가 |

- 기준선은 같은 워크트리에서 코드를 바꾸기 전에 실행한 결과입니다(2026-09-21 12:19~12:30).
- lint 오류 1건은 기준선부터 있던 `handoff/pipe-search-port/fixtures/validate-fixtures.mjs:3`의 `'URL' is not defined`(no-undef)입니다. 이 오류가 #218·#219부터 main CI의 `verify`를 lint 단계에서 멈추게 하고 있어, 병합 전에 해소했습니다. 그 파일은 1단계 인수인계 묶음의 전달물이고 묶음의 MANIFEST.json이 바이트 SHA-256을 고정하므로 파일은 고치지 않고, ESLint 설정에서 그 묶음 경로에만 Node 전역 `URL`을 허용했습니다. 이번 변경으로 생긴 lint 오류는 없습니다.
- 기존 시험은 리팩터(조회 10종의 route 본문을 실행 함수로 추출) 뒤에도 기준선과 같게 통과합니다. 회귀 시험 중 운영 도달성 표(CR-034)의 API-ADM-007 단언 한 줄은 공개 서버 조립이 `buildServer(serverDeps)`로 바뀐 것에 맞춰 고쳤고(공개 서버와 연동 리스너가 같은 의존 객체를 쓰기 위한 변경), 연동 리스너의 기동·종료 단언을 더했습니다.
- 1차 전체 실행에서 기존 감사 시험 1건(`apps/search-api/integration/audit/audit-records.test.ts`「`action`으로 좁힌다」)이 실패했습니다. 공유 시험 DB에 새 연동 시험들이 지금 시각의 `entity.view` 감사 기록 71건을 남겨, 기본 페이지(50)의 최신순 첫 페이지에서 그 시험이 8월 시각으로 심은 행이 밀렸기 때문입니다. 시험이 심은 시각 창으로 조회를 좁혀 격리를 보강했습니다(보강 전 형태로 되돌리면 같은 DB 상태에서 실패하고 보강 뒤 통과). 제품 코드의 결함이 아니라 공유 DB에서 페이지 크기에 기대던 시험의 약점입니다.
- `pnpm run test:a11y`·`pnpm run test:e2e`·`pnpm run test:perf`는 실행하지 않았습니다(NOT_RUN). apps/web의 변경은 단위 시험 한 건(`lib/proxy.test.ts`에 연동 경로 차단 단언 추가)뿐이고 화면 코드가 바뀌지 않았습니다.

## 3. 수용 시험 결과

시험 경로는 저장소 루트 기준입니다. `integration/…`은 `apps/search-api/integration/integrations/pipe/`, `unit/…`은 `apps/search-api/src/integrations/pipe/`입니다. 통합 시험은 모두 127.0.0.1의 실제 TLS 핸드셰이크와 PostgreSQL·Redis·Elasticsearch를 거칩니다.

### A. 서비스 인증·assertion

| ID | 시험 | 결과 | 증거 | 한계 |
|---|---|---|---|---|
| PSI-A01 | integration/auth.test.ts「PSI-A01」, unit/assertion.test.ts | PASS | 승인된 client·활성 binding에만 300초 이하 grant, 서버에는 해시만 | 시험 CA |
| PSI-A02 | integration/auth.test.ts「PSI-A02」 | PASS | 인증서 없는 연결은 TLS 단계에서 끊겨 앱에 닿지 않음 | 사내 CA·HAProxy NOT_RUN |
| PSI-A03 | integration/auth.test.ts「PSI-A03」 3건 | PASS (pr-search 부분) | 신뢰하지 않는 CA → TLS 실패, 미등록 인증서 → 401 `CLIENT_AUTH_FAILED`, 다른 client 인증서 → 불일치 거절 | PIPE의 검증 끄기 금지는 PIPE 몫 |
| PSI-A04 | integration/auth.test.ts「PSI-A04」 3건, integration/exposure.test.ts | PASS (pr-search 부분) | 성공 헤더를 위조해도 401, TLS 아닌 경로는 헤더와 무관하게 401, 공개 리스너에는 경로 없음(404) | 운영 HAProxy·backend 포트 우회 NOT_RUN |
| PSI-A05 | unit/assertion.test.ts, unit/conformance.test.ts(벡터 22개), integration/auth.test.ts「PSI-A05~A09」 | PASS | `alg: none`·HS256(공개키를 비밀로)·RS384 거절, 서명 불량 401 `ASSERTION_INVALID` | – |
| PSI-A06 | unit/assertion.test.ts, integration/auth.test.ts | PASS | 다른 iss·aud·typ·purpose 거절, `revoke_context` 목적으로 발급 불가 | – |
| PSI-A07 | unit/assertion.test.ts | PASS | 미등록 kid 거절, `jku`·`x5u`·`jwk`·`x5c`·`crit`·`b64` 헤더 거절(라이브러리를 거치지 않고 직접 서명한 토큰으로 확인). 키는 정책의 로컬 공개키에서만 고른다 | outbound 0회는 코드 구조로 성립(네트워크로 키를 가져오는 코드가 없음) |
| PSI-A08 | unit/assertion.test.ts, integration/auth.test.ts「PSI-A08」 4건 | PASS (pr-search 부분) | 필수 claim 누락·타입 불량·8192자 초과, 16KiB 초과 413, 모르는 필드 400, JSON 아님 415, 발급 요청의 Authorization·Cookie 거절 — 모두 저장소 호출 전 | – |
| PSI-A09 | unit/assertion.test.ts | PASS | 고정 시계로 TTL>60, `exp<=iat`, 미래 iat(5초 초과), 만료(허용 오차 5초) 경계 | – |
| PSI-A10 | integration/auth.test.ts「PSI-A10」, unit/replay-store.test.ts | PASS | 복제본 둘(서로 다른 Fastify·PostgreSQL pool·Redis 연결)에 같은 assertion 동시 제출 → 하나만 발급, 나머지 401 `ASSERTION_REPLAYED` | 사내 Redis 형상 NOT_RUN |
| PSI-A11 | integration/auth.test.ts「PSI-A11」, unit/replay-store.test.ts | PASS | 재생 방지 저장소 장애 → 503 `AUTH_STORE_UNAVAILABLE`, grant 없음 | – |
| PSI-A12 | integration/auth.test.ts「PSI-A12」 3건, unit/config.test.ts | PASS (pr-search 부분) | 다른 client의 키 → 미등록 kid, binding 없는 issuer → 연결 필요, 다른 client가 받은 grant를 이 인증서로 → `GRANT_BINDING_MISMATCH`, 운영에서 시험 키 기동 거부 | 실제 환경별 키·인증서 NOT_RUN |

### B. Identity binding

| ID | 시험 | 결과 | 증거 | 한계 |
|---|---|---|---|---|
| PSI-B01 | integration/identities.test.ts「PSI-B01」 | PASS (pr-search 부분) | 같은 기존 사용자, GHE login은 pr-search 정본에서 | 실제 매핑 NOT_RUN |
| PSI-B02 | – | N/A (PIPE 책임) | pr-search 쪽: assertion의 모르는 claim은 거절하고 본문의 사용자·역할을 읽지 않는다(PSI-A06·A08) | – |
| PSI-B03 | integration/identities.test.ts「PSI-B03」 | PASS | 403 `IDENTITY_BINDING_REQUIRED`, 사용자·grant·범위를 만들지 않음 | – |
| PSI-B04 | integration/identities.test.ts「PSI-B04」, unit/grant-store.test.ts | PASS | disabled 403, conflict 409 | – |
| PSI-B05 | integration/identities.test.ts「PSI-B05」 4건 | PASS | login이 GHE에서 다른 숫자 ID·없는 login·정본 숫자 ID 불일치 → 409, GHE 조회 실패 → 503 | 실제 GHE 응답 NOT_RUN |
| PSI-B06 | integration/identities.test.ts「PSI-B06」 2건 | PASS | 다른 GHE 호스트의 binding은 합치지 않음, 가져오기도 충돌 | – |
| PSI-B07 | integration/identities.test.ts「PSI-B07」 | PASS | 없는 사용자에게는 binding 불가(외래 키), 가져오기 충돌 | – |
| PSI-B08 | integration/identities.test.ts「PSI-B08」 | PASS | 끈 뒤 판정되는 요청은 옛 grant 거절, 다시 켜도 옛 grant는 되살아나지 않음(`GRANT_REVOKED`) | – |
| PSI-B09 | integration/identities.test.ts「PSI-B09」 4건 | PASS | dry-run은 쓰지 않음, 충돌이 하나라도 있으면 `--apply`여도 무변경, 적용 시 행위 주체·참조·이벤트, 행위 주체 없으면 거부 | – |

### C. Grant·로그인 문맥·회수

| ID | 시험 | 결과 | 증거 | 한계 |
|---|---|---|---|---|
| PSI-C01 | integration/grants.test.ts「PSI-C01」, integration/auth.test.ts, unit/grant-store.test.ts | PASS | 서버에는 SHA-256만, 일반 세션 이름공간(`prs:session:*`)에 쓰지 않음 | – |
| PSI-C02 | integration/grants.test.ts「PSI-C02」 2건, unit/grant-store.test.ts | PASS (pr-search 부분) | `min(300초, auth_expires_at, 인증서 만료)`, 연장 없음, 300초 뒤 `GRANT_EXPIRED`, 진단 창 뒤 `GRANT_INVALID` | – |
| PSI-C03 | integration/grants.test.ts「PSI-C03」 | PASS | 같은 client의 교체 인증서라도 발급 인증서가 아니면 401 `GRANT_BINDING_MISMATCH` | – |
| PSI-C04 | integration/grants.test.ts「PSI-C04」 | PASS | grant를 일반 `/api/v1/*`의 Bearer·쿠키로 써도 인증 실패 | – |
| PSI-C05 | integration/grants.test.ts「PSI-C05」 | PASS | 쿠키는 grant·mTLS를 대신하지 못하고, 유효 grant와 함께 와도 400 | – |
| PSI-C06 | integration/grants.test.ts「PSI-C06」 2건, unit/grant-store.test.ts | PASS (pr-search 부분) | 서명 키·client·인증서 긴급 회수 뒤 기발급 grant도 다음 요청에서 거절, dry-run 무변경 | – |
| PSI-C07 | integration/grants.test.ts「PSI-C07」 2건 | PASS | 해당 grant만 종료, 반복·미존재·남의 grant에 같은 응답, 다른 client는 회수 불가 | – |
| PSI-C08 | integration/grants.test.ts「PSI-C08」 | PASS (pr-search 부분) | 복제본 둘에서 문맥 회수와 발급을 경합시켜도 회수 뒤 살아 있는 grant 없음 | PIPE의 늦은 캐시 쓰기 방지는 PIPE 몫 |
| PSI-C09 | integration/grants.test.ts「PSI-C09」 2건 | PASS (pr-search 부분) | 회수 표식이 같은 문맥의 재연결을 막음(새 jti여도), 회수 목적은 지난 `auth_expires_at` 허용 | – |
| PSI-C10 | integration/grants.test.ts「PSI-C10」 | PASS (pr-search 부분) | 한 문맥의 회수가 다른 문맥에 영향 없음, 새 문맥은 옛 grant를 승계하지 않음 | – |

### D. 인가·읽기 전용 경계

| ID | 시험 | 결과 | 증거 | 한계 |
|---|---|---|---|---|
| PSI-D01 | integration/readonly.test.ts「PSI-D01」 | PASS (pr-search 부분) | 사용자 A/B가 각자 권한대로, client 공용 권한 조회 없음 | 실제 GHE 권한 NOT_RUN |
| PSI-D02 | integration/readonly.test.ts「PSI-D02」, integration/exposure.test.ts | PASS | operator의 grant도 사용자 범위 ∩ 허용 목록, 연동 앱에는 관리·실행·감사 경로가 없음 | – |
| PSI-D03 | integration/readonly.test.ts「PSI-D03」 | PASS (pr-search 부분) | 목록 밖 GET·POST·HEAD·OPTIONS → 404, prefix proxy·HEAD fallback 없음 | – |
| PSI-D04 | integration/readonly.test.ts「PSI-D04」 2건 | PASS | explicit·org_team(500개 초과) 모두 조회 전 교집합. 질의 언어의 OR 두 형태(같은 키의 반복 `repo:a repo:b`, 여러 단어 텍스트)와 저장소 지목·라벨·텍스트 질의로 넓어지지 않음 | – |
| PSI-D05 | integration/readonly.test.ts「PSI-D05」 | PASS | 허용 범위 밖 자료가 total·facets·candidates에 없음 | – |
| PSI-D06 | integration/readonly.test.ts「PSI-D06」 | PASS | 범위 밖 source 4종 → 404이고 source reader 호출 0회(대조군은 호출됨) | – |
| PSI-D07 | integration/readonly.test.ts「PSI-D07」 2건 | PASS | 권한 밖 저장소는 코드 비교 전에 404, 형식 오류는 저장소와 무관하게 400 | – |
| PSI-D08 | integration/readonly.test.ts「PSI-D08」 | PASS | 매 요청 인가, 5분 캐시 안에서는 GHE 재조회 없음 | – |
| PSI-D09 | integration/readonly.test.ts「PSI-D09」, integration/openapi.test.ts | PASS | 만료 캐시 + GHE 실패 → 조회 5종과 발급이 503 `PERMISSION_UNAVAILABLE`, 옛 범위·빈 성공 없음. 조회 10종의 봉투(연동/원본)가 operation map 기재와 같음 | – |
| PSI-D10 | integration/readonly.test.ts「PSI-D10」 2건 | PASS | 무효화(DB 버전 울타리 + Redis 삭제) 뒤 판정 요청은 회수 반영. 무효화 없으면 캐시 TTL **최대 5분** 동안 옛 범위(의도된 bounded freshness) | 실제 웹훅 무효화 경로 NOT_RUN |

### E. PIPE BFF·캐시·오류

| ID | 시험 | 결과 | 증거 | 한계 |
|---|---|---|---|---|
| PSI-E01~E04, PSI-E07~E09 | – | N/A (PIPE 책임) | – | – |
| PSI-E05 | unit/grant-store.test.ts「회수는 만료보다 먼저다」 | pr-search 부분 PASS | 회수된 grant를 만료(`GRANT_EXPIRED`)로 답하지 않는다 — PIPE가 자동 재발급하지 않게 | PIPE 동작은 PIPE 몫 |
| PSI-E06 | integration/auth.test.ts「PSI-A10」 | pr-search 부분 PASS | 같은 jti 재사용은 `ASSERTION_REPLAYED`, 고아 grant는 300초 안에 만료 | PIPE 재시도 정책은 PIPE 몫 |

### F. DTO·경로·cursor

| ID | 시험 | 결과 | 증거 | 한계 |
|---|---|---|---|---|
| PSI-F01 | integration/parity.test.ts「PSI-F01」 20건, integration/openapi.test.ts, unit/contract.test.ts | PASS (pr-search 부분) | 같은 사용자·같은 질의를 공개 경로와 연동 경로로 보내 본문 일치(상관 ID·커서 값 제외). 실제 응답이 OpenAPI 스키마에 맞고, captured 예시와 상태·봉투·코드가 같음. OpenAPI가 공식 OAS 3.1 스키마에 맞고 경로·파라미터·오류 코드가 코드와 같음 | – |
| PSI-F02 | integration/parity.test.ts, integration/readonly.test.ts「PSI-D07」, integration/openapi.test.ts, integration/mnumber-disabled.test.ts 2건 | PASS (pr-search 부분) | 실제 M 번호 해석 경로(`/read/merge-numbers/resolve`)가 원본 실행 함수를 부름. M 번호가 꺼진 배포는 능력·`/context` 조회 목록에서 함께 빠지고 경로는 원본처럼 404 `feature_disabled`(CONTRACT_DIFF D-07) | – |
| PSI-F03 | integration/parity.test.ts「PSI-F03~F05」, unit/query.test.ts | PASS (pr-search 부분) | owner/repo는 `%2F` 하나로 한 번만 풀림, 파일 경로·브랜치의 `/`는 그대로 | HAProxy·Django를 지나는 경로 NOT_RUN |
| PSI-F04 | unit/query.test.ts, integration/parity.test.ts, integration/openapi.test.ts | PASS (pr-search 부분) | 경로 파라미터 `{repository}`의 이중 인코딩·dot segment, query의 CR/LF/NUL·깨진 escape·fragment → 400 `INVALID_REQUEST`. query 값의 저장소 힌트는 원본처럼 무시되고 두 경로가 같게 답함(parity 2건) | – |
| PSI-F05 | unit/query.test.ts, integration/parity.test.ts | PASS (pr-search 부분) | 중복 단일값 key → 400(원본은 받는다 — DEV-731로 기록) | – |
| PSI-F06 | integration/parity.test.ts「PSI-F06」 2건 | PASS | 커서가 사용자·client에 결속, 공개 커서 교차 거절, 범위 회수 뒤 옛 커서 `CURSOR_QUERY_MISMATCH`, 자동 첫 페이지 없음 | – |
| PSI-F07 | integration/exposure.test.ts「응답 머리글」 | PASS (pr-search 부분) | 모든 연동 응답이 no-store이고 `Set-Cookie` 없음, pr-search는 redirect를 내지 않음 | redirect·HTML 비전달은 PIPE 몫 |
| PSI-F08 | integration/parity.test.ts「PSI-F08」 2건, examples(부분 결과 합성 2건) | PASS (pr-search 부분) | epoch_stale 200과 source 결과 필드를 원본 의미 그대로 | – |

### G. 운영·비밀·출시

| ID | 시험 | 결과 | 증거 | 한계 |
|---|---|---|---|---|
| PSI-G01 | integration/exposure.test.ts「PSI-G01」, integration/auth.test.ts「PSI-A04」, apps/web/lib/proxy.test.ts | PASS (pr-search 부분) | 공개 앱에 연동 경로 0개(인증값을 알아도 404), web 프록시는 `/internal`을 만들 수 없음 | 실제 ingress NOT_RUN |
| PSI-G02 | – | N/A (PIPE 책임) | pr-search 쪽: 대상 호스트를 사용자 입력으로 정하는 경로가 없음(GHE는 설정의 `GHE_BASE_URL`만) | 별도 시험 없음 |
| PSI-G03 | integration/exposure.test.ts「PSI-G03」 | PASS (pr-search 부분) | assertion·grant 원문이 로그·이벤트·오류 본문 어디에도 없음 | – |
| PSI-G04 | integration/exposure.test.ts「PSI-G04」 4건 | PASS (pr-search 부분) | 조회 감사는 canonical 사용자, 행위 주체는 같은 correlation ID의 연동 이벤트, UUID 아닌 상관 ID는 버림, 이벤트 표는 추가 전용 | – |
| PSI-G05 | unit/assertion.test.ts「PSI-G05」 2건, integration/grants.test.ts「PSI-C06」, unit/config.test.ts, unit/grant-store.test.ts | PASS (pr-search 부분) | 서명 키 정상 교체(두 키를 함께 등록한 동안 둘 다 받고, 옛 키를 빼면 그 kid 거절), 인증서 교체(회수된 인증서의 grant만 죽고 교체 인증서로 계속), kid 중복 거부, 설정에서 뺀 키로 발급된 grant 거절 | 사내 PKI로 실제 교체 NOT_RUN |
| PSI-G06 | unit/config.test.ts「PSI-G06」, unit/runtime.test.ts | PASS | 켰는데 설정·의존이 모자라면 기동 거부, `AUTH_ENABLED=false` 배포 거부, 운영에서 시험 키 거부 | – |
| PSI-G07 | unit/config.test.ts, unit/runtime.test.ts, regression/runtime-reachability.test.ts, 기존 통합·회귀 전체 | PASS (pr-search 부분) | 꺼지면 설정 파일을 읽지 않고 리스너를 만들지 않음, 기존 시험 기준선 그대로 | 실제 배포의 롤백 NOT_RUN |
| PSI-G08 | 이 문서 | PASS | 코드·로컬·127.0.0.1 mTLS·실제 환경 검증을 구분하고 미실행을 NOT_RUN으로 적음 | – |

## 4. 변이 시험 (시험이 실제로 결함을 잡는가)

대상 코드나 파일을 하나씩 망가뜨려 시험이 실제로 실패하는지 확인했습니다. 매번 원본으로 되돌렸고 파일 해시로 복구를 확인했습니다.

| 묶음 | 변이 | 결과 |
|---|---|---|
| 연동 핵심 검사 | 쿠키 거절 제거, 만료를 회수보다 먼저 판정, 재생 소비 생략, 교집합 생략, SAN·지문 대조 생략, 인증서 결속 생략, 커서 결속 제거, 중복 key 허용, 운영의 시험 키 거부 제거, TTL 60초 검사 제거, binding 버전 대조 제거, `org_team` 보정 제거, GHE login 대조 제거 | 13건 모두 시험 실패(검출) |
| 이중 방어 | 발급 전 문맥 회수 확인만 제거 | 시험 통과 — 트랜잭션 안의 재확인이 막는다(의도된 이중 방어). 두 곳을 함께 제거하면 경합·재연결 시험 2건 실패(검출) |
| 운영 도달성(CR-034 회귀) | 공개 서버 기동 제거, 리스너 조립 제거, 리스너 종료 제거, 리스너를 다른 의존 객체로 조립 | 4건 모두 검출, 무변이 대조 통과 |
| 계약 단위 시험 | 코드의 query key 제거, 연동 오류 문구 변경, 상한 상수 변경, 예시의 필수 필드 삭제, manifest 미갱신, 코드에 경로 추가 | 6건 모두 검출, 무변이 대조 통과 |
| OpenAPI 통합 시험 | 예시의 오류 코드 변경, operation map의 봉투 기재 변경, OpenAPI 스키마 변경, 코드가 발급 응답에 필드 추가 | 4건 모두 검출 |
| 감사 시험 격리 보강 | 보강 전 형태로 되돌림(공유 DB에 `entity.view` 71건) | 실패 재현(26건 중 1건), 보강 뒤 통과 |
| 검토 반영 | M 번호가 꺼진 배포의 `/context` 조회 목록 필터 되돌림 | 새 시험 1건 실패(검출) |

## 5. 독립 보안 검토

작성과 별개로, 코드를 읽기만 하는 별도 검토 에이전트가 인증 우회·권한 누출·재생 방지·회수 뒤 재활성화·자격 노출·입력 처리·공개 경로 동작 변화를 코드에서 직접 따라갔습니다. **차단·높음 등급 결함은 재현하지 못했습니다.** 지적과 반영은 다음과 같습니다.

| 등급 | 지적 | 반영 |
|---|---|---|
| 낮음 | 식별자 해석의 query `repository` 힌트는 형식이 틀려도(`x/..`, 이중 인코딩) 400이 아니라 원본처럼 조용히 버려진다 — "저장소 이름의 이중 인코딩·dot segment는 400"이라는 문구와 어긋남(보안 영향 없음, 범위는 그대로 강제) | 엄격 거절의 범위를 **경로 파라미터 `{repository}`**로 정확히 고쳤고(SRS AC-6, API 계약, OpenAPI, CONTRACT_DIFF D-03), query 값은 원본 의미라는 것을 parity 시험 2건으로 고정 |
| 관찰 | `/auth/revoke` 주석의 "없든"이 헤더 부재로 읽힘(코드는 헤더가 없으면 400) | 주석과 API 계약 문구 정정 |
| 관찰 | M 번호가 꺼진 배포에서 `/context`의 `operations`에는 M 번호 해석이 남고 `capabilities`에서는 빠짐 | 코드가 둘을 함께 빼도록 고쳤고, 꺼진 배포를 따로 세우는 통합 시험 2건으로 D-07 전체를 검증(수정을 되돌리면 실패) |
| 관찰 | 로그인 문맥 회수는 client와 무관하게 그 문맥의 grant를 모두 죽인다 | 설계 의도이며 CONTRACT_DIFF D-16에 이미 적혀 있다 |

검토자가 예산 안에서 보지 못했다고 밝힌 것: 운영 CLI 본문(통합 시험 PSI-B09가 dry-run·충돌 무변경·행위 주체를 확인한다), 원본 조회 내부의 필수 필터(기존 ADR-008 코드, 이번에 바꾸지 않음).

## 6. NOT_RUN

| 항목 | 이유 |
|---|---|
| 사내 CA가 발급한 인증서로 두 서버 간 mTLS | 사내 PKI·서버에 접근할 수 없다 |
| 운영 HAProxy L4 passthrough와 backend 포트 우회 차단 | 운영 구성에 접근할 수 없다 |
| 실제 GHE의 `GET /users/{login}`·권한 조회·웹훅 무효화 | 실제 GHE에 닿지 않는다 |
| 실제 사용자 identity binding과 권한 교집합 | 매핑 등록은 지시서 범위 밖이다 |
| PIPE 서버와의 end-to-end(PSI-E 전부, 공동 항목의 PIPE 부분) | PIPE 저장소를 볼 수 없다 |
| `pnpm run test:a11y`·`test:e2e`·`test:perf` | apps/web 화면 코드가 바뀌지 않았다(단위 시험 한 건만 추가) |
| 활성화 전 smoke 7단계 (`DEPLOYMENT_AND_ROLLBACK.md` 9장) | 운영 입력이 없다 |

## 7. 남는 위험

`PIPE_INTEGRATION_HANDOFF.md` 9장을 보십시오 — 위임 위험, 권한 캐시 최대 5분·발급 사이 개명 창, 회수 전송 실패 시 최대 300초, rate limit은 PIPE 몫.
