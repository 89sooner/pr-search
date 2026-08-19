# PR Search 구현 추적 원장

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

구현이 시작된 후 문서와 코드의 정합성을 유지하는 살아있는 원장이다. 코딩 에이전트는 WP를 완료할 때마다 이 문서를 갱신한다. 이 문서는 기록용이며 범위를 결정하지 않는다.

**현재 상태: 코드 없음.** 이 저장소는 문서 전용이며 구현은 아직 시작되지 않았다. 아래 표는 초기 상태다.

## 2. 기록 규칙

- 커밋/PR 본문에 관련 ID를 남긴다: `Refs: WP-021 FR-SEQ-001`
- 테스트 이름 또는 인접 주석에 검증하는 FR/AC를 남긴다: `test("FR-SEQ-001 AC-2: 채번 순서가 first-parent와 일치한다")`
- 요구사항 그룹 전체를 구현하는 모듈은 파일 상단 주석에 FR 범위를 적는다. 함수마다 태그를 붙이지 않는다.
- 문서와 코드가 어긋나면 아래 편차 로그에 `DEV-###`로 등록하고 `../00_governance/change_control.md`의 `CR-###`로 연결한다. **조용히 코드만 바꾸지 않는다.**
- WP 완료 시 3장 상태, 4장 매핑, 6장 검증 결과를 함께 갱신한다.

## 3. WP 진행 상태

상태: `todo` / `in_progress` / `done` / `blocked`

| WP ID | 이름 | REL | 상태 | 담당 | 커밋/PR | 검증 결과 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WP-001 | 워크스페이스와 공유 패키지 골격 | REL-001 | todo | - | - | - | - |
| WP-002 | PostgreSQL 스키마와 마이그레이션 | REL-001 | todo | - | - | - | - |
| WP-003 | Elasticsearch 매핑과 인덱스 부트스트랩 | REL-001 | todo | - | - | - | - |
| WP-004 | 웹훅 수신 게이트웨이 | REL-001 | todo | - | - | - | - |
| WP-005 | EventBus 포트와 Redis Streams 어댑터 | REL-001 | todo | - | - | - | - |
| WP-006 | GHE 클라이언트와 rate limit 관리 | REL-001 | todo | - | - | - | - |
| WP-007 | 보강 워커 | REL-001 | todo | - | - | - | - |
| WP-008 | 투영 워커와 버전 조건부 업서트 | REL-001 | todo | - | - | - | - |
| WP-009 | 실패 대기열과 재처리 | REL-001 | todo | - | - | - | - |
| WP-010 | 저장소 등록 API와 파이프라인 지표 | REL-001 | todo | - | - | - | - |
| WP-011 | 구조화 질의 파서 | REL-002 | todo | - | - | - | - |
| WP-012 | 인증과 접근 범위 강제 | REL-002 | todo | - | - | - | - |
| WP-013 | 검색 API 목록 조회 | REL-002 | todo | - | - | - | - |
| WP-014 | 식별자 해석 API | REL-002 | todo | - | - | - | - |
| WP-015 | 웹 앱 셸과 Conductor 통합 | REL-002 | todo | - | - | - | - |
| WP-016 | W-001 통합 검색 화면 | REL-002 | todo | - | - | - | - |
| WP-017 | W-002 PR 상세 화면 | REL-002 | todo | - | - | - | - |
| WP-018 | W-003 커밋 상세 화면 | REL-002 | todo | - | - | - | - |
| WP-019 | 저장소 백필 잡 | REL-002 | todo | - | - | - | - |
| WP-020 | 커밋 그래프 접근 계층 | REL-003 | todo | - | - | - | OD-001 결정 전이면 두 경로 모두 구현 |
| WP-021 | 시퀀스 증분 채번 | REL-003 | todo | - | - | - | 핵심 WP |
| WP-022 | 시퀀스 재채번과 에폭 | REL-003 | todo | - | - | - | - |
| WP-023 | 앵커 정규화와 범위 조회 API | REL-003 | todo | - | - | - | - |
| WP-024 | 릴리스 수집과 포함 관계 | REL-003 | todo | - | - | - | - |
| WP-025 | W-004 범위 조사 화면 | REL-003 | todo | - | - | - | - |
| WP-026 | W-005 릴리스 화면과 구간 비교 | REL-003 | todo | - | - | - | - |
| WP-027 | 선행·후행 조회와 상세 화면 통합 | REL-003 | todo | - | - | - | - |
| WP-028 | 정합성 점검과 조정 스캔 | REL-003 | todo | - | - | - | - |
| WP-029 | 관계 간선 인덱스와 참조 추출 | REL-004 | todo | - | - | - | - |
| WP-030 | 되돌림·체리픽·스택 관계 파생 | REL-004 | todo | - | - | - | - |
| WP-031 | 관계 조회 API와 상세 화면 관계 섹션 | REL-004 | todo | - | - | - | - |
| WP-032 | 패싯·커서 페이지네이션·전문 검색 | REL-004 | todo | - | - | - | - |
| WP-033 | 저장된 검색 | REL-004 | todo | - | - | - | - |
| WP-034 | W-009 저장소 개요 화면 | REL-004 | todo | - | - | - | - |
| WP-035 | 무중단 재색인 | REL-004 | todo | - | - | - | - |
| WP-036 | 원본 아카이브 레인(Filebeat) | REL-004 | todo | - | - | - | - |
| WP-037 | 집계 API | REL-005 | todo | - | - | - | - |
| WP-038 | W-006 통계 대시보드 | REL-005 | todo | - | - | - | - |
| WP-039 | 감사 기록과 A-004 | REL-005 | todo | - | - | - | - |
| WP-040 | A-002·A-003 운영 콘솔 | REL-005 | todo | - | - | - | - |
| WP-041 | 안전 구간 표식 | REL-006 | todo | - | - | - | - |
| WP-042 | 이분 탐색 보조 | REL-006 | todo | - | - | - | - |
| WP-043 | 관계 그래프 API와 W-007 | REL-006 | todo | - | - | - | 조건부 (OD-007) |
| WP-044 | 검색 결과 내보내기 | REL-006 | todo | - | - | - | - |

## 4. 요구사항-코드 매핑

상태: `not_started` / `partial` / `implemented` / `verified`

| 요구사항 ID | 담당 WP | 구현 위치(모듈/경로) | 테스트 | 상태 |
| --- | --- | --- | --- | --- |
| FR-SRCH-001 | WP-014 | - | - | not_started |
| FR-SRCH-002 | WP-014, WP-018 | - | - | not_started |
| FR-SRCH-003 | WP-014, WP-017 | - | - | not_started |
| FR-SRCH-004 | WP-014, WP-016 | - | - | not_started |
| FR-SRCH-005 | WP-011, WP-016 | - | - | not_started |
| FR-SRCH-006 | WP-013, WP-016 | - | - | not_started |
| FR-SRCH-007 | WP-013, WP-016 | - | - | not_started |
| FR-SRCH-008 | WP-032 | - | - | not_started |
| FR-SRCH-009 | WP-032 | - | - | not_started |
| FR-SRCH-010 | WP-033 | - | - | not_started |
| FR-SRCH-011 | WP-032 | - | - | not_started |
| FR-SRCH-012 | WP-044 | - | - | not_started |
| FR-SEQ-001 | WP-020, WP-021 | - | - | not_started |
| FR-SEQ-002 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-003 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-004 | WP-024, WP-026 | - | - | not_started |
| FR-SEQ-005 | WP-022 | - | - | not_started |
| FR-SEQ-006 | WP-041 | - | - | not_started |
| FR-SEQ-007 | WP-042 | - | - | not_started |
| FR-REL-001 | WP-027 | - | - | not_started |
| FR-REL-002 | WP-024 | - | - | not_started |
| FR-REL-003 | WP-029, WP-031 | - | - | not_started |
| FR-REL-004 | WP-030, WP-031 | - | - | not_started |
| FR-REL-005 | WP-030, WP-031 | - | - | not_started |
| FR-REL-006 | WP-030, WP-031 | - | - | not_started |
| FR-REL-007 | WP-031 | - | - | not_started |
| FR-REL-008 | WP-043 | - | - | not_started |
| FR-ING-001 | WP-004 | - | - | not_started |
| FR-ING-002 | WP-004, WP-008 | - | - | not_started |
| FR-ING-003 | WP-002, WP-004 | - | - | not_started |
| FR-ING-004 | WP-006, WP-007 | - | - | not_started |
| FR-ING-005 | WP-008 | - | - | not_started |
| FR-ING-006 | WP-019 | - | - | not_started |
| FR-ING-007 | WP-009 | - | - | not_started |
| FR-ING-008 | WP-035 | - | - | not_started |
| FR-ING-009 | WP-010, WP-040 | - | - | not_started |
| FR-ING-010 | WP-036 | - | - | not_started |
| FR-ING-011 | WP-028 | - | - | not_started |
| FR-STAT-001 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-002 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-003 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-004 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-005 | WP-037, WP-038 | - | - | not_started |
| FR-STAT-006 | WP-037, WP-038 | - | - | not_started |
| FR-AUTH-001 | WP-012, WP-015 | - | - | not_started |
| FR-AUTH-002 | WP-012 | - | - | not_started |
| FR-AUTH-003 | WP-012 | - | - | not_started |
| FR-AUTH-004 | WP-039 | - | - | not_started |
| FR-ADMIN-001 | WP-010, WP-040 | - | - | not_started |
| FR-ADMIN-002 | WP-019, WP-040 | - | - | not_started |
| FR-ADMIN-003 | WP-028, WP-040 | - | - | not_started |
| NFR-001 | WP-013, WP-014, WP-023, WP-037 | - | - | not_started |
| NFR-002 | WP-004, WP-008 | - | - | not_started |
| NFR-003 | WP-002, WP-003 | - | - | not_started |
| NFR-004 | WP-010 (인프라) | - | - | not_started |
| NFR-005 | WP-004, WP-012 | - | - | not_started |
| NFR-006 | WP-039 | - | - | not_started |
| NFR-007 | WP-015 ~ WP-018, WP-025, WP-038 | - | - | not_started |
| NFR-008 | WP-035, WP-040 | - | - | not_started |

## 5. 편차 로그 (DEV)

문서와 코드가 어긋났을 때 등록한다. 유형: `문서 오류` / `범위 공백` / `기술 제약`.

| DEV ID | 발견일 | 발견 내용 | 관련 FR/WP | 유형 | 연결 CR | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| - | - | (아직 없음) | - | - | - | - |

**등록이 필요한 대표 상황** (사전에 예상되는 것):

| 예상 상황 | 유형 | 처리 |
| --- | --- | --- |
| Squash & Merge가 아닌 정책(merge commit, rebase)을 쓰는 저장소 발견 | 범위 공백 | SRS 5.1 가정 1 위반. CR로 SRS 가정과 시퀀스 채번 규칙을 갱신 |
| Conductor에 필요한 프리미티브(차트·그래프)가 없음 | 기술 제약 | ADR 기록 + design-system 기여 제안. 토큰 문서 12장에 이미 기록됨 |
| 7자 접두 검색 p95가 200ms를 넘음 | 기술 제약 | ADR-012 follow-up 경로(`index_prefixes`) 검토 후 새 ADR |
| GHE API가 문서와 다른 응답을 반환 | 문서 오류 | API 계약 문서 수정 후 cascade |
| 접근 범위가 500개를 훨씬 넘는 사용자가 다수 | 기술 제약 | ADR-008의 `org_team` 모드 임계 재검토 |
| 미러 디스크가 산정치를 크게 초과 | 기술 제약 | 인프라 5장 용량 재산정 CR |

## 6. 검증 결과 기록

릴리스별로 갱신한다.

| REL | 게이트 통과일 | 성능 (QA-PERF-01~10) | 권한 매트릭스 (78셀) | 도메인 정확성 (ACC-01~08) | 미해결 항목 |
| --- | --- | --- | --- | --- | --- |
| REL-001 | - | - | - | - | - |
| REL-002 | - | - | - | - | - |
| REL-003 | - | - | - | - | - |
| REL-004 | - | - | - | - | - |
| REL-005 | - | - | - | - | - |
| REL-006 | - | - | - | - | - |

## 7. 알려진 제한 (구현 반영 기준)

착수 시점의 계획상 제한이다. 구현이 진행되면 실제 반영된 내용으로 갱신한다.

| 제한 | 근거 문서 | 현재 상태 | 후속 |
| --- | --- | --- | --- |
| 시퀀스는 REL-003부터 제공 | 로드맵 4장 | 계획 | REL-003 |
| 관계 정보는 REL-004부터 제공 | 로드맵 4장 | 계획 | REL-004 |
| 원본 커밋 250건 초과 PR은 절삭 | FR-SRCH-003 AC-4 | 계획 | 없음 (GHE 링크 대체) |
| 변경 파일 3000개 초과 PR은 절삭 | FR-ING-004 AC-4 | 계획 | 없음 |
| 6자 이하 축약 SHA 미지원 | ADR-012 | 계획 | 없음 |
| 저장소 간 patch-id 비교 미지원 (포크 체리픽 미탐지) | FR-REL-005 AC-3 | 계획 | CR 필요 |
| `co_changes`·`precedes` 간선 미저장 (조회 시점 계산) | ADR-009 | 계획 | 없음 |
| W-007 관계 그래프는 조건부 | OD-007 | 계획 | REL-006 판단 |
| 실시간 알림·구독 없음 | SRS 4.3 | 범위 밖 | 없음 |
| 단일 리전 배포 | 인프라 11장 | 계획 | 없음 |
| 개인 단위 순위표 없음 | SRS 4.3 | 범위 밖 (정책) | 없음 |

## 8. 다음 작업

현재 이 저장소는 **문서 단계**이며 **Gate 1(핸드오프 게이트)을 통과했다.**

완료:

1. ~~`srs_final.md`를 사용자 승인으로 `baseline` 전환~~ → 완료 (2026-08-19, v1.0, CR-003)
2. ~~`validate_srs_prd_env.py --strict` 통과 확인~~ → 완료 (오류 0, 경고 0)

남은 착수 조건:

3. OD-003(원본 보존 기간), OD-006(ES 클러스터 형태), OD-007(저장소·PR 규모 실측) 결정 — REL-001 인프라 산정과 샤드 수 확정에 필요
4. GitHub App 발급(읽기 전용), 웹훅 엔드포인트 등록, OIDC 클라이언트 등록
5. WP-001부터 순서대로 착수. WP-001 완료 후 WP-002·WP-003·WP-005·WP-006은 병렬 가능

`srs_final.md`가 baseline이므로 이제 그 문서의 변경은 `../00_governance/change_control.md`에 CR을 먼저 등록해야 한다. 구현 중 문서와 현실이 어긋나면 위 5장에 `DEV-###`를 등록하고 CR로 연결한다. 조용한 범위 변경은 금지다.

착수 후 매 WP 완료 시 이 문서의 3·4·6장을 갱신한다. 갱신 없는 완료 보고는 완료가 아니다.
