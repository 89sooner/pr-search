# 다음 작업 · 미해결 항목 · 확인할 사항

> **최신 기준 (2026-08-26 CR-039 / WP-029 종료 시점)**
> main `ea917b8` · SRS `baseline v2.5` · 원장 `review v2.3` · 작업 패키지 `v0.4` ·
> CR-039 · DEV-229까지. **REL-004 구현 1/8** (WP-029 done).
> **REL-003 릴리스 게이트는 여전히 미통과 — 베타 공개 승인 안 됨.**
> 미해결 리뷰 **0건** (PR #1~#44 전수 실측). 브랜치 없음.

## A. 지금 당장 — WP-030 착수 전 계약 감사 (REL-004)

**구현부터 시작하지 않는다.** "착수 전 감사에서 계약 공백이 나왔다"가 **일곱 번 연속**이다
(CR-029·030·031·033·035·038·039). 같은 순서를 지킨다: **감사 → CR → 구현**.

- 대상: **WP-030 되돌림·체리픽·스택 관계 파생** (`docs/40_delivery/pr_search_work_packages.md`)
- next-free는 **실측할 것** — CR-040 / DEV-230이 예상이지만 추측해 쓰지 않는다:
  ```bash
  grep -ohE 'CR-[0-9]{3}' docs/00_governance/change_control.md | sort -u | tail -2
  grep -rohE 'DEV-[0-9]{3}' docs/ | sort -u | tail -2
  grep -rohE 'JOB-[A-Z]+-[0-9]{3}' docs/ | sort -u   # 새 ID는 충돌부터
  ```
- **WP-029가 깔아 둔 자리** — 다시 만들지 말 것:
  - `link` 역할·`pipeline-worker-link.yaml`·README 적용 순서가 **이미 있다**
  - `link_summary`의 네 leaf(`has_revert`·`is_reverted`·`has_cherry_pick`·`has_stack`)와
    `detached`가 **WP-030 소유로 명시**돼 있다 (DEV-222·223). 객체 통째 대입 금지 —
    leaf 단위 스크립트(`LINK_SUMMARY_SCRIPT`)가 선례다
  - `commit_snapshot.patch_id`가 체리픽 판정 근거로 **보존**된다 (CR-038, DEV-208)
  - `STORED_LINK_TYPES`에 `reverts`·`cherry_picks`·`stacks_on`이 이미 어휘로 있다
- **감사에서 물을 것** (WP-029가 같은 계열로 다섯을 찾았다):
  1. 방아쇠가 **문서 존재를 전제하지 않는가** — JOB-REL-002·003·004도 `EVT-ING-003`만 적혀 있다
  2. 되돌림·체리픽 간선의 **`link_id` 재료가 안정적인가** — 대상이 나중에 밝혀지는 경로가 있나
  3. **본문이 바뀌면 간선이 사라지는가** — WP-029의 완전 파생 집합 규율을 이어받는가
  4. **과거 데이터 재파생 경로**가 JOB-REL-006에 확장되는가
  5. FR-REL-005 AC-2가 **조건부**임을 계약이 반영하는가 (CR-024, DEV-111 — blob 인출 기본 차단)

## B. 릴리스 게이트 4·5·6 (REL-003 미통과 사유)

원장 6.31.1장과 `change_control.md` 4장에 게이트별로 적혀 있다. **이 환경에서 돌지
않는 항목이 섞여 있으므로 무엇을 지금 할 수 있는지부터 가른다.**

| 게이트 | 남은 일 | 이 환경에서 가능? |
| --- | --- | --- |
| Gate 4 보안 | 권한 매트릭스 78셀 중 화면 13종 축, 위협 모델 재검토, 시크릿 스캔 | 시크릿 스캔·위협 모델은 가능. 화면 축은 화면이 더 서야 함 |
| Gate 5 성능 | 성능 목표 7종 (DEV-058) | **불가** — 1000만 문서 합성 데이터셋도 `test:perf` 스크립트도 없다 |
| Gate 6 운영 | 런북 실행, 롤백 10분 실측, 대시보드·알림 구성 | **불가** — 실제 Kubernetes 없음 |

## C. 미뤄 둔 항목 (별도 CR)

- **`flow-001` e2e 간헐 실패** — 로컬 전체 실행 5회 중 4회 실패, 단독 4/4 통과,
  **CI는 통과**. 이 세션이 `apps/web`을 한 파일도 안 바꿨고 그 시험은 모든
  `/api/**`를 가로채므로 이번 변경이 닿을 수 없다. WP-016 소관, 원장 §7.
  **재시도로 가리지 않는다**
- **백필(JOB-ING-004)의 `updated` 정렬 열거** — 부트스트랩만 `created`로 고쳤다.
  백필은 조정 스캔이 보정하므로 미뤘다. DEV-098의 `direction: asc` 의미와 커서
  재개 규칙을 함께 봐야 하는 변경이라 별도 CR (원장 §7)
- **JOB-MIR-002 스윕의 배치 공정성** — `repository_id` 순 500건이라 영구 실패
  커밋이 매 회차 같은 자리를 차지한다. 정확성은 안 깨진다 (원장 §7)

## D. 확인할 사항

- **open DEV는 5건이다** — DEV-001·006·010·016·026. 이전 인계가 "1건(DEV-010)"이라
  적었으나 실측은 다섯이다. 전부 기존 환경 제약·범위 공백이며 이번 작업이 만든 것이
  아니다. 세는 법:
  ```bash
  grep -cE '^\| DEV-[0-9]{3} .*\| open' docs/40_delivery/pr_search_implementation_traceability.md
  ```
- **`OD-005`(nori 플러그인)의 기한이 도래했다.** "REL-004 착수 전"인데 WP-029가
  REL-004의 첫 WP였다. 전문 검색(WP-032) 소관이라 WP-029·030을 막지 않으므로
  결정하지 않았다 — **사용자 결정 항목으로 열려 있다** (`change_control.md` 6장)
- **`link` 역할이 배포에 추가됐다.** 운영 적용 시 `pipeline-worker-link.yaml`이
  적용 순서에 들어 있는지 확인할 것 — 회귀가 그것을 검사한다
- `GHE_BASE_URL`이 `link` 역할에 **반드시** 필요하다. 없으면 URL 참조를 아예
  만들지 않는다 (THR-036, fail closed) — 조용히 적게 만드는 것이라 눈치채기 어렵다

- **전사는 `exports/202608261008.md`에 있다** (2026-08-26 실측 정정 — 이전 기록의
  "저장소 루트" 주장은 **틀렸다**). `exports/`는 `.gitignore` 대상이라 커밋에 딸려
  갈 위험이 없고, 미추적 파일도 현재 0건이다. 앞선 전사 둘(`202608251453.md`·
  `202608260047.md`)도 같은 자리다.
  **그래도 `git add -A`·`git add .`는 쓰지 않는다** — 경로를 지목해 stage 한다
- **로컬 브랜치 4개가 병합된 채 남아 있다** (`claude/cr-031-wp-027`,
  `claude/cr-037-post-merge-correctness`, `claude/cr-038-wp-067-commit-metadata`,
  `claude/rel-003-closure`). `git branch --no-merged main`은 비어 있다 — 삭제만
  안 된 상태다. "브랜치 없음"을 근거로 판단하지 않는다
- `agent-context/`는 main에 tracked다. `.gitignore`에 넣지 않는다
- open DEV는 **1건**(DEV-010, 기존 스트림 동시성 표기)이다. 이 세션이 만든 것 아님

---

# 이전 세션 기록 (보존)

> **0번은 해소됐다** — CR-037이 미해결 리뷰 10건을 전부 닫고 `7060414`로 머지됐다.
> 1번(WP-067 계약 감사)도 CR-038로 해소됐다. 아래는 그때의 판단 근거를 남긴 것이다.


> 상태 기준: main `5e18e00`, SRS `baseline v2.5`, 원장 `review v1.8`,
> CR-036·DEV-190까지. REL-003 **10/11** (WP-067만 `todo`).
> 브랜치 없음 — 전부 병합·삭제했다.

## 0. 지금 당장 — CR-037로 미해결 리뷰 9건 정정 (블로킹)

**전부 코드로 재현 확인했다.** WP-028·WP-068의 `done` 판정을 실질적으로
약화시키므로 WP-067보다 먼저다. 다음 free 번호는 **CR-037 / DEV-191**이지만
착수 시 반드시 실측할 것.

### PR #37 (CR-034) — P1 4건

| # | 결함 | 재현 근거 |
| --- | --- | --- |
| 1 | `repairSequence`가 락 획득 후 **`head_sha`를 재확인하지 않는다** (`seq_epoch`만 검사) | `apps/pipeline-worker/src/sequence.ts` 818행 부근. 그래프 walk 중 정상 채번이 head를 전진시키면 **head를 뒤로 되돌리고 이미 채번된 커밋을 누락**한다 |
| 2 | 마이그레이션 010이 **기존 문서를 백필하지 않는다** | 업그레이드 시 기존 PR 문서는 ES에만 남는다. 투영은 바뀐 PR만 쓰고 조정 스캔은 이미 색인된 것을 건너뛰므로, 손대지 않은 운영 데이터는 스냅숏을 영영 못 얻고 `extra_in_es`로 보고된다 (DEV-190과 같은 계열) |
| 3 | 지문에 **`org_id`·`visibility` 누락** | `apps/pipeline-worker/src/consistency.ts`의 `CANONICAL_FIELDS`. `packages/es/src/scoped-query.ts`가 `org_team` 필터에 쓰는 바로 그 필드인데 대조에서 빠져, **접근 통제 데이터가 불일치해도 일치로 보고**한다 |
| 4 | 실행 중 잡 **취소가 무시된다** | `apps/pipeline-worker/src/sequence-repair-runner.ts` 96행 부근. 운영자가 `cancelled`로 바꿔도 무조건 `finishJob`이 `completed`/`failed`로 덮어쓰고, 비가역 복구도 계속 진행된다 |

### PR #37 — P2 3건

- 수동 복구가 `sequence.reassigned`(EVT-SEQ-002)를 **발행하지 않는다** —
  `reassignSequence`와 달리 알림 소비자가 수동 복구를 놓친다
- `reassigning`이 **트랜잭션 밖에서 관측되지 않는다** — `bumpEpoch`가 같은
  트랜잭션 안에서 설정하고 `advanceHead`가 즉시 `ok`로 되돌린다. 긴 재구축 중
  조회가 "정상"으로 옛 에폭을 낸다. `reassignSequence`처럼 `markReassigning`을
  **먼저 따로 커밋**해야 한다
- 그래프를 읽지 못한 실패가 **`stale`로 영속화되지 않는다** — `repairSequence`가
  `stale` outcome을 반환만 하고 `markStale`을 부르지 않아, 잠재적으로 손상된
  공간이 `ok`로 광고된다

### PR #36 · #38 — P2 2건

- **PR #36**: WP-027 원장 행에 `화면 커밋 / PR #33` 플레이스홀더가 남아 있고
  실제 화면 커밋 `594fa94`와 CR-032 정정이 빠졌다
- **PR #38**: **`docs/40_delivery/pr_search_work_packages.md`의 순서표가
  WP-028·WP-068을 아직 `todo`로 표시한다** (48·50행). 원장은 `done`이고 DoD
  체크박스도 미체크다. **이 세션이 만든 문서 모순이다** — 후속 에이전트가 작업
  패키지 문서를 기준으로 판단하면 재작업하게 된다

## 1. WP-067 — 착수 전 계약 감사 필요 (CR 먼저)

**현재 WP-067 계약을 그대로 구현하면 안 된다.** 다음 다섯을 먼저 정리할 것.

1. `JOB-MIR-002`가 `EVT-ING-003`를 소비할 때 `prs:projected`의 기존 `link`
   consumer group과 **같은 group을 쓰면 안 된다** — 독립 처리라 별도 group 필요
2. 현재 계약은 "기존 commit document **부분 갱신만**"이라 **direct-push commit
   document가 아예 없는 문제**를 해결하지 못한다
3. sequence projection도 `update_by_query`뿐이라 **없는 문서를 만들지 않는다**
4. PR 상세의 `source_commits`는 SHA 객체만 만들고 **commit document를 join하지
   않는다** — 메타데이터를 채워도 화면에는 계속 SHA만 나온다
5. Neighbor API의 direct-push 행도 **PR document만 표시 소스로 읽는다** — 같은 이유

**우선순위 근거**: WP-027이 직접 푸시 커밋을 선행·후행에 실제 노출하기 시작해
이제 사용자에게 보이는 조사 품질이다(원장 §8).

## 2. 미뤄 둔 항목

- **`flow-001` "히스토리 규율" e2e 간헐 실패** — 이 세션에서 **깨끗한 `main`
  (`bc0e931`)으로 재현해 기존 문제로 귀속 확인**했다(2회 중 1회 실패). WP-016
  소관, 원장 §7. 사용자가 "나중에"로 미뤘다
- REL-003 잔여: **WP-067뿐**

## 3. 확인할 사항

- `agent-context/`는 이제 **main에 tracked**다(`6d2577f`). `.gitignore`에 넣지
  않고 삭제하지도 않는다 — 지시서 확인 완료
- `.gitignore`에 `exports/`가 있다(`/export` 전사 아카이브용)
- 전사는 `exports/202608260047.md`에 있고 **`exports/`는 `.gitignore` 대상이다**
  (2026-08-26 실측 정정 — 이전 기록의 "저장소 루트" 주장은 **틀렸다**). 직전 세션
  전사 `exports/202608251453.md`도 같은 자리다. 커밋에 딸려 갈 위험은 없다
- **`agent-context/` 변경분이 커밋되지 않은 채 인계된다** — `*.md` 7개 +
  `_handoff/` 전체. 코드 작업을 시작하기 전에 이것부터 커밋할지 정할 것
  (`risks.md` 13번). `git add -A`는 쓰지 말 것
