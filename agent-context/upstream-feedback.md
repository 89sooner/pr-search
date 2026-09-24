# Upstream Feedback

## `git merge dev`로 인해 `source_commit_shas`가 dev 체인 커밋으로 오염된다 (설계 갭, 미해결)

> **상류 반영 (`CR-117` / WP-102, FR-SRCH-002 AC-7·FR-SRCH-003 AC-5, `OD-016`, 2026-09-24) — 요청 1의 목적은 받아들였고, 거르는 자리만 「투영 전」에서 「연결을 읽는 자리」로 옮겼다. 요청 2는 채택하지 않았다.** 원인 분석이 맞다: GitHub은 PR의 기준점(base) 쪽에 없는 커밋을 PR 커밋으로 돌려주므로, 기준점이 옛 시점에 머문 PR의 피처 브랜치가 `git merge dev`를 하면 그 사이 dev에 오른 다른 PR의 머지 커밋이 목록에 섞인다. CR-116의 완전성 조건 넷은 그 목록이 원격의 전부라는 것만 증명하므로 이 연결을 **정상으로 확정**해 왔다. CR-116이 놓친 것이 아니라 「원본 커밋이 무엇인가」가 요구사항에 한 뜻으로 정해져 있지 않았다(용어집 정의가 두 문장으로 갈려 있었다). 제품 결정(`OD-016`)으로 **원본 커밋은 그 PR이 새로 가져온 커밋이고, 추적 브랜치(사내에서는 dev)의 현재 체인에 이미 오른 커밋은 그 커밋을 체인에 올린 PR에만 속한다.** 표현 두 가지를 바로잡는다: 정본(PostgreSQL) 자체가 오염된 것이 아니라, `pull_request_commit_link`의 `source` 행은 GitHub이 말한 목록 그대로인 **원시 관측**이고 틀린 것은 그것을 읽는 규칙이었다. 그리고 `merge_sequence`의 열 이름은 `merge_commit_sha`가 아니라 `commit_sha`다. **(요청 1) 받아들인 방식:** 원시 관측은 지우지 않고, 연결을 읽는 모든 자리(커밋별 관계 투영 JOB-REL-008, 재색인 복원과 전환 전 검증, 복구 명령의 대조, 미확정 계수)가 같은 SQL 술어 하나(`EFFECTIVE_LINK_SQL`)로 거른다. 투영 전에 목록에서 지우지 않은 이유는 체인이 움직이기 때문이다: 강제 푸시로 체인에서 빠진 커밋은 다시 그 PR의 원본 커밋이 되어야 하고, 원시 행이 남아 있어야 GHE를 다시 읽지 않고 재투영만으로 되살아난다. 체인 소속이 바뀌는 세 자리(채번·강제 푸시 재채번·복구 재채번)가 같은 트랜잭션에서 영향 커밋의 관계 재투영 의도를 남기므로, PR 목록이 채번보다 먼저 투영됐어도 연결은 저절로 다시 계산된다. PR 자신의 병합 근거(`merge`)는 이 규칙과 무관하게 남는다. **함께 고친 것:** (1) PR 투영과 재색인이 dev 체인 머지 커밋의 `role`을 `source_commit`으로 덮던 결함(DEV-755). 조건부 업서트가 더 늦은 PR 이벤트의 버전으로 체인이 정한 `merge_commit`을 대입했다. 이제 체인 커밋에는 원본 커밋 문서를 쓰지 않는다. (2) PR 상세의 `source_commits`도 같은 정의로 거르고, 뺀 수를 새 필드 `source_commits_excluded`로 싣는다. 커밋 화면의 연결 PR과 PR 화면의 원본 커밋이 같은 정본에서 나오며, 화면은 목록 아래에 「이미 대상 브랜치에 있던 커밋 N개는 목록에 없고 각각을 그 브랜치에 올린 PR 소속이다」를 보여 준다. **대가:** PR 화면의 원본 커밋 수가 GitHub Commits 탭과 달라진다(보고서 수치로는 #983이 207개에서 5개). PIPE 연동의 PR 상세 응답에도 같은 키가 더해졌다(`handoff/pipe-search-integration/v1/CONTRACT_DIFF.md` D-22). **(요청 2) 채택하지 않았다:** `compareCommits(base, head)`는 병합이 끝난 PR에서 범위가 비거나 뜻이 달라지고, PR마다 원격 호출이 늘며, 사내 프로파일(dev와 피처 브랜치뿐, squash-only)에서는 요청 1과 결과가 같다. **한계:** 체인 판정은 first-parent 체인만 본다. squash-only에서는 충분하지만, merge commit 방식 병합이 섞이면 두 번째 부모 쪽으로 dev에 들어온 커밋은 걸러지지 않는다. 207·202·85·46이라는 수치는 이 저장소에서 재현한 값이 아니다. **기존 오염 복구에는 `refetch`가 필요 없다** — 빼는 근거가 GHE가 아니라 PostgreSQL의 `merge_sequence`이기 때문이다. `./prsctl links plan`이 `그중 dev 체인 커밋에서 빠질 간선: N (커밋 M)`과 `역할이 source_commit으로 덮인 체인 커밋: N` 두 줄을 새로 찍고, 이 번호들은 관측이 미확정이어도 지운다. `./prsctl links apply`는 PR 연결 쓰기를 러너에 맡기되 덮인 역할만은 직접 되돌린다(`source_commit`일 때만 바꾸는 단방향 쓰기이고 반복 실행은 멱등이다). **`--pr`로 좁힌 실행은 역할 대조를 하지 않으므로 `--pr` 없이 한 번 돌린다.** **배포 주의:** 모든 워커가 새 빌드가 된 것을 확인한 뒤 `apply`를 돌린다. 구버전 워커는 체인 규칙 없이 관계를 비추고 역할을 다시 덮는다. 반입 뒤 할 일: `./prsctl upgrade` 뒤 저장소마다 `./prsctl links plan --repository <owner/name>`으로 두 줄의 건수를 보고, `./prsctl links apply --repository <owner/name>`와 `./prsctl links status`로 수렴을 확인한 다음, 화면에서 `ebc781d`의 Linked PRs에 #1671 하나만 남았는지와 PR #983 상세의 원본 커밋 목록 아래에 제외 안내가 나오는지 확인해 이 항목 아래에 적어 달라. **이 `apply`는 저장소마다 한 번 꼭 돌려야 한다** — 배포만으로는 이미 색인에 있는 번호가 바뀌지 않고, PR 상세의 제외 판정도 커밋 문서의 연결을 재료로 쓰므로 그전에는 두 화면이 모두 옛 값을 보인다. 추적 브랜치 목록을 바꾼 뒤에도 `apply`를 한 번 돌린다(DEV-756). 머지 순서·M 번호·에폭·원격 M 태그는 이 변경으로 바뀌지 않는다(M 번호 채번 경로를 건드리지 않았다). 아래 두 항목(prs-commits 재색인 verify, prs-links 재색인 shadow 부분 갱신)은 이 CR의 범위 밖이며 별도 CR로 다룬다. **이 저장소에는 아직 병합되지 않았다**(브랜치 `feature/cr117-source-commits`). 사내 배포 SHA는 NOT VERIFIED(반입 시 `./prsctl lineage`로 함께), 내부망 적용은 NOT RUN이다.

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
