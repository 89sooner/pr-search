# PR Search 구현 요청서 for AI Agent

> 상태: review | 버전: v0.3 | 갱신일: 2026-08-26

## 1. 목적

이 문서는 AI Agent에게 PR Search 구현을 요청하기 위한 상세 실행 지시서다. 이 문서는 설계 원본이 아니며, 상위 문서의 승인 범위를 구현 가능한 작업으로 포장한다.

압축 브리프가 필요하면 `pr_search_ai_agent_execution_brief.md`를 먼저 읽는다. 이 문서는 그 브리프의 배경과 세부 규칙을 담는다.

## 2. 무엇을 만드는가

사내 GitHub Enterprise의 PR·커밋 데이터를 수집해 검색·분석하는 **읽기 전용 웹 대시보드**다.

해결하려는 문제: 조직이 Perforce에서 Git으로 전환하면서 "CL 12000부터 12500까지 조사하라" 같은 **범위 기반 소통**이 깨졌다. Perforce Changelist 번호는 submit 시점 채번이라 순서가 보장되지만, GitHub PR 번호는 생성 시점 채번이라 머지 순서와 다르기 때문이다.

세 가지로 이 격차를 메운다.

1. **머지 시퀀스**: (저장소, 대상 브랜치)마다 first-parent 히스토리 서수를 부여해 CL과 동등한 단조 증가 번호를 복원한다.
2. **양방향 식별자 해석**: 커밋 SHA로 PR을, PR로 커밋을 단일 조회로 찾는다.
3. **관계 그래프**: 선행/후행, 포함, 참조, 되돌림, 체리픽, 스택, 동시 변경을 명시적 관계로 저장한다.

그 위에 Elasticsearch 기반 필터링·정렬·그룹핑·집계 대시보드를 얹는다.

## 3. 필수 입력 문서

1. `../00_governance/document_definitions.md`
2. `../00_governance/implementation_workflow.md`
3. `../00_governance/change_control.md`
4. `../10_requirements/srs_final.md`
5. `../10_requirements/prd.md`
6. `../10_requirements/glossary.md`
7. `../10_requirements/requirements_screen_traceability_matrix.md`
8. `pr_search_product_ia.md`
9. `pr_search_wireframe_spec.md`
10. `pr_search_screen_flow_spec.md`
11. `pr_search_screen_state_matrix.md`
12. `pr_search_ui_component_spec.md`
13. `pr_search_design_system_tokens.md`
14. `pr_search_screen_qa_checklist.md`
15. `../30_technical_architecture/pr_search_system_architecture.md`
16. `../30_technical_architecture/pr_search_architecture_decision_records.md`
17. `../30_technical_architecture/pr_search_frontend_architecture.md`
18. `../30_technical_architecture/pr_search_backend_architecture.md`
19. `../30_technical_architecture/pr_search_api_contracts.md`
20. `../30_technical_architecture/pr_search_data_model.md`
21. `../30_technical_architecture/pr_search_async_events_jobs.md`
22. `../30_technical_architecture/pr_search_security_privacy_architecture.md`
23. `../30_technical_architecture/pr_search_infrastructure_operations.md`
24. `../30_technical_architecture/pr_search_observability_reliability.md`
25. `../40_delivery/pr_search_implementation_roadmap.md`
26. `../40_delivery/pr_search_release_validation_plan.md`
27. `../40_delivery/pr_search_work_packages.md`
28. `../40_delivery/pr_search_implementation_traceability.md`

외부 참조: 사내 디자인 시스템 `89sooner/design-system` (Conductor). 패키지 `@conductor-by-89soone/tokens`, `@conductor-by-89soone/css`, `@conductor-by-89soone/react`.

## 4. 구현 원칙

### 4.1 범위

- 작업은 `../40_delivery/pr_search_work_packages.md`의 WP 단위로 진행하고, 각 WP의 "제외" 목록을 존중한다.
- 빈 라우트, 미구현 스텁만 있는 화면, 장식용 목업으로 끝내지 않는다.
- 상태, 예외, 권한, 복구 흐름을 포함한다. 정상 경로만 구현한 것은 완료가 아니다.
- 기술 아키텍처 문서와 어긋나는 구현을 하지 않는다.
- 문서와 불일치를 발견하면 `DEV-###`로 기록하고 중단 후 보고한다. **조용한 범위 변경은 금지한다.**

### 4.2 도메인 정확성

이 제품은 조사 도구다. 틀린 답을 빠르게 주는 것보다 느리더라도 옳은 답을 주는 것이 낫다.

- **시퀀스는 git에서 파생한다.** `git rev-list --first-parent --reverse`의 서수여야 하며, 어떤 구현도 이 결과와 대조 검증 가능해야 한다. 웹훅 도착 순서 카운터로 대체하지 않는다.
- **시퀀스 값은 항상 `(sequence_space, seq_epoch, merge_seq)` 삼중으로 다룬다.** 에폭 없는 시퀀스 인용은 의미가 없다.
- **범위는 반개구간 `(from, to]`다.** `git log A..B`와 같은 의미여야 도구 결과와 사람의 git 명령 결과가 어긋나지 않는다.
- **관계 간선은 근거 없이 만들지 않는다.** 모든 간선은 `evidence` 문자열과 신뢰도(`exact`/`derived`/`heuristic`)를 갖는다.
- **`heuristic` 신뢰도 관계는 근거를 화면에 반드시 표시한다.** 근거 없이 링크만 보이면 사용자가 확실한 사실로 오인한다.

### 4.3 권한

- 모든 조회 경로가 `applyMandatoryScopeFilter`를 통과한다. 우회 경로를 만들지 않는다.
- 접근 범위를 확인할 수 없으면 결과를 반환하지 않는다(기본 거부). 만료 캐시로 대신하지 않는다.
- 접근 범위 밖 리소스는 404다. 403은 존재를 노출한다.
- 건수·패싯·집계에서도 접근 범위 밖 문서를 제외한다. 문서를 숨기는 것만으로는 부족하다.

### 4.4 UI

- Conductor 프리미티브만 사용한다. 다른 UI 라이브러리를 추가하지 않는다.
- 제품 코드에 리터럴 색상값(`#rrggbb`)을 두지 않는다.
- Conductor에 없는 프리미티브(차트, 그래프 캔버스)는 Conductor semantic 토큰만 사용해 구현하고, `DEV-###`로 기록해 design-system 기여를 제안한다.
- 상태 매트릭스의 모든 상태를 실제로 렌더링한다. 비정상 상태를 "나중에"로 미루지 않는다.
- 화면 상태의 단일 진실은 URL이다. 딥링크 공유가 이 제품의 핵심 사용 방식이다.

### 4.5 데이터

- Elasticsearch 매핑은 `dynamic: strict`다. 이를 완화하지 않는다. 소스 코드·개인정보 유입을 매핑 수준에서 막는 장치다.
- 모든 엔티티 문서는 PostgreSQL만으로 재구성 가능해야 한다. 이를 자동 테스트로 검증한다.
- 집계에 쓰이는 값은 색인 시점에 계산해 저장한다. 조회 시점 script·runtime field를 집계에 쓰지 않는다.
- 문서 ID는 결정론적이다. 같은 입력이 같은 문서를 갱신해야 재처리가 안전하다.

### 4.6 픽스처

- 더미 데이터가 필요하면 `../30_technical_architecture/pr_search_api_contracts.md`의 JSON 예시를 그대로 쓴다. 임의로 만들지 않는다.
- 픽스처는 정상 응답뿐 아니라 오류 코드와 부분 상태(`enrichment_pending`, `truncated`, `approximate`, `low_sample`)를 모두 포함한다.
- 픽스처는 합성 데이터이며 실제 GHE 데이터를 포함하지 않는다.
- 실제 API 연결 후에도 픽스처를 삭제하지 않는다. 계약 테스트가 픽스처와 실제 응답 스키마 일치를 검증한다.

### 4.7 코드 추적성

- 커밋/PR 본문에 ID를 남긴다: `Refs: WP-021 FR-SEQ-001`
- 테스트 이름에 검증 대상을 남긴다: `test("FR-SEQ-001 AC-2: 채번 순서가 first-parent와 일치한다")`
- 요구사항 그룹 전체를 구현하는 모듈은 파일 상단 주석에 FR 범위를 적는다. 함수마다 태그하지 않는다.

## 5. 구현 단계

`../40_delivery/pr_search_implementation_roadmap.md`의 REL 순서를 따른다.

| 단계 | REL | 목표 | WP |
| --- | --- | --- | --- |
| 1 | REL-001 | 수집 파이프라인과 저장 기반 | WP-001 ~ WP-010 |
| 2 | REL-002 | 양방향 식별자 해석과 권한 | WP-011 ~ WP-019 |
| 3 | REL-003 | 머지 시퀀스와 범위 조사 | WP-020 ~ WP-028 |
| 4 | REL-004 | 관계 파생과 전문 검색 | WP-029 ~ WP-036 |
| 5 | REL-005 | 통계와 운영 고도화 | WP-037 ~ WP-040 |
| 6 | REL-006 | 조사 보조와 관계 시각화 | WP-041 ~ WP-044 |

각 릴리스는 그 자체로 사용자 가치를 준다. REL-002가 끝나면 조직은 이미 "SHA로 PR 찾기"를 실제로 쓸 수 있어야 한다.

## 6. 품질 게이트

`../40_delivery/pr_search_release_validation_plan.md` 3장의 게이트를 따른다.

| Gate | 내용 |
| --- | --- |
| Gate 1 | SRS baseline + `validate_srs_prd_env.py --strict` 통과 (착수 전 1회) |
| Gate 2 | 아키텍처/ADR 리뷰 |
| Gate 3 | 구현 테스트 스위트 (WP DoD 누적) |
| Gate 4 | 보안·개인정보 리뷰 (권한 매트릭스 78셀) |
| Gate 5 | 성능·접근성 리뷰 |
| Gate 6 | 운영 준비·롤백 리허설 |
| Gate 7 | **도메인 정확성 검증** (시퀀스 git 대조, SHA↔PR 매핑) |

Gate 7이 이 제품 고유의 게이트다. 다른 모든 지표가 통과해도 시퀀스가 틀리면 제품이 잘못된 답을 준다.

## 7. 금지된 지름길

- 빈 라우트, 미구현 스텁만 있는 컴포넌트, 장식용 목업
- 상태 매트릭스의 비정상 상태 미구현
- 권한 실패의 조용한 빈 결과 처리
- 강제 권한 필터 우회 경로 생성
- 접근 범위 밖 리소스에 403 반환
- 시퀀스를 도착 순서 카운터로 구현
- 시퀀스를 에폭 없이 저장·전달
- 반개구간 규칙을 화면에 미표시
- 근거 없는 관계 간선 저장
- `heuristic` 관계를 근거 없이 표시
- Conductor 외 UI 라이브러리 추가, 리터럴 색상값 사용
- 오프셋 페이지네이션 파라미터 추가
- 매핑 `dynamic: strict` 완화
- 조사 화면에 자동 폴링 추가
- **문서 범위의 조용한 변경** (유일한 절대 금지)

## 8. 완료 기준

- 요구사항, 화면, API, 데이터, 테스트가 추적 가능하다.
- 각 WP의 DoD가 충족되고 원장에 기록된다.
- 권한·정책으로 비활성화된 액션이 사유를 표시한다.
- 비동기 작업이 잡·이벤트·진행률·오류 상태를 갖는다.
- 관측성, 운영 리스크, 알려진 제한이 문서화된다.
- 릴리스 검증 계획의 해당 게이트가 통과된다.
- **도메인 정확성 검증(ACC-01~08)이 통과한다.**

## 9. 착수 전 확인

구현을 시작하기 전에 다음이 준비되어야 한다.

| 항목 | 담당 | 상태 |
| --- | --- | --- |
| `srs_final.md` 상태가 `baseline` (사용자 승인) | Product | **완료** (2026-08-19, v1.0, CR-003) |
| `validate_srs_prd_env.py --strict` 통과 | 에이전트 | **완료** (오류 0, 경고 0) |
| OD-003 (원본 보존 기간) 결정 | Platform + Legal | **완료** (2026-08-19, CR-004) — 3년. `raw_event` 계획 용량 4TB, 월별 파티션 드롭 |
| OD-006 (ES 클러스터 형태) 결정 | Platform | **완료** (2026-08-19, CR-004) — 전용 클러스터 3노드, 노드당 Docker 컨테이너 1개(총 3개), 복제본 1 |
| OD-007 (PR 규모 기준선) | Platform | **완료** (2026-08-19, CR-004) — 워크로드 기준선 1,000 PR/일. NFR-003의 5년 500만 PR은 설계 상한으로 유지, ADR-003 샤드 수 불변 |
| ES 컨테이너 3개의 Docker host 배치 확정 | Platform | 미완 — 마스터 자격 노드 3개의 호스트 분리 확인 필요 (인프라 4.1장). CPU·RAM·디스크와 호스트 수는 CR-004 결정 범위 밖 |
| GitHub App 발급 (읽기 전용) | Security | 미완 |
| 웹훅 엔드포인트 등록 | Platform | 미완 |
| OIDC 클라이언트 등록 | Security | 미완 |
| Conductor 패키지 접근 | Design | 확인 필요 |

`srs_final.md`가 baseline이므로 이제 그 문서의 모든 변경은 `../00_governance/change_control.md`에 CR을 먼저 등록해야 한다. 구현 중 발견한 불일치는 원장에 `DEV-###`를 등록하고 CR로 연결한다.

**OD-001(미러 허용)·OD-002(권한 소스)·OD-004(릴리스 앵커)는 2026-08-22 CR-024로, OD-005(nori)는 2026-08-26 CR-040으로 모두 해소됐다.** 넷 다 두 경로 모두 구현하거나 대체 경로가 있어 착수를 막지는 않았지만, **결정 전까지 두 경로를 유지하는 비용은 실제로 들었다.** 남은 오픈 결정은 OD-008(안전 구간 표식 권한 범위, REL-006 착수 전) 하나이며 REL-006이 시작되지 않아 기한 전이다.

## GitHub Operations Plane 착수 조건 (CR-005 신규)

REL-007 착수 전에 아래가 준비되어야 한다. Search/Data Plane(REL-001~006)이 end-to-end로 닫히기 전에는 시작하지 않는다.

| 항목 | 담당 | 상태 |
| --- | --- | --- |
| GitHub Operations App 발급 (수집용과 별개, 명시적으로 필요한 권한만) | Security | 미완 |
| Operations App 사용자 인가 흐름 승인 | Security | 미완 |
| 비밀 저장소 연동 (위임 토큰 보관) | Platform | 미완 |
| `gh` 버전 고정과 실행기 이미지 빌드 파이프라인 | Platform | 미완 |
| `gh-executor` 런타임 프로비저닝 (CPU·메모리·임시 디스크·동시 실행 상한) | Platform | 미완 |
| capability 의미 오버라이드 초안 (위험도·필요 권한·비밀 여부) | Product + Security | 미완 |

**금지 지름길 (추가)**

16. `search-api`나 `pipeline-worker`에서 `gh`를 직접 실행하는 것
17. shell을 경유해 `gh`를 실행하는 것 (`shell: true`, `bash -c`, `sh -c`, `eval`)
18. 사용자 입력 문자열을 명령 문자열로 연결하는 것
19. 수집용 설치 토큰으로 사용자 요청 작업을 실행하는 것
20. 감사 기록 없이 쓰기 작업을 실행하는 것
21. 위험도 확인을 생략하고 쓰기 작업을 실행하는 것
22. capability를 목록에서 조용히 숨기는 것 — 미지원·차단도 사유와 함께 노출한다
23. `gh api`로 command 경로의 정책을 우회하는 것
24. 토큰·비밀을 argv·로그·이력·감사에 남기는 것
25. 쓰기 작업을 자동 재시도하는 것
