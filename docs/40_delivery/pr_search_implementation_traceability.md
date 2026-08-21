# PR Search 구현 추적 원장

> 상태: review | 버전: v0.6 | 갱신일: 2026-08-20

## 1. 목적

구현이 시작된 후 문서와 코드의 정합성을 유지하는 살아있는 원장이다. 코딩 에이전트는 WP를 완료할 때마다 이 문서를 갱신한다. 이 문서는 기록용이며 범위를 결정하지 않는다.

**현재 상태: WP-009까지 완료.** 워크스페이스 골격, PostgreSQL 스키마·리포지터리 계층, Elasticsearch 매핑·부트스트랩, GHE 웹훅 수신 게이트웨이, `EventBus` 포트와 Redis Streams 어댑터, GHE REST 클라이언트, 보강 워커, 그리고 **투영 워커**가 서 있다. 단위 195건·통합 158건이 전부 통과한다. **수집 경로가 웹훅에서 검색 인덱스까지 닫혔다** — 서명 검증 → `raw_event` 저장 → `prs:ingest` 발행 → NDJSON 아카이브 → 202, 그 뒤를 `enrich`가 받아 원본 커밋·변경 파일·리뷰를 채워 `EVT-ING-002`로 넘기고, `project`가 그것만 읽어 PR·커밋 문서를 만들어 Elasticsearch에 조건부 업서트한 뒤 `raw_event.processed_at`을 찍고 `EVT-ING-003`을 낸다. 오래된 이벤트는 새 상태를 덮지 않고, 커밋의 PR 소속은 순서와 무관하게 합집합으로 쌓인다. 이 환경에서 처음으로 실제 Elasticsearch(`mirror.gcr.io` 경유 8.19.0)를 띄워 ES 통합 시험을 돌렸고, 그 과정에서 WP-003의 별칭 라우팅 결함(DEV-021)을 찾아 고쳤다. 실제 GitHub App 자격 증명이 없어 real-GHE smoke는 여전히 미실행이다(선택 시험으로 남겨 두었고 건너뛴 사실이 실행 로그에 남는다). 여기에 **실패 대기열 관리 API**가 더해져 격리된 이벤트를 보고 다시 흘려보낼 수 있다 — 한 (전달, 단계)에 행 하나로 누적되고, 3회 재처리 실패면 `held`, 끝까지 성공하면 투영이 `resolved`로 닫는다. 채번·관계 파생과 검색 API·화면은 아직 없다.

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
| WP-001 | 워크스페이스와 공유 패키지 골격 | REL-001 | in_progress | 에이전트 | `f36ab06`, `44c1772` / PR #2 | 로컬 6종 통과, 헬스 4종 HTTP 200, GitHub Actions `verify` 성공 (6.1장) | **구현은 완료. DoD 4항 중 3항 검증 완료.** `docker compose up` 기동 확인만 환경 제약으로 보류 (DEV-001). 후속 WP 착수는 막지 않는다 |
| WP-002 | PostgreSQL 스키마와 마이그레이션 | REL-001 | done | 에이전트 | `96d4e2f` / PR #2 | DoD 6항 전부 통과. 통합 26건, CI `verify`·`integration` 모두 성공 (6.2장) | 로컬은 네이티브 PostgreSQL 16.13, CI는 서비스 컨테이너 (DEV-006) |
| WP-003 | Elasticsearch 매핑과 인덱스 부트스트랩 | REL-001 | done | 에이전트 | `2477c74` / PR #4 | DoD 5항 전부 통과. 로컬 단위 27건 + CI `verify`·`integration` 성공 (6.3장) | DoD 1·2·3·5는 CI의 ES 서비스 컨테이너에서 검증 (DEV-008) |
| WP-004 | 웹훅 수신 게이트웨이 | REL-001 | done | 에이전트 | `6478ebc` / PR #5 | DoD 8항 전부 통과. 단위 71건·통합 47건, 부하 1000건 p95 61.6ms (6.4장) | 재전송 멱등을 기본 키에 맡길 수 없어 advisory lock + 조건부 INSERT로 강제했다 (DEV-009 → CR-007) |
| WP-005 | EventBus 포트와 Redis Streams 어댑터 | REL-001 | done | 에이전트 | `ab7c0a3` / PR #6 | DoD 4항 전부 통과. 단위 86건·통합 93건 (6.5장) | Redis Streams에는 파티션이 없어 토픽을 물리 스트림 N개로 펴서 구현했다. `prs:sequence` 파티션 수만 문서에 없어 8을 기본값으로 두고 DEV-010에 남겼다 |
| WP-006 | GHE 클라이언트와 rate limit 관리 | REL-001 | done | 에이전트 | `c130cf1` / PR #7 | DoD 5항 전부 통과 (목 서버 기준, 문서가 정한 검증 방법). 단위 126건 (6.6장) | 실제 GHE 자격 증명이 없어 read-only smoke 미실행 — 선택 시험으로 포함했고 REL-001 운영 readiness 전 게이트로 남긴다 |
| WP-007 | 보강 워커 | REL-001 | done | 에이전트 | `fb6e5c3` / PR #8 | DoD 6항 전부 통과. 단위 150건·통합 24건(worker/enrich) (6.7장) | CR-010이 정한 `EventBus` 처분 계약을 함께 구현했다. `raw_event.processed_at`은 찍지 않는다 — 색인 시점 표식은 WP-008의 것이다. 문서의 검증 명령이 필터로 동작하지 않아 DEV-017로 등록하고 정정했다 |
| WP-008 | 투영 워커와 버전 조건부 업서트 | REL-001 | done | 에이전트 | `3f8e39e` / PR #9 | DoD 8항 전부 통과. 단위 195건·통합 158건 전량 (6.8장) | CR-011이 정한 `EVT-ING-002` PR 필드 확장과 누적 필드 합집합을 함께 구현했다. `raw_event.processed_at`을 여기서 찍는다 — 색인 성공 뒤에만. 실제 ES로 돌리는 과정에서 WP-003의 별칭 고정 라우팅 결함(DEV-021)이 드러나 함께 고쳤다 |
| WP-009 | 실패 대기열과 재처리 | REL-001 | done | 에이전트 | (이 PR) | DoD 6항 전부 통과. 단위 195건·통합 191건 전량 (6.9장) | CR-012가 정한 `(delivery_id, stage)` 업서트와 `resolved` 종료 상태를 함께 구현했다. JOB-ING-009의 `batch` 워커는 WP-019가 세우므로 재처리를 `ops` 모듈이 요청 안에서 수행한다(DEV-024). `operator` 역할 판정이 WP-012에 있어 임시 공유 토큰으로 막았고, 미설정이면 경로를 등록하지 않는다(DEV-025) |
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
| WP-043 | 관계 그래프 API와 W-007 | REL-006 | todo | - | - | - | 조건부 (REL-004 ACC-06) |
| WP-044 | 검색 결과 내보내기 | REL-006 | todo | - | - | - | - |
| WP-045 | gh capability 레지스트리와 parity 검증기 | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-046 | 위임 GitHub 신원과 Operations App | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-047 | 격리 gh 실행기와 실행 수명주기 | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-048 | W-010 GitHub Command Center 수직 슬라이스 | REL-007 | todo | - | - | - | CR-005 신규 |
| WP-049 | PR 작업 (W-011) | REL-008 | todo | - | - | - | CR-005 신규 |
| WP-050 | Issue·Discussion 작업 (W-012) | REL-008 | todo | - | - | - | CR-005 신규 |
| WP-051 | 저장소 작업 (W-013) | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-052 | Actions·워크플로·실행·캐시 (W-014) | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-053 | 릴리스·프로젝트 작업 (W-015, W-016) | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-054 | 시크릿·변수·레이블·룰셋·키 (W-018) | REL-010 | todo | - | - | - | CR-005 신규 |
| WP-055 | Codespace·Gist·Attestation·고급 도구 (W-017, W-019, W-022) | REL-010 | todo | - | - | - | CR-005 신규 |
| WP-056 | gh API 탐색기 (W-020) | REL-010 | todo | - | - | - | CR-005 신규 |
| WP-057 | 임시 workspace와 로컬 git 작업 | REL-009 | todo | - | - | - | CR-005 신규 |
| WP-058 | Recipe 빌더 (W-023) | REL-011 | todo | - | - | - | CR-005 신규 |
| WP-059 | capability 드리프트와 정책 관리 (A-005, A-006) | REL-011 | todo | - | - | - | CR-005 신규 |
| WP-060 | 전체 parity 검증 | REL-011 | todo | - | - | - | CR-005 신규 |

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
| FR-SEQ-001 | WP-002, WP-020, WP-021 | `packages/db/migrations/002_sequence.up.sql`, `packages/db/src/advisory-lock.ts`, `packages/db/src/repositories/merge-sequence.ts`, `packages/db/src/repositories/sequence-space.ts` | `packages/db/integration/advisory-lock.test.ts` (AC-6), `packages/db/integration/seed.test.ts` (AC-3) | partial (스키마·채번 동시성 제어. 실제 채번 로직은 WP-020) |
| FR-SEQ-002 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-003 | WP-023, WP-025 | - | - | not_started |
| FR-SEQ-004 | WP-024, WP-026 | - | - | not_started |
| FR-SEQ-005 | WP-022 | - | - | not_started |
| FR-SEQ-006 | WP-002, WP-041 | `packages/db/migrations/002_sequence.up.sql` (`safe_marker_current_uk`) | `packages/db/integration/constraints.test.ts` (AC-1) | partial (스키마만. 화면·API는 WP-041) |
| FR-SEQ-007 | WP-042 | - | - | not_started |
| FR-REL-001 | WP-027 | - | - | not_started |
| FR-REL-002 | WP-024 | - | - | not_started |
| FR-REL-003 | WP-029, WP-031 | - | - | not_started |
| FR-REL-004 | WP-030, WP-031 | - | - | not_started |
| FR-REL-005 | WP-030, WP-031 | - | - | not_started |
| FR-REL-006 | WP-030, WP-031 | - | - | not_started |
| FR-REL-007 | WP-031 | - | - | not_started |
| FR-REL-008 | WP-043 | - | - | not_started |
| FR-ING-001 | WP-004 | `apps/ingest-gateway/src/{signature,ingest,store,payload,events,archive,metrics,server,config}.ts`, `apps/pipeline-worker/src/outbox-relay.ts` | `apps/ingest-gateway/src/{signature,payload,ingest,server}.test.ts`, `apps/ingest-gateway/integration/{webhook,idempotency,load,enqueue}.test.ts`, `apps/pipeline-worker/integration/outbox-relay.test.ts` | verified (AC-1~AC-6 전부. AC-4는 발행 포함 부하 1000건 p95 35.6ms) |
| FR-ING-002 | WP-002, WP-004, WP-008 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/repositories/raw-event.ts`, `packages/db/src/advisory-lock.ts`, `apps/ingest-gateway/src/{store,payload}.ts`, `packages/domain/src/events.ts` | `packages/db/integration/constraints.test.ts`, `apps/ingest-gateway/integration/{webhook,idempotency}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-4에 더해 AC-5 결정론적 문서 ID — 같은 이벤트를 두 번 투영해도 문서가 하나다) |
| FR-ING-003 | WP-002, WP-004 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/partitions.ts`, `packages/db/src/repositories/raw-event.ts`, `apps/ingest-gateway/src/archive.ts` | `packages/db/integration/{partitions,constraints}.test.ts`, `apps/ingest-gateway/integration/webhook.test.ts` | partial (AC-1·AC-2·AC-4 충족. AC-3 원본만으로 재색인은 WP-008·WP-033) |
| FR-ING-004 | WP-006, WP-007 | `packages/github/src/{config,redact,errors,jwt,rate-limit,token-provider,token-pool,scheduler,transport,client}.ts`, `apps/pipeline-worker/src/{enrich,webhook-target,metrics}.ts`, `packages/bus/src/{types,backoff,redis-streams,in-memory}.ts`, `packages/domain/src/{events,event-id}.ts` | `packages/github/src/{redact,rate-limit,scheduler,jwt,config}.test.ts`, `packages/github/testing/{mock-ghe,client,smoke-real-ghe}.test.ts`, `apps/pipeline-worker/src/webhook-target.test.ts`, `apps/pipeline-worker/integration/worker/enrich.test.ts`, `packages/bus/integration/contract.ts` | verified (AC-1~AC-4 전부. AC-5 미러 우선 커밋 조회는 WP-020 — 지금은 ADR-005의 API 폴백 경로만) |
| FR-ING-005 | WP-005, WP-008 | `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts`, `packages/es/src/{upsert,bootstrap,indices}.ts`, `apps/pipeline-worker/src/{project,documents,enriched-payload,metrics}.ts`, `packages/domain/src/events.ts` | `packages/es/src/upsert.test.ts`, `packages/es/integration/bootstrap.test.ts`, `apps/pipeline-worker/src/{documents,enriched-payload}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | verified (AC-1~AC-5 전부. AC-5는 개발 데이터셋 20건 기준 전량 10초 버킷 이내) |
| FR-ING-006 | WP-019 | - | - | not_started |
| FR-ING-007 | WP-002, WP-007, WP-008, WP-009 | `packages/db/migrations/{001_ingestion,006_dead_letter}.up.sql`, `packages/db/src/repositories/dead-letter.ts`, `packages/bus/src/{backoff,ingest}.ts`, `apps/pipeline-worker/src/{enrich,project}.ts`, `apps/search-api/src/ops/{dead-letters,routes}.ts`, `apps/search-api/src/{config,metrics}.ts` | `packages/db/integration/dead-letter.test.ts`, `apps/search-api/integration/ops/dead-letter.test.ts`, `apps/pipeline-worker/integration/worker/{enrich,project}.test.ts`, `packages/bus/integration/contract.ts` | verified (AC-1~AC-5 전부. AC-4 재처리 멱등은 재투입 payload의 `delivery_id` 보존으로, 문서 수준은 WP-008의 결정론적 ID 시험으로 각각 검증) |
| FR-ING-008 | WP-035 | - | - | not_started |
| FR-ING-009 | WP-008, WP-010, WP-040 | `apps/pipeline-worker/src/{project,documents}.ts`, `packages/db/src/repositories/repository.ts` | `apps/pipeline-worker/integration/worker/project.test.ts`, `apps/pipeline-worker/src/documents.test.ts` | partial (AC-3 `repository_archived` 표시와 AC-4 미등록 저장소 투영 차단만. 등록·해제 API와 감사 기록은 WP-010·WP-040) |
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
| FR-AUTH-004 | WP-002, WP-039 | `packages/db/migrations/004_app_state.up.sql`, `packages/db/migrations/005_roles.up.sql` | `packages/db/integration/audit-grants.test.ts` (AC-3) | partial (감사 테이블과 롤 권한. 기록·조회는 WP-039) |
| FR-ADMIN-001 | WP-010, WP-040 | - | - | not_started |
| FR-ADMIN-002 | WP-002, WP-019, WP-040 | `packages/db/migrations/004_app_state.up.sql` (`job_active_uk`), `packages/db/src/repositories/job.ts` | `packages/db/integration/constraints.test.ts` (AC-4) | partial (동시 실행 제약. 콘솔은 WP-040) |
| FR-ADMIN-003 | WP-028, WP-040 | - | - | not_started |
| NFR-001 | WP-013, WP-014, WP-023, WP-037 | - | - | not_started |
| NFR-002 | WP-004, WP-005, WP-008 | `apps/ingest-gateway/src/{server,metrics}.ts`, `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts`, `apps/pipeline-worker/src/{project,metrics}.ts` | `apps/ingest-gateway/integration/{load,enqueue}.test.ts`, `apps/pipeline-worker/integration/worker/project.test.ts` | partial (발행까지 포함한 수신 응답 p95 38.3ms / 예산 300ms. 수신→색인 지연은 `ingestion_lag_seconds`로 계측하며 개발 데이터셋에서 전량 10초 이내. 운영 규모 측정은 REL-001 성능 게이트) |
| NFR-003 | WP-002, WP-003 | `packages/db/migrations/*`, `packages/db/src/partitions.ts`, `packages/es/src/indices.ts` | `packages/db/integration/partitions.test.ts`, `packages/es/integration/bootstrap.test.ts` | partial (PostgreSQL 파티션 + ES 샤드 수. 용량 실측은 REL-001 이후) |
| NFR-004 | WP-010 (인프라) | - | - | not_started |
| NFR-005 | WP-003, WP-004, WP-012 | `packages/es/src/mappings/*` (`dynamic: strict`), `apps/ingest-gateway/src/signature.ts` | `packages/es/integration/behavior.test.ts`, `apps/ingest-gateway/src/signature.test.ts` | partial (매핑 수준 차단 + 웹훅 서명 검증·로그 금지 항목. 세션 인증은 WP-012) |
| NFR-006 | WP-039 | - | - | not_started |
| NFR-007 | WP-015 ~ WP-018, WP-025, WP-038 | - | - | not_started |
| NFR-008 | WP-001, WP-035, WP-040 | `package.json` 스크립트, `scripts/lint-deps.mjs`, `.github/workflows/ci.yml`, `docker-compose.yml`, 각 앱 `src/server.ts`의 `GET /healthz` | `scripts/lint-deps.test.ts`, `apps/*/src/server.test.ts` | partial (WP-001분: 재현 가능한 검증 파이프라인과 헬스 엔드포인트. 롤백 절차·재색인 소요는 WP-035·WP-040) |
| FR-GH-001 | WP-045, WP-060 | - | - | not_started |
| FR-GH-002 | WP-047, WP-048 | - | - | not_started |
| FR-GH-003 | WP-048 | - | - | not_started |
| FR-GH-004 | WP-049 ~ WP-055 | - | - | not_started |
| FR-GH-005 | WP-058 | - | - | not_started |
| FR-GH-006 | WP-047, WP-052 | - | - | not_started |
| FR-GH-007 | WP-053, WP-057 | - | - | not_started |
| FR-GH-008 | WP-046 | - | - | not_started |
| FR-GH-009 | WP-048, WP-054, WP-059 | - | - | not_started |
| FR-GH-010 | WP-056 | - | - | not_started |
| FR-GH-011 | WP-045, WP-059 | - | - | not_started |
| FR-GH-012 | WP-048 | - | - | not_started |
| FR-GH-013 | WP-055, WP-059 | - | - | not_started |
| NFR-009 | WP-045, WP-060 | - | - | not_started |
| NFR-010 | WP-047, WP-054 | - | - | not_started |
| NFR-011 | WP-047 | - | - | not_started |
| NFR-012 | WP-048 | - | - | not_started |

## 5. 편차 로그 (DEV)

문서와 코드가 어긋났을 때 등록한다. 유형: `문서 오류` / `범위 공백` / `기술 제약`.

| DEV ID | 발견일 | 발견 내용 | 관련 FR/WP | 유형 | 연결 CR | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| DEV-001 | 2026-08-19 | `docker compose up -d`를 WP-001 환경에서 실행 검증하지 못했다. 컨테이너 레지스트리 블롭 호스트(`production.cloudfront.docker.com`)와 `docker.elastic.co`가 실행 환경의 이그레스 정책에서 403으로 차단된다. `docker compose config`는 통과하고 compose 정의 자체는 인프라 4장·8장과 일치한다. 우회하지 않았고 이미지 태그도 바꾸지 않았다 | WP-001 | 기술 제약 | 불필요 (설계 변경 없음) | open — 레지스트리 접근이 되는 환경에서 재검증 필요 |
| DEV-002 | 2026-08-19 | 인프라 3장은 `pipeline-worker`의 health check를 "하트비트"로 적었으나 WP-001 DoD는 "각 앱 헬스체크가 200을 반환한다"를 요구한다. 워커에 `node:http` 기반 `GET /healthz`를 두어 둘을 모두 만족시켰다. ADR-001의 "워커는 순수 Node 프로세스" 결정을 지키려고 Fastify를 넣지 않았다 | WP-001 | 문서 오류 | 불필요 (인프라 8장에 표기 반영) | resolved |
| DEV-004 | 2026-08-19 | 데이터 모델 3.1의 `raw_event_delivery_uk`는 `PRIMARY KEY (delivery_id, received_at)`와 컬럼·순서가 같은 중복 인덱스다. 5억 행·초당 2000 이벤트(NFR-002) 규모에서 중복 인덱스는 삽입 비용을 그대로 두 배로 만든다. 마이그레이션 001에서 생성하지 않았다 — 조용히 뺀 것이 아니라 여기 기록해 CR 판단에 올린다 | WP-002 / FR-ING-002 | 문서 오류 | **CR-006** | **resolved (2026-08-20)** — 데이터 모델 3.1에서 중복 인덱스를 제거하고 사유를 주석으로 남겼다. 코드는 이미 생성하지 않고 있었다 |
| DEV-005 | 2026-08-19 | 데이터 모델 3.4의 `audit_record`는 `PRIMARY KEY (audit_id)` + `PARTITION BY RANGE (occurred_at)`인데, PostgreSQL은 파티션 테이블의 유니크 제약이 파티션 키를 포함하도록 요구한다. 그대로 쓰면 마이그레이션이 실행되지 않는다. `PRIMARY KEY (audit_id, occurred_at)`으로 구현했다 | WP-002 / FR-AUTH-004 | 문서 오류 | **CR-006** | **resolved (2026-08-20)** — 데이터 모델 3.4의 PK를 `(audit_id, occurred_at)`으로 정정했다. 코드는 이미 그렇게 구현되어 있었다 |
| DEV-006 | 2026-08-19 | WP-002의 검증 방법은 testcontainers PostgreSQL이지만 이 환경은 컨테이너 이미지를 받을 수 없다(DEV-001). 통합 테스트가 접속 정보를 환경 변수(`DATABASE_URL` 또는 `POSTGRES_*`)에서 읽도록 만들고 네이티브 PostgreSQL 16.13으로 검증했다. CI는 서비스 컨테이너로 같은 테스트를 돌린다. testcontainers 래퍼 자체는 아직 도입하지 않았다 | WP-002 | 기술 제약 | 불필요 (검증 수단만 다름) | open — testcontainers 도입은 ES가 함께 필요한 WP-003에서 재검토 |
| DEV-007 | 2026-08-20 | 데이터 모델 4장은 공통 설정을 "모든 엔티티 인덱스"에 적용한다고 적었으나, 그 설정의 `index.sort.field`에 `merge_seq`가 들어 있고 `prs-links` 매핑에는 `merge_seq`가 없다. Elasticsearch는 매핑에 없는 필드로 `index.sort`를 걸면 인덱스 생성을 거부하므로 문서 그대로는 실행되지 않는다. `prs-links`에만 `index.sort` 없는 설정을 적용했다. 간선은 시퀀스 축으로 정렬할 이유도 없다 — 조회는 `from_id`/`to_id` 기준이다 | WP-003 / FR-ING-005 | 문서 오류 | **CR-007** | **resolved (2026-08-20)** — 데이터 모델 4장에 `index.sort` 적용 범위를 `merge_seq` 보유 인덱스로 명시했다. 코드는 이미 그렇게 구현되어 있었다 |
| DEV-008 | 2026-08-20 | WP-003의 검증 방법은 실제 Elasticsearch 대상 통합 테스트지만, 이 실행 환경은 `docker.elastic.co`와 `artifacts.elastic.co`가 이그레스 정책에서 403으로 차단되고 네이티브 설치본도 없어 ES를 띄울 수 없다. DoD 4항(컴파일 타임 가드)만 로컬에서 검증했고 나머지 4항은 CI의 Elasticsearch 서비스 컨테이너에서 검증한다. 우회하거나 목으로 대체하지 않았다 | WP-003 | 기술 제약 | 불필요 (검증 수단만 다름) | **resolved (2026-08-20)** — WP-008 작업 중 `mirror.gcr.io/library/elasticsearch:8.19.0`이 이그레스 정책을 통과하는 것을 확인했다. `docker.elastic.co`와 Docker Hub 블롭 호스트는 여전히 403이지만 gcr 미러 경로가 열려 있다. 실제 ES 8.19.0을 띄워 `packages/es` 통합 스위트 19건을 전부 돌렸고, 그 과정에서 DEV-021(별칭 고정 라우팅)이 드러났다 — 목으로 대체했다면 발견하지 못했을 결함이다 |
| DEV-009 | 2026-08-20 | 데이터 모델 3.1은 `raw_event`의 멱등 제약을 "기본 키가 그대로 강제한다"고 적었으나 이 파티션 구성에서는 성립하지 않는다. PostgreSQL은 파티션 테이블의 유일 제약이 파티션 키를 포함하도록 요구해 기본 키가 `(delivery_id, received_at)`이고, GHE 재전송은 수신 시각이 달라 충돌하지 않는다 — 문서대로 "INSERT 충돌을 잡아 중복 처리"만 구현하면 같은 `delivery_id`가 두 행이 되어 FR-ING-002 AC-2와 WP-004 DoD 3이 깨진다. 실제로 조건부 INSERT를 빼고 돌려 확인했다(동시 8건 → 8행). 게이트웨이가 같은 트랜잭션에서 `delivery_id` advisory lock을 잡고 존재 검사와 INSERT를 한 문장으로 묶어 강제한다. 기본 키 충돌은 마지막 방어선으로 남겼다. **마이그레이션 001~005는 건드리지 않았다** | WP-004 / FR-ING-002 | 문서 오류 | **CR-007** | **resolved (2026-08-20)** — 데이터 모델 3.1에 파티션 유일 제약의 한계와 게이트웨이 멱등 저장 SQL을 명시했다. SRS FR-ING-002 AC-1이 요구하는 결과(중복 저장 차단)는 그대로 충족되므로 요구사항은 변경하지 않았다 |
| DEV-010 | 2026-08-20 | 비동기 문서 2장의 스트림 표는 동시성을 다섯 스트림에 숫자로 적었지만 `prs:sequence`만 "시퀀스 공간당 1 (advisory lock)"이라고만 적혀 있어 전체 파티션 수를 알 수 없다. Redis Streams 어댑터는 토픽을 물리 스트림 N개로 펴므로 이 숫자가 반드시 필요하다. 순서 보장은 advisory lock이 이미 하므로 이 값은 처리량 조절값이며, 관계 파생과 같은 8을 코드 기본값으로 두고 `PRS_PARTITIONS_prs:sequence` 환경 변수로 덮어쓸 수 있게 했다. **확정한 것이 아니라 기본값을 둔 것이다** — 운영 실측 뒤 사용자가 정하면 코드 변경 없이 반영된다 | WP-005 / FR-SEQ-001 | 문서 공백 | 미등록 — 사용자 결정 후 비동기 문서 2장에 반영할 CR 필요 | open |
| DEV-011 | 2026-08-20 | CR-005의 gh 인벤토리 수치 중 positional placeholder만 실측과 달랐다. 문서는 261개로 적었으나 gh 2.97.0을 다시 설치해 재실측한 값은 230개다. `gh help reference`의 명령 헤딩 기준과 command node 228개 각각에 `gh <path> --help`를 실행한 USAGE 기준이 모두 230으로 일치한다. 나머지 수치(command node 228, leaf 196, 그룹 32, command 고유 flag 1,034, `--json` 지원 41)는 CR-005와 **정확히 일치**했다. 261이 어떻게 나왔는지는 당시 스크립트가 저장소에 없어 재현할 수 없다 — 추정하지 않고 실측값으로 정정했다 | CR-008 / FR-GH-001, NFR-009 | 문서 오류 | **CR-008** | **resolved (2026-08-20)** — SRS §9.8 실측 표와 NFR-009 게이트를 230으로 정정하고, 새로 측정한 차원(inherited flag 312, short alias 625, 반복 가능 37, `--json` 필드 707, alias 보유 command 44)을 함께 기록했다 |
| DEV-012 | 2026-08-20 | 재시도 횟수가 문서 간에 어긋난다. FR-ING-007 AC-1은 "최대 5회 + 1/2/4/8/16초", 비동기 5.1도 5회, WP-007 DoD도 "5회 소진 시 DLQ"인데 **FR-ING-004의 예외/실패 처리만 "재시도 3회"**로 적혀 있다. 승인된 표준 재시도 정책은 하나여야 한다 | WP-007 / FR-ING-004, FR-ING-007 | 문서 오류 | **CR-010** | **resolved (2026-08-20)** — FR-ING-004 표기를 5회로 정정. 제품 동작 변경이 아니라 이미 승인된 표준 정책과의 정합성 수정이다 |
| DEV-013 | 2026-08-20 | `EVT-ING-002`가 `{delivery_id, repository_id, entity_kind, entity_id, enrichment_pending, correlation_id}`만 나른다. 그런데 WP-008 투영은 `changed_files_count`·`additions`·`deletions`·`first_review_wait_seconds`·커밋 SHA 목록을 필요로 한다. 마이그레이션 001~005에 보강 결과 저장 테이블이 없고, 그 값을 담을 곳이 어디에도 없다 — 이대로면 WP-008이 GitHub API를 다시 호출해야 하고 그것은 FR-ING-004의 rate limit 설계를 무의미하게 만든다 | WP-007 / FR-ING-004, FR-ING-005 | 범위 공백 | **CR-010** | **resolved (2026-08-20)** — `EVT-ING-002`를 self-contained bounded 이벤트로 확정하고 `@prs/domain`에 타입을 뒀다. 원본 웹훅 전량·patch/diff·소스 코드·토큰은 싣지 않으며 커밋 250건·파일 3000건 상한을 유지한다 |
| DEV-014 | 2026-08-20 | `EventBus` 핸들러 계약이 "정상 반환=ack, 던짐=재전달" 둘뿐이다. 재전달 간격은 어댑터 설정값 `claimIdleMs`(기본 30초) 고정이고 `delivery_count`는 재전달을 무조건 센다. 그래서 (a) 1/2/4/8/16초 백오프를 표현할 수 없고 (b) GitHub이 알려 준 `retryAt`(예: 10분 뒤)까지 미룰 수 없으며 (c) rate limit 대기 중 30초마다 재전달되어 **10분이 되기 전에 재시도 5회를 소진하고 DLQ로 간다**. rate limit은 실패가 아닌데 실패로 집계되는 셈이다 | WP-007 / FR-ING-004 AC-2, FR-ING-007 AC-1 | 범위 공백 | **CR-010** | **resolved (2026-08-20)** — 핸들러가 처분(`HandlerDisposition`)을 돌려줄 수 있게 작은 확장을 더했다. `retry`(표준 백오프), `defer`(지정 시각까지 미루며 재시도 예산을 소비하지 않음), `dead_letter`(종료 후 ack). 새 큐 프레임워크를 만들지 않았고 Redis·인메모리 두 어댑터가 같은 계약을 통과한다 |
| DEV-015 | 2026-08-20 | WP-006의 `TokenPool`은 `org → installationId` binding을 요구하는데, `pipeline-worker`가 기동할 때 그 binding을 **어디서 얻는지가 문서에도 코드에도 없다**. 임의의 고정 installation ID를 코드에 넣거나 특정 개발 환경 값에 묶으면 다른 조직 저장소가 조용히 처리되지 않는다 | WP-007 / FR-ING-004 | 범위 공백 | **CR-010** | **resolved (2026-08-20)** — 환경 변수 `GHE_INSTALLATIONS`(`org:installationId` 쉼표 구분)를 1차 출처로 정하고 파싱·검증을 `@prs/github`에 뒀다. 등록되지 않은 조직의 이벤트는 조용히 넘기지 않고 non-retryable 실패로 분류해 DLQ에 사유를 남긴다. 장래 저장소 등록(FR-ING-009) 기반 조회로 대체할 수 있게 출처를 한 곳으로 모았다 |
| DEV-016 | 2026-08-20 | `prs:ingest`에는 지원 이벤트 9종이 모두 들어오는데 소비자는 `enrich` 그룹 하나다. 시스템 아키텍처 6.1은 "`push` 이벤트면 `sequence` 워커가 채번한다"고 적었지만 `push` 이벤트가 `prs:ingest`에서 `prs:sequence`로 어떻게 넘어가는지는 어디에도 없다. `EVT-AUTH-001`의 발행자는 게이트웨이로 되어 있어 `member`/`team`/`repository`도 이 경로가 아니다 | WP-007 / FR-SEQ-001, FR-AUTH-003 | 범위 공백 | 미등록 — 라우팅을 소유한 WP-021(시퀀스)·권한 WP에서 결정할 CR 필요 | open — WP-007은 PR 이외 이벤트를 처리하지 않고 ack한다. **원본은 `raw_event`에 남아 있으므로 유실이 아니다**(ADR-004: PostgreSQL이 시스템 오브 레코드). 다만 소비자가 생기기 전까지 그 이벤트들은 진행되지 않는다 |
| DEV-017 | 2026-08-20 | WP 검증 방법이 모두 `pnpm <스크립트> -- <필터>` 형태인데 **이 형태는 필터로 동작하지 않는다**. vitest 4의 CLI 파서(cac)는 `--` 뒤 인자를 위치 인자가 아니라 `argv['--']`에 담으므로 필터가 비어 스위트 전량이 돈다. `pnpm test:integration -- worker/enrich`는 통합 스위트 18개 파일을 전부 돌리며, 그것을 "해당 시험이 통과했다"고 읽으면 실제로 무엇이 검증됐는지와 어긋난다. WP-004·WP-005·WP-006 검증 기록이 같은 현상을 세 번 적어 두고도 출처 문서를 고치지 않았다 | WP-004, WP-005, WP-006, WP-007 / 전 WP 검증 방법 | 문서 오류 | 미등록 — 문서 표기 정정이라 CR 불요(작업 패키지·검증 계획 모두 `review` 상태) | **resolved (2026-08-20)** — `../40_delivery/pr_search_work_packages.md` 63줄과 `pr_search_release_validation_plan.md` 3줄에서 `--`를 제거해 실제로 필터가 걸리는 형태로 고쳤다. WP-007 통합 시험은 `apps/pipeline-worker/integration/worker/enrich.test.ts`에 두어 문서가 적은 `worker/enrich` 필터가 실제로 그 파일을 고르게 했다 (`pnpm test:integration worker/enrich` → 파일 1개, 24건) |
| DEV-018 | 2026-08-20 | `EVT-ING-002`의 `pull_request`가 `number, title, state, merged, merged_at, merge_commit_sha, author, head_ref, head_sha, base_ref, base_sha` 11개만 나른다. 그런데 **WP-008 DoD가 요구하는 사전 계산 필드 `lead_time_seconds`(= `merged_at` − `created_at`)와 `first_review_wait_seconds`(= 최초 리뷰 − `created_at`)는 `created_at` 없이 계산할 수 없다.** PR 매핑(ENT-CORE-002)이 선언한 `body`·`draft`·`labels`·`updated_at`·`closed_at`도 출처가 없다. CR-010이 `EVT-ING-002`를 self-contained로 만든 목적이 "투영이 GitHub API를 다시 부르지 않는 것"인데, 이 상태로는 투영이 `raw_event.payload`를 다시 파싱하거나 PR API를 다시 불러야 한다 | WP-008 / FR-ING-005, FR-ING-004 | 범위 공백 | **CR-011** | **resolved (2026-08-20)** — 경계를 "이번 WP가 쓰는 필드"가 아니라 **"PR 문서 매핑이 선언한 PR 고유 필드 전부"**로 정하고 `created_at`, `updated_at`, `closed_at`, `body`, `draft`, `labels`를 `PullRequestSummary`·`EnrichedPullRequest`에 더했다. 웹훅 payload와 PR API 응답에 모두 이미 있어 API 호출이 늘지 않는다. patch/diff 본문·소스 코드·토큰은 여전히 싣지 않는다 |
| DEV-019 | 2026-08-20 | 데이터 모델 5장의 조건부 업서트 스크립트가 `params.doc`의 모든 키를 단순 대입한다. `commit.pull_request_numbers`는 데이터 모델 5장 자신이 **N:M**이라고 적은 관계인데, 커밋 하나가 두 PR에 속하면 나중 이벤트가 앞 PR 번호를 지운다. 게다가 버전 비교가 앞서므로 **오래된 이벤트는 noop이 되어 자기 소속을 아예 추가하지 못한다** — 어느 순서로 와도 한쪽을 잃는다. FR-SRCH-002(SHA → PR)의 핵심 기능이 조용히 깨지는 자리다 | WP-008 / FR-SRCH-002, FR-ING-005 AC-1 | 문서 오류 | **CR-011** | **resolved (2026-08-20)** — 스크립트를 상태 필드(`params.doc`, 버전 비교 대상)와 누적 필드(`params.union`, 버전과 무관하게 항상 합집합)로 나눴다. 집합 소속은 단조 증가하고 순서에 무관하므로 버전 비교의 대상이 아니다. 데이터 모델 5장 스크립트를 실제 구현과 일치시켰다 |
| DEV-020 | 2026-08-20 | FR-ING-009 AC-4는 "미등록 저장소의 웹훅 이벤트는 원본 보관은 하되 투영 처리는 하지 않는다"고 정했으나 **FR-ING-005에는 그 규칙이 없다.** 투영은 `org_id`·`visibility`·`repository`를 `repository` 테이블에서만 얻으므로 미등록 저장소로 문서를 만들면 그 필드들이 비고, 그런 문서는 ADR-008의 필수 접근 범위 필터(`terms org_id` / `terms repository_id`)에 걸리지 않는다 — 검색되지 않는 문서가 인덱스에 남는다. 투영 워커가 이 경우를 어떻게 처분하는지(ack인지 DLQ인지)도 어디에도 없었다 | WP-008 / FR-ING-005, FR-ING-009 AC-4, FR-AUTH-002 | 범위 공백 | **CR-011** | **resolved (2026-08-20)** — FR-ING-005 예외/실패 처리에 미등록 저장소 규칙을 명시했다. 투영은 문서를 만들지 않고 ack하며, **실패가 아니므로 실패 대기열로 보내지 않는다**. 원본은 `raw_event`에 남아 있어 등록 후 백필(FR-ING-006)로 채울 수 있다 |
| DEV-021 | 2026-08-20 | WP-003의 부트스트랩이 별칭에 `routing: 'repository_id'`를 걸었다. **Elasticsearch 별칭의 `routing`은 필드 이름이 아니라 고정 라우팅 값이다.** 그래서 (a) 이 별칭으로 색인된 모든 문서가 문자열 `"repository_id"` 하나가 가리키는 **단일 샤드**로 몰려 ADR-003의 샤딩 설계가 정반대로 뒤집히고, (b) 문서별 `_routing`을 준 요청은 `illegal_argument_exception`(`Alias [prs-commits] has index routing associated with it`)으로 **거부된다**. WP-008 투영은 문서마다 `repository_id` 값을 라우팅으로 주므로 색인이 통째로 실패했다. WP-003의 DoD 시험이 `index_routing: 'repository_id'`를 **기대값으로 못 박아** 결함을 그대로 굳혀 두었다 — 별칭 메타데이터만 보고 문서를 실제로 색인해 보지 않았기 때문이다 | WP-003, WP-008 / FR-ING-005, ADR-003 | 구현 결함 | 불필요 (문서가 옳고 코드가 틀렸다) | **resolved (2026-08-20)** — `putAlias`에서 `routing`을 제거했다. `_routing`은 색인·조회 요청마다 `repository_id` **값**으로 준다. WP-003 시험을 "별칭에 고정 라우팅이 없다" + "문서별 라우팅으로 색인하고 같은 라우팅으로 되찾는다"로 바꿨다. 배포된 클러스터가 없어 기존 별칭 마이그레이션은 필요 없다 |
| DEV-022 | 2026-08-20 | `dead_letter`에 `(delivery_id, stage)` 유일 제약이 없고 `recordDeadLetter`가 항상 INSERT한다. 그래서 재처리가 다시 실패할 때마다 `reprocess_count = 0`인 **새 행**이 생긴다. FR-ING-007 예외 처리의 "동일 이벤트가 3회 재처리 실패하면 보류 상태로 전환"은 한 행에 누적돼야 성립하므로 **이 상태로는 `held`에 영원히 닿지 않는다**. AC-5의 100건 경보도 서로 다른 이벤트 수가 아니라 실패 횟수를 세어 같은 이벤트 하나가 임계를 넘길 수 있다. `EVT-ING-004`는 이미 멱등 키를 `(delivery_id, stage)`로 정해 두었는데 저장 계층이 그것을 강제하지 않았다 | WP-009 / FR-ING-007 AC-2·AC-5, EVT-ING-004 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 유일 제약을 걸고 기록을 업서트로 바꿨다. 충돌 시 상태 전이를 한 문장으로 정의했다 — `reprocessing`에서 온 충돌만 `reprocess_count`를 올린다(재처리가 실패했다는 뜻), `resolved`에서 온 충돌은 0으로 되돌린다(이전 주기를 물려받지 않는다) |
| DEV-023 | 2026-08-20 | `dead_letter.state`가 `pending`/`reprocessing`/`held` 셋뿐이라 **재처리 성공을 표현할 자리가 없다.** 재투입은 비동기라 API가 응답할 시점에 파이프라인은 아직 돌지도 않았고, 성공한 행을 `reprocessing`으로 두면 경보 임계(100건)를 영구히 잠식한다. 행을 지우면 데이터 모델 9장이 이 표를 90일 보존 대상으로 둔 것과 어긋나고 "무엇이 왜 실패했다가 언제 풀렸는지"라는 운영 기록이 사라진다 | WP-009 / FR-ING-007 AC-3·AC-5 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 종료 상태 `resolved`를 더했다. 판정 지점은 투영이 `raw_event.processed_at`을 찍는 자리다 — 이벤트가 끝까지 갔다는 증거가 그곳 말고 없다. 조회 API가 기본적으로 `resolved`를 빼고 보여 준다 |
| DEV-024 | 2026-08-20 | JOB-ING-009(실패 대기열 재처리)의 워커가 `batch`로 지정돼 있는데 **`batch` 역할과 `prs:batch` 스트림은 WP-019가 세운다.** WP-009의 선행은 WP-007·WP-008뿐이라 문서를 그대로 따르면 착수 자체가 불가능하다. 진행률 이벤트 `EVT-JOB-001`도 같은 이유로 소비자가 없다 | WP-009, WP-019 / FR-ING-007 AC-3, JOB-ING-009 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 재처리는 "행을 읽어 스트림에 다시 넣는" I/O 가벼운 작업이라 `ops` 모듈이 요청 안에서 직접 수행한다(1회 최대 500건). 새 워커 역할을 앞당겨 만들지 않았다. `EVT-JOB-001` 진행률과 10분 타임아웃은 `batch`가 생기는 WP-019부터 적용한다 |
| DEV-025 | 2026-08-20 | API-ADM-003의 권한은 `operator`인데 **역할 판정은 WP-012(REL-002)가 세운다.** WP-009는 REL-001이므로 그 사이에 재처리를 실행할 수 있는 변경 API가 인증 없이 열린다. REL-001의 보안 범위는 "웹훅 HMAC 검증, 시크릿 배치"뿐이라 사용자 신원 자체가 아직 없다 | WP-009, WP-012 / FR-ING-007 AC-3, API-ADM-003, FR-AUTH-001 | 범위 공백 | **CR-012** | **resolved (2026-08-20)** — 임시 통제로 공유 토큰(`ADMIN_API_TOKEN`, `Authorization: Bearer`)을 요구하고 **토큰이 설정되지 않으면 경로를 등록하지 않는다** — 인증 수단 없이 열린 변경 API를 두는 것보다 없는 편이 낫다. OIDC 세션과 역할 판정이 서는 WP-012가 이 통제를 대체한다. 감사 기록은 WP-009 범위 밖이며(WP-010 DoD가 소유) 신원이 없는 상태에서 `audit_record.user_id`를 지어내지 않았다 — 7장에 한계로 남겼다 |
| DEV-026 | 2026-08-20 | `EVT-ING-004 ingestion.failed`가 카탈로그에 있으나 **토픽도 발행자도 소비자도 없다.** 지정된 소비자 `ops`는 스트림 소비자가 아니라 `dead_letter` 테이블을 읽는 조회 모듈이고, AC-5의 경보 경로는 WP-009 범위가 정한 `dead_letter_total{state}` 지표가 맡는다. 지금 토픽을 만들면 소비자 없는 스트림이 하나 생길 뿐이다 | WP-009 / FR-ING-007, EVT-ING-004 | 범위 공백 | 미등록 — 알림 소비자를 소유한 REL-005 운영 고도화에서 결정할 CR 필요 | open — 워커가 `dead_letter` 행을 **동기적으로** 남기므로 이벤트가 없다고 기록이 유실되지는 않는다. 발행이 필요해지는 시점은 테이블 폴링이 아닌 실시간 알림 소비자가 생길 때다 |
| DEV-027 | 2026-08-20 | `DeadLetterRow.dead_letter_id`와 `JobRow.job_id`가 `string`으로 선언돼 있으나 **런타임 값은 숫자다.** 두 컬럼 모두 `BIGSERIAL`(int8)이고 `@prs/db`의 타입 파서가 int8을 숫자로 바꾸기 때문이다. WP-005가 `repository_id`에서 같은 문제를 잡고 파서를 넣었는데 이 두 리포지터리의 선언은 그대로 남았다. `dead_letter_id`는 API-ADM-003의 응답 본문과 재처리 요청 본문에 그대로 나가는 값이라 **타입이 `string`이면 JSON에 `"812"`가 나갈 것처럼 읽히지만 실제로는 `812`가 나가고**, 클라이언트의 `===` 비교와 서버의 파싱이 어긋난다 | WP-009 / ENT-ING-002, API-ADM-003 | 구현 결함 | 불필요 (문서가 옳고 코드가 틀렸다) | **부분 resolved (2026-08-20)** — `dead_letter_id`를 `number`로 정정하고 통합 시험이 `typeof === 'number'`를 고정한다. `JobRow.job_id`는 **open** — 같은 결함이지만 소비자가 아직 없고 잡 모듈을 소유한 WP는 WP-019(백필)·WP-010(지표)이라 그 WP에서 함께 고친다. 여기서 고치면 WP 경계를 넘는다 |
| DEV-028 | 2026-08-21 | `prs-commits` 매핑에 `repository_archived`가 없다. PR 매핑에만 있고 데이터 모델 4.2도 선언하지 않는다. 그런데 소프트 삭제 원칙(데이터 모델 9장)은 "ES 문서에 `repository_archived: true`를 세팅한다"고 일반적으로 적혀 있다. **매핑이 `dynamic: strict`라 없는 필드를 쓰려는 시도는 거부되므로**, 해제한 저장소의 커밋 문서에 표식을 붙일 방법이 아예 없었다. FR-SRCH-002(SHA → PR)가 커밋 문서를 직접 결과로 내놓기 때문에, 표식 없는 커밋 문서는 해제된 저장소를 살아 있는 것처럼 보여 준다 | WP-010, WP-003 / FR-ING-009 AC-3, FR-SRCH-002 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 커밋 매핑과 데이터 모델 4.2에 필드를 더하고, 투영이 PR 문서와 같은 값을 쓴다. 해제 시 이미 색인된 문서는 `update_by_query`로 소급 표시하며 `document_version`은 건드리지 않는다 — 등록 상태는 웹훅이 나르는 엔티티 상태가 아니라 이 시스템이 소유한 운영 상태라 버전 비교의 대상이 아니다 |
| DEV-029 | 2026-08-21 | FR-ADMIN-001 AC-1이 요구하는 **단계별 처리 지연 p50/p95를 `search-api`가 읽을 수 없다.** 그 값의 유일한 생산자는 워커 프로세스 메모리의 `stage_latency_seconds` 히스토그램이고, FR의 예외 처리가 전제하는 "지표 저장소"는 인프라 4장이 "사내 Prometheus 호환"이라고 적은 **외부 의존**이라 개발·CI에 주소가 없다. 워커 복제본 하나의 `/metrics`를 긁는 방법은 그 복제본의 히스토그램일 뿐 클러스터 전체가 아니다 | WP-010 / FR-ADMIN-001 AC-1·AC-2, API-ADM-006 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 항목별로 출처를 나눴다. 수신량·수집 반영 지연 p50/p95·저장소별 상위 10은 PostgreSQL `raw_event`에서 정확히 계산하고(표본이 곧 사실이다), 대기열은 Redis, 실패 대기열은 PostgreSQL, 보강 대기는 ES에서 읽는다. 단계별 지연만 `METRICS_QUERY_URL`이 설정된 경우 질의하고 아니면 `unavailable`로 남긴다. **틀린 답을 자신 있게 내놓지 않는 쪽을 골랐다** |
| DEV-030 | 2026-08-21 | FR-ING-009 AC-5는 "등록·해제는 감사 기록 대상"인데 `audit_record.user_id`는 NOT NULL이고 **넣을 실제 신원이 WP-012(OIDC)까지 없다.** CR-012는 WP-009에서 이 문제를 만나 감사를 WP-010으로 미뤘는데, WP-010의 DoD가 바로 그 감사를 요구한다 — 더 미룰 자리가 없다 | WP-010, WP-012 / FR-ING-009 AC-5, FR-AUTH-004 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 사용자 결정에 따라 CR-012의 공유 토큰을 **이름 붙은 토큰**으로 넓혔다(`ADMIN_API_TOKENS="alice:tok1,bob:tok2"`). 어느 운영자 자격 증명이 실행했는지가 감사 기록에 실제로 남는다. 단일 `ADMIN_API_TOKEN`은 이름 없는 주체로 계속 동작한다. WP-012의 OIDC 신원이 이 통제를 대체한다 |
| DEV-031 | 2026-08-21 | FR-ING-009 AC-1의 "백필 여부"를 받아도 **실행할 워커가 없다.** JOB-ING-004의 워커는 `batch`이고 그 역할과 `prs:batch` 스트림은 WP-019가 세운다. DEV-024와 같은 형태의 시점 문제다 | WP-010, WP-019 / FR-ING-009 AC-1, JOB-ING-004 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — 등록 시 `backfill: true`면 `job` 행을 `type: 'backfill'`, `state: 'queued'`로 넣는다. 요청을 조용히 버리지 않으며 `job_active_uk`가 중복 큐잉을 막는다. 실행은 WP-019부터다 |
| DEV-032 | 2026-08-21 | `pnpm test:e2e`와 `pnpm test:a11y` 스크립트가 **저장소에 없는데 작업 패키지 21곳이 검증 방법으로 참조한다.** WP-010이 그 첫 자리다(`pnpm test:e2e ops-minimal`). DEV-017이 `--` 필터 표기를 고쳤을 때 존재하지 않는 스크립트까지는 보지 않았다 | WP-010 및 화면을 다루는 WP 전반 / 전 WP 검증 방법 | 문서 오류 | **CR-013** (WP-010분만) | **부분 resolved (2026-08-21)** — WP-010은 화면을 만들지 않기로 결정되어(사용자 판단) 검증 방법을 `pnpm test:integration ops/pipeline-status`로 바꿨다. **나머지 20곳은 open** — E2E·접근성 harness는 그것을 처음 필요로 하는 화면 WP(WP-015 이후)가 세우는 것이 맞고, 여기서 harness만 먼저 만들면 쓰는 곳 없는 골격이 된다 |
| DEV-033 | 2026-08-21 | `RepositorySummary`가 `id`·`full_name`·`private`·`default_branch` 넷만 선언한다. 그런데 `repository` 테이블은 `org_id`를 NOT NULL로, `visibility`를 `public|internal|private` CHECK로 요구한다 — 그리고 **ADR-008의 필수 접근 범위 필터가 바로 그 두 필드 위에 서 있다.** 더 나쁜 것은 `private: boolean`으로는 `internal`을 구분할 수 없다는 점이다. 이 제품은 사내 GitHub Enterprise를 대상으로 하므로 저장소 대부분이 `internal`이고, 그것을 `private`로 적으면 접근 범위 판정이 조직 전체에서 어긋난다 | WP-010, WP-006 / FR-ING-009 AC-1, FR-AUTH-002, ADR-008 | 범위 공백 | **CR-013** | **resolved (2026-08-21)** — `RepositorySummary`에 `owner.id`와 `visibility`를 더하고 목 GHES 서버도 함께 넓혀 시험이 실제 응답 모양을 고정하게 했다. 등록은 클라이언트가 보낸 값을 믿지 않고 GHE에 물어서 채운다 |
| DEV-034 | 2026-08-21 | `applyMappings`가 **이미 있는 인덱스를 전혀 건드리지 않는다.** WP-003이 "매핑 변경은 새 버전 인덱스 + 재색인 + 별칭 전환"이라는 규칙을 그렇게 구현했는데, 그 규칙이 **필드 추가까지 묶어 버린다**. Elasticsearch에서 매핑에 새 필드를 더하는 것은 하위 호환 변경이라 재색인이 필요 없고, 재색인이 필요한 것은 기존 필드의 타입·분석기를 바꿀 때다. DEV-028을 고치려고 `repository_archived`를 커밋 매핑에 더했더니 **이미 떠 있는 `prs-commits-v1`이 그것을 모르는 채로 남아** `dynamic: strict`가 색인을 거부했다. 이대로면 `dynamic: strict` 인덱스에 필드 하나를 더할 때마다 전량 재색인을 해야 하고, 그 재색인 기계(WP-035, FR-ING-008)는 아직 없다 | WP-010, WP-003 / FR-ING-005, FR-ING-008 | 구현 결함 | **CR-013** | **resolved (2026-08-21)** — 인덱스가 이미 있으면 `put_mapping`으로 제자리 갱신한다. 하위 호환이 아닌 변경은 `put_mapping`이 `illegal_argument_exception`으로 **거부하므로 조용히 넘어가지 않는다** — 거부되는 그때가 새 버전 인덱스와 재색인이 필요한 자리다. 실제 Elasticsearch 8.19.0에서 확인했다: 필드 추가는 통과하고 WP-003의 기존 DoD 시험 24건도 그대로 통과한다 |
| DEV-003 | 2026-08-19 | `../00_governance/change_control.md` 4장 아키텍처 게이트 기록이 "오류 코드 30종"으로 적혀 있으나 API 계약 6장의 실제 코드는 29종이었다 | WP-001 | 문서 오류 | **CR-006** | **resolved (2026-08-20)** — 게이트 기록을 29종으로 정정하고 CR-005로 GH 코드 16종이 추가되어 현재 45종임을 함께 표기 |

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

### 6.1 WP별 검증 실행 기록

실제로 실행한 명령과 결과만 적는다. 실행하지 않은 검증은 실행하지 않았다고 적는다.

**WP-001** (2026-08-19, Node v22.22.2 / pnpm 10.33.0, 커밋 `f36ab06`, PR #2)

| 명령 | 결과 |
| --- | --- |
| `pnpm install` | 성공 — 217 패키지 |
| `pnpm typecheck` | 성공 (종료 코드 0) — `tsc --build` 10개 프로젝트 + `@prs/web` `tsc --noEmit` |
| `pnpm lint` | 성공 (종료 코드 0) — 경고 0 |
| `pnpm lint:deps` | 성공 (종료 코드 0) — 패키지 11개, 위반 0건 |
| `pnpm test` | 성공 (종료 코드 0) — 테스트 파일 7개, 테스트 20건 통과 |
| `pnpm build` | 성공 (종료 코드 0) — 패키지 7개 + 앱 4개(`next build` 포함) |
| `docker compose config` | 성공 (종료 코드 0) — compose 정의 유효 |
| `docker compose up -d` | **실패** — 이미지 pull이 이그레스 정책에 막힘 (DEV-001) |
| `docker compose ps` | 컨테이너 0개 (위 실패의 결과) |
| GitHub Actions `verify` | 성공 — 커밋 `44c1772`, run 32313150545. typecheck → lint → lint:deps → test → build 전 단계 통과 |

`lint:deps` 실패 동작 검증 (DoD 2번):

| 단계 | 조작 | 결과 |
| --- | --- | --- |
| 1 | 정상 상태 | 종료 코드 0 |
| 2 | `@prs/domain`에 `@prs/contracts` 의존 추가 (layer 0 → 1) | 종료 코드 1. 위반 2건 (역방향 + 순환) 보고 |
| 3 | `@prs/es`에 `@prs/search-api` 의존 추가 (layer 1 → 2) | 종료 코드 1. 위반 1건 보고 |
| 4 | 두 변경 원복 | 백업과 바이트 동일 확인 |
| 5 | 최종 상태 재확인 | 종료 코드 0, 위반 0건 |

헬스 엔드포인트 실제 HTTP 확인 (DoD 3번의 앱 부분):

| 앱 | 요청 | 결과 |
| --- | --- | --- |
| `web` | `GET http://127.0.0.1:3000/healthz` | 200 `{"status":"ok","service":"web","version":"0.1.0"}` |
| `ingest-gateway` | `GET http://127.0.0.1:3001/healthz` | 200 `{"status":"ok","service":"ingest-gateway",...}` |
| `search-api` | `GET http://127.0.0.1:3002/healthz` | 200 `{"status":"ok","service":"search-api",...}` |
| `pipeline-worker` | `GET http://127.0.0.1:3003/healthz` | 200 `{"status":"ok","service":"pipeline-worker",...}` |

CI 첫 실행은 `pnpm/action-setup`의 `version` 입력과 `package.json`의 `packageManager`가 중복 지정되어 실패했다. `packageManager`를 단일 출처로 두고 워크플로의 `version` 입력을 제거해 해결했다 (`44c1772`).

WP-001의 헬스체크는 프로세스 기동만 확인한다. 백킹 서비스 연결 확인은 각 연결을 실제로 여는 WP가 더한다.

### 6.2 WP-002 검증 실행 기록

2026-08-19, PostgreSQL 16.13 (네이티브 설치본. 레지스트리 차단으로 컨테이너를 쓸 수 없어 같은 메이저 버전의 로컬 인스턴스를 사용했다 — DEV-001).

| DoD | 명령 / 확인 | 결과 |
| --- | --- | --- |
| 1 | `pnpm db:migrate` | 성공 — 001~005 적용, 테이블 14종 생성 |
| 1 | `pnpm db:migrate --down` | 성공 — 005~001 회수, `schema_migration` 외 잔여 테이블 0 |
| 2 | `pnpm db:seed` | 성공 — 저장소 3, PR 200, 커밋 500, 릴리스 10, 원본 이벤트 510 |
| 3 | 같은 `delivery_id` 재삽입 (같은 `received_at`) | SQLSTATE 23505 유니크 위반 (FR-ING-002 AC-1) |
| 4 | 같은 `(type, target)` 활성 잡 2건 | SQLSTATE 23505 유니크 위반 (FR-ADMIN-002 AC-4) |
| 5 | 동시 `pg_try_advisory_xact_lock` | 하나만 `true`, 다른 하나는 대기 없이 `false`. 커밋 후 재시도 성공 (FR-SEQ-001 AC-6) |
| 6 | `has_table_privilege('prs_app','audit_record', …)` | INSERT/SELECT `true`, UPDATE/DELETE `false` (FR-AUTH-004 AC-3) |

| 명령 | 결과 |
| --- | --- |
| `pnpm test:integration` | 성공 — 테스트 파일 6개, 테스트 26건 |
| `pnpm typecheck` / `lint` / `lint:deps` / `test` / `build` | 전부 종료 코드 0 (단위 테스트 20건) |
| GitHub Actions `verify` | 성공 — 커밋 `96d4e2f`, run 32314753316 |
| GitHub Actions `integration` | 성공 — 같은 run. `postgres:16-alpine` **서비스 컨테이너**에서 통합 테스트 26건 통과 |

CI의 `integration` 잡이 컨테이너 PostgreSQL에서 같은 테스트를 통과했다는 점이
DEV-006의 근거다. 로컬 검증이 네이티브 인스턴스였던 것은 이 실행 환경의 제약이지
테스트가 컨테이너에서 못 도는 것이 아니다.

테스트가 실제로 제약을 검증하는지 역으로 확인했다. 제약을 일부러 제거하면 해당 테스트만 실패하고, 원복하면 다시 통과한다.

| 조작 | 결과 |
| --- | --- |
| `GRANT UPDATE ON audit_record TO prs_app` | 감사 권한 테스트 1건 실패 → 원복 후 통과 |
| `DROP INDEX job_active_uk` | 활성 잡 유니크 테스트 1건 실패 → 원복 후 통과 |

### 6.3 WP-003 검증 실행 기록

2026-08-20. **이 환경에는 Elasticsearch를 띄울 수 없다** — `docker.elastic.co`와 `artifacts.elastic.co`가 모두 403으로 차단되고 네이티브 설치본도 없다 (DEV-008). WP-002 때의 PostgreSQL 같은 우회로가 없다.

| DoD | 확인 | 로컬 | CI |
| --- | --- | --- | --- |
| 1 | `pnpm es:apply-mappings`가 인덱스 4종과 별칭 생성 | 불가 | `bootstrap.test.ts` |
| 2 | 매핑 일치 검증 테스트 통과 | 불가 | `mappings.test.ts` |
| 3 | 매핑에 없는 필드 색인 거부 (`dynamic: strict`) | 불가 | `behavior.test.ts` |
| 4 | `search()`가 `ScopedQuery` 아닌 인자에 컴파일 실패 | **통과** | `pnpm typecheck` |
| 5 | `commit_sha` 대소문자 무관 매칭 | 불가 | `behavior.test.ts` |

**CI 검증 결과 — 커밋 `2477c74`, run 32340561385. `verify`·`integration` 모두 성공.**

`integration` 잡은 `docker.elastic.co/elasticsearch/elasticsearch:8.19.0` 서비스 컨테이너를 띄우고 통합 테스트를 돌렸다. Elasticsearch 서버 로그가 DoD를 직접 증명한다.

| DoD | ES 서버 로그 증거 |
| --- | --- |
| 1 | `[prs-pull-requests-v1] creating index, cause [api], shards [6]/[1]`, `[prs-commits-v1] ... shards [12]/[1]`, `[prs-links-v1] ... shards [12]/[1]`, `[prs-releases-v1] ... shards [2]/[1]` — ADR-003이 정한 샤드 수 그대로 |
| 2 | `mappings.test.ts`가 4종 전부에 대해 `dynamic: strict`와 정의한 속성의 `type`·`analyzer`·`normalizer`·`index`·`ignore_above`를 대조하고 통과 |
| 3 | `StrictDynamicMappingException: [1:44] mapping set to strict, dynamic introduction of [source_code_body] within [_doc] is not allowed` — 매핑에 없는 필드가 실제로 거부되었다 |
| 5 | `behavior.test.ts`의 대소문자 교차 조회와 접두 검색이 같은 문서를 반환 |

멱등성도 확인되었다. 인덱스 삭제 후 재생성 로그가 한 번씩만 나타난다.

DoD 4는 역으로도 확인했다. `search()`의 `ScopedQuery` 제약을 일부러 `QueryDslQueryContainer`로 완화하면 `pnpm typecheck`가 `error TS2578: Unused '@ts-expect-error' directive`로 실패하고, 원복하면 통과한다. 접근 범위 필터 우회가 런타임 버그가 아니라 빌드 실패라는 뜻이다 (ADR-008).

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 (테스트 파일 포함) |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 |
| `pnpm test` | 종료 코드 0 — 테스트 파일 8개, 27건 |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db` | 종료 코드 0 — 26건 (WP-002 회귀 없음) |
| `pnpm test:integration` (전체) | 로컬에서는 ES 부재로 실패. CI에서 성공 |

### 6.4 WP-004 검증 실행 기록

2026-08-20. PostgreSQL 16.13(네이티브)과 실제 HTTP로 검증했다. `app.inject()`는 네트워크 계층을 건너뛰므로 수신 응답 시간과 본문 크기 상한 측정에는 쓰지 않았다.

| DoD | 확인 | 결과 |
| --- | --- | --- |
| 1 | 유효 서명 → 202 + `raw_event` 저장 | **통과** — `event_type`·`action`·`repository_id`·payload 전문·`payload_hash`·`correlation_id`가 그대로 남는다 |
| 2 | 무효·변조 서명 → 401, 미저장 | **통과** — 다른 시크릿·본문 1바이트 변조·헤더 부재 세 경우 모두 401이고 행 0 |
| 3 | 재전송 → 202 `duplicate: true`, 행 증가 없음 | **통과** — 순차 3회, 동시 8회 모두 행 1개 |
| 4 | 25MB 초과 → 413 | **통과** — 초과분 413 + 미저장, 상한 바로 아래(25MB−1KB) 202 |
| 5 | INSERT 실패 → 500 | **통과** — 파티션 없는 수신 시각으로 실제 PostgreSQL 오류를 내 확인. 목을 쓰지 않았다 |
| 6 | 수신 응답 p95 300ms 이하 (1000 요청) | **통과** — p50 33.5ms / **p95 61.6ms** / p99 133.9ms (동시 20). 1000건 전부 202이고 `raw_event` 1000행 |
| 7 | 서명 검증이 JSON 파싱보다 먼저임을 테스트로 확인 | **통과** — 호출 순서 단언 + "서명 틀린 깨진 JSON이 400이 아니라 401" 두 갈래 |
| 8 | QA-A001-01 수신 지표 노출 | **통과** — `GET /metrics`가 `ingest_received_total`·`ingest_rejected_total`·`ingest_duplicate_total`·`ingest_response_seconds`를 Prometheus 형식으로 낸다 |

**테스트가 실제로 제약을 검증하는지 역으로 확인했다.** 제약을 일부러 깨면 해당 테스트만 실패하고, 원복하면 다시 통과한다.

| 조작 | 결과 |
| --- | --- |
| 조건부 INSERT를 빼고 기본 키 충돌에만 의존 (문서가 가정한 구현) | 통합 5건 실패 — 동시 8건이 8행이 된다. **DEV-009의 근거** |
| `store.ts`에서 advisory lock 제거 | `idempotency.test.ts` 2건 실패 (락 대기 없음 / `lock_timeout` 예외 없음) |
| 원문 바이트 content-type 파서 제거 (Fastify 기본 JSON 파서 복원) | `server.test.ts` 4건 실패 — 파싱이 서명 검증보다 앞서면 잡힌다 |
| `constantTimeEquals`를 `expected === actual`로 교체 | 타이밍 테스트 실패 (비율 50.7 / 임계 2) |

타이밍 테스트는 비교 함수를 직접 재도록 다시 썼다. 서명 길이(71자)에서 재면 HMAC 계산 비용이 비교 비용을 덮어서, `===`로 바꿔도 통과해 버린다 — 즉 그 형태로는 아무것도 검증하지 못한다. 64KB 입력에서 비교만 재면 `===`는 세 자릿수 배로 갈리고 `timingSafeEqual`은 0.9배 언저리에 머문다. 두 값을 전부 버퍼로 복사한 뒤 `===`로 비교하는 변형은 이 측정에 걸리지 않는다는 점도 테스트 주석에 적어 두었다.

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | 종료 코드 0 (테스트 파일 포함) |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 테스트 파일 11개, **71건** |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db apps/ingest-gateway` | 종료 코드 0 — 파일 9개, **47건** (WP-002 회귀 없음) |

WP가 적은 검증 명령은 `pnpm test:integration -- gateway`와 `pnpm test -- gateway/signature`다. 앞의 것은 vitest가 `--` 뒤 인자를 필터로 받지 않아 전체 통합 스위트를 돌린다. 뒤의 것은 `gateway/signature`와 이어지는 경로가 없어 0건이 잡힌다(실제 경로는 `apps/ingest-gateway/src/signature.test.ts`). 위 표의 명령이 같은 대상을 실제로 돌린 것이다.

**CI 검증 결과 — 커밋 `e0bf745`, run 32351007528. `verify`·`integration` 모두 성공.**

`integration` 잡은 PostgreSQL 16과 Elasticsearch 8.19.0 서비스 컨테이너를 띄우고 통합 스위트 전량(WP-002·WP-003·WP-004)을 돌렸다. 부하 시험의 p95 단언(≤ 300ms)도 CI 러너에서 통과했다 — 로컬 네이티브 PostgreSQL보다 느린 환경에서도 예산 안이라는 뜻이다.

**환경 제약.** Elasticsearch 통합 테스트는 로컬에서 여전히 돌지 않는다(DEV-008). WP-004는 Elasticsearch를 쓰지 않으므로 이 WP의 DoD에는 영향이 없고, CI에서는 WP-003 스위트와 함께 돈다.

### 6.5 WP-005 검증 실행 기록

2026-08-20. PostgreSQL 16.13과 Redis 7(둘 다 네이티브 설치본)으로 검증했다. Redis는 이 환경에 설치되어 있어 **DoD 4를 시늉이 아니라 실제 프로세스 정지·복구로 확인했다**.

| DoD | 확인 | 결과 |
| --- | --- | --- |
| 1 | 같은 파티션 키의 메시지가 같은 소비자에게 순서대로 전달된다 | **통과** — 25건 순서 일치. 파티션을 둘로 갈라 소비자 둘에게 맡겼을 때 키 5종이 각각 한쪽에만 전량 도착 |
| 2 | 소비자 장애 시 미ack 메시지가 재전달된다 | **통과** — 핸들러가 던지면 전달 횟수가 올라가며 재전달. 소비자가 ack 전에 죽으면 후임이 회수 |
| 3 | 계약 테스트가 통과한다 | **통과** — 계약 12건을 **두 어댑터**(Redis Streams, 인메모리)가 같은 파일로 통과 |
| 4 | Redis 정지 뒤 수신하면 202, 복구 후 `JOB-ING-007`이 재적재한다 | **통과** — 아래 실제 정지·복구 기록 참조 |

**DoD 4 — 실제 Redis 프로세스를 정지시키고 확인한 순서.**

| 단계 | 관측값 |
| --- | --- |
| 1 | `service redis-server stop` — 정지 |
| 2 | 웹훅 수신 → `202 {"accepted":true,"delivery_id":"real-outage-1","duplicate":false}` |
| 3 | 저장된 행 → `queued_at=2026-08-20T10:24:18.286Z`, `processed_at=null` |
| 4 | `service redis-server start` → `redis-cli ping` = `PONG` |
| 5 | `JOB-ING-007` 한 회차 → `{"found":1,"relayed":1,"failed":0}` |
| 6 | 소비자 수신 → `{"delivery_id":"real-outage-1","event_type":"pull_request","action":"closed","repository_id":4021,...}` |

이 검증에 쓴 일회성 테스트는 시스템 서비스를 정지시키므로 저장소에 남기지 않았다. 같은 시나리오의 결정론적 버전(응답하지 않는 가짜 서버, 닿지 않는 엔드포인트)은 `enqueue.test.ts`와 `outbox-relay.test.ts`로 남아 CI에서 돈다.

**설계 결정 하나를 기록해 둔다.** Redis Streams에는 파티션이 없다 — 소비자 그룹은 먼저 읽는 소비자에게 아무 메시지나 준다. 그대로 쓰면 같은 저장소의 이벤트가 여러 워커로 흩어져 DoD 1이 성립하지 않는다. 그래서 토픽 하나를 물리 스트림 N개(`prs:ingest:0` … `prs:ingest:15`)로 펴고 파티션 키 해시로 스트림을 고른다. 파티션 수는 비동기 문서 2장의 "동시성" 열에서 그대로 가져왔다 — 한 파티션을 한 소비자만 맡으므로 동시성 상한이 곧 파티션 수다. `prs:sequence`만 그 숫자가 문서에 없어 DEV-010으로 남겼다.

**구현 중 발견해 고친 결함: BIGINT가 문자열로 돌아오고 있었다.**

node-postgres는 `int8`을 기본으로 문자열로 준다(2^53 정밀도 문제 때문이다). 그런데 WP-002의 리포지터리 타입은 `repository_id: number`로 선언되어 있었다 — 선언과 런타임 값이 어긋나 있었고, 타입 검사로는 드러나지 않는다. WP-005에서 이 값이 이벤트 payload와 파티션 키로 나가면서 `"4021"`이 실려 잡혔다. 그대로 뒀다면 소비자 쪽 `repository_id === 4021` 비교가 전부 조용히 어긋났을 것이다.

`@prs/db`에 int8 파서를 넣어 숫자로 받되, 안전 정수 범위를 넘으면 **던지도록** 했다. 조용히 잘린 ID로 엉뚱한 저장소를 가리키는 것보다 즉시 실패하는 편이 낫다. 회귀 테스트는 `packages/db/integration/type-parsers.test.ts`다.

**테스트가 실제로 제약을 검증하는지 역으로 확인했다.**

| 조작 | 결과 |
| --- | --- |
| `partitionFor`가 파티션 키를 무시하게 만듦 | 계약 4건 실패 (순서·소비자 귀속·PEL) |
| 미ack가 남은 파티션에서도 새 이벤트를 읽게 만듦 | "실패한 이벤트를 건너뛰지 않는다" 실패 |
| 게이트웨이가 `queued_at`을 찍지 않게 되돌림 (WP-004 상태) | "발행 실패에도 아웃박스 표식이 남는다" 실패 |
| 발행 마감(150ms) 제거 | "발행이 매달려도 예산을 지킨다" 실패 — 응답이 30초까지 늘어난다 |
| BIGINT 파서 제거 | 5건 실패 (재적재 payload 2건 + 파서 회귀 3건) |

발행 마감 테스트는 한 번 다시 썼다. 처음에는 닿지 않는 포트를 썼는데, 그러면 ioredis가 곧바로 연결 거부로 실패해 **마감을 없애도 테스트가 통과한다** — 아무것도 검증하지 못하는 테스트였다. 연결은 받아 주고 한 마디도 대답하지 않는 가짜 서버로 바꾸니 마감 없이는 30초가 걸리는 것이 드러났다.

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | 종료 코드 0 (테스트 파일 포함) |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 테스트 파일 12개, **86건** |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db packages/bus apps/ingest-gateway apps/pipeline-worker` | 종료 코드 0 — 파일 14개, **93건** |

WP가 적은 검증 명령은 `pnpm test:integration -- bus`다. WP-004 때와 같은 이유로 vitest가 `--` 뒤 인자를 필터로 받지 않아 전체 스위트를 돌린다. 위 표의 명령이 같은 대상을 실제로 돌린 것이다.

**CI 검증 결과 — 커밋 `e7b0bd9`, run 32359072673. `verify`·`integration` 모두 성공.**

`integration` 잡에 Redis 7 서비스 컨테이너를 더했다. PostgreSQL·Elasticsearch·Redis 셋을 띄우고 통합 스위트 전량(WP-002~WP-005)을 돌린다. 계약 테스트는 두 어댑터 모두, 아웃박스 재적재는 실제 Redis 대상으로 CI에서도 통과했다.

**환경 제약.** Elasticsearch만 여전히 로컬에서 띄울 수 없다(DEV-008). WP-005는 Elasticsearch를 쓰지 않으므로 이 WP의 DoD에는 영향이 없다.

### 6.6 WP-006 검증 실행 기록

2026-08-20. 문서가 정한 검증 방법이 "목 서버 기반"이라 실제 `node:http` 서버를 띄워 검증했다. fetch를 목으로 바꾸지 않았다 — 이 WP가 확인해야 할 것 대부분이 **HTTP 헤더와 상태 코드에 대한 반응**(rate limit 헤더 파싱, 429 + `retry-after`, 401 후 토큰 재발급)이라, fetch를 가로채면 그 경로를 통째로 건너뛰고 아무것도 증명하지 못한다.

| DoD | 확인 | 결과 |
| --- | --- | --- |
| 1 | 토큰이 만료되면 자동 갱신된다 | **통과** — 수명 2분·갱신 여유 1분에서 30초 뒤에는 재사용, 70초 뒤에는 재발급. 401 수신 시 캐시를 버려 다음 요청이 새 토큰을 받는다. 동시 요청 4건이 토큰을 중복 발급하지 않는다 |
| 2 | 잔여 10% 미만 토큰이 회복 시각까지 풀에서 제외된다 | **통과** — 임계 아래 응답 후 다음 요청이 회복 시각을 담아 거부되고, 서버로 요청 자체가 나가지 않는다. 회복 시각이 지나면 다시 쓴다 |
| 3 | 429 + `retry-after` 수신 시 해당 토큰이 지정 시간 격리된다 | **통과** — 45초 지정 시 44초에는 막히고 46초에는 풀린다. 헤더가 없으면 보수적으로 60초 격리 |
| 4 | 실시간 요청이 백필 요청보다 먼저 토큰을 배분받는다 | **통과** — 백필 둘이 먼저 줄을 섰어도 나중에 온 실시간이 앞선다. 같은 우선순위 안에서는 선입선출 |
| 5 | 토큰 값이 로그에 남지 않는다 (THR-009) | **통과** — 오류 메시지·스택·전송 이벤트 어디에도 발급된 토큰이 없다. 토큰은 Authorization 헤더로만 가고 URL·질의 문자열에 실리지 않는다 |

**테스트가 실제로 제약을 검증하는지 역으로 확인했다.**

| 조작 | 결과 |
| --- | --- |
| 10% 격리 조건 제거 | 4건 실패 (단위 2 + 전 계층 2) |
| `retry-after` 초 단위 파싱 제거 | 2건 실패 |
| 실시간 우선순위 뒤집기 | "백필이 먼저 줄을 섰어도 실시간이 앞선다" 실패 |
| `redact()` 무력화 | 9건 실패 (단위 8 + 전 계층 1) |
| 만료 판정 제거 | "만료가 가까워지면 새로 받는다" 실패 |

**leak 시험을 한 번 다시 썼다.** 처음에는 401 응답만으로 "토큰이 오류에 남지 않는가"를 보려 했는데, 그 응답 본문(`{"message":"Bad credentials"}`)에는 애초에 토큰이 없어서 **redaction을 무력화해도 통과했다** — 아무것도 검증하지 못하는 시험이었다. 목 서버가 받은 Authorization 헤더를 오류 본문에 되비추도록 바꾸니(잘못 구성된 프록시에서 실제로 일어나는 일이다) redaction 제거가 그 시험을 실패시킨다.

**구현 중 발견해 고친 결함 둘.**

1. `redact()`의 치환 콜백이 캡처 그룹 없는 정규식에서 `offset`(숫자)을 캡처 그룹으로 오해했다. 그 결과 토큰을 가리는 대신 원문 앞에 숫자를 붙여 되돌려 주고 있었다 — 즉 **토큰이 그대로 남았다**. 캡처 그룹 있는 패턴과 없는 패턴을 분리해 고쳤다.
2. `parseRateLimitHeaders`가 헤더 없는 응답을 "잔여 0"으로 읽었다. `Number(null)`이 `0`이고 `Number.isFinite(0)`이 참이기 때문이다. 그대로 두면 rate limit 헤더를 주지 않는 엔드포인트 응답 하나가 멀쩡한 토큰을 통째로 격리시킨다. `null` 검사를 먼저 하도록 고쳤다.

**실제 GHE 검증은 하지 않았다.** 이 환경에 GitHub App 자격 증명이 없다. read-only smoke 시험(`smoke-real-ghe.test.ts`)을 넣어 두었고 자격 증명이 있으면 자동으로 돈다 — 없으면 건너뛰되 그 사실을 실행 로그에 남긴다. 조용히 통과한 것처럼 보이지 않게 하려는 것이다. WP-006의 문서상 DoD와 검증 방법(`pnpm test -- github`, 목 서버 기반)은 real-GHE smoke를 요구하지 않으므로 DoD 판정에는 영향이 없다. 다만 **REL-001 운영 readiness 전에 반드시 남은 게이트**로 아래 8장에 남긴다.

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 17개, **126건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `vitest run --config vitest.integration.config.ts packages/db packages/bus apps/ingest-gateway apps/pipeline-worker` | 종료 코드 0 — **93건** (WP-002~005 회귀 없음) |
| `vitest run packages/github` | 종료 코드 0 — 40건 통과 + 1건 건너뜀 |

WP가 적은 검증 명령은 `pnpm test -- github`다. WP-004·WP-005 때와 같은 이유로 vitest가 `--` 뒤 인자를 필터로 받지 않아 전체 단위 스위트(126건)를 돌린다. `github`만 돌린 것은 위 표의 마지막 명령이다.

**CI 검증 결과 — 커밋 `82a432a`, run 32366126973. `verify`·`integration` 모두 성공.**

`verify` 잡이 단위 126건을 돌렸고 real-GHE smoke는 CI에도 자격 증명이 없어 건너뛰었다. `integration` 잡은 PostgreSQL·Elasticsearch·Redis 서비스 컨테이너로 WP-002~005 스위트를 돌려 회귀가 없음을 확인했다.

### 6.7 WP-007 검증 실행 기록

DoD 6항 전부 통과. 검증 방법은 `pnpm test:integration worker/enrich`다 (DEV-017로 정정한 형태).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| PR 이벤트 처리 후 커밋·파일·리뷰가 병합된 결과가 `EVT-ING-002`로 발행된다 (FR-ING-004 AC-1) | 통과 | 목 GHE에서 커밋·파일·리뷰를 실제 HTTP로 받아 `prs:enriched`에 발행. 투영이 API를 다시 부르지 않아도 되는지를 별도 시험으로 고정했다 |
| rate limit 소진 시 보강이 지연되고 회복 시각에 재시도된다 (AC-2) | 통과 | 429 + `retry-after: 600`과 주 한도 소진(403 + `x-ratelimit-remaining: 0`) 둘 다 `defer`로 떨어진다. 전달 횟수가 5여도 실패 대기열로 가지 않는다 |
| 보강 실패 시에도 부분 결과가 `enrichment_pending: true`로 진행된다 (AC-3) | 통과 | 파일 조회만 403인 경우와 넷 다 403인 경우 모두 발행된다. 후자는 웹훅 payload로 만든 PR이 남는다 |
| 변경 파일 3000개 초과 시 절삭되고 플래그가 설정된다 (AC-4) | 통과 | 3001개 → 3000개 + `files_truncated: true`. **정확히 3000개는 절삭이 아니다**를 같은 스위트에서 고정했다 |
| 재시도 5회 소진 시 DLQ로 이동한다 (FR-ING-007 AC-1) | 통과 | 500이 계속되면 예산 안에서는 `retry`, 소진 후에는 부분 문서를 발행하고 `dead_letter`(`retry_count = 5`) |
| 404(삭제된 PR)는 재시도 없이 즉시 DLQ로 간다 (async 5.2) | 통과 | 첫 전달에서 곧바로 `dead_letter`. 같은 파티션의 다음 이벤트가 막히지 않는 것도 버스 왕복 시험으로 확인했다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 20개, **150건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration worker/enrich` | 종료 코드 0 — 파일 1개, **24건** |
| `vitest run --config vitest.integration.config.ts packages/bus` | 종료 코드 0 — 36건 (두 어댑터가 같은 계약 통과) |
| `pnpm test:integration` (전량) | **파일 15개 통과 / 3개 실패** — 실패 3개는 모두 `packages/es`이며 원인은 이 환경에 Elasticsearch가 없어서다(`ECONNREFUSED 127.0.0.1:9200`). 통과 125건, 건너뜀 18건 |

**Elasticsearch 통합 시험 3종은 실행하지 못했다.** 이 컨테이너에는 Docker 데몬이 없어 `docker compose up`으로 ES를 띄울 수 없다. WP-003 범위이고 WP-007이 건드리지 않는 코드지만, "통합 스위트 전량 통과"라고 적을 수는 없으므로 있는 그대로 남긴다. CI의 `integration` 잡은 ES 서비스 컨테이너를 띄우므로 거기서 돈다.

**실제 GHE 대상 검증은 하지 않았다 — NOT RUN.** 이 환경에 GitHub App 자격 증명이 없다. `smoke-real-ghe.test.ts`는 자격 증명이 있으면 자동으로 돌고 없으면 건너뛰되 그 사실을 실행 로그에 남긴다. WP-007의 검증 방법은 목 서버 기반 통합 시험이라 DoD 판정에는 영향이 없지만, **REL-001 운영 readiness 전 게이트**로 8장에 그대로 둔다.

**구현 중 발견해 고친 결함 하나 (Redis 어댑터).**

`RedisStreamsEventBus`가 재시도·유예 상태를 **스트림 엔트리 ID만으로** 식별하고 있었다. Redis 스트림 ID는 `<밀리초>-<일련번호>`라 스트림 안에서만 유일하고, 같은 밀리초에 서로 다른 파티션 스트림에 하나씩 들어가면 둘 다 `…-0`이 된다. 그래서 한 파티션에서 `defer`한 이벤트가 다른 파티션의 무관한 이벤트를 함께 묶어 **그 파티션을 통째로 멈췄다**. CR-010 계약 시험("유예 중인 파티션이 다른 파티션을 막지 않는다")이 잡았고, 상태 열쇠를 `(스트림, 메시지 ID)`로 바꿔 고쳤다. 파티션 16개로 도는 운영에서는 드문 일이 아니다.

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 일부러 망가뜨려 보고 해당 시험이 실패하는지 봤다 — (1) rate limit을 `defer` 대신 `retry`로 처리 → 3건 실패, (2) 절삭 판정을 배열 길이로 추측 → 1건 실패, (3) 404를 즉시 종료로 보지 않음 → 2건 실패. 세 변형 모두 되돌린 뒤 전량 통과를 다시 확인했다.

### 6.8 WP-008 검증 실행 기록

DoD 8항 전부 통과. 검증 방법은 `pnpm test:integration worker/project`다 (파일 1개, 14건).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 오래된 `document_version` 갱신이 새 상태를 덮어쓰지 않는다 (AC-1) | 통과 | 나중 웹훅(12:00)을 먼저 색인하고 이전 웹훅(11:00)을 뒤에 넣어도 문서는 나중 상태로 남고 `document_version`도 12:00이다. 아무것도 바뀌지 않았으므로 `EVT-ING-003`도 나가지 않는다 |
| 같은 이벤트를 두 번 처리해도 문서가 하나다 (FR-ING-002 AC-5) | 통과 | 같은 `delivery_id`를 두 번 처리한 뒤 `pr_number` 질의 결과가 1건. 결정론적 ID `{repository_id}:{pr_number}`가 근거다 |
| 여러 인덱스 갱신이 벌크 1건으로 전송된다 (AC-2) | 통과 | `client.bulk` 호출을 프록시로 세어 1회. 그 한 번으로 `prs-pull-requests`와 `prs-commits`가 함께 갱신됐다 |
| 벌크 부분 실패 항목이 개별 재시도된다 (AC-3) | 통과 | 마지막 문서를 **실제로 보내지 않고** 429로 보고하게 만든 뒤, `client.update`가 정확히 1회 불리고 그 문서가 색인된다. 응답만 조작하면 이미 색인돼 있어 재시도가 무엇을 고쳤는지 알 수 없어 그렇게 짰다 |
| 수신부터 검색 반영까지 p95 10초 이하다 (AC-5) | 통과 (개발 데이터셋) | 수신 시각을 현재로 둔 이벤트 20건을 처리해 `ingestion_lag_seconds`의 10초 버킷에 20건 전부가 들어갔다. **운영 규모 측정이 아니다** — REL-001 성능 게이트가 따로 본다 |
| 매핑에 없는 필드를 넣으려 하면 색인이 거부되고 DLQ로 간다 (THR-010) | 통과 | 화이트리스트가 뚫린 상황을 프록시로 만들어(`source_patch` 주입) 실제 클러스터가 `strict_dynamic_mapping_exception`으로 막는 것을 확인했다. 워커는 재시도 없이 `dead_letter`로 가고 `processed_at`도 찍지 않는다 |
| 커밋이 두 PR에 속해도 `pull_request_numbers`가 합집합으로 남는다 (CR-011) | 통과 | 두 PR이 같은 원본 커밋을 참조하면 `[1234, 5678]`. 오래된 이벤트가 나중에 도착한 경우에도 합집합이 유지된다 — 소속은 버전 비교의 대상이 아니기 때문이다 |
| 미등록 저장소 이벤트는 문서를 만들지 않고 실패로도 세지 않는다 (FR-ING-009 AC-4) | 통과 | `repository` 행이 없으면 ack하고 `repository_unregistered`를 남긴다. 실패 대기열은 비어 있고 인덱스에도 문서가 없다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 23개, **195건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration worker/project` | 종료 코드 0 — 파일 1개, **14건** |
| `pnpm test:integration` (전량) | 종료 코드 0 — 파일 **19개 전부 통과, 158건**. Elasticsearch 계열 포함 |

**Elasticsearch 통합 시험을 이 환경에서 처음으로 실제로 돌렸다 (DEV-008 해소).** `docker.elastic.co`와 Docker Hub 블롭 호스트는 여전히 403이지만 `mirror.gcr.io/library/elasticsearch:8.19.0`이 이그레스 정책을 통과한다. CI와 같은 8.19.0을 띄워 `packages/es` 19건과 투영 14건을 모두 실행했다. 이미지 태그나 compose 정의는 바꾸지 않았다 — 로컬 검증 경로일 뿐이다.

**그 덕에 결함 하나가 드러났다 (DEV-021).** WP-003 부트스트랩이 별칭에 `routing: 'repository_id'`를 걸고 있었다. 별칭의 `routing`은 필드 이름이 아니라 **고정 라우팅 값**이라, 전 문서가 문자열 하나의 샤드로 몰리고 문서별 `_routing`을 준 요청은 `illegal_argument_exception`으로 거부된다 — ADR-003의 샤딩 설계가 정반대로 뒤집혀 있었다. 투영의 첫 색인이 통째로 실패하면서 잡혔다. WP-003의 DoD 시험이 그 잘못된 값을 **기대값으로 못 박고** 있었던 것이 더 문제였다: 별칭 메타데이터만 확인하고 문서를 실제로 색인해 보지 않았다. 시험을 "고정 라우팅이 없다" + "문서별 라우팅으로 색인하고 되찾는다"로 바꿨다.

**실제 GHE 대상 검증은 여전히 하지 않았다 — NOT RUN.** WP-008은 GitHub API를 부르지 않으므로(`EVT-ING-002`가 self-contained, CR-010 DEV-013) 이 WP의 DoD와는 무관하다. **REL-001 운영 readiness 전 게이트**로 8장에 그대로 둔다.

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 하나씩 망가뜨려 보고 해당 시험이 실패하는지 봤다 — (1) 버전 가드 제거(항상 대입) → 통합 1건 실패, (2) 합집합을 단순 대입으로 → 통합 3건 실패, (3) 부분 실패를 벌크 전체 재시도로 → 통합 1건 실패, (4) 미등록 저장소도 투영 → 통합 1건 실패, (5) 매핑 거부를 재시도 가능으로 → **통합은 전량 통과, 단위 1건 실패**. (5)는 통합 스위트가 못 잡는다 — ES가 그 오류를 400으로 주고 400은 유형과 무관하게 이미 `rejected`이기 때문이다. 5xx로 오는 경우를 단위 시험이 따로 고정하고 있어 그것이 잡았다. 다섯 변형 모두 되돌린 뒤 전량 통과를 다시 확인했다.

### 6.9 WP-009 검증 실행 기록

DoD 6항 전부 통과. 검증 방법은 `pnpm test:integration ops/dead-letter`다 (파일 1개, 20건).

| DoD | 결과 | 근거 |
| --- | --- | --- |
| 재시도 5회 소진 이벤트가 사유와 함께 DLQ에 저장된다 (AC-2) | 통과 | 목록 응답이 `delivery_id`·`stage`·`error`·`retry_count`·`reprocess_count`·`state`·`repository_id`를 그대로 돌려준다. 기록 자체는 WP-007·WP-008의 워커 시험이 만든다 |
| 개별·일괄 재처리가 동작한다 (AC-3) | 통과 | 개별 1건과 일괄 3건 모두 `prs:ingest` 스트림에 실제로 들어간다. 봉투를 목이 아니라 Redis에서 `xrange`로 직접 읽어 확인했다 |
| 재처리가 중복 문서를 만들지 않는다 (AC-4) | 통과 | 같은 항목을 두 번 재처리하면 봉투 `event_id`는 둘이지만 payload의 `delivery_id`는 같다. 소비자의 멱등 기준이 그것이며(EVT-ING-001), 문서가 하나로 남는다는 것은 WP-008의 결정론적 ID 시험이 증명한다 |
| 3회 재처리 실패 이벤트가 `held`로 전환된다 (예외 처리) | 통과 | `reprocess_count`가 1·2·3으로 오르고 세 번째에 `held`가 된다. **행은 내내 하나다** — 그것이 성립해야 누적이 뜻을 갖는다 |
| 100건 초과 시 경보 메트릭이 임계를 넘는다 (AC-5) | 통과 | 101건을 넣고 `GET /metrics`가 `dead_letter_total{state="pending"} 101`과 `dead_letter_open_total 101`을 낸다. `resolved`는 임계를 잠식하지 않는다 |
| 일괄 재처리 100건 초과 시 재확인이 요구된다 (QA-A001-05) | 통과 | 101건 대상에서 확인 없음·틀린 값 모두 400 `CONFIRMATION_MISMATCH`, 정확한 값에서만 202. 경계는 정확히 100이며 100건은 확인 없이 지나간다 |

로컬에서 통과한 명령:

| 명령 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 종료 코드 0 |
| `pnpm typecheck` | 종료 코드 0 |
| `pnpm lint` / `pnpm lint:deps` | 종료 코드 0 — 패키지 11개, 위반 0건 |
| `pnpm test` | 종료 코드 0 — 파일 23개, **195건 통과 + 1건 건너뜀**(real-GHE smoke) |
| `pnpm build` | 종료 코드 0 |
| `pnpm test:integration ops/dead-letter` | 종료 코드 0 — 파일 1개, **20건** |
| `pnpm test:integration` (전량) | 종료 코드 0 — 파일 **21개 전부 통과, 191건** |

**시험이 실제로 무엇을 잡는지 확인했다.** 구현을 하나씩 망가뜨려 보고 해당 시험이 실패하는지 봤다 — (1) 업서트를 단순 INSERT로 → 통합 12건 실패, (2) 충돌마다 `reprocess_count` 증가 → 3건 실패, (3) 필터 선택에 `held` 포함 → 1건 실패, (4) 확인 임계를 `>=`로(경계 오차) → 1건 실패, (5) 발행 실패해도 표시를 되돌리지 않음 → 1건 실패, (6) 경보 게이지에 `resolved` 포함 → 1건 실패. **여섯 변형 모두 잡혔다.** 되돌린 뒤 전량 통과를 다시 확인했다.

**한 가지는 시험으로 고정하지 못했다.** "표시가 발행보다 먼저"라는 순서는 프로세스가 그 사이에 죽었을 때만 차이가 드러난다. 순서를 바꿔도 통합 스위트는 전량 통과한다 — 관측 가능한 차이가 없기 때문이다. 코드 주석으로 이유를 남겼고, 크래시 주입 시험은 이 WP의 범위 밖으로 두었다.

**실제 GHE 대상 검증은 여전히 하지 않았다 — NOT RUN.** WP-009는 GitHub API를 부르지 않으므로 이 WP의 DoD와는 무관하다. **REL-001 운영 readiness 전 게이트**로 8장에 그대로 둔다.

### 6.10 릴리스 게이트

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
| W-007 관계 그래프는 조건부 | REL-004 ACC-06 | 계획 | REL-006 판단 |
| 실시간 알림·구독 없음 | SRS 4.3 | 범위 밖 | 없음 |
| 단일 리전 배포 | 인프라 11장 | 계획 | 없음 |
| 개인 단위 순위표 없음 | SRS 4.3 | 범위 밖 (정책) | 없음 |
| `docker compose up`이 이 실행 환경에서 검증되지 않음 | 인프라 8장 / DEV-001 | 실제 제약 (레지스트리 이그레스 차단) | 레지스트리 접근 가능한 환경에서 재검증 |
| 워크스페이스 패키지 5종(`query`·`es`·`db`·`github`·`bus`)이 식별 정보만 내보냄 | WP-001 구현 범위 | 실제 상태 (의도된 골격) | WP-002·WP-003·WP-005·WP-006·WP-025 |
| `web`이 Conductor 디자인 시스템을 아직 쓰지 않음 | WP-001 제외 목록 (화면 제외) | 실제 상태 | WP-019 (셸과 Conductor 연동) |
| 각 앱 헬스체크가 백킹 서비스 연결을 확인하지 않음 | WP-001 구현 범위 (프로세스 기동만) | `ingest-gateway`는 해소 — `GET /healthz`가 PostgreSQL을 확인하고 실패 시 503 (인프라 3장) | `search-api`(ES·PG)는 검색 경로를 여는 WP-013, `web`·`pipeline-worker`는 기존대로 |
| 통합 테스트가 testcontainers가 아니라 외부 PostgreSQL에 붙음 | WP-002 검증 방법 / DEV-006 | 실제 상태 (환경 변수로 접속 정보 주입) | WP-003에서 ES와 함께 재검토 |
| `saved_search`·`bisect_session`·`permission_cache`·`team`에 리포지터리 계층이 없음 | WP-002 구현 범위 (6종만 명시) | 실제 상태 (스키마는 존재) | 각각을 쓰는 WP-012·WP-024·WP-042 |
| ~~큐에 들어간 이벤트를 아무도 소비하지 않음 (`processed_at`이 영영 NULL)~~ | WP-005 제외 목록 | 해소 (2026-08-20) — WP-008 투영 워커가 색인 성공 뒤 `markProcessed`를 부른다. 투영되지 않는 이벤트(미등록 저장소, PR 이외 이벤트)는 여전히 NULL로 남아 `JOB-ING-007`이 계속 재적재한다 | 라우팅을 소유한 WP와 WP-010 저장소 등록 |
| `prs:sequence` 파티션 수가 문서에 없어 코드 기본값 8을 씀 | 비동기 문서 2장 / DEV-010 | 실제 상태 (환경 변수로 덮어쓸 수 있음) | 사용자 결정 후 CR |
| Kafka 어댑터 없음 | WP-005 제외 목록 (ADR-002 전환 임계 조건부) | 실제 상태 — 계약 테스트가 교체 가능성을 강제한다 | 전환 임계 충족 시 |
| 실제 GitHub Enterprise 대상 검증 미실행 | WP-006 / 이 실행 환경에 App 자격 증명 없음 | 실제 상태 — 목 서버 계약 시험만 통과. read-only smoke는 자격 증명이 있으면 자동 실행되도록 넣어 두었다 | **REL-001 운영 readiness 전 필수 게이트** |
| ~~GHE 클라이언트를 아무도 호출하지 않음~~ | WP-006 제외 목록 | 해소 (2026-08-20) — WP-007 `enrich` 워커가 호출한다 | 없음 |
| PR 이외 이벤트(`push`·`release`·`member`·`team`·`repository`·`create`·`delete`)를 아무도 진행시키지 않음 | WP-007 범위 (PR 보강만) / DEV-016 | 실제 상태 — `enrich`가 ack만 하고 넘긴다. 원본은 `raw_event`에 남아 유실이 아니다 | 라우팅을 소유한 WP-021(시퀀스)·권한 WP에서 CR로 결정 |
| ~~`enrichment_pending` 문서가 아직 색인되지 않음~~ | WP-007 제외 목록 | 해소 (2026-08-20) — WP-008이 `enrichment_pending`을 문서에 그대로 옮겨 색인한다 | 없음 |
| ~~실패 대기열에 쌓인 이벤트를 재처리할 길이 없음~~ | WP-007 범위 밖 (재처리는 WP-009) | 해소 (2026-08-20) — API-ADM-003이 조회·재처리를 연다 | 없음 |
| 재처리 실행이 감사 기록에 남지 않음 | WP-009 범위 밖 (감사 적재는 WP-010 DoD, 신원은 WP-012) | 실제 상태 — A-001 정책은 "재처리 실행은 감사 기록 대상"이지만 `audit_record.user_id`에 넣을 **실제 신원이 아직 없다**. 공유 토큰 보유자를 사용자로 지어내지 않았다 | WP-010 감사 적재 + WP-012 OIDC 신원 |
| 관리 API가 `operator` 역할이 아니라 공유 토큰으로 보호됨 | CR-012 / DEV-025 | 실제 상태 — 임시 통제다. 토큰 미설정이면 경로를 등록하지 않아 기본값은 "닫힘"이다 | WP-012가 OIDC 세션과 역할 판정으로 대체 |
| 재처리 진행률(`EVT-JOB-001`)이 보고되지 않음 | JOB-ING-009의 `batch` 워커가 WP-019 소관 / DEV-024 | 실제 상태 — 1회 500건 상한 안에서 요청이 끝나고 결과는 응답 본문이 알려 준다 | WP-019가 `batch`를 세운 뒤 |
| `EVT-ING-004 ingestion.failed`가 발행되지 않음 | 카탈로그의 소비자 `ops`가 스트림이 아니라 테이블을 읽음 / DEV-026 | 실제 상태 — 워커가 `dead_letter` 행을 동기적으로 남기므로 기록 유실은 없다 | 실시간 알림 소비자가 생기는 REL-005 |
| 재처리가 실패 단계와 무관하게 `prs:ingest`부터 다시 돎 | `EVT-ING-002`·`EVT-ING-003`이 보존되지 않음 | 실제 상태 — 투영 단계 실패도 보강부터 다시 한다. GHE 왕복이 한 번 더 든다 | 없음 (중간 이벤트를 보존하려면 별도 CR) |
| 경보 규칙 파일이 저장소에 없음 | WP-010이 k8s 매니페스트와 스크레이프 배선을 소유 | 실제 상태 — 지표(`dead_letter_open_total`)와 규칙 정의(관측성 문서 4장)는 있고 배포된 규칙만 없다 | WP-010 |
| 워커 재기동 시 논리 재시도 횟수가 초기화됨 | CR-010 `EventBus` 확장의 알려진 한계 | 실제 상태 — 재시도 상태가 프로세스 메모리에 있다. Redis의 물리 전달 횟수를 하한으로 삼아 완화했으나 at-least-once 범위 안에서 5회보다 많이 재시도될 수 있다. 실패 대기열은 정확성 경계가 아니라 운영 분류 도구다 | 필요해지면 별도 CR |
| 워커 `/metrics`가 프로세스 메모리에만 존재 (스크레이프·집계 미배선) | WP-007 구현 범위 / WP-010 | 실제 상태 — 게이트웨이와 같은 형식의 지표 모듈을 워커에 따로 뒀다 | WP-010이 한 곳으로 합친다 |
| ~~Elasticsearch 통합 시험 3종을 이 환경에서 실행하지 못함~~ | WP-003 범위 / DEV-008 | 해소 (2026-08-20) — `mirror.gcr.io/library/elasticsearch:8.19.0`이 이그레스 정책을 통과한다. CI와 같은 8.19.0으로 19건 전량 실행 | 없음 (compose 정의는 그대로이므로 DEV-001은 유효) |
| git 미러 경로 없음 — 커밋 목록은 API 폴백만 | WP-006 제외 목록 (미러는 WP-020) | 실제 상태 (ADR-005의 폴백 경로만 구현) | WP-020 |
| NDJSON 아카이브 파일을 아무도 읽지 않음 | WP-004 구현 범위 (파일 append까지) | 실제 상태 | WP-036 Filebeat 소비 |
| `/metrics`가 게이트웨이 프로세스 메모리에만 존재 (스크레이프·집계 미배선, 재기동 시 초기화) | WP-004 구현 범위 / WP-010 | 실제 상태 | WP-010 Prometheus 엔드포인트·파이프라인 지표 |
| `queue_depth{stream}` 지표 미노출 | 비동기 문서 10장 / WP-010 | 실제 상태 (버스는 파티션 스트림을 만들지만 길이를 지표로 내지 않음) | WP-010 |
| 미등록 저장소 이벤트도 그대로 저장됨 | FR-ING-009 AC-4는 "투영하지 않음"이지 "저장하지 않음"이 아님 | 실제 상태 (원본 보관 우선) — WP-008이 투영 단계에서 걸러 ack한다 (DEV-020) | WP-010 저장소 등록 API |
| 서명이 맞는데 JSON이 깨진 요청은 500 (GHE 재전송 유도) | API-ING-001 오류 코드가 401·413·500으로 한정 | 실제 상태 | 없음 (서명 유효 시 발생하지 않는 경로) |
| 커밋 문서에 메시지·작성자·부모 SHA가 없음 | WP-008 입력이 `EVT-ING-002`이고 그 이벤트는 커밋 SHA만 나른다 | 실제 상태 — SHA → PR 해석(FR-SRCH-002)에 필요한 만큼만 채운다. 조건부 업서트가 키 단위로 대입하므로 나중에 채워도 덮이지 않는다 | WP-020 미러 기반 커밋 보강 |
| `allowed_team_ids`·`author_team_ids`가 비어 있음 | WP-008 범위 밖 (권한 동기화는 WP-012) | 실제 상태 — `org_team` 접근 범위 질의는 아직 팀 조건을 만족시키지 못한다. `explicit` 범위는 `repository_id`만으로 동작한다 | WP-012 |
| `links_pending`이 영영 `true` | 관계 파생이 WP-029 | 실제 상태 — 투영이 생성 시점에만 `true`로 두고 이후 건드리지 않는다. 화면은 이 표식으로 "관계 미확정"을 표시한다 | WP-029 |
| 문서당 `EVT-ING-003`이 하나씩 발행됨 (PR 1 + 커밋 N) | 비동기 문서 4장의 payload가 엔티티 단위 | 실제 상태 — 커밋 250건 PR이면 251건이 나간다. `noop`은 내지 않아 재처리 시에는 줄어든다 | 관계 워커(WP-029) 실측 후 필요하면 CR |

## 8. 다음 작업

현재 이 저장소는 **REL-001 구현 단계**이며, CR-005로 제품 범위가 확장되어 REL-007~011이 추가되었다.

완료:

1. ~~`srs_final.md` baseline 전환~~ → 완료 (2026-08-19, v1.0, CR-003)
2. ~~`validate_srs_prd_env.py --strict` 통과 확인~~ → 완료
3. ~~OD-003·OD-006·OD-007 결정~~ → 완료 (2026-08-19, CR-004)
4. WP-001 워크스페이스 골격 → 구현 완료, `docker compose up` 검증만 보류 (DEV-001)
5. ~~WP-002 PostgreSQL 스키마와 마이그레이션~~ → 완료 (2026-08-19). 검증 결과는 6.2장
6. ~~CR-005 제품 범위 확장 (GitHub Operations Plane)~~ → 완료 (2026-08-20, SRS baseline v2.0)
7. ~~CR-006 DEV-003·DEV-004·DEV-005 문서 정정~~ → 완료 (2026-08-20)
8. ~~WP-003 Elasticsearch 매핑과 인덱스 부트스트랩~~ → 완료 (2026-08-20). 검증 결과는 6.3장
9. ~~WP-004 웹훅 수신 게이트웨이~~ → 완료 (2026-08-20). 검증 결과는 6.4장
10. ~~CR-007 DEV-007·DEV-009 데이터 모델 정정~~ → 완료 (2026-08-20)
11. ~~WP-005 EventBus 포트와 Redis Streams 어댑터~~ → 완료 (2026-08-20). 검증 결과는 6.5장
12. ~~CR-008 gh capability parity 요구사항 강화~~ → 완료 (2026-08-20, SRS baseline v2.1). gh 2.97.0 재실측, ADR-017~019, WP-061~065, C-061~067 추가
13. ~~WP-006 GHE 클라이언트와 rate limit 관리~~ → 완료 (2026-08-20). 검증 결과는 6.6장. 실제 GHE smoke만 자격 증명 부재로 미실행
14. ~~CR-009 typed gh 결과 계약과 조합 parity~~ → 완료 (2026-08-20, SRS baseline v2.2). ADR-020, WP-066 추가, 기존 안정 ID 재번호화 0건
15. ~~CR-010 WP-007 파이프라인 계약 정정~~ → 완료 (2026-08-20). DEV-012~015 해소, DEV-016은 라우팅 소유 WP로 이월
16. ~~WP-007 보강 워커~~ → 완료 (2026-08-20). 검증 결과는 6.7장. 실제 GHE smoke와 ES 통합 시험은 미실행
17. ~~CR-011 WP-008 투영 계약 정정~~ → 완료 (2026-08-20). DEV-018~020 해소. SRS 버전은 v2.2 유지(정합성 수정)
18. ~~WP-008 투영 워커와 버전 조건부 업서트~~ → 완료 (2026-08-20). 검증 결과는 6.8장. 통합 스위트 전량(158건)이 처음으로 통과했다
19. ~~CR-012 WP-009 실패 대기열 계약 정정~~ → 완료 (2026-08-20). DEV-022~025·DEV-027 해소, DEV-026은 알림 소비자를 소유한 REL-005로 이월. SRS 버전은 v2.2 유지(정합성 수정)
20. ~~WP-009 실패 대기열과 재처리~~ → 완료 (2026-08-20). 검증 결과는 6.9장. 통합 191건 전량 통과

**다음 WP: WP-010 저장소 등록 API와 파이프라인 지표.**

CR-008은 문서만 강화했다. GitHub Operations Plane(REL-007~011) 구현 순서는 바뀌지 않는다 — Search/Data Plane을 end-to-end로 닫은 뒤다. `@prs/github`은 Data Plane의 GitHub REST 클라이언트이며 `gh` CLI를 실행하지 않는다 (ADR-013).

WP-010은 지금 파이프라인이 조용히 버리고 있는 것을 없앤다. 투영은 `repository` 행이 없는 이벤트를 문서로 만들지 않고 ack하는데(DEV-020), **그 행을 넣을 API가 아직 없다.** 그래서 이 시스템은 현재 어떤 저장소도 정식으로 등록할 수 없고, 미등록 이벤트는 `processed_at`이 영영 NULL로 남아 `JOB-ING-007`이 10분마다 다시 집는다. WP-010이 `/admin/repositories`와 `/admin/pipeline-status`를 세워 FR-ING-009·FR-ADMIN-001을 닫고, 흩어져 있는 세 개의 `/metrics`(게이트웨이·워커·ops)를 한 곳으로 합친다. 감사 적재(`audit_record`)도 WP-010 DoD에 있으므로, WP-009가 신원 부재로 남겨 둔 재처리 감사 기록이 그때 자리를 얻는다.

CR-005는 문서 범위만 확장했다. 구현 순서는 바뀌지 않는다 — Search/Data Plane(REL-001~006)을 end-to-end로 닫은 뒤에 Operations Plane(REL-007~011)을 시작한다. GitHub Operations 기능을 REL-001 WP 안에 섞지 않는다.

수집 경로는 웹훅에서 검색 인덱스까지 닫혔다. 남은 것은 **검색하는 쪽**과 **실패한 것을 되살리는 쪽**이다. 문서는 색인되지만 아직 그것을 질의하는 API(WP-013~018)도, 실패 대기열을 다루는 관리 경로(WP-009)도 없다.

권장 순서:

```text
~~WP-003 Elasticsearch~~ 완료
~~WP-004 웹훅 게이트웨이~~ 완료
~~WP-005 Redis EventBus~~ 완료
~~WP-006 GitHub REST 클라이언트~~ 완료
~~WP-007 보강 워커~~ 완료
~~WP-008 투영 워커~~ 완료
→ WP-009 DLQ
→ WP-010 저장소 등록·파이프라인 지표
   ... REL-002~006 ...
→ WP-045 gh capability 레지스트리   (REL-007 시작)
```

남은 착수 조건:

| 항목 | 필요 시점 |
| --- | --- |
| GitHub App 발급(읽기 전용), 웹훅 엔드포인트 등록, OIDC 클라이언트 등록 | **WP-006~WP-008 구현은 자격 증명 없이 끝냈다**(목 서버 계약 시험 + 실제 PostgreSQL·Redis·Elasticsearch). 실제 GHE smoke와 end-to-end 실동작 검증에 필요하다 |
| `prs:sequence` 파티션 수 결정 (DEV-010) | WP-021 시퀀스 채번 전까지 |
| ES 컨테이너 3개의 Docker host 배치 확정 | REL-001 프로비저닝 |
| 컨테이너 레지스트리 접근 환경에서 `docker compose up -d` 재검증 | DEV-001 |
| GitHub Operations App 발급과 권한 승인 | REL-007 |
| 비밀 저장소 연동 | REL-007 |
| `gh-executor` 런타임 프로비저닝과 gh 버전 고정 | REL-007 |

`srs_final.md`가 baseline이므로 그 문서의 변경은 CR을 먼저 등록해야 한다. 구현 중 문서와 현실이 어긋나면 5장에 `DEV-###`를 등록하고 CR로 연결한다. 조용한 범위 변경은 금지다.

착수 후 매 WP 완료 시 이 문서의 3·4·6장을 갱신한다. 갱신 없는 완료 보고는 완료가 아니다.
