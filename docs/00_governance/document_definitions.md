# 문서 정의서

## 1. 목적

본 문서는 PR Search 문서 세트의 역할, 기준성, 참조 순서, 갱신 원칙을 정의한다.

## 2. 문서군 정의

### 2.1 거버넌스 문서군

- 위치: `docs/00_governance`
- 목적: 문서 체계, 작업 순서, 갱신 규칙, 기준 문서 우선순위, 변경 관리(CR) 정의

### 2.2 요구사항 원본 문서군

- 위치: `docs/10_requirements`
- 목적: 제품 범위, 요구사항, 용어, 제약, 우선순위, 최종 기준선 정의
- 최상위 기준: `srs_final.md`

### 2.3 화면 구현 파생 문서군

- 위치: `docs/20_derived_ui_specs`
- 목적: 승인된 요구사항을 화면, 상태, 컴포넌트, QA, 구현 지시로 번역
- 제약: 상위 요구사항에 없는 기능을 독립적으로 추가할 수 없음

### 2.4 기술 아키텍처 문서군

- 위치: `docs/30_technical_architecture`
- 목적: 승인 범위를 시스템/FE/BE/API/데이터/비동기/보안/인프라/관측성 구조로 번역
- 제약: 구현 형태만 결정하며 제품 범위를 추가할 수 없음

### 2.5 딜리버리 문서군

- 위치: `docs/40_delivery`
- 목적: 구현 순서(REL), 릴리스 검증, 작업 패키지(WP), 구현 추적 원장 정의
- 제약: 승인된 작업의 포장만 담당하며 범위를 추가할 수 없음

## 3. 문서별 정의

- `../40_delivery/regression_workbench/deep-research-report_01.md`: 이동된 사용자 연구 01. 현재 HEAD와 대조하며 원문 인용 토큰은 검증 가능한 링크로 간주하지 않는다. 요구사항 정본이 아니다.
- `../40_delivery/regression_workbench/deep-research-report_01.html`: 연구 01의 standalone 렌더링. 요구사항·진행 상태의 정본이 아니다.
- `../40_delivery/regression_workbench/deep-research-report_02.md` 및 `../40_delivery/regression_workbench/UIUX/CLAUDE_REGRESSION_UI_BRIEF.md`: 후속 UI 설계와 사용자가 지정한 실행 지시서. CR-109는 첫 UI 수직만 SRS에 연결한다. B Atlas HTML은 선택된 레이아웃·합성 fixture의 출처이며 운영 데이터나 실제 MDVP 계약이 아니다.
- `pr_search_regression_implementation_plan.md`: CR-102의 draft 변경 제안·구현 후보 분해·검증 설계. 후보 범위는 feature/PRD에서 유래하며 SRS보다 우선하지 않는다. 승인 후 SRS→UI→아키텍처→전달 cascade로 옮기고 실제 진행률은 구현 원장만 갱신한다.

- `feature.md`: 기능 후보군 및 참고 문서. 최종 기준 문서가 아니다.
- `prd.md`: 제품 요구사항과 우선순위의 상세 기준 문서. 오픈 결정은 `OD-###`로 관리한다.
- `workflow.md`: 요구사항 도출, 정제, 검토 절차 문서.
- `glossary.md`: 도메인 용어의 단일 정의와 네이밍 규칙. 요구사항/UI/API/데이터 네이밍의 기준.
- `srs_final.md`: 구현 기준이 되는 최종 요구사항 정의서. 모든 FR은 수용 기준과 검증 방법을 가진다.
- `requirements_screen_traceability_matrix.md`: 요구사항 ID와 화면 ID를 연결하는 추적 문서.
- `change_control.md`: 변경 요청(CR), 게이트 통과 기록, cascade 기록 대장.
- `pr_search_product_ia.md`: 제품 표면, 화면 구조, 전역 정보구조 기준 문서.
- `pr_search_wireframe_spec.md`: 화면별 섹션, 컴포넌트, 상태, 이벤트, 권한 문서.
- `pr_search_screen_flow_spec.md`: 화면 전환(FLOW), 예외 흐름, deeplink 규칙 문서.
- `pr_search_screen_state_matrix.md`: 화면 상태, 오류, 권한, 복구 경로 표준 문서.
- `pr_search_ui_component_spec.md`: 공통 UI 및 도메인 컴포넌트 계약 문서.
- `pr_search_design_system_tokens.md`: 디자인 토큰과 시각 규칙 문서.
- `pr_search_screen_qa_checklist.md`: 화면별 QA 및 수용 기준 문서. WP 완료 기준이 이 항목을 인용한다.
- `pr_search_system_architecture.md` 외 `30_technical_architecture/*`: 구현 구조 기준 문서. 주요 결정은 ADR로 기록한다.
- `pr_search_implementation_roadmap.md`: 릴리스 슬라이스(REL)와 마일스톤 정의.
- `pr_search_release_validation_plan.md`: 릴리스 게이트와 검증 계획.
- `pr_search_work_packages.md`: REL을 에이전트 세션 단위 작업(WP)으로 분해한 문서.
- `pr_search_implementation_traceability.md`: 구현 시작 후 WP 상태, 요구사항-코드 매핑, 편차(DEV) 기록 원장.
- `pr_search_ai_agent_implementation_request.md`: AI Agent용 상세 구현 요청서.
- `pr_search_ai_agent_execution_brief.md`: AI Agent용 압축 실행 브리프.

- `pr_search_wp074_design.md`: WP-074의 상세 기술 계약. FR-SEQ-008·API-SEQ-007에서 파생한 상태 전이, 데이터 사전, 트랜잭션, 전달·복구 및 측정 계약을 한곳에 정의한다. 다른 아키텍처 문서는 해당 절을 참조하며 중복 정의하지 않는다. 같은 기술 계층 내 WP-074 세부사항은 이 문서가 소유하되 SRS·API 계약보다 우선하지 않는다.
- `pr_search_wp074_execution.md`: 후속 구현 에이전트의 필수 읽기 순서, 파일 소유, 작업 순서, 독립 검증 시나리오와 증거 양식. 설계를 재결정하거나 구현 실행 권한을 부여하는 문서가 아니다.
- `pr_search_wp074_measurement_guide.md`: 사내 읽기 전용 측정 도구의 구현 계약과 운영 사용 안내. 계획한 명령과 현재 실행 가능한 명령을 구분하며 실제 사내 측정 결과를 대신하지 않는다.

## 4. 문서 상태 표기 규칙

모든 계획 산출물 문서는 제목 아래에 상태 줄을 가진다.

```text
> 상태: draft | 버전: v0.1 | 갱신일: YYYY-MM-DD
```

- 상태 값: `draft`(작성 중) -> `review`(검토 중) -> `baseline`(승인·잠금). 폐기는 `deprecated`.
- `baseline` 지정은 사용자 승인으로만 한다. 에이전트는 `draft`/`review`까지만 올릴 수 있다.
- `srs_final.md`가 `draft`인 동안 에이전트 브리프와 작업 패키지를 `review` 이상으로 올릴 수 없다.
- `baseline` 문서의 변경은 `change_control.md`의 CR 등록 후에만 가능하다.

## 5. 문서 운영 원칙

1. 기능 범위 변경은 CR 등록 후 `srs_final.md`에서 먼저 승인한다.
2. `prd.md`가 `srs_final.md`와 충돌하면 `srs_final.md`를 우선한다.
3. `feature.md`는 후보 수집과 확장 검토에만 사용한다.
4. 파생 UI, 아키텍처, 딜리버리 문서는 상위 요구사항을 번역할 뿐 범위를 새로 결정하지 않는다.
5. AI Agent용 문서는 상위 문서 정합성 검토 후 마지막에 갱신한다.
6. 구현 중 문서와 코드가 어긋나면 DEV로 기록하고 CR로 처리한다. 조용한 변경은 금지한다.
