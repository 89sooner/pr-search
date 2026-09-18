# pr-search Regression UI 구현 지시서

## 목표와 기준

기존 Search를 유지하고 별도 Regression 메뉴를 추가한다. MDVP는 live-test 환경이며 MTBF는 그 안의 안정성 시험 유형이다. 사용자가 특정 날짜의 MDVP 실패를 선택하면, 마지막 비교 가능한 PASS 이후 해당 FAIL 빌드까지의 integration / PR 목록을 즉시 확인하고 필요할 때 bisect를 진행하도록 한다.

근거 자료는 사용자가 제공한 `deep-research-report.md` 및 대화에서 정의한 UI 요건이다. 함께 전달한 HTML 세 가지는 동일한 합성 데이터를 사용한 UI 시제품이며, 현재 저장소 코드나 실제 MDVP 운영 데이터로 오해하지 않는다. 구현 시작 전에 실제 pr-search의 최신 routes, frontend stack, design tokens, sequence API, bisect session API와 테스트를 확인한다. 사전 조사만으로 세션을 끝내지 말고 확인 후 바로 첫 vertical slice를 구현한다.

## 디자인 선택

A Failure Inbox를 기본 Regression 화면으로 권장한다. B Revision Atlas는 같은 investigation의 Timeline view, C Daily Pulse는 일자별 운영 view로 연결한다. 처음부터 세 개의 독립 서비스나 독립 state store를 만들지 않는다. 사용자가 다른 안을 선택하면 선택한 HTML을 레이아웃 기준으로 삼되 domain layer는 공용으로 유지한다.

- A: 285px Failure Inbox + 유동 너비 investigation pane. 일상적인 실패 triage가 우선이다.
- B: first-parent timeline + 302px evidence/bisect pane. 상세 integration 분석이 우선이다.
- C: 날짜 × MDVP test type matrix + 300px failure list + guided investigation pane. 운영 리뷰가 우선이다.

1440px desktop 우선으로 구현한다. 760px 이하에서는 inbox를 가로 스크롤 카드로 바꾸고 본문을 한 열로 배치한다. 표와 timeline은 해당 컴포넌트 안에서만 가로 스크롤한다. 문서 전체의 가로 overflow는 허용하지 않는다. A의 inbox와 조사 본문은 각각 스크롤하며 상세 sheet를 닫아도 선택/위치를 유지한다.

## 변경하면 안 되는 의미

Regression 정본 키는 `(repository, branch, seq_epoch, merge_seq)` 및 full commit SHA다. 기존 `merge_number` / M-number는 PR 친화적인 표시 식별자다. 이번 작업에서 새 counter를 만들거나 기존 M-number 의미를 재정의하지 않는다.

- M-number가 있는 revision은 M을 우선 표시한다.
- PR 없는 direct push는 `M 없음 · S-<merge_seq>`로 표시하고 전체 범위에 포함한다.
- 정렬, 거리, midpoint는 M-number 숫자 계산이 아니라 정본 first-parent integration 집합을 따른다.
- scope가 다른 동일 숫자를 비교하지 않는다. epoch가 바뀌면 기존 판정을 잠근다.
- baseline은 동일 testcase, failure signature, HW/environment/configuration 및 판정 정책에서 비교 가능한 PASS여야 한다.
- 실패 날짜는 MDVP 결과 목록을 찾는 필터다. 커밋 목록을 그 날짜로 다시 제한하지 않는다.
- 범위는 `(PASS, FAIL]`로 표시하며, PR 목록을 '원인 확정' 목록이라고 부르지 않는다.
- 한 revision의 결과를 해당 구간 모든 PR의 상태로 전파하지 않는다.
- UI의 영역/검색 필터는 표시에만 적용한다. 후보 집합을 줄이거나 bisect midpoint를 바꾸지 않는다.

## 첫 구현 범위

1. 기존 전역 navigation에 Search와 동등한 Regression 항목 및 `/regression` route를 추가한다. Search의 기능/URL/기존 스타일은 보존한다.
2. `RegressionDataSource` interface와 fixture adapter를 만든다. 실 API가 확인되기 전에는 mock mode를 UI에 명시한다. 인증정보, 내부 URL, 응답 schema를 임의로 추정하지 않는다.
3. A안 전체 흐름을 한 vertical slice로 구현한다: 날짜 선택 → MDVP 결과 선택 → PASS/FAIL evidence → integration ribbon → suspect PR list → integration detail sheet.
4. 기존 bisect API와 상태를 재사용해 후보 조회, 판정, 기록 복원으로 연결한다. API에 없는 verdict는 지원하는 것처럼 보내지 않는다. backend 확장 전에는 SKIP/INCONCLUSIVE 동작을 fixture와 feature flag로 격리한다.
5. B timeline 및 C matrix는 동일한 selection, query cache, canonical context, session을 사용한다.

## 제안 컴포넌트 분해

실제 repository convention에 맞춰 경로를 정한다. 아래는 새 API 계약이나 실파일 경로의 확인 결과가 아니라 제안이다.

```text
RegressionRoute
  RegressionScopeBar
  RegressionViewSwitcher
  FailureInbox
    RunDateFilter
    RunStatusFilter
    FailureRunCard
  InvestigationWorkbench
    SelectedRunHeader
    CompatibleBaselineSummary
    IntegrationRangeRibbon
    SuspectChangeFilters
    SuspectChangeTable
    BisectControlPanel
    ObservationHistory
  IntegrationTimelineView
    FirstParentLane
    MdvpEvidenceLanes
    TimelineViewportControls
  DailyTestMatrixView
    TestTypeDateMatrix
    GuidedInvestigationSteps
  IntegrationDetailSheet
  MdvpEvidenceSheet
  SourceHealthBanner
  RegressionEmptyState
```

소유권:
- URL: view, repo, branch, epoch, run, 결과 날짜, 테스트 유형.
- 서버/cache: run detail, integration mapping, compatible baseline, full canonical candidate set, session revision/version.
- 로컬 UI: table search, area, pagination, drawer selection, timeline zoom, scroll positions.
- 관측 기록: immutable observation history + concurrency/version checks. 화면 전환 시 session을 재생성하지 않는다.
- fixture adapter: 합성 데이터와 로컬 요청 queue. 실제 adapter에서 호출되지 않도록 분리한다.

제안 deep link:
`/regression?view=inbox&repo=modem%2Fsw&branch=main&epoch=1&run=MDVP-78421&date=2026-09-18`

## Table / Timeline 계약

기본 표: M-number, PR/변경 제목, 영역, 반영 시각(KST), binary 유무, 선택 시험에 대한 판정. SHA 전체/author/파일/diff/manifest/environment/test evidence는 sheet로 보낸다. direct push도 한 행을 차지한다. 기본 최신순이며 반영순 정렬 전환을 제공한다.

Timeline의 기본 x축은 실제 first-parent 순서다. MDVP marker는 시험 완료 시각이 아니라 시험한 revision 위치에 놓는다. 시험 완료일은 tooltip과 evidence panel에 따로 표기한다. PR 없는 커밋, binary 없는 커밋, 다음 후보, PASS/FAIL/보류를 색상뿐 아니라 모양·문자·label로 구별한다. 좁은 구간의 point click과 keyboard focus, zoom, 가로 pan을 지원한다. 다른 testcase의 PASS는 baseline 후보로 자동 채택하지 않는다.

## Bisect / MDVP 행동

- PASS: 확정 근거가 있을 때 lower bound만 이동한다.
- FAIL: 해당 failure signature에 대한 확정 결과일 때 upper bound만 이동한다.
- SKIP: 시험 불가 사유를 기록하고 다른 테스트 후보를 제안하되 경계는 유지한다. 원인 후보에서 제거하지 않는다.
- INCONCLUSIVE: 관측/사유만 기록하고 현재 후보와 경계를 유지한다. 재시험 또는 다른 후보 선택을 제공한다.
- binary 미보관: 테스트 선택에서만 피한다. 미확정 원인 구간에는 남는다.
- 시험 가능한 후보가 없고 중간 미확정 변경이 남으면 `blocked / unresolved range`다. 단일 원인으로 표시하지 않는다.
- 단일 경계에 도달해도 `최초 FAIL 경계 후보 · 재현 확인 필요`로 표시한다. non-monotonic 또는 flaky 결과에서는 자동 수렴을 주장하지 않는다.
- 실제 테스트 요청은 별도 confirmation에 canonical revision, exact artifact digest, testcase/config/environment를 표시한다. UI prototype의 로컬 큐를 실제 MDVP 실행으로 간주하지 않는다.
- MTBF: device-hours, failures, test policy/version 및 source-provided verdict를 분리 표시한다. 정책과 confidence 계산이 검증되지 않은 상태에서는 임의 PASS/FAIL이나 confidence 수치를 만들지 않는다.

## 필수 상태와 수용 조건

- 기본 샘플: M-10521 → M-10580. 내부 S-24001 → S-24061. 60 changes = 59 PR + 1 direct push. 실제 API 사용 시 숫자를 하드코딩하지 않는다.
- 기본 midpoint는 전체 canonical 후보 집합에서 선택된다. 영역/검색/페이지 변경은 midpoint에 영향을 주지 않는다.
- 날짜를 9월 17일로 바꾸면 해당 일자 MDVP 결과만 보인다. 선택 결과의 변경 범위는 이전 날짜까지 보존된다.
- PR/M/S/SHA 검색과 정확한 manifest 역추적이 가능하다.
- FAIL 결과라도 revision 매핑이 없으면 범위 생성/자동 판정을 막는다.
- MTBF INCONCLUSIVE는 FAIL 색상/진척으로 대체되지 않는다.
- MDVP stale/offline/epoch stale는 배너와 읽기 전용 동작으로 구별한다.
- release branch에 main 번호를 가져와 임시 표시하지 않는다.
- 빈 결과, 로딩, 권한 오류, 연결 오류, 부분 미매핑, artifact unavailable에 각각 상태 UI가 있다. 이 HTML은 loading/permission 오류 backend를 구현한 것이 아니므로 실제 이식 단계에서 채운다.
- dialog은 native/Radix 등 검증된 focus trap, Escape close, focus restore를 사용한다.
- reduced-motion을 지원하고 테이블 재정렬에 큰 애니메이션을 사용하지 않는다.
- 모든 값은 텍스트/아이콘/label을 동반한다. 상태색만으로 판정을 전달하지 않는다.

## 검증 범위

실제 개인 PC 개발환경에 맞춰 필요한 검증만 한다. 장시간 soak이나 대규모 문서 재정리로 UI 구현을 미루지 않는다.

1. 저장소가 이미 사용하는 lint/typecheck/build 및 영향 받는 단위테스트 실행.
2. 1440px desktop과 390px narrow viewport에서 main flow 확인.
3. PASS/FAIL로 범위가 좁혀지고 SKIP/보류로는 경계가 이동하지 않는 회귀테스트.
4. direct push, missing artifact, wrong scope, unmapped run, MTBF inconclusive 테스트.
5. 기존 Search 진입 및 주요 조회 경로 smoke test.

기능을 로컬 feature flag로 롤아웃하고 기존 Search는 그대로 둔다. 보고에는 실제 변경 파일, 동작하는 사용자 동선, 실행한 검증 결과, 아직 fixture인 부분을 구분한다. 근거 없는 'production-ready' 완료 표현을 사용하지 않는다.
