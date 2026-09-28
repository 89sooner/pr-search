# Current Handoff — 2026-09-29 PR Search 22차 (CR-128 0건 검색의 완화 후보와 `kind:` 재해석 병합)

## Start here

- **main은 `d602890`이다(CR-128, PR #251). 이 인계를 고친 병합 기록 PR(브랜치 `docs/cr128-merge-record`)이 병합됐으면 그 커밋이다.** 22차 지시(사용자, 2026-09-28)는 사내 `0.1.0-pilot.20`에서 `kind:`와 다른 필터를 함께 쓴 검색이 500/503으로 실패한다는 보고를 점검하고 고치는 것이었다 — 결과가 없어도 정상 0건을 보이고 조건 변경 추천도 정확하게 준다. 오류만 숨기거나 조건을 지워 성공시키지 않고, 새 Release 발행과 사내 적용은 하지 않는다.
  - **CR-128 / WP-109**(PR #251 → `d602890`): 실패는 모두 **본 조회가 0건을 센 뒤** 완화 후보를 만들다 났다 — `runSearch`가 후보 계산에 `kind:`를 걷어 내지 않은 원래 AST와 좁힌 대상을 넘겨 `buildQuery`의 가드(`KindFilterNotAppliedError`)가 던졌다(DEV-783). `path:`·저장소 이름과 무관하고, 운영 기본 화면(Repository workspace)은 모든 검색에 `kind:`·`repo:`를 붙이므로 그 화면의 0건 검색이 전부 「Unable to load search results.」였다. 이제 후보마다 `kind:`를 요청 경로의 원래 대상에서 다시 해석해 세고(`apps/search-api/src/search/relaxation.ts`), 모순된 `kind:`의 0건도 후보를 세며, 추천 계산의 실패는 본 조회의 200을 바꾸지 않고 응답 `relaxation_hints_incomplete: true`와 로그 `search.relaxation_incomplete`로 밝힌다(DEV-785). 레거시 화면은 후보 건수를 `would_yield`로 읽는다(DEV-784). SRS v2.49(`FR-SRCH-006` AC-3·예외/실패 처리), API 계약 v0.49, PIPE 인계 D-23(계약 checksum `5bc60722…`).
  - 사내 보고의 원문은 저장소에 없어 `agent-context/upstream-feedback.md`에 지시서 요지로 새 항목을 만들었다(사용자 결정, 원문이 아님을 적었다). 그 항목에 사내에서 새 빌드를 적용한 뒤 다시 조회할 네 가지가 있다.
- **다음 할 일**: (1) 사용자: CR-128을 담은 다음 배포본과 사내 적용 — 적용 뒤 upstream-feedback 새 항목의 네 가지를 조회해 적는다. 리허설 기준 판은 pilot.20 상태다. (2) 사용자: 22차 자원 정리(아래 「Verify before changing code」 1·2번 — 2026-09-29에 「모두 남겨 둠」을 골랐다). (3) 후속 후보(사용자 판단): DEV-786(공개 서버의 처리되지 않은 오류 본문), DEV-787(작업 공간의 후보 표시), DEV-788(구간 조회 `q`의 `kind:`), 21차에서 넘어온 DEV-778·DEV-779·DEV-588, CR-126 전환기 보완을 끄는 조건, `OD-018`, RUNBOOK 정정 후보 둘.
- **병합 승인은 PR 번호가 정해진 뒤 그 PR에 대해 이번 세션에서 받는다.** 22차는 PR #251을 CI 뒤 AskUserQuestion으로 승인받았고, 같은 질문에서 기록 PR의 생성·CI·병합도 승인받았다.

머리는 늘 실측한다: `git fetch && git log origin/main --oneline -5`, `gh pr list --state open`, `gh release list --limit 3`.

## Delivered (22차)

- **CR-128** — 수정 전 코드(`d2d894d`)에서 질의 13개·PIPE·실제 화면으로 재현했다(`kind:`가 든 0건 7개가 모두 500, 새 통합 시험 24건 중 20건 실패). 수정 뒤에는 후보마다 그 필터를 빼고 다시 검색한 건수가 `would_yield`와 같다. 실제 Chromium → `next start` 웹 프록시 → 빌드된 search-api → 격리 DB·ES로 수정 전·수정 뒤·msearch 고장 주입 세 판을 비교했다. 전 계층 게이트, 변이 18종(모두 죽음), 코드·문서 독립 리뷰(모두 병합 가능, [하] 반영), PR CI(run 36426166182)와 병합 커밋의 main CI(run 36456023880 success). 원장 6.119장.

## Verify before changing code

1. **22차 격리 자원은 남겨 두었다(사용자 결정, 2026-09-29)** — 컨테이너 `prs-kr-postgres`(127.0.0.1:55461, 시험 DB `prs_test_kr`·`prs_test_kr2`·`prs_test_kr3`·`prs_screen`·`prs_screen_before`·`prs_screen_fault`), `prs-kr-redis`(56401), `prs-kr-es`(59221, `cluster.name=prs-kr-isolated`). 볼륨 없이 띄웠다. 세션 scratchpad `b90ef88c…/scratchpad/`에 재현 시험(`repro/`)·화면 확인 실행기(`screen/launch.mjs`·`screen.mjs`)·변이 스크립트(`mutate.py`)·게이트 스크립트(`gates.sh`)·기록 편집 사본(`rec/`)이 있다.
2. **워크트리** — `/home/roqkf/pr-search-wt/kind-relaxation`(브랜치 `fix/search-kind-relaxation`, 병합됨), `/home/roqkf/pr-search-wt/cr128-record`(이 기록, 브랜치 `docs/cr128-merge-record`), 수정 전 비교용 detached worktree `b90ef88c…/scratchpad/prefix`(`d2d894d`, main 저장소의 worktree 목록에 등록돼 있어 지우면 `git worktree prune`이 필요하다). 사용자가 모두 남기기로 했다.
3. **공개 저장소** — 사내 식별자는 시험·문서·커밋·PR에 싣지 않는다. 22차는 가상 저장소(`cr128/*`·`acme/*`·`other/secret`)와 가상 사용자만 썼다.
4. **실제 화면 확인** — e2e는 `/api/**`를 가짜로 채운다. 실제 화면은 메모리 `real-screen-check-recipe`의 조립(빌드된 `buildServer` + 격리 DB·ES + Redis 세션 + `next start` + Playwright 쿠키)으로 본다. 작업 공간의 Commit history 탭은 검색이 아니라 source 이력을 부른다.
5. 새 코드의 그림자 검사 셋, 저장소 전체를 재색인하는 통합 시험의 자료 정리 규칙, 사용자가 main에서 통째로 덮는 `agent-context/upstream-feedback.md`는 21차와 같다.

## Open boundary

- **사내 재검증 NOT RUN** — 외부 재현 성공은 사내 재검증이 아니다. 보고된 요청의 정규화된 `q`·권한 범위·correlation ID 대조와 사내 PIPE BFF의 503 변환 확인은 하지 않았다(사내 접속 없음). 3/74는 제공 표본의 관찰값이다.
- **CR-128의 남은 한계** — 작업 공간은 후보를 그리지 않는다(DEV-787). 공개 서버의 다른 처리되지 않은 오류는 여전히 Fastify 기본 본문이다(DEV-786). 구간 조회 `q`의 `kind:`는 여전히 500이다(DEV-788). 0건 검색은 최악의 경우 갈래 예산 1.5초·왕복 3초만큼 늦어질 수 있다. 볼 수 있는 저장소가 없는 사용자의 모순 `kind:` 질의는 200에서 503으로 바뀌었다(의도한 결정).
- **CR-124~CR-127의 남은 위험** — 21차 인계와 같다(원장 6.115~6.118장).

## References

- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 머리 절 「CR-128 / WP-109」, 6.119장, 5장 DEV-783~DEV-788.
- 변경 대장 `docs/00_governance/change_control.md`의 CR-128(서사·5장 cascade와 병합 판정).
- PIPE 인계 `handoff/pipe-search-integration/v1/CONTRACT_DIFF.md` D-23.
- `agent-context/upstream-feedback.md` 새 항목(사내에서 다시 조회할 것).
- 세션 노트 `agent-context/session-notes.md` 「22차」, todos 「22차 뒤 남은 것」.
