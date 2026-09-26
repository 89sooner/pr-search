# Current Handoff — 2026-09-26 PR Search 19차 (0.1.0-pilot.19 발행 · 격리 업그레이드 검증 완료 · 사내 적용 NOT RUN)

## Start here

- **main은 `85af93a`다(PR #241 — CR-122·CR-123 병합 기록과 배포본 준비 기록). 이 인계를 고친 발행 기록 PR(브랜치 `docs/pilot19-release-record`)이 병합됐으면 그 커밋이다.** 19차 지시(사용자, 2026-09-26)는 최신 main으로 새 오프라인 배포본을 준비하고, 사내·공용 서버 대신 격리 환경에 이전 버전(`0.1.0-pilot.18`) 상태를 만들어 업그레이드와 자료 복구를 확인하는 것이었다. **처음 지시는 GitHub Release 발행과 사내 적용을 범위 밖에 두었고, 그 뒤 사용자 지시(2026-09-26 「19 릴리즈도 발행해」)로 Release를 발행했다. 사내 적용은 하지 않았다.**
  - **CR-122 / CR-123**(PR #240 → `646486e`): 리허설이 찾은 차단 둘. `prsctl links apply|refetch|import-stacks`가 번들에서 늘 `--actor가 필요하다`로 거절되던 CLI 배선(DEV-774), 해결 갱신이 색인되지 않은 대상에 정확한 참조를 붙여 prs-links 전환이 막히던 판정 불일치(DEV-775). RUNBOOK은 prs-links 재색인을 prs-commits 재색인 뒤로 옮기고 반입 순서를 **7.J**에 모았다.
  - **기록 PR #241**(main `85af93a`)이 이 인계와 원장 6.114장(최종 번들·R3)을 실었다. 발행 기록은 원장 머리 절 「0.1.0-pilot.19 발행」이다.
- **발행한 Release**: `0.1.0-pilot.19` — https://github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.19 (2026-09-26 22:51 KST), 태그 → `85af93a`, immutable. 자산 `pr-search-0.1.0-pilot.19-offline.tar.gz` 1,166,873,222바이트, **사내에 별도 채널로 전달할 SHA-256 `cf0e0e54837c860166ec85cf5a30f87f98893be810de37910362524492e3d00e`**. 이미지 7종 ID가 R3에서 검증한 최종 번들(`646486e`, 아카이브 `68520f73…`)과 같다 — `85af93a`는 문서만 달라 빌드 컨텍스트가 같다. 아카이브 SHA-256이 후보와 다른 것은 번들을 다시 묶었기 때문이다(6.114장). 검증에 쓴 후보 번들 파일은 워크트리와 함께 지웠다.
- **다음 할 일**: (1) 사내 적용(사용자) — RUNBOOK 7.J 순서(업그레이드 전 잡 확인·백업 → 업그레이드 → 저장소 전부(보관 포함) `links import-stacks` dry-run → 실행 → prs-commits 재색인 → prs-links 재색인 → 저장소마다 `links plan`·`apply`·`status` → 화면 확인). 문제가 생기면 사용자가 `agent-context/upstream-feedback.md`로 보고한다. (2) 후속 CR 후보 DEV-776·DEV-777·DEV-773 — 사용자 판단(2026-09-26): 셋 다 데이터 손실이나 설치 실패가 아니라 지금은 진행하지 않는다.
- **병합 승인은 PR 번호가 정해진 뒤 그 PR에 대해 이번 세션에서 받는다.** 19차는 PR #240·#241 모두 CI 뒤 AskUserQuestion으로 승인받았다.

머리는 늘 실측한다: `git fetch && git log origin/main --oneline -5`, `gh pr list --state open`.

## Delivered (19차)

- **격리 업그레이드 리허설** — compose 프로젝트 `prs-upg`에 pilot.18(Release 자산과 digest 같은 로컬 아카이브 `f8a29f96…`)을 세우고, 시험 전용 가짜 GHE로 사내 보고 상태(두 재색인 실패, prs-commits 수동 전환, `git merge dev` 오염, 해제 스택, 보관 저장소, 강제 푸시로 빠진 커밋과 그 전체 SHA 참조)를 재현한 뒤 새 번들로 올렸다. R1(첫 후보 `7179794`, 탐색) → 차단 둘 발견 → 수정 → R2(수정 후보 `0.1.0-pilot.19-rc2`) → R3(최종 번들). **R2·R3 모두 `VERIFIED (external, isolated)`** — 과거 간선·정상 PR 번호·원본 커밋 메시지와 작성자·M 번호 정렬과 범위 검색 유지, 잘못 붙은 PR 번호 제거, 두 재색인 검증 통과·자동 전환. 원장 6.113(R1·R2·R2b)·6.114(최종 번들·R3).
- 검증 단계 시간은 **격리 환경 측정값**(PR 20·커밋 문서 42·간선 35)이다 — 사내 실측이 아니다.
- **Release 발행**(사용자 지시 「19 릴리즈도 발행해」) — main `85af93a`에서 전용 워크트리로 `build-bundle.sh --release`(분리 세션). 발행 전에 같은 워크트리의 앱 이미지 7종이 R3 검증값과 같음을 확인했고, 발행 뒤 GitHub digest·태그·manifest·`prsctl verify`·`gh release download`로 다시 대조했다(원장 머리 절 「0.1.0-pilot.19 발행」).

## Verify before changing code

1. **격리 리허설 자원은 지웠다(사용자 결정, 2026-09-26)** — compose 프로젝트 `prs-upg`의 컨테이너·볼륨·네트워크, 가짜 GHE 컨테이너 `prs-upg-fakeghe`, 이전 세션 scratchpad의 도구·스냅숏·시험 비밀값(`rehearsal/`), 19차 워크트리 다섯(`release19`·`release19rc2`·`release19final`·`upgrade-blockers`·`pilot19-record`)과 발행 워크트리 `release19pub`. 다음 배포본을 같은 방식으로 검증하려면 원장 6.113장(격리 환경·가짜 GHE·이전 버전 상태의 구성)을 따라 도구를 다시 만든다.
2. **시험 인프라** — `prs-s18-postgres`(55450)·`prs-s18-es`(59215, `cluster.name=prs-s18-isolated`)·`prs-s18-redis`(56394), 환경 파일은 18차 첫 세션 scratchpad의 `env-s18.sh`(Node 22). 19차는 DB `prs_test_s19_*`를 새로 만들어 썼다. 게이트 스크립트는 이 세션 scratchpad의 `run-gates.sh <worktree> <label>`.
3. **새 표·새 ES 조회·코드 경로 변경은 그림자 검사 셋**(audit-grants, architecture 허용 목록 — 이제 `exists`도 본다, runtime-reachability)에 걸린다.
4. 사용자는 `agent-context/upstream-feedback.md`를 main에서 통째로 덮는다. diff로 판단한다.

## Open boundary

- **사내 적용(NOT RUN)** — 위 「다음 할 일」. 사내 배포 SHA NOT VERIFIED, 사내 규모 재색인 검증 시간 NOT MEASURED.
- **DEV-773(open)** — 배포와 스택 가져오기 사이의 역방향 재평가 공백. 7.J 2번(배포 직후 가져오기)으로 좁혔다.
- **DEV-776(open)** — 단일 호스트의 `worker-link`·`worker-batch`에 `GHE_BASE_URL`이 없어 GHE URL 참조가 추출되지 않는다(Kubernetes는 configMap으로 받는다). 고치면 URL 참조 간선이 새로 생기는 동작 변경 → 별도 CR.
- **DEV-777(open)** — 등록 요청 대기열(API-ADM-009) 커서가 `created_at`을 밀리초로 잘라 같은 밀리초 요청이 다음 쪽에서 빠진다(PR #240 CI integration 첫 시도 실패의 원인). 감사 기록 커서(API-ADM-005)도 코드 판독으로는 같은 결함이다(`audit.ts` — `occurred_at`은 `now()` 마이크로초, 다음 쪽 커서는 JS `Date` 밀리초). 실행으로 확인하지는 않았다 → 별도 CR.
- **자원 정리** — 19차 자원은 지웠다(「Verify before changing code」 1번). 옛 `prs-cr117-*`·`prs-s18-*` 시험 인프라와 이전 회차 워크트리는 그대로다.

## References

- 변경 대장 `docs/00_governance/change_control.md`의 CR-122·CR-123(서사·표·5장 cascade와 병합 판정).
- 원장 `docs/40_delivery/pr_search_implementation_traceability.md` 6.113·6.114장, 5장 DEV-774~DEV-777.
- 운영 절차 `deploy/single-host/RUNBOOK.md` 3장 「업그레이드」, 7장 표, 7.G·7.H·7.I·**7.J**, 8장.
- 세션 노트 `agent-context/session-notes.md` 「19차」, todos 「19차 뒤 남은 것」.
