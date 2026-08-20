# PR Search 구현 추적 원장

> 상태: review | 버전: v0.5 | 갱신일: 2026-08-20

## 1. 목적

구현이 시작된 후 문서와 코드의 정합성을 유지하는 살아있는 원장이다. 코딩 에이전트는 WP를 완료할 때마다 이 문서를 갱신한다. 이 문서는 기록용이며 범위를 결정하지 않는다.

**현재 상태: WP-005까지 완료.** 워크스페이스 골격, PostgreSQL 스키마·리포지터리 계층, Elasticsearch 매핑·부트스트랩, GHE 웹훅 수신 게이트웨이, `EventBus` 포트와 Redis Streams 어댑터가 서 있다. 단위 86건·통합 93건(PostgreSQL·Redis 계열)이 통과한다. 웹훅이 들어오면 서명 검증 → `raw_event` 저장 → `prs:ingest` 발행 → NDJSON 아카이브 → 202까지 실제로 동작하고, Redis를 정지시켜도 202가 나가며 복구 후 `JOB-ING-007`이 유실분을 재적재한다. 1000건 부하에서 수신 응답 p95는 35.6ms다(예산 300ms, 발행 포함). 소비자 로직(보강·투영·채번·관계 파생)과 검색 API·화면은 아직 없다.

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
| FR-ING-002 | WP-002, WP-004, WP-008 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/repositories/raw-event.ts`, `packages/db/src/advisory-lock.ts`, `apps/ingest-gateway/src/{store,payload}.ts` | `packages/db/integration/constraints.test.ts`, `apps/ingest-gateway/integration/{webhook,idempotency}.test.ts` | partial (AC-1~AC-4 검증. AC-5 결정론적 문서 ID는 WP-008) |
| FR-ING-003 | WP-002, WP-004 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/partitions.ts`, `packages/db/src/repositories/raw-event.ts`, `apps/ingest-gateway/src/archive.ts` | `packages/db/integration/{partitions,constraints}.test.ts`, `apps/ingest-gateway/integration/webhook.test.ts` | partial (AC-1·AC-2·AC-4 충족. AC-3 원본만으로 재색인은 WP-008·WP-033) |
| FR-ING-004 | WP-006, WP-007 | - | - | not_started |
| FR-ING-005 | WP-005, WP-008 | `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts` | `packages/bus/src/partition.test.ts`, `packages/bus/integration/{contract,redis-streams,in-memory}.test.ts` | partial (투영에 이벤트를 나르는 전달 계층만. 문서 생성·업서트는 WP-008) |
| FR-ING-006 | WP-019 | - | - | not_started |
| FR-ING-007 | WP-002, WP-009 | `packages/db/migrations/001_ingestion.up.sql`, `packages/db/src/repositories/dead-letter.ts` | - | partial (격리 테이블과 리포지터리. 재처리 흐름은 WP-009) |
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
| FR-AUTH-004 | WP-002, WP-039 | `packages/db/migrations/004_app_state.up.sql`, `packages/db/migrations/005_roles.up.sql` | `packages/db/integration/audit-grants.test.ts` (AC-3) | partial (감사 테이블과 롤 권한. 기록·조회는 WP-039) |
| FR-ADMIN-001 | WP-010, WP-040 | - | - | not_started |
| FR-ADMIN-002 | WP-002, WP-019, WP-040 | `packages/db/migrations/004_app_state.up.sql` (`job_active_uk`), `packages/db/src/repositories/job.ts` | `packages/db/integration/constraints.test.ts` (AC-4) | partial (동시 실행 제약. 콘솔은 WP-040) |
| FR-ADMIN-003 | WP-028, WP-040 | - | - | not_started |
| NFR-001 | WP-013, WP-014, WP-023, WP-037 | - | - | not_started |
| NFR-002 | WP-004, WP-005, WP-008 | `apps/ingest-gateway/src/{server,metrics}.ts`, `packages/bus/src/{types,topics,partition,config,redis-streams,in-memory}.ts` | `apps/ingest-gateway/integration/{load,enqueue}.test.ts` | partial (발행까지 포함한 수신 응답 p95 35.6ms / 예산 300ms. 색인 반영 지연은 WP-008) |
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
| DEV-008 | 2026-08-20 | WP-003의 검증 방법은 실제 Elasticsearch 대상 통합 테스트지만, 이 실행 환경은 `docker.elastic.co`와 `artifacts.elastic.co`가 이그레스 정책에서 403으로 차단되고 네이티브 설치본도 없어 ES를 띄울 수 없다. DoD 4항(컴파일 타임 가드)만 로컬에서 검증했고 나머지 4항은 CI의 Elasticsearch 서비스 컨테이너에서 검증한다. 우회하거나 목으로 대체하지 않았다 | WP-003 | 기술 제약 | 불필요 (검증 수단만 다름) | open — 레지스트리 접근이 되는 환경에서 로컬 재검증 필요 |
| DEV-009 | 2026-08-20 | 데이터 모델 3.1은 `raw_event`의 멱등 제약을 "기본 키가 그대로 강제한다"고 적었으나 이 파티션 구성에서는 성립하지 않는다. PostgreSQL은 파티션 테이블의 유일 제약이 파티션 키를 포함하도록 요구해 기본 키가 `(delivery_id, received_at)`이고, GHE 재전송은 수신 시각이 달라 충돌하지 않는다 — 문서대로 "INSERT 충돌을 잡아 중복 처리"만 구현하면 같은 `delivery_id`가 두 행이 되어 FR-ING-002 AC-2와 WP-004 DoD 3이 깨진다. 실제로 조건부 INSERT를 빼고 돌려 확인했다(동시 8건 → 8행). 게이트웨이가 같은 트랜잭션에서 `delivery_id` advisory lock을 잡고 존재 검사와 INSERT를 한 문장으로 묶어 강제한다. 기본 키 충돌은 마지막 방어선으로 남겼다. **마이그레이션 001~005는 건드리지 않았다** | WP-004 / FR-ING-002 | 문서 오류 | **CR-007** | **resolved (2026-08-20)** — 데이터 모델 3.1에 파티션 유일 제약의 한계와 게이트웨이 멱등 저장 SQL을 명시했다. SRS FR-ING-002 AC-1이 요구하는 결과(중복 저장 차단)는 그대로 충족되므로 요구사항은 변경하지 않았다 |
| DEV-010 | 2026-08-20 | 비동기 문서 2장의 스트림 표는 동시성을 다섯 스트림에 숫자로 적었지만 `prs:sequence`만 "시퀀스 공간당 1 (advisory lock)"이라고만 적혀 있어 전체 파티션 수를 알 수 없다. Redis Streams 어댑터는 토픽을 물리 스트림 N개로 펴므로 이 숫자가 반드시 필요하다. 순서 보장은 advisory lock이 이미 하므로 이 값은 처리량 조절값이며, 관계 파생과 같은 8을 코드 기본값으로 두고 `PRS_PARTITIONS_prs:sequence` 환경 변수로 덮어쓸 수 있게 했다. **확정한 것이 아니라 기본값을 둔 것이다** — 운영 실측 뒤 사용자가 정하면 코드 변경 없이 반영된다 | WP-005 / FR-SEQ-001 | 문서 공백 | 미등록 — 사용자 결정 후 비동기 문서 2장에 반영할 CR 필요 | open |
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

**환경 제약.** Elasticsearch만 여전히 로컬에서 띄울 수 없다(DEV-008). WP-005는 Elasticsearch를 쓰지 않으므로 이 WP의 DoD에는 영향이 없다.

### 6.6 릴리스 게이트

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
| 각 앱 헬스체크가 백킹 서비스 연결을 확인하지 않음 | WP-001 구현 범위 (프로세스 기동만) | `ingest-gateway`는 해소 — `GET /healthz`가 PostgreSQL을 확인하고 실패 시 503 (인프라 3장) | `search-api`(ES·PG)는 WP-008 이후, `web`·`pipeline-worker`는 기존대로 |
| 통합 테스트가 testcontainers가 아니라 외부 PostgreSQL에 붙음 | WP-002 검증 방법 / DEV-006 | 실제 상태 (환경 변수로 접속 정보 주입) | WP-003에서 ES와 함께 재검토 |
| `saved_search`·`bisect_session`·`permission_cache`·`team`에 리포지터리 계층이 없음 | WP-002 구현 범위 (6종만 명시) | 실제 상태 (스키마는 존재) | 각각을 쓰는 WP-012·WP-024·WP-042 |
| 큐에 들어간 이벤트를 아무도 소비하지 않음 (`processed_at`이 영영 NULL) | WP-005 제외 목록 (소비자 로직은 WP-007·WP-008) | 실제 상태 — 그 결과 `JOB-ING-007`이 모든 행을 10분마다 계속 재적재한다 | WP-008 투영 워커가 `markProcessed`를 부르면 멈춘다 |
| `prs:sequence` 파티션 수가 문서에 없어 코드 기본값 8을 씀 | 비동기 문서 2장 / DEV-010 | 실제 상태 (환경 변수로 덮어쓸 수 있음) | 사용자 결정 후 CR |
| Kafka 어댑터 없음 | WP-005 제외 목록 (ADR-002 전환 임계 조건부) | 실제 상태 — 계약 테스트가 교체 가능성을 강제한다 | 전환 임계 충족 시 |
| NDJSON 아카이브 파일을 아무도 읽지 않음 | WP-004 구현 범위 (파일 append까지) | 실제 상태 | WP-036 Filebeat 소비 |
| `/metrics`가 게이트웨이 프로세스 메모리에만 존재 (스크레이프·집계 미배선, 재기동 시 초기화) | WP-004 구현 범위 / WP-010 | 실제 상태 | WP-010 Prometheus 엔드포인트·파이프라인 지표 |
| `queue_depth{stream}` 지표 미노출 | 비동기 문서 10장 / WP-010 | 실제 상태 (버스는 파티션 스트림을 만들지만 길이를 지표로 내지 않음) | WP-010 |
| 미등록 저장소 이벤트도 그대로 저장됨 | FR-ING-009 AC-4는 "투영하지 않음"이지 "저장하지 않음"이 아님 | 실제 상태 (원본 보관 우선) | WP-010 저장소 등록 API |
| 서명이 맞는데 JSON이 깨진 요청은 500 (GHE 재전송 유도) | API-ING-001 오류 코드가 401·413·500으로 한정 | 실제 상태 | 없음 (서명 유효 시 발생하지 않는 경로) |

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

**다음 WP: WP-006 GHE 클라이언트와 rate limit 관리.**

CR-005는 문서 범위만 확장했다. 구현 순서는 바뀌지 않는다 — Search/Data Plane(REL-001~006)을 end-to-end로 닫은 뒤에 Operations Plane(REL-007~011)을 시작한다. GitHub Operations 기능을 REL-001 WP 안에 섞지 않는다.

수집 경로는 이제 게이트웨이에서 큐까지 닫혔다. 남은 구멍은 소비 쪽이다 — 아무도 `processed_at`을 찍지 않아 `JOB-ING-007`이 모든 행을 10분마다 계속 재적재한다. WP-007(보강)과 WP-008(투영)이 소비자를 붙이면서 그 표식을 찍어야 멈춘다.

권장 순서:

```text
~~WP-003 Elasticsearch~~ 완료
~~WP-004 웹훅 게이트웨이~~ 완료
~~WP-005 Redis EventBus~~ 완료
→ WP-006 GitHub REST 클라이언트
→ WP-007 보강 워커
→ WP-008 투영 워커
→ WP-009 DLQ
→ WP-010 저장소 등록·파이프라인 지표
   ... REL-002~006 ...
→ WP-045 gh capability 레지스트리   (REL-007 시작)
```

남은 착수 조건:

| 항목 | 필요 시점 |
| --- | --- |
| GitHub App 발급(읽기 전용), 웹훅 엔드포인트 등록, OIDC 클라이언트 등록 | **WP-006이 바로 필요로 한다** (WP-004는 `GHE_WEBHOOK_SECRET`만 있으면 된다) |
| `prs:sequence` 파티션 수 결정 (DEV-010) | WP-021 시퀀스 채번 전까지 |
| ES 컨테이너 3개의 Docker host 배치 확정 | REL-001 프로비저닝 |
| 컨테이너 레지스트리 접근 환경에서 `docker compose up -d` 재검증 | DEV-001 |
| GitHub Operations App 발급과 권한 승인 | REL-007 |
| 비밀 저장소 연동 | REL-007 |
| `gh-executor` 런타임 프로비저닝과 gh 버전 고정 | REL-007 |

`srs_final.md`가 baseline이므로 그 문서의 변경은 CR을 먼저 등록해야 한다. 구현 중 문서와 현실이 어긋나면 5장에 `DEV-###`를 등록하고 CR로 연결한다. 조용한 범위 변경은 금지다.

착수 후 매 WP 완료 시 이 문서의 3·4·6장을 갱신한다. 갱신 없는 완료 보고는 완료가 아니다.
