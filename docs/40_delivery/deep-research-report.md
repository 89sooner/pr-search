# pr-search에 P4식 Regression Search를 반영하는 개발 검토

## 결론

2026년 9월 17일 기준 `89sooner/pr-search`의 현재 `main`을 확인한 결과, 팀장님이 제안한 방향은 “앞으로 새로 설계해야 할 아이디어”라기보다 이미 상당 부분 저장소의 핵심 아키텍처와 코드에 반영되어 있습니다. README 자체가 이 제품의 목적을 “커밋 SHA ↔ PR 양방향 검색”과 “Perforce Changelist를 대체하는 머지 시퀀스”라고 정의하고 있고, 구현 브리프는 시퀀스를 CI 이벤트 카운터가 아니라 `git rev-list --first-parent --reverse <branch>`로부터 도출하도록 명시합니다. PostgreSQL이 정본이고 Elasticsearch는 재생성 가능한 조회용 파생 뷰라는 원칙도 이미 잡혀 있습니다. fileciteturn3file0L1-L2 fileciteturn4file0L1-L2

더 중요한 점은 이분 탐색도 이미 `WP-042`로 구현 완료된 상태라는 것입니다. 현재 API는 사용자별 bisect session을 저장하고, `good`/`bad`를 기록하면 다음 중간 후보를 계산하며, contradiction, sequence epoch 변경, direct-push commit, 동시 mark 같은 경계 조건까지 통합 테스트하고 있습니다. 로드맵에는 `WP-042`가 2026년 9월 9일 완료되었다고 기록되어 있습니다. fileciteturn10file1L29-L36 fileciteturn7file0L1-L2

따라서 제가 권고하는 방향은 “CI에서 또 하나의 독립적인 counter를 새로 만드는 것”이 아닙니다. 현재의 graph-derived `merge_seq`를 regression의 canonical revision으로 확정하고, 그 위에 사람이 보기 좋은 Integration ID, artifact, 장비 시험 결과, `SKIP/INCONCLUSIVE`, MTBF 판정 계층을 얹는 것이 가장 안전합니다. GitHub Actions의 `GITHUB_RUN_NUMBER`는 저장소 전체 통합 순서가 아니라 “특정 workflow의 실행 횟수”이므로 P4 CL 대용으로 사용하기에도 적합하지 않습니다. citeturn1search9

특히 하나는 지금 정리해야 합니다. 현재 pr-search에는 서로 다른 개념이 있습니다.

| 개념 | 현재 의미 | Regression 기준으로 적합한가 |
|---|---|---|
| PR `#548` | 리뷰/개발 단위 | 아니오 |
| `commit_sha` | 정확한 Git revision | 예, 다만 사람이 읽기 어려움 |
| `merge_seq` | `(repository, base_branch)`의 first-parent commit 순서. direct push도 포함 | 가장 적합 |
| 현재 `M number` / `merge_number` | `merge_seq` 중 PR이 연결된 항목만 다시 조밀하게 센 번호 | 보조 식별자에는 좋지만 canonical regression key로는 부적합 |
| Artifact ID | 현재 요구사항에 필요한 실행 바이너리 식별 | 명시적 확장이 필요 |

현재 용어집은 `merge_seq`가 first-parent의 모든 커밋을 세고 direct push도 포함한다고 정의하는 반면, `M number`는 PR이 연결된 항목만 별도로 센다고 구분합니다. SRS도 direct push는 M 번호를 받거나 소비하지 않는다고 명시합니다. fileciteturn17file2L43-L51 fileciteturn17file3L63-L70

즉 팀장님의 예시에서 말하는

```text
M-10521 PASS
M-10580 FAIL
→ M-10550 test
```

의 `M-10521`에 가장 가까운 현재 pr-search 내부 개념은 사실 `merge_number`가 아니라 `merge_seq`입니다.

이 차이를 먼저 바로잡아야 이후 UI와 artifact 체계가 깔끔해집니다.

## 현재 pr-search와 요구사항의 일치도

pr-search의 현 설계는 팀장님이 말한 “PR 번호를 regression 순서로 쓰지 말자”는 방향과 매우 잘 맞습니다. 구현 브리프는 시퀀스의 정본을 webhook 도착 순서가 아닌 Git first-parent history로 두며, 시퀀스 값은 항상 sequence space와 epoch를 함께 다루도록 요구합니다. 웹훅 순서 counter를 금지하는 이유도 “언제든 실제 Git과 대조 검증할 수 있어야 하기 때문”입니다. fileciteturn4file0L1-L2

이 결정은 Git의 성질에도 맞습니다. GitHub의 squash merge는 PR의 여러 커밋을 하나의 commit으로 합쳐 base branch에 반영하므로, “PR 하나 = main의 논리적 integration commit 하나”라는 모델을 만들기에 적합합니다. 반대로 rebase-and-merge는 PR 내부 커밋들을 각각 base에 다시 작성하므로 regression용 integration 단위를 PR과 1:1로 보려는 환경에는 덜 적합합니다. citeturn1search1turn1search7

Git 자체도 regression을 위해 `git bisect`를 제공하며, 알려진 good commit과 bad commit 사이에서 중간 commit을 선택하고 결과에 따라 범위를 반복적으로 절반 가까이 줄입니다. 테스트 자동화는 필수가 아닙니다. 사람이 장비를 돌리고 결과를 본 뒤 `git bisect good` 또는 `git bisect bad`를 입력해도 됩니다. 테스트가 불가능한 revision에는 `git bisect skip`도 사용할 수 있습니다. citeturn0search0turn0search1

또 Git은 `git bisect --first-parent`도 직접 지원합니다. merge가 regression을 유입한 경우 first-parent만 따라가며 merge 지점을 찾도록 할 수 있어서, “integration history를 중심으로 regression을 찾는다”는 현재 pr-search의 모델과 방향이 같습니다. citeturn0search0

P4와 비교해도 개념적으로 맞습니다. Perforce의 submitted changelist 번호는 시간에 따라 증가하는 ordinal이지만 반드시 연속적일 필요는 없습니다. 즉 P4의 중요한 UX는 “숫자가 빈틈없이 증가한다”기보다 “제출된 integration의 시간 순서를 사람이 즉시 이해할 수 있는 증가 숫자로 표현한다”는 데 있습니다. citeturn2search2turn2search9

현재 구현 상태를 요구사항별로 평가하면 다음과 같습니다.

| 팀장 요구 | 현재 pr-search | 판단 |
|---|---|---|
| PR 번호가 아닌 main/release history 기준 | first-parent `merge_seq` | 이미 구현 |
| P4 CL 같은 인간 친화적 순서 번호 | `merge_seq` + 별도 `M number` | 구현됐으나 이름/용도가 혼동 가능 |
| SHA ↔ PR 매핑 | 제품의 핵심 기능으로 정의 | 이미 구현 |
| PASS/FAIL binary search | `API-SEQ-005`, `bisect_session` | 이미 구현 |
| 다음 midpoint 자동 제시 | `remaining`, `estimated_steps`, `next` | 이미 구현 |
| 장비 시험을 사람이 수행 | 실제 build/test는 외부로 둔 설계 | 현재 구조와 잘 맞음 |
| test 불가능 revision skip | 현재 API는 `good|bad` 중심 | 보완 필요 |
| Binary artifact ↔ sequence 추적 | sequence 모델에는 직접 포함되지 않음 | 확장 필요 |
| MTBF 같은 확률적 verdict | 현재 good/bad 모델로는 부족 | 확장 필요 |
| MDVP 연계 | 공개/저장소 자료에서 확인 불가 | 사내 adapter 필요 |

현재 제품 요구사항에서도 bisect 기능은 “good/bad 표시에 따라 다음 후보 중앙값을 제시”하는 기능이고 실제 build/test 실행은 범위 밖으로 정의돼 있습니다. 이는 오히려 modem 장비/field test 환경과 잘 맞는 분리입니다. fileciteturn15file1L14-L24

API도 이미 서버 측 상태를 갖습니다. 현재 계약은 `GET /bisect-sessions`로 개인 세션을 복구하고, `POST`의 `start`로 범위를 생성하며, `mark`에서 `good`이면 lower bound를 올리고 `bad`이면 upper bound를 내리는 구조입니다. fileciteturn20file1L12-L23

통합 테스트에는 sparse sequence `[1, 2, 5, 8, 9]`에서 `1 good / 9 bad → 5 → 2 → culprit 5`로 좁혀지는 경우, 사용자 간 세션 격리, contradiction 409, epoch stale, PR이 없는 direct-push commit으로의 수렴, concurrent mark가 범위를 다시 넓히지 않는 것까지 들어가 있습니다. fileciteturn7file0L1-L2

UI 설계도 이미 `idle`, `loading`, `in_progress`, `converged`, `bisect_contradiction`, `epoch_stale` 등의 상태와 `remaining`, `estimated_steps`, `next` 표시를 정의합니다. 따라서 핵심 engine을 다시 만드는 것보다 실제 modem regression workflow에 맞게 이 기능을 전면에 드러내는 작업이 더 중요합니다. fileciteturn20file0L3-L10

## 식별자 모델은 이렇게 정리하는 것이 좋다

현재 저장소에서 가장 중요한 설계 판단은 `merge_seq`와 `M number`를 혼동하지 않는 것입니다.

현재 `merge_seq`는 Git history를 나타냅니다.

```text
repo = modem/sw
branch = main
epoch = 1

merge_seq   SHA        PR
--------------------------------
10521       a91bc21    #521
10522       b12de43    #535
10523       c81fa22    -
10524       d71be10    #548
10525       e29cd11    #530
```

여기서 `c81fa22`가 emergency direct push라고 해도 `merge_seq=10523`은 존재합니다. 이 성질이 regression에는 매우 중요합니다. 실제 main 상태가 바뀌었기 때문입니다. pr-search 용어집도 `merge_seq`가 direct push를 포함한다고 정의합니다. fileciteturn17file2L43-L51

반면 현재 `M number`는 다음처럼 될 수 있습니다.

```text
merge_seq   M number   SHA        PR
----------------------------------------
10521       M-8121     a91bc21    #521
10522       M-8122     b12de43    #535
10523       -          c81fa22    direct push
10524       M-8123     d71be10    #548
10525       M-8124     e29cd11    #530
```

실제로 현재 release validation plan은 direct push가 M number를 받지도, 번호를 소비하지도 않아야 한다고 검증합니다. fileciteturn17file0L1-L12

이것은 PR 목록에서 “몇 번째 PR integration인가”를 보여주는 데는 좋은 번호입니다. 그러나 regression 기준으로 쓰면 좋지 않습니다. direct push가 장애를 만들었는데 M 번호 공간에는 그 revision 자체가 없을 수 있기 때문입니다.

따라서 권고안은 다음과 같습니다.

```text
개발/리뷰              PR #548
정확한 revision        d71be10...
Regression revision    main / E1 / S-10524
PR 친화 번호           M-8123      (필요하다면 유지)
Binary                 SMP1900-main-E1-S10524-d71be10.bin
```

사용자들이 P4식으로 `M-10524`라는 이름을 반드시 원한다면 두 가지 방법이 있는데, 저는 첫 번째를 권합니다.

첫째, 현재 `merge_seq`에 사람이 읽을 수 있는 display prefix만 씌웁니다.

```text
Integration Seq: I-10524
또는
Regression Seq: R-10524
```

DB에는 기존 `merge_seq=10524` 그대로 저장합니다. 새 counter가 없습니다.

둘째, 조직에서 `M`이라는 글자가 반드시 P4 CL 역할을 의미해야 한다면, 현재 PR-only `M number`의 이름을 바꾸고 `M-10524`를 `merge_seq`의 presentation으로 재정의할 수 있습니다. 다만 현재 SRS와 데이터 모델에서 M number의 의미가 이미 명확하게 정의되어 있으므로 이는 단순 UI 변경이 아니라 CR을 통해 요구사항/ADR/API/UI 계약을 함께 바꿔야 하는 변경입니다. 현재 `merge_number` 저장과 checkpoint인 `mnumber_head_seq`/`mnumber_head`도 별도로 존재합니다. fileciteturn18file10L163-L174

저라면 후자를 하지 않고 아래처럼 명칭을 명확히 분리합니다.

```text
PR #548
M-8123       ← PR integration ordinal
I-10524      ← actual integration / regression ordinal
d71be10      ← Git truth
```

그리고 Regression 화면에서는 M 번호보다 I 번호를 앞에 둡니다.

또 `(repository, branch)`를 반드시 표시해야 합니다. 현재 pr-search가 sequence space를 `(repository, base_branch)` 단위로 둔 것은 맞는 결정입니다. `main:I-10524`와 `release/26A:I-10524`는 같은 revision 번호가 아니기 때문입니다. 실행 브리프도 시퀀스 값을 `seq_epoch`, `sequence_space` 없이 단독 저장·전달·표시하는 것을 금지합니다. fileciteturn4file0L1-L2

실제 UI 표기는 다음 정도가 적당합니다.

```text
modem/sw · main · E1 · I-10524
PR #548 · d71be10
```

history rewrite도 이 모델에서는 처리할 수 있습니다. Git history가 바뀌면 이전 ordinal의 의미가 변할 수 있으므로 pr-search는 epoch를 올리고 기존 값의 stale 여부를 표현하도록 이미 설계되어 있습니다. 이것은 P4 CL과 Git sequence 사이의 본질적인 차이를 제대로 처리한 부분입니다. fileciteturn4file0L1-L2

## Regression Workbench로 발전시키는 것이 핵심이다

현재 bisect backend를 다시 구현할 필요는 없습니다. `W-004` 계열의 range investigation과 현재 bisect 기능을 “Regression Workbench”로 강화하는 쪽이 효과가 큽니다.

제가 추천하는 최종 화면은 다음과 같습니다.

```text
Regression Search
Repository   modem/sw
Branch       main
Sequence     E1

Known PASS   I-10521   a91bc21   #521   build available
Known FAIL   I-10580   72fd110   #601   build available

Candidate    I-10550   91c7aae   #570
Artifact     SMP1900-main-E1-S10550-91c7aae.bin

[ PASS ] [ FAIL ] [ INCONCLUSIVE ] [ SKIP ]

Remaining candidates: 29
Estimated tests: 5

Timeline
PASS                                          FAIL
10521 ├──────────────●──────────────┤ 10580
                    10550
```

현재 컴포넌트 계약 자체가 `remaining`, `estimated_steps`, `next`를 정본으로 사용하기 때문에 이 형태로의 발전은 기존 설계와 충돌하지 않습니다. fileciteturn20file0L3-L10

여기에서 가장 먼저 추가할 기능은 `SKIP`과 `INCONCLUSIVE`입니다. Git 자체는 test할 수 없는 revision을 `git bisect skip`으로 처리할 수 있고, 여러 revision을 skip할 수도 있습니다. 다만 culprit 바로 주변을 skip하면 Git도 최초 bad revision을 단일 commit으로 특정하지 못할 수 있다고 명시합니다. citeturn0search0

현재 pr-search API 계약은 `verdict: "good" | "bad"`이므로 이 부분이 실제 장비 환경과 비교했을 때 가장 분명한 기능 gap입니다. fileciteturn20file1L12-L23

단, `SKIP`과 `INCONCLUSIVE`는 의미가 달라야 합니다.

| 결과 | 의미 | 탐색 범위 |
|---|---|---|
| PASS | 이 revision에서는 대상 regression이 없음 | lower bound를 올림 |
| FAIL | 대상 regression이 재현됨 | upper bound를 내림 |
| SKIP | build 불가, binary 없음, 장비 호환 불가 등 test 자체 불가능 | bound를 움직이지 않고 다른 후보 선택 |
| INCONCLUSIVE | 시험했지만 통계/환경상 판정 불가 | bound를 움직이지 않고 재시험 가능 상태로 유지 |

현재처럼 `bisect_session`에 good/bad boundary만 두고 끝내기보다는 observation을 별도 저장하는 것이 좋습니다.

```text
regression_observation
----------------------
session_id
merge_seq
commit_sha
artifact_id
verdict             PASS | FAIL | SKIP | INCONCLUSIVE
failure_signature
test_type
device_id
environment_id
started_at
ended_at
runtime_seconds
failure_count
operator
note
result_uri
```

이렇게 해야 “어느 빌드를 어느 장비에서 누가 얼마나 오래 돌렸고 어떤 실패를 봤는가”가 남습니다.

특히 binary regression에서는 commit보다 “testable artifact”가 더 현실적인 후보 집합일 수 있습니다. 모든 main commit에 binary를 영구 보관하지 않는 팀이라면 처음에는 존재하는 binary만 대상으로 bisection을 하는 것이 좋습니다.

예를 들어:

```text
I-10520    binary O    PASS
I-10521    binary X
I-10522    binary X
I-10523    binary O
I-10524    binary X
I-10525    binary O
...
I-10580    binary O    FAIL
```

첫 단계에서는 available artifact 집합을 대상으로 범위를 좁힙니다.

```text
10520 → 10550 → 10565 → ...
```

그 결과 원인이 예를 들어 `(I-10543, I-10550]`까지 좁혀졌다면, 그때 10546 또는 10547의 targeted build를 생성해서 두 번째 단계 bisection을 할 수 있습니다.

즉 embedded/modem에서는 다음의 2-stage bisect가 훨씬 현실적입니다.

```text
Stage A
기존 보관 binary로 coarse bisect

Stage B
좁혀진 구간의 missing midpoint만 재빌드하여 fine bisect
```

현재 pr-search 통합 테스트가 존재하는 sequence 값만 대상으로 sparse history에서 midpoint를 계산하는 동작까지 검증하고 있기 때문에, 이 아이디어는 현재 구현 모델과도 잘 맞습니다. fileciteturn7file0L1-L2

그리고 로컬 개발자를 위한 기능으로 “Open in git bisect”를 제공할 수도 있습니다.

```bash
git bisect start --first-parent <bad_sha> <good_sha>
```

실제 test가 script로 자동 판정될 수 있는 경우에는:

```bash
git bisect run ./regression-test.sh
```

로 전환할 수 있습니다. Git은 test command가 성공이면 0, bad이면 1~127 중 125를 제외한 값, test 불가이면 125를 반환하도록 정의하고 있습니다. citeturn0search0

그러나 서버에서 실제 `git bisect` 프로세스를 실행할 필요는 없습니다. squash 기반의 선형 first-parent sequence에서는 지금처럼 DB에 있는 ordered sequence를 절반씩 줄이는 것이 장비/사람/웹 UI workflow에 훨씬 자연스럽습니다.

## 장비·필드 시험과 MTBF에도 적용할 수 있는가

장비나 field를 직접 돌려야 해서 test 자동화가 안 된다는 점은 `git bisect` 또는 pr-search의 bisect 사용을 막지 않습니다.

`git bisect`에서 자동화되는 것은 “어떤 revision을 다음에 검사할지”이지 “시험 자체를 반드시 프로그램이 해야 한다”는 것이 아닙니다. 공식 Git 문서의 기본 절차도 중간 revision을 checkout한 뒤 사용자가 compile/test하고 good 또는 bad를 입력하는 방식입니다. `git bisect run`은 추가적인 자동화 옵션일 뿐입니다. citeturn0search0

따라서 modem 환경에서는 다음과 같이 분리하면 됩니다.

```text
pr-search
  │
  ├─ next candidate 결정
  │    I-10550
  │
  ├─ 해당 binary / SHA / PR 정보 표시
  │
  ▼
장비 / chamber / field / MTBF farm
  │
  ├─ 사람이 또는 외부 시스템이 test
  │
  ▼
PASS / FAIL / SKIP / INCONCLUSIVE
  │
  └──────────────→ pr-search에 결과 기록
                         │
                         ▼
                    next candidate
```

이 구조라면 test execution이 수 분이든 몇 시간이든 며칠이든 bisect engine과 결합되지 않습니다. 현재 pr-search도 실제 test execution을 범위 밖에 두고 다음 후보만 제시하도록 요구사항이 설정되어 있으므로 구조적으로 적합합니다. fileciteturn15file1L14-L24

다만 MTBF는 일반 PASS/FAIL regression과는 다릅니다.

MTBF는 한 번 실행했는데 crash가 없었다고 바로 PASS라고 할 수 있는 지표가 아닙니다. NIST의 HPP/exponential reliability model에서는 MTBF 추정치를 기본적으로

```text
MTBF estimate =
total system operating time / number of failures
```

로 보고 confidence interval을 함께 계산합니다. 또한 특정 MTBF 목표를 특정 confidence로 입증하는 acceptance test는 상당한 시험 시간이 필요할 수 있습니다. citeturn3search0turn3search2

NIST의 예를 보면 200시간 MTBF를 90% confidence로 확인하면서 failure를 하나도 허용하지 않는 경우에도 460시간의 test가 필요합니다. failure를 몇 건 허용하느냐에 따라 필요한 시험 시간은 더 늘어납니다. citeturn3search0

따라서 MTBF에 일반적인

```text
한번 돌림
↓
안 죽음
↓
PASS
```

를 적용해서 binary search하면 통계적 noise 때문에 잘못된 방향으로 범위를 줄일 가능성이 큽니다.

MTBF용으로는 판정을 다음처럼 바꾸는 것이 맞습니다.

```text
candidate I-10550

observed device-hours = T
failures              = r
estimated MTBF        = T / r
confidence interval   = [L, U]
target MTBF           = M0

if L >= M0:
    GOOD
elif U < M0:
    BAD
else:
    INCONCLUSIVE
```

즉 confidence interval 전체가 목표 MTBF보다 위에 있으면 GOOD, 전체가 아래에 있으면 BAD, 목표를 가로지르면 시험 시간을 더 누적합니다. NIST는 HPP/exponential 모델에서 MTBF의 하한·상한 confidence bound 계산과 zero-failure 하한 계산을 제공하고 있습니다. citeturn3search2

이를 pr-search에 직접 넣는다면 session에 다음 정도가 추가되면 됩니다.

```text
test_mode       = "mtbf"
target_mtbf     = 200h
confidence      = 0.90
total_run_time  = 84h
failure_count   = 1
lower_bound     = ...
upper_bound     = ...
verdict         = INCONCLUSIVE
```

다만 full MTBF qualification을 bisection의 모든 midpoint에서 수행하는 것은 현실적으로 너무 비쌀 가능성이 높습니다. 그래서 modem 팀에는 다음 절차를 권합니다.

```text
빠른 screening regression
        ↓
일반 PASS/FAIL 또는 짧은 stress test로
suspect range를 크게 축소
        ↓
2~4개 candidate로 좁아짐
        ↓
그 구간에서 반복/병렬 장비 test
        ↓
MTBF confidence 기반 판정
        ↓
culprit boundary 결정
        ↓
최종 candidate에 정식 MTBF qualification
```

즉 “MTBF도 binary search 가능한가?”에 대한 답은 “가능하지만 raw MTBF 값을 바로 good/bad로 쓰면 안 되고, 통계적 verdict layer가 필요하다”입니다.

여러 장비를 동시에 돌리는 것도 모델의 가정이 성립한다면 총 system operating time을 누적하는 방식으로 시험 시간을 확보하는 데 사용할 수 있습니다. 다만 device, RF condition, temperature, network configuration 등이 서로 다른데 하나의 homogeneous failure process로 묶어 버리면 오히려 결과를 오염시킬 수 있습니다. NIST의 단순 MTBF 모델 자체가 constant failure rate/HPP 가정을 전제로 합니다. failure rate가 시간에 따라 변하는 reliability-growth 문제라면 NIST도 별도의 power-law 모델을 다룹니다. citeturn3search5turn3search3

그래서 pr-search에는 수학 모델보다 먼저 다음 metadata를 저장하는 것이 중요합니다.

```text
Device HW revision
RF / chamber / field configuration
Network configuration
Test scenario
Firmware artifact digest
Sequence / SHA
Test duration
Failure signature
Failure count
Retry count
```

동일 failure signature의 regression만 한 bisect session으로 묶는 것도 중요합니다. 서로 다른 두 장애를 하나의 `FAIL`로 묶으면 “어떤 지점 이전에는 good이고 이후에는 bad”라는 binary search의 전제가 깨질 수 있습니다.

## CI/CD, Binary Artifact, MDVP 연계 설계

팀장님이 제안한

```text
SMP1900_M-10523.bin
```

같은 artifact naming은 좋은 방향이지만, 현재 pr-search 구조에서는 `M number`보다 `merge_seq`를 넣는 것을 권합니다. 현재 M number는 PR이 없는 main commit을 건너뛰기 때문입니다. fileciteturn17file0L1-L12

예를 들어:

```text
SMP1900-main-E1-S10523-c81fa22.bin
```

가 더 정확합니다.

사용자에게는 짧게 보여도 내부 manifest는 full SHA를 가져야 합니다.

```json
{
  "product": "SMP1900",
  "repository": "modem/sw",
  "baseBranch": "main",
  "sequenceEpoch": 1,
  "mergeSeq": 10523,
  "integrationId": "I-10523",
  "commitSha": "c81fa22f....",
  "pullRequest": 527,
  "mergeNumber": 8123,
  "artifactSha256": "...",
  "buildConfig": "...",
  "toolchain": "...",
  "createdAt": "..."
}
```

이 manifest를 artifact 이름보다 정본으로 삼아야 binary가 복사·rename되더라도 정확한 source revision을 복원할 수 있습니다.

현재 `MergeSequence` 데이터 모델은 이미 repository, branch, epoch, `merge_seq`, `commit_sha`, PR, `merge_number`를 연결하는 방향이므로 artifact는 이 mapping에 자연스럽게 foreign key 성격으로 붙일 수 있습니다. fileciteturn10file7L145-L153

권장 엔티티는 다음 정도입니다.

```text
ArtifactBuild
-------------
artifact_id
repository_id
base_branch
seq_epoch
merge_seq
commit_sha
pull_request_number
merge_number
product
variant
artifact_uri
artifact_sha256
build_id
build_config
toolchain_version
created_at
retention_state
```

그리고 검색은 양방향이어야 합니다.

```text
I-10523
  → SHA
  → PR
  → Binary
  → Test result

Binary digest
  → I-10523
  → SHA
  → PR

PR #527
  → main integration I-10523
  → Binary
  → regression history
```

여기서 CI가 sequence를 “발급”하게 만들지는 않는 것이 좋습니다.

GitHub Actions의 `GITHUB_RUN_NUMBER`는 특정 workflow마다 따로 증가합니다. workflow를 추가하거나 이름/구성을 바꾸면 P4 CL 같은 저장소 통합 sequence의 역할을 하지 못합니다. 반면 현재 pr-search의 `first-parent ordinal`은 Git history로부터 재구성할 수 있습니다. citeturn1search9 fileciteturn4file0L1-L2

권장 흐름은 다음입니다.

```text
GitHub PR
   │
   ▼
Squash Merge
   │
   ▼
main first-parent commit
   │
   ├───────────── commit SHA
   │
   ▼
pr-search sequence assignment
   │
   ▼
(repo, branch, epoch, merge_seq, SHA, PR)
   │
   ├───────────────┐
   ▼               ▼
Search UI       Build pipeline
                   │
                   ▼
                Binary
                   │
                   ▼
              ArtifactBuild
                   │
                   ▼
          Device / MDVP / field
                   │
                   ▼
          RegressionObservation
```

GitHub도 squash merge를 base branch에 하나의 commit으로 합치는 방법으로 문서화하므로, sequence branch에서는 squash-only 정책을 유지하는 것이 가장 단순합니다. 현재 pr-search 제품 계약도 M number의 사내 적용을 squash-only로 두고 있습니다. citeturn1search1 fileciteturn17file8L138-L149

또 하나 주목할 점은 최근 pr-search의 M-number worker가 “commit이 정말 PR을 통한 것인지, direct push인지”를 증명하기 위해 상당히 복잡한 evidence resolution과 operator attestation까지 갖게 되었다는 점입니다. worker 자체도 production에서 direct push 부재를 임의 확정하지 않고, 확인되지 않으면 뒤쪽 M-number 발급을 멈추며 operator attestation을 별도로 사용한다고 설명합니다. fileciteturn19file0L1-L2

이 복잡성은 PR용 M-number에는 필요하지만 regression sequence에는 필요하지 않습니다.

이 점 때문에 더더욱:

```text
Regression truth = merge_seq
PR-friendly ordinal = merge_number
```

로 분리하는 것이 좋습니다.

MDVP에 대해서는 이번 조사에서 modem regression 시스템을 뜻하는 공개된 MDVP 자료를 확인하지 못했습니다. 공개 검색에서 나온 `MDVP`는 주로 전혀 다른 의미의 약어였고, pr-search 저장소에서도 modem regression/MDVP 연동 계약은 확인되지 않았습니다. 따라서 “최근 MDVP에서 실제로 어떤 binary search를 하는지”를 외부 자료만으로 추정해서 답하는 것은 위험합니다.

대신 MDVP가 사내 장비/검증 플랫폼이라면 pr-search가 MDVP의 내부 workflow까지 소유할 필요는 없습니다. 다음 계약만 잡으면 됩니다.

```text
pr-search → MDVP
-----------------------------
artifact URI
commit SHA
integration sequence
test scenario
requested device/profile

MDVP → pr-search
-----------------------------
run ID
integration sequence / SHA
device/profile
runtime
failure count
failure signature
raw result URI
PASS / FAIL / INCONCLUSIVE
```

MDVP가 지금 binary search를 자체적으로 하고 있다면 pr-search는 그 결과를 ingest하면 되고, 하지 않는다면 pr-search의 existing bisect engine이 “다음 어느 binary를 MDVP에 돌릴지”만 결정하면 됩니다. 이 경계가 가장 느슨하고 유지보수하기 쉽습니다.

## 실제 개발 순서와 수용 기준

현재 저장소 상태를 기준으로 하면 대규모 rewrite는 불필요합니다. 아래 순서가 가장 위험이 낮습니다.

| 단계 | 개발 내용 | 핵심 완료 조건 |
|---|---|---|
| 계약 정리 | `merge_seq`를 regression canonical ID로 확정하고 M number와 명확히 분리 | direct push가 있어도 regression timeline에 누락 없음 |
| Regression UX | 기존 bisect/range 화면을 operator 중심 Workbench로 변경 | PASS/FAIL 두 지점에서 다음 후보를 즉시 찾을 수 있음 |
| Observation | good/bad 외에 SKIP/INCONCLUSIVE 및 시험 metadata 저장 | test 불가/불확실 결과가 boundary를 잘못 이동시키지 않음 |
| Artifact | sequence ↔ SHA ↔ PR ↔ binary mapping 추가 | sequence 하나로 정확한 test binary를 찾을 수 있음 |
| Device 연동 | 수동 입력 + MDVP/외부 test result adapter | 사람이 돌린 결과와 자동 결과를 같은 session에 기록 |
| MTBF | 통계 verdict plug-in 추가 | confidence가 부족하면 INCONCLUSIVE, 충분할 때만 GOOD/BAD |
| 운영 검증 | 실제 regression pilot | 기존 P4 workflow보다 후보 선택·artifact 찾기 시간이 감소 |

첫 번째 변경은 코드보다 요구사항 결정이어야 합니다.

현재 제품은 M number를 “PR 연결이 있는 commit만 세는 번호”로 명시하고 있기 때문에, team lead가 “M-10524 = main의 10524번째 integration revision”으로 생각한다면 두 정의가 충돌합니다. fileciteturn17file3L63-L70

제가 추천하는 결정문은 사실상 다음 한 문장입니다.

```text
Regression의 canonical revision은
(repository, base_branch, seq_epoch, merge_seq)이다.

PR number와 merge_number는 탐색·표시를 위한 보조 식별자다.
```

그다음 현재 `API-SEQ-005`를 확장합니다.

기존:

```json
{
  "action": "mark",
  "merge_seq": 10550,
  "verdict": "good"
}
```

확장:

```json
{
  "action": "mark",
  "merge_seq": 10550,
  "verdict": "skip",
  "reason": "artifact_unavailable"
}
```

그리고 시험 자체의 결과는 별도 observation으로 남기는 편이 장기적으로 낫습니다.

```json
{
  "merge_seq": 10550,
  "commit_sha": "91c7aae...",
  "artifact_id": "SMP1900-main-E1-S10550-91c7aae",
  "verdict": "inconclusive",
  "test_type": "mtbf",
  "device_group": "lab-a",
  "runtime_seconds": 21600,
  "failure_count": 0,
  "failure_signature": "NR-L1-RLF",
  "result_uri": "..."
}
```

수용 테스트도 실제 modem workflow를 기준으로 잡아야 합니다.

가장 중요한 시나리오는 다음입니다.

```text
I-10000 = PASS
I-10255 = FAIL
```

후보가 256개 안팎이라면 이상적인 binary search에서는 약 8회의 판정으로 한 revision 수준까지 접근할 수 있습니다. Git의 공식 bisect도 바로 이 방식으로 남은 revision 수와 예상 step 수를 지속적으로 줄입니다. citeturn0search0

다만 실제 수용 기준은 “정확히 8번”보다 아래가 중요합니다.

```text
1. 모든 next candidate가 first-parent interval 안에 있다.
2. PASS를 입력하면 candidate 범위가 과거 방향으로 다시 넓어지지 않는다.
3. FAIL을 입력해도 범위가 다시 넓어지지 않는다.
4. SKIP/INCONCLUSIVE는 good/bad boundary를 변경하지 않는다.
5. direct push revision도 candidate가 될 수 있다.
6. artifact가 없는 revision은 명시적으로 표시된다.
7. sequence에서 artifact와 full SHA를 항상 역추적할 수 있다.
8. epoch가 바뀐 세션은 stale로 막힌다.
9. 서로 다른 branch의 sequence는 비교하지 않는다.
10. final culprit가 PR이 없는 commit이어도 정상 결과로 표현한다.
```

이 중 direct-push culprit와 epoch stale, concurrent mark가 interval을 다시 넓히지 않는 것은 현재 테스트가 이미 상당 부분 검증하고 있으므로, 기존 구현을 보존하면서 확장하는 편이 맞습니다. fileciteturn7file0L1-L2

## 최종 권고

팀장님의 문제 인식은 맞습니다. “GitHub라서 P4식 regression search가 어렵다”가 문제가 아니라 “PR 번호를 submitted CL처럼 해석하는 것”이 문제입니다. GitHub의 squash merge와 Git의 first-parent history를 사용하면 integration 순서는 충분히 명확해지고, Git에는 regression 탐색을 위한 `git bisect`와 `--first-parent`, `skip`, `run`까지 이미 존재합니다. citeturn1search1turn0search0

그리고 현재 pr-search는 이 방향을 이미 상당히 멀리 구현해 두었습니다. first-parent 기반 `merge_seq`, sequence epoch, SHA↔PR mapping, 범위 조사, safe marker, 사용자별 bisect session, midpoint 제안, contradiction 및 epoch stale 처리까지 있기 때문에 새로운 시스템을 만들 이유가 없습니다. fileciteturn3file0L1-L2 fileciteturn7file0L1-L2

오히려 지금 해야 할 가장 중요한 일은 identifier semantics를 명확히 하는 것입니다.

```text
현재
PR #548     = review identifier
SHA         = exact Git revision
merge_seq   = actual integration order
M number    = PR-only ordinal

권고
PR #548     = review identifier
SHA         = exact Git revision
I-10524     = merge_seq의 사람이 읽는 regression identifier
M-8123      = PR-only identifier가 필요할 때만 유지
```

그리고 binary에는:

```text
SMP1900-main-E1-S10524-d71be10.bin
```

처럼 `branch + epoch + merge_seq + SHA`를 남기는 것이 좋습니다.

장비/field 환경에서는 자동화를 포기할 필요가 없습니다. “시험 자동화”와 “탐색 자동화”를 분리하면 됩니다.

```text
사람/장비       → test execution
pr-search       → next candidate selection
artifact store  → exact binary selection
MDVP            → test result source
```

현재 pr-search의 bisect 설계 자체가 이미 이 모델에 가깝습니다. 다음 개발의 핵심은 `good/bad`만 있는 단순 bisect를 `PASS/FAIL/SKIP/INCONCLUSIVE + artifact + test observation`으로 확장하는 것입니다. 현재 API가 good/bad만 정의한다는 점이 이 요구와 비교한 가장 분명한 gap입니다. fileciteturn20file1L12-L23

MTBF도 적용할 수 있지만 별도의 statistical verdict layer가 필요합니다. MTBF를 midpoint마다 짧게 한번 돌려 PASS/FAIL로 판정하는 방식은 권하지 않습니다. NIST가 설명하듯 MTBF 확인에는 test time, failure count, confidence level이 함께 필요하고, 원하는 confidence를 얻는 데 상당한 누적 시험 시간이 필요할 수 있습니다. 따라서 일반 regression test로 먼저 범위를 줄인 뒤 소수 candidate에서 MTBF confidence 기반 bisection/confirmation을 하는 것이 현실적입니다. citeturn3search0turn3search2

마지막으로, 팀장님이 처음 제안한 “merge 때 CI/CD counter 하나를 증가시켜 M-number를 만든다”는 아이디어는 개념적으로는 타당하지만 현재 pr-search에는 더 좋은 기반이 이미 있습니다. 별도 mutable counter보다 Git first-parent에서 재구성 가능한 `merge_seq`가 장애·재처리·backfill·history 검증 측면에서 강합니다. GitHub의 `GITHUB_RUN_NUMBER`도 workflow별 counter일 뿐 integration history 자체는 아닙니다. citeturn1search9 fileciteturn4file0L1-L2

따라서 이 레포지터리에서의 최종 방향은 다음 한 줄로 정리할 수 있습니다.

```text
main/release first-parent merge_seq를 P4 CL에 해당하는 regression truth로 유지하고,
그 위에 human-readable Integration ID + artifact mapping +
manual/device bisect + statistical MTBF verdict를 올린다.
```

이렇게 가면 PR Search는 단순한 “GitHub PR을 잘 찾아주는 페이지”에서 벗어나, P4 사용자들이 익숙한 “PASS 지점과 FAIL 지점 사이에서 실제 시험 가능한 binary를 골라 원인 integration을 좁히는 Regression Investigation Console” 역할까지 자연스럽게 확장될 수 있습니다.