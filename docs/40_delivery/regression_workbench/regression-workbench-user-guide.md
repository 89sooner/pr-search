# Regression Workbench 사용자 가이드

이 문서는 PR Search의 Regression Workbench 화면을 구성 요소별로 설명합니다. 사용자가 특정 날짜의 MDVP 시험 실패를 선택하면, 마지막으로 비교 가능했던 PASS 이후부터 그 실패 지점까지 통합된 first-parent 변경 목록을 확인하고, 필요하면 원인 후보를 좁히는 bisect 조사를 진행할 수 있습니다.

같은 내용을 화면 예시와 함께 훑어보고 싶다면 같은 폴더의 `regression-workbench-user-guide.html`을 여십시오. 이 markdown 문서는 그 HTML 버전과 같은 근거로 작성한 텍스트 판입니다.

- 경로: `/regression`
- 화면 ID: `W-024`
- 요구사항: `FR-REG-001`
- 핵심 컴포넌트: `RegressionWorkbench`

## 먼저 확인해야 할 배포 상태

사내 환경에는 아직 실제 MDVP 어댑터가 연결되어 있지 않습니다. `WP-095`와 `CR-110` 기록에 따르면 메뉴와 경로 자체는 배포 설정과 무관하게 항상 열려 있고, 대신 데이터 제공자가 없을 때는 명시적인 미구성 상태를 보여주는 방식으로 정리되어 있습니다.

그래서 지금 `/regression`에 들어가면 화면 위쪽에 `MDVP NOT CONNECTED` 배너가 먼저 뜨고, 화면 아래쪽에는 실제 저장소의 기존 서버 bisect 세션을 이어갈 수 있는 카드 하나만 나타납니다. 이 문서가 소개하는 Atlas·Inbox·Pulse의 상세 화면은 서버 환경변수 `REGRESSION_FIXTURE_ENABLED=1`을 켰을 때만 시연용으로 나타나는 합성 데이터이며, 그때는 배너 문구도 `SYNTHETIC FIXTURE`로 바뀌어 실제 시험이 아님을 알려줍니다.

아래 화면 예시는 그 합성 fixture 데이터(저장소 `modem/sw`, 브랜치 `main`, epoch `1`)를 기준으로 삼았으며, 실제 MDVP 운영 데이터가 아닙니다.

## 조사 흐름 5단계

1. 특정 날짜의 MDVP 시험 결과 가운데 살펴볼 실패 하나를 고릅니다.
2. 그 실패가 어떤 리비전에서 나왔는지, 비교할 만한 이전 PASS가 있는지 근거를 확인합니다.
3. PASS와 FAIL 사이에 들어온 first-parent 변경 구간을 Integration Map과 변경 표에서 훑어봅니다.
4. 원인 후보를 좁혀야 한다면 Bisect 패널에서 다음 시험 대상을 확인하고, PASS·FAIL·Inconclusive·Skip 가운데 하나로 관측을 기록합니다.
5. 조사 결과를 내보내거나(Export) 세션을 보관(Archive)하고, 다음 조사로 넘어갑니다.

## 목차

- [0. 핵심 용어와 판정 기호](#0-핵심-용어와-판정-기호)
- [1. 진입 화면과 모드 배너](#1-진입-화면과-모드-배너)
- [2. 상단 헤더](#2-상단-헤더)
- [3. 범위 선택 바](#3-범위-선택-바)
- [4. 상태 표시줄과 안내 배너](#4-상태-표시줄과-안내-배너)
- [5. 조사 영역: Run 선택과 Integration Map](#5-조사-영역-run-선택과-integration-map)
- [6. Bisect 패널](#6-bisect-패널)
- [7. Evidence 패널](#7-evidence-패널)
- [8. 변경 내역 표](#8-변경-내역-표)
- [9. Inbox / Pulse 보기](#9-inbox--pulse-보기)
- [10. 대화상자 일곱 가지](#10-대화상자-일곱-가지)
- [11. MDVP 미연결 시 대안](#11-mdvp-미연결-시-대안)
- [12. URL 파라미터와 반응형](#12-url-파라미터와-반응형)
- [근거 자료](#근거-자료)

## 0. 핵심 용어와 판정 기호

화면 곳곳에서 반복되는 용어와 기호를 먼저 정리합니다. 이 표를 알아 두면 뒤이은 화면 설명을 훨씬 빠르게 읽을 수 있습니다.

| 용어 | 뜻 |
| --- | --- |
| MDVP | 실제 장비와 빌드로 시험을 수행하는 외부 live-test 환경입니다. |
| MTBF | MDVP 안에서 다루는 시험 유형 하나로, 평균 고장 간격을 측정하는 안정성 시험입니다. Regression·Field와 함께 세 가지 시험 유형을 이룹니다. |
| S-번호 (`merge_seq`) | 저장소·대상 브랜치마다 first-parent 이력을 처음부터 세어 매기는 정본 서수입니다. Direct push 커밋도 포함해서 셉니다. |
| M 번호 (`merge_number`) | S-번호에서 파생하는 표시용 번호로, PR 근거가 확정된 항목만 셉니다. Direct push는 M 번호를 받지 않고 `No M · S-<seq>`로 표시됩니다. |
| seq_epoch | 시퀀스가 속한 재채번 세대입니다. 대상 브랜치가 강제 푸시로 재작성되면 값이 올라가고, 이전 세대에서 기록한 판정은 잠깁니다. |
| 비교 가능한 PASS | 실패한 시험과 동일한 testcase·signature·hardware·environment·configuration·policy를 가지면서, 같은 공간(scope)에서 더 이른 시각에 완료된 PASS 시험입니다. Bisect의 시작 경계(good)로만 채택됩니다. |
| fixture 모드 | 명시적으로 켠 합성 데이터와 브라우저 로컬 판정 기록입니다. 실제 장비나 빌드를 실행하지 않습니다. |

**판정 기호**: 다섯 가지 판정은 화면 전체에서 같은 기호로 나타납니다. Skip과 Inconclusive는 색은 같고 기호로만 구분된다는 점에 유의해야 합니다.

| 기호 | 판정 |
| --- | --- |
| `✓` | PASS |
| `×` | FAIL |
| `Ⅱ` | Inconclusive |
| `↷` | Skip |
| `○` | Untested |

## 1. 진입 화면과 모드 배너

화면 맨 위, 다른 어떤 요소보다 먼저 `RegressionWorkbench`가 그리는 것은 방패 아이콘과 함께 나오는 모드 배너입니다. 이 배너 하나가 지금 보고 있는 화면이 합성 데모인지 실제 연동이 준비되지 않은 상태인지를 알려주므로, 다른 요소를 읽기 전에 반드시 먼저 확인해야 합니다.

> **화면 예시 · 모드 배너**
>
> | fixture 모드 | 미구성 상태 |
> | --- | --- |
> | 🛡 `SYNTHETIC FIXTURE`<br>Local investigation demo. No real MDVP, build, or equipment execution. | 🛡 `MDVP NOT CONNECTED`<br>Configure an approved data adapter to investigate real test results. |

1. 방패 아이콘: 두 상태 모두 경고성 정보임을 나타냅니다.
2. 굵은 라벨: 지금이 합성 데이터인지 미구성 상태인지 한눈에 구분하는 태그입니다.
3. 설명 문장: 이 배너 아래에서 무엇을 할 수 있고 무엇을 할 수 없는지 미리 알려줍니다.

이 화면은 기존 로그인 경계(`GuardedPage`) 안에 있으며, 별도 게이트 없이 Search와 동등하게 항상 메뉴에 노출됩니다. 로그인이 필요해 리다이렉트되더라도 지금 보고 있던 view·scope·run 조합은 `returnTo`로 그대로 보존됩니다.

## 2. 상단 헤더

배너 아래 헤더는 지금 보고 있는 보기(view)가 무엇인지 알려주고, 세 가지 보기를 오가는 전환 버튼과 조사 결과를 파일로 내려받는 `Export` 버튼을 함께 놓아 둡니다.

- eyebrow: `Regression / Integration intelligence`
- 제목(H1)은 보기에 따라 `Revision Atlas` / `Failure Inbox` / `Daily Pulse`로 바뀝니다.
- 부제: `Read the integration order. Follow the test evidence.`
- `Atlas` · `Inbox` · `Pulse` 전환 버튼: 같은 selection과 세션을 공유한 채 화면 구성만 바꿉니다.
- `Export` 버튼: 데이터나 선택된 run이 없으면 비활성화되며, 누르면 `regression-investigation.json` 파일을 내려받습니다.

`Export`로 받는 JSON에는 `data_classification: "SYNTHETIC_FIXTURE_ONLY"` 표시와 함께 현재 scope, 선택한 run, 비교 대상 PASS(baseline), 진행 중인 bisect 세션, 그리고 지금 구간의 변경 목록이 manifest 형태로 담깁니다.

## 3. 범위 선택 바

데이터를 불러온 뒤에만 나타나는 이 줄은 다섯 가지 조건과 지금 세대(epoch) 태그를 한 줄에 모아 둡니다.

| 항목 | 동작 |
| --- | --- |
| `Repository` | 지금 불러온 스냅숏의 저장소 하나만 사실상 선택 가능합니다. |
| `Branch` | 데이터의 브랜치 값과 함께 `release/26A`라는 예시 옵션을 항상 보여줍니다. 실제 브랜치 목록 API 연동 이전 단계라는 뜻입니다. |
| `Result date · KST` | MDVP 결과가 완료된 날짜로 필터링합니다. 리비전의 통합 날짜가 아닙니다. 바꾸면 선택된 run이 초기화됩니다. |
| `Test type` | `All test types` / `Regression` / `Field` / `MTBF` 가운데 고릅니다. 바꾸면 선택된 run이 초기화됩니다. |
| `Verdict` | `Needs investigation`(기본값) / `All results` / `FAIL` / `PASS` / `INCONCLUSIVE`. 표시만 걸러내는 로컬 필터입니다. |
| Epoch 태그 | 지금 조회 중인 시퀀스 세대를 보여줍니다. |

> Repository나 Branch를 바꿔서 지금 불러온 스냅숏의 공간과 달라지면, 화면은 새로 데이터를 불러오지 않고 곧바로 4절의 "이 시퀀스 공간에는 근거가 없습니다" 빈 상태로 전환됩니다. 서로 다른 브랜치·에폭의 번호를 같은 것으로 취급하지 않기 때문입니다.

## 4. 상태 표시줄과 안내 배너

fixture 모드에서만 보이는 상태 표시줄과, 근거 상태에 따라 나타나는 안내 배너를 정리합니다.

**Fixture 상태 표시줄** (fixture 모드에서만 노출)

1. 연결 상태 점: 정상이면 `ready` 색, 그 외에는 경고색으로 바뀝니다.
2. `Fixture snapshot · … KST`: 지금 불러온 합성 데이터가 언제 캡처됐는지 보여줍니다.
3. `Preview source state`: `ready`/`stale`/`offline`/`epoch_stale`/`permission`/`error`/`loading` 일곱 시나리오를 시연용으로 강제 전환하는 스위치입니다. 실제 서버 상태 조회가 아니라, 화면이 각 상태에서 어떻게 보이는지 검증·시연하기 위한 것입니다.
4. `Local request queue`: 로컬에 쌓인 시험 요청 목록을 여는 버튼입니다(10절).

**근거 상태별 안내 배너**

| 상태 | 화면 문구 | 의미 |
| --- | --- | --- |
| stale | `MDVP evidence is stale. Refresh the source before recording results.` | 근거가 오래되어 기록 전에 새로고침을 요구합니다. |
| offline | `MDVP is offline. Cached fixture evidence is read-only.` | 오프라인이면 캐시된 근거만 읽을 수 있고 기록은 막힙니다. |
| epoch_stale | `History epoch changed. Existing judgments are locked.` | 대상 브랜치의 세대가 바뀌어 기존 판정이 잠깁니다. |
| loading | `Loading investigation evidence…` | 데이터를 불러오는 중입니다. |
| permission | `Access to this evidence is unavailable` / `Your current repository scope does not allow this view.` | 접근 범위 밖의 데이터입니다. |
| error | `Unable to load evidence` / `The evidence source could not be reached.` | 근거를 불러오지 못했습니다. fixture 모드에서는 `Retry evidence` 버튼으로 다시 시도할 수 있습니다. |
| 결과 없음 (공간은 일치) | `No test results for these filters` / `Choose another result date or test type.` | 필터 조건에 맞는 시험이 없습니다. |
| 공간 불일치 | `No evidence in this sequence space` / `Main-branch numbers are never substituted for another branch or epoch.` | 저장소·브랜치·에폭이 지금 스냅숏과 다릅니다. |

화면 중앙의 실시간 안내 줄(`role="status"`)은 `Copied to clipboard.`, `Session archived. Its observations are preserved.`, `Added to local fixture queue. No external request was sent.`처럼 방금 수행한 동작의 결과를 짧게 알려줍니다. 브라우저가 Web Locks API를 지원하지 않으면 `This browser does not support safe cross-tab locking. Evidence is available, but local recording is read-only.` 안내가 함께 나타나고, 이후 모든 기록 버튼이 잠깁니다.

## 5. 조사 영역: Run 선택과 Integration Map

`Investigating` 선택창에서 조사할 MDVP 결과를 고르면, 그 아래로 근거 상태에 따른 안내와 first-parent 타임라인, 구간 요약이 순서대로 나타납니다.

`Investigating` select는 목록의 run을 `{id} · {title} · {status}` 형태로 보여줍니다. run을 고르면 검증 필터도 함께 조정됩니다. PASS를 고르면 `All results`로, 그 외에는 `Needs investigation`으로 돌아갑니다.

**근거 상태에 따른 안내**

| 상황 | 화면 문구 |
| --- | --- |
| 리비전 매핑 없음 (예: `MDVP-78436` "Unresolved binary · NR attach"는 seq가 아예 없어 이 상태를 재현합니다) | `Map this binary to a revision first` / `This run has no verified integration mapping. Dates and PR numbers cannot stand in for a full SHA. Range creation and bisect are disabled.` + 버튼 `Inspect unmapped evidence` |
| 매핑은 있으나 비교 가능한 PASS 없음 | `No comparable previous PASS` / `Another testcase, configuration, or environment cannot establish this baseline.` |
| MTBF Inconclusive (예: `MDVP-78376` "Overnight stability"는 384 device-hours·2 failures로 이 상태를 보여줍니다) | `More evidence is required` / `MTBF source verdict: INCONCLUSIVE. 384 device-hours and 2 failures do not authorize an automatic PASS/FAIL decision.` |

**Integration Map**: 맨 위 축은 시각이나 M 번호가 아니라 first-parent 순서 그 자체입니다. 그 아래 세 줄(lane)은 REGRESSION·FIELD·MTBF 각 시험 유형이 어느 리비전을 대상으로 완료됐는지 보여줍니다.

1. first-parent 점: 모양은 PR 유무(마름모 = direct push, 사각형 = PR 있음), 채움은 산출물 보관 여부(채워짐 = Available, 빗금 테두리만 = Not stored), 색은 판정 결과를 각각 나타냅니다. 세 정보가 한 점에 겹쳐 있습니다.
2. MDVP 결과 원: REGRESSION/FIELD/MTBF lane 위에서 `✓`·`×`·`Ⅱ` 기호로 판정을 보여줍니다. 지금 선택한 run은 더 크게, INCONCLUSIVE는 점선 테두리로 그려집니다.
3. 옅은 색 구간대: 지금 활성 구간 `(good, bad]`를 배경으로 표시합니다.
4. 점선 세로선과 라벨: 다음 시험 후보 위치를 가리킵니다. 세션을 아직 시작하지 않았으면 `PREVIEW`로, 시작한 뒤에는 `NEXT`로 바뀝니다.

그 밖에 `Focus interval`/`Full history` 전환 버튼과 1배~4배 확대(`−`/`+`) 버튼이 있고, 아래에 범례로 `✓ PASS` · `× FAIL` · `Ⅱ Inconclusive` · `○ Untested` · `◇ Direct push` · `◌ No binary` · **`┊ Next candidate`** 가 나열됩니다.

화살표 키(←/→)로 인접한 점(리비전 점과 run 점을 통틀어)에 초점을 옮기고, `Home`/`End`로 맨 앞·맨 뒤로 이동하며, `Enter`나 `Space`로 그 점의 상세를 엽니다. 화면에는 "Markers sit at the tested revision, not at the test completion time. Use arrow keys to move between points." 캡션이 그대로 나타납니다.

**구간 요약(Focus summary)**: 타임라인 바로 아래, 큰 글자로 지금 활성 구간을 요약합니다. eyebrow는 세션 진행 중이면 `Active suspect interval`, 아직 시작 전이면 `Suggested interval · confirm before bisect`입니다. 예시 데이터에서는 `M-10521 → M-10580`이자 내부로는 `(S-24001, S-24061]`이며, 59건의 PR과 1건의 direct push로 이루어진 총 60건입니다.

## 6. Bisect 패널

사이드 패널 위쪽, 302px 너비(Inbox 보기에서는 280px)로 고정된 자리입니다. 세션을 시작하지 않았으면 헤더가 `Bisect preview`로, 시작했으면 `Bisect session`으로 바뀌고 옆에는 항상 `LOCAL DEMO` 태그가 붙습니다.

매핑된 FAIL과 비교 가능한 PASS가 모두 없으면 패널 전체가 `A mapped FAIL and a compatible PASS are required. Inconclusive evidence cannot establish a FAIL boundary.` 문구만 보여줍니다.

세션을 시작하기 전에는 eyebrow가 `Canonical midpoint`이고, 기본(primary) 버튼 `Start bisect`(옆에 화살표 아이콘) 하나만 있습니다. 후보가 없으면 큰 글자는 경계 상태 문구(`First FAIL boundary candidate` / `Unresolved range`)로 바뀌고, 그 아래 mono 줄도 `Reproduction confirmation required` 또는 `No available test candidate; skipped changes remain suspects.`로 바뀝니다. 통계 세 개는 각각 구간 전체 개수, 시험 가능한 개수, `⌈log2(용의자 수)⌉`로 계산한 이상적 확인 횟수이며, 캡션 `Ideal checks exclude skips and test duration.`이 붙습니다.

예시 데이터의 세션 시작 직후 값: 구간 전체 60(suspects) · 시험 가능 55(testable) · 이상적 확인 약 6회. 다음 후보는 `M-10550`(`S-24031`)입니다.

**판정 규칙**

| 판정 | 동작 |
| --- | --- |
| `✓ PASS` | good을 후보 seq로 올립니다(하한 이동). |
| `× FAIL` | bad를 후보 seq로 내립니다(상한 이동). |
| `↷ Skip` (사유 필수) | 후보를 skipped 목록에 넣고 경계는 그대로 둔 채 다른 시험 대상을 다시 고릅니다. 원인 후보에서 제외되지는 않습니다. |
| `Ⅱ Inconclusive` (사유 필수) | 경계를 바꾸지 않고 같은 후보를 재시험 대기 상태로 남깁니다. `Awaiting evidence. The candidate and both boundaries are unchanged. Retest, or explicitly skip with a reason.` 안내가 함께 뜹니다. |

> **버튼이 잠기는 경우 (readonly)** — 다음 가운데 하나라도 해당하면 판정 버튼과 기록 관련 버튼이 모두 잠깁니다.
>
> 1. 근거 상태(health)가 `ready`가 아닐 때(stale/offline/epoch_stale)
> 2. 세션 저장소를 만들지 못했을 때
> 3. 저장된 기록을 읽지 못하는 오류가 있을 때
> 4. 지금 데이터 소스가 fixture가 아닐 때. 현재 배포에서는 실제 데이터로는 이 기록 기능 자체가 없습니다
> 5. 다른 기록을 쓰는 중일 때
> 6. 브라우저가 Web Locks API를 지원하지 않을 때. `This browser does not support safe cross-tab locking. Evidence is available, but local recording is read-only.` 안내가 함께 나타납니다

패널 하단 캡션 `Fixture verdicts never call the production bisect API.`는 항상 노출됩니다. `Archive session`을 누르면 `Session archived. Its observations are preserved.` 메시지가 뜨고 세션은 사라지지만, 기록은 archive 목록에 남아 `View preserved sessions`·`Observation history`에서 계속 볼 수 있습니다. `Review local test request` 버튼은 11절의 지역 큐 대화상자로 연결됩니다.

## 7. Evidence 패널

Bisect 패널 바로 아래, 같은 폭(302px, Inbox 보기에서는 280px) 안에서 지금 선택한 run의 근거를 요약합니다.

예시(run `MDVP-78421` "NR CA throughput drop"):

| 항목 | 값 |
| --- | --- |
| Selected evidence | `× FAIL` |
| Tested build | `M-10580` |
| Completed · KST | `2026-09-18 08:42` |
| Test type | `MDVP / Regression` |
| Environment | `RF-LAB-A / EVT3` |

정의 목록 네 줄은 각각 리비전 표시(`Tested build`, 매핑이 없으면 `Unmapped revision`), 완료 날짜·시각(`Completed · KST`), `MDVP / {유형}` 형식의 시험 유형, run의 환경(`Environment`)을 보여줍니다. MTBF일 때만 `{device-hours} device-hours · {failures} failures. Source verdict only; no inferred confidence.` 안내가 한 줄 더 붙습니다. `View test evidence`(옆에 chevron 아이콘)를 누르면 10절의 대화상자로 더 자세한 근거를 봅니다.

사이드 패널 맨 아래, 방패 아이콘과 함께 "Only a PASS from the same testcase, signature, hardware, environment, configuration and policy is comparable."라는 문장이 항상 붙어 있습니다. 비교 가능한 PASS의 조건을 반복해서 상기시키는 문구입니다.

## 8. 변경 내역 표

조사 영역 아래, 전체 폭을 쓰는 표가 지금 구간에 들어온 first-parent 변경을 한 줄씩 나열합니다. 제목은 `Changes in suspect window {건수}`이고 부제는 `Integrations to investigate, not confirmed causes.`입니다.

필터: 칩 `All changes` / `L1` / `PHY` / `RRC` / `RF` / `Direct push` / `No binary`, 검색창 placeholder `PR / M / S / SHA / manifest`, 정렬 전환 버튼 `Newest first ↕` / `Integration order ↕`.

열 구성과 예시 행(newest-first 기준, `(S-24001, S-24061]` 구간):

| M / sequence | PR / change | Area | Integrated · KST | Binary | Selected test |
| --- | --- | --- | --- | --- | --- |
| M-10580 (S-24061) | #643 NR CA grant scheduling correction — `2e477d0c000a` · J. Kim | L1 | 09-18 02:00 | ◇ Available | `× FAIL` |
| M-10550 (S-24031) ← 다음 후보 | #544 Uplink power headroom calculation — `46c1fcb6028d` · J. Kim | PHY | 09-17 06:00 | ◇ Available | `○ Untested` |
| No M (S-24018) | ◇ Direct push — Emergency scheduler recovery flag — `bfb18beaeaf1` · Integration Ops | L1 | 09-16 21:20 | ◇ Available | `○ Untested` |

가운데 강조된 행은 다음 시험 후보(next candidate)이며 실제 화면에서는 배경색으로 표시됩니다. 칩이나 검색어를 쓰면 `Display filter only. The canonical interval and midpoint are unchanged.` 안내가 뜹니다. 즉 이 필터는 화면에 보이는 줄만 줄일 뿐, bisect가 계산하는 구간이나 다음 후보에는 영향을 주지 않습니다.

> `◇` 기호는 두 열에서 서로 다른 뜻으로 쓰입니다. `PR / change` 열의 `◇ Direct push`는 연결된 PR이 없다는 뜻이고, `Binary` 열의 `◇ Available`은 빌드 산출물이 보관되어 있다는 뜻입니다. 두 열을 함께 봐야 정확히 해석할 수 있습니다. 산출물이 없으면 `◌ Not stored`로 바뀝니다.

표를 채우지 못하면 `No matching changes` / `Clear the display filters to see the full suspect interval.` 빈 상태와 `Clear filters` 버튼이 나타납니다. 하단에는 `{표시 중} displayed / {전체} canonical changes`와 8줄 단위 페이지 버튼(←/→)이 있습니다.

## 9. Inbox / Pulse 보기

Atlas가 기본 보기입니다. 헤더의 보기 전환에서 Inbox나 Pulse를 고르면 같은 selection과 세션을 공유하면서 화면 구성만 달라집니다.

**Failure Inbox**: 조사 영역 왼쪽에 `MDVP results` + 개수 배지를 단 카드 목록이 추가로 붙습니다. 카드마다 판정 배지, run 제목, mono id, `{유형} · {시각} KST` 소문구가 있습니다. 카드를 고르면 그 run으로 조사 영역이 바뀝니다. 화면이 좁아지면(900px 이하) 이 목록은 세로 목록에서 가로로 스크롤하는 카드 줄로 바뀝니다.

**Daily Pulse**: 헤더 바로 아래 `MDVP test calendar` 패널이 추가됩니다. 부제 `Result completion date × test type · not an integration axis`가 알려주듯 가로축은 completion 날짜이지 통합 순서가 아닙니다. Regression·Field·MTBF 세 행과 날짜별 열로 이루어진 표에서 각 칸은 그날 그 유형의 결과 개수를 판정 기호와 함께 보여주고, 칸을 누르면 그 날짜·유형으로 조사 영역이 이동합니다. 결과가 없는 칸은 `—`로 표시됩니다.

## 10. 대화상자 일곱 가지

화면 곳곳의 버튼은 Radix Dialog로 만든 대화상자를 엽니다. 일곱 가지 모두 `Escape`로 닫히고 닫으면 원래 눌렀던 요소로 초점이 돌아오며, "Synthetic fixture only. No external test or build is executed."라는 설명 문구를 공통으로 달고 있습니다.

<details>
<summary><b>Integration detail</b> — 변경 표의 행이나 타임라인의 점을 누르면 열립니다</summary>

정본 리비전 표기, 전체 SHA(옆에 `Copy SHA` 버튼), PR 연결 여부, 작성자·통합 시각, 변경 파일과 추가·삭제 줄 수, 빌드와 보관 여부, 정확한 산출물 digest(없으면 `Unavailable — revision remains a suspect.`)를 보여줍니다. 기본 동작: `Download fixture manifest`.
</details>

<details>
<summary><b>MDVP test evidence</b> — Evidence 패널의 View test evidence 버튼</summary>

run id·완료 시각, 리비전 매핑(없으면 `Unmapped — investigation locked`), testcase·signature·hardware·environment·configuration·policy 여섯 항목을 각각 한 줄씩, 노출 시간·failures, 비교 가능한 PASS를 보여줍니다. 안내: `Source-provided verdict. No confidence interval or automatic MTBF qualification is inferred.`
</details>

<details>
<summary><b>Confirm comparable baseline</b> — Start bisect 버튼</summary>

PASS·FAIL 두 리비전을 나란히 보여주고, "Same testcase, failure signature, hardware, environment, configuration and policy:" 문장과 함께 context 전체를 JSON으로 펼칩니다. 기본 동작: `Use this PASS and start`.
</details>

<details>
<summary><b>Record an uncertain observation</b> — Skip 또는 Inconclusive 버튼</summary>

사유(`Reason (required)`) 입력창이 있으며 최대 1000자까지 받습니다. 사유를 채우기 전에는 기본 동작 버튼이 비활성 상태입니다. 기본 동작: `Record skip` 또는 `Record inconclusive`.
</details>

<details>
<summary><b>Review local test request</b> — Review local test request 버튼</summary>

`This adds a request to this browser only. It does not dispatch to MDVP.` 안내와 함께, 다음 후보의 리비전과 context를 JSON으로 미리 보여줍니다. 기본 동작: `Add to local queue`.
</details>

<details>
<summary><b>Local request queue</b> — 상태 표시줄의 Local request queue 버튼</summary>

지금까지 로컬에 쌓인 요청을 `{runId} · S-{seq}` + `LOCAL ONLY` 태그 + digest로 나열합니다. 비어 있으면 `No local requests.`입니다.
</details>

<details>
<summary><b>Preserved observation history</b> — Observation history 또는 View preserved sessions 버튼</summary>

지금 세션과 이미 보관(archive)한 세션을 각각 묶어서, 관측마다 `S-{seq}` · 시각 · 판정 배지 · 사유(없으면 `Manual fixture verdict`)를 나열합니다. 기록이 없으면 `No observations recorded.` 또는 `No preserved observations yet.`입니다.
</details>

## 11. MDVP 미연결 시 대안

데이터 소스가 fixture가 아니면(지금 사내 배포의 기본값), Regression Workbench 맨 아래에 `Continue an existing server bisect` 카드가 항상 나타납니다. fixture 시연 경로와 완전히 분리되어 있고, 실제로 입력한 저장소·브랜치만을 대상으로 합니다.

안내 문구: `The existing authenticated API restores your saved boundaries and supports Good / Bad only. It does not provide MDVP runs or an observation archive.`

폼: `Real repository`(placeholder `owner/repository`) · `Base branch`(기본값 `main`) · 버튼 `Load saved session`.

> **새 bisect는 이 카드에서 시작할 수 없습니다.** 안쪽 Bisect 패널의 `Start bisect in this range` 버튼은 이 진입 경로에서 구간(range) 값을 받지 못하므로 항상 비활성 상태입니다. 이미 Ranges 화면 같은 다른 경로에서 시작해 서버에 저장해 둔 세션을 불러와 이어가는 용도입니다.

세션을 불러오면 `Candidate range ({good}, {bad}] · Epoch {epoch}`와 `Remaining candidates: {n} · Estimated remaining checks: {n}`이 나타납니다. 수렴했으면 `Bisect complete — seq: {seq}`와 연결된 PR·commit 링크가, 다음 후보가 있으면 `Next commit to test: seq: {seq}`와 `Good`·`Bad` 두 버튼만 나타납니다. `Reset bisect` 버튼은 항상 있습니다. 세대가 바뀌었으면 `Bisect epoch is stale` 경고와 `Reset the saved bisect, then reload the range using the current epoch.` 안내가 뜹니다.

## 12. URL 파라미터와 반응형

| 파라미터 | 뜻 |
| --- | --- |
| `view` | `atlas`/`inbox`/`pulse` |
| `repo` · `branch` · `epoch` | 조사 공간(scope)을 이루는 세 값 |
| `run` | 선택된 MDVP 결과 id |
| `date` | 결과 완료 날짜(Result date · KST) |
| `type` | `all`/`Regression`/`Field`/`MTBF` |

예: `/regression?view=atlas&repo=modem%2Fsw&branch=main&epoch=1&run=MDVP-78421&date=2026-09-18&type=all`. 이 값들을 담은 링크를 공유하면 같은 조사 화면으로 곧바로 돌아올 수 있습니다. 상태 필터(Verdict)·표시 필터(영역·검색)·확대 배율·페이지 위치는 URL에 담기지 않는 로컬 UI 상태입니다.

**반응형**

| 너비 | 변화 |
| --- | --- |
| ~1180px | Inbox 보기의 사이드 폭이 줄고, 표시 필터 도구가 세로로 쌓이며 검색창이 전체 폭을 씁니다. |
| ~900px | 사이드 패널이 고정(sticky) 배치를 멈추고 내부가 두 칸으로 바뀝니다. Inbox 카드 목록은 가로 스크롤 줄로 바뀝니다. 다만 이 폭에서는 조사 영역·변경 표만 한 열로 좁아질 뿐, 사이드 패널은 아직 오른쪽에 남아 있을 수 있습니다. |
| ~760px | 조사 영역·사이드 패널·변경 표가 완전히 한 열로 쌓입니다. 순서는 DOM 순서 그대로 조사 영역 → Bisect·Evidence 패널 → 변경 표입니다. 헤더·범위 선택 바도 세로로 쌓이고, 대화상자는 화면 아래에서 올라오는 시트(sheet)로 바뀌며, Integration Map 높이가 줄어듭니다. |

모든 폭에서 reduced-motion 설정을 존중해 애니메이션과 전환 효과를 끕니다.

## 근거 자료

이 문서의 모든 화면 문구와 동작 설명은 아래 소스 코드와 설계 문서를 실제로 읽고 확인한 내용입니다. 코드가 바뀌면 이 문서도 함께 다시 확인해야 합니다.

- **구현**: `apps/web/app/regression/page.tsx` · `apps/web/components/regression/{RegressionWorkbench,RegressionTimeline,ExistingBisectSession}.tsx` · `apps/web/components/BisectPanel.tsx` · `apps/web/lib/regression/{model,source,flags,query,atlas-fixture.json}` · `apps/web/app/regression-workspace.css` · `apps/web/a11y/regression.test.tsx`
- **요구사항·설계**: `docs/10_requirements/{srs_final,glossary,requirements_screen_traceability_matrix}.md` · `docs/20_derived_ui_specs/{pr_search_product_ia,pr_search_wireframe_spec,pr_search_screen_state_matrix,pr_search_ui_component_spec}.md`
- **전달·이력**: `docs/40_delivery/pr_search_work_packages.md`(WP-095) · `docs/40_delivery/pr_search_implementation_traceability.md` · `docs/00_governance/change_control.md`(CR-109, CR-110) · `docs/40_delivery/regression_workbench/UIUX/CLAUDE_REGRESSION_UI_BRIEF.md`
