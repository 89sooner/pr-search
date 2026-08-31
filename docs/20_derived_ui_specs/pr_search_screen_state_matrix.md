# PR Search 화면 상태 매트릭스

> 상태: review | 버전: v0.14 | 갱신일: 2026-08-31

## 1. 상태 설계 원칙

1. 상태는 문구가 아니라 사용자가 다음 행동을 결정할 수 있는 UI로 표현한다.
2. "결과 없음"과 "권한 없음"과 "아직 수집되지 않음"은 서로 다른 상태다. 하나로 뭉뚱그리지 않는다. 이 구분이 무너지면 사용자는 데이터가 없는 것인지 시스템이 고장난 것인지 판단할 수 없다.
3. 부분 실패는 전체 실패로 승격하지 않는다. 패싯 실패가 목록을 비우지 않고, 관계 조회 실패가 PR 개요를 지우지 않는다.
4. 수집 파이프라인의 중간 상태(`enrichment_pending`, `links_pending`)는 오류가 아니다. 진행 중임을 알리고 수동 재조회 경로를 제공한다. 자동 폴링은 하지 않는다.
5. 시퀀스 관련 상태(`sequence_stale`, `sequence_reassigning`, `epoch_stale`)는 데이터의 신뢰도에 직결된다. 값을 감추지 말고 값과 함께 신뢰도 경고를 표시한다.

## 2. 공통 상태 분류

| 상태 | 의미 | 필수 UI | Conductor 표현 |
| --- | --- | --- | --- |
| `loading_initial` | 최초 데이터 로딩 | skeleton 또는 진행 표시 | `Spinner`, skeleton 블록 |
| `loading_more` | 추가 페이지 로딩 | 하단 진행 표시, 기존 결과 유지 | `Spinner` (인라인) |
| `ready` | 정상 표시 | - | - |
| `empty_no_query` | 질의 미입력 | 시작 안내와 예시 질의 | `EmptyState` |
| `empty_no_result` | 조건에 맞는 데이터 없음 | 원인 후보(오타/미수집/권한)와 필터 완화 제안 | `EmptyState` |
| `not_indexed` | 미등록 저장소 | 저장소 개요 경로 | `EmptyState` + 링크 |
| `stale` | 최신성이 낮음 | 마지막 갱신 시각과 재조회 액션 | `Banner` tone `info` |
| `no_permission` | 역할 부족 | 필요 역할명과 요청 경로 | `EmptyState` |
| `not_found` | 대상 없음 또는 접근 범위 밖 | 통합 검색 복귀 경로 | `EmptyState` |
| `auth_expired` | 인증 만료 | 재인증 액션(현재 경로 보존) | `Banner` tone `warning` |
| `permission_unavailable` | 접근 범위 조회 실패 | 부분 결과 없이 재시도 안내 | `Banner` tone `danger` |
| `offline` | 연결 없음 | 사용 가능 범위와 재시도 | `Banner` tone `warning` |
| `partial_failure` | 일부 섹션·패널 실패 | 성공/실패 분리 표시와 섹션별 재시도 | 섹션별 `ErrorBanner` |
| `recoverable_error` | 복구 가능 오류 | 재시도 또는 대체 경로 | `Banner` tone `danger` + `Button` |
| `unrecoverable_error` | 복구 불가 오류 | 영향과 지원 경로, 상관 ID | `Banner` tone `danger` |
| `operation_pending` | 작업 진행 중 | 진행률과 취소/백그라운드 처리 | `Meter`, `ProgressRing` |
| `enrichment_pending` | 보강 미완료 | 수집 중 표시와 수동 재조회 | `Badge` tone `info` + 재조회 |
| `links_pending` | 관계 파생 미완료 | 관계 분석 중 표시 | `Badge` tone `info` |
| `sequence_stale` | 채번 실패로 시퀀스 갱신 중단 | 마지막 확정 값과 경고 | `Banner` tone `warning` |
| `sequence_reassigning` | 재채번 진행 중 | 마지막 확정 값과 갱신 중 표시 | `Banner` tone `info` |
| `epoch_stale` | 인용 에폭과 현재 에폭 불일치 | 무효 경고와 현재 에폭 재조회 액션 | `Banner` tone `warning` |
| `approximate` | 근사 집계 결과 | 근사값 배지 | `Badge` tone `warning` |
| `low_sample` | 표본 부족 | 백분위 대신 원값 목록 | `Badge` tone `neutral` |
| `truncated` | 결과 절삭 | 절삭 사실과 조건 추가 안내 | `Banner` tone `info` |
| `degraded` | 저하 모드(검색 불가·수집 계속) | 영향 범위 명시 | `Banner` tone `danger` |

## 3. 화면별 상태 매트릭스

### W-001 통합 검색

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `empty_no_query` | 질의 없이 진입 | 예시 질의 3종(`seq:` 범위, SHA, `merged:` 기간)과 최근 검색 | 질의 입력 | FR-SRCH-005 |
| `loading_initial` | 최초 조회 | 결과 테이블 skeleton 8행, 패싯 레일 skeleton | - | NFR-001 |
| `loading_more` | 커서 페이지 요청 | 기존 결과 유지, 하단 진행 표시 | - | FR-SRCH-008 |
| `ready` | 결과 1건 이상 | 결과 테이블 + 패싯 | - | FR-SRCH-006 |
| `ambiguous` | 해석 후보 2건 이상 | 후보 카드 목록, 자동 이동 금지 | 후보 선택 | FR-SRCH-001 |
| `empty_no_result` | 결과 0건 | 원인 후보 3종과 제거 시 결과가 생기는 필터 목록 | 필터 완화 / W-009 | FR-SRCH-006 |
| `error_query_syntax` | 미지원 키·파싱 실패 | 입력창의 오류 구간 강조와 지원 키 목록 | 질의 수정 | FR-SRCH-005 |
| `error_sequence_space_required` | `seq:` 범위 조건인데 부정 아닌 `repo:`·`base:`가 없거나 서로 다른 값이 여럿 (`INVALID_PARAMETER`) | 입력 바 아래에 무엇이 부족한지 적는다. **질의를 자동으로 고치지 않는다** — 어느 저장소를 뜻했는지는 사용자만 안다 | `repo:`·`base:` 추가 | FR-SRCH-005 AC-7 |
| `epoch_stale` | 요청한 `seq_epoch`이 그 공간의 현재 에폭과 다름 (`epoch_stale: true`) | **목록·요약·패싯을 그리지 않는다.** 시퀀스 인용 배너에 공간·요청 에폭·현재 에폭과 "히스토리가 재작성되어 같은 서수가 다른 커밋을 가리킬 수 있습니다"를 적는다. 빈 결과로 그리면 "구간이 비었다"로 읽힌다. **저장 버튼도 막는다** — 본 적 없는 세대를 저장할 수는 없다 | 「현재 에폭으로 다시 조회」 **명시적 클릭**. 자동 이동 금지 | FR-SEQ-005 AC-4 |
| `error_prefix_too_short` | 7자 미만 hex | 클라이언트 즉시 안내, 서버 호출 없음 | 입력 보강 | FR-SRCH-004 |
| `error_search_timeout` | 3초 초과 | 저장소 조건 추가 안내 | 조건 추가 | FR-SRCH-004 |
| `truncated` | 접두 결과 50건 초과 | 앞 50건 + 조건 추가 안내 | 조건 추가 | FR-SRCH-004 |
| `partial_failure` | 패싯 계산 **실패** (`facets_status: "failed"`) | 목록 정상, 레일에 실패 표시 | 레일 재시도 | FR-SRCH-009 예외 처리 |
| `facets_omitted` | 패싯이 **예산 초과로 생략**됨 (`facets_status: "budget_omitted"`) | 목록 정상, 레일에 "이번 조회에서는 생략했습니다" | 조건을 좁혀 재조회 | FR-SRCH-009 AC-4 |
| `facets_not_computed` | 응답에 패싯 키가 **없음** (패싯을 요청하지 않았거나 WP-032 전) | 레일에 "아직 분포를 세지 않습니다" | 패싯 요청 | CR-019 DEV-076 |
| `cursor_rejected_mismatch` | 조건이 바뀐 뒤 이전 커서 사용 (`CURSOR_QUERY_MISMATCH`) | "조건이 바뀌어 처음부터 다시 봅니다" + 현재 조건의 첫 페이지 | 자동 복귀. **재시도 루프 금지** | FR-SRCH-008 AC-3 |
| `cursor_rejected_invalid` | 커서 훼손·만료·PIT 부재 (`CURSOR_INVALID`) | "이 위치를 더 쓸 수 없어 처음부터 다시 봅니다" + 첫 페이지 | 자동 복귀. **재시도 루프 금지** | FR-SRCH-008 예외 처리 |
| `error_save_limit` | 저장 100건 초과 (`SAVED_SEARCH_LIMIT`) | 저장 대화상자 안에 안내, **목록 결과는 유지** | 기존 항목 삭제 후 재시도 / W-008 | FR-SRCH-010 AC-4 |
| `error_save_name_conflict` | 같은 이름의 내 검색이 이미 있음 (`SAVED_SEARCH_NAME_CONFLICT`) | 이름 입력에 오류 표시 | 이름 변경 | FR-SRCH-010 AC-1 |
| `error_save_team_invalid` | 더 이상 구성원이 아닌 팀을 대상으로 지정 (`INVALID_PARAMETER`) | 대상 팀 선택기에 오류 표시와 목록 재조회 안내 | 대상 팀 재선택 / `private` 전환 | FR-SRCH-010 AC-7 |
| `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | FR-AUTH-001 |

### W-002 PR 상세

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | 헤더·개요·커밋 skeleton | - | NFR-001 |
| `ready` | 정상 | 전체 섹션 | - | - |
| `enrichment_pending` | 원본 커밋·변경 파일 미보강 | 커밋 섹션에 수집 중 배지와 재조회 버튼, 머지 커밋은 표시 | 재조회 | FR-ING-004, FR-SRCH-003 |
| `links_pending` | **참조 추출** 미완료 (CR-042, DEV-258) | 관계 섹션의 **참조 그룹에만** "참조 분석 중" 배지. 되돌림·체리픽·스택은 이미 계산돼 있으므로 그대로 표시한다 — 그 필드는 FR-REL-003 참조 추출의 완결 상태이지 관계 파생 전체의 상태가 아니다 (CR-041, DEV-246) | 재조회 | FR-REL-003 |
| `detached` (관계 항목) | 스택 상위 PR이 머지되어 의존이 해제됨 | 항목을 **숨기지 않고** "해제됨" 배지로 표시한다. active로 그리지도, 지우지도 않는다 (FR-REL-006 AC-3, CR-041 DEV-238) | - | FR-REL-006 |
| `ambiguous` (관계 항목) | 되돌림 제목 대조 후보 2건 이상 | 모든 후보를 표시하고 다중 후보임을 밝힌다. 첫 후보를 확정된 대상처럼 그리지 않는다 (CR-042, DEV-261) | - | FR-REL-004 |
| `content_unavailable` (관계 항목) | **대상 저장소가 접근 범위 밖** | 간선·식별자·근거는 표시하고 대상 상세·이동 링크를 두지 않는다. **사유를 문구로 구분하지 않는다** — "권한이 없습니다"는 존재를 밝힌다 (THR-034, CR-042 DEV-253) | 없음 | FR-AUTH-002 |
| `error` (관계 / 동시 변경) | 하위 섹션 조회 실패 | **두 하위 섹션은 독립이다.** 실패한 쪽만 오류를 밝히고 **"다시 시도" 버튼을 함께 낸다**. 다른 쪽과 상세 본체는 유지한다 (C-019의 규칙, DEV-170) | 버튼으로 재조회 | FR-REL-003~007 |
| `co_change_unavailable` | 기준 PR이 미머지·보강 미완료·변경 파일 200개 초과 | 오류가 아니라 **정상 도메인 상태**다. 사유를 밝힌다 — `not_merged` / `enrichment_pending` / `too_many_changed_files`. **0건 결과와 같이 그리지 않는다** (CR-042, DEV-254) | 조건 해소 시 자동 | FR-REL-007 |
| `no_sequence` | 미머지 PR | 선행·후행 섹션 비활성 + 사유 표시(섹션 숨김 금지). **조회를 보내지 않는다** — PR 문서의 `state`로 아는 사실이다 (CR-031, DEV-164) | 머지 후 자동 활성 | FR-REL-001 |
| `error` (선행·후행) | 조회가 실패했다 (네트워크·파싱·409 아닌 오류) | 섹션 안에 실패를 밝히고 **"다시 시도" 버튼을 함께 낸다** (CR-032, DEV-170). 접기/펴기는 `idle`일 때만 조회하고 건수 조절은 결과가 있을 때만 그려지므로, 버튼이 없으면 상세 화면을 다시 여는 것 말고는 복구 경로가 없다 — **따를 수 없는 지시를 하지 않는다** | 버튼으로 재조회 (상세 문서는 다시 부르지 않는다) | FR-REL-001 |
| `unknown_space` (선행·후행) | 문서가 대상 브랜치를 싣지 않았다 | 조회하지 않고 "사유를 확인하지 못했습니다"를 그린다 (CR-032, DEV-168). **`base_branch` 없이 물어 서버가 공간을 고르게 하거나 `main`으로 지어내지 않는다** — 서수는 `(저장소, 대상 브랜치)` 안에서만 의미가 있다 (ADR-007) | 문서가 브랜치를 실으면 자동 활성 | FR-REL-001, ADR-007 |
| `not_sequenced` | 머지됐으나 아직 채번 전 | 같은 섹션, **다른 문구** — "아직 모른다"이지 "머지되지 않았다"가 아니다 (C-014의 구분, DEV-077) | 채번 후 재조회 | FR-REL-001, FR-SEQ-001 |
| `epoch_stale` | 표시 중 에폭 변경 | 헤더 하단 경고 배너. **자동 재조회 금지** — 재조회는 사용자 클릭이다 (QA-W002-16, W-004와 같은 규칙) | 사용자 재조회 | FR-SEQ-005 |
| `truncated` | 원본 커밋 250건 초과 | 앞 250건과 전체 건수 표시 | GHE 링크 | FR-SRCH-003 |
| `partial_failure` | 관계·릴리스 섹션만 실패 | 해당 섹션만 오류, 개요는 유지 | 섹션 재시도 | - |
| `not_found` | 미존재 또는 접근 범위 밖 | 존재 여부 미노출, 검색 복귀 | W-001 | FR-AUTH-002 |
| `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### W-003 커밋 상세

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | skeleton | - | - |
| `ready` | 정상 | 전체 섹션 | - | - |
| `enrichment_pending` | **PR 보강 미완료** (투영이 PR 이벤트의 보강 상태를 커밋 문서에 그대로 복사한다 — "PR 연결이 없다"가 아니다, CR-021 DEV-095) | 소속 PR 섹션에 수집 중 배지. **이미 이어진 PR은 그대로 보인다** — 목록이 나중에 늘 수 있다고 알린다 | 재조회 | FR-SRCH-002 |
| `multi_pr` | 동일 SHA가 2개 이상 PR에 속함 | 모든 PR을 목록으로 표시 | 사용자 선택 | FR-SRCH-002 |
| `no_pr` | `pull_requests`가 비었다. **두 경우가 있다** (CR-021, DEV-093): `role: 'direct_push'`(진짜 직접 푸시 — **WP-021 전까지 도달 불가**, DEV-061)와 `reason_code: 'no_pull_request'`(투영이 아직 PR 번호를 잇지 못함) | 전자만 "PR 없음(직접 푸시)"이다. 후자는 **"아직 PR 연결을 찾지 못했습니다"** — 다르게 쓰지 않으면 없는 사실을 주장하게 된다 | 재조회 | FR-SRCH-002 |
| `no_sequence` | first-parent 체인 밖(원본 커밋). **역할로 판정한다** — `role === 'source_commit'`. 시퀀스 값은 WP-021까지 전부 `null`이라 판정 근거가 되지 못한다 (CR-021, DEV-092) | 오류 아님. 머지 커밋 링크와 설명 표시. `merge_commit`인데 시퀀스가 `null`인 것은 **미채번**이고 다른 문구다 | 머지 커밋 이동 | FR-SEQ-001 |
| `links_pending` (관계) | **참조 추출** 미완료 | 참조 그룹에만 "참조 분석 중". 되돌림·체리픽은 그대로 표시한다 (CR-042, DEV-258·263) | 재조회 | FR-REL-003 |
| `content_unavailable` (관계 항목) | 대상 저장소가 접근 범위 밖 | 간선·식별자·근거는 표시하고 대상 상세·이동 링크를 두지 않는다. 사유를 문구로 구분하지 않는다 (THR-034) | 없음 | FR-AUTH-002 |
| `ambiguous` (관계 항목) | 되돌림 제목 대조 후보 2건 이상 | 모든 후보를 표시하고 다중 후보임을 밝힌다 (CR-042, DEV-261) | - | FR-REL-004 |
| `error` (관계) | 관계 조회 실패 | 섹션 안에 실패를 밝히고 **"다시 시도" 버튼을 함께 낸다.** 상세 본체는 유지한다 | 버튼으로 재조회 | FR-REL-003~005 |
| `not_found` / `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### W-004 범위 조사

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `empty_no_anchor` | 앵커 미지정 | 앵커 입력 안내와 최근 릴리스 제안 | 앵커 입력 | FR-SEQ-003 |
| `loading_initial` | 조회 중 | 요약 카드·결과 skeleton | - | - |
| `ready` | 정상 | 요약 + 결과 + 패싯 + 이분 탐색 | - | FR-SEQ-002 |
| `error_range_inverted` | from > to | 앵커 교환 제안 | 앵커 수정 | FR-SEQ-002 |
| `error_range_too_large` | 5만 건 초과 | 예상 건수 표시와 축소 안내 | 앵커 조정 | FR-SEQ-002 |
| `error_space_mismatch` | 두 앵커의 시퀀스 공간 불일치 | 조회 버튼 비활성 + 즉시 사유 표시 | 브랜치 선택 | FR-SEQ-004 |
| `error_anchor_not_on_branch` | 앵커가 first-parent 체인 밖 | 머지 커밋을 대체 앵커로 제안 | 앵커 교체 | FR-SEQ-003 |
| `error_anchor_not_merged` | 미머지 PR 앵커 | 사유 표시 | 앵커 교체 | FR-SEQ-003 |
| `sequence_reassigning` | 재채번 중 | 마지막 확정 값 + 갱신 중 배너 | 완료 후 재조회 | FR-SEQ-005 |
| `sequence_stale` | 채번 중단 | 마지막 확정 값 + 경고 배너 | 운영자 문의 | FR-SEQ-001 |
| `epoch_stale` | URL 에폭 ≠ 현재 에폭 | 무효 경고 + 현재 에폭 재조회 액션(자동 재조회 금지) | 재조회 | FR-SEQ-005 |
| `bisect_contradiction` | good > bad 표시 | 모순 지점 표시 | 탐색 초기화 | FR-SEQ-007 |
| `loading_more` | 구간 커서 페이지 요청 | 기존 목록 유지, 하단 진행 표시 | - | FR-SEQ-002 AC-6 |
| `cursor_rejected_mismatch` | 에폭·구간 경계·질의가 바뀐 뒤 이전 커서 사용 (`CURSOR_QUERY_MISMATCH`) | "조건이 바뀌어 처음부터 다시 봅니다" + 현재 조건의 첫 페이지 | 자동 복귀. **재시도 루프 금지** | FR-SEQ-002 AC-7 |
| `cursor_rejected_invalid` | 구간 커서 훼손·서명 불일치·형식 오류·만료 (`CURSOR_INVALID`) | "이 위치를 더 쓸 수 없어 처음부터 다시 봅니다" + 첫 페이지 | 자동 복귀. **재시도 루프 금지** | FR-SEQ-002 AC-7 |
| `facets_omitted` / `partial_failure` (패싯) | 구간 패싯이 예산을 넘겼거나 실패 | 목록 정상, 레일에만 사유 표시 | 레일 재시도 / 조건 축소 | FR-SRCH-009 |
| `no_permission` (표식 쓰기) | `release_manager` 아님 | 표식 버튼 비활성 + `blockedReason` | - | FR-SEQ-006 |
| `marker_absent` (표식) | 그 공간에 표식이 아직 없음 | 카드를 감추지 않고 "표식 없음"을 말한다 — 카드가 사라지면 이 공간에 그 기능이 없는 것으로 읽힌다 | 등록(자격 있을 때) | FR-SEQ-006 |
| `marker_epoch_stale` (표식) | 저장된 표식의 에폭 ≠ 현재 에폭 | 표식을 **그대로 보이되 무효로 표시**한다. 감추지도, 현재 에폭의 같은 서수로 옮겨 읽지도 않는다 (CR-057, ADR-007) | 현재 에폭으로 재등록(자격 있을 때) | FR-SEQ-006 AC-4, FR-SEQ-005 AC-4 |
| `marker_target_unresolved` (표식) | 끝 앵커가 아직 서수로 해석되지 않음 | 등록 액션 비활성 + 사유("끝 앵커를 먼저 해석하세요") | 앵커 해석 | FR-SEQ-006 |
| `marker_conflict` (표식) | 등록 사이에 다른 사람이 표식을 옮김 (`SAFE_MARKER_CONFLICT`) | 응답이 준 현재 표식을 보이고 사용자가 다시 결정하게 한다. **자동 재시도 금지** — 되돌리기가 정당한 동작이므로 자동으로 다시 보내면 남의 판정을 말없이 덮는다 (CR-057, DEV-464) | 현재 값 확인 후 재등록 | FR-SEQ-006 AC-1 |
| `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### W-005 릴리스·빌드

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | 타임라인 skeleton | - | - |
| `ready` | 정상 | 릴리스 목록 + 상세 | - | FR-SEQ-004 |
| `release_not_indexed` | 릴리스 0건 (태그가 없거나 아직 수집되지 않았거나 — 서버가 둘을 판별할 수 없다, CR-030 DEV-159) | 두 원인과 다음 행동을 함께 안내하고 **저장소 진단으로 가는 링크를 건다** (`/repositories?repository=owner/name`). WP-034가 그 화면을 세웠다 (CR-050, DEV-159 해소) | W-009 | FR-SEQ-004 |
| `error_space_mismatch` | 비교 대상 2건이 다른 브랜치 | 비교 버튼 비활성 + 사유 | 선택 변경 | FR-SEQ-004 |
| `not_found` / `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### W-006 통계 대시보드

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | 패널별 skeleton | - | - |
| `ready` | 정상 | 전 패널 | - | FR-STAT-001 |
| `empty_no_data` | 대상 0건 | 기간 확대 제안 | 조건 변경 | FR-STAT-005 |
| `low_sample` | 표본 20건 미만 | 백분위 대신 원값 목록 + 배지 | - | FR-STAT-003 |
| `approximate` | 100만 건 초과 | 근사값 배지 | - | FR-STAT-006 |
| `error_too_many_buckets` | 400개 초과 | 간격 확대 제안 | 간격 변경 | FR-STAT-002 |
| `error_aggregation_timeout` | 5초 초과 | 기간 축소 제안 | 기간 변경 | FR-STAT-001 |
| `epoch_stale` | 질의의 `seq:` 범위가 딛고 선 에폭이 현재와 다르다 | **집계를 그리지 않고 그 사실을 말한다.** 빈 결과나 0으로 그리지 않는다 — 재채번 뒤의 같은 서수는 다른 커밋을 가리킨다 | 범위를 다시 지정 | FR-STAT-006 AC-6, ADR-007 |
| `partial_failure` | 일부 패널 실패 | 실패 패널만 오류 표시 | 패널 재시도 | - |
| `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### W-007 관계 그래프

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | 캔버스 skeleton | - | - |
| `ready` | 정상 | 그래프 + 노드 표(키보드 대체) | - | FR-REL-008 |
| `empty_no_link` | 간선 0건 | 관계 없음 안내 | 깊이 확대 | FR-REL-008 |
| `truncated` | 노드 300개 초과 | 신뢰도 우선 포함 + 절삭 배너 | 유형 필터 | FR-REL-008 |
| `error_graph_timeout` | 2초 초과 | 부분 그래프 + 절삭 표시 | 깊이 축소 | FR-REL-008 |
| `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### W-008 저장된 검색

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | 두 목록 skeleton | - | - |
| `loading_more` | 커서 페이지 요청 | 해당 목록 유지, 하단 진행 표시 | - | FR-SRCH-010 AC-5 |
| `ready` | 정상 | 내 검색 / 팀 공유 구분 목록. 공유받은 항목에는 편집·삭제 액션을 그리지 않는다 | - | FR-SRCH-010 AC-2 |
| `empty_no_saved` | 내 검색 0건 | W-001에서 저장하는 방법 안내 | W-001 | FR-SRCH-010 |
| `empty_no_shared` | 팀 공유 0건 | "공유받은 검색이 없습니다" — 내 검색 목록과 구분해 비운다 | - | FR-SRCH-010 AC-2 |
| `error_query_syntax` | 저장 질의 파싱 실패 (**항목 단위**) | 실행 버튼 비활성 + 오류 구간. 저장자에게는 편집 경로, 공유받은 사람에게는 "소유자가 질의를 수정해야 합니다" | 편집(저장자) | FR-SRCH-010 AC-6 |
| `error_limit_exceeded` | 100건 상한 | 삭제 후 재시도 안내 | 삭제 | FR-SRCH-010 AC-4 |
| `error_name_conflict` | 같은 이름의 내 검색이 이미 있음 | 이름 입력에 오류 표시 | 이름 변경 | FR-SRCH-010 AC-1 |
| `error_team_invalid` | 더 이상 구성원이 아닌 팀을 대상으로 지정 | 대상 팀 선택기에 오류 표시 | 대상 팀 재선택 / `private` 전환 | FR-SRCH-010 AC-7 |
| `sequence_epoch_stale` | 저장된 `seq_epoch`이 현재와 다름 (**항목 단위**) | 낡음 표시와 함께 저장된 값·현재 값을 적는다. 실행하면 **저장된 에폭 그대로** W-001로 가고 그 화면이 무효를 알린다 | 저장자의 「현재 에폭으로 다시 연결」 | FR-SRCH-010 AC-8 |
| `sequence_unbound` | 질의에 `seq:`가 있는데 저장된 에폭이 없음 (CR-051 이전 항목, **항목 단위**) | 실행 버튼 비활성 + "에폭 정보 없이 만들어져 안전하게 실행할 수 없습니다". **현재 에폭을 자동으로 채우지 않는다** — 저장 당시의 값은 복원할 수 없다 | 저장자의 명시적 재연결. 공유받은 사람에게는 "저장자가 다시 연결해야 합니다" | FR-SRCH-010 AC-8 |
| `sequence_unavailable` | 질의가 지목한 저장소를 **볼 수 없음** (**항목 단위**) | "이 검색이 가리키는 저장소의 상태를 확인할 수 없습니다"만 적는다. **어떤 에폭 값도 싣지 않는다**(현재·저장된 값 둘 다) — 공유는 질의 문자열을 보이게 할 뿐 저장소를 읽을 권한이 아니다 | 없음(설계상) | FR-SRCH-010 AC-8, THR-043 |
| `error_cursor` | 이어 보기 거절 | 사유를 구분해 알리고(`CURSOR_QUERY_MISMATCH` / `CURSOR_INVALID`) 그 목록의 첫 페이지로 복귀. **재시도 루프 금지** | 자동 복귀 | FR-SRCH-010 AC-5 |
| `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### W-009 저장소 개요

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | 카드 skeleton | - | - |
| `ready` | 정상 | 저장소 카드 + 시퀀스 공간 상태 + 누락 현황 | - | FR-ING-009 |
| `loading_more` | 커서 페이저로 다음 페이지 요청 | 기존 카드 유지 + 하단 로딩 | - | FR-ING-009 |
| `empty_no_repository` | **PR Search에 표시할 수 있는 등록 저장소가 접근 범위 안에 0건** | 등록 검토 요청 경로. "GitHub에 접근 가능한 저장소가 없다"로 말하지 않는다 | 요청 | FR-ING-009, FR-AUTH-002 |
| `operation_pending` | 백필 진행 중 | 진행률 표시. **실행 버튼은 없다** | - | FR-ING-006 |
| `sequence_stale` / `sequence_reassigning` | 시퀀스 공간 이상 | 공간별 상태 배지 + **마지막 확정 서수를 함께 표시**한다 (숨기면 사용자가 아무 값도 못 본다) | 운영자 문의 | FR-SEQ-005 |
| `partial_failure` | 진단 항목 하나의 조회 실패 (문서 수 / 백필 / 시퀀스 / 누락 현황) | **해당 항목만 미확인** 표시, 같은 카드의 나머지 사실은 유지 | 카드 재시도 | FR-ING-009 |
| `error_cursor` | 커서가 무효하거나 순회 중 접근 범위가 바뀜 | 처음부터 다시 읽도록 안내. 자동 재조회하지 않는다 | 처음부터 | FR-AUTH-002 |
| `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

**세 값을 구분한다.** `null`(아직 그런 기록이 없다) · `0`(확인했고 0이다) · `unavailable`(조회에 실패해 모른다)는 서로 다른 사실이며 같은 문구로 그리지 않는다. 마지막 수집 시각, 문서 수, 백필, 누락 현황 넷 모두에 적용된다.

### A-001 수집 파이프라인 콘솔

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` | 진입 | 지표 그리드 skeleton | - | - |
| `ready` | 정상 | 지표 + 실패 대기열 + 스캔 결과 | - | FR-ADMIN-001 |
| `stale` | 지표 신선도 30초 초과 | 마지막 갱신 시각 표시 | 수동 갱신 | FR-ADMIN-001 |
| `degraded` | 검색 엔진 장애 | "검색 실패·수집 계속" 명시 배너 | 상태 페이지 | NFR-004 |
| `partial_failure` | 일부 지표 조회 실패 | 해당 항목만 미확인 표시 | 재시도 | FR-ADMIN-001 |
| `operation_pending` | 일괄 재처리 진행 중 | 진행률 + 취소 | 취소 | FR-ING-007 |
| `archive_unavailable` | 아카이브 인덱스가 없거나 ILM이 전 구간을 지웠다 | `A-001-ARCHIVE`만 "아카이브 없음"을 명시하고 **나머지 섹션은 정상 동작한다** | 적재 확인 | FR-ING-010 AC-3 |
| `archive_scope_empty` | 조회 조건이 요청자의 접근 범위 안에서 0건 | 빈 결과. **범위 밖 건수를 세어 보여 주지 않는다** | 조건 변경 | FR-ING-010 AC-6, THR-044 |
| `no_permission` | `operator`도 `security_officer`도 아님 | 필요 역할 표시 | - | FR-ADMIN-001 |
| `archive_only` | `security_officer`이며 `operator`가 아님 | **`A-001-ARCHIVE`만 렌더링한다** — 지표·실패 대기열·조정 스캔은 보이지 않는다 | - | FR-ING-010 AC-5 |
| `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### A-002 저장소 등록 관리

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` / `ready` | - | 목록 + 폼 | - | FR-ING-009 |
| `empty_no_repository` | 등록 0건 | 첫 등록 안내 | 등록 | FR-ING-009 |
| `error_no_access` | 대상 저장소 접근 권한 없음 | 필요 권한 표시 | 권한 요청 | FR-ING-009 |
| `error_branch_limit` | 브랜치 10개 초과 | 상한 명시 | 브랜치 축소 | FR-ING-009 |
| `operation_pending` | 등록·해제·요청 처리를 서버가 받는 중이거나 등록 후 백필이 진행 중 | 진행률. 확인이 필요한 조작은 확인 전에는 이 상태로 들어가지 않는다 | - | FR-ING-006, FR-ING-009 |
| `requests_empty` | 처리할 등록 검토 요청이 없다 | `A-002-REQUESTS`만 빈 상태로 그리고 **나머지 섹션은 정상 동작한다** | - | FR-ING-009 AC-11 |
| `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### A-003 인덱스·잡 운영

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` / `ready` | - | 잡 목록 + 실행 폼 + 인덱스 상태 | - | FR-ADMIN-002 |
| `job_running` | 실행 중 잡 존재 | 진행률 30초 갱신 + 중단 버튼 | 중단 | FR-ADMIN-002 |
| `error_job_conflict` | 동일 대상 잡 중복 | 실행 중 잡 ID 표시 | 기존 잡 확인 | FR-ADMIN-002 |
| `error_job_failed` | 잡 실패 | 실패 사유와 재실행 경로 | 재실행 | FR-ADMIN-002 |
| `reindex_dual_write` | 재색인 이중 쓰기 중 | 인덱스 패널에 상시 표시 | - | FR-ING-008 |
| `operation_pending` | 재채번 진행 | 진행률 + 영향 범위 | - | FR-SEQ-005 |
| `index_status_unavailable` | 별칭별 인덱스 상태를 읽지 못했다 | `A-003-INDEX`의 해당 값만 **미확인**으로 적는다 — `0`도 `0B`도 쓰지 않는다. 잡 목록과 실행 폼은 정상 동작한다 | 재시도 | FR-ING-008 AC-7 |
| `no_permission` / `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

### A-004 감사 로그

| 상태 | 발생 조건 | 화면 처리 | 복구 경로 | 관련 FR |
| --- | --- | --- | --- | --- |
| `loading_initial` / `loading_more` / `ready` | - | 필터 + 목록 + 커서 페이저 | - | FR-AUTH-004 |
| `empty_no_result` | 조건 결과 0건 | 필터 완화 제안 | 필터 변경 | FR-AUTH-004 |
| `no_permission` | `security_officer` 아님 | 필요 역할 표시(HTTP 403). **문구에 `security_officer`를 그대로 적는다** — `operator`도 여기서 막히므로 "운영자 권한이 필요합니다"는 거짓이다 (CR-054, DEV-408) | - | NFR-006 |
| `cursor_invalid` | 커서가 위조·만료되었거나 조건이 바뀐 뒤의 옛 커서 | 첫 페이지로 복귀하고 그 사실을 알린다. `CURSOR_INVALID`와 `CURSOR_QUERY_MISMATCH`를 **다른 문구로** 구분한다 — 하나는 "커서를 쓸 수 없다"이고 다른 하나는 "조건이 바뀌었다"이다 | 재조회 | API-ADM-005 |
| `auth_expired` / `offline` | 공통 | 공통 규칙 | 공통 | - |

## 4. 상태 전이 규칙

1. `loading_initial` → `ready` | `empty_*` | `error_*`. `loading_initial`에서 직접 `partial_failure`로 가지 않는다. 최소 1개 섹션은 결정되어야 한다.
2. `ready` → `loading_more` → `ready`. 추가 로딩은 기존 결과를 비우지 않는다.
3. `enrichment_pending` → `ready`는 사용자의 명시적 재조회로만 전이한다. 자동 폴링으로 화면이 갑자기 바뀌지 않는다.
4. `sequence_reassigning` → `ready` 전이 시 표시 중인 시퀀스 값이 바뀔 수 있다. 전이 시점에 배너로 갱신 사실을 알린다.
5. `auth_expired`는 모든 상태에서 진입 가능하며, 재인증 후 직전 상태와 URL로 복귀한다.
6. `offline` → 온라인 복귀 시 자동 재조회하지 않는다. 재조회 액션을 제시한다. 자동 재조회는 조사 중이던 화면을 사용자 동의 없이 갱신한다.

## 5. 상태별 문구 원칙

- 원인을 먼저 쓰고 행동을 뒤에 쓴다. "결과가 없습니다" 대신 "이 조건에 맞는 PR이 없습니다. `author:` 조건을 제거하면 42건이 표시됩니다."
- 시스템 내부 용어를 노출하지 않는다. "shard failure" 대신 "일부 결과를 가져오지 못했습니다".
- 복구 불가 오류에는 상관 ID를 표시해 운영자 문의에 사용하게 한다.
- 권한 부족 문구에는 필요한 역할명을 그대로 적는다. "권한이 없습니다" 대신 "이 화면은 운영자(`operator`) 역할이 필요합니다".

## GitHub Operations 화면 상태 (CR-005 신규)

기존 공통 상태에 더해 Operations 화면에만 있는 상태다.

| 상태 | 의미 | 사용자에게 보이는 것 | 다음 동작 |
| --- | --- | --- | --- |
| `identity_required` | Operations App 미연결 또는 토큰 만료 | 연결 안내 | GitHub 계정 연결 |
| `permission_denied` | 사용자 GitHub 권한 부족 | 필요 권한과 보유 여부 | 권한 요청 |
| `policy_blocked` | 실행 정책이 차단 | 차단 사유 | 관리자 문의 |
| `unsupported_host` | 대상 GHE 버전 미지원 | 미지원 사유 | 지원 기능 사용 |
| `terminal_only` | 웹으로 옮길 수 없는 기능 | 분류 사유와 대안 | 터미널 사용 |
| `registry_stale` | 실행기 gh와 manifest 불일치 | 관리자 조치 대기 안내 | A-006 확인 |
| `constraint_error` | argument·flag 제약 위반 | 위반한 제약 | 입력 수정 |
| `awaiting_confirmation` | R2 이상 확인 대기 | 대상·위험도·영향 | 확인 또는 취소 |
| `awaiting_approval` | R3 승인 대기 | 승인자와 대기 시간 | 대기 또는 취소 |
| `running` | 실행 중 | 스트리밍 출력, 취소 버튼 | 취소 가능 |
| `target_changed` | 실행 직전 대상 상태 변경 | 무엇이 달라졌는지 | 새로 고침 후 재확인 |
| `timed_out` | 실행 시간 상한 초과 | 경과 시간과 상한 | 범위 축소 후 재시도 |
| `output_truncated` | 출력 상한 초과 | 절삭 사실 | 아티팩트로 전체 확인 |

전이 규칙 중 되돌릴 수 없는 것 하나: `running` → `succeeded`인 쓰기 작업은 화면에서 되돌리기를 제공하지 않는다. GitHub 상태를 되돌리려면 별도의 되돌리기 작업(예: `pr revert`)을 새 실행으로 수행한다.
