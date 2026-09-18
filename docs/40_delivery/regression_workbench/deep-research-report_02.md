# pr-search Regression Workbench UI/UX 설계안

## 핵심 결론

이번 요구사항은 현재 `Search` 화면에 필터를 더 넣는 방식으로 해결하면 안 됩니다. 가장 적합한 구조는 현재 검색과 분리된 `Regression` 메뉴와 `/regression` 전용 Workbench를 만드는 것입니다.

역할을 다음처럼 명확히 나누는 것이 좋습니다.

| 화면 | 사용자가 던지는 질문 | 중심 식별자 |
|---|---|---|
| Search | “이 PR/SHA/M 번호가 무엇인가?” | PR / SHA / M / query |
| Range investigation | “이 두 revision 사이에 무엇이 들어갔나?” | `merge_seq` range |
| Regression | “어디까지 PASS였고 어디서부터 FAIL인가? 무엇을 다음에 시험해야 하나?” | Integration sequence + test evidence |
| MDVP | “이 revision을 어떤 환경에서 시험했고 결과가 무엇인가?” | run / artifact / environment |

현재 코드도 사실 이 방향으로 진화할 기반은 이미 거의 있습니다. `/ranges`에는 sequence-space, range, epoch 처리와 `BisectPanel`이 들어 있고, `BisectPanel`은 `good_seq`, `bad_seq`, `remaining`, `estimated_steps`, `next`, `result`를 이미 다룹니다. 다만 UI가 “외부에서 다음 commit을 시험한 후 Good/Bad를 누르는” 작은 패널 수준이라, 팀장이 원하는 MDVP 중심의 regression investigation 경험과는 거리가 있습니다. fileciteturn11file0 fileciteturn12file0 fileciteturn13file0

앞선 심층 조사에서 도출된 핵심도 같습니다. regression의 정본은 PR 번호가 아니라 main/release first-parent 순서이며, MDVP 같은 외부 시험 시스템은 그 순서에 시험 evidence를 붙이고, pr-search가 그 evidence를 바탕으로 suspect interval과 다음 후보를 제시하는 구조가 가장 자연스럽습니다. fileciteturn0file0

다만 한 가지는 이번 UI 설계에서 반드시 바로잡아야 합니다.

사용자가 말한 “M number 기준”을 현재 pr-search의 `M number` 그대로 regression x축으로 사용해서는 안 됩니다. 현재 제품 계약에서 `merge_seq`는 `(repository, base branch, epoch)`의 실제 first-parent integration 순서이고, M number는 PR 연결 항목에 별도로 붙는 서수입니다. direct push처럼 PR이 없는 commit은 M을 갖지 않을 수 있습니다. 현재 CR-102 regression 계획도 regression revision key를 `repo · branch · E · I`로 두고, M과 PR은 보조 식별자로 유지하는 방향입니다. fileciteturn22file0 fileciteturn22file0

따라서 화면에는 다음 식으로 보여주는 것이 가장 안전합니다.

```text
Regression ordering
──────────────────────────────────────────────────

Integration   M number        PR       Commit
I-10521       M-1900-521      #521     a91bc21
I-10522       M-1900-535      #535     b12de43
I-10523       —               —        c81fa22   ← direct push 가능
I-10524       M-1900-548      #548     d71be10
```

팀 문화상 “M-10524”라는 이름을 Integration ID 자체로 쓰고 싶다면 그것은 단순 UI 변경이 아니라 M semantics를 바꾸는 제품 계약 변경입니다. 현재 PRD의 OD-010은 M 재정의를 승인하지 않은 상태이고, CR-102도 M 재정의를 제외하고 있습니다. fileciteturn25file0

그래서 이번 설계안에서 추천하는 사용자 경험은 다음 한 줄로 정리됩니다.

> `날짜/MDVP FAIL을 찾는다 → 그 FAIL을 sequence 상의 evidence로 고정한다 → 이전 PASS와 FAIL 사이 변경들을 즉시 본다 → 필요하면 bisect session으로 전환한다 → 다음 Integration revision을 MDVP/장비에서 시험한다 → PASS/FAIL/INCONCLUSIVE/SKIP evidence가 누적되면서 범위가 줄어든다.`

이 방식이 `Search`와 완전히 다른 이유는, Search가 “entity retrieval”인 반면 Regression은 “stateful investigation”이기 때문입니다.

또 하나 중요한 현재 상태가 있습니다. 2026년 9월 18일 현재 SRS는 `baseline v2.37`이고, CR-102 regression 확장은 아직 승인된 baseline 기능이 아닙니다. 현재 regression 구현계획의 R5도 “W-004 진입 보존”을 전제로 하고 있어, 이번에 요청한 별도 Regression 메뉴는 기존 제안에서 한 단계 더 나아간 변경입니다. 또한 repository의 `CLAUDE.md`는 SRS가 승인하기 전 코드가 제품 범위를 재정의하지 못하도록 명시하고 있습니다. 따라서 Claude에게 바로 UI부터 만들게 하기보다는 새 요구를 CR로 등록하고 SRS → PRD → IA/wireframe → architecture → WP로 cascade한 뒤 구현하게 하는 것이 이 저장소의 정상적인 개발 절차입니다. CR 번호도 추측하지 말고 저장소에서 next-free ID를 측정해야 합니다. fileciteturn26file0 fileciteturn22file0 fileciteturn20file0

## 현재 저장소에 맞는 정보 구조

현재 좌측 navigation은 `Search`, `Analysis`, `GitHub`, `Operations`의 네 section으로 정의돼 있고, `Search / Saved searches`, `Repositories / Range investigation / Releases / Analytics` 등이 이미 분리돼 있습니다. 즉 Regression을 Search에서 분리하기 위해 navigation 전체를 재설계할 필요는 없습니다. fileciteturn10file0

가장 적은 변화로 가장 직관적인 IA는 다음입니다.

```text
PR Search
Every change, connected.

SEARCH
  Search
  Saved searches

ANALYSIS
  Regression            ← 신규
  Range investigation
  Repositories
  Releases
  Analytics

GITHUB
  GitHub operations
  Run history

OPERATIONS
  ...
```

처음부터 `VALIDATION`이라는 새 section을 만들지는 않는 것을 권합니다.

Regression 하나만 있는 상태에서 section을 하나 더 만들면 navigation hierarchy만 늘어납니다. 향후 `Test runs`, `Qualification`, `Stable baselines`처럼 MDVP/validation 화면이 실제로 두세 개로 늘어난 시점에 `VALIDATION` section으로 승격하는 것이 낫습니다.

추천 route는 다음입니다.

```text
/regression
/regression?repo=modem/sw
           &branch=main
           &test_type=live
           &scenario=NR-RLF
           &from=2026-09-17T00:00:00Z
           &to=2026-09-18T23:59:59Z
           &selected_run=mdvp-981231
           &session=<optional-session-id>
```

현재 `RangesView`는 이미 “URL이 investigation state의 정본”이라는 설계 원칙을 사용하고 있습니다. repo/branch/from/to/epoch 등을 URL에 실어 조사 상태 자체를 공유 가능한 링크로 만드는 방식이므로 Regression도 이 원칙을 그대로 가져오는 편이 일관됩니다. fileciteturn12file0

### Search와 Regression의 경계

`Search`에는 regression 기능을 밀어 넣지 않습니다.

현재 Search는 PR, commit, merge sequence를 탐색하는 통합 검색이고, 별도의 Repository Workspace까지 이미 갖고 있습니다. 여기에 MDVP timeline과 bisect state까지 추가하면 “검색”과 “investigation”의 mental model이 다시 섞입니다. fileciteturn8file0

`Range investigation`도 없애지 않습니다.

그 화면은 여전히 “A와 B 사이 무엇이 변경되었는가?”라는 범용 분석 도구로 가치가 있습니다. 새 Regression 화면은 그 위에 다음 네 가지를 더 얹은 guided workflow여야 합니다.

```text
Range investigation
        │
        ├── sequence range
        ├── PR / commit list
        └── generic bisect
                 │
                 ▼
Regression Workbench
        ├── MDVP observations
        ├── failure timeline
        ├── known-good / known-bad
        ├── test evidence history
        ├── artifact availability
        └── guided bisect session
```

즉 `/ranges`를 복제하는 것이 아니라 sequence/bisect domain logic을 공유하고 Regression 전용 presentation layer를 하나 더 만드는 구조입니다.

### 화면이 답해야 할 질문

사용자가 Regression 화면에 들어왔을 때 정보 우선순위는 다음 순서여야 합니다.

```text
무엇이 실패했는가?
        ↓
어느 revision에서 실패했는가?
        ↓
그 직전의 신뢰 가능한 PASS는 어디인가?
        ↓
두 지점 사이에 무엇이 변경되었는가?
        ↓
현재 suspect interval은 얼마나 큰가?
        ↓
다음에는 어떤 binary/revision을 시험해야 하는가?
        ↓
그 시험 결과는 무엇이었는가?
```

이 질문 순서가 화면 구조 그 자체가 되어야 합니다.

### M number가 아니라 Integration 순서를 기본 축으로

Regression page의 기본 timeline x축은 날짜가 아니라 Integration Sequence로 잡는 것을 권합니다.

날짜는 “문제가 발생한 run을 찾는 진입 조건”입니다. Binary search에서 실제 순서를 정의하는 것은 sequence입니다. 날짜 기준으로 정렬하면 하루 안에서 여러 merge가 발생하거나 시험 시점과 merge 시점이 어긋났을 때 무엇이 앞뒤인지 다시 해석해야 합니다.

따라서 상단에는 다음 toggle을 둡니다.

```text
Timeline axis
[ Integration ] [ Calendar ]
```

기본은 `Integration`.

`Calendar`는 “9월 17일 밤부터 FAIL이 나오기 시작했다”처럼 현상을 보는 보조 view입니다.

`Integration`은 실제 regression search용입니다.

UI copy에서도 현재 제품 정의를 지키려면 다음처럼 표시합니다.

```text
I-10524
M-1900-548 · PR #548 · d71be10
```

혹은 향후 제품 결정으로 M이 canonical integration ID가 되면 그때 표시를 바꾸면 됩니다.

### 특정 날짜 FAIL에서 PR 목록까지 가는 흐름

팀장이 말한 “특정 날짜 fail 테스트에 대한 PR(M number) 리스트”는 다음 interaction으로 만드는 것이 가장 좋습니다.

```text
2026-09-18 선택
      ↓
MDVP / Live / FAIL 필터
      ↓
FAIL run 선택
      ↓
Run detail 표시
      ↓
동일 test scope의 이전 PASS 탐색
      ↓
"Suggested regression window"
I-10521 PASS → I-10580 FAIL
      ↓
사용자가 boundary 확인
      ↓
Changes in suspect window
      ↓
I / M / PR / SHA / Title / Layer / Artifact 목록
      ↓
Start bisect
```

여기서 이전 PASS는 자동으로 확정하면 안 됩니다.

현재 regression 설계 초안 자체가 동일 failure signature와 동일 시험 조건에서 good→bad 경계를 조사한다는 전제를 두고 있습니다. HW, RF, network, scenario가 다른 PASS를 그냥 “직전 PASS”로 붙이면 잘못된 regression interval이 생길 수 있습니다. 따라서 UI는 `Suggested known good`으로 보여주고 사용자가 context match를 확인하게 해야 합니다. fileciteturn22file0

예를 들어:

```text
Selected failure

MDVP-981231
FAIL · I-10580 · Sep 18 14:32
NR / L1 / RLF
HW: EVT3 · RF: Band n78 · Lab-A

Suggested previous PASS
MDVP-980441
PASS · I-10521 · Sep 17 20:10

✓ Same scenario
✓ Same HW group
✓ Same RF profile
! Network config changed: v31 → v32

[Use as Known Good]   [Choose another]
```

이 작은 확인 단계가 regression UI에서 매우 중요합니다.

## 핵심 화면 레이아웃과 사용자 흐름

추천 화면은 dashboard가 아니라 “investigation workbench”입니다.

Supahero나 Stanley 같은 landing/marketing UI의 강점인 “한 화면에서 사용자가 지금 해야 할 한 가지를 강하게 드러내는 방식”은 가져오되, 큰 hero나 과도한 marketing typography는 가져오지 않는 것이 좋습니다. Supahero는 hero reference를 모으는 성격이고 Stanley도 한 번에 하나의 가치와 행동을 선명하게 제시하는 구성이 강합니다. 이 제품에서는 그 focal point를 “현재 suspect interval과 next candidate”로 바꾸면 됩니다. citeturn9search4turn13search14

### 상단 Context Bar

화면 최상단은 제목보다 조사 context가 중요합니다.

```text
Regression
Investigate failures by integration order and test evidence.

[Repository ▾] [Base branch ▾] [Source: MDVP ▾]
[Test type: Live ▾] [Scenario ▾] [Environment ▾]
[Sep 17 ─ Sep 18]                           [Apply]
```

항상 노출할 필드는:

```text
Repository
Base branch
Test source
Test type
Scenario / failure signature
Date range
```

고급 조건은 `More filters` Popover에 넣습니다.

```text
Product / variant
HW revision
Device group
RF profile
Network configuration
Artifact availability
Verdict
```

모든 필터를 한 줄에 계속 늘리는 방식은 피합니다.

### Investigation Summary

FAIL을 하나 선택하고 good/bad 경계가 만들어지면 검색 필터보다 이 카드가 화면에서 가장 중요한 정보가 됩니다.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Regression window                                          IN PROGRESS │
│                                                                         │
│ Known good          Known bad           Suspects       Next candidate  │
│ I-10521             I-10580              59             I-10550          │
│ PASS                FAIL                                  build ready    │
│ Sep 17 20:10        Sep 18 14:32                         ~6 checks       │
│                                                                         │
│ Failure: NR-L1-RLF · Live · EVT3 · n78                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

`Estimated ~6 checks`는 현재 bisect의 `estimated_steps`를 활용할 수 있지만, SKIP이나 artifact availability, MTBF 수행시간까지 보장하는 값으로 표현하면 안 됩니다. 현재 regression 설계안도 기존 `ceil(log2(remaining))`을 이상적 추정값으로만 유지하고 testable count를 별도로 두는 방향입니다. fileciteturn22file1

추천 표기는 다음과 같습니다.

```text
59 revisions
41 testable now
~6 ideal checks
```

이것이 `59 candidates, 6 checks`보다 훨씬 정확합니다.

### Regression Timeline

화면의 시각적 중심입니다.

Grafana의 Alert History UX는 상단 timeline과 하단 event list를 함께 두고, state transition을 필터링하고, 특정 시점에 hover하거나 zoom하는 패턴을 사용합니다. State history에서도 위에 timeline, 아래에 해당 시점의 instance/event 정보를 보여줍니다. regression test evidence에도 매우 잘 맞는 패턴입니다. citeturn14search0

다만 Grafana State Timeline을 그대로 복사해서는 안 됩니다.

MDVP 결과가 일부 integration revision에만 존재한다면 PASS와 다음 FAIL 사이 전체를 녹색/빨간색 continuous bar로 칠하는 순간 “시험하지 않은 revision도 PASS였다”는 잘못된 의미가 생깁니다.

따라서 Integration mode에서는 discrete observation을 기본으로 합니다.

```text
              suspect interval
             ┌─────────────────────────────────┐
Integration  I-10520  21   25   32   40   50   60   70   80
             │        │    │    │    │    │    │    │    │

Live / RLF            ●P             ●P         ?    ●F   ●F
Live / Attach         ●P        ●P             ●P         ●P
MTBF / Overnight      ●P                  ◌RUN       ▲I
                                             ↑
                                      selected run

                       GOOD ├─────────────────┤ BAD
```

Legend:

```text
● PASS
● FAIL
◌ RUNNING
▲ INCONCLUSIVE
— SKIP
○ NO RESULT / unavailable
```

색은 부가적인 수단이고 아이콘/텍스트/shape를 함께 씁니다.

Calendar mode에서는 실제 시간 중심으로 바꿉니다.

```text
Sep 17 18:00      Sep 18 00:00       06:00       12:00       18:00

Live / RLF      ●P       ●P                        ●F  ●F
MTBF                         [────── RUN ──────] ▲I
Deploy             │                    │
                  I-10521              I-10550
```

Grafana가 annotation을 vertical line/icon으로 표시하고 rich event context와 외부 링크를 연결하는 패턴도 integration/deployment/artifact marker에 적합합니다. citeturn14search12

따라서 timeline 위쪽에 별도 lane을 둡니다.

```text
Integration changes  | | | | | | | |
Build artifacts      ◆     ◆   ◆ ◆
Release markers          ▲
```

### Changes in suspect window

팀장이 원하는 “이 FAIL과 관련한 PR(M number) 리스트”의 본체입니다.

이 table은 MDVP event를 눌렀을 때 즉시 suspect interval에 맞춰 바뀝니다.

```text
Changes in suspect window · 59 revisions
[All changes] [PR only]                     [Filter changes]

Integration   M number      PR     Commit    Change                     Area  Artifact
I-10522       M-1900-535    #535   b12de43   L1 scheduler update         L1    ready
I-10523       —             —      c81fa22   direct calibration update   RF    ready
I-10524       M-1900-548    #548   d71be10   RRC capability fix          RRC   missing
I-10525       M-1900-530    #530   e29cd11   TX switching fix            PHY   ready
...
```

`PR only` filter는 제공하되 default는 `All changes`여야 합니다.

direct push가 원인일 수 있는데 PR 리스트만 보여주면 regression tool 자체가 culprit 후보를 누락시키기 때문입니다. 현재 제품 역시 merge sequence가 모든 first-parent revision을 표현하고 PR 연결은 nullable하게 취급합니다. fileciteturn22file0

Table은 generic “모든 기능을 가진 거대한 grid”가 아니라 이 investigation에 필요한 정렬/필터만 갖도록 만드는 것이 좋습니다. shadcn/ui의 Data Table 가이드도 실제 data grid마다 sorting/filtering/data-source 요구가 다르므로 하나의 만능 component보다 용도별 table 구성을 권장합니다. citeturn11search2turn12search13

기본 정렬은 반드시 Integration ascending입니다.

```text
Known Good
  ↓
I-10522
I-10523
I-10524
...
I-10580
  ↑
Known Bad
```

PR 번호 순서로 절대로 정렬하지 않습니다.

### Detail Inspector

Timeline point나 change row를 클릭하면 페이지를 이동시키지 말고 우측 inspector가 열리는 것이 좋습니다.

shadcn의 Sheet 패턴은 주 화면을 유지한 채 보조 정보를 edge panel로 여는 용도이고, 이 문제에 잘 맞습니다. citeturn12search4turn12search5

Desktop:

```text
Timeline / Table                           Selected run
───────────────────────────────┬────────────────────────────
                               │ MDVP-981231
                               │ FAIL
                               │
                               │ I-10580
                               │ M-1900-548
                               │ PR #548
                               │ d71be10
                               │
                               │ Test
                               │ NR-L1-RLF
                               │ Live
                               │
                               │ Environment
                               │ EVT3 / n78 / Lab-A
                               │
                               │ Runtime    04:31:17
                               │ Failures   3
                               │
                               │ Artifact
                               │ SMP1900...
                               │
                               │ [Open PR]
                               │ [Open commit]
                               │ [Open in MDVP]
                               │
                               │ Observation history
                               │ 14:32 FAIL
                               │ 13:10 INCONCLUSIVE
───────────────────────────────┴────────────────────────────
```

Inspector width는 대략 `360–420px` 정도면 충분합니다.

좁은 desktop에서는 right Sheet, 모바일에서는 bottom Sheet로 전환합니다.

### Bisect Session

Regression 화면에서 `Start bisect`를 누르면 별도 페이지로 가기보다는 같은 화면 안에서 session bar가 활성화되는 것이 더 좋습니다.

```text
┌────────────────────────────────────────────────────────────────────┐
│ BISECT SESSION                                         IN PROGRESS │
│                                                                    │
│ Known Good                 Next candidate              Known Bad    │
│ I-10521                    I-10550                     I-10580      │
│ PASS                       READY                       FAIL         │
│ ●──────────────────────────◆───────────────────────────●            │
│                                                                    │
│ 59 revisions · 41 testable · ~6 ideal checks                      │
│                                                                    │
│ Artifact: SMP1900-main-E1-S10550-91c7aae.bin                       │
│                                                                    │
│ [Copy revision] [Open artifact] [Open in MDVP]                     │
│                                                                    │
│ Record observation                                                  │
│ [ PASS ] [ FAIL ] [ INCONCLUSIVE ] [ SKIP ]                        │
└────────────────────────────────────────────────────────────────────┘
```

현재 `BisectPanel`은 Good/Bad만 허용합니다. CR-102 계획은 이를 `PASS / FAIL / SKIP / INCONCLUSIVE`로 확장하고, SKIP 및 INCONCLUSIVE는 boundary를 변경하지 않는 모델을 제안하고 있습니다. fileciteturn13file0 fileciteturn22file0

이 네 verdict가 UI에도 명시적으로 보여야 합니다.

```text
PASS
good boundary를 앞으로 이동

FAIL
bad boundary를 뒤로 이동

INCONCLUSIVE
boundary unchanged
같은 revision 재시험 가능

SKIP
boundary unchanged
현재 automatic candidate 추천에서 제외
```

이 방식은 실제 장비 시험이 자동화되지 않는 환경에 특히 적합합니다. “binary search algorithm은 서버가 하고, 실제 시험은 사람/MDVP/장비가 한다”는 구조입니다.

Buildkite도 test execution/history와 unreliable/flaky state를 분리해 다루고, 같은 code revision에서 PASS와 FAIL이 섞이는 경우를 flaky evidence로 취급합니다. MTBF나 field test를 단일 boolean으로 축약하지 않고 observation history를 보존하는 방향이 합리적이라는 외부 사례가 됩니다. citeturn14search1turn14search3turn14search8

## 와이어프레임

### Desktop 기본 화면

1440px 이상 기준입니다.

```text
┌───────────────┬─────────────────────────────────────────────────────────────────────────────────────┐
│ PR Search     │ Regression                                                     Theme   User         │
│ Every change,│ Investigate failures by integration order and test evidence.                         │
│ connected.    ├─────────────────────────────────────────────────────────────────────────────────────┤
│               │                                                                                     │
│ SEARCH        │ [Repository: modem/sw ▾] [Branch: main ▾] [MDVP ▾] [Live ▾] [Scenario ▾]          │
│  Search       │ [Sep 17 ─ Sep 18] [More filters]                                          [Apply]   │
│  Saved        │                                                                                     │
│               ├─────────────────────────────────────────────────────────────────────────────────────┤
│ ANALYSIS      │ Regression window                                                      IN PROGRESS │
│ >Regression   │                                                                                     │
│  Range        │  Known good            Known bad             Suspects        Next                    │
│  Repositories │  I-10521               I-10580               59              I-10550                 │
│  Releases     │  PASS                  FAIL                   41 testable     READY                   │
│  Analytics    │  Sep 17 20:10          Sep 18 14:32                           ~6 ideal checks        │
│               │                                                                                     │
│ GITHUB        │  Failure signature: NR-L1-RLF · EVT3 · n78 · Lab-A                                  │
│  Operations   ├─────────────────────────────────────────────────────────────────────────────────────┤
│  Run history  │ [Integration] [Calendar]                Filter tests      Zoom - 100% +   Reset      │
│               │                                                                                     │
│               │                   SUSPECT INTERVAL                                                   │
│               │             ┌─────────────────────────────────────────────────┐                     │
│               │ I-10520  21 │  25    32    40    50    60    70     80       │                     │
│               │ Changes   │ │   │     │     │     │     │     │      │        │                     │
│               │ Artifacts ◆     ◆           ◆     ◆            ◆             │                     │
│               │ RLF       ●P       ●P              ◌        ●F       ●F      │                     │
│               │ Attach    ●P   ●P           ●P                    ●P         │                     │
│               │ MTBF           ●P                ◌RUN      ▲I                │                     │
│               │             └─────────────────────────────────────────────────┘                     │
│               │              GOOD                     NEXT                 BAD                       │
│               ├─────────────────────────────────────────────────────────────────────────────────────┤
│               │ Selected failure                                                                    │
│               │ MDVP-981231 · FAIL · I-10580 · Sep 18 14:32 · NR-L1-RLF                            │
│               │ Suggested good: MDVP-980441 · PASS · I-10521     [Use] [Choose another]              │
│               ├─────────────────────────────────────────────────────────────────────────────────────┤
│               │ Changes in suspect window · 59 revisions                      [All changes][PR only]│
│               │                                                                                     │
│               │ Integration  M number      PR     Commit   Change                 Area    Artifact   │
│               │ I-10522      M-1900-535    #535   b12de43  L1 scheduler update    L1      ready      │
│               │ I-10523      —             —      c81fa22  calibration update     RF      ready      │
│               │ I-10524      M-1900-548    #548   d71be10  RRC capability fix     RRC     missing    │
│               │ I-10525      M-1900-530    #530   e29cd11  TX switching fix       PHY     ready      │
│               │ ...                                                                                 │
│               │                                                                                     │
│               │                                            [Start bisect with this window]          │
└───────────────┴─────────────────────────────────────────────────────────────────────────────────────┘
```

이 화면에서 가장 중요한 것은 “그래프가 예쁜가”가 아니라 사용자가 10초 안에 다음 네 가지를 읽을 수 있느냐입니다.

```text
PASS는 어디인가?
FAIL은 어디인가?
그 사이 변경이 몇 개인가?
다음 시험 대상은 무엇인가?
```

### FAIL 선택 후 Inspector가 열린 화면

```text
┌───────────────┬──────────────────────────────────────────────────────┬────────────────────────────┐
│ Navigation    │ Regression timeline / suspect changes               │ Run details                │
│               │                                                      │                            │
│               │          I-10521               I-10580              │ MDVP-981231                │
│               │ PASS ●────────────────────────────● FAIL            │ FAIL                       │
│               │                     ◆ I-10550                        │                            │
│               │                                                      │ Integration                │
│               │ Live/RLF    ●P      ●P     ◌       ●F              │ I-10580                    │
│               │ MTBF           ●P          ▲I                       │                            │
│               │                                                      │ M number                    │
│               ├──────────────────────────────────────────────────────┤ M-1900-548                 │
│               │ Changes                                              │                            │
│               │                                                      │ PR #548                    │
│               │ I-10524  M... #548  RRC capability fix              │ d71be10                    │
│               │ I-10525  M... #530  TX switching fix                │                            │
│               │ ...                                                  │ Artifact                   │
│               │                                                      │ SMP1900...                 │
│               │                                                      │                            │
│               │                                                      │ Test context               │
│               │                                                      │ Live / NR-L1-RLF           │
│               │                                                      │ EVT3 / n78 / Lab-A         │
│               │                                                      │                            │
│               │                                                      │ Result history             │
│               │                                                      │ FAIL · 14:32               │
│               │                                                      │ INC  · 13:10               │
│               │                                                      │                            │
│               │                                                      │ [Open in MDVP]             │
│               │                                                      │ [Open PR] [Open commit]     │
└───────────────┴──────────────────────────────────────────────────────┴────────────────────────────┘
```

핵심은 “detail을 보기 위해 context를 떠나지 않는 것”입니다.

Mac App Supply에 올라온 SpacePeek 사례도 overview에서 크기와 분포를 먼저 보고, 필요할 때 nested item으로 drill-down하는 방식입니다. Regression 역시 timeline → selected event → detailed evidence를 같은 workbench 안에서 단계적으로 깊게 들어가는 것이 잘 맞습니다. citeturn9search0

### Bisect 활성화 화면

```text
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Regression / Bisect session #RGS-2481                                           IN PROGRESS │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                            │
│  KNOWN GOOD                              NEXT                                KNOWN BAD     │
│                                                                                            │
│  I-10521                                 I-10550                             I-10580       │
│  PASS                                    READY                               FAIL          │
│     ●──────────────────────────────────────◆────────────────────────────────────●           │
│                                                                                            │
│  Remaining revisions    59         Testable now    41         Ideal checks    ~6            │
│                                                                                            │
│  Candidate                                                                                 │
│  I-10550 · M-1900-552 · PR #552 · 91c7aae                                                    │
│  SMP1900-main-E1-S10550-91c7aae.bin                                      Artifact ready   │
│                                                                                            │
│  [Copy candidate] [Open artifact] [Open in MDVP]                                           │
│                                                                                            │
│  Test observation                                                                         │
│                                                                                            │
│  [ PASS ]          [ FAIL ]          [ INCONCLUSIVE ]          [ SKIP ]                    │
│                                                                                            │
│  Scenario         [NR-L1-RLF_________________]                                              │
│  Environment      [EVT3 · n78 · Lab-A_________]                                            │
│  Run ID           [____________________________]                                            │
│  Notes            [____________________________________________________________]            │
│                                                                                            │
│                                                          [Record observation]               │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Observation history                                                                        │
│                                                                                            │
│ I-10580  FAIL           MDVP-981231      04:31:17      Sep 18 14:32                        │
│ I-10550  INCONCLUSIVE   MDVP-981012      02:10:00      Sep 18 11:22                        │
│ I-10521  PASS           MDVP-980441      06:00:00      Sep 17 20:10                        │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

현재 CR-102 R5의 완료 방향도 Workbench에서 repo/branch/epoch/I·PR·현재 M, full SHA, build variant, 4개 판정, history, keyboard, 375px, light/dark, stale/403/409 상태를 함께 검증하는 것입니다. 이번 레이아웃은 그 계획을 실제 사용자 workflow 중심으로 구체화한 형태입니다. fileciteturn22file0

### 375px 모바일

이 제품은 regression 조사 특성상 desktop이 primary여야 합니다. 그렇다고 375px requirement를 버리면 안 됩니다. 현재 R5 계획 자체도 375px 검증을 요구합니다. fileciteturn22file0

Loadmore는 모바일 웹을 데스크톱 축소판이 아니라 모바일 고유 interaction으로 탐구하는 archive입니다. 이 원칙을 적용하면 desktop timeline을 375px에 억지로 축소하기보다 모바일에서는 event list 중심으로 변환하는 편이 낫습니다. citeturn10search1turn10search3

```text
┌─────────────────────────────┐
│ ‹  Regression               │
│ modem/sw · main             │
├─────────────────────────────┤
│ [MDVP] [Live] [Sep17–18]    │
│ [Filters]                   │
├─────────────────────────────┤
│ Regression window           │
│                             │
│ PASS             FAIL       │
│ I-10521 ─────── I-10580     │
│                             │
│ 59 revisions                │
│ 41 testable                 │
│ Next I-10550                │
│                             │
│ [Start / Resume bisect]     │
├─────────────────────────────┤
│ Observations                │
│                             │
│ ● PASS                      │
│ I-10521                     │
│ Sep 17 20:10                │
│                             │
│ ▲ INCONCLUSIVE              │
│ I-10550                     │
│ Sep 18 11:22                │
│                             │
│ ● FAIL                      │
│ I-10580                     │
│ Sep 18 14:32                │
├─────────────────────────────┤
│ Changes · 59                │
│                             │
│ I-10522 · M-1900-535        │
│ #535                        │
│ L1 scheduler update         │
│ Artifact ready              │
│                             │
│ I-10523 · no PR             │
│ calibration update          │
│ Artifact ready              │
│                             │
└─────────────────────────────┘
```

모바일에서는 복잡한 timeline의 full editing보다 “incident 확인 / candidate 확인 / result 기록”을 우선합니다.

## 디자인 시스템과 인터랙션

### 레퍼런스에서 실제로 가져와야 할 것

제시한 사이트를 그대로 한데 섞으면 UI가 오히려 산만해집니다. 각각 역할을 분리해서 참고하는 것이 좋습니다.

| Reference | Regression 화면에 채택할 부분 | 가져오지 않을 부분 |
|---|---|---|
| Supahero | 첫 화면에서 핵심 task 하나를 강하게 보이는 정보 hierarchy | oversized hero, decorative landing motion citeturn9search4 |
| Dark Design | layered dark surface, restrained dark UI reference 탐색 | 검은 배경 자체를 디자인 목표로 삼는 것 citeturn15search22 |
| Mac App Supply | quiet utility UI, overview → drill-down | macOS styling 자체 복제 citeturn9search0 |
| GetLayers | depth/motion/layout을 “layer” 단위로 AI에 전달하는 방식 | 다른 palette와 component stack 통째 도입 citeturn10search11 |
| Loadmore | 모바일을 desktop 축소가 아닌 별도 information form으로 설계 | 실험적인 gesture를 operator workflow에 강제 citeturn10search1 |
| Beautiful UI | Records Table, Filter Table, Task Rows, Insight Cards 패턴 | AI chat UI 형태 citeturn10search0 |
| BeUI | 좁은 범위의 state transition과 reduced-motion 아이디어 | Motion/Tailwind dependency 도입 citeturn10search6turn10search13 |
| Rare UI | reduced-motion을 고려하는 방식 | Fluid Orb 같은 ambient/decorative animation citeturn11search1turn11search6 |
| Transitions.dev | panel reveal, state swap, skeleton→content, reduced motion | spring/blur를 모든 변화에 넣는 것 citeturn12search1turn12search12 |
| shadcn/ui | Data Table, Tabs, Sheet의 composition 방식 | shadcn/Tailwind migration 자체 citeturn12search0turn12search4 |
| Stanley | “현재 상태 → 다음 행동”이 선명한 구조 | marketing copy/style citeturn13search14 |
| Lazyweb | 실제 product flow 단위 benchmark | screenshot copy citeturn13search0turn13search7 |
| Oh My Design | coding agent에 지속 가능한 design contract를 넘기는 방식 | 현재 SRS hierarchy를 DESIGN.md로 대체 citeturn11search0 |

Beautiful UI에서 특히 참고 가치가 높은 것은 `Records Table`, `Filter Table`, `Task Rows`, `Insight Cards`입니다. Regression 화면을 “차트 dashboard”로만 만들지 않고 “state + evidence + record”의 조합으로 구성하는 근거가 됩니다. citeturn10search0

BeUI와 RareUI는 직접 install 대상으로 보면 안 됩니다. 현재 pr-search web package는 Next.js 16.3.1, React 19.2.8, Radix primitives, Lucide와 자체 CSS system을 사용하고 있으며 Tailwind나 Motion을 dependency로 사용하지 않습니다. BeUI는 Motion + Tailwind 기반이고 Rare UI도 shadcn CLI 중심이므로, UI 아이디어만 참고하고 stack을 흔들지 않는 것이 맞습니다. fileciteturn14file0 citeturn10search13turn11search1

shadcn도 마찬가지입니다. shadcn 자체가 open-code와 composition을 강조하는 시스템이므로, 이 경우에는 dependency를 가져오기보다 현재 Radix 기반 `ui` component layer에 같은 composition 원리를 적용하면 됩니다. citeturn12search7

### 기존 pr-search 색상을 유지

새 palette를 만들 필요가 없습니다.

현재 `ui.css`에는 이미 light/dark 양쪽에 canvas, raised, subtle, text, border, accent, success, warning, danger, running 및 20개의 dataviz series token까지 정의돼 있습니다. 예를 들어 dark theme은 canvas `#11151c`, raised `#191f29`, primary text `#e7edf6`, accent `#91b2ff`, success `#79d4ac`, warning `#efc879`, danger `#ffa0ad`를 이미 제공합니다. fileciteturn18file0

따라서 Regression 상태도 새 색을 만들지 않고 다음 mapping을 권합니다.

```text
PASS          --ui-status-success
FAIL          --ui-status-danger
RUNNING       --ui-status-running
INCONCLUSIVE  --ui-status-warning
SKIP          --ui-text-muted / surface-subtle
SELECTED      --ui-accent + focus ring
```

그리고 항상 색 + shape + text를 같이 씁니다.

```text
✓ PASS
× FAIL
◌ RUNNING
? INCONCLUSIVE
— SKIP
```

Realtime Colors는 palette가 실제 UI에서 어떻게 분배되는지 preview하는 도구이고, Coolors는 contrast checker와 real-design visualizer를 제공합니다. Paletton 역시 color combination, contrast, vision simulation을 지원하며, Khroma는 생성한 color pair의 WCAG rating을 제공합니다. Color Hunt는 curated palette inspiration에 적합합니다. 이번 프로젝트에서는 “새 색상을 고르는 용도”가 아니라 “기존 token이 timeline처럼 더 복잡한 surface에서도 충분히 읽히는가”를 검증하는 용도로 쓰는 편이 맞습니다. citeturn13search8turn13search2turn15search0turn15search1turn15search14

PRD도 제품 UI를 Radix 기반 component로 통일하고 light/dark 전환을 제공하도록 이미 정하고 있습니다. fileciteturn25file0

### Motion 원칙

현재 UI에는 `--ui-motion-fast: 140ms`, `--ui-motion-standard: 240ms` token도 이미 있습니다. 따라서 Regression에 별도 motion system을 만들지 않습니다. fileciteturn18file0

animation은 다음 세 군데에만 씁니다.

```text
Inspector open / close       240ms
Selected observation change  140ms
Bisect boundary update       240ms
Loading → content            subtle opacity
```

다음은 하지 않습니다.

```text
timeline point bouncing
animated counters
gradient blobs
continuous glow
scroll-linked effects
spring effect on PASS/FAIL
confetti
```

Transitions.dev도 기능적 state가 motion에 의존하지 않아야 하고 `prefers-reduced-motion`에서 movement를 끄는 방향을 명시합니다. 이 원칙을 그대로 적용하는 것이 좋습니다. citeturn12search1

### Component 조합

기존 stack에 가장 자연스러운 구조는 다음입니다.

```text
RegressionView
 ├─ RegressionContextBar
 │   ├─ SequenceSpaceSelector
 │   ├─ TestSourceSelect
 │   ├─ TestTypeSelect
 │   ├─ ScenarioFilter
 │   └─ DateRange
 │
 ├─ RegressionWindowSummary
 │
 ├─ RegressionTimeline
 │   ├─ IntegrationAxis
 │   ├─ ChangeMarkerLane
 │   ├─ ArtifactMarkerLane
 │   └─ TestObservationLane[]
 │
 ├─ SelectedFailureCard
 │
 ├─ SuspectChangeTable
 │
 ├─ RegressionBisectCard
 │
 └─ RegressionInspector
```

기존 `SequenceSpaceSelector`, range parsing/anchor logic과 bisect domain을 최대한 재사용합니다. `BisectPanel`의 data-fetch/state logic은 재사용할 수 있도록 분리하되, `/ranges`의 기존 동작을 깨지 않아야 합니다. 현재 `RangesView`가 `BisectPanel`을 직접 사용하고 있기 때문입니다. fileciteturn12file0L1-L2

아이콘도 Lucide를 화면에서 직접 난립시키지 말고 현재 `WorkbenchIcon` 중앙 mapping을 확장합니다. 이 컴포넌트가 Lucide 이름→제품 glyph mapping을 한 곳에서 관리하도록 이미 설계돼 있습니다. fileciteturn27file0

추천 신규 icon name은 예를 들어:

```text
regression → Activity 또는 GitCompareArrows 계열
test       → FlaskConical
pass       → CircleCheck
fail       → CircleX
```

다만 실제 추가 icon은 현재 사용 중인 `lucide-react` 버전에서 존재 여부를 확인한 뒤 결정해야 합니다.

## MDVP 연동 화면 상태와 데이터 계약

여기서는 UI와 integration contract를 의도적으로 분리해야 합니다.

현재 repo의 OD-012는 MDVP API, 인증, run ID, 누적/증분 결과, 실패 분류, service identity의 session 접근 계약이 아직 open입니다. OD-013 역시 MTBF의 통계 가정, 시험시간, stopping rule, confidence와 반복 비교 방식이 open입니다. 따라서 “MDVP에서 Run 버튼을 누르면 장비 시험을 시작한다” 같은 기능을 지금 UI contract에 확정하면 안 됩니다. fileciteturn25file0

현재 regression 계획 R7도 외부 result adapter를 범위로 하고 MDVP 내부 workflow/dispatch는 제외하고 있습니다. fileciteturn22file0

그래서 1차 UX는 다음 경계를 권합니다.

```text
pr-search owns
────────────────────────────
Regression session
Good / bad boundaries
Next candidate
Observation history
Artifact ↔ revision mapping
MDVP result normalization
Investigation UI

MDVP owns
────────────────────────────
Equipment scheduling
Field/lab execution
Test orchestration
Raw logs
Run lifecycle
Device control
```

pr-search에서 MDVP로 제공하는 action도 처음에는 다음 정도여야 합니다.

```text
Open in MDVP
Copy candidate
Open artifact
Copy full SHA
```

`Start MDVP Test` 같은 버튼은 OD-012에서 dispatch contract가 실제 승인된 이후에만 추가합니다.

### 정규화된 run 모델

UI를 안정적으로 만들려면 MDVP raw response를 바로 rendering하면 안 됩니다.

아래처럼 provider-independent한 observation model을 하나 두는 것을 권합니다.

```ts
type RegressionVerdict =
  | 'pass'
  | 'fail'
  | 'running'
  | 'inconclusive'
  | 'skip';

interface RegressionObservation {
  observationId: string;

  source: {
    provider: 'mdvp' | 'manual' | string;
    externalRunId: string | null;
    resultUri: string | null;
  };

  revision: {
    repository: string;
    baseBranch: string;
    seqEpoch: number;
    mergeSeq: number;
    commitSha: string;
    mNumber: string | null;
    pullRequestNumber: number | null;
  };

  test: {
    testType: string;
    suite: string | null;
    scenario: string;
    failureSignature: string | null;
  };

  environment: {
    product: string | null;
    variant: string | null;
    hwRevision: string | null;
    rfProfile: string | null;
    networkConfig: string | null;
    deviceGroup: string | null;
  };

  execution: {
    startedAt: string | null;
    endedAt: string | null;
    runtimeSeconds: number | null;
    failureCount: number | null;
  };

  verdict: RegressionVerdict;

  artifact: {
    artifactId: string;
    digest: string | null;
    availability: 'available' | 'missing' | 'expired';
  } | null;
}
```

이는 현재 CR-102 P2에서 이미 요구 후보로 제안된 failure signature, scenario, HW/RF/network environment, runtime, failure count, artifact/digest, run ID, result URI와 잘 맞습니다. fileciteturn22file0

여기에 UI 관점에서 한 가지를 더 분리하는 것이 좋습니다.

```ts
type BoundaryEffect =
  | 'advance_good'
  | 'shrink_bad'
  | 'none';
```

예를 들어:

```text
PASS
verdict = pass
boundaryEffect = advance_good

FAIL
verdict = fail
boundaryEffect = shrink_bad

INCONCLUSIVE
verdict = inconclusive
boundaryEffect = none

SKIP
verdict = skip
boundaryEffect = none
```

그러면 UI가 “시험 결과”와 “bisect state 변화”를 혼동하지 않습니다.

### MTBF는 PASS/FAIL badge 하나로 축약하지 않는다

MTBF에서는 특히 이 구분이 필요합니다.

현재 CR-102 계획은 zero-failure를 무조건 PASS로 바꾸지 않고, 모델/입력/신뢰수준/판정 근거를 보존하며, 조건이 부족하면 INCONCLUSIVE로 두는 방향입니다. OD-013 결정 전에는 자동 statistical verdict 적용도 차단합니다. fileciteturn22file0turn22file2

따라서 MTBF row는 다음처럼 설계합니다.

```text
MTBF / NR overnight

I-10550
INCONCLUSIVE

Exposure      42.5 device-hours
Failures      0
Target        100 device-hours
Decision      Insufficient exposure
Model         Not approved / manual
```

향후 모델 승인 뒤에는:

```text
Verdict       PASS
Confidence    95%
Exposure      128 device-hours
Failures      0
Model         MTBF-v3
```

처럼 확장합니다.

Buildkite가 flaky test를 단일 latest result로 숨기지 않고 test execution history와 reliability 상태를 별도로 관리하는 것도 같은 방향의 좋은 참고 사례입니다. citeturn14search1turn14search5

### 상태 모델

Regression UI는 최소 다음 상태를 명시적으로 가져야 합니다.

```text
NO_DATA
데이터가 아직 없음

READY
관측은 있으나 investigation session 없음

IN_PROGRESS
good / bad가 있고 탐색 진행 중

AWAITING_EVIDENCE
INCONCLUSIVE 등으로 추가 evidence 필요

AMBIGUOUS
testable 후보가 없거나 evidence가 충돌

CONVERGED
culprit boundary가 증명됨

EPOCH_STALE
sequence history가 변경됨

CONTRADICTION
good/bad evidence가 모순

MDVP_UNAVAILABLE
adapter 또는 provider 접근 불가

ARTIFACT_MISSING
revision은 있으나 시험 가능한 binary 없음
```

`EPOCH_STALE`, contradiction, ambiguous 같은 상태를 단순 toast로 끝내면 안 됩니다. 특히 현재 sequence model은 epoch를 통해 history rewrite를 명시적으로 무효화하고 있으므로, stale 상태에서는 mutation을 중지시키고 화면에 persistent banner를 보여야 합니다. 현재 Ranges/Bisect도 이미 epoch stale을 별도 상태로 다룹니다. fileciteturn12file0 fileciteturn13file0

### 실제 화면에서 가장 중요한 상태 전환

```text
FAIL run 선택
      │
      ▼
Suggested previous PASS
      │
      ├── 사용자가 거부 → 다른 PASS 선택
      │
      └── 사용자가 승인
               │
               ▼
       Regression window
               │
               ▼
          Start bisect
               │
               ▼
        Candidate I-10550
               │
       ┌───────┼──────────┬─────────┐
       ▼       ▼          ▼         ▼
     PASS     FAIL    INCONCLUSIVE  SKIP
       │       │          │         │
 good→50   bad→50      unchanged  unchanged
       │       │          │         │
       └───────┴──────────┴─────────┘
               │
               ▼
        calculate next
```

이 흐름이 화면의 principal interaction이어야 합니다.

## Claude 구현 지시서

현재 repository는 일반적인 “프롬프트 주면 바로 코드 생성” 프로젝트가 아니라 documentation-first 구조입니다. `CLAUDE.md`는 SRS → PRD → workflow/feature/glossary → IA/UI spec → architecture → delivery → agent brief 순으로 authority를 두고, 승인되지 않은 기능을 코드가 먼저 정의하지 못하도록 하고 있습니다. fileciteturn20file0

Oh My Design이 project-owned `DESIGN.md`를 통해 coding agent가 일관된 design contract를 유지하게 하는 접근은 좋은 아이디어지만, 이 repo에서는 별도 `DESIGN.md`를 새로운 authority로 만드는 것보다 기존 `docs/20_derived_ui_specs/`에 Regression screen contract를 넣는 것이 맞습니다. OmD의 핵심 아이디어만 차용하고 기존 문서 hierarchy를 유지해야 합니다. citeturn11search0

아래 내용을 그대로 Claude Code에 전달하는 것을 권합니다.

```text
pr-search repository에 Regression Workbench를 설계/반영한다.

반드시 먼저 CLAUDE.md와 현재 HEAD의 authoritative docs를 읽고,
현재 승인 상태와 next-free CR / FR / Screen / Component / Flow / API /
Entity / WP ID를 실제 repository에서 측정하라. ID를 추측하지 마라.

중요:
이 작업은 현재 Search 화면의 확장이 아니다.
Search와 별도의 Regression 메뉴 및 /regression 화면을 추가하기 위한
제품 변경이다.

현재 CR-102 regression proposal과
docs/40_delivery/pr_search_regression_implementation_plan.md를 기반으로 하되,
이번 요구사항은 기존 R5의 W-004-only entry보다 확장된 UI 요구다.

현재 SRS에 별도 Regression 화면이 승인되어 있지 않으면 먼저 CR을 등록하고
다음 cascade를 끝내라.

SRS
→ PRD
→ glossary / traceability matrix
→ product IA
→ wireframe / screen flow / state matrix / component spec
→ frontend/backend/API/data architecture
→ roadmap / validation / work package / ledger
→ implementation brief

baseline 승인은 사용자가 한다.
baseline 승인 전에는 application production behavior를 변경하지 마라.

제품 목표
=========

현재 Search 메뉴와 분리된 Regression Workbench를 만든다.

Regression 화면은 다음 질문에 답해야 한다.

1. 어떤 MDVP/Live/MTBF test가 실패했는가?
2. 실패가 어느 integration revision에서 관측됐는가?
3. 동일한 test context에서 마지막으로 신뢰 가능한 PASS는 어디인가?
4. PASS와 FAIL 사이에 어떤 PR/commit이 들어갔는가?
5. 현재 suspect interval은 얼마인가?
6. 다음에 시험해야 할 revision은 무엇인가?
7. 그 revision에 사용 가능한 artifact가 있는가?
8. 시험 결과가 PASS / FAIL / INCONCLUSIVE / SKIP 중 무엇인가?
9. 결과 반영 후 다음 candidate는 무엇인가?

식별자 규칙
===========

regression ordering의 canonical key는 현재 repository 계약의 merge_seq이다.

revision identity는 최소한:

repository
base_branch
seq_epoch
merge_seq
full commit SHA

를 함께 사용한다.

현재 M number를 canonical regression ordering으로 재해석하지 마라.
현재 M은 PR-linked auxiliary identifier이다.
direct push는 M/PR이 없어도 regression candidate에서 절대 누락하면 안 된다.

화면에서는 예를 들어 다음과 같이 병기한다.

I-10524
M-1900-548 · PR #548 · d71be10

팀이 M 자체를 Integration ID로 재정의하려면 별도 제품 계약 변경으로 취급한다.

Navigation
==========

기존 Search를 변경하지 말고 신규 route를 만든다.

권장:

/regression

현재 좌측 nav의 ANALYSIS section에 Regression entry를 추가한다.
초기 버전에서는 Regression 하나만을 위해 별도 VALIDATION section을 만들지 않는다.

권장 순서:

ANALYSIS
  Regression
  Range investigation
  Repositories
  Releases
  Analytics

기존 /ranges는 삭제하거나 redirect하지 않는다.
Range investigation은 generic range analysis로 유지하고,
Regression은 guided failure investigation 화면으로 구현한다.

UI language는 기존 제품 계약대로 English를 사용한다.

Screen structure
================

Regression page는 다음 순서로 구성한다.

1. Context Bar
2. Regression Window Summary
3. Regression Timeline
4. Selected Failure Context
5. Changes in Suspect Window
6. Bisect Session
7. Detail Inspector

Context Bar
===========

항상 보이는 필드:

Repository
Base branch
Test source
Test type
Scenario / failure signature
Date range
Apply

More filters:

Product / variant
HW revision
Device group
RF profile
Network configuration
Artifact availability
Verdict

조회 상태는 URL에 보존한다.
기존 RangesView의 URL-as-investigation-state 원칙을 재사용한다.

Regression Summary
==================

boundary가 있을 때 다음 정보를 한눈에 표시한다.

Known Good
Known Bad
Total suspect revisions
Testable revisions
Next candidate
Ideal estimated checks
Failure signature / test context

예:

Known Good       I-10521 PASS
Known Bad        I-10580 FAIL
Suspects         59 revisions
Testable         41
Next             I-10550
Estimated        ~6 ideal checks

estimated_steps를 실제 장비 시험시간 보장처럼 표시하지 마라.

Timeline
========

기본 x-axis는 Calendar가 아니라 Integration sequence이다.

toggle:

Integration | Calendar

Integration mode:
- test result를 discrete observation point로 표시한다.
- test가 없던 revision 사이를 continuous PASS/FAIL color로 채우지 않는다.
- untested revision이 PASS였다는 오해를 만들지 않는다.

Calendar mode:
- 실제 run timestamp를 기준으로 표시한다.

Timeline lane:

Integration markers
Artifact markers
Release markers
각 MDVP scenario/test lane

상태:

PASS
FAIL
RUNNING
INCONCLUSIVE
SKIP

색만 사용하지 말고 icon/shape/text를 함께 사용한다.

PASS          success token + check
FAIL          danger token + x
RUNNING       running/accent token + circle
INCONCLUSIVE  warning token + question/triangle
SKIP          muted token + dash

selected good/bad 사이 suspect interval은 background band로 표시한다.

특정 FAIL point를 클릭하면:
- selected run을 강조한다.
- 동일 failure signature / compatible test context에서 이전 PASS를 찾아
  "Suggested known good"으로 표시한다.
- 자동으로 good boundary로 확정하지 않는다.
- environment mismatch가 있으면 차이를 보여준다.
- 사용자가 Use as Known Good 또는 Choose another를 선택하게 한다.

Changes in Suspect Window
=========================

selected good/bad에 따라 즉시 range를 계산한다.

columns:

Integration
M number
PR
Commit SHA
Title
Area / labels
Artifact availability

default sort:
merge_seq ascending

filters:
All changes
PR only

default는 반드시 All changes다.
direct push를 숨기지 않는다.

PR/M이 없는 revision:
M number = —
PR = —
Commit과 Integration은 정상 표시한다.

row 선택 시 detail inspector를 연다.

Detail Inspector
================

Desktop에서는 360~420px docked right inspector.
공간이 좁으면 right Sheet.
375px에서는 bottom Sheet.

selected MDVP run:

Verdict
Integration
M number
PR
full SHA
test type
scenario
failure signature
environment
start/end/runtime
failure count
artifact
result history
result URI

actions:

Open PR
Open commit
Open artifact
Open in MDVP
Copy revision

MDVP execution dispatch는 현재 scope에 넣지 않는다.
OD-012에서 dispatch contract가 승인되기 전에는
"Run MDVP test" 같은 버튼을 만들지 마라.

Bisect
======

현재 BisectPanel/domain을 재사용/리팩터링한다.

기존 /ranges 동작을 깨지 마라.

새 workbench에서는 다음을 보여준다.

Known Good
Next Candidate
Known Bad
remaining revisions
testable remaining
ideal estimated checks
artifact availability

verdict:

PASS
FAIL
INCONCLUSIVE
SKIP

PASS:
good boundary advances

FAIL:
bad boundary shrinks

INCONCLUSIVE:
boundary unchanged
retest allowed

SKIP:
boundary unchanged
automatic candidate recommendation에서 제외
culprit interval 자체에서는 제거하지 않는다

모든 내부 candidate가 untestable/skip이면 false convergence를 만들지 말고
AMBIGUOUS state로 전환한다.

MDVP integration
================

MDVP raw DTO를 React component에서 직접 사용하지 않는다.

provider-independent normalized RegressionObservation model을 만든다.

필드 후보:

observation id
provider
external run id
result URI

repository
base branch
seq epoch
merge seq
commit SHA
M number nullable
PR number nullable

test type
suite
scenario
failure signature

product
variant
HW revision
RF profile
network config
device group

started at
ended at
runtime
failure count

verdict
artifact id/digest/availability

MDVP API/auth/run lifecycle 계약은 OD-012가 open이면
production implementation을 추측하지 말고 architecture/API proposal까지만 작성한다.

연동이 구성되지 않은 deployment에서는 fake data를 보여주지 말고
"MDVP integration is not configured" empty state를 사용한다.

MTBF
====

MTBF는 zero failures를 자동 PASS로 바꾸지 않는다.

OD-013과 statistical model이 승인되기 전:

RUNNING
INCONCLUSIVE
manual PASS/FAIL if explicitly recorded

만 표현한다.

향후 statistical verdict에는:

exposure
failure count
confidence
model version
decision reason

을 함께 표시할 수 있는 UI space를 확보한다.

Visual system
=============

새 design system을 도입하지 않는다.

현재 apps/web/app/ui.css의 token을 사용한다.

PASS          --ui-status-success
FAIL          --ui-status-danger
RUNNING       --ui-status-running
INCONCLUSIVE  --ui-status-warning
SKIP          muted/secondary

light/dark 둘 다 지원한다.

현재 Geist / Radix / Lucide / custom CSS architecture를 유지한다.
Tailwind, Framer Motion, shadcn package, BeUI/RareUI dependency를
Regression 하나를 위해 추가하지 않는다.

shadcn/Beautiful UI/BeUI/RareUI/Transitions.dev는
component composition 및 interaction reference로만 사용한다.

motion:

fast 140ms
standard 240ms

허용:
inspector reveal
selection change
boundary update
loading/content transition

금지:
decorative orbit
confetti
constant glow
bouncing test markers
scroll animation
excessive spring

prefers-reduced-motion을 지원한다.

Component proposal
==================

apps/web/app/regression/page.tsx

apps/web/components/regression/
  RegressionView.tsx
  RegressionContextBar.tsx
  RegressionWindowSummary.tsx
  RegressionTimeline.tsx
  RegressionObservationLane.tsx
  SelectedFailureCard.tsx
  SuspectChangeTable.tsx
  RegressionBisectCard.tsx
  RegressionInspector.tsx
  RegressionEmptyState.tsx

apps/web/lib/
  regression.ts
  regression-query.ts

필요 시:
apps/web/app/regression-workspace.css

기존 component 재사용 후보:

SequenceSpaceSelector
AnchorInput / sequence resolution logic
RangeResultTable의 model 일부
BisectPanel의 API/state logic
Badge
Banner
Button
Panel
Radix Dialog/Popover/Select/Tabs
WorkbenchIcon

WorkbenchIcon mapping은 중앙 집중 방식을 유지한다.
화면마다 lucide-react를 직접 import하지 않는다.

Responsive
==========

Desktop:
timeline + table 중심.

중간 width:
inspector를 Sheet로 전환.

375px:
desktop timeline을 축소해 억지로 보여주지 않는다.
Observation event list 중심으로 바꾼다.

모바일에서도 최소 다음이 가능해야 한다.

Known good/bad 확인
Next candidate 확인
Observation history 확인
PASS/FAIL/INCONCLUSIVE/SKIP 기록
Suspect change card 확인

Accessibility
=============

keyboard:
timeline observation에 focus 가능
Left/Right로 인접 observation 이동
Enter로 select
Escape로 inspector close

table row keyboard 접근 지원.

status를 색만으로 전달하지 않는다.

aria-live는:
bisect candidate update
remaining count update
MDVP result arrival

같은 상태 변화에 사용한다.

epoch stale / contradiction / MDVP unavailable은
toast가 아니라 persistent Banner로 표시한다.

Design acceptance criteria
==========================

다음을 Playwright/a11y test에 반영한다.

1. Regression이 Search와 별도 nav item이다.
2. /search 기존 동작은 변하지 않는다.
3. /ranges 기존 동작은 변하지 않는다.
4. FAIL MDVP run을 선택할 수 있다.
5. selected run의 Integration/M/PR/SHA를 확인할 수 있다.
6. previous PASS는 suggestion이며 자동 boundary 확정되지 않는다.
7. good/bad 확정 시 suspect change list가 sequence order로 표시된다.
8. direct push가 PR-only filter를 사용하지 않는 한 목록에서 사라지지 않는다.
9. Start bisect 후 next candidate가 표시된다.
10. PASS/FAIL만 boundary를 변경한다.
11. INCONCLUSIVE/SKIP은 boundary를 변경하지 않는다.
12. epoch stale이면 mutation이 차단된다.
13. MDVP 미구성이 fake data를 만들지 않는다.
14. 375px에서 핵심 조사 흐름을 수행할 수 있다.
15. light/dark 모두 contrast/a11y 검사를 통과한다.
16. prefers-reduced-motion에서 기능 손실이 없다.

최종 산출물
===========

baseline 승인 전:
- CR
- SRS/PRD 변경안
- IA
- detailed wireframe
- state matrix
- component spec
- API/data proposal
- work package / validation plan

baseline 승인 후:
- implementation
- unit/integration/e2e/a11y tests
- traceability ledger update
- build/test 결과

CLAUDE.md에 정의된 전체 검증 command를 따른다.
무관한 기존 동작이나 디자인을 재설계하지 않는다.
```

이 prompt에서 가장 중요한 부분은 “예쁜 Regression dashboard를 만들어라”가 아니라 “현재 pr-search가 이미 가진 sequence/bisect 정본 위에 test evidence를 얹어 investigation workspace를 만들어라”는 점입니다.

현재 `pr-search`가 가진 구조를 기준으로 보면 새 제품을 만드는 것이 아니라 이미 존재하는 세 조각을 결합하는 작업입니다.

```text
현재
──────────────────────────────────────────────────────────
merge_seq / epoch
        +
Range investigation
        +
Bisect session
        +
M / PR / SHA mapping


추가
──────────────────────────────────────────────────────────
MDVP observation adapter
        +
artifact availability
        +
test context / failure signature
        +
PASS / FAIL / INCONCLUSIVE / SKIP history


결과
──────────────────────────────────────────────────────────
Regression Workbench

FAIL 날짜/시험
      ↓
last known PASS
      ↓
suspect Integration interval
      ↓
PR / commit / artifact list
      ↓
next test candidate
      ↓
MDVP / manual evidence
      ↓
interval 축소
      ↓
culprit
```

이 구조라면 기존 Search page가 복잡해지지 않고, P4 사용자들이 익숙한 “PASS revision ↔ FAIL revision 사이를 좁힌다”는 mental model도 유지할 수 있습니다. 동시에 Git의 실제 first-parent history, direct push, epoch rewrite, MDVP의 불확실한 시험 결과까지 숨기지 않기 때문에 현재 pr-search의 핵심 데이터 모델과도 충돌하지 않습니다. 현재 CR-102 implementation plan의 `수동 관측 → SKIP/INCONCLUSIVE → artifact → Workbench → pilot → MDVP adapter → MTBF verdict` 순서와도 자연스럽게 맞물립니다. fileciteturn24file7