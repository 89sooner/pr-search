# Upstream Feedback

## `kind:`와 다른 필터를 함께 쓴 검색이 500/503으로 실패한다 (구현 결함, 상류 수정 — main `d602890`)

> **원문 없음.** 이 보고의 사내 원문은 이 저장소의 `agent-context/upstream-feedback.md`에 들어온 적이 없다(main `d2d894d` 기준). 아래 「보고 요지」는 22차 사용자 지시서(2026-09-28)가 전한 내용이며 원문이 아니다 — 사내 사본을 반입하면 원문을 이 자리에 두고 이 요지는 지운다.

> **상류 반영 (`CR-128` / WP-109, FR-SRCH-006 AC-3·예외/실패 처리, 2026-09-28) — 원인을 정정했고, 오류를 숨기거나 조건을 지우지 않고 추천 계산 자체를 고쳤다.** **(원인 정정)** `resolveSearchTarget`은 `kind:`를 올바르게 걷어 냈다. 실패는 모두 **본 조회가 0건을 센 뒤** 났다 — 0건이면 조건 변경 추천(완화 후보, `relaxation_hints`)을 세는데, `runSearch`가 그 계산에 `kind:`를 걷어 내지 않은 원래 AST와 PR(또는 커밋)로 좁힌 대상을 넘겼고, 후보마다 남은 `kind:` 때문에 질의 조립의 가드(`KindFilterNotAppliedError`)가 던졌다. 그래서 **`kind:` + 다른 필터 하나 이상 + 결과 0건이면 경로 조건과 무관하게 실패했다** — `path:` 없는 `kind:pull_request author:<없는 사용자>`도, `kind:commit`·부정 `-kind:commit`도 같고, 결과가 있으면 `path:`가 있어도 성공한다. 「path 조합에만」·「일반 검색에는 영향 없음」은 재현과 다르다: 공개 검색·PIPE 연동·운영 기본 화면(Repository workspace)이 같은 실행 함수를 쓰고, **작업 공간은 모든 검색에 `kind:`와 `repo:`를 붙이므로 그 화면에서 결과가 0건인 검색은 모두 「Unable to load search results.」였을 것이다** — 경로 트리 선택이 0건을 만들기 쉬워 path 조합으로 보였을 것으로 본다. 일반 경로는 500(Fastify 기본 본문, `message`에 가드 문구, `correlation_id` 없음)이고 PIPE 경로는 500 `INTERNAL_ERROR`다. **PIPE의 503은 pr-search가 낸 500을 BFF가 인계 문서의 오류 표대로 503 `SEARCH_AUTH_UNAVAILABLE`로 옮긴 것으로 보인다** — 사내 BFF는 확인하지 않았다(NOT RUN). 3/74는 제공 표본의 관찰값이다. **(처리)** 후보마다 그 필터를 뺀 질의를 본 조회와 같은 순서로 다시 해석해 센다 — `kind:`를 요청 경로의 원래 대상(PR·커밋)에서 다시 적용하고(`kind:pull_request`를 빼는 후보는 그 조건의 커밋도 센다), 강제 접근 범위와 시퀀스·M 번호 에폭을 그대로 결합하며, 남은 유형이 없는 후보는 조회하지 않고 0건으로 본다. 모순된 `kind:`의 0건도 후보를 센다(전에는 계산하지 않은 `[]`). 추천 계산의 실패는 본 조회의 200을 바꾸지 않고 응답에 `relaxation_hints_incomplete: true`, 서버 로그에 `search.relaxation_incomplete`(단계·오류 이름·correlation ID)로 남는다. 레거시 검색 화면은 후보 건수를 읽지 못하던 것(DEV-784)도 고쳤다. `KindFilterNotAppliedError` 가드와 `path:`의 경로 접두 의미, 후보 상한 8개와 msearch 한 번은 그대로다. **(외부 확인, 사내 재검증이 아니다)** 격리 PostgreSQL·Elasticsearch·실제 search-api와 127.0.0.1의 mTLS PIPE 리스너, 가상 저장소로 수정 전 판에서 실패를 재현하고 수정 뒤 판에서 200·정확한 후보를 확인했다 — 후보마다 그 필터를 빼고 다시 검색한 건수가 추천 건수와 같다. 원장 6.119장. **(사내에 새 빌드를 적용한 뒤 다시 조회할 것)** (1) 보고된 요청의 정규화된 `q`를 같은 사용자·같은 경로(일반 `/api/v1/search`·PIPE `/read/search`)로 다시 보내 200·`total`·`relaxation_hints`를 본다. (2) 작업 공간에서 경로 트리·작성자·상태로 0건이 되는 조건을 골라 「No matching changes」가 나오는지 본다. (3) search-api 로그에 `search.relaxation_incomplete`가 있으면 그 `correlation_id`의 요청과 단계를 적는다. (4) PIPE BFF가 200 0건을 그대로 전달하는지 본다 — 전에 503을 재시도·빈 결과로 대신하던 처리가 있으면 걷어 낸다. 결과를 이 항목 아래에 적어 달라. **이 저장소에는 main `d602890`으로 병합됐다**(2026-09-29, PR #251 — PR CI run 36426166182와 main CI run 36456023880 모두 success) — 사내 반입은 별도다. 사내 적용은 NOT RUN이고 새 Release는 발행하지 않았다.

발견: 0.1.0-pilot.20 사내 운영 (지시서 전언, 2026-09-28)
관련: FR-SRCH-006 AC-3 / `apps/search-api/src/search/service.ts` / `apps/search-api/src/search/relaxation.ts` / DEV-783·DEV-784·DEV-785

### 보고 요지 (지시서 전언 — 원문 아님)

- 현상: `kind:`와 다른 필터를 함께 쓴 검색이 500/503으로 실패한다. 제공 표본 74건 중 3건.
- 보고의 추정 원인: path가 있으면 `resolveSearchTarget`이 `kind`를 제거하지 못한다.
- 보고의 영향 범위: path 조합에만 발생하고, 일반 검색에는 영향이 없다.
- 응답: 500/503. 지시서는 PIPE 연동의 503을 따로 언급한다.

---

## `git merge dev`로 인해 `source_commit_shas`가 dev 체인 커밋으로 오염된다 (설계 갭, 미해결)

> **상류 반영 (`CR-117` / WP-102, FR-SRCH-002 AC-7·FR-SRCH-003 AC-5, `OD-016`, 2026-09-24) — 요청 1의 목적은 받아들였고, 거르는 자리만 「투영 전」에서 「연결을 읽는 자리」로 옮겼다. 요청 2는 채택하지 않았다.** 원인 분석이 맞다: GitHub은 PR의 기준점(base) 쪽에 없는 커밋을 PR 커밋으로 돌려주므로, 기준점이 옛 시점에 머문 PR의 피처 브랜치가 `git merge dev`를 하면 그 사이 dev에 오른 다른 PR의 머지 커밋이 목록에 섞인다. CR-116의 완전성 조건 넷은 그 목록이 원격의 전부라는 것만 증명하므로 이 연결을 **정상으로 확정**해 왔다. CR-116이 놓친 것이 아니라 「원본 커밋이 무엇인가」가 요구사항에 한 뜻으로 정해져 있지 않았다(용어집 정의가 두 문장으로 갈려 있었다). 제품 결정(`OD-016`)으로 **원본 커밋은 그 PR이 새로 가져온 커밋이고, 추적 브랜치(사내에서는 dev)의 현재 체인에 이미 오른 커밋은 그 커밋을 체인에 올린 PR에만 속한다.** 표현 두 가지를 바로잡는다: 정본(PostgreSQL) 자체가 오염된 것이 아니라, `pull_request_commit_link`의 `source` 행은 GitHub이 말한 목록 그대로인 **원시 관측**이고 틀린 것은 그것을 읽는 규칙이었다. 그리고 `merge_sequence`의 열 이름은 `merge_commit_sha`가 아니라 `commit_sha`다. **(요청 1) 받아들인 방식:** 원시 관측은 지우지 않고, 연결을 읽는 모든 자리(커밋별 관계 투영 JOB-REL-008, 재색인 복원과 전환 전 검증, 복구 명령의 대조, 미확정 계수)가 같은 SQL 술어 하나(`EFFECTIVE_LINK_SQL`)로 거른다. 투영 전에 목록에서 지우지 않은 이유는 체인이 움직이기 때문이다: 강제 푸시로 체인에서 빠진 커밋은 다시 그 PR의 원본 커밋이 되어야 하고, 원시 행이 남아 있어야 GHE를 다시 읽지 않고 재투영만으로 되살아난다. 체인 소속이 바뀌는 세 자리(채번·강제 푸시 재채번·복구 재채번)가 같은 트랜잭션에서 영향 커밋의 관계 재투영 의도를 남기므로, PR 목록이 채번보다 먼저 투영됐어도 연결은 저절로 다시 계산된다. PR 자신의 병합 근거(`merge`)는 이 규칙과 무관하게 남는다. **함께 고친 것:** (1) PR 투영과 재색인이 dev 체인 머지 커밋의 `role`을 `source_commit`으로 덮던 결함(DEV-755). 조건부 업서트가 더 늦은 PR 이벤트의 버전으로 체인이 정한 `merge_commit`을 대입했다. 이제 체인 커밋에는 원본 커밋 문서를 쓰지 않는다. (2) PR 상세의 `source_commits`도 같은 정의로 거르고, 뺀 수를 새 필드 `source_commits_excluded`로 싣는다. 커밋 화면의 연결 PR과 PR 화면의 원본 커밋이 같은 정본에서 나오며, 화면은 목록 아래에 「이미 대상 브랜치에 있던 커밋 N개는 목록에 없고 각각을 그 브랜치에 올린 PR 소속이다」를 보여 준다. **대가:** PR 화면의 원본 커밋 수가 GitHub Commits 탭과 달라진다(보고서 수치로는 #983이 207개에서 5개). PIPE 연동의 PR 상세 응답에도 같은 키가 더해졌다(`handoff/pipe-search-integration/v1/CONTRACT_DIFF.md` D-22). **(요청 2) 채택하지 않았다:** `compareCommits(base, head)`는 병합이 끝난 PR에서 범위가 비거나 뜻이 달라지고, PR마다 원격 호출이 늘며, 사내 프로파일(dev와 피처 브랜치뿐, squash-only)에서는 요청 1과 결과가 같다. **한계:** 체인 판정은 first-parent 체인만 본다. squash-only에서는 충분하지만, merge commit 방식 병합이 섞이면 두 번째 부모 쪽으로 dev에 들어온 커밋은 걸러지지 않는다. 207·202·85·46이라는 수치는 이 저장소에서 재현한 값이 아니다. **기존 오염 복구에는 `refetch`가 필요 없다** — 빼는 근거가 GHE가 아니라 PostgreSQL의 `merge_sequence`이기 때문이다. `./prsctl links plan`이 `그중 dev 체인 커밋에서 빠질 간선: N (커밋 M)`과 `역할이 source_commit으로 덮인 체인 커밋: N` 두 줄을 새로 찍고, 이 번호들은 관측이 미확정이어도 지운다. `./prsctl links apply`는 PR 연결 쓰기를 러너에 맡기되 덮인 역할만은 직접 되돌린다(`source_commit`일 때만 바꾸는 단방향 쓰기이고 반복 실행은 멱등이다). **`--pr`로 좁힌 실행은 역할 대조를 하지 않으므로 `--pr` 없이 한 번 돌린다.** **배포 주의:** 모든 워커가 새 빌드가 된 것을 확인한 뒤 `apply`를 돌린다. 구버전 워커는 체인 규칙 없이 관계를 비추고 역할을 다시 덮는다. 반입 뒤 할 일: `./prsctl upgrade` 뒤 저장소마다 `./prsctl links plan --repository <owner/name>`으로 두 줄의 건수를 보고, `./prsctl links apply --repository <owner/name>`와 `./prsctl links status`로 수렴을 확인한 다음, 화면에서 `ebc781d`의 Linked PRs에 #1671 하나만 남았는지와 PR #983 상세의 원본 커밋 목록 아래에 제외 안내가 나오는지 확인해 이 항목 아래에 적어 달라. **이 `apply`는 저장소마다 한 번 꼭 돌려야 한다** — 배포만으로는 이미 색인에 있는 번호가 바뀌지 않고, PR 상세의 제외 판정도 커밋 문서의 연결을 재료로 쓰므로 그전에는 두 화면이 모두 옛 값을 보인다. 추적 브랜치 목록을 바꾼 뒤에도 `apply`를 한 번 돌린다(DEV-756). 머지 순서·M 번호·에폭·원격 M 태그는 이 변경으로 바뀌지 않는다(M 번호 채번 경로를 건드리지 않았다). 아래 두 항목(prs-commits 재색인 verify, prs-links 재색인 shadow 부분 갱신)은 이 CR의 범위 밖이며 별도 CR로 다룬다. **이 저장소에는 main `65acf83`으로 병합됐다**(2026-09-24, PR #230) — 사내 반입은 별도다. 사내 배포 SHA는 NOT VERIFIED(반입 시 `./prsctl lineage`로 함께), 내부망 적용은 NOT RUN이다.

발견: 0.1.0-pilot.18 사내 운영 (2026-09-23)
관련: FR-SRCH-002 / `apps/pipeline-worker/src/enrich.ts:276` / `apps/pipeline-worker/src/documents.ts:400` / CR-116

### 현상

commit `ebc781d` (merge_seq=1183, PR #1671 머지)의 commit history 페이지에 PR #983과 #1855가 함께 표시된다. PR #1671만 머지한 커밋인데, #983과 #1855는 `git merge dev`를 feature 브랜치로 가져간 PR들이다.

### 근본 원인: `git merge dev`가 `source_commit_shas`에 dev 체인 커밋을 통째로 넣는다

1. PR #983은 feature 브랜치에서 `git merge dev`를 수행 → dev first-parent 체인의 머지 커밋 202개가 feature 브랜치에 포함됨
2. GHE API `GET /pulls/983/commits`가 207개 커밋 전체를 반환 (202개는 dev 체인 커밋, `ebc781d` 포함)
3. 파이프라인이 `source_commit_shas` 207개에 대해 PR #983을 commit 문서에 기록
4. `ebc781d`에 `[983, 1671, 1855]`이 들어감 — #983과 #1855는 `git merge dev`로 인한 가짜 연결

| PR    | `source_commit_shas` 수 | dev chain 커밋 수 | 비율           |
| ----- | ----------------------: | ----------------: | -------------- |
| #983  |                     207 |               202 | 98% — dev 체인 |
| #1855 |                      85 |                46 | 54% — dev 체인 |

### CR-116으로 해결되지 않는 이유

CR-116은 `source_commit_shas`에서 빠진 커밋의 PR 번호를 제거하는 것이지만, 이 문제는 다르다:

- `ebc781d`가 PR #983의 `source_commit_shas`에 실제로 존재함 (GHE API가 반환함)
- DB `source_commit_shas` 자체가 dev 체인 커밋을 포함하고 있어 정리 스크립트도 "stale"로 판정하지 못함
- 정본(PostgreSQL) 자체가 오염되어 있음

### 요청

1. 투영 전 필터링 — `source_commit_shas` 중 dev first-parent 체인에 있는 커밋(`merge_sequence` 테이블에 존재하는 `merge_commit_sha`)은 PR origin commit이 아니므로 `pull_request_numbers`에 추가하지 않는다. `git merge dev`로 유입된 커밋은 merge commit으로서 자신의 PR 번호만 가져야 한다.

2. 또는 GHE API `GET /pulls/{n}/commits` 대신 base...head 범위 계산 — `git merge dev`로 feature 브랜치에 가져온 dev 체인 커밋을 제외하고 PR 고유 커밋만 추출한다. `compareCommits(base, head)`로 범위를 계산하면 dev 체인 커밋이 제외될 수 있다.

---

## prs-commits 재색인 verify가 false positive다 (설계 갭, 미해결)

> **상류 반영 (`CR-119` / WP-103, FR-ING-008 AC-10, 2026-09-25) — 원인 분석을 정정했고 두 요청은 그대로 받지 않았다. 대신 기대 집합과 메타데이터 복원을 함께 고쳤다.** 집계는 Set이라 「중복 집계」가 아니었고, 문제 커밋은 「직접 push」가 아니라 체인 밖 커밋이다(직접 push는 체인 커밋이라 문서를 만든다). 「ES `_count`와 비교」는 이미 하고 있었다 — 틀린 것은 기대 건수였다. 재구축이 `commit_snapshot`의 모든 행을 쓰기 결과와 무관하게 기대 문서로 셌고, 체인 밖이면서 어느 PR 스냅숏에도 없는 커밋(rebase로 PR에서 빠진 옛 커밋)은 문서를 만들 근거가 없어 새 인덱스에 영영 생기지 않았다. **더 큰 문제가 그 뒤에 숨어 있었다**: 같은 스캔이 원본 커밋의 메타데이터를 문서 생성보다 먼저 보내, 재구축한 인덱스의 `role: source_commit` 문서는 메시지·작성자·변경 경로 없이 섰다(검증이 건수만 봐서 드러나지 않았다). 요청 1(「`createWith` 없는 커밋을 집계에서 제외」)은 원본 커밋 문서까지 기대에서 빼 그 누락을 숨기므로 받지 않았고, 요청 2(「`_count`와 비교」)는 이미 하고 있다. 이제 재구축은 문서를 만든 뒤 메타데이터를 채우고, 관측이 불완전해 남은 PR 연결의 커밋도 복원하며(그 연결이 있으면 전에는 관계 replay가 재색인을 막았다), 전환 전 검증은 정본과 생성 정책에서 계산한 필수 문서 ID의 존재와 메타데이터 값을 대조하고, 준비 단계의 대상 인덱스 UUID가 전환 시점과 같은지도 본다. **main `e94cb4f`에 병합됐다**(PR #235, 2026-09-25 — PR CI run 36054225382와 main CI run 36055350099 모두 success). **사내 수동 v4 전환은 검증하지 않았다(NOT VERIFIED)**: 잡이 실패한 순간부터 v4 이중 쓰기가 멈췄으므로 실패~수동 전환 사이의 쓰기가 v4에 없을 수 있고, v4의 원본 커밋 문서에는 메시지·작성자가 비어 있을 가능성이 높다. 반입 뒤 RUNBOOK 7.H의 순서(형상·별칭·UUID·잡 기록 확인 → 원본 커밋 표본 대조 → 새 빌드에서 prs-commits 재색인 → 새 검색으로 확인, 옛 인덱스는 확인 뒤 정리)를 밟고 결과를 이 항목 아래에 적어 달라. 사내 적용은 NOT RUN이다.

발견: 0.1.0-pilot.18 사내 운영 (2026-09-23)
관련: `apps/pipeline-worker/src/reindex.ts:694`

### 현상

prs-commits v3→v4 재색인 후 `verifyBeforeCutover`가 실패한다. 실제 문서 수는 일치하지만 verify 로직이 과대 계산한다.

### 근본 원인: `tally.documentIds`가 `createWith` 없는 커밋까지 중복 집계

`reindex.ts`의 `tally.documentIds`가 모든 커밋 문서 ID를 수집하지만, `createWith`가 없는 커밋(직접 push)은 `scripted_upsert: false`로 동작하여 이미 존재하는 문서를 덮어쓴다. verify는 이 중복을 걸러내지 못해 예상 건수가 실제보다 크다.

### 영향

서비스 영향은 없음 — 수동으로 cutover 완료. 다만 재색인 자동화가 verify 실패로 중단됨.

### 요청

`tally.documentIds`에서 `createWith`가 없는 커밋(이미 ES에 존재하는 문서)은 ID 집계에서 제외하거나, verify 기준을 `documentIds.size`가 아닌 실제 ES `_count`와 비교하도록 변경.

---

## prs-links 재색인 shadow_write_failed (설계 갭, 미해결)

> **상류 반영 (`CR-121` / WP-104, FR-ING-008 AC-11 · FR-REL-006 AC-6, OD-017, 2026-09-25) — 원인 분석을 정정했고 두 요청은 받지 않았다. 대신 부분 갱신의 경합을 회수할 수 있는 미처리로 다루고, 그 뒤에 숨은 해제 스택 이력의 손실을 함께 고쳤다.** 실패한 연산은 upsert가 아니라 **기존 간선의 부분 갱신**(참조의 해결 상태, 스택의 해제 표식)이다. 재구축이 source를 차례로 다시 파생하는 동안 한 source를 처리하면 그 source를 대상으로 삼는 다른 source의 간선을 해결 상태로 고치는데, 그 간선의 소유 source가 아직 재구축되지 않았으면 새 인덱스에 문서가 없다. 요청 1(「`document_missing_exception` 무시」)은 간선이 빠진 새 인덱스를 전환하게 하고, 요청 2(「`scripted_upsert: true`로 생성」)는 근거·접근 범위 필드 없는 간선을 만들기 때문에 받지 않았다. 이제 그 경우만(실행 중인 재색인의 바로 그 대상, 부분 갱신, 문서 없음, 요청한 간선 ID와 소유 저장소 routing 일치) 잡에 영속 기록하는 미처리로 남기고, 전환 전에 소유 source를 PostgreSQL에서 다시 파생해 회수한다. 그 밖의 새 인덱스 쓰기 오류는 그대로 실패다. 전환 전 검증은 재구축과 같은 계획으로 기대 간선을 계산해 간선마다 대조한다(전에는 prs-links의 기대가 없어 간선을 보지 않았다). **더 큰 문제가 그 뒤에 숨어 있었다**: 해제된 스택 간선은 색인에만 있어서, 재색인이 성공하면 새 인덱스에서 조용히 사라졌다. 사용자 결정(OD-017)으로 스택의 성립·해제를 PostgreSQL `pull_request_stack`에 남기고 간선은 그 기록에서 만든다. **main `df3d8ef`에 병합됐다**(PR #237, 2026-09-25 — PR CI run 36085206961와 main CI run 36100117388 모두 success). 반입 뒤에는 RUNBOOK 7.I의 순서(형상 확인 → 저장소마다 `./prsctl links import-stacks`, 먼저 `--dry-run` → 새 빌드에서 prs-links 재색인 → 새 검색으로 확인, 옛 인덱스는 확인 뒤 정리)를 밟고 결과를 이 항목 아래에 적어 달라. 가져오기 없이 재색인하면 전환 전 검증이 막는다. 사내 적용은 NOT RUN이다.

> **상류 반영 보완 (`CR-126` / WP-107, FR-REL-006 AC-6, `OD-017` 보완, 2026-09-27)** — CR-121이 남긴 공백(DEV-773: 배포와 `prsctl links import-stacks` 사이에는 정본만 보는 파생이 배포 전 스택을 해제하지 못했다)을 닫았다. 링크 워커의 이벤트 소비자가 스택 판정 직전에 그 PR 하나의 옛 간선을 가져오기와 같은 규칙으로 옮긴다. 가져오기(RUNBOOK 7.I 3번)와 반입 순서(7.J)는 그대로다 — 이벤트를 받지 않은 관계, 특히 배포 전에 이미 해제된 이력은 여전히 가져오기가 옮기고, 옮기지 않으면 prs-links 재색인이 전환하지 않는다. 사내 적용 NOT RUN.

발견: 0.1.0-pilot.18 사내 운영 (2026-09-23)
관련: `packages/es/src/links.ts` / `apps/pipeline-worker/src/reindex.ts`

### 현상

prs-links v1→재색인 시 shadow index 쓰기에서 `document_missing_exception` 발생. v1이 계속 서비스 중이므로 서비스 영향은 없음.

### 근본 원인

shadow write가 대상 문서가 없는 상태에서 upsert를 시도. `document_missing_exception`은 `scripted_upsert: false`일 때 문서가 없으면 발생. links 인덱스는 문서가 존재하지 않을 수 있는데 upsert script가 존재를 가정.

### 영향

서비스 영향 없음 — v1이 서비스 중. 재색인 자동화만 실패.

### 요청

shadow write 시 `document_missing_exception`을 무시하거나, links 인덱스에 `scripted_upsert: true`를 적용하여 문서가 없을 때 생성하도록 변경.
