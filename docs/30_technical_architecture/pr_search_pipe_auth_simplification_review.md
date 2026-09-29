# PR Search — PIPE 연동 인증 간소화 검토서

> 상태: draft | 버전: v0.1 | 갱신일: 2026-09-29

## 0. 이 문서의 계약

- 이 문서는 CR-136의 **검토서**다. PIPE 서버 → PR Search private 리스너 연동(FR-INT-001, ADR-025, 공통 계약 PSI-1.0)의 인증 절차를 줄일 수 있는지 네 안을 비교하고 권고 하나를 낸다. 결정 문서가 아니다. 정본은 여전히 `SRS`의 FR-INT-001(baseline v2.52), ADR-025, handoff의 OpenAPI·operation map이며, 이 문서가 그것들과 어긋나면 그것들이 이긴다.
- 이 문서는 코드·설정·계약·DB를 바꾸지 않는다. 권고안의 구현도 별도 승인 전에는 하지 않는다(6.4절).
- **임시 인증 해제 스위치를 제안하지 않는다.** 현재 코드는 `AUTH_ENABLED=false`를 명시한 배포에서 연동을 켜지 못하게 막고(`pipe/config.ts:311-313`), 공통 계약은 인증 OFF·TLS 검증 OFF로 운영 실패를 우회하는 것을 금지한다(`계약:77`, `계약:389`). 안 4는 그 효과와 위험을 문서 위에서만 평가한다.
- 「내부망이므로 누구나 모든 자료를 읽어도 된다」를 전제로 삼지 않는다. 사용자마다 GHE 권한으로 정해지는 접근 범위와 client 저장소 허용 목록의 교집합(`SRS:13`의 AC-5)은 어느 안에서도 지켜야 할 성질로 본다.

### 0.1 근거 기준과 표기

근거는 main `a02a145`(검토한 워크트리와 트리가 같다)다. 그 뒤 CR-135(PIPE blame)가 조회 하나와 `index.ts`의 GraphQL 주소 배선을 더했지만 인증 층(전송 인증·assertion·binding·grant·회수·접근 범위)은 바꾸지 않았다 — 줄 번호는 `a02a145` 기준이다(`git show a02a145:<경로>`). 근거는 `경로:줄`로 적고, 경로는 아래 약칭을 쓴다.

| 약칭 | 경로 |
| --- | --- |
| `pipe/` | `apps/search-api/src/integrations/pipe/` |
| `033` | `packages/db/migrations/033_pipe_integration.up.sql` |
| `repo` | `packages/db/src/repositories/pipe-integration.ts` |
| `index.ts` | `apps/search-api/src/index.ts` |
| `handoff/` | `handoff/pipe-search-integration/v1/` |
| `계약` | `docs/40_delivery/pipe-search-handoff-auth/00_SHARED_INTEGRATION_CONTRACT.md` |
| `수용` | `docs/40_delivery/pipe-search-handoff-auth/03_SECURITY_AND_CONTRACT_ACCEPTANCE.md` |
| `SRS` | `docs/10_requirements/srs_final.md` |
| `ADR` | `docs/30_technical_architecture/pr_search_architecture_decision_records.md` |
| `보안` | `docs/30_technical_architecture/pr_search_security_privacy_architecture.md` |
| `인프라` | `docs/30_technical_architecture/pr_search_infrastructure_operations.md` |
| `RUNBOOK` | `deploy/single-host/RUNBOOK.md` |

근거의 등급은 넷이다. `.ts`·`.sql`은 **코드 읽기**, `.md`·`.yaml`·`.cfg`·`.json`은 **저장소 문서·예시의 진술**이다(예시는 운영에 적용되지 않았다). **실측**은 0.2절의 로컬 실험 하나뿐이다. RFC는 **표준 참조**이며, 사내 IdP·CA·프록시가 그것을 지원한다는 증거가 아니다.

### 0.2 실측 — Node TLS 두 가지

2026-09-29 로컬 Node v22.23.3에서 자가 서명 인증서로 `tls.createServer({ requestCert: false })`를 세우고 연결했다. 서버 쪽 소켓의 `authorized`는 `false`였고 `getPeerCertificate()`는 빈 객체였다. 같은 런타임에서 `tls.Server.prototype.setSecureContext`는 함수였다. 실험 파일은 scratchpad에만 두었고 저장소에 넣지 않았다. 이 실측은 운영 환경이나 Fastify와의 결합을 검증한 것이 아니다.

## 1. 요약

**권고: 안 1 — 현재 구조와 PSI-1.0 계약을 그대로 두고, 인증서의 발급·갱신·배포·만료 감시만 자동화한다.** 안 2는 사내 PKI가 client 인증서를 운영할 수 없다고 확인될 때 쓸 예비안(요청 서명형 2-B)으로만 남긴다. 안 3은 사내 IdP의 위임 기능이 확인되면 새 ADR로 다시 비교한다. 안 4는 기각한다.

이유:

1. 안 1만 SRS(baseline FR-INT-001의 AC-1·AC-4·AC-11)·ADR-025·동결 계약·마이그레이션 033을 건드리지 않는다. 안 2·3·4는 모두 두 저장소의 동시 변경과 계약 재동결을 부른다(`ADR:95`, `계약:57`).
2. mTLS에서 실제로 무거운 것은 인증서의 발급·갱신·배포이고, 자동화가 겨누는 곳이 바로 거기다. 안 2로 mTLS를 빼도 서버 인증서·서명 키·binding·grant·회수 운영은 그대로 남으므로, 없어지는 것은 client 인증서 한 갈래와 그 때문에 생긴 L4 passthrough 제약뿐이다.
3. mTLS는 코드에서 다른 층과 얽혀 있다 — assertion 키 선택, grant의 발신자 결속과 수명, 인증서 긴급 회수, DB 제약(2.2절). 빼려면 같은 성질을 요청 서명으로 다시 만들거나(2-B), 가로챈 assertion·grant가 포트에 닿는 어디서나 쓰이는 것을 받아들여야 한다(2-A).

**「TLS 옵션 두 개만 끄면 된다」는 틀렸다.** `requestCert`를 끄면 소켓의 `authorized`가 `false`가 되고(0.2절), 현재 코드는 그런 요청을 전부 401 `CLIENT_AUTH_FAILED`로 막는다(`pipe/transport-auth.ts:49`, `pipe/errors.ts:58`). 그 검사를 통과시켜도 grant 행은 64자리 인증서 지문 없이 저장되지 않는다(`033:96`, `033:106`). 인증이 가벼워지는 것이 아니라 연동이 멈춘다(fail closed).

## 2. 현재 구조 — 다섯 층

### 2.1 층별 표

| 층 | 무엇을 막는가 | 코드 위치 | 설정·비밀 | 운영 부담 |
| --- | --- | --- | --- | --- |
| ① HTTPS — 통신 암호화와 서버 확인 | grant·assertion·검색 결과·소스 본문의 도청과 변조, PIPE가 가짜 PR Search에 assertion을 건네는 것 | `pipe/server.ts:34-48`(`https`, `minVersion: 'TLSv1.2'`), `pipe/config.ts:334-338`, `index.ts:236-237` | `PIPE_SEARCH_INTEGRATION_TLS_KEY_FILE`(비밀)·`…_TLS_CERT_FILE`, PIPE가 신뢰할 발급 CA | 서버 인증서 발급·갱신. 파일은 기동 때만 읽으므로 갱신마다 search-api를 재기동한다(`handoff/DEPLOYMENT_AND_ROLLBACK.md:65`) |
| ② mTLS — 요청하는 PIPE 서버 확인 | 등록되지 않은 서버와 같은 CA의 다른 서비스의 접속, 전달 헤더 위조(THR-055), 다른 인증서로 grant 재사용(PSI-C03), 가로챈 assertion을 다른 곳에서 먼저 내는 것 | `pipe/server.ts:39-41`, `pipe/transport-auth.ts:46-72`, `pipe/routes.ts:226`·`229-241`, `pipe/grant-store.ts:56-66`·`90-93`, `pipe/config.ts:202-224`·`271-286` | `…_TLS_CLIENT_CA_FILE`, 정책 `tls_client`(SAN 정확 일치 또는 leaf SHA-256 지문), PIPE의 client 키·인증서 | client 인증서 발급·갱신·배포. 지문 고정이면 교체마다 정책 수정과 재기동. 프록시는 L4 passthrough만(`handoff/CONTRACT_DIFF.md:29`) |
| ③ 사용자 위임 — assertion·identity binding | 브라우저·BFF가 주장하는 임의 사용자, 알고리즘 혼동·키 URL 추종·재생(THR-056), 개명한 login의 재사용(THR-060) | `pipe/assertion.ts:112-194`, `pipe/replay-store.ts:33-62`, `pipe/identity-binding.ts:68-108`, `pipe/command.ts:196-399`, `033:15-48` | 정책 `issuer`·`audience`·`profile`·`signing_keys[kid, public_key_file]`(`pipe/config.ts:176-200`), Redis(`jti`) | PIPE 서명 키 교체 — 새 키 추가, 최소 420초 뒤 옛 키 제거, 정책 수정과 재기동 두 번(`handoff/DEPLOYMENT_AND_ROLLBACK.md:54-59`). 사람이 검증한 binding 가져오기 — 사용자가 먼저 PR Search에 한 번 로그인해야 한다(`handoff/DEPLOYMENT_AND_ROLLBACK.md:84-106`) |
| ④ grant·회수·접근 범위 | 긴 수명 자격, 로그아웃 뒤 재사용(THR-058), 매핑 변경 뒤의 옛 grant, 일반 API로의 전용(THR-059), 사용자 범위 밖 저장소 | `pipe/grant-store.ts:24-25`·`78-120`, `pipe/routes.ts:318-335`·`461-536`, `pipe/read-context.ts:45-117`, `repo:258-412`, `033:58-138` | 정책 `repository_ids`(1~500개, `pipe/config.ts:226-240`)·`status`, PostgreSQL 표 다섯 | 허용 목록 관리(정책 수정과 재기동), 보존 정리 `purge` 하루 한 번(`handoff/DEPLOYMENT_AND_ROLLBACK.md:110-119`), 긴급 회수 CLI |
| ⑤ GHE 자격 — PR Search가 GHE를 읽는 별도 인증 | PIPE 연동과 무관한 경계. PR Search가 읽을 수 있는 자료의 상한을 정한다 | `index.ts:40-72`(GitHub App 설치 토큰), `index.ts:111-152`(`GheAccessScopeSource`), `packages/authz/src/scope-source.ts:71-80`·`168-175`, `pipe/runtime.ts:32-37`, `pipe/identity-binding.ts:96-105` | `GHE_APP_ID`·`GHE_APP_PRIVATE_KEY`(`packages/github/src/config.ts:86-87`), `GHE_INSTALLATIONS`, `GHE_BASE_URL` | 기존 App 키 운영 그대로. 연동은 발급마다 GHE `GET /users/{login}` 한 번을 더한다(`인프라:183`) |

⑤는 네 안 어디에서도 바뀌지 않는다. 사용자의 권한은 PR Search의 App 설치 토큰으로 그 사용자 login의 저장소 권한을 GHE에 물어 정한다(`packages/authz/src/scope-source.ts:71-80`). 사용자의 GHE 토큰은 쓰지 않는다. 「인증 간소화」가 이 자격을 줄이는 일로 번지지 않도록 따로 둔다.

### 2.2 mTLS 층이 다른 층과 얽힌 자리

설정 두 줄이 아니라 아래 자리가 모두 전송 계층(②)에서 온 값을 쓴다. 안 2~4는 이 자리를 전부 다시 정해야 한다.

| 자리 | 쓰는 값 | 근거 |
| --- | --- | --- |
| 모든 요청의 client 결정 | 실제 TLS 소켓의 `authorized`와 peer 인증서 DER | `pipe/routes.ts:226`, `pipe/transport-auth.ts:48-71` |
| assertion 서명 키 선택 | ②가 정한 client의 `signingKeys` | `pipe/assertion.ts:129-130` |
| assertion의 `client_id` | ②의 client와 같아야 한다 | `pipe/assertion.ts:157` |
| client·인증서 긴급 회수 | 연결의 인증서 지문 | `pipe/routes.ts:231-241`, `repo:457-472` |
| grant 수명 상한 | client 인증서의 `notAfter` | `pipe/routes.ts:400-405`, `pipe/grant-store.ts:56-66` |
| grant 저장 | 발급 연결의 인증서 지문(NOT NULL, 64자리 hex CHECK) | `pipe/routes.ts:422`, `033:96`·`106`, `repo:283` |
| grant 사용 | 발급 client·인증서 지문과 같아야 한다(발신자 결속) | `pipe/grant-store.ts:90-93` |
| grant 조회의 회수 판정 | 인증서 지문 회수 | `repo:402` |
| grant 개별 회수 | ②의 client가 발급받은 grant만 | `pipe/routes.ts:476-480` |
| 운영 CLI | `credentials revoke --kind certificate` | `pipe/command.ts:425-449` |
| 계약 | 전역 `security: mutualTLS`, `securitySchemes.mutualTLS` | `handoff/pipe-integration-v1.openapi.yaml:60-62`·`681-686` |
| 요구사항 | AC-1(client 인증서), AC-4(인증서 지문 일치·인증서 만료), AC-11(TLS 재료 없이는 기동 거부) | `SRS:13` |
| PIPE 캐시 키 | 활성 인증서 지문 | `계약:296-297` |

### 2.3 배포 자료가 있는 곳

`RUNBOOK`에는 PIPE 연동 절이 없고, `deploy/single-host/compose.yml`에도 `PIPE_SEARCH_INTEGRATION_*`가 없다(2026-09-29 grep). 배포 절차는 `handoff/DEPLOYMENT_AND_ROLLBACK.md`와 `handoff/deploy-examples/`(compose override·HAProxy·정책·환경 변수 예시)에만 있으며, `인프라:7`이 「기본 배포는 바꾸지 않았다」고 적는다. 운영 명령도 `prsctl` 하위 명령이 아니라 `node dist/pipe-integration-cli.js`다(`handoff/DEPLOYMENT_AND_ROLLBACK.md:108`). 사내 CA·HAProxy·실제 GHE·두 서버 사이 end-to-end는 NOT_RUN이다(`handoff/PIPE_INTEGRATION_HANDOFF.md:31-32`).

## 3. 요청 하나의 흐름 — 층별

### 3.1 발급 (`POST /auth/exchange`)

| 순서 | 판정 | 층 | 근거 | 실패 |
| --- | --- | --- | --- | --- |
| 1 | TLS 핸드셰이크 — 서버 인증서 제시, client 인증서 요구와 CA 검증 | ①② | `pipe/server.ts:36-43` | HTTP 응답 없음(`handoff/CONTRACT_DIFF.md:83`) |
| 2 | 서버 correlation ID, 소켓의 검증 결과와 peer 인증서로 client 결정(SAN 또는 지문, 정확히 하나) | ② | `pipe/routes.ts:209-226`, `pipe/transport-auth.ts:46-72` | 401 `CLIENT_AUTH_FAILED` |
| 3 | 쿠키 거절, 정책 `status` | ②④ | `pipe/routes.ts:228-229` | 400, 403 `CLIENT_DISABLED` |
| 4 | client·인증서 긴급 회수(DB) | ② | `pipe/routes.ts:231-241` | 403, 503 |
| 5 | `Authorization` 거절, 본문 모양(JSON, 16KiB) | – | `pipe/routes.ts:352`, `pipe/server.ts:44-49` | 400·413·415 |
| 6 | assertion — 헤더 셋·RS256·`typ`·등록 `kid`(②의 client의 키) → 서명 → claim 12개·`iss`·단일 `aud`·`client_id`(=②)·`purpose`·`profile`·수명 60초·오차 5초·원 로그인 만료 | ③ | `pipe/assertion.ts:112-177` | 401 `ASSERTION_INVALID` |
| 7 | 서명 키 긴급 회수(DB) | ②③ | `pipe/routes.ts:363-373` | 403 |
| 8 | `jti` 원자 소비(Redis `SET NX EX`) | ③ | `pipe/routes.ts:375`, `pipe/replay-store.ts:49-62` | 401 `ASSERTION_REPLAYED`, 503 |
| 9 | 로그인 문맥 회수 표식 | ④ | `pipe/routes.ts:377-387` | 403 `CONTEXT_REVOKED` |
| 10 | binding 활성·GHE 호스트·정본 사용자의 숫자 ID·GHE에서 본 그 login의 현재 숫자 ID | ③⑤ | `pipe/identity-binding.ts:68-108` | 403·409·503 |
| 11 | 접근 범위 1회 조회(0개 저장소는 성공) | ④⑤ | `pipe/routes.ts:394-398` | 503 `PERMISSION_UNAVAILABLE` |
| 12 | 수명 `min(발급 + 300초, 원 로그인 만료, client 인증서 notAfter)` | ④② | `pipe/routes.ts:400-405`, `pipe/grant-store.ts:56-66` | 401 `ASSERTION_INVALID`(1초 미만) |
| 13 | 한 트랜잭션 — 문맥 행 잠금과 회수 재확인, binding `FOR SHARE` 재확인, grant 행(토큰 SHA-256, kid, 인증서 지문) 저장 | ④②③ | `pipe/routes.ts:407-438`, `repo:258-307` | 403·409·503 |
| 14 | 원문 토큰은 이 응답에만 싣는다. `no-store`, `Set-Cookie` 제거, 연동 이벤트 기록 | ①④ | `pipe/routes.ts:245-286`·`445-457` | – |

### 3.2 조회 (`GET /read/*`, `GET /context`)

| 순서 | 판정 | 층 | 근거 |
| --- | --- | --- | --- |
| 1~4 | 발급의 1~4와 같다. 조회도 매번 mTLS다 | ①② | `계약:283` |
| 5 | Bearer 형식(`psig1_` + 43자) → SHA-256으로 grant 조회 | ④ | `pipe/routes.ts:318-329`, `pipe/grant-store.ts:44-49` |
| 6 | 진단 창(만료 뒤 120초) → **발신자: 발급 client·인증서 지문과 같은가** → 긴급 회수·정책에서 뺀 키·client 상태·profile → 문맥 회수 → grant 회수 → binding 상태·버전 → 만료. 순서가 곧 뜻이다 | ④②③ | `pipe/grant-store.ts:78-120` |
| 7 | 목록에 있는 query key만 받고 중복·깨진 인코딩을 거절한다 | – | `pipe/routes.ts:572-580` |
| 8 | 요청마다 사용자 범위(`resolveCached`, 5분 캐시)와 허용 목록의 교집합을 명시적 저장소 목록으로 만든다. 커서는 client·사용자에 결속한다 | ④⑤ | `pipe/read-context.ts:45-117`, `packages/authz/src/scope.ts:26` |
| 9 | 원본 `/api/v1/*`의 실행 함수를 그대로 부른다. 조회 감사는 기존 기록기가, 연동 이벤트는 같은 correlation ID로 남는다 | ④ | `pipe/routes.ts:582-628`, `pipe/audit.ts:1-19` |

### 3.3 회수

| 수단 | 자격 | 효력 | 근거 |
| --- | --- | --- | --- |
| grant 하나 (`POST /auth/revoke`) | ② + Bearer | 자기 client의 grant만. 결과와 무관하게 같은 200 | `pipe/routes.ts:461-486`, `repo:354-365` |
| 로그인 문맥 (`POST /auth/revoke-context`) | ② + 새 assertion(`purpose: revoke_context`, 지난 로그인 만료 허용) + `jti` | PostgreSQL 표식과 그 문맥의 grant 전부 회수가 한 트랜잭션. 같은 issuer의 다른 client가 받은 grant도 죽는다 | `pipe/routes.ts:489-536`, `repo:314-345`, `handoff/CONTRACT_DIFF.md:126` |
| binding 끄기 | 운영 CLI(기본 dry-run) | 버전이 올라 다음 요청부터 거절 | `pipe/command.ts:352-399`, `pipe/grant-store.ts:103-116` |
| 긴급 회수 | 운영 CLI `client`·`signing_key`·`certificate` | 재기동 없이 모든 복제본에서 다음 요청부터. 되돌리지 않는다 | `pipe/command.ts:413-483`, `033:121-138` |
| 정책 `status: disabled` | 정책 파일 | 재기동 뒤 | `handoff/DEPLOYMENT_AND_ROLLBACK.md:49` |
| 연동 끄기 | `PIPE_SEARCH_INTEGRATION_ENABLED=false` | 재기동 뒤 리스너가 없다 | `handoff/DEPLOYMENT_AND_ROLLBACK.md:140` |

회수 호출이 전송 실패로 닿지 않으면 이미 발급된 grant는 최대 300초 남는다(`보안:604`). 이 창은 모든 안의 기준선이다.

## 4. 안별 검토

각 안은 같은 항목으로 적는다: 없어지는 설정, 여전히 필요한 설정, PIPE 변경, PR Search 변경, 사용자 추적, 저장소 권한, 회수, 재생 공격, 토큰 탈취, 인증서 결속 grant의 대체, 이전 방법, 되돌리기.

### 4.1 안 1 — 현재 구조 유지, 인증서 관리만 자동화

자동화 대상은 넷이다: PR Search private 리스너의 서버 인증서, PIPE의 client 인증서, client CA 묶음(CA를 바꿀 때만), 세 인증서의 만료 감시. 서명 키 교체(420초 겹침)는 인증서가 아니지만 같은 달력에 묶는다.

| 항목 | 내용 |
| --- | --- |
| 없어지는 설정 | 없다. 사람이 하던 발급·갱신·배포 단계가 없어진다 |
| 여전히 필요한 설정 | 2.1절의 전부 |
| PIPE 변경 | client 인증서 자동 갱신, 새 인증서로 연결 풀 교체. grant 캐시 키에 활성 인증서 지문을 두면(`계약:296-297`) 교체 뒤 옛 grant는 버려지고 300초 안에 만료된다. 이것을 구현하지 않으면 교체 때마다 401 `GRANT_BINDING_MISMATCH`가 나고(`handoff/PIPE_INTEGRATION_HANDOFF.md:67`), PIPE는 이것을 사용자에게 503 `SEARCH_AUTH_UNAVAILABLE`로 돌려주며 무조건 재시도하지 않는다(`계약:338`, `pipe/errors.ts:68`) |
| PR Search 변경 | 필수 코드 변경은 없다. 운영 선택 둘: (가) client를 SAN 정확 일치로 등록한다 — 이미 지원하는 설정이며(`pipe/config.ts:206-221`, `pipe/transport-auth.ts:58-61`) 갱신마다 정책을 고치지 않는다(`handoff/DEPLOYMENT_AND_ROLLBACK.md:63`). (나) 서버 인증서 갱신을 파일 교체와 재기동으로 스크립트화한다. 선택 코드 항목(승인 필요, 6.4절): 재기동 없는 서버 인증서 재적재, 인증서 만료 지표. `pipe/identity-binding.ts`·`pipe/read-context.ts`·DB는 그대로다 |
| 사용자 추적 | 그대로 — 조회 감사(canonical 사용자)와 연동 이벤트(client·grant·subject·correlation ID)(`pipe/routes.ts:258-286`, `033:140-182`) |
| 저장소 권한 | 그대로 |
| 회수 | 그대로. 수명이 짧은 인증서는 회수할 일 자체를 줄인다. 리스너는 `crl`을 넘기지 않으므로(`pipe/server.ts:36-43`) 인증서 폐기는 지금처럼 DB의 지문 회수가 맡는다(`pipe/routes.ts:231-241`) |
| 재생 공격 | 그대로 — assertion `jti`는 한 번만 소비되고, grant는 발급에 쓴 인증서(지문)를 제시하는 연결에서만 쓰인다(`pipe/grant-store.ts:90-93`) |
| 토큰 탈취 | 그대로 — 탈취한 grant나 assertion만으로는 쓸 수 없고 client 키와 경로가 함께 필요하다. 인증서 수명을 줄이면 client 키 유출의 창도 줄어든다 |
| 인증서 결속 grant의 대체 | 대체하지 않는다. 지문 결속을 유지한다. grant 수명은 이미 `notAfter`를 넘지 않는다(`pipe/grant-store.ts:63`) |
| 이전 방법 | 코드·계약 변경 없이 단계로 간다: ① 만료 감시와 경보 → ② 서버 인증서 갱신 자동화(재기동 창 포함) → ③ SAN 등록 전환 뒤 PIPE client 인증서 자동화 → ④ 서명 키 교체 달력 |
| 되돌리기 | 수동 발급으로 돌아간다. 코드·DB·계약에 남는 것이 없다. 다만 SAN 등록 전환과 CA 묶음 축소를 되돌리려면 정책·CA 파일을 복원하고 재기동해야 한다 |

주의할 점:

- **재기동은 공개 리스너도 내린다.** 두 리스너가 한 프로세스에 있다(`index.ts:211-245`). 서버 인증서를 갱신할 때마다 공개 검색도 잠깐 끊긴다. Node에는 실행 중인 TLS 서버의 인증서를 바꾸는 `setSecureContext`가 있지만(0.2절), Fastify `app.server`와의 결합이나 client CA·정책 파일을 함께 다시 읽을 때의 뜻은 확인하지 않았다. 후보일 뿐이다.
- **SAN 일치는 신뢰를 CA의 발급 통제로 옮긴다.** 지문 고정은 정확히 그 인증서만 받지만 교체마다 정책 수정과 재기동이 든다. SAN 일치는 같은 SAN을 가진 신뢰 CA의 인증서를 모두 받는다(`pipe/transport-auth.ts:58-61`). 그러므로 그 SAN(예시 `handoff/deploy-examples/pipe-integration-policy.example.json:15`)을 누가 받을 수 있는지를 CA가 막아야 하고, client CA 묶음은 PIPE 전용 발급 CA로 좁히는 것이 낫다. CA를 바꿀 때는 옛·새 CA를 한 묶음에 함께 둔다(이 파일은 CA 묶음이다, `handoff/DEPLOYMENT_AND_ROLLBACK.md:34`).
- **만료는 조용한 전면 장애다.** 만료된 인증서는 핸드셰이크에서 끊겨 HTTP 응답이 없다. 연동 지표는 요청 수와 이벤트 기록 실패 둘뿐이라(`pipe/audit.ts:24-34`) 만료가 다가오는 것을 알리는 신호가 지금은 없다.
- **PIPE는 `notAfter` 직전까지 옛 인증서를 쓰지 않는다.** grant 수명이 1초 미만이면 발급이 401 `ASSERTION_INVALID`다(`pipe/routes.ts:400-405`, `handoff/CONTRACT_DIFF.md:104`). 수명의 일정 비율이 남았을 때 바꾼다.

### 4.2 안 2 — mTLS 제거, HTTPS·서비스 인증·사용자 위임·권한 검사 유지

「다른 서비스 인증」을 무엇으로 하느냐에 따라 셋으로 갈린다.

- **2-A bearer grant.** 발급·문맥 회수는 지금처럼 PIPE가 서명한 assertion이 서비스 인증을 겸한다. 조회와 grant 회수는 grant 하나로 받는다.
- **2-B 요청 서명(proof-of-possession).** 모든 요청에 PIPE 서비스 키로 서명한 짧은 증명(메서드·URL·시각·`jti`·grant 해시)을 싣고, grant는 그 키의 지문에 묶는다. RFC 9449(DPoP)의 `cnf.jkt`와 같은 발상이다(표준 참조). 다만 증명 키는 **정책에 등록한 키**여야 한다 — 요청마다 새로 만든 키를 받으면(RFC 9449의 기본 모양) assertion을 가로챈 쪽이 자기 키로 grant를 받을 수 있다.
- **2-C 고정 API 키.** 오래 사는 bearer 비밀 하나라 client 인증서보다 약하고 교체 절차도 없다. 기각한다.

「TLS 옵션 두 개」로 끝나지 않는 이유는 1장 끝과 2.2절에 있다. 더해, 표준 ingress에서 TLS를 끝내면 D-02의 passthrough 제약은 풀리지만, ingress가 넘기는 평문은 지금의 HTTPS 리스너(`pipe/server.ts:36-43`)와 핸드셰이크부터 맞지 않고, 리스너를 평문으로 바꿔도 `not_tls`에서 막힌다(`pipe/transport-auth.ts:47-48`). 두 검사를 모두 걷어 내더라도 ingress → PR Search 구간에는 grant와 소스 본문이 평문으로 흐른다. 그 구간을 다시 암호화하면 서버 인증서는 PR Search에 그대로 남는다.

| 항목 | 2-A bearer grant | 2-B 요청 서명 |
| --- | --- | --- |
| 없어지는 설정 | `…_TLS_CLIENT_CA_FILE`, 정책 `tls_client`, PIPE client 인증서·키와 그 갱신, 프록시의 L4 passthrough 제약 | 2-A와 같다 |
| 여전히 필요한 설정 | 서버 인증서(①), 정책의 `issuer`·`audience`·`signing_keys`·`repository_ids`·`status`, Redis `jti`, DB 표, binding·purge·긴급 회수 CLI, 네트워크 ACL | 2-A에 증명용 공개키 등록을 더한다(서명 키와 같은 키를 쓸지 나눌지는 새 ADR에서 정한다) |
| PIPE 변경 | 인증서 제시 중단, grant 캐시 키에서 인증서 지문 제거(`계약:296-297`), 새 계약판 구현 | 2-A에 요청마다 증명 서명, 증명 키 보관·교체를 더한다 |
| PR Search 변경 | 연동 모듈 15개 중 최소 7개: `pipe/server.ts`(client 인증서 요구 제거), `pipe/config.ts`(정책 스키마 새 판 — `tls_client` 필수 규칙 `:222-224`, CA 파일 `:337`), `pipe/transport-auth.ts`(제거), `pipe/routes.ts`(client를 assertion과 grant 행에서 정한다 — `:226`·`:231-241`·`:476-480`), `pipe/assertion.ts`(`client_id`·`kid`로 키 선택 — `:129`·`:157`), `pipe/grant-store.ts`(발신자 판정과 수명 — `:56-66`·`:90-93`), `pipe/command.ts`(`certificate` 종류). 새 마이그레이션(`033:96`·`106`의 NOT NULL·CHECK를 풀거나 결속 열을 더한다 — 033의 「추가 전용」 규율 밖이라 따로 판단한다), `repo`(`:283`·`:402`·`:466`), OpenAPI `security`와 계약 checksum, 통합 시험(`auth`·`grants`·fixture). `pipe/identity-binding.ts`·`pipe/read-context.ts`·`pipe/replay-store.ts`는 그대로다. 이행 기간에 두 리스너를 함께 띄우려면 `pipe/` 밖의 조립(`index.ts:211-245`)도 바뀐다 | 2-A에 증명 검증기, 새 오류 코드(`pipe/errors.ts`), 요청마다 증명 `jti` 소비(`pipe/replay-store.ts`를 증명용으로 넓힌다 — 조회마다 Redis 쓰기가 하나 는다), 결속 열의 키 지문을 더한다 |
| 사용자 추적 | assertion `sub`·binding·이벤트는 그대로다. 다만 조회를 보낸 쪽이 PIPE라는 증명이 없어져, grant를 가진 누구든 그 사용자로 기록된다 | 그대로 — 증명 키를 가진 PIPE만 보낼 수 있다 |
| 저장소 권한 | 그대로(④⑤) | 그대로 |
| 회수 | grant·문맥·binding·client·서명 키 회수는 그대로. `certificate` 긴급 회수가 없어진다 | 2-A에 증명 키 긴급 회수(새 종류)를 더한다 |
| 재생 공격 | assertion의 `jti` 재사용은 그대로 막힌다. 그러나 가로챈 grant는 최대 300초 동안 포트에 닿는 누구든 되풀이해 쓸 수 있다 | 증명의 `jti`·시각으로 막힌다. 그 저장소가 답하지 않으면 503이어야 한다 |
| 토큰 탈취 | PIPE 캐시·로그·APM에서 새어 나간 grant가 그대로 쓰인다. 아직 소비되지 않은 assertion(60초 이하)을 가로채면 먼저 낸 쪽이 grant를 받는다 — 지금은 client 인증서가 없으면 낼 수 없다. 네트워크 ACL이 「추가 방어」(`handoff/DEPLOYMENT_AND_ROLLBACK.md:23`, `계약:170`)가 아니라 주 방어가 된다 | grant만으로는 쓸 수 없다. 등록된 증명 키로만 발급·사용된다. 증명 키 유출은 지금의 client 키 유출과 같은 무게다 |
| 인증서 결속 grant의 대체 | client_id·발급 kid 결속만 남는다 — 발신자 결속이 없다 | 등록된 증명 키의 지문 결속 |
| 이전 방법 | 계약 새 판을 두 저장소가 함께 동결한 뒤, 옛 mTLS 리스너와 새 리스너를 한동안 함께 띄운다(두 리스너를 받는 조립 코드가 필요하다). PIPE가 설정으로 새 경로로 옮기고, 관찰 뒤 옛 리스너를 끈다. 두 경로의 grant는 서로 받지 않는다 | 2-A와 같다 |
| 되돌리기 | PIPE를 옛 리스너로 되돌린다(옛 인증서·CA를 은퇴 전까지 보존한다). PR Search를 이전 판으로 내려도 인증서 지문이 다른 새 grant는 발신자 불일치로 거절되므로(`pipe/grant-store.ts:90`) 열리는 쪽이 아니라 닫히는 쪽이다. 새 마이그레이션은 033과 같은 이유로 운영에서 내리지 않는다(`ADR:113`) | 2-A와 같다 |

### 4.3 안 3 — 조직의 기존 SSO/OAuth 단기 토큰으로 절차 통합

갈래:

- **3-A 토큰 교환.** PIPE가 사용자의 IdP 토큰을 IdP에서 PR Search 대상(`aud`) 토큰으로 바꾸고(RFC 8693, `act`에 PIPE — 표준 참조), PR Search는 설정에 고정한 IdP JWKS로 검증한 뒤 지금처럼 자기 grant로 바꾼다. PIPE 전용 서명 키와 `kid` 등록이 IdP 키로 대체된다.
- **3-B SSO 토큰 전달.** 사용자의 SSO 액세스 토큰을 PR Search에 그대로 넘긴다. 대상이 PR Search로 좁혀진 토큰이 아니라면 다른 서비스에도 쓰이는 토큰을 넘기는 것이어서, PR Search와 PIPE의 로그·캐시가 다른 서비스에도 통하는 사용자 토큰을 쥐게 된다. 대상을 좁히면 결국 3-A다. 기각한다.
- **3-C GHE OAuth 토큰 전달.** PIPE가 사용자의 GHE 토큰을 넘기고 PR Search가 GHE `/user`로 신원을 정한다. 토큰의 대상이 제한되지 않고, PIPE가 사용자의 GHE 권한을 손에 쥐며, ③과 ⑤가 섞인다. 기각한다.

전제가 확인되지 않았다. 공통 계약은 사내 위임 제품이 있으면 ADR로 비교할 수 있다고만 적고(`계약:57`), 그 존재는 확인되지 않았다(`handoff/CONTRACT_DIFF.md:226`). PIPE의 로그인은 자체 HS256 JWT로 기술되어 있어(`계약:166`, 확인 범위는 `계약:28`) 조직 IdP 토큰이 PIPE에 있는지부터 알 수 없다. PR Search에는 OIDC ID 토큰용 JWKS 캐시와 검증기가 있지만(`packages/authz/src/jwks.ts:1-29`, `packages/authz/src/id-token.ts:110-136`) 액세스 토큰과 `act`를 판정하는 코드는 없고, IdP로 나가는 것은 `web`뿐이다(`packages/authz/src/oidc.ts:4-6`, `보안:66`). search-api에서 IdP로 나가는 경로가 새로 필요하다.

| 항목 | 내용(3-A 기준) |
| --- | --- |
| 없어지는 설정 | 정책의 `signing_keys`와 PIPE 서명 키 쌍, 420초 교체 절차(IdP의 키 회전으로 대체). 조건부로 binding 가져오기: PR Search 로그인이 같은 IdP이고 사용자 ID가 OIDC `sub`이면(`apps/search-api/src/auth/role-command.ts:33`) `sub` 일치로 줄일 수 있다. GHE OAuth 로그인(사용자 ID `github:<숫자 ID>` — `apps/web/app/auth/callback/route.ts:76`·`157`, 절차는 `RUNBOOK:542-566`)이면 binding은 그대로 필요하다 |
| 여전히 필요한 설정 | ①, 서비스 인증(IdP client 자격 — `private_key_jwt`나 mTLS 결속 토큰(RFC 8705), 또는 지금의 mTLS 유지), IdP issuer·JWKS 주소·audience, PR Search grant·회수 표·Redis `jti`, 허용 목록, ⑤ |
| PIPE 변경 | 조직 IdP 연동(로그인부터일 수 있다), 토큰 교환 호출, 새 계약판 구현 |
| PR Search 변경 | IdP 액세스 토큰 검증기(`act`·`azp` 판정), 설정 새 판, search-api → IdP 아웃바운드와 사설 CA·프록시 대응(`RUNBOOK:673-728`), 문맥 회수를 IdP 세션(`sid`)과 잇는 규칙, 발급 경로가 옛 assertion과 IdP 토큰을 함께 받는 이행 코드, 계약과 시험 |
| 조직 의존 | IdP에 새 client 등록, 토큰 교환 정책, audience, 토큰 수명 |
| 사용자 추적 | IdP `sub`와 `act`(PIPE)가 남아 오히려 분명해질 수 있다. binding·이벤트는 유지한다 |
| 저장소 권한 | grant를 유지하면 그대로다. IdP 토큰에 역할·저장소 주장이 있어도 쓰지 않는다(`pipe/assertion.ts:17-18`의 원칙 유지) |
| 회수 | grant를 유지하면 PR Search 쪽 회수는 그대로다. IdP에서 사용자를 끄면 다음 교환부터만 막힌다. 액세스 토큰은 만료까지 살고, 즉시 반영하려면 introspection이나 back-channel logout이 필요하다(표준 참조) |
| 재생 공격 | 교환 토큰의 `jti`를 지금처럼 한 번만 소비하면 교환 단계는 막힌다. IdP 토큰 자체는 bearer다 |
| 토큰 탈취 | IdP 액세스 토큰의 수명이 지금 assertion(60초 이하)보다 길면 창이 커진다. 발신자 제약(DPoP·mTLS 결속)은 IdP 지원에 달려 있다. mTLS를 빼면 가로챈 교환 토큰을 먼저 내는 쪽이 grant를 받는다 |
| 인증서 결속 grant의 대체 | mTLS를 유지하면 그대로다. 없애면 IdP가 증명한 client(`azp`)와, IdP가 발신자 제약을 주는 경우 그 키·인증서 지문 |
| 이전 방법 | IdP 기능 확인 → 새 ADR(ADR-025와 비교) → 계약 새 판 → 발급 경로가 옛 assertion과 IdP 토큰을 issuer로 나눠 함께 받는 기간 → PIPE 전환 → 옛 키 은퇴 |
| 되돌리기 | PIPE가 자기 서명 assertion으로 돌아간다. 은퇴 전까지 옛 서명 키를 정책에 둔다 |

### 4.4 안 4 — 인증을 전부 없애고 내부 IP만 신뢰

단순화 효과는 크다. 서버·client 인증서, CA, 서명 키, Redis `jti`, grant 발급과 캐시, 회수 호출, 긴급 회수 CLI가 없어지고, PIPE는 사용자를 머리글 하나로 알린다. 연동이 가장 빨리 선다.

그러나 이 안은 사용자를 **주장**할 뿐 증명하지 않는다. 사용자별 권한 계산을 남겨도 그 계산의 입력(누구인가)을 허용된 IP의 누구든 고를 수 있으므로, 실효 권한은 「허용 IP에 닿는 모든 호스트·프로세스가, 매핑된 어느 사용자의 권한으로든 읽을 수 있다」가 된다. 0장에서 전제로 삼지 않기로 한 바로 그 상태다.

| 항목 | 내용 |
| --- | --- |
| 없어지는 설정 | ②의 전부, ③의 서명·`jti`, ④의 grant·회수 전부. ①도 평문으로 두면 없어진다(권하지 않는다 — 소스 본문이 평문으로 흐른다) |
| 여전히 필요한 설정 | 네트워크 ACL(호스트 방화벽, HAProxy `src` ACL — `handoff/deploy-examples/haproxy-passthrough.example.cfg:12-13`), 사용자 머리글 → PR Search 사용자 매핑, 허용 목록, ⑤ |
| PIPE 변경 | assertion·grant 제거, 사용자 머리글 추가 |
| PR Search 변경 | 연동 인증 모듈 대부분을 지우고 **신원 머리글을 읽는 새 코드**를 넣는다. 이것은 「search-api는 신원을 주장하는 어떤 헤더도 읽지 않는다」(`보안:70`)를 뒤집는다 |
| 사용자 추적 | 감사 기록의 사용자는 요청자가 주장한 값이다. 누가 보냈는지 증명할 수 없어 기록을 믿을 수 없다 |
| 저장소 권한 | 계산은 남아도 입력을 위조할 수 있어 사용자 경계가 사실상 없다. 허용 목록 교집합만 남는다 |
| 회수 | 사용자·grant·문맥 회수가 없다. 막는 방법은 방화벽 규칙 변경뿐이다 |
| 재생 공격 | 막을 대상이 없다 — 재생할 필요도 없이 요청을 새로 만들 수 있다 |
| 토큰 탈취 | 훔칠 토큰이 없다. 대신 허용 IP의 어느 프로세스든(SSRF를 당한 서비스 포함) 아무 사용자로 요청할 수 있다 |
| 인증서 결속 grant의 대체 | 없다. IP는 자격이 아니다 |
| 이전 방법 | SRS FR-INT-001 개정 CR → ADR-025와 보안 원칙(`보안:70`·`72`) 개정 → 두 저장소의 계약 폐기 합의 → PIPE의 신원 전달 방식 전환 → mTLS 리스너 제거 순이다. 033 표는 운영에서 내리지 않는다(`ADR:113`). 코드를 바꾸지 않고 정책의 `tls_client`만 비우면 기동이 거부된다(`pipe/config.ts:222-224`) |
| 되돌리기 | 이전 판으로 되돌리는 것은 쉽다. 그러나 열려 있던 동안의 노출과, 그동안 믿을 수 없게 된 감사 기록은 되돌릴 수 없다 |

IP 신뢰의 실무 문제:

- HAProxy 예시는 `mode tcp`이고 `send-proxy`가 없다(`handoff/deploy-examples/haproxy-passthrough.example.cfg:7-20`). PROXY protocol을 쓰지 않는 한 PR Search가 보는 발신 주소는 HAProxy의 주소이므로, IP를 거르는 자리는 HAProxy 하나가 된다(표준 참조 — 사내 구성은 7장).
- NAT·공유 출구·컨테이너 네트워크는 여러 발신자를 한 주소로 합칠 수 있다. 사내 Docker·호스트에서 원래 주소가 보존되는지는 확인하지 않았다(7장).
- 현재 원칙과 정면으로 부딪친다. 공통 계약의 신뢰 경계는 「사내 IP라는 이유만의 신뢰」를 신뢰하지 않는다(`계약:64`). 계약 불변식 7(`계약:77`), D-02의 「IP 허용 목록만으로 헤더를 믿는 안은 채택하지 않습니다.」(`handoff/CONTRACT_DIFF.md:29`), 정책 파서의 규칙(`pipe/config.ts:222-224`), 보안 아키텍처의 이유(「거쳐 왔다」는 가정에 기대면 그 가정이 깨지는 날 통제가 통째로 사라진다, `보안:72`)가 모두 이 안을 막는다. SRS FR-INT-001의 AC-1~AC-4·AC-7·AC-11(`SRS:13`)이 모두 바뀐다.

## 5. 비교표

| 성질 | 현재 | 안 1 | 안 2-A | 안 2-B | 안 3-A | 안 4 |
| --- | --- | --- | --- | --- | --- | --- |
| 서비스(PIPE) 식별 | client 인증서 | 같다 | 발급 때 assertion 서명, 조회는 grant 소지 | assertion 서명 + 등록 키의 요청 증명 | IdP client 자격 | 발신 IP |
| 사용자 신원 증명 | PIPE 서명 assertion + binding | 같다 | 같다 | 같다 | IdP 토큰(`sub`·`act`) + binding(조건부로 축소) | 주장뿐 |
| grant 발신자 결속 | 인증서 지문 | 같다 | 없다 | 증명 키 지문 | IdP 지원에 달림 | grant 없음 |
| 재생 방지 | 발급은 `jti`, 조회는 발신자 결속 | 같다 | 발급만 | 발급과 조회 | 교환 단계는 `jti`, 이후는 IdP에 달림 | 없음 |
| 즉시 회수 | client·키·인증서·문맥·grant·binding | 같다 | 인증서 종류 빠짐 | 인증서 대신 증명 키 | PR Search 쪽은 같다, IdP 쪽은 만료까지 | 방화벽뿐 |
| 저장소 권한 | 사용자 범위 ∩ 허용 목록 | 같다 | 같다 | 같다 | 같다 | 입력 위조 가능 |
| 사람이 하는 운영 | 인증서 셋·서명 키·binding·purge | 인증서가 자동화되고 나머지는 같다 | 서버 인증서·서명 키·binding·purge | 2-A + 증명 키 | 서버 인증서·IdP 등록·binding(조건부)·purge | 방화벽 |
| PR Search 변경량 | – | 없음(선택 코드 항목만) | 중 — 연동 모듈 7개, 마이그레이션, 시험 | 대 — 2-A + 증명 검증·저장 | 대 — 새 검증기, 아웃바운드, 이행 코드 | 중 — 제거 + 신원 머리글 코드 |
| PIPE 변경량 | – | 인증서 자동화, 캐시 키 준수 | 소~중 | 중 | 대 — IdP 연동 | 소 |
| SRS·ADR·계약 변경 | – | **없음**(handoff 운영 문서만) | FR-INT-001 AC-1·AC-4·AC-11, ADR-025 개정, 계약 새 판 | 같다 | 같다 + 새 ADR | AC-1~AC-4·AC-7·AC-11, ADR-025와 보안 원칙 뒤집기, 계약 폐기 |
| 되돌리기 | – | 즉시 | 옛 리스너를 보존하는 기간 안에서 쉽다 | 같다 | 옛 키를 보존하는 기간 안에서 쉽다 | 코드는 쉽고 노출은 되돌릴 수 없다 |

## 6. 권고와 전제·위험·승인 대기

### 6.1 권고

안 1을 권고한다. 순서는 (1) 서버·client·CA 인증서의 만료 감시와 경보, (2) client 등록을 SAN 정확 일치로 전환하고 CA의 발급 통제 확인, (3) 서버 인증서 갱신 자동화(재기동 창을 알리고 계획한다), (4) PIPE client 인증서 자동 갱신과 캐시 키 준수 확인, (5) 서명 키 교체 달력이다. 코드·계약·SRS는 바뀌지 않는다.

인증 구조와 무관하게 함께 줄일 수 있는 절차도 있다: PIPE 운영 절차를 `RUNBOOK`의 한 절로 모으는 것(지금은 handoff 문서에만 있다, 2.3절), `docker compose run … node dist/pipe-integration-cli.js` 대신 `prsctl` 하위 명령을 두는 것(`handoff/DEPLOYMENT_AND_ROLLBACK.md:108`의 후속 작업), 하루 한 번의 `purge`를 호스트 정기 작업으로 등록하는 것.

안 2-B는 사내 CA가 client 인증서를 운영할 수 없거나, PIPE → PR Search 경로에서 L4 passthrough와 직접 연결이 모두 불가능하다고 확인될 때만 새 ADR로 연다. 2-A·2-C·3-B·3-C·안 4는 기각한다. 3-A는 7장의 IdP 항목이 확인되면 새 ADR로 비교한다.

### 6.2 전제

- 사내 CA가 서버 인증서와 SAN을 가진 client 인증서를 발급하고, 그 SAN의 발급을 PIPE 서버로 제한할 수 있다.
- PIPE → PR Search private 포트가 직접 연결이나 L4 passthrough로 닿는다(`ADR:109`가 적은 대가).
- PIPE가 공통 계약 7장의 캐시 키(활성 인증서 지문 포함, `계약:296-297`)를 구현한다.
- 운영 입력(주소·포트·CA·SAN·issuer·audience·허용 목록)이 채워진다(`handoff/PIPE_INTEGRATION_HANDOFF.md:198-209`).

### 6.3 위험과 완화

| 위험 | 완화 |
| --- | --- |
| 자동 갱신이 실패해 인증서가 만료되면 연동 전체가 핸드셰이크에서 끊긴다 | 만료 감시와 경보를 자동화보다 먼저 세운다. 수명의 일정 비율이 남았을 때 갱신한다 |
| 서버 인증서 갱신의 재기동이 공개 검색도 끊는다(`index.ts:211-245`) | 사용이 적은 시간에 계획한다. 재기동 없는 재적재는 코드 항목으로 따로 승인받는다 |
| SAN 일치로 바꾸면 같은 SAN을 받은 다른 인증서도 통과한다 | client CA를 PIPE 전용 발급 CA로 좁히고, 그 SAN의 발급 권한을 CA에서 막는다. 알려진 인증서 하나가 샌 것이면 지문 긴급 회수로 막는다(`pipe/command.ts:413-483`, `repo:466`). SAN 발급 경로가 샌 것이면 같은 SAN의 새 인증서가 계속 통과하므로(`pipe/transport-auth.ts:58-61`) 지문 회수로는 따라잡을 수 없다. 그때는 `--kind client` 긴급 회수와 CA 쪽 발급 중지를 함께 한다(`pipe/command.ts:425-429`). 이 회수는 되돌리지 않으므로 새 client_id·정책 수정·재기동이 따른다(`033:123-124`) |
| 교체 순간 옛 grant가 `GRANT_BINDING_MISMATCH`로 떨어진다 | PIPE가 캐시 키에 활성 인증서 지문을 두고(`계약:296-297`) 자기 인증서 교체를 알 때 캐시를 버리면(`계약:338`) 다음 요청이 새 grant로 이어진다. 그렇지 않으면 사용자는 503 `SEARCH_AUTH_UNAVAILABLE`을 보고, PIPE는 이 코드를 무조건 재시도하지 않는다(`계약:338`, `pipe/errors.ts:68`). 그래서 캐시 키 준수는 안 1의 전제다(6.2절) |
| 자동화 도구가 서버·client 비밀키를 다루는 새 비밀 경로가 된다 | 비밀키를 발급 호스트 밖으로 옮기지 않는 방식(각 서버에서 키 생성 → CSR)을 고른다 |

### 6.4 승인 대기 항목

아래는 모두 승인 전에는 하지 않는다.

1. 이 검토서의 권고(안 1)를 방향으로 채택할지 — CR-136으로 받는다. 채택되어도 SRS·ADR-025·계약은 바뀌지 않는다. 바뀔 문서는 `handoff/DEPLOYMENT_AND_ROLLBACK.md` 4장(자동화 절차)과 그것을 가리키는 `인프라:7` 정도이며, cascade의 범위는 CR-136에서 따로 정한다. handoff 문서가 바뀌면 `handoff/manifest.json`의 파일 해시는 바뀌지만, 계약 checksum(OpenAPI와 operation map, `handoff/PIPE_INTEGRATION_HANDOFF.md:25`)은 바뀌지 않는다.
2. 선택 코드 항목 — 각각 별도 WP다: (가) 인증서 만료 지표 또는 `prsctl health` 경고 줄, (나) 재기동 없는 서버 인증서 재적재(`setSecureContext` — Fastify 결합 확인부터), (다) `prsctl`의 PIPE 하위 명령.
3. PIPE 쪽 변경(인증서 자동 갱신, 캐시 키 확인)은 PIPE 담당과의 합의가 필요하다. 한쪽 저장소만 절차를 바꾸지 않는다(`계약:57`).
4. 안 2-B·3-A를 다시 여는 일은 새 ADR과 SRS FR-INT-001 변경 CR이 먼저다.
5. PIPE 운영 절차의 `RUNBOOK` 편입과 `purge`의 호스트 정기 작업 등록(6.1절 둘째 문단) — 운영 문서·설정 변경이므로 CR-136 cascade 안에서 따로 승인받는다.

## 7. 확인하지 못한 것

| 항목 | 왜 중요한가 | 걸리는 안 | 확인 방법 |
| --- | --- | --- | --- |
| 사내 CA가 client 인증서를 발급하는가, SAN 형식(URI·DNS), 자동 발급 수단(ACME·EST·SCEP 등)의 유무, 그 SAN의 발급 권한 통제, 권장 수명 | 안 1의 성립 조건이자 SAN 전환의 안전성 | 1·2 | 보안·PKI 담당에게 묻는다(`handoff/CONTRACT_DIFF.md:222`) |
| 사내 HAProxy가 L4 passthrough를 허용하는가, 또는 직접 연결이 가능한가 | mTLS 유지의 조건 | 1·2 | 운영 담당(`handoff/CONTRACT_DIFF.md:223`) |
| PIPE → PR Search 경로에서 원래 발신 주소가 보존되는가(NAT·공유 출구·컨테이너 네트워크·PROXY protocol) | IP ACL이 뜻을 갖는가 | 2-A·4 | 사내 네트워크 확인 |
| search-api가 밖으로 나갈 때 HTTP(S) 프록시가 강제되는가 | Node `fetch`는 프록시 변수를 보지 않는다(`RUNBOOK:724-728`) | 3 | 운영 담당 |
| 조직 SSO 제공자 — OIDC/OAuth 토큰 교환(RFC 8693), `act`, `sid`·back-channel logout, 발신자 제약 토큰, 액세스 토큰 수명 | 안 3의 성립 조건 | 3 | IdP 담당(`handoff/CONTRACT_DIFF.md:226`) |
| PIPE가 조직 IdP로 로그인하는가 | 공통 계약은 PIPE 로그인 JWT를 자체 HS256으로 기술한다(`계약:166`, `계약:28`) | 3 | PIPE 담당 |
| PR Search 사내 배포의 로그인 공급자(`AUTH_PROVIDER`) | 안 3에서 binding을 줄일 수 있는가 | 3 | 이 저장소에서는 알 수 없다 — 운영 설정 확인 |
| 사내 GHES에서 설치 토큰으로 `GET /users/{login}`이 되는가 | 모든 안의 ③⑤ | 전부 | `handoff/CONTRACT_DIFF.md:224` |
| PIPE BFF의 grant 캐시 키 구현(인증서 지문 포함 여부) | 안 1의 교체 영향 | 1 | PIPE 담당 |
| Fastify `app.server`에서 `setSecureContext`로 바꾼 인증서가 새 연결에 적용되는가, client CA도 함께 바뀌는가 | 안 1의 선택 코드 항목 | 1 | 로컬 통합 시험으로 먼저 잰다 |
| 실제 두 서버 사이의 mTLS end-to-end | 현재 구조 자체가 사내에서 검증되지 않았다 | 전부 | `handoff/DEPLOYMENT_AND_ROLLBACK.md:145-155`의 smoke(NOT_RUN) |

이 검토서의 근거는 코드와 문서 읽기이며, 실측은 0.2절의 로컬 Node 실험 하나뿐이다.
