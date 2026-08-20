# 변경 관리 대장

## 1. 목적

이 문서는 PR Search 문서 세트의 변경 요청(CR), 게이트 통과 기록, cascade 수행 기록을 남긴다. 기준선(`baseline`) 이후의 모든 범위·설계 변경은 여기서 시작한다.

## 2. 변경 절차

1. CR 등록(아래 표): 유형, 트리거, 영향 ID/문서를 적는다.
2. 영향 분석: 요구사항, 화면, API, 데이터, WP 중 어디까지 번지는지 확인한다.
3. cascade 갱신: `srs_final.md`부터 `docs/README.md`의 순서대로 갱신한다.
4. validator 실행 결과를 기록한다.
5. CR을 종료한다. 영향받은 WP는 원장에서 상태를 재설정한다.

## 3. 변경 요청(CR) 대장

| CR ID | 날짜 | 유형 | 트리거 | 요약 | 영향 ID | 영향 문서 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CR-001 | 2026-08-19 | correction | 초기 scaffold | 문서 세트 생성 | - | 전체 | closed |
| CR-002 | 2026-08-19 | scope | 제품 정의 인터뷰 (Perforce → GitHub Enterprise 전환 문제) | Phase 0~5 문서 전량 작성. 기능 후보 45종 수집, FR 51종·NFR 8종 승인, 화면 13종 정의, ADR 12종 확정, REL 6종·WP 44종 분해 | F-*, FR-*, NFR-*, OD-001~008, W-001~009, A-001~004, C-001~047, FLOW-000~008, API-*, ENT-*, JOB-*, EVT-*, ADR-001~012, REL-001~006, WP-001~044 | 전체 | closed |
| CR-003 | 2026-08-19 | correction | 사용자 baseline 승인 | `srs_final.md`를 `review` → `baseline`(v1.0)으로 전환하고 기준선 잠금 문구 추가. 핸드오프 게이트 통과 기록. 내용 변경 없음 — 상태 전환만 | FR-* 전체 (범위 변경 없음) | `srs_final.md`, `change_control.md`, `pr_search_implementation_traceability.md`, `pr_search_ai_agent_implementation_request.md` | closed |
| CR-004 | 2026-08-19 | design | 사용자 OD 결정 승인 (OD-003·OD-006·OD-007) | 원본 이벤트 보존 3년 + PostgreSQL `raw_event` 계획 용량 4TB(월별 파티션 유지, 만료분은 파티션 드롭으로 정리) 확정. Elasticsearch 전용 클러스터 3노드 확정(노드당 Docker 컨테이너 1개, 총 3개 컨테이너, 복제본 1 유지, 사내 공용 클러스터 미사용). 워크로드 기준선 1,000 PR/일(연 365,000건, 5년 1,825,000건) 확정하고 NFR-003의 5년 500만 PR은 용량 설계 상한으로 유지. ADR-003 초기 샤드 수 불변. 부수 정정 2건: Kafka 전환 조건이 OD-006을 인용하던 참조 오류를 ADR-002 전환 임계로 교체, W-007 활성화 조건이 OD-007을 인용하던 참조 오류를 REL-004 관계 간선 정확도(ACC-06)로 교체. ES 용량 표에서 엔티티 인덱스 합계와 `prs-raw-events` 아카이브를 분리 표기 | OD-003, OD-006, OD-007, NFR-003, ADR-002, ADR-003, W-007, FR-REL-008, WP-043, REL-001, REL-004 | `srs_final.md`, `prd.md`, `requirements_screen_traceability_matrix.md`, 파생 UI 6종, 아키텍처 5종, 딜리버리 4종, `change_control.md` | closed |
| CR-005 | 2026-08-20 | scope | 2026-08-20 사용자 승인: gh CLI가 지원하는 GitHub 작업을 웹 UI에서 최대한 완전하게 제공하는 GitHub Operations Platform으로 제품 범위 확장 | 제품을 **Search/Data Plane**과 **GitHub Operations Plane** 두 축으로 분리하고 후자를 신규 범위로 편입한다. 기존 Out of Scope였던 GHE 쓰기 행위·Issue·Discussion·Project·Actions·Release·Repository·Codespace·설정/보안 운영을 In Scope 또는 Conditional Scope로 재분류한다. 버전 고정된 gh capability manifest, 생성형 command UI, 격리 executor, 위임 사용자 신원, risk/승인/감사 모델을 추가한다. FR-GH-001~013, NFR-009~012, W-010~W-023, A-005~A-007, ADR-013~016, REL-007~011, WP-045~060 신설. 기존 안정 ID는 변경하지 않는다 | FR-GH-001~013, NFR-009~012, W-010~W-023, A-005~A-007, ADR-013~016, REL-007~011, WP-045~060, API-GH-*, ENT-GH-*, JOB-GH-*, EVT-GH-* | 요구사항 4종, 파생 UI 7종, 아키텍처 10종, 딜리버리 4종, 브리프 2종, `README.md`, `change_control.md` | closed |
| CR-006 | 2026-08-20 | correction | WP-002 구현 중 등록된 문서 편차 DEV-003·DEV-004·DEV-005 | 문서 오류 3건을 현실에 맞춘다. 게이트 기록의 오류 코드 수 표기를 실제와 일치시키고(DEV-003), `raw_event_delivery_uk`가 기본 키와 완전히 중복인 인덱스임을 데이터 모델에 반영해 삭제하며(DEV-004), 파티션 테이블 `audit_record`의 기본 키에 파티션 키를 포함시킨다(DEV-005). CR-005의 범위 변경과 섞지 않는다. 코드는 이미 올바른 방향으로 구현되어 있어 문서를 코드에 맞춘다 | DEV-003, DEV-004, DEV-005, FR-ING-002, FR-AUTH-004 | `pr_search_data_model.md`, `pr_search_api_contracts.md`, `change_control.md`, `pr_search_implementation_traceability.md` | closed |

유형: `scope`(범위 변경), `design`(설계 변경), `implementation`(구현 편차 DEV-### 처리), `correction`(문서 오류 수정)

## 4. 게이트 통과 기록

| 게이트 | 날짜 | 결과 | 근거 |
| --- | --- | --- | --- |
| Intake 게이트 | 2026-08-19 | pass | 출처 SRC-01~05 기록, 대상 사용자 6종·핵심 시나리오 7종 도출, OD-001~008 등록, glossary 6개 영역 초기 용어 확정 |
| SRS 게이트 | 2026-08-19 | pass | FR 51종이 전체 블록(EARS 문장·출처·AC·검증 방법·관련 ID·예외 처리)을 갖춤. NFR 8종 정량화. 모호어 lint 경고 0. FR/NFR ID 중복 0. In/Conditional/Out of Scope 명시. Must FR을 차단하는 open OD 0 |
| **기준선 승인** | 2026-08-19 | pass | 사용자가 `srs_final.md` baseline을 승인. 상태 `review` → `baseline`, 버전 v1.0. 내용 변경 없이 상태만 전환 (CR-003). 이후 이 문서 변경은 CR 선행 필수 |
| 추적성 게이트 | 2026-08-19 | pass | 승인 FR 51종 + NFR 8종 전부 매트릭스에 매핑. 직접 화면 43, 간접 노출 16. 매트릭스의 모든 화면 ID가 IA에 선언됨 |
| 파생 UI 게이트 | 2026-08-19 | pass | IA가 화면 13종 선언 후 하위 문서가 참조. 와이어프레임에 목적·진입·레이아웃·섹션·컴포넌트·상태·이벤트·권한 포함. 플로우 9종에 성공·실패·딥링크·오버레이·예외 경로 정의. 상태 매트릭스에 공통 상태 25종 + 화면별 매트릭스. 컴포넌트 47종 정의와 중복 방지 규칙. 토큰은 Conductor 매핑. QA 체크리스트가 릴리스 게이트로 사용 가능 |
| 아키텍처 게이트 | 2026-08-19 | pass | 시스템 경계 8종과 배포 단위 9종 정의. 고위험 FR이 FE/BE/API/data/infra에 매핑됨. 안정 API 12종에 요청/응답 JSON 예시 포함. 데이터 모델에 PostgreSQL 스키마와 ES 매핑 5종 명시. 비동기 잡 21종·이벤트 9종 정의. 보안에 신뢰 경계 9종·위협 20종·오남용 5종. 인프라에 환경 4종·용량 산정·DR 시나리오 7종. 관측성에 SLO 12종·알림 24종·런북 19종. ADR 12종 확정 |
| 딜리버리 게이트 | 2026-08-19 | pass | REL 6종이 FE/BE/API/data/infra/security/QA를 관통하는 수직 슬라이스로 정의됨. 의존성 지도에 선행 조건과 차단 대상 명시. 릴리스 검증에 게이트 7종·성능 10종·보안 12종·정확성 8종. WP 44종이 전 REL을 커버하고 각 WP가 FR 참조·선행 관계·체크 가능한 DoD·검증 명령을 가짐. 순환 의존 0 |
| 핸드오프 게이트 | 2026-08-19 | pass | `srs_final.md` 상태 `baseline`. `validate_srs_prd_env.py --root . --strict` → `OK: no structural or traceability issues found.` (오류 0, 경고 0). 브리프 2종이 스택 결정 20종·실행 명령·WP 실행 루프·금지 지름길 15종·제출 형식을 포함하고 상태가 `review`로 SRS baseline과 정합. WP-001은 브리프와 그것이 지정한 문서만으로 실행 가능. OD-003·OD-006·OD-007은 REL-001 선행 조건으로 남아 있었고 2026-08-19 사용자 결정(CR-004)으로 해소되었다 |
| **범위 확장 승인 (CR-005)** | 2026-08-20 | pass | 사용자가 GitHub Operations Platform으로의 범위 확장을 승인. `srs_final.md` v1.1 → v2.0 (`baseline` 유지). FR-GH-001~013·NFR-009~012 추가, 기존 Out of Scope 2항 재분류. gh 2.97.0 실측 인벤토리(command node 228, flag 1,034)를 근거로 parity 요구를 정량화. `validate_srs_prd_env.py --root . --strict` → 오류 0, 경고 0. FR 64종의 매트릭스·아키텍처·WP 참조 커버리지 각각 100%. 안정 ID 재번호화 0 |

## 5. Cascade 기록

CR별로 실제 갱신한 문서 체크리스트를 남긴다.

### CR-001 cascade

- [x] 초기 생성이므로 해당 없음

### CR-002 cascade

Phase 0 (Intake)

- [x] `10_requirements/feature.md` — 출처 SRC-01~05, 기능 후보 45종(승인 40 / 제외 4 / 보류 1)
- [x] `10_requirements/workflow.md` — 템플릿 유지 (절차 변경 없음)

Phase 1 (Requirements)

- [x] `10_requirements/prd.md` — 목표·비목표·사용자 6종·성공 지표 6종·범위·시나리오 7종·리스크 8종·OD 8종
- [x] `10_requirements/glossary.md` — 6개 영역 용어 표, 네이밍 규칙, 운영 원칙 5종
- [x] `10_requirements/srs_final.md` — FR 51종 전체 블록, NFR 8종 정량화, 범위 3분류, 외부 인터페이스 7종, 데이터·추적성 요구 7종

Phase 2 (Traceability)

- [x] `10_requirements/requirements_screen_traceability_matrix.md` — FR 51 + NFR 8 전량 매핑, 커버리지 요약

Phase 3 (Derived UI)

- [x] `20_derived_ui_specs/pr_search_product_ia.md` — 화면 13종 선언, 셸 구조, 진입 경로 18종
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — 화면 13종 상세
- [x] `20_derived_ui_specs/pr_search_screen_flow_spec.md` — FLOW-000~008, 딥링크 15종, 공통 예외 13종
- [x] `20_derived_ui_specs/pr_search_screen_state_matrix.md` — 공통 상태 25종, 화면별 매트릭스, 전이 규칙
- [x] `20_derived_ui_specs/pr_search_ui_component_spec.md` — C-001~047, Conductor 사용 맵, 중복 방지 규칙
- [x] `20_derived_ui_specs/pr_search_design_system_tokens.md` — Conductor 토큰 매핑
- [x] `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — 공통 18종 + 화면별 + 권한 매트릭스 + 성능 + 회귀

Phase 4 (Architecture)

- [x] `30_technical_architecture/pr_search_system_architecture.md` — 런타임 구조, 두 수집 레인, 데이터 흐름 3종
- [x] `30_technical_architecture/pr_search_architecture_decision_records.md` — ADR-001~012
- [x] `30_technical_architecture/pr_search_frontend_architecture.md` — 라우트 매핑, 상태 경계, 페칭 전략
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 모듈 12종, 핵심 처리 경로 5종, 실패 처리
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API 28종 카탈로그, 안정 API 12종 JSON 예시, 오류 코드 29종 (CR-006/DEV-003 정정: 이전 판 표기는 30종이었으나 API 계약 6장의 실제 코드는 29종이었다. CR-005로 GH 코드 16종이 추가되어 현재는 45종이다)
- [x] `30_technical_architecture/pr_search_data_model.md` — 엔티티 17종, PostgreSQL 스키마, ES 매핑 5종, 조회 패턴 16종
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — 큐 6종, 잡 21종, 이벤트 9종, 지표 20종
- [x] `30_technical_architecture/pr_search_security_privacy_architecture.md` — 신뢰 경계 9종, 위협 20종, 오남용 5종
- [x] `30_technical_architecture/pr_search_infrastructure_operations.md` — 환경 4종, 배포 단위 9종, 용량 산정, DR 7종
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — SLO 12종, 알림 24종, 런북 19종

Phase 5 (Delivery)

- [x] `40_delivery/pr_search_implementation_roadmap.md` — REL-001~006, 슬라이스 정의, 의존성 지도, 마이그레이션 5단계
- [x] `40_delivery/pr_search_release_validation_plan.md` — 게이트 7종, 성능 10종, 보안 12종, 정확성 8종
- [x] `40_delivery/pr_search_work_packages.md` — WP-001~044
- [x] `40_delivery/pr_search_implementation_traceability.md` — WP 상태 44행, FR→코드 매핑 59행, 편차 로그 초기화

Phase 6 (Handoff 준비)

- [x] `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md` — 필수 입력 28종, 구현 원칙 7영역, 금지 지름길 15종
- [x] `20_derived_ui_specs/pr_search_ai_agent_execution_brief.md` — 30초 요약, 스택 결정 20종, 실행 루프, 제출 형식

거버넌스

- [x] `00_governance/change_control.md` — CR-002 등록, 게이트 기록 6종
- [x] `docs/README.md` — 문서 인덱스 갱신
- [x] `AGENTS.md`, `CLAUDE.md` — 제품 맥락과 작업 규칙 갱신

validator 결과: `python3 validate_srs_prd_env.py --root . --report` → 구조·추적성 문제 없음. 모호어 경고 0.

### CR-004 cascade

Phase 1 (Requirements)

- [x] `10_requirements/srs_final.md` — v1.0 → v1.1 (`baseline` 유지). 14장 OD-003·OD-006·OD-007 `resolved`, 4.2장 조건부 범위 표의 참조 2건 정정, NFR-003에 워크로드 기준선과 용량 설계 상한 구분 추가
- [x] `10_requirements/prd.md` — v0.2 → v0.3. 12장 OD 3종 `resolved`, 5.2장 조건부 범위 표 참조 정정

Phase 2 (Traceability)

- [x] `10_requirements/requirements_screen_traceability_matrix.md` — FR-REL-008 비고의 조건부 근거를 REL-004 ACC-06으로 정정

Phase 3 (Derived UI)

- [x] `20_derived_ui_specs/pr_search_product_ia.md` — W-007 조건부 근거 2곳 정정
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — W-007 조건부 범위 문구 정정
- [x] `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — W-007 섹션 제목 정정
- [x] `20_derived_ui_specs/pr_search_design_system_tokens.md` — 그래프 캔버스 제한 항목의 조건부 근거 정정

Phase 4 (Architecture)

- [x] `30_technical_architecture/pr_search_architecture_decision_records.md` — ADR-002 Kafka 전환 임계에서 OD-006 인용 제거, ADR-003 아카이브 ILM 창과 `raw_event` 보존의 분리 명시, 전용 클러스터 확정 반영, 샤드 수 불변 Follow-up 재작성
- [x] `30_technical_architecture/pr_search_infrastructure_operations.md` — 2장 환경 표와 4장 backing service 표 갱신, **4.1장 Elasticsearch 토폴로지 신설**(결정값 / 미확정 항목 / 장애 도메인 주의), 5장 산정 기준 재작성, ES 용량을 엔티티·아카이브·총계로 분리, `raw_event` 4TB 확정 문구, 10장 스케일 표, 11장 제한 3행
- [x] `30_technical_architecture/pr_search_data_model.md` — 8장 보존 표에서 `raw_event` 3년 확정과 ES 아카이브 ILM 창 분리 명시
- [x] `30_technical_architecture/pr_search_system_architecture.md` — 객체 스토리지 제외 사유를 확정값 기준으로 재작성
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — RB-15 런북, 8장 용량 계획의 ES 디스크 3행 분리와 `raw_event` 확정값

Phase 5 (Delivery)

- [x] `40_delivery/pr_search_implementation_roadmap.md` — REL-004/REL-006 exit criteria, 6장 의존성 지도(OD 3행 해소 + ES 호스트 배치 행 추가), 7장 리스크, 9장 알려진 제한
- [x] `40_delivery/pr_search_work_packages.md` — WP-005 제외 항목, WP-043 조건부 근거
- [x] `40_delivery/pr_search_release_validation_plan.md` — ACC-06의 판정 결과 해석 명시
- [x] `40_delivery/pr_search_implementation_traceability.md` — WP-043 비고, 알려진 제한, 8장 다음 작업(OD 3종 완료 처리 + ES 호스트 배치 확인 항목 추가)

Phase 6 (Handoff)

- [x] `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md` — 착수 전 확인 표의 OD 3행을 완료로 전환하고 ES 호스트 배치 행 추가
- [x] `20_derived_ui_specs/pr_search_ai_agent_execution_brief.md` — v0.2 → v0.3. 4장에 사용자 결정 확정값 표와 미확정 인프라 사양 처리 규칙 추가

거버넌스

- [x] `00_governance/change_control.md` — CR-004 등록, 핸드오프 게이트 주석 갱신, 6장 미결 항목 3건 해소 처리

validator 결과:

- `python3 validate_srs_prd_env.py --root . --strict` → `OK: no structural or traceability issues found.` (오류 0, 경고 0, 종료 코드 0)
- `python3 validate_srs_prd_env.py --root . --report` → FR 51종의 매트릭스·아키텍처·WP 참조 커버리지 각각 100%. 전 문서 미결 표식 0. CR 4, DEV 0

범위 확인: FR·NFR의 요구 문장과 수용 기준은 변경하지 않았다. 안정 ID(FR/NFR/OD/W/C/FLOW/API/ENT/JOB/EVT/ADR/REL/WP)는 추가·변경·재번호화하지 않았다. ADR-003 샤드 수도 변경하지 않았다.

이 CR이 확정하지 않은 것: Elasticsearch 노드당 CPU·RAM·디스크 용량, Docker host 수, 컨테이너 호스트 배치. 사용자가 결정하지 않은 인프라 사양이므로 문서에 임의 값을 채우지 않았고, REL-001 프로비저닝 항목으로 남겼다.

### CR-005 cascade (제품 범위 확장)

거버넌스

- [x] `00_governance/change_control.md` — CR-005 등록, cascade 기록, 게이트 기록

Phase 1 (Requirements)

- [x] `10_requirements/srs_final.md` — **v1.1 → v2.0 (`baseline` 유지)**. 3.2장 두 Plane 정의 신설, 4.1장 In Scope 9항 추가, 4.2장 조건부 3항 추가, 4.3장 Out of Scope 재분류, 9.8장 FR-GH-001~013 신설, 10장 외부 인터페이스 3종 추가, 11장 데이터 요구 4항 추가, 12장 NFR-009~012 신설, 13장 우선순위 재구성
- [x] `10_requirements/prd.md` — v0.3 → v1.0. 5.3장 Operations Plane 신설, Out of Scope 2항 재분류 표기
- [x] `10_requirements/glossary.md` — GitHub Operations 용어 15종 추가
- [x] `10_requirements/requirements_screen_traceability_matrix.md` — 4.8장 FR-GH 매핑 13행, NFR-009~012 매핑, 커버리지 요약 갱신

Phase 3 (Derived UI)

- [x] `20_derived_ui_specs/pr_search_product_ia.md` — 표면 트리에 GitHub Operations 영역 추가, 4.1장 W-010~W-023·A-005~A-007 선언
- [x] `20_derived_ui_specs/pr_search_wireframe_spec.md` — W-010 상세, W-011~W-023 공통 규칙, A-005~A-007
- [x] `20_derived_ui_specs/pr_search_screen_flow_spec.md` — FLOW-009 실행, FLOW-010 신원 연결
- [x] `20_derived_ui_specs/pr_search_screen_state_matrix.md` — Operations 전용 상태 13종
- [x] `20_derived_ui_specs/pr_search_ui_component_spec.md` — C-048~C-060
- [x] `20_derived_ui_specs/pr_search_design_system_tokens.md` — 위험도·실행 상태 토큰 매핑, 제한 2건
- [x] `20_derived_ui_specs/pr_search_screen_qa_checklist.md` — QA-GH-01~20

Phase 4 (Architecture)

- [x] `30_technical_architecture/pr_search_architecture_decision_records.md` — ADR-013~016
- [x] `30_technical_architecture/pr_search_system_architecture.md` — 11장 Operations Plane 런타임과 공유·비공유 경계
- [x] `30_technical_architecture/pr_search_frontend_architecture.md` — 9장 라우트, GenericCommandForm, 실행 상태 표현
- [x] `30_technical_architecture/pr_search_backend_architecture.md` — 12장 모듈 7종, 실행 처리 경로 14단계
- [x] `30_technical_architecture/pr_search_api_contracts.md` — API-GH-001~012, 오류 코드 16종 추가 (29 → 45)
- [x] `30_technical_architecture/pr_search_data_model.md` — ENT-GH-001~006, 3.5장 additive 스키마(006~009), 보존 표 6행
- [x] `30_technical_architecture/pr_search_async_events_jobs.md` — 9장 큐 2종, JOB-GH-001~008, EVT-GH-001~007
- [x] `30_technical_architecture/pr_search_security_privacy_architecture.md` — 10장 자격 증명 경계, 토큰 수명주기, 명령 주입 차단, 비밀 취급, 위협 7종
- [x] `30_technical_architecture/pr_search_infrastructure_operations.md` — `gh-executor` 배포 단위, 네트워크 정책, 12장 실행기 런타임
- [x] `30_technical_architecture/pr_search_observability_reliability.md` — 10장 SLO 6종, 알림 7종, RB-20~24

Phase 5 (Delivery)

- [x] `40_delivery/pr_search_implementation_roadmap.md` — REL-007~011, 의존성 6행, 위험 5행
- [x] `40_delivery/pr_search_release_validation_plan.md` — 10장 GATE-GH-01~08, ACC-09~14, 보안 시험, 조합 시험 원칙
- [x] `40_delivery/pr_search_work_packages.md` — WP-045~060 (색인 + 상세 블록), REL별 요약 갱신
- [x] `40_delivery/pr_search_implementation_traceability.md` — WP 16행, FR-GH·NFR 매핑 17행, 다음 작업 재작성

Phase 6 (Handoff)

- [x] `20_derived_ui_specs/pr_search_ai_agent_implementation_request.md` — REL-007 착수 조건, 금지 지름길 16~25
- [x] `20_derived_ui_specs/pr_search_ai_agent_execution_brief.md` — v0.3 → v0.4. 10장 Operations 스택 결정과 금지 목록

기타

- [x] `README.md` — 제품 정의를 두 축으로 갱신, 저장소 구조에 `gh-cli`·`gh-executor` 추가

gh capability 실측 근거: 이 CR의 수치는 실제로 설치한 gh 2.97.0(2026-07-31)을 걸어 측정했다. 문서나 기억의 command 목록을 쓰지 않았다.

| 측정 항목 | 값 |
| --- | --- |
| command node (root 제외) | 228 |
| 실행 가능 leaf command | 196 |
| 그룹 command | 32 |
| command 고유 flag (상속 제외) | 1,034 |
| positional placeholder | 261 |
| `--json` 지원 command | 41 |
| top-level 영역 | 33 |

**안정 ID 확인.** 기존 FR·NFR·W·A·C·FLOW·API·ENT·JOB·EVT·ADR·REL·WP ID를 변경·재번호화·삭제하지 않았다. 신규 ID는 모두 기존 번호 뒤에 이어 붙였다.

### CR-006 cascade (문서 편차 정정)

- [x] `30_technical_architecture/pr_search_data_model.md` — DEV-004: `raw_event_delivery_uk` 제거와 사유 주석. DEV-005: `audit_record` PK를 `(audit_id, occurred_at)`으로 정정
- [x] `00_governance/change_control.md` — DEV-003: 아키텍처 게이트 기록의 오류 코드 수 정정
- [x] `40_delivery/pr_search_implementation_traceability.md` — DEV-003·004·005를 `resolved`로 전환하고 CR-006 연결
- [x] `packages/contracts/src/error-codes.ts` — API 계약 6장과 재동기화 (45종). 문서를 파싱해 대조하는 기존 테스트가 이 동기화를 강제한다

DEV-001(컨테이너 레지스트리 차단)과 DEV-006(testcontainers 대신 환경 변수 접속)은 환경·검증 제약이며 문서 오류가 아니다. 근거 없이 resolved 처리하지 않고 `open`으로 유지한다.

## 6. 미결 항목

CR-004 종료 시점의 미결 항목이다. 각각 별도 CR로 처리한다. 취소선 항목은 해소된 이력이다.

| 항목 | 유형 | 차단 대상 | 담당 |
| --- | --- | --- | --- |
| ~~`srs_final.md` `baseline` 승인~~ | ~~사용자 결정~~ | 해소 (2026-08-19, CR-003) | 사용자 |
| ~~OD-003 원본 이벤트 보존 기간~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 3년 보존, `raw_event` 계획 용량 4TB) | 사용자 |
| ~~OD-006 ES 클러스터 형태~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 전용 클러스터 3노드 / 컨테이너 3개 / 복제본 1) | 사용자 |
| ~~OD-007 저장소·PR 규모~~ | ~~오픈 결정~~ | 해소 (2026-08-19, CR-004 — 워크로드 기준선 1,000 PR/일) | 사용자 |
| OD-001 미러 클론 허용 | 오픈 결정 | 차단 없음 (두 경로 구현) | Security + Platform |
| OD-002 권한 판정 소스 | 오픈 결정 | 차단 없음 | Security |
| OD-004 릴리스 앵커 소스 | 오픈 결정 | 차단 없음 (Git 태그로 진행) | Release Eng |
| OD-005 nori 플러그인 | 오픈 결정 | 차단 없음 (대체 분석기) | Platform |
| OD-008 안전 구간 표식 권한 범위 | 오픈 결정 | REL-006 WP-041 | Release Eng |
