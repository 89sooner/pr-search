# Current Handoff — 2026-09-27 PR Search 20차 (DEV-776·DEV-777·DEV-773 = CR-124·CR-125·CR-126 병합 · 사내 적용 NOT RUN · 새 Release 없음)

## Start here

- **main은 `7684bd3`다(PR #245 — CR-126). 이 인계를 고친 마감 기록 PR(브랜치 `docs/cr126-merge-record-s20`)이 병합됐으면 그 커밋이다.** 20차 지시(사용자, 2026-09-27)는 DEV-776 → DEV-777 → DEV-773을 항목마다 별도 CR·WP·PR로 구현·검증·리뷰·병합하는 것이었다. 실제 사내 적용과 새 Release 발행은 범위 밖이다.
  - **CR-124 / WP-105**(PR #243 → `81b147b`): 단일 호스트 compose의 `worker-link`·`worker-batch`에 `GHE_BASE_URL`(주소만 — App 자격은 넘기지 않는다)을 넘기고, URL 참조의 승인 호스트를 배포 설정에서만 읽는다(비면 URL 참조를 만들지 않는다). RUNBOOK 7.K. 지시서의 사내 주소는 사용자 결정으로 공개 저장소에 싣지 않았고, 구조가 같은 가상 호스트(`team.github.corp.example`)로 시험했다.
  - **CR-125 / WP-106**(PR #244 → `3dd6d8c`): 등록 요청 대기열(API-ADM-009)·감사 기록(API-ADM-005)의 커서가 PostgreSQL의 마이크로초 UTC 문자열을 그대로 싣는다(판 2). 판 1 커서는 `CURSOR_INVALID` + `detail.reason = cursor_version_outdated`로 거절하고, 화면이 첫 페이지 재조회를 안내한다.
  - **CR-126 / WP-107**(PR #245 → `7684bd3`): 업그레이드 직후 `import-stacks` 전이라도, 링크 워커의 이벤트 소비자가 스택 판정 직전에 그 PR 하나의 옛 스택 간선을 가져오기와 같은 규칙으로 정본에 옮긴다. JOB-REL-006 재파생과 재색인은 옮기지 않는다. SRS v2.47(`FR-REL-006` AC-6 한 문장, `OD-017`에 날짜 붙은 보완).
- **다음 할 일**: (1) 사내 적용(사용자, NOT RUN) — 20차 변경은 아직 번들로 만들지 않았다. 다음 배포본으로 올릴 때: RUNBOOK 7.K 2·3번으로 두 역할이 `GHE_BASE_URL`을 받는지 본다(사내 `compose.yml`을 통째로 덮지 않는다 — 사설 CA 마운트 같은 사내 수정이 사라진다). 기존 PR·커밋의 URL 참조는 prs-links 재색인(7.K 5번)으로 반영한다. 스택 이력 이전이나 커밋 재색인이 필요한 환경은 7.J 순서(스택 가져오기 → prs-commits 재색인 → prs-links 재색인 → `links apply`)를 그대로 따른다 — 그때의 prs-links 재색인이 URL 참조 반영을 겸한다. 업그레이드 전에 연 운영 창은 새로고침해야 새 커서 안내가 보인다(RUNBOOK 8장). (2) 후속 후보 — CR-126 전환기 보완을 끄는 조건, DEV-778(파생의 대상 조회가 직전에 색인된 대상을 못 봄), DEV-779(운영자 세션의 일시적 503, 원인 미확인), DEV-588(재발). 사용자 판단 전에는 착수하지 않는다.
- **병합 승인은 PR 번호가 정해진 뒤 그 PR에 대해 이번 세션에서 받는다.** 20차는 PR #243·#244·#245와 이 마감 기록 PR을 모두 CI 뒤 AskUserQuestion으로 승인받았다.

머리는 늘 실측한다: `git fetch && git log origin/main --oneline -5`, `gh pr list --state open`.

## Delivered (20차)

- **CR-124** — 격리 compose(`prs-s20`)에서 수정 전 판(pilot.19)의 URL 참조 0건을 재현하고, 수정 뒤 새 이벤트와 prs-links 재색인이 URL 참조를 만들어 전환 전 검증을 지나는 것을 확인했다. 사내 주소 문자열은 두 역할만 그 주소로 다시 만든 시험 전용 형상에서 확인했다(사내에 접속하지 않았다). 원장 6.115장.
- **CR-125** — 실제 PostgreSQL에서 두 목록의 누락을 재현했다(감사 기록은 첫 실행 재현). 격리 compose의 실제 관리자 화면(Chromium)에서 수정 전 58/60·118/120 → 수정 뒤 60/60·120/120을 봤고, 수정 전 판이 발급한 실제 판 1 커서로 옛 판 안내를 확인했다. 원장 6.116장.
- **CR-126** — 실제 pilot.18이 만든 옛 스택으로 수정 전(pilot.19)과 수정 뒤를 같은 스냅숏에서 비교했다. 수정 전에는 해제 0건, 수정 뒤에는 가져오기 없이 모두 해제되고 옛 근거·시각·문서 ID가 남았다. 워커를 멈춘 동안 보낸 이벤트도 재시작 뒤 처리됐다. 옮기지 않은 해제 이력은 여전히 재색인을 막았고, 가져오기 뒤에는 전환했다. 원장 6.117장.
- 세 항목 모두 전 계층 게이트, 변이(8·15·12종), 코드·문서 독립 리뷰, PR CI와 병합 커밋의 main CI(run 36281947573·36289156333·36311212601, 모두 첫 시도 success)를 거쳤다. **모두 `VERIFIED (external, isolated)`이며 사내 실데이터·실제 GHE·인증서·프록시는 NOT RUN이다.**

## Verify before changing code

1. **20차 격리 자원이 남아 있다(정리 여부는 사용자 결정)** — compose 프로젝트 `prs-s20`(마지막 상태: `s20-cr126` 이미지, stk1·stk2 세계), 가짜 GHE 컨테이너 `prs-s20-fakeghe`, 시험 인프라 `prs-s20-postgres`(55460)·`prs-s20-es`(59220, `cluster.name`에 isolated)·`prs-s20-redis`(56400), 로컬 이미지 `s20-cr124`·`s20-cr125`·`s20-cr126`. 도구·로그·스냅숏은 20차 첫 세션 scratchpad `fb6e416b…/scratchpad/`의 `r20/`(`run776.sh`·`run773.sh`·`run773-all.sh`·`s776.mjs`·`s773r.mjs`·`screen777.mjs`·`snap/vol-773-p18*`)이고, 게이트 `run-gates.sh`, 환경 `env-s20.sh`, 변이 `mut12x/`, 문서 검증 `docval.sh`도 거기 있다. `/tmp`라 재부팅에 휘발한다.
2. **워크트리** — `cr124-ghe-ref-host`·`cr125-admin-cursor`·`cr126-stack-reeval`·`s20-record`와 임시 `fb6e416b…/scratchpad/wt-777-prefix`(`62cbf3c` detached, 시험 파일 하나 미추적). 모두 병합됐다.
3. **공개 저장소** — 사내 식별자(사내 GHE 주소 등)는 시험·문서·커밋·PR에 싣지 않는다(2026-09-27 사용자 결정). push 전에 이력과 트리를 grep한다.
4. **새 코드의 그림자 검사 셋**(audit-grants, architecture 허용 목록, runtime-reachability)에 더해, 저장소 전체를 재색인하는 통합 시험(`links-reindex-completeness`)이 다른 시험이 남긴 자료를 센다 — 새 통합 시험은 끝날 때 자기 저장소를 치운다(CR-126에서 밟았다).
5. 사용자는 `agent-context/upstream-feedback.md`를 main에서 통째로 덮는다. diff로 판단한다.

## Open boundary

- **사내 적용(NOT RUN)** — 20차 변경을 담은 번들은 아직 없다. 사내 배포 SHA NOT VERIFIED.
- **CR-126의 남은 위험** — 전환기 보완을 끄는 조건이 없다(이전이 끝난 뒤에도 PR 이벤트마다 좁힌 조회가 는다). 재시도 예산(약 31초)을 넘는 서비스 인덱스 장애로 버려진 이벤트의 옛 스택은 가져오기 뒤 재색인까지 남는다(재색인이 막으므로 조용히 굳지 않는다). 저장소 전체의 과거 이력 이전은 여전히 `import-stacks`다.
- **CR-125의 남은 위험** — 업그레이드 전에 연 운영 창(옛 번들)은 옛 판 안내 대신 일반 오류를 보인다(새로고침으로 풀린다).
- **CR-124의 남은 위험** — 스킴은 비교하지 않는다(같은 호스트의 `http://` URL도 참조다). 기존 자료의 URL 참조는 prs-links 재색인 전까지 생기지 않는다.
- **DEV-778·DEV-779·DEV-588(open)** — 위 「다음 할 일」 (2).

## References

- 변경 대장 `docs/00_governance/change_control.md`의 CR-124·CR-125·CR-126(서사·5장 cascade와 병합 판정).
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.115·6.116·6.117장, 5장 DEV-773·DEV-776~DEV-779.
- 운영 절차 `deploy/single-host/RUNBOOK.md` 3장 「업그레이드」, 7장 표, 7.I·7.J·7.K, 8장.
- 세션 노트 `agent-context/session-notes.md` 「20차」, todos 「20차 뒤 남은 것」.
