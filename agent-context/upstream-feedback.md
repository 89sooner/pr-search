# Upstream Feedback

## `git merge dev`로 인해 `source_commit_shas`가 dev 체인 커밋으로 오염된다 (설계 갭, 미해결)

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
