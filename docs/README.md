# 문서 인덱스

## 0. 제품 한 줄 요약

**PR Search**는 사내 GitHub Enterprise의 PR·커밋을 웹훅으로 수집해 Elasticsearch에 색인하고, 커밋 SHA ↔ PR 양방향 검색과 Perforce Changelist를 대체하는 **머지 시퀀스**를 제공하는 읽기 전용 검색·분석 대시보드다.

해결하는 문제: 조직이 Perforce에서 Git으로 전환하면서 "CL 12000부터 12500까지 조사하라" 같은 범위 기반 소통이 깨졌다. Perforce Changelist 번호는 submit 시점 채번이라 `번호 순서 = 반영 순서`가 보장되지만, GitHub PR 번호는 **생성 시점** 채번이라 머지 순서와 다르기 때문이다.

세 가지 축:

| 축 | 내용 | 근거 문서 |
| --- | --- | --- |
| 머지 시퀀스 | `(저장소, 대상 브랜치)`마다 first-parent 히스토리 서수를 부여해 CL과 동등한 단조 증가 번호를 복원 | `30_technical_architecture/pr_search_architecture_decision_records.md` ADR-007 |
| 양방향 식별자 해석 | 커밋 SHA → PR, PR → 커밋을 단일 조회로 해결 | `10_requirements/srs_final.md` FR-SRCH-001~004 |
| 관계 그래프 | 선행/후행·포함·참조·되돌림·체리픽·스택·동시 변경을 근거와 신뢰도를 갖춘 간선으로 저장 | `10_requirements/srs_final.md` FR-REL-001~008 |

기술 스택은 전 계층 TypeScript, 저장은 PostgreSQL(시스템 오브 레코드) + Elasticsearch(파생 검색 뷰), UI는 Radix Primitives와 제품 토큰이다(CR-096 / ADR-006 amendment). 확정 결정은 ADR에 있으며 구현 에이전트는 이를 재결정하지 않는다.

**배포는 프로파일 둘이다** (ADR-021 / CR-059). **Profile A**는 단일 호스트 Docker Compose이며 **첫 사내 반입의 현재 기본**이고, **Profile B**는 다중 호스트 Kubernetes로 다중 서버·고가용이 필요해질 때 쓴다. 첫 사내 반입은 **오프라인 번들 하나**로 이루어지며 설치는 사내에서 `git clone`·`pnpm install`·레지스트리 접근을 요구하지 않는다. 그 번들은 GitHub Release 자산으로 발행되어 사내에서 이 저장소 한정 읽기 토큰으로 받는다 (CR-063 / WP-072). 반입된 형상은 **외부로 되돌아오지 않는다** — 외부 저장소가 upstream 릴리스 생산자이고 내부 저장소가 영구 다운스트림 제품 라인이며, **내부 수정을 외부에 병합하는 절차는 설계하지 않는다.** 사내 운영 발견은 민감정보와 내부 코드를 제외한 `Upstream Feedback` 텍스트로 수동 전달하고, public origin이 실제 source를 검증해 수정한다 (CR-073).

이 문서는 규칙을 적지 상태를 적지 않는다. **현재 상태를 여기서 읽지 마라** — 진입점에 박아 둔 스냅숏은 WP 하나가 끝나는 순간 낡는다 (DEV-324·DEV-325). 현재 `HEAD` 기준으로 정본에서 읽는다.

- SRS 상태와 버전 — `10_requirements/srs_final.md`의 상태 헤더
- 무엇이 done이고 무엇이 다음인지 — `40_delivery/pr_search_work_packages.md`의 상태 표
- 진행률·편차(`DEV-###`)·검증 기록 — `40_delivery/pr_search_implementation_traceability.md` (**3장이 진행률의 유일한 정본**)
- 변경 요청과 릴리스 게이트 — `00_governance/change_control.md`

WP-074 상세 설계의 진입점(CR-079): [설계 계약](30_technical_architecture/pr_search_wp074_design.md), [후속 구현 실행서](40_delivery/pr_search_wp074_execution.md), [사내 측정 가이드](40_delivery/pr_search_wp074_measurement_guide.md). 설계 문서의 작성은 구현 완료나 실행 허가를 뜻하지 않는다. 실제 진행 상태는 위 원장에서 확인한다.

## 1. 목적

이 문서는 PR Search의 SRS/PRD 기반 제품 계획 문서 전체를 안내하는 최상위 인덱스다. 목표는 요구사항, UX/UI, 시스템 아키텍처, 프론트엔드, 백엔드, API, 데이터, 인프라, 보안, 운영, 릴리스 검증, 작업 패키지, 구현 추적을 하나의 추적 가능한 문서 체계로 묶는 것이다.

## 2. 전체 구조

```text
docs/
  README.md
  00_governance/
    document_definitions.md
    implementation_workflow.md
    change_control.md
  10_requirements/
    feature.md
    prd.md
    workflow.md
    glossary.md
    srs_final.md
    requirements_screen_traceability_matrix.md
  20_derived_ui_specs/
    pr_search_product_ia.md
    pr_search_wireframe_spec.md
    pr_search_screen_flow_spec.md
    pr_search_screen_state_matrix.md
    pr_search_ui_component_spec.md
    pr_search_design_system_tokens.md
    pr_search_screen_qa_checklist.md
    pr_search_ai_agent_implementation_request.md
    pr_search_ai_agent_execution_brief.md
  30_technical_architecture/
    pr_search_system_architecture.md
    pr_search_frontend_architecture.md
    pr_search_backend_architecture.md
    pr_search_api_contracts.md
    pr_search_data_model.md
    pr_search_async_events_jobs.md
    pr_search_security_privacy_architecture.md
    pr_search_infrastructure_operations.md
    pr_search_observability_reliability.md
    pr_search_architecture_decision_records.md
  40_delivery/
    pr_search_implementation_roadmap.md
    pr_search_release_validation_plan.md
    pr_search_work_packages.md
    pr_search_implementation_traceability.md
```

## 3. 문서군

### 3.1 `00_governance`

문서 체계, 우선순위, 충돌 해결, 갱신 규칙, 구현 워크플로, 변경 관리(CR)를 정의한다.

### 3.2 `10_requirements`

제품 범위, 기능/비기능 요구사항, 용어, 제약, 우선순위, 최종 확정 요구사항을 정의한다.

### 3.3 `20_derived_ui_specs`

승인된 요구사항을 화면 구현 관점으로 번역한다. 이 문서군은 제품 범위를 새로 결정할 수 없다.

### 3.4 `30_technical_architecture`

승인된 요구사항과 UI 명세를 실제 구현 가능한 시스템 구조로 번역한다. 프론트엔드, 백엔드, API, 데이터, 비동기 처리, 보안, 인프라, 관측성 기준을 정의한다.

### 3.5 `40_delivery`

구현 순서(REL), 릴리스 검증, 작업 패키지(WP), 구현 추적 원장을 정의한다. 제품 범위를 새로 결정하지 않는다.

## 4. 문서 우선순위

1. `docs/10_requirements/srs_final.md`
2. `docs/10_requirements/prd.md`
3. `docs/10_requirements/workflow.md`
4. `docs/10_requirements/feature.md`
5. `docs/10_requirements/glossary.md`
6. `docs/10_requirements/requirements_screen_traceability_matrix.md`
7. `docs/20_derived_ui_specs/pr_search_product_ia.md`
8. 나머지 파생 UI 문서
9. `docs/30_technical_architecture/*`
10. `docs/40_delivery/*`
11. AI Agent 실행 문서

거버넌스 문서(`00_governance`)는 우선순위 비교 대상이 아니라 위 문서 전체에 적용되는 규칙이다.

## 5. 권장 읽기 순서

1. `docs/00_governance/document_definitions.md`
2. `docs/00_governance/implementation_workflow.md`
3. `docs/10_requirements/srs_final.md`
4. `docs/10_requirements/requirements_screen_traceability_matrix.md`
5. `docs/10_requirements/prd.md`
6. `docs/10_requirements/glossary.md`
7. `docs/20_derived_ui_specs/pr_search_product_ia.md`
8. `docs/20_derived_ui_specs/pr_search_wireframe_spec.md`
9. 나머지 파생 UI 문서
10. `docs/30_technical_architecture/pr_search_system_architecture.md` 이후 아키텍처 문서
11. `docs/40_delivery/pr_search_implementation_roadmap.md`
12. `docs/40_delivery/pr_search_work_packages.md`
13. `docs/40_delivery/pr_search_implementation_traceability.md`

## 6. 요구사항 변경 시 갱신 순서

1. `00_governance/change_control.md`에 CR 등록
2. `srs_final.md`
3. `prd.md`
4. `glossary.md` (용어 영향 시)
5. `requirements_screen_traceability_matrix.md`
6. `pr_search_product_ia.md`
7. `pr_search_wireframe_spec.md`
8. `pr_search_screen_flow_spec.md`
9. `pr_search_screen_state_matrix.md`
10. `pr_search_ui_component_spec.md`
11. `pr_search_design_system_tokens.md`
12. `pr_search_screen_qa_checklist.md`
13. `30_technical_architecture/*` (system -> FE -> BE -> API -> data -> async -> security -> infra -> observability -> ADR)
14. `pr_search_implementation_roadmap.md`
15. `pr_search_release_validation_plan.md`
16. `pr_search_work_packages.md`
17. `pr_search_implementation_traceability.md` (영향 WP 상태 재설정)
18. `pr_search_ai_agent_implementation_request.md`
19. `pr_search_ai_agent_execution_brief.md`
20. CR에 cascade 기록 후 종료

화면만 바뀌는 변경은 해당 화면이 이미 요구사항 ID로 정당화되는지 확인한 뒤 6번부터 진행한다. 구현 방식만 바뀌는 변경은 요구사항/화면 영향이 없음을 확인한 뒤 13번부터 진행한다.
