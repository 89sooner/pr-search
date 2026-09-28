# Current Handoff — 2026-09-28 PR Search 21차 (CR-127 한국 시간 표시·KST 달력 날짜 검색 병합 · 사내 적용 NOT RUN · 새 Release 없음)

## Start here

- **main은 `2272f56`다(PR #247 — CR-127). 이 인계를 고친 마감 기록 PR(브랜치 `docs/cr127-merge-record-s21`)이 병합됐으면 그 커밋이다.** 21차 지시(사용자, 2026-09-27)는 화면 시간 표시와 날짜 검색을 KST 기준으로 통일하는 것이었다 — 원본은 UTC로 보관하고 사용자는 한국 시간으로 보고 검색한다. 실제 사내 적용과 새 Release 발행은 범위 밖이다.
  - **CR-127 / WP-108**(PR #247 → `2272f56`): 모든 화면의 시각을 `Asia/Seoul`로 명시해 `YYYY-MM-DD HH:mm KST`로 그리고 원본 UTC는 툴팁이다(`apps/web/lib/format.ts`·`TimeText`). 질의 문법에 `merged:`/`created:`의 `<날짜>..<날짜>@<IANA 시간대>`를 더해 `[시작일의 첫 순간, 종료일 다음 날의 첫 순간)`으로 조회한다(Elasticsearch `gte`/`lt`, 계산은 `packages/query/src/calendar.ts`). 작업 공간 Merged date는 날짜를 새로 고르면 `@Asia/Seoul`과 URL `tz`가 된다. 시간대 없는 옛 날짜 조건·URL·저장된 검색은 UTC 하루 그대로 실행하고 칩 `UTC`로 구분한다. 통계 시계열의 날짜 기간·기본 기간·드릴다운과 감사 기록 기간을 같은 기준으로 맞췄다(DEV-780~782). SRS v2.48(NFR-007 「시각 표시 기준」 행, 11장 12번, `FR-SRCH-005` AC-11, `FR-STAT-002` AC-7, `FR-AUTH-004` AC-9, `OD-018` open).
- **다음 할 일**: (1) 사내 적용(사용자, NOT RUN) — 21차 변경은 아직 번들로 만들지 않았다. 적용은 업그레이드만이다(마이그레이션·재색인 없음). 업그레이드하는 순간 모든 화면의 시각이 9시간 달라 보인다 — 값은 같고 툴팁이 원본 UTC다. 사용자에게 먼저 알린다. 옛 공유 URL·저장된 검색의 날짜 조건은 UTC 하루로 남는다(칩 `UTC`) — 한국 날짜로 바꾸려면 날짜를 다시 골라 저장한다. 통계의 기본 기간과 가장자리 날의 수가 달라진다(버킷과 같은 달력으로 맞춘 결과). 확인은 RUNBOOK 7장 CR-127 행과 8장 첫 세 행이다. 20차에서 넘어온 사내 적용 항목(RUNBOOK 7.K·7.J)은 그대로다. (2) 후속 후보(사용자 판단): DEV-778, DEV-779(이번 격리 검증에서 같은 모양을 한 번 더 관찰), DEV-588, CR-126 전환기 보완을 끄는 조건, `OD-018`(개인별 표시 시간대 — 권고는 열지 않음).
- **병합 승인은 PR 번호가 정해진 뒤 그 PR에 대해 이번 세션에서 받는다.** 21차는 PR #247과 이 마감 기록 PR을 CI 뒤 AskUserQuestion으로 승인받았다.

머리는 늘 실측한다: `git fetch && git log origin/main --oneline -5`, `gh pr list --state open`.

## Delivered (21차)

- **CR-127** — 수정 전 코드에서 불일치를 먼저 재현했다(새 통합 시험 31건 중 18건·감사 기간 시험 12건 중 4건 실패, 화면 함수는 같은 순간을 화면·브라우저마다 다른 날짜로 그렸다). 격리 compose(`prs-s21`, 시험 전용 가짜 GHE)에서 수정 전 판(`a1dbedb`)과 수정 뒤 판을 KST 자정 앞뒤로 머지한 PR 20건과 브라우저 시간대 셋(UTC·Asia/Seoul·America/Los_Angeles)으로 비교했다 — 결과 표·달력의 오늘·Merged date 요청·통계 버킷과 드릴다운·Commit history·감사 기록이 셋에서 같았고, 원본 시각·M 번호·시퀀스·ES 문서 값이 네 시점에서 같았다. 원장 6.118장.
- 전 계층 게이트(`b0ba276`, 단위·a11y는 시간대 셋), 변이 22종, 코드·문서 독립 리뷰(모두 병합 가능 — 문서 리뷰 [하] 둘은 `b0ba276`에서 반영), PR CI(run 36365536926)와 병합 커밋의 main CI(run 36366292588)가 모두 첫 시도에 success였다. **`VERIFIED (external, isolated)`이며 사내 실데이터·실제 GHE·인증서·프록시는 NOT RUN이다.**

## Verify before changing code

1. **21차 격리 자원이 남아 있다(정리 여부는 사용자 결정)** — compose 프로젝트 `prs-s21`(컨테이너 17개, **멈춤 — 지우지 않았다**, 마지막 상태는 `s21-kst` 이미지와 `acme/kst` 세계), 가짜 GHE `prs-s21-fakeghe`(멈춤), 시험 인프라 `prs-s21-postgres`(55470)·`prs-s21-es`(59230, `cluster.name` `prs-s21-isolated`)·`prs-s21-redis`(56410)는 실행 중이다. 로컬 이미지 `prs/{db,es,gh-executor,ingest-gateway,pipeline-worker,search-api,web}:s21-base`·`:s21-kst`. 격리 도구·로그는 21차 첫 세션 scratchpad `0cb4b81e…/scratchpad/`의 `r21/`(`run127.sh`의 `down`은 컨테이너와 볼륨을 **지운다**), 게이트·변이 재료·기록 편집 스크립트·검증기 결과는 이어가기 세션 scratchpad `cd1ac937…/scratchpad/`(`run-gates.sh`, `rec/`, `val/`)에 있다.
2. **워크트리** — `kst-time`(브랜치 `feature/kst-time`, 병합됨)·`s21-record`(이 기록)와 임시 `0cb4b81e…/scratchpad/wt-mut`(detached `b0ba276`, 변경 없음). 20차 자원(컨테이너·이미지·워크트리)은 이미 정리돼 있었다(2026-09-28 확인).
3. **공개 저장소** — 사내 식별자는 시험·문서·커밋·PR에 싣지 않는다. push 전에 이력·트리·PR 본문을 grep한다(20차 치환표 `fb6e416b…/scratchpad/hostmap.py`의 토큰으로 세고, 값은 출력하지 않는다).
4. **시간대가 걸린 시험은 세 시간대에서 돌린다** — 개발 셸 기본이 `Asia/Seoul`이라 `TZ=UTC`·`TZ=America/Los_Angeles`를 따로 준다(게이트 스크립트가 단위·a11y를 셋 다 돈다). UTC에서만 살아남는 변이가 있었다(M22).
5. 새 코드의 그림자 검사 셋(audit-grants, architecture 허용 목록, runtime-reachability)과 저장소 전체를 재색인하는 통합 시험의 자료 정리 규칙, 사용자가 main에서 통째로 덮는 `agent-context/upstream-feedback.md`는 20차와 같다.

## Open boundary

- **사내 적용(NOT RUN)** — 20차·21차 변경을 담은 번들은 아직 없다. 사내 배포 SHA NOT VERIFIED.
- **CR-127의 남은 한계** — 감사 기록의 기간 입력은 브라우저 기본 `datetime-local`이라 그 달력이 강조하는 「오늘」은 브라우저 시간대다(보내는 값은 `+09:00`이라 요청은 같다). Regression 합성 데모의 날짜 필터도 기본 입력이다. W-004 범위 조사의 시각 앵커는 순간(ISO-8601)이며 달력 규칙 밖이다. 시간 버킷 드릴다운은 옛 순간 범위다. 통계 시각형 기간에 날짜만 적은 끝이 섞이면 그 끝의 버킷 채움은 옛 경로 그대로다. 개인별 표시 시간대는 없다(`OD-018`). PIPE 포팅 인계의 PD-004(UTC 고정)는 PIPE 쪽이 판단한다.
- **CR-124~CR-126의 남은 위험** — 20차 인계와 같다(원장 6.115~6.117장).
- **DEV-778·DEV-779·DEV-588(open)** — 위 「다음 할 일」 (2).

## References

- 변경 대장 `docs/00_governance/change_control.md`의 CR-127(서사·5장 cascade와 병합 판정).
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.118장, 5장 DEV-779~DEV-782.
- 운영 절차 `deploy/single-host/RUNBOOK.md` 3장 「업그레이드」, 7장 CR-127 행, 8장 첫 세 행.
- 세션 노트 `agent-context/session-notes.md` 「21차」, todos 「21차 뒤 남은 것」.
