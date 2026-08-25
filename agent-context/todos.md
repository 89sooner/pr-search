# 다음 작업 · 미해결 항목 · 확인할 사항

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
