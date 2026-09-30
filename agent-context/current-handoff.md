# Current Handoff — 2026-09-30 PR Search 23차 (A~E: 오류 세 건·Source 총량 제한 해소·하위 파일 검색·PIPE blame·인증 검토서 병합, 0.1.0-pilot.21 발행)

## Start here

- **main은 `4b73b70`이다(23차 마감 기록·인계, PR #261). 이 인계를 고친 발행 기록 PR(브랜치 `docs/pilot21-release-record`)이 병합됐으면 그 커밋이다. Release `0.1.0-pilot.21`을 발행했다**(2026-09-30 12:27:58 KST, 사용자 지시 「21 릴리즈 발행해」, 태그 → `4b73b70`, 자산 `pr-search-0.1.0-pilot.21-offline.tar.gz` 1,169,436,369 bytes, SHA-256 `a4fffeacfab5321a080530483caecc7158d9afe4f9cba398e81280d0e2877e78`, 원장 머리 절 「0.1.0-pilot.21 발행」). 23차 지시(사용자, 2026-09-29)는 A~E 다섯 기능을 기능마다 CR·WP·PR로 나눠 구현·검증·리뷰·main 반영까지 마치는 것이었다. 새 Release 발행과 사내 적용은 이번 범위가 아니다.
  - **A 오류 세 건** — CR-129/WP-110(DEV-786: 공개 search-api의 처리되지 않은 오류를 계약 봉투의 500 `INTERNAL_ERROR`와 같은 correlation ID의 진단 기록으로, PR #253 → `e581b52`), CR-130/WP-111(DEV-788: 구간 조회 `q`의 `kind:`·`-kind:`를 설명 있는 400으로, PR #254 → `5850232`), CR-131/WP-112(DEV-787: 작업 공간 0건 화면의 조건 변경 추천 — 누르면 그 조건만 지우고 다시 검색, PR #255 → `c33ea25`).
  - **B** CR-132/WP-113(PR #256 → `aa29c5c`): Diff·Time-lapse·파일 트리의 총량 제한 해소 — 큰 파일·큰 디렉터리·3,000개를 넘는 변경·오래된 이력을 끝까지 읽는다. GitHub 자체 제한과 제품 제한을 나눠 적었다(원장 6.123장).
  - **C** CR-133/WP-114(PR #257 → `2e94b71`): Files & folders 검색이 고정 revision의 모든 파일 경로를 찾는다(API-SRC-005) — 열지 않은 폴더·같은 이름 파일까지, 선택하면 History·Diff·Time-lapse로 이어진다.
  - **CR-134/WP-115**(PR #258 → `a02a145`): C의 병합 커밋 main CI를 두 번 빨갛게 한 시험 결함 DEV-796을 고쳤다(공유 DB의 잔재 저장소 때문에 냉시작 스윕 대기가 일찍 풀렸다). 사용자가 「작은 PR로 먼저 고침」을 골랐다.
  - **D** CR-135/WP-116(PR #259 → `311fdb0`): PIPE용 GraphQL blame — API-SRC-006·API-INT-015 `read.source.blame`, 능력 `source_blame:read`, 새 501 `SOURCE_BLAME_UNSUPPORTED`, ADR-027. **기능 게이트 `SOURCE_BLAME_ENABLED`는 기본 꺼짐**이라 켜기 전에는 이전과 같고 PSI-1.0을 유지한다(CONTRACT_DIFF D-26).
  - **E** CR-136/WP-117(PR #260 → `0d14990`): PIPE 연동 인증 간소화 검토서(구현 없음) — 권고는 안 1(현재 구조와 PSI-1.0 유지, 인증서 관리만 자동화). 채택과 구현은 승인 대기다.
- **다음 할 일**: (1) 사용자: 0.1.0-pilot.21의 사내 적용 — [pilot.21 절차서](../docs/40_delivery/pr-search-pilot21-import-procedure.md)를 따른다(pilot.20에서 3장 업그레이드와 7.K만, 마이그레이션·재색인 없음). 발행 전 격리 리허설(pilot.20 상태 → 후보 rc1)을 통과했다. (2) 사용자: blame을 켜기 전에 사내 GHES의 버전·`Commit.blame` 지원·App 권한을 확인하고 RUNBOOK 7.L대로 켠다. (3) 사용자: CR-136 검토서의 권고 채택 여부와 6.4절 승인 대기 항목. (4) 후속 후보(사용자 판단): DEV-797(트리 비교 목록의 디렉터리 상한), DEV-792·798·799(시험 안정성), DEV-790·791(웹 프록시의 correlation ID·502 기록), DEV-795. (5) 사용자: 23차 자원 정리(아래 「Verify before changing code」 1·2번).
- **병합 승인은 PR 번호가 정해진 뒤 그 PR에 대해 이번 세션에서 받는다.** 23차는 PR마다 CI 뒤 AskUserQuestion으로 승인받았다(#253~#260). 병합 기록은 다음 기능 PR의 첫 커밋에 싣고, 마지막 기능(E)의 기록만 이 마감 기록·인계 PR에 실었다(사용자 결정).

머리는 늘 실측한다: `git fetch && git log origin/main --oneline -5`, `gh pr list --state open`, `gh release list --limit 3`.

## Delivered (23차)

- **A~E와 CR-134** — PR 여덟 개(#253~#260) 모두 PR CI와 병합 커밋의 main CI를 거쳤다. C의 병합 커밋 main CI(run 36540037060)만 빨갰고(DEV-796 시험 결함, 재실행에서 DEV-798 부하 p95도), CR-134 병합 뒤 main CI가 초록으로 돌아왔다(run 36546049635). 기록은 원장 6.120~6.127장.
- 기능마다 수정 전 실패를 먼저 보고, 전 계층 게이트(Node 22)·변이 확인·독립 리뷰(지적 반영)를 거쳤다. 실제 경로 확인: B·C는 실제 Chromium → `next start` → 빌드된 search-api와 실제 `GitHubTransport` → GHE 대역, D는 PIPE 통합 하네스의 실제 mTLS → 실제 `GitHubTransport` → GHE 대역 `/api/graphql`.

- **0.1.0-pilot.21 발행**(2026-09-30) — main `4b73b70`에서 후보 `0.1.0-pilot.21-rc1`을 먼저 만들어, pilot.18 스냅숏 → 공식 pilot.20 자산(SHA-256 대조)으로 pilot.20 절차서 순서를 밟아 만든 pilot.20 상태에서 실제 `prsctl`로 올렸다: 옛 `.env`(새 키 0개)로 기동, 번들 위 배선(CR-128 500→200, CR-129 봉투·correlation_id, CR-130 500→400, CR-135 `feature_disabled`), PostgreSQL 정본·ES 문서·API가 전후 같음. 발행 직전 앱 이미지 7종이 후보와 7/7 같았고, 발행 뒤 digest·태그·manifest·내려받은 사본의 `prsctl verify`·RUNBOOK·소스 계보를 재대조했다. 발행 기록 PR의 첫 커밋이 PR #261의 병합 결과(PR CI run 36594758400, main CI run 36601486507 success)를 적었다.

## Verify before changing code

1. **23차 격리 자원은 남아 있다** — 컨테이너 `prs-b8-postgres`(127.0.0.1:55471), `prs-b8-redis`(56411), `prs-b8-es`(59231, `cluster.name=prs-b8-isolated`). 시험 DB가 여럿이다(`docker exec prs-b8-postgres psql -U prs -l`로 목록). 세션 scratchpad: `6bcb6431…`(23차 첫 세션 — 조사 보고 `inv/`), `7c00c46a…`(B — 환경 `env-b8.sh`), `6f9f3d27…`(C·CR-134·D 설계 `D-design.md`·사실표 `D-facts.md`), `ec6de473…`(D 마무리·E — 게이트 `gates.sh`, 기록 스크립트 `docs/`).
2. **워크트리** — `/home/roqkf/pr-search-wt/`의 `cr129-errors`·`cr130-range-kind`·`cr131-workspace-relaxation`·`cr132-source-limits`·`cr133-file-search`·`cr134-dev796`·`cr134-pipe-blame`(D, 브랜치 `feature/cr135-pipe-blame`)·`cr136-auth-review`(E)와 이 기록 워크트리. 모두 병합됐다. 정리 여부는 사용자가 정한다.
3. **공개 저장소** — 사내 식별자는 시험·문서·커밋·PR에 싣지 않는다. 23차는 가상 호스트(`*.example`·`*.invalid`)와 가상 저장소·사용자만 썼다.
4. **blame은 기본 꺼짐** — `SOURCE_BLAME_ENABLED=false`에서는 PIPE의 exchange·`/context`가 CR-135 전과 같다. 켜려면 사내 GHES 확인이 먼저다(RUNBOOK 7.L). `GHE_GRAPHQL_URL`은 비우면 `GHE_API_URL`에서 도출한다(`/api/v3` → `/api/graphql`).
5. 새 코드의 그림자 검사 셋, 통합 시험의 자료 정리 규칙(DEV-799 — 통합 파일 여럿이 활성 저장소 행을 남긴다), 사용자가 main에서 통째로 덮는 `agent-context/upstream-feedback.md`는 22차와 같다.

6. **발행 리허설 자원** — scratchpad `ec6de473…/scratchpad/rel21/`(도구 `r21/`의 `run21.sh`·`p21.mjs`·`cap21.mjs`·`cmp21.mjs`, 스냅숏 `r21/snap/vol-p20`(pilot.20 상태)·`vol-773-p18b`, 로그 `r21/logs21/`, 공식 pilot.20 자산 사본 `p20/`, 발행본을 내려받은 사본 `dl21/`). 리허설 컨테이너·볼륨(`prs-s20`)은 내렸다. 발행 워크트리 `/home/roqkf/pr-search-wt/release21`(detached `4b73b70`)의 `deploy/single-host/bundle/`에 rc1과 발행본 번들이 있다. 메모리 때문에 잠시 멈췄던 `prs-kr-es`·`prs-b8-es`는 다시 켰다.

## Open boundary

- **사내 적용·사내 재검증 NOT RUN** — A~E 모두 사내에 적용하지 않았다. blame은 사내 GHES를 거치지 않고 대역으로만 검증했다(버전·`Commit.blame` 지원·App 권한·GraphQL 한도·오류 본문의 실제 모양 미확인).
- **D의 한계** — 빌드 산출물을 배포 환경 변수로 띄운 확인은 하지 않았다(환경 변수 → 전송 배선은 설정·runtime 단위 시험과 회귀 문자열 가드가 조각으로 건다). GraphQL 한도는 프로세스 안에서 재호출을 막지 않고 429 `Retry-After`로 돌려줄 뿐이다.
- **E** — 검토서만 있다. 사내 CA·HAProxy·IdP·PIPE BFF의 실제 구성은 확인하지 못했다(검토서 7장).
- **열린 관찰** — DEV-790·791(웹 프록시), DEV-792·798·799(시험 안정성), DEV-795(예전 파일 조회의 1MB 초과), DEV-797(트리 비교 목록의 디렉터리 상한).

## References

- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 머리 절 CR-129~CR-136, 6.120~6.127장, 5장 DEV-786~DEV-799.
- 원장 머리 절 「0.1.0-pilot.21 발행 — CR-128~CR-136 누적」, 사내 반입 [pilot.21 절차서](../docs/40_delivery/pr-search-pilot21-import-procedure.md).
- 변경 대장 `docs/00_governance/change_control.md`의 CR-129~CR-136.
- PIPE 인계 `handoff/pipe-search-integration/v1/CONTRACT_DIFF.md` D-24·D-25·D-26.
- 검토서 `docs/30_technical_architecture/pr_search_pipe_auth_simplification_review.md`.
- 세션 노트 `agent-context/session-notes.md` 「23차」, todos 「23차 뒤 남은 것」.
