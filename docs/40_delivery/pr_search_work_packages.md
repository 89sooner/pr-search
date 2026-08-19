# PR Search 작업 패키지

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

구현 로드맵의 릴리스 슬라이스(REL)를 코딩 에이전트가 한 세션에서 완료·검증할 수 있는 작업 패키지(WP)로 분해한다. WP는 범위를 새로 만들 수 없으며, 모든 WP는 승인된 FR을 참조해야 한다.

## 2. WP 작성 규칙

- 1 WP = 1 에이전트 세션 규모. 구현과 검증이 한 번에 끝나는 크기로 자른다.
- FE/API/데이터/테스트를 관통하는 수직 슬라이스를 우선한다. 앱 셸·인프라 부트스트랩 WP는 예외적으로 수평일 수 있다.
- 선행 WP를 명시하고 순환 의존을 만들지 않는다.
- 완료 기준(DoD)은 체크 가능한 항목만 적는다. QA 체크리스트 항목 ID와 상태 매트릭스 항목을 **인용**하고 다시 서술하지 않는다.
- WP 완료 시 `pr_search_implementation_traceability.md`를 갱신한다.

## 3. WP 순서와 의존성

| WP ID | 이름 | REL | 선행 WP | 상태 |
| --- | --- | --- | --- | --- |
| WP-001 | 워크스페이스와 공유 패키지 골격 | REL-001 | - | todo |
| WP-002 | PostgreSQL 스키마와 마이그레이션 | REL-001 | WP-001 | todo |
| WP-003 | Elasticsearch 매핑과 인덱스 부트스트랩 | REL-001 | WP-001 | todo |
| WP-004 | 웹훅 수신 게이트웨이 | REL-001 | WP-002 | todo |
| WP-005 | EventBus 포트와 Redis Streams 어댑터 | REL-001 | WP-001 | todo |
| WP-006 | GHE 클라이언트와 rate limit 관리 | REL-001 | WP-001 | todo |
| WP-007 | 보강 워커 | REL-001 | WP-005, WP-006 | todo |
| WP-008 | 투영 워커와 버전 조건부 업서트 | REL-001 | WP-003, WP-007 | todo |
| WP-009 | 실패 대기열과 재처리 | REL-001 | WP-007, WP-008 | todo |
| WP-010 | 저장소 등록 API와 파이프라인 지표 | REL-001 | WP-008 | todo |
| WP-011 | 구조화 질의 파서 | REL-002 | WP-001 | todo |
| WP-012 | 인증과 접근 범위 강제 | REL-002 | WP-002 | todo |
| WP-013 | 검색 API 목록 조회 | REL-002 | WP-011, WP-012 | todo |
| WP-014 | 식별자 해석 API | REL-002 | WP-013 | todo |
| WP-015 | 웹 앱 셸과 Conductor 통합 | REL-002 | WP-001 | todo |
| WP-016 | W-001 통합 검색 화면 | REL-002 | WP-013, WP-014, WP-015 | todo |
| WP-017 | W-002 PR 상세 화면 | REL-002 | WP-015, WP-016 | todo |
| WP-018 | W-003 커밋 상세 화면 | REL-002 | WP-015, WP-016 | todo |
| WP-019 | 저장소 백필 잡 | REL-002 | WP-006, WP-008 | todo |
| WP-020 | 커밋 그래프 접근 계층 | REL-003 | WP-006 | todo |
| WP-021 | 시퀀스 증분 채번 | REL-003 | WP-002, WP-020 | todo |
| WP-022 | 시퀀스 재채번과 에폭 | REL-003 | WP-021 | todo |
| WP-023 | 앵커 정규화와 범위 조회 API | REL-003 | WP-021, WP-013 | todo |
| WP-024 | 릴리스 수집과 포함 관계 | REL-003 | WP-021, WP-008 | todo |
| WP-025 | W-004 범위 조사 화면 | REL-003 | WP-023, WP-015 | todo |
| WP-026 | W-005 릴리스 화면과 구간 비교 | REL-003 | WP-024, WP-025 | todo |
| WP-027 | 선행·후행 조회와 상세 화면 통합 | REL-003 | WP-023, WP-017, WP-018 | todo |
| WP-028 | 정합성 점검과 조정 스캔 | REL-003 | WP-021, WP-019 | todo |
| WP-029 | 관계 간선 인덱스와 참조 추출 | REL-004 | WP-008, WP-003 | todo |
| WP-030 | 되돌림·체리픽·스택 관계 파생 | REL-004 | WP-029, WP-020 | todo |
| WP-031 | 관계 조회 API와 상세 화면 관계 섹션 | REL-004 | WP-030, WP-017 | todo |
| WP-032 | 패싯·커서 페이지네이션·전문 검색 | REL-004 | WP-013, WP-016 | todo |
| WP-033 | 저장된 검색 | REL-004 | WP-013, WP-016 | todo |
| WP-034 | W-009 저장소 개요 화면 | REL-004 | WP-010, WP-028 | todo |
| WP-035 | 무중단 재색인 | REL-004 | WP-003, WP-008 | todo |
| WP-036 | 원본 아카이브 레인(Filebeat) | REL-004 | WP-004 | todo |
| WP-037 | 집계 API | REL-005 | WP-013 | todo |
| WP-038 | W-006 통계 대시보드 | REL-005 | WP-037, WP-015 | todo |
| WP-039 | 감사 기록과 A-004 | REL-005 | WP-012, WP-002 | todo |
| WP-040 | A-002·A-003 운영 콘솔 | REL-005 | WP-010, WP-019, WP-028, WP-035 | todo |
| WP-041 | 안전 구간 표식 | REL-006 | WP-023, WP-025 | todo |
| WP-042 | 이분 탐색 보조 | REL-006 | WP-023, WP-025 | todo |
| WP-043 | 관계 그래프 API와 W-007 | REL-006 | WP-031 | todo |
| WP-044 | 검색 결과 내보내기 | REL-006 | WP-013, WP-016 | todo |

의존 그래프에 순환은 없다. WP-001~WP-003과 WP-005·WP-006은 병렬 착수 가능하다.

---

## REL-001 수집 파이프라인과 저장 기반

### WP-001 워크스페이스와 공유 패키지 골격

- 목표: 전 계층 TypeScript 모노레포가 빌드·타입체크·린트·테스트를 통과하는 상태로 선다.
- 관련 요구사항: NFR-008
- 관련 화면/플로우: 없음 (인프라 부트스트랩)
- 관련 API/데이터/잡: 없음
- 선행 WP: 없음
- 구현 범위:
  - pnpm 워크스페이스 구성 (`packages/*`, `apps/*`), Node 20+ 고정
  - `@prs/domain` 골격: 도메인 타입(`Repository`, `PullRequest`, `Commit`, `SequenceSpace`, `Link`), 관계 유형·신뢰도 enum, 상수
  - `@prs/contracts` 골격: 오류 코드 enum (API 계약 6장 전체), 공통 응답 타입
  - 빈 패키지 골격: `@prs/query`, `@prs/es`, `@prs/db`, `@prs/github`, `@prs/bus`
  - 앱 골격: `ingest-gateway`, `pipeline-worker`, `search-api`, `web` (각각 헬스체크만)
  - `pnpm lint:deps`: 패키지 의존 방향(`domain → 나머지 → apps`) 역방향 참조 시 종료 코드 1
  - CI: typecheck, lint, lint:deps, test, build
  - docker compose: PostgreSQL 16, Elasticsearch 8.x, Redis 7
- 제외:
  - 실제 도메인 로직, API 구현, 화면
  - 배포 매니페스트 (WP-010에서)
- 완료 기준(DoD):
  - [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm lint:deps && pnpm test && pnpm build`가 전부 통과한다
  - [ ] 역방향 의존을 일부러 추가하면 `pnpm lint:deps`가 종료 코드 1로 실패한다
  - [ ] `docker compose up`으로 세 백킹 서비스가 기동하고 각 앱 헬스체크가 200을 반환한다
  - [ ] 오류 코드 enum이 API 계약 6장의 모든 코드를 포함한다
- 검증 방법: `pnpm install && pnpm typecheck && pnpm lint && pnpm lint:deps && pnpm test && pnpm build`
- 기록: 원장 WP-001 상태, 실행 명령을 `../30_technical_architecture/pr_search_infrastructure_operations.md` 8장과 대조해 갱신

### WP-002 PostgreSQL 스키마와 마이그레이션

- 목표: 시스템 오브 레코드 스키마가 마이그레이션으로 적용·롤백된다.
- 관련 요구사항: FR-ING-003, FR-SEQ-001, FR-AUTH-004, NFR-003
- 관련 화면/플로우: 없음
- 관련 API/데이터/잡: ENT-ING-001, ENT-ING-002, ENT-ING-004, ENT-SEQ-001, ENT-SEQ-002, ENT-CORE-001, ENT-CORE-005, ENT-CORE-007
- 선행 WP: WP-001
- 구현 범위:
  - `../30_technical_architecture/pr_search_data_model.md` 3장의 전 테이블 생성 마이그레이션
  - `raw_event`, `audit_record` 월별 파티션과 파티션 생성 잡
  - `job` 부분 유니크 인덱스, `safe_marker` 부분 유니크 인덱스
  - `@prs/db` 리포지터리 계층: `raw_event`, `repository`, `sequence_space`, `merge_sequence`, `job`, `dead_letter`
  - advisory lock 헬퍼 (`pg_try_advisory_xact_lock`)
  - 각 마이그레이션의 down 스크립트
  - 개발용 합성 시드 (저장소 3, PR 200, 커밋 500, 릴리스 10)
- 제외:
  - Elasticsearch 매핑 (WP-003)
  - 실제 데이터 적재 로직
- 완료 기준(DoD):
  - [ ] `pnpm db:migrate` 후 `pnpm db:migrate --down`이 스키마를 원복한다
  - [ ] `pnpm db:seed`가 합성 데이터를 적재한다
  - [ ] 같은 `delivery_id` 두 번 INSERT 시 유니크 위반이 발생한다 (FR-ING-002 AC-1)
  - [ ] 같은 `(type, target)` 활성 잡 두 개 INSERT 시 유니크 위반이 발생한다 (FR-ADMIN-002 AC-4)
  - [ ] advisory lock 헬퍼가 동시 호출 시 하나만 성공한다 (FR-SEQ-001 AC-6)
  - [ ] 애플리케이션 DB 롤이 `audit_record`에 UPDATE/DELETE 권한을 갖지 않는다 (FR-AUTH-004 AC-3)
- 검증 방법: `pnpm test:integration -- db` (testcontainers PostgreSQL)
- 기록: 원장 WP-002 상태, FR-ING-003·FR-SEQ-001의 구현 위치 매핑

### WP-003 Elasticsearch 매핑과 인덱스 부트스트랩

- 목표: 엔티티 인덱스가 코드 정의대로 생성되고 별칭으로 참조된다.
- 관련 요구사항: FR-ING-005, NFR-001, NFR-003, NFR-005
- 관련 API/데이터/잡: ENT-CORE-002, ENT-CORE-003, ENT-REL-001, ENT-REL-002
- 선행 WP: WP-001
- 구현 범위:
  - `@prs/es`에 `../30_technical_architecture/pr_search_data_model.md` 4장의 매핑 4종을 코드로 정의 (`prs-pull-requests`, `prs-commits`, `prs-links`, `prs-releases`)
  - 공통 settings: `index.sort`, `lowercase_normalizer`, `text_ko_en`, `path_analyzer`
  - `pnpm es:apply-mappings`: 인덱스 생성 + 별칭 부여
  - 매핑 정의와 실제 클러스터 매핑 일치 검증 테스트
  - `applyMandatoryScopeFilter` / `ScopedQuery` 브랜드 타입 골격 (구현은 WP-012)
- 제외:
  - 아카이브 인덱스와 ILM (WP-036)
  - 재색인 (WP-035)
  - 실제 질의 빌더 (WP-013)
- 완료 기준(DoD):
  - [ ] `pnpm es:apply-mappings`가 4개 인덱스와 별칭을 생성한다
  - [ ] 매핑 일치 검증 테스트가 통과한다
  - [ ] 매핑에 정의되지 않은 필드를 색인하면 거부된다 (`dynamic: strict`, THR-010)
  - [ ] `es.search()`가 `ScopedQuery`가 아닌 인자를 받으면 컴파일 실패한다 (ADR-008)
  - [ ] `commit_sha`가 대소문자 무관하게 매칭된다 (FR-SRCH-004 AC-4)
- 검증 방법: `pnpm test:integration -- es`
- 기록: 원장 WP-003 상태

### WP-004 웹훅 수신 게이트웨이

- 목표: GHE 웹훅이 검증·저장되고 202가 반환된다. 유실이 발생하지 않는다.
- 관련 요구사항: FR-ING-001, FR-ING-002, FR-ING-003, NFR-002, NFR-005
- 관련 화면/플로우: 없음 (간접 노출: A-001)
- 관련 API/데이터/잡: API-ING-001, ENT-ING-001, JOB-ING-001, EVT-ING-001
- 선행 WP: WP-002
- 구현 범위:
  - Fastify 기반 `POST /api/v1/webhooks/github`
  - 원문 바이트에 대한 HMAC-SHA256 상수 시간 검증 (**JSON 파싱 이전**)
  - 25MB 크기 상한, 초과 시 413
  - `raw_event` INSERT (유니크 충돌 시 중복 처리 후 202)
  - `delivery_id` 부재 시 payload 정규화 해시를 멱등 키로 사용
  - 상관 ID 생성
  - NDJSON 아카이브 파일 append (Filebeat 소비는 WP-036)
  - 지원 이벤트 유형 화이트리스트, 그 외는 저장만
  - 메트릭: `ingest_received_total`, `ingest_rejected_total`, `ingest_duplicate_total`, `ingest_response_seconds`
  - graceful shutdown 30초
- 제외:
  - 큐 enqueue (WP-005에서 연결)
  - 보강·투영
- 완료 기준(DoD):
  - [ ] 유효 서명 요청이 202를 반환하고 `raw_event`에 저장된다
  - [ ] 무효·변조 서명이 401을 반환하고 payload가 저장되지 않는다 (FR-ING-001 AC-2)
  - [ ] 같은 `delivery_id` 재전송이 202 + `duplicate: true`를 반환하고 행이 늘지 않는다 (FR-ING-002 AC-2)
  - [ ] 25MB 초과 요청이 413을 반환한다 (AC-6)
  - [ ] `raw_event` INSERT 실패 시 500을 반환한다 (AC-4 예외 처리)
  - [ ] 수신 응답 p95가 300ms 이하다 (AC-4) — 부하 시험 1000 요청
  - [ ] 서명 검증이 JSON 파싱보다 먼저 수행됨을 테스트로 확인한다 (보안 9장)
  - [ ] QA-A001-01의 수신 지표가 노출된다
- 검증 방법: `pnpm test:integration -- gateway`, `pnpm test -- gateway/signature`
- 기록: 원장 WP-004 상태, FR-ING-001·FR-ING-002 매핑

### WP-005 EventBus 포트와 Redis Streams 어댑터

- 목표: 파티션 키 기반 이벤트 전달이 동작하고, 어댑터 교체가 가능한 구조가 선다.
- 관련 요구사항: FR-ING-005, NFR-002
- 관련 API/데이터/잡: EVT-ING-001~004
- 선행 WP: WP-001
- 구현 범위:
  - `@prs/bus`의 `EventBus` 포트 (ADR-002의 시그니처)
  - `RedisStreamsEventBus` 어댑터: 스트림 6종, 소비자 그룹, 파티션 키 기반 분배, ack, 재시도 카운트
  - `EventEnvelope` 타입 (상관 ID, 파티션 키, 페이로드)
  - 어댑터 계약 테스트 (장래 Kafka 어댑터가 같은 테스트를 통과해야 함)
  - `JOB-ING-007` 아웃박스 재적재 잡: `queued_at` 있고 `processed_at` 없는 10분 경과 행 재적재
  - WP-004의 게이트웨이에 enqueue 연결
- 제외:
  - Kafka 어댑터 (조건부, OD-006)
  - 실제 소비자 로직 (WP-007, WP-008)
- 완료 기준(DoD):
  - [ ] 같은 파티션 키의 메시지가 같은 소비자에게 순서대로 전달된다
  - [ ] 소비자 장애 시 미ack 메시지가 재전달된다
  - [ ] 계약 테스트가 통과한다
  - [ ] Redis를 정지시킨 뒤 이벤트를 수신하면 게이트웨이는 202를 반환하고, Redis 복구 후 `JOB-ING-007`이 해당 이벤트를 재적재한다 (ADR-002 follow-up)
- 검증 방법: `pnpm test:integration -- bus`
- 기록: 원장 WP-005 상태

### WP-006 GHE 클라이언트와 rate limit 관리

- 목표: GitHub Enterprise API를 한도를 넘지 않고 호출한다.
- 관련 요구사항: FR-ING-004, NFR-002
- 관련 API/데이터/잡: 외부 인터페이스 (SRS 10장)
- 선행 WP: WP-001
- 구현 범위:
  - `@prs/github`: GitHub App 설치 토큰 발급·갱신(1시간), 조직별 토큰 풀
  - `x-ratelimit-remaining` / `x-ratelimit-reset` 추적, 잔여 10% 미만 토큰 격리
  - secondary rate limit(429 + `retry-after`) 처리
  - 필요한 오퍼레이션: PR 조회, PR 커밋 목록, PR 파일 목록, PR 리뷰 목록, 태그·릴리스 목록, 저장소·팀·협업자 조회, 커밋 목록(폴백 경로)
  - 메트릭: `github_rate_limit_remaining{token}`
  - 실시간 요청이 백필보다 우선 배분되는 큐
- 제외:
  - git 미러 실행기 (WP-020)
  - 실제 보강 로직 (WP-007)
- 완료 기준(DoD):
  - [ ] 토큰이 만료되면 자동 갱신된다
  - [ ] 잔여 10% 미만 토큰이 회복 시각까지 풀에서 제외된다 (FR-ING-004 AC-2)
  - [ ] 429 + `retry-after` 수신 시 해당 토큰이 지정 시간 격리된다
  - [ ] 실시간 요청이 백필 요청보다 먼저 토큰을 배분받는다
  - [ ] 토큰 값이 로그에 남지 않는다 (THR-009)
- 검증 방법: `pnpm test -- github` (목 서버 기반)
- 기록: 원장 WP-006 상태

### WP-007 보강 워커

- 목표: PR 이벤트에 없는 커밋·파일·리뷰가 채워진다. 실패해도 부분 문서가 남는다.
- 관련 요구사항: FR-ING-004
- 관련 API/데이터/잡: JOB-ING-002, EVT-ING-002
- 선행 WP: WP-005, WP-006
- 구현 범위:
  - `pipeline-worker` enrich 역할: `prs:ingest` 소비
  - 원본 커밋 SHA 목록, 변경 파일 경로·추가/삭제 라인, 리뷰어·리뷰 상태 조회
  - 원본 커밋 250건 초과 시 절삭 + `source_commits_truncated`
  - 변경 파일 3000개 초과 시 절삭 + `files_truncated`
  - rate limit 잔여 10% 미만 시 지연·재시도 예약
  - 보강 실패 시 부분 문서를 `enrichment_pending: true`로 진행
  - 표준 재시도 정책(5회 지수 백오프 + 지터), 재시도 불가 오류 즉시 DLQ
  - `EVT-ING-002` 발행
  - 메트릭: `enrich_pending_total`, `stage_latency_seconds{stage="enrich"}`
- 제외:
  - 미러 기반 커밋 조회 (WP-020에서 추가)
  - ES 색인 (WP-008)
- 완료 기준(DoD):
  - [ ] PR 이벤트 처리 후 커밋·파일·리뷰가 병합된 결과가 `EVT-ING-002`로 발행된다 (FR-ING-004 AC-1)
  - [ ] rate limit 소진 시 보강이 지연되고 회복 시각에 재시도된다 (AC-2)
  - [ ] 보강 실패 시에도 부분 결과가 `enrichment_pending: true`로 진행된다 (AC-3)
  - [ ] 변경 파일 3000개 초과 시 절삭되고 플래그가 설정된다 (AC-4)
  - [ ] 재시도 5회 소진 시 DLQ로 이동한다 (FR-ING-007 AC-1)
  - [ ] 404(삭제된 PR)는 재시도 없이 즉시 DLQ로 간다 (async 5.2)
- 검증 방법: `pnpm test:integration -- worker/enrich`
- 기록: 원장 WP-007 상태, FR-ING-004 매핑

### WP-008 투영 워커와 버전 조건부 업서트

- 목표: 정규화 문서가 Elasticsearch에 색인되고, 순서가 뒤바뀌어도 최신 상태가 유지된다.
- 관련 요구사항: FR-ING-005, NFR-002
- 관련 API/데이터/잡: JOB-ING-003, EVT-ING-003, ENT-CORE-002, ENT-CORE-003
- 선행 WP: WP-003, WP-007
- 구현 범위:
  - `pipeline-worker` project 역할: `prs:enriched` 소비
  - PR·커밋 문서 생성 (필드 화이트리스트 적용 — 소스 코드 유입 차단)
  - 결정론적 문서 ID: `{repository_id}:{pr_number}`, `{repository_id}:{commit_sha}`
  - `document_version` 조건부 스크립트 업서트 (데이터 모델 5장)
  - 사전 계산 필드: `lead_time_seconds`, `first_review_wait_seconds`, `changed_files_count`, `additions`, `deletions`
  - `_routing = repository_id`
  - 벌크 요청 1건으로 다중 인덱스 갱신, 부분 실패 항목 개별 재시도
  - `last_delivery_id`, `indexed_at` 기록
  - `raw_event.processed_at` 갱신
  - `EVT-ING-003` 발행
  - 메트릭: `ingestion_lag_seconds`
- 제외:
  - 시퀀스 필드 (WP-021에서 채움)
  - 관계 필드 (WP-029에서 채움)
  - 릴리스 문서 (WP-024)
- 완료 기준(DoD):
  - [ ] 오래된 `document_version` 갱신이 새 상태를 덮어쓰지 않는다 (FR-ING-005 AC-1)
  - [ ] 같은 이벤트를 두 번 처리해도 문서가 하나다 (FR-ING-002 AC-5)
  - [ ] 여러 인덱스 갱신이 벌크 1건으로 전송된다 (AC-2)
  - [ ] 벌크 부분 실패 항목이 개별 재시도된다 (AC-3)
  - [ ] 수신부터 검색 반영까지 p95 10초 이하다 (AC-5) — 개발 데이터셋 기준
  - [ ] 매핑에 없는 필드를 넣으려 하면 색인이 거부되고 DLQ로 간다 (THR-010)
- 검증 방법: `pnpm test:integration -- worker/project`
- 기록: 원장 WP-008 상태, FR-ING-005 매핑

### WP-009 실패 대기열과 재처리

- 목표: 실패 이벤트가 격리되고 운영자가 재처리할 수 있다.
- 관련 요구사항: FR-ING-007
- 관련 API/데이터/잡: API-ADM-003, ENT-ING-002, JOB-ING-009, EVT-ING-004
- 선행 WP: WP-007, WP-008
- 구현 범위:
  - `dead_letter` 적재: 실패 사유, 마지막 오류, 재시도 횟수, 단계
  - `GET /admin/dead-letters` 목록 조회 (필터: 단계, 상태, 저장소)
  - `POST /admin/dead-letters/reprocess` 개별·일괄 재처리
  - 재처리는 `raw_event`에서 원본을 읽어 재투입, 멱등 규칙 적용
  - 3회 재처리 실패 시 `held` 전환, 자동 재처리 제외
  - 메트릭: `dead_letter_total{state}`, 100건 초과 시 경보 규칙
- 제외:
  - A-001 화면 (WP-010의 최소 콘솔)
- 완료 기준(DoD):
  - [ ] 재시도 5회 소진 이벤트가 사유와 함께 DLQ에 저장된다 (FR-ING-007 AC-2)
  - [ ] 개별·일괄 재처리가 동작한다 (AC-3)
  - [ ] 재처리가 중복 문서를 만들지 않는다 (AC-4)
  - [ ] 3회 재처리 실패 이벤트가 `held`로 전환된다 (예외 처리)
  - [ ] 100건 초과 시 경보 메트릭이 임계를 넘는다 (AC-5)
  - [ ] 일괄 재처리 100건 초과 시 재확인이 요구된다 (QA-A001-05)
- 검증 방법: `pnpm test:integration -- ops/dead-letter`
- 기록: 원장 WP-009 상태, FR-ING-007 매핑

### WP-010 저장소 등록 API와 파이프라인 지표

- 목표: 저장소를 등록·해제하고 파이프라인 상태를 조회할 수 있다.
- 관련 요구사항: FR-ING-009, FR-ADMIN-001
- 관련 화면/플로우: A-001 (최소), A-002 (API만)
- 관련 API/데이터/잡: API-ADM-001, API-ADM-006, ENT-CORE-001
- 선행 WP: WP-008
- 구현 범위:
  - `GET/POST/PATCH/DELETE /admin/repositories`
  - 등록 시 저장소 ID·대상 브랜치(최대 10)·미러 사용·백필 여부
  - 해제 시 `status = 'archived'`, ES 문서 `repository_archived: true` (삭제하지 않음)
  - 미등록 저장소 이벤트는 원본 보관만 하고 투영하지 않음
  - `GET /admin/pipeline-status`: 수신량, 큐 길이, 단계별 지연 p50/p95, DLQ 수, 보강 대기 수, 저장소별 지연 상위 10
  - k8s 매니페스트 (게이트웨이, 워커, PostgreSQL/ES/Redis 연결)
  - Prometheus 메트릭 엔드포인트
- 제외:
  - A-002 화면 (WP-040)
  - 시퀀스 공간 상태 (WP-021 이후)
- 완료 기준(DoD):
  - [ ] 대상 브랜치 11개 등록 시 400 `BRANCH_LIMIT_EXCEEDED`를 반환한다 (FR-ING-009 AC-2)
  - [ ] 해제 후에도 기존 문서가 조회된다 (AC-3)
  - [ ] 미등록 저장소 이벤트가 `raw_event`에는 있고 ES에는 없다 (AC-4)
  - [ ] 접근 권한 없는 저장소 등록이 403으로 거부된다 (예외 처리)
  - [ ] 파이프라인 상태 응답의 데이터 신선도가 30초 이내다 (FR-ADMIN-001 AC-2)
  - [ ] 등록·해제가 감사 기록에 남는다 (AC-5)
- 검증 방법: `pnpm test:integration -- admin/repositories`, `pnpm test:e2e -- ops-minimal`
- 기록: 원장 WP-010 상태, FR-ING-009·FR-ADMIN-001 매핑

---

## REL-002 양방향 식별자 해석과 권한

### WP-011 구조화 질의 파서

- 목표: `key:value` 질의가 필터 AST로 변환되고, 오류 위치를 정확히 보고한다.
- 관련 요구사항: FR-SRCH-005
- 관련 API/데이터/잡: API-SRCH-004
- 선행 WP: WP-001
- 구현 범위:
  - `@prs/query`: 토크나이저 + 파서 + AST + 직렬화(AST → 질의 문자열)
  - 지원 키 15종 (FR-SRCH-005 AC-1)
  - 범위 문법 `a..b` (숫자, 날짜, 날짜시각)
  - 부정 접두 `-`
  - 같은 키 반복은 OR, 다른 키는 AND
  - 미지원 키는 문자 오프셋과 지원 키 목록을 담은 오류
  - 인용 문자열(`label:"needs review"`) 처리
  - 남은 문자열은 전문 검색어
- 제외:
  - ES 질의 변환 (WP-013)
  - 클라이언트 UI (WP-016)
- 완료 기준(DoD):
  - [ ] 지원 키 15종이 모두 파싱된다 (AC-1)
  - [ ] `seq:1200..1350`이 범위 필터가 된다 (AC-2)
  - [ ] `merged:2026-08-10..2026-08-19`가 시각 범위 필터가 된다 (AC-3)
  - [ ] 미지원 키가 오프셋과 지원 키 목록을 포함한 오류를 낸다 (AC-4)
  - [ ] 같은 키 반복이 OR, 다른 키가 AND로 결합된다 (AC-5)
  - [ ] `-author:kim`이 부정 조건이 된다 (AC-6)
  - [ ] 파싱 → 직렬화 → 재파싱 왕복이 동일 AST를 만든다 (프런트엔드 URL 동기화 전제)
- 검증 방법: `pnpm test -- query`
- 기록: 원장 WP-011 상태, FR-SRCH-005 매핑

### WP-012 인증과 접근 범위 강제

- 목표: 인증된 사용자만, 권한 있는 저장소 데이터만 조회한다. 우회 경로가 없다.
- 관련 요구사항: FR-AUTH-001, FR-AUTH-002, FR-AUTH-003, NFR-005
- 관련 화면/플로우: FLOW-000
- 관련 API/데이터/잡: API-AUTH-001, JOB-AUTH-001, EVT-AUTH-001, ENT-CORE-004, ENT-CORE-005
- 선행 WP: WP-002
- 구현 범위:
  - OIDC Authorization Code + PKCE, 토큰 서명·`iss`·`aud`·`exp`·`nonce` 검증
  - 서버 측 세션 (Redis), HttpOnly·Secure·SameSite=Lax 쿠키, 유휴 8시간·절대 12시간
  - 로그아웃 시 서버 세션 무효화
  - `resolveAccessScope`: Redis → PostgreSQL → GHE 순, 만료 캐시 미사용
  - 500개 초과 시 `org_team` 모드 전환
  - `applyMandatoryScopeFilter` + `ScopedQuery` 브랜드 타입 실제 구현
  - `member`/`team`/`repository` 웹훅 수신 시 캐시 무효화 (`EVT-AUTH-001`)
  - 대량 무효화 시 요청 병합 + 동시 요청 상한 20
  - `GET /me`: 사용자, 역할, 접근 범위 요약
  - 아키텍처 테스트: `applyMandatoryScopeFilter`를 거치지 않는 ES 호출 부재
- 제외:
  - 화면 (WP-015)
  - 감사 기록 (WP-039)
- 완료 기준(DoD):
  - [ ] 미인증 요청이 OIDC로 리다이렉트된다 (FR-AUTH-001 AC-1)
  - [ ] 세션 쿠키가 HttpOnly·Secure·SameSite=Lax다 (AC-2)
  - [ ] 유휴 8시간·절대 12시간 만료가 동작한다 (AC-3)
  - [ ] 접근 범위 밖 문서가 목록·건수·집계 어디에도 나타나지 않는다 (FR-AUTH-002 AC-5)
  - [ ] 접근 범위 밖 문서 직접 조회가 404다 (AC-4)
  - [ ] 접근 범위 조회 실패 시 부분 결과 없이 503이다 (AC-3)
  - [ ] 500개 초과 시 `org_team` 모드로 전환되고, 두 모드의 결과 집합이 동일하다 (AC-6)
  - [ ] 권한 회수 이벤트 후 첫 요청부터 차단된다 (FR-AUTH-003 AC-4)
  - [ ] `applyMandatoryScopeFilter`를 우회하는 코드가 컴파일되지 않는다 (ADR-008)
  - [ ] 권한 매트릭스 테스트(역할 6종 × 화면 13종)의 API 계층 부분이 통과한다 (NFR-005)
- 검증 방법: `pnpm test:integration -- authz`, `pnpm test -- authz/architecture`
- 기록: 원장 WP-012 상태, FR-AUTH-001~003 매핑

### WP-013 검색 API 목록 조회

- 목표: 구조화 질의로 필터·정렬된 목록을 반환한다.
- 관련 요구사항: FR-SRCH-006, FR-SRCH-007, NFR-001
- 관련 화면/플로우: W-001
- 관련 API/데이터/잡: API-SRCH-004
- 선행 WP: WP-011, WP-012
- 구현 범위:
  - `search-api` Fastify 앱, `GET /search`
  - AST → ES 질의 변환 (`@prs/es` 질의 빌더)
  - 정렬 8종, 기본 `merge_seq` desc + 시퀀스 없는 문서 `merged_at` desc 후순위
  - 모든 정렬에 문서 ID를 마지막 정렬 키로 추가
  - `size` 기본 25·최대 200 절삭
  - `track_total_hits: 10000`
  - 결과 0건 시 `relaxation_hints` 산출
  - `applyMandatoryScopeFilter` 결합
  - 공통 오류 DTO + 상관 ID
- 제외:
  - 패싯·커서·전문 검색 (WP-032)
  - 상세 조회 (WP-014, WP-017, WP-018)
- 완료 기준(DoD):
  - [ ] 필터 12종이 AND로 결합된다 (FR-SRCH-006 AC-1)
  - [ ] 같은 필드 다중 값이 OR로 결합된다 (AC-2)
  - [ ] 0건일 때 완화 후보가 반환된다 (AC-3)
  - [ ] 정렬 키 8종이 동작하고 미지원 키는 400이다 (FR-SRCH-007 AC-1, AC-3)
  - [ ] 동일 조건 두 번 조회 시 순서가 동일하다 (AC-4)
  - [ ] 목록 조회 p95가 500ms 이하다 (NFR-001) — 1000만 문서 합성 데이터셋
  - [ ] API 계약의 `/search` 응답 예시와 실제 응답 스키마가 일치한다
- 검증 방법: `pnpm test:integration -- search`, `pnpm test:perf -- search`
- 기록: 원장 WP-013 상태, FR-SRCH-006·FR-SRCH-007 매핑

### WP-014 식별자 해석 API

- 목표: 문자열 하나로 커밋·PR·릴리스를 찾는다. 이 제품의 1순위 기능이다.
- 관련 요구사항: FR-SRCH-001, FR-SRCH-002, FR-SRCH-003, FR-SRCH-004
- 관련 화면/플로우: W-001, W-002, W-003 / FLOW-001, FLOW-002
- 관련 API/데이터/잡: API-SRCH-001, API-SRCH-002, API-SRCH-003
- 선행 WP: WP-013
- 구현 범위:
  - `GET /resolve`: 백엔드 아키텍처 4.5장의 8단계 해석 순서
  - 40자 hex → `term`, 7~39자 → `prefix`, 7자 미만 → 400
  - 40자 hex가 커밋에 없으면 `merge_commit_sha`/`head_sha`/`base_sha`도 확인
  - `#N`, `owner/repo#N`, GHE URL 파싱
  - 접두 결과 50건 초과 시 절삭, 3초 타임아웃
  - `GET /commits/{repository}/{commit_sha}`: 역할 판정(`merge_commit`/`source_commit`/`direct_push`), 소속 PR 배열
  - `GET /pull-requests/{repository}/{pr_number}`: 머지 커밋 + 원본 커밋 구분, 250건 절삭
  - 접근 범위 밖 후보 제외
- 제외:
  - 시퀀스 값 (WP-021 이후 채워짐)
  - 관계·릴리스 (WP-024, WP-031)
- 완료 기준(DoD):
  - [ ] QA-W001-01 ~ QA-W001-06이 API 계층에서 통과한다
  - [ ] QA-W003-01 ~ QA-W003-05가 통과한다
  - [ ] QA-W002-01 ~ QA-W002-03이 통과한다
  - [ ] 단건 해석 p95가 200ms 이하다 (NFR-001) — 커밋 1000만 건 데이터셋
  - [ ] 7자 접두 질의가 통상 후보 1건으로 좁혀진다 (ADR-012 근거 검증)
  - [ ] API 계약의 응답 예시 3종과 실제 응답이 일치한다
- 검증 방법: `pnpm test:integration -- resolve`, `pnpm test:perf -- resolve`
- 기록: 원장 WP-014 상태, FR-SRCH-001~004 매핑

### WP-015 웹 앱 셸과 Conductor 통합

- 목표: Conductor 기반 셸이 서고, 인증·라우팅·프록시가 동작한다.
- 관련 요구사항: FR-AUTH-001, NFR-007
- 관련 화면/플로우: 전 화면 / FLOW-000
- 관련 API/데이터/잡: API-AUTH-001
- 선행 WP: WP-001
- 구현 범위:
  - Next.js App Router, `@conductor-by-89soone/css` 1회 import
  - `AppShell` + `C-001 AppTopBar` + `C-002 LeftNavPanel`, 스킵 링크
  - 라우트 핸들러 프록시 (`/api/[...path]`), 세션 검증, 상관 ID 전파, 클라이언트 헤더 미전달
  - OIDC 콜백 라우트, 경로 보존 리다이렉트
  - 역할 기반 내비게이션 필터링 (운영 그룹은 렌더링하지 않음)
  - `C-004 EmptyState`, `C-005 ErrorBanner` 구현
  - `lib/query-url.ts`: 질의 문자열 ↔ URL 동기화 (`@prs/query` 사용)
  - `lib/format.ts`: SHA 축약(12자), 시퀀스 표기(구분 기호 없음), 기간 포맷
  - 라우트 전환 시 `main` 포커스 이동 + `aria-live` 제목 알림
  - 라이트·다크 테마 확인
- 제외:
  - 개별 화면 (WP-016 이후)
- 완료 기준(DoD):
  - [ ] QA-COMMON-01, QA-COMMON-06, QA-COMMON-07, QA-COMMON-09, QA-COMMON-11, QA-COMMON-12, QA-COMMON-14, QA-COMMON-16, QA-COMMON-17, QA-COMMON-18이 통과한다
  - [ ] `operator`가 아닌 역할에게 운영 내비게이션이 렌더링되지 않는다 (QA-A001-10)
  - [ ] `⌘K`/`Ctrl+K`로 옴니 검색에 포커스한다
  - [ ] 세션 만료 후 재인증 시 원래 경로로 복귀한다 (FLOW-000)
  - [ ] `query-url` 왕복 테스트가 통과한다
  - [ ] axe 위반 0건, `checkContrast` 위반 0건
- 검증 방법: `pnpm test -- web/lib`, `pnpm test:a11y -- shell`, `pnpm test:e2e -- auth`
- 기록: 원장 WP-015 상태, FR-AUTH-001 매핑

### WP-016 W-001 통합 검색 화면

- 목표: 사용자가 문자열 하나를 붙여넣어 대상을 찾고 목록을 필터·정렬한다.
- 관련 요구사항: FR-SRCH-001, FR-SRCH-004, FR-SRCH-005, FR-SRCH-006, FR-SRCH-007
- 관련 화면/플로우: W-001 / FLOW-001
- 관련 API/데이터/잡: API-SRCH-001, API-SRCH-004
- 선행 WP: WP-013, WP-014, WP-015
- 구현 범위:
  - `C-010 OmniSearchInput` (7자 미만 hex 클라이언트 즉시 거부)
  - `C-011 QueryTokenBar` (오류 구간 강조)
  - `C-012 FacetRail` 골격 (선택 UI만, 패싯 데이터는 WP-032)
  - `C-013 ResultTable` (정렬 헤더, `aria-sort`, 링크 시맨틱 행)
  - `C-014 SequenceBadge` (시퀀스 없으면 미부여 상태)
  - `C-017 ResolutionCandidateList`
  - 상태 매트릭스 W-001의 전 상태 렌더링
  - URL이 단일 진실: 필터·정렬은 `router.replace`, 화면 이동은 `push`
- 제외:
  - 패싯 데이터, 커서 페이징, 전문 검색 강조 (WP-032)
  - 집계 탭 (WP-038)
  - 저장·내보내기 (WP-033, WP-044)
- 완료 기준(DoD):
  - [ ] QA-W001-01 ~ QA-W001-14, QA-W001-22, QA-W001-23이 통과한다
  - [ ] 상태 매트릭스 W-001의 모든 상태에 대응하는 컴포넌트 테스트가 있다
  - [ ] 필터를 5회 조작한 뒤 뒤로가기 1회로 이전 화면에 돌아간다
  - [ ] URL을 복사해 새 탭에 붙여넣으면 동일 화면이 재현된다 (QA-COMMON-09)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test -- web/search`, `pnpm test:e2e -- flow-001`, `pnpm test:a11y -- search`
- 기록: 원장 WP-016 상태

### WP-017 W-002 PR 상세 화면

- 목표: PR 하나의 맥락을 한 화면에서 확인하고 다음 조사 단계로 이동한다.
- 관련 요구사항: FR-SRCH-003
- 관련 화면/플로우: W-002 / FLOW-002
- 관련 API/데이터/잡: API-SRCH-003
- 선행 WP: WP-015, WP-016
- 구현 범위:
  - `C-023 EntityHeader`, `C-018 CommitList`, `C-022 PrTimeline`
  - 개요 섹션(브랜치, 라벨, 리뷰어, 변경 규모, 리드타임, 리뷰 대기)
  - `W-002-NEIGHBORS` 섹션 골격 (비활성 + "머지 후 시퀀스 부여" 사유 — 데이터는 WP-027)
  - `W-002-RELEASES` 섹션 골격 (데이터는 WP-024)
  - `W-002-LINKS` 섹션 골격 (데이터는 WP-031)
  - `enrichment_pending` 배지 + 수동 재조회 (자동 폴링 금지)
  - 딥링크 `/pr/[owner]/[repo]/[number]`
- 제외:
  - 선행·후행 데이터 (WP-027), 관계 (WP-031), 릴리스 (WP-024), 동시 변경 (WP-031)
- 완료 기준(DoD):
  - [ ] QA-W002-01 ~ QA-W002-03, QA-W002-15, QA-W002-17, QA-W002-18이 통과한다
  - [ ] 상태 매트릭스 W-002의 `loading_initial`, `ready`, `enrichment_pending`, `truncated`, `not_found` 상태가 렌더링된다
  - [ ] 미머지 PR에서 선행·후행 섹션이 숨겨지지 않고 비활성 + 사유로 표시된다 (QA-W002-07)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test -- web/pr`, `pnpm test:e2e -- flow-002`, `pnpm test:a11y -- pr`
- 기록: 원장 WP-017 상태

### WP-018 W-003 커밋 상세 화면

- 목표: 커밋 SHA에서 소속 PR로 이어지는 역추적 경로를 완성한다.
- 관련 요구사항: FR-SRCH-002
- 관련 화면/플로우: W-003 / FLOW-002
- 관련 API/데이터/잡: API-SRCH-002
- 선행 WP: WP-015, WP-016
- 구현 범위:
  - `C-024 ShaChip` (12자 표시, 전체 40자 복사, `aria-live` 복사 알림)
  - `C-025 ChangedPathList`
  - 소속 PR 섹션, 역할 배지(`merge_commit`/`source_commit`/`direct_push`)
  - `no_sequence`(원본 커밋) 상태를 오류가 아닌 설명 + 머지 커밋 링크로 표시
  - `multi_pr` 상태 목록 표시
  - `W-003-SEQPOS` 섹션 골격 (데이터는 WP-027)
  - 딥링크 `/commit/[owner]/[repo]/[sha]`
- 제외:
  - 시퀀스 위치 데이터 (WP-027), 릴리스 (WP-024), 관계 (WP-031)
- 완료 기준(DoD):
  - [ ] QA-W003-01 ~ QA-W003-08이 통과한다
  - [ ] 상태 매트릭스 W-003의 전 상태가 렌더링된다
  - [ ] FLOW-002 전 경로(SHA 입력 → 커밋 상세 → PR 상세)가 E2E로 통과한다
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test -- web/commit`, `pnpm test:e2e -- flow-002`, `pnpm test:a11y -- commit`
- 기록: 원장 WP-018 상태, FR-SRCH-002 매핑

### WP-019 저장소 백필 잡

- 목표: 과거 PR·커밋을 채워 검색 대상을 완성한다.
- 관련 요구사항: FR-ING-006
- 관련 화면/플로우: A-003 (API만)
- 관련 API/데이터/잡: API-ADM-002, JOB-ING-004, EVT-JOB-001
- 선행 WP: WP-006, WP-008
- 구현 범위:
  - `pipeline-worker` batch 역할, `prs:batch` 스트림 (실시간과 분리)
  - 저장소 단위 백필: PR 목록 페이지네이션 → 보강 → 투영
  - `job.cursor`에 진행 지점 저장, 중단 후 재개
  - 진행률 30초 이내 갱신 (`done`/`total`/`unit`)
  - 동시 실행 상한 기본 3 (설정값)
  - 실시간보다 낮은 우선순위 (GHE 토큰 배분, 워커 풀 분리)
  - 백필 문서도 `document_version` 규칙 준수
  - 개별 PR 실패는 목록으로 보고하고 잡을 중단하지 않음
  - `POST/PATCH /admin/jobs` (실행·중단)
  - 백필 중 해당 인덱스 `refresh_interval` 일시 상향 후 복원
- 제외:
  - A-003 화면 (WP-040)
  - 시퀀스 채번 (WP-021)
- 완료 기준(DoD):
  - [ ] QA-A003-05, QA-A003-06이 통과한다
  - [ ] 백필 실행 중 실시간 수집 지연 p95가 10초를 유지한다 (FR-ING-006 AC-3)
  - [ ] 중단 후 재개 시 마지막 커서부터 이어진다 (AC-4)
  - [ ] 백필 문서가 더 새로운 실시간 문서를 덮어쓰지 않는다 (AC-5)
  - [ ] 동시 실행 4개 요청 시 3개만 실행된다 (AC-6)
  - [ ] API 한도 소진 시 잡이 대기하고 회복 시각에 자동 재개된다 (예외 처리)
- 검증 방법: `pnpm test:integration -- jobs/backfill`
- 기록: 원장 WP-019 상태, FR-ING-006 매핑

---

## REL-003 머지 시퀀스와 범위 조사

### WP-020 커밋 그래프 접근 계층

- 목표: first-parent 체인과 patch-id를 미러 또는 API로 얻는다.
- 관련 요구사항: FR-SEQ-001, FR-REL-005
- 관련 API/데이터/잡: JOB-MIR-001
- 선행 WP: WP-006
- 구현 범위:
  - `@prs/github`에 `CommitGraph` 인터페이스: `resolveHead`, `isAncestor`, `mergeBase`, `firstParentRevList`, `patchId`
  - `MirrorCommitGraph`: `git clone --mirror --filter=blob:none`, `git fetch --prune`, `rev-list --first-parent --reverse`, `merge-base --is-ancestor`, `patch-id`
  - `ApiCommitGraph` 폴백: `parents[0]` 체인 재구성, `patchId`는 미지원(`patch_id_unavailable`)
  - 저장소별 미러 사용 여부 설정 반영
  - `JOB-MIR-001` 미러 동기화 (push 이벤트 + 6시간 보정)
  - 미러 볼륨 관리, `mirror_disk_usage_ratio` 메트릭
  - 미러는 읽기 전용 — push 경로 없음
- 제외:
  - 시퀀스 채번 로직 (WP-021)
- 완료 기준(DoD):
  - [ ] `MirrorCommitGraph.firstParentRevList`가 `git rev-list --first-parent --reverse`와 동일한 결과를 낸다
  - [ ] `ApiCommitGraph`가 같은 픽스처에서 `MirrorCommitGraph`와 동일한 체인을 만든다 (ADR-005)
  - [ ] blobless 클론에 파일 blob이 없다 (THR-015)
  - [ ] 미러 미사용 저장소에서 `patchId`가 null이고 `patch_id_unavailable`이 표시된다 (FR-REL-005 AC-5)
  - [ ] 미러 fetch 실패 시 API 폴백으로 전환된다
- 검증 방법: `pnpm test:integration -- graph` (로컬 git 픽스처 저장소 사용)
- 기록: 원장 WP-020 상태

### WP-021 시퀀스 증분 채번

- 목표: 대상 브랜치의 커밋에 CL과 동등한 단조 증가 서수가 부여된다. **이 제품의 핵심 WP다.**
- 관련 요구사항: FR-SEQ-001
- 관련 화면/플로우: 없음 (간접 노출: W-002, W-003, W-004, W-009)
- 관련 API/데이터/잡: JOB-SEQ-001, EVT-SEQ-001, ENT-SEQ-001, ENT-SEQ-002
- 선행 WP: WP-002, WP-020
- 구현 범위:
  - `pipeline-worker` sequence 역할, `prs:sequence` 스트림 (파티션 키 `repository_id:base_branch`)
  - 백엔드 아키텍처 4.3장의 `assignSequence` 구현
  - advisory lock 트랜잭션 스코프, 획득 실패 시 대기 없이 재큐
  - 증분 채번: `<저장 head>..<새 head>` 구간만 처리
  - 직접 푸시 커밋도 채번, `pull_request_number`는 null
  - 채번 결과를 `merge_sequence`에 멱등 upsert
  - ES 문서의 `merge_seq`/`seq_epoch`/`sequence_space` 벌크 갱신
  - `EVT-SEQ-001` 발행
  - 채번 실패 시 공간 `stale`, 기존 값 보존, 재시도 예약
  - 메트릭: `sequence_space_state{state}`
- 제외:
  - 재채번 (WP-022)
  - 범위 조회 API (WP-023)
- 완료 기준(DoD):
  - [ ] 채번 결과가 `git rev-list --first-parent --reverse`의 순서와 정확히 일치한다 (FR-SEQ-001 AC-2)
  - [ ] 시퀀스 공간별로 독립이며 루트가 1이다 (AC-1)
  - [ ] 직접 푸시 커밋이 시퀀스를 받고 PR 연결이 null이다 (AC-3)
  - [ ] 같은 채번을 두 번 실행해도 값이 변하지 않는다 (AC-4)
  - [ ] 증분 채번이 저장된 head 이후만 처리한다 (AC-5)
  - [ ] 동일 시퀀스 공간에 대한 채번이 동시에 1개만 실행된다 (AC-6)
  - [ ] 그래프 접근 실패 시 공간이 `stale`이 되고 기존 시퀀스가 보존된다 (예외 처리)
  - [ ] **회귀 픽스처 검증**: 병합 커밋·직접 푸시가 섞인 히스토리에서 채번이 git 결과와 일치한다 (QA 6장)
- 검증 방법: `pnpm test:integration -- sequence/assign`, `pnpm test:regression -- sequence`
- 기록: 원장 WP-021 상태, FR-SEQ-001 매핑

### WP-022 시퀀스 재채번과 에폭

- 목표: 히스토리 재작성을 감지해 에폭을 올리고 안전하게 재채번한다.
- 관련 요구사항: FR-SEQ-005
- 관련 화면/플로우: A-003 (간접 노출: W-004 에폭 경고)
- 관련 API/데이터/잡: JOB-SEQ-002, EVT-SEQ-002
- 선행 WP: WP-021
- 구현 범위:
  - 채번 전 `isAncestor` 검사
  - 조상이 아니면 `mergeBase` 계산 → 이후 무효 표시 → `seq_epoch += 1` → 재채번
  - merge-base까지의 시퀀스를 새 에폭으로 복사
  - 안전 구간 표식·이분 탐색 세션 무효화
  - `EVT-SEQ-002` 발행, 알림, 감사 기록
  - 재채번 중 조회는 마지막 확정 값 + `sequence_state: reassigning`
  - 재채번 실패 시 `stale`, 부분 상태로 남기지 않음
  - 메트릭: `sequence_reassign_total`
- 제외:
  - 정합성 점검 (WP-028)
  - 2단계 확인 UI (WP-040)
- 완료 기준(DoD):
  - [ ] 강제 푸시 픽스처에서 조상 관계 위반이 감지된다 (FR-SEQ-005 AC-1, AC-2)
  - [ ] 재채번 시 에폭이 1 증가한다 (AC-3)
  - [ ] 이전 에폭 표식이 무효 표시되고 조회 시 `epoch_stale`이 반환된다 (AC-4)
  - [ ] 재채번이 감사 기록과 알림을 남긴다 (AC-5)
  - [ ] 재채번 중 조회가 마지막 확정 값과 상태를 함께 반환한다 (예외 처리)
  - [ ] 재채번 실패 시 부분 채번 상태로 남지 않는다 (트랜잭션 경계)
  - [ ] merge-base 이전 시퀀스 값이 새 에폭에서도 동일하다
- 검증 방법: `pnpm test:integration -- sequence/reassign`, `pnpm test:regression -- sequence-rewrite`
- 기록: 원장 WP-022 상태, FR-SEQ-005 매핑

### WP-023 앵커 정규화와 범위 조회 API

- 목표: 어떤 형태의 앵커든 시퀀스 값으로 바꾸고 `(from, to]` 구간을 조회한다.
- 관련 요구사항: FR-SEQ-002, FR-SEQ-003
- 관련 화면/플로우: W-004 / FLOW-003
- 관련 API/데이터/잡: API-SEQ-001, API-SEQ-002
- 선행 WP: WP-021, WP-013
- 구현 범위:
  - `POST /sequence-anchors/resolve`: 릴리스 태그·SHA·PR 번호·시각·시퀀스 값 5종 정규화
  - `GET /sequence-ranges`: 반개구간 조회, 시퀀스 오름차순
  - 요약: PR 수, 커밋 수, 작성자 수, 변경 경로 상위 20, 되돌림 보유 수
  - 구간 5만 건 초과 시 사전 추정 후 400
  - 시퀀스 공간 불일치·역전·브랜치 밖 앵커·미머지 앵커 오류
  - `sequence_state` 함께 반환
  - `q` 파라미터로 구간 내 추가 필터
  - `index.sort` 조기 종료 활용
- 제외:
  - 화면 (WP-025)
  - 릴리스 비교 (WP-026)
- 완료 기준(DoD):
  - [ ] QA-W004-01 ~ QA-W004-11이 API 계층에서 통과한다
  - [ ] 시작 앵커 PR이 결과에서 제외되고 끝 앵커 PR이 포함된다 (FR-SEQ-002 AC-1)
  - [ ] 브랜치 밖 앵커에 머지 커밋 대체 제안이 포함된다 (FR-SEQ-003 AC-2)
  - [ ] 범위 조회 p95가 400ms 이하다 (구간 5000건, NFR-001)
  - [ ] **`git log --first-parent <tagA>..<tagB>` 결과와 건수·구성이 일치한다** (QA 6장)
  - [ ] API 계약의 응답 예시와 실제 응답이 일치한다
- 검증 방법: `pnpm test:integration -- sequence/range`, `pnpm test:regression -- range-vs-git`
- 기록: 원장 WP-023 상태, FR-SEQ-002·FR-SEQ-003 매핑

### WP-024 릴리스 수집과 포함 관계

- 목표: 릴리스가 앵커로 수집되고 "이 PR이 어느 배포에 들어갔는가"에 답한다.
- 관련 요구사항: FR-SEQ-004, FR-REL-002
- 관련 화면/플로우: W-002, W-003, W-005
- 관련 API/데이터/잡: API-REL-002, ENT-REL-001
- 선행 WP: WP-021, WP-008
- 구현 범위:
  - `release`/`create`(tag) 웹훅 처리 → `prs-releases` 문서
  - 백필 시 태그·릴리스 목록 수집
  - 릴리스 커밋의 시퀀스 값 부여
  - `GET /containments`: 시퀀스 정수 비교로 포함 판정 (간선 생성 없음)
  - `release_tags` 비정규화 (상위 5개), `unreleased` 플래그
  - 미배포 시 대기 PR 수 계산
  - `C-020 ReleaseContainmentList` 구현, W-002·W-003 섹션 연결
- 제외:
  - CI 배포 이벤트 소스 (조건부, OD-004)
  - 릴리스 화면 (WP-026)
- 완료 기준(DoD):
  - [ ] QA-W002-08, QA-W002-09가 통과한다
  - [ ] 포함 판정이 시퀀스 비교로 이루어진다 (FR-REL-002 AC-5)
  - [ ] 릴리스 목록이 시각 오름차순이다 (AC-3)
  - [ ] 미배포 시 `unreleased: true`와 대기 PR 수가 반환된다 (AC-4)
  - [ ] 릴리스 미수집 저장소에서 `RELEASE_NOT_INDEXED`가 반환된다 (예외 처리)
- 검증 방법: `pnpm test:integration -- release/containment`
- 기록: 원장 WP-024 상태, FR-REL-002 매핑

### WP-025 W-004 범위 조사 화면

- 목표: 릴리스 매니저가 두 지점 사이 반영분을 60초 안에 확정한다.
- 관련 요구사항: FR-SEQ-002, FR-SEQ-003
- 관련 화면/플로우: W-004 / FLOW-003
- 관련 API/데이터/잡: API-SEQ-001, API-SEQ-002
- 선행 WP: WP-023, WP-015
- 구현 범위:
  - `C-027 SequenceSpaceSelector` (에폭·상태 표시)
  - `C-026 AnchorInput` (정규화 결과, "제외"/"포함" 라벨 상시 표시)
  - `C-028 RangeSummaryCard`
  - `C-013 ResultTable` 재사용
  - `C-012 FacetRail` (구간 내 패싯 — 데이터는 WP-032)
  - 시퀀스 공간 불일치 시 클라이언트에서 조회 버튼 비활성 + 즉시 사유
  - 구간 5만 건 초과 예상 시 조회 전 안내
  - `sequence_reassigning`/`sequence_stale`/`epoch_stale` 배너
  - 딥링크 `/range?repo=&branch=&from=&to=&epoch=`
- 제외:
  - 안전 구간 표식 (WP-041), 이분 탐색 (WP-042)
- 완료 기준(DoD):
  - [ ] QA-W004-01 ~ QA-W004-11, QA-W004-21, QA-W004-22가 통과한다
  - [ ] 반개구간 규칙이 화면에 상시 표시된다 (QA-W004-01)
  - [ ] 상태 매트릭스 W-004의 전 상태가 렌더링된다
  - [ ] URL 에폭 불일치 시 자동 재조회하지 않는다 (QA-W004-21)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test -- web/range`, `pnpm test:e2e -- flow-003`, `pnpm test:a11y -- range`
- 기록: 원장 WP-025 상태

### WP-026 W-005 릴리스 화면과 구간 비교

- 목표: 릴리스 2건을 골라 그 사이 반영분을 본다.
- 관련 요구사항: FR-SEQ-004
- 관련 화면/플로우: W-005 / FLOW-003
- 관련 API/데이터/잡: API-SEQ-003
- 선행 WP: WP-024, WP-025
- 구현 범위:
  - `GET /release-comparisons` API
  - `C-032 ReleaseTimeline` (체크박스 2건 선택 상한)
  - 릴리스 상세 요약, 미배포 구간 진입
  - 시퀀스 작은 쪽을 시작 앵커로 정규화하고 방향 명시
  - 다른 브랜치 릴리스 선택 시 비교 차단
  - `to=unreleased` 지원
  - "직전 릴리스 대비 PR 수"는 실제 PR 문서 수
  - 딥링크 `/releases/[owner]/[repo]?branch=&select=`
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W005-01 ~ QA-W005-06이 통과한다
  - [ ] 지정 순서와 무관하게 정규화되고 방향이 응답에 명시된다 (FR-SEQ-004 AC-4)
  - [ ] 미배포 구간 조회가 동작한다 (AC-5)
  - [ ] 상태 매트릭스 W-005의 전 상태가 렌더링된다
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test:integration -- release/comparison`, `pnpm test:e2e -- flow-003`
- 기록: 원장 WP-026 상태, FR-SEQ-004 매핑

### WP-027 선행·후행 조회와 상세 화면 통합

- 목표: 문제 PR 주변에 무엇이 들어갔는지 즉시 본다.
- 관련 요구사항: FR-REL-001
- 관련 화면/플로우: W-002, W-003
- 관련 API/데이터/잡: API-REL-001
- 선행 WP: WP-023, WP-017, WP-018
- 구현 범위:
  - `GET /sequence-neighbors` (기본 10, 최대 50, 기준 개체 `is_anchor: true` 포함)
  - 공간 경계에서 존재하는 만큼만 반환
  - 미머지 PR은 409 `NO_SEQUENCE`
  - `C-019 NeighborSequenceList` 구현, W-002 섹션 연결
  - W-003 시퀀스 위치 섹션 연결
  - "범위로 확장" → W-004 이동 (앵커 전달)
  - `C-014 SequenceBadge`에 실제 시퀀스 값 표시
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W002-04 ~ QA-W002-07이 통과한다
  - [ ] 개수 조절이 최대 50까지 동작한다 (FR-REL-001 AC-1)
  - [ ] 기준 PR이 포함되고 강조된다 (AC-3)
  - [ ] 공간 경계에서 오류 없이 존재분만 반환된다 (AC-4)
  - [ ] 미머지 PR에서 409가 반환되고 섹션이 비활성 + 사유로 표시된다 (예외 처리)
  - [ ] 접근 범위 밖 PR이 이웃 목록에 나타나지 않는다 (AC-5)
- 검증 방법: `pnpm test:integration -- relation/neighbors`, `pnpm test:e2e -- flow-002`
- 기록: 원장 WP-027 상태, FR-REL-001 매핑

### WP-028 정합성 점검과 조정 스캔

- 목표: 시퀀스 불일치와 수집 누락을 자동으로 찾아낸다.
- 관련 요구사항: FR-ADMIN-003, FR-ING-011
- 관련 화면/플로우: A-003 (API만), W-009 (간접)
- 관련 API/데이터/잡: API-ADM-007, JOB-SEQ-003, JOB-ING-005, JOB-ING-008
- 선행 WP: WP-021, WP-019
- 구현 범위:
  - `GET /admin/sequence-integrity`: 표본(최근 1000)·전량 모드, 최초 불일치 보고, 영향 범위 산출
  - `POST /admin/sequence-integrity`: 재채번 실행 (`confirmation` 검증)
  - `JOB-ING-005` 조정 스캔: 최근 24시간 갱신 PR + 브랜치 head 대조, 누락분 재투입, head 시퀀스 없으면 채번 예약
  - `JOB-ING-008` PostgreSQL↔ES 정합성 감시 (문서 수 + 표본 내용)
  - 메트릭: `sequence_integrity_mismatch_total`, `reconcile_missing_total`
  - API 한도 소진 시 스캔 분할, 3주기 미완주 시 경보
- 제외:
  - A-003 화면 (WP-040)
- 완료 기준(DoD):
  - [ ] QA-A003-09가 통과한다
  - [ ] 표본 모드가 최근 1000개를 대조한다 (FR-ADMIN-003 AC-2)
  - [ ] 불일치 시 최초 지점의 저장 SHA와 실제 SHA가 보고된다 (AC-3)
  - [ ] `confirmation` 불일치 시 400이다 (FLOW-008)
  - [ ] 조정 스캔이 색인에 없는 PR을 발견해 재투입한다 (FR-ING-011 AC-3)
  - [ ] 누락 건수가 메트릭으로 노출된다 (AC-4)
  - [ ] 점검이 감사 기록에 남는다 (FR-ADMIN-003 AC-5)
- 검증 방법: `pnpm test:integration -- ops/integrity`, `pnpm test:integration -- jobs/reconcile`
- 기록: 원장 WP-028 상태, FR-ADMIN-003·FR-ING-011 매핑

---

## REL-004 관계 파생과 전문 검색

### WP-029 관계 간선 인덱스와 참조 추출

- 목표: 텍스트에 적힌 참조가 탐색 가능한 간선이 된다.
- 관련 요구사항: FR-REL-003
- 관련 API/데이터/잡: JOB-REL-001, JOB-REL-005, ENT-REL-002
- 선행 WP: WP-008, WP-003
- 구현 범위:
  - `pipeline-worker` link 역할, `prs:projected` 소비
  - 참조 패턴 추출: `#N`, `owner/repo#N`, GHE URL, `Refs:`/`Closes:`/`Fixes:`/`Resolves:`, 40자·7~12자 hex
  - 코드 블록·인용 구간 제거
  - 신뢰도: 트레일러 `derived`, 본문 언급 `heuristic`
  - 결정론적 `link_id` 해시 (재파생이 중복을 만들지 않음)
  - 미해결 참조 `resolved: false` + `JOB-REL-005`로 사후 해결
  - 문서당 간선 상한 100건
  - `link_summary` 비정규화 갱신 (같은 벌크)
  - 추출 실패 시 색인을 막지 않고 `links_pending: true`
- 제외:
  - 되돌림·체리픽·스택 (WP-030)
  - 관계 조회 API (WP-031)
- 완료 기준(DoD):
  - [ ] 패턴 6종이 모두 추출된다 (FR-REL-003 AC-1)
  - [ ] 신뢰도가 트레일러·본문에 따라 구분된다 (AC-2)
  - [ ] 미해결 참조가 대상 색인 시 해결 상태로 갱신된다 (AC-3)
  - [ ] 코드 블록·인용 안의 표현이 추출되지 않는다 (AC-4)
  - [ ] 문서당 100건 상한이 적용된다 (AC-5)
  - [ ] 추출 실패가 색인을 막지 않는다 (예외 처리)
  - [ ] 같은 문서를 두 번 처리해도 간선이 중복되지 않는다 (ADR-009)
- 검증 방법: `pnpm test -- link/reference`, `pnpm test:integration -- worker/link`
- 기록: 원장 WP-029 상태, FR-REL-003 매핑

### WP-030 되돌림·체리픽·스택 관계 파생

- 목표: 되돌림·백포트·의존 PR을 근거와 함께 찾는다.
- 관련 요구사항: FR-REL-004, FR-REL-005, FR-REL-006
- 관련 API/데이터/잡: JOB-REL-002, JOB-REL-003, JOB-REL-004
- 선행 WP: WP-029, WP-020
- 구현 범위:
  - 되돌림: `This reverts commit <sha>` 트레일러(`exact`), `Revert "<제목>"` 제목 대조(`heuristic`), 연쇄 재적용
  - 체리픽: `(cherry picked from commit <sha>)` 트레일러(`exact`), `patch_id` 일치(`derived`, 동일 저장소 내), 후보 5건 상한
  - 스택: `base_branch` == 다른 열린 PR의 `head_branch`, 깊이 최대 10, 순환 감지
  - 상위 PR 머지 시 스택 간선 `detached` 표시
  - `link_summary.is_reverted` 갱신 → `is:reverted` 필터 지원
  - patch-id 실패 시 null + 메트릭
- 제외:
  - 동시 변경 (조회 시점 계산, WP-031)
  - 그래프 탐색 (WP-043)
- 완료 기준(DoD):
  - [ ] QA-W002-11, QA-W002-12가 통과한다
  - [ ] 되돌림 간선이 정·역방향 모두 조회된다 (FR-REL-004 AC-3)
  - [ ] `is:reverted` 필터가 동작한다 (AC-4)
  - [ ] 되돌림의 되돌림이 연쇄 저장된다 (AC-5)
  - [ ] 체리픽 트레일러가 `exact`, patch-id 일치가 `derived`로 저장된다 (FR-REL-005 AC-1, AC-2)
  - [ ] patch-id 비교가 동일 저장소 내로 한정된다 (AC-3)
  - [ ] 미러 미사용 환경에서 트레일러 기반만 동작하고 플래그가 표시된다 (AC-5)
  - [ ] 스택 순환이 감지되면 간선을 만들지 않는다 (FR-REL-006 AC-5)
- 검증 방법: `pnpm test -- link/revert`, `pnpm test:integration -- link/cherry-pick`
- 기록: 원장 WP-030 상태, FR-REL-004~006 매핑

### WP-031 관계 조회 API와 상세 화면 관계 섹션

- 목표: 관계가 근거·신뢰도와 함께 화면에 보인다.
- 관련 요구사항: FR-REL-003, FR-REL-004, FR-REL-005, FR-REL-006, FR-REL-007
- 관련 화면/플로우: W-002, W-003 / FLOW-006
- 관련 API/데이터/잡: API-REL-003
- 선행 WP: WP-030, WP-017
- 구현 범위:
  - 관계 조회 (정방향 `from_id`, 역방향 `to_id`)
  - `GET /co-changes`: 자카드 유사도, 90일 범위, 상위 20건, 겹치는 경로 상위 10, 변경 파일 200개 초과 제외
  - `C-021 LinkGroupList` 구현: 유형별 그룹, 신뢰도 배지, `heuristic`은 근거 `CodeBlock` 필수
  - `C-015 RelationBadgeGroup` (목록 화면 배지)
  - W-002·W-003 관계 섹션 연결 (확장 시 조회)
  - 미해결 참조는 링크 비활성
- 제외:
  - 그래프 시각화 (WP-043)
- 완료 기준(DoD):
  - [ ] QA-W002-10, QA-W002-13, QA-W002-14가 통과한다
  - [ ] `heuristic` 항목에 근거 문자열이 반드시 표시된다 (FR-REL-003 AC-2)
  - [ ] 동시 변경이 상위 20건, 경로 상위 10개와 함께 반환된다 (FR-REL-007 AC-3, AC-5)
  - [ ] 변경 파일 200개 초과 PR이 제외되고 사유가 표시된다 (AC-4)
  - [ ] 관계 섹션이 확장 시에만 조회된다 (QA-W002-17)
  - [ ] `evidence`가 평문으로 렌더링된다 (THR-020)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test:integration -- relation`, `pnpm test:e2e -- flow-006`
- 기록: 원장 WP-031 상태, FR-REL-007 매핑

### WP-032 패싯·커서 페이지네이션·전문 검색

- 목표: 대용량 결과를 끝까지 훑고 분포로 좁힌다.
- 관련 요구사항: FR-SRCH-008, FR-SRCH-009, FR-SRCH-011
- 관련 화면/플로우: W-001, W-004
- 관련 API/데이터/잡: API-SRCH-004
- 선행 WP: WP-013, WP-016
- 구현 범위:
  - `search_after` 커서: 정렬 키 값 + 질의 지문 봉인, `cursor_query_mismatch` 검사
  - 패싯 6종 (상위 20), 목록과 동일 질의 조건, 예산 초과 시 `facets_omitted`
  - 전문 검색: `multi_match` (title^3, body, message, 브랜치명), 강조 항목당 최대 3개·160자
  - 1자 검색어 거부
  - `C-016 CursorPager` 구현, `C-012 FacetRail` 데이터 연결
  - W-004에도 패싯 적용
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W001-14 ~ QA-W001-19가 통과한다
  - [ ] 마지막 페이지에서 `next_cursor`가 null이다 (FR-SRCH-008 AC-1)
  - [ ] `size` 200 초과가 절삭된다 (AC-2)
  - [ ] 질의 변경 후 이전 커서가 400을 낸다 (AC-3)
  - [ ] 오프셋 파라미터가 API에 존재하지 않는다 (AC-4, ADR-010)
  - [ ] 패싯 건수 합계가 목록 총 건수와 정합한다 (FR-SRCH-009 AC-3)
  - [ ] 패싯 실패가 목록을 막지 않는다 (예외 처리)
  - [ ] 제목 일치가 본문 일치보다 상위다 (FR-SRCH-011 AC-2)
  - [ ] 한글·영문 혼용 질의에서 두 언어 토큰이 매칭된다 (AC-4)
- 검증 방법: `pnpm test:integration -- search/facets`, `pnpm test:e2e -- search-paging`
- 기록: 원장 WP-032 상태, FR-SRCH-008·009·011 매핑

### WP-033 저장된 검색

- 목표: 반복 조회 조건을 재사용·공유한다.
- 관련 요구사항: FR-SRCH-010
- 관련 화면/플로우: W-008, W-001
- 관련 API/데이터/잡: API-SRCH-005, ENT-CORE-006
- 선행 WP: WP-013, WP-016
- 구현 범위:
  - `GET/POST/PATCH/DELETE /saved-searches`
  - 공개 범위 `private`/`team`, 100건 상한
  - 실행 시 실행자 접근 범위 적용 (저장자 권한 미승계)
  - `C-037 SavedSearchList`, W-008 화면
  - W-001 저장 액션 다이얼로그
  - 파싱 실패 질의는 실행 비활성 + 오류 구간
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W008-01 ~ QA-W008-05가 통과한다
  - [ ] `team` 공개 검색이 같은 팀에게만 보인다 (FR-SRCH-010 AC-2)
  - [ ] 실행자 권한이 적용되고 저장자 권한이 승계되지 않는다 (AC-3, THR-012)
  - [ ] 100건 초과 시 409다 (AC-4)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test:integration -- saved-search`, `pnpm test:e2e -- saved-search`
- 기록: 원장 WP-033 상태, FR-SRCH-010 매핑

### WP-034 W-009 저장소 개요 화면

- 목표: "왜 이 저장소 결과가 없는가"를 사용자가 스스로 확인한다.
- 관련 요구사항: FR-ING-006, FR-ING-009, FR-ING-011, FR-SEQ-001, FR-SEQ-005
- 관련 화면/플로우: W-009
- 관련 API/데이터/잡: API-ADM-001 (읽기), API-ADM-006
- 선행 WP: WP-010, WP-028
- 구현 범위:
  - `C-038 RepositoryCardGrid`, `C-039 SequenceSpaceStatusList`
  - 저장소별 등록 상태·마지막 수집 시각·문서 수·백필 진행률
  - 시퀀스 공간별 마지막 시퀀스·에폭·상태
  - 최근 조정 스캔 누락 건수
  - 미등록 저장소 등록 요청 기록
  - 접근 범위 내 저장소만 표시
  - W-001·W-002·W-005의 `not_indexed` 안내에서 이 화면으로 연결
- 제외:
  - 등록 실행 UI (WP-040의 A-002)
- 완료 기준(DoD):
  - [ ] QA-W009-01 ~ QA-W009-05가 통과한다
  - [ ] "결과 없음 / 권한 없음 / 미수집" 세 상태가 시각적으로 구분된다 (QA-COMMON-03)
  - [ ] 상태 매트릭스 W-009의 전 상태가 렌더링된다
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test -- web/repositories`, `pnpm test:a11y -- repositories`
- 기록: 원장 WP-034 상태

### WP-035 무중단 재색인

- 목표: 매핑 변경이 서비스 중단 없이 반영된다.
- 관련 요구사항: FR-ING-008, NFR-008
- 관련 화면/플로우: A-003 (API만)
- 관련 API/데이터/잡: API-ADM-004, JOB-ING-006
- 선행 WP: WP-003, WP-008
- 구현 범위:
  - `POST /admin/reindex`: 새 버전 인덱스 생성 → PostgreSQL에서 재투영 → 별칭 원자 전환
  - 재색인 중 신규 이벤트 이중 쓰기
  - 별칭 전환은 alias 액션 1회
  - 전환 후 이전 인덱스 7일 보관 후 삭제
  - 실패 시 별칭 미전환, 기존 인덱스 유지
  - 진행률 보고
  - `pnpm es:reindex --alias <별칭>` CLI
- 제외:
  - A-003 화면 (WP-040)
- 완료 기준(DoD):
  - [ ] QA-A003-07, QA-A003-08이 통과한다
  - [ ] 애플리케이션이 실제 인덱스명이 아닌 별칭만 참조한다 (FR-ING-008 AC-1)
  - [ ] 재색인 중 신규 이벤트가 양쪽 인덱스에 기록된다 (AC-2)
  - [ ] 별칭 전환이 원자적이다 (AC-3)
  - [ ] 재색인 실패 시 별칭이 전환되지 않는다 (AC-5)
  - [ ] 재색인 중 검색 요청이 실패하지 않는다 (무중단 검증)
  - [ ] **원본만으로 인덱스를 전량 재구성했을 때 결과가 동일하다** (FR-ING-003 AC-3, QA 6장)
- 검증 방법: `pnpm test:integration -- reindex`
- 기록: 원장 WP-035 상태, FR-ING-008 매핑

### WP-036 원본 아카이브 레인(Filebeat)

- 목표: 원본 이벤트가 애플리케이션과 독립적으로 검색 가능하게 보관된다.
- 관련 요구사항: FR-ING-010
- 관련 화면/플로우: A-001
- 관련 API/데이터/잡: ENT-ING-003
- 선행 WP: WP-004
- 구현 범위:
  - `prs-raw-events-{yyyy.MM}` 매핑 (`payload`는 `enabled: false`), ILM 정책
  - Filebeat 설정: 게이트웨이 NDJSON 아카이브 tail → ES
  - 오프셋 상태 유지, 재기동 시 이어서 적재
  - 조회는 `operator`·`security_officer` 한정
  - A-001에 아카이브 적재 상태 표시
- 제외:
  - 아카이브 전문 검색 (payload는 색인하지 않음)
- 완료 기준(DoD):
  - [ ] QA-A001-08이 통과한다
  - [ ] 아카이브 인덱스의 별칭·매핑·ILM이 엔티티 인덱스와 분리된다 (FR-ING-010 AC-1)
  - [ ] ILM으로 기간 경과 문서가 자동 삭제된다 (AC-2)
  - [ ] Filebeat를 정지시켜도 엔티티 색인이 정상 동작한다 (AC-3)
  - [ ] `delivery_id`로 `raw_event`와 대조된다 (AC-4)
  - [ ] Filebeat 재기동 시 마지막 오프셋부터 이어서 적재한다 (예외 처리)
- 검증 방법: `pnpm test:integration -- archive`, 수동 Filebeat 중단·재기동 시나리오
- 기록: 원장 WP-036 상태, FR-ING-010 매핑

---

## REL-005 통계와 운영 고도화

### WP-037 집계 API

- 목표: 그룹·시계열·백분위·분포 집계가 현재 질의 조건 위에서 동작한다.
- 관련 요구사항: FR-STAT-001, FR-STAT-002, FR-STAT-003, FR-STAT-004, FR-STAT-005, FR-STAT-006
- 관련 화면/플로우: W-006, W-001
- 관련 API/데이터/잡: API-STAT-001~004
- 선행 WP: WP-013
- 구현 범위:
  - `POST /analytics/groups`: 그룹 키 7종, 지표 4종, 500개 상한, `drill_down_query` 산출
  - `POST /analytics/time-series`: 간격 4종, 시간대 반영, 400 버킷 상한, 빈 버킷 0 채움, 계열 20개 상한
  - `POST /analytics/percentiles`: `lead_time_seconds`·`first_review_wait_seconds`, 백분위 5종, 표본 20건 미만 `low_sample`, 제외 건수 반환
  - `POST /analytics/distributions`: 파일 수·라인 수 구간, 비율, `unknown` 구간
  - 100만 건 초과 시 근사 + `approximate: true`
  - 5초 타임아웃
  - 검색과 별도 엔드포인트 (지연 격리)
  - 강제 권한 필터 결합
- 제외:
  - 화면 (WP-038)
- 완료 기준(DoD):
  - [ ] QA-W006-01 ~ QA-W006-15가 API 계층에서 통과한다
  - [ ] 집계 총 건수와 목록 총 건수가 일치한다 (FR-STAT-006 AC-2)
  - [ ] 접근 범위 밖 문서가 집계 건수에 포함되지 않는다 (FR-AUTH-002 AC-5, THR-003)
  - [ ] 집계 p95가 1500ms 이하다 (NFR-001)
  - [ ] 사전 계산 필드를 사용하고 조회 시점 script를 쓰지 않는다 (FR-STAT-003 AC-5)
  - [ ] API 계약의 응답 예시와 실제 응답이 일치한다
- 검증 방법: `pnpm test:integration -- analytics`, `pnpm test:perf -- analytics`
- 기록: 원장 WP-037 상태, FR-STAT-001~006 매핑

### WP-038 W-006 통계 대시보드

- 목표: 관리자가 지표를 보고 근거 목록으로 이동한다.
- 관련 요구사항: FR-STAT-001, FR-STAT-002, FR-STAT-003, FR-STAT-004, FR-STAT-005, FR-STAT-006
- 관련 화면/플로우: W-006, W-001 / FLOW-005
- 관련 API/데이터/잡: API-STAT-001~004
- 선행 WP: WP-037, WP-015
- 구현 범위:
  - `C-030 AggregationPanel`, `C-033 TimeSeriesChart`, `C-034 DistributionChart`, `C-035 PercentileCardRow`
  - 차트는 Conductor semantic 토큰만 사용, 동적 import
  - 모든 차트에 표 대체 제공
  - 패널별 독립 조회·실패 격리
  - 그룹·버킷·구간 클릭 시 W-001로 이동
  - W-001 집계 탭 연결
  - `approximate`/`low_sample` 배지
  - 개인 순위 배지·정렬 강조 없음
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W006-01 ~ QA-W006-18이 통과한다
  - [ ] 한 패널 실패가 다른 패널을 비우지 않는다 (QA-W006-16)
  - [ ] 개인 순위 강조가 없다 (QA-W006-17)
  - [ ] 모든 차트에 표 대체가 있다 (QA-W006-18)
  - [ ] 차트 색상이 라이트·다크 모두에서 대비 기준을 만족한다
  - [ ] 리터럴 색상값이 없다 (QA-COMMON-16)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test -- web/analytics`, `pnpm test:e2e -- flow-005`, `pnpm test:a11y -- analytics`
- 기록: 원장 WP-038 상태

### WP-039 감사 기록과 A-004

- 목표: 누가 무엇을 조회했는지 남고, 보안 담당자만 볼 수 있다.
- 관련 요구사항: FR-AUTH-004, NFR-006
- 관련 화면/플로우: A-004
- 관련 API/데이터/잡: API-ADM-005, ENT-CORE-007
- 선행 WP: WP-012, WP-002
- 구현 범위:
  - 감사 대상 액션 13종 기록 (보안 문서 7장)
  - 비동기 기록, 실패해도 요청 처리 계속, 실패 메트릭
  - `GET /admin/audit-records` (필터 + 커서 페이징), `security_officer` 한정
  - A-004 화면 (`C-013 ResultTable` 재사용)
  - 갱신·삭제 UI 없음
  - 감사 화면 진입 자체를 기록
  - `JOB-AUD-001` 보존 만료 파티션 드롭
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-A004-01 ~ QA-A004-05가 통과한다
  - [ ] 감사 대상 액션 13종이 모두 기록된다 (FR-AUTH-004 AC-1)
  - [ ] 각 기록이 필수 필드 7종을 포함한다 (AC-2)
  - [ ] 애플리케이션이 감사 기록을 수정·삭제할 수 없다 (AC-3)
  - [ ] `security_officer`가 아닌 역할이 403을 받는다 (AC-5)
  - [ ] 감사 저장 실패가 조회를 막지 않는다 (예외 처리)
  - [ ] 응답 본문이 감사에 기록되지 않는다 (보안 7장)
- 검증 방법: `pnpm test:integration -- audit`, `pnpm test:e2e -- audit`
- 기록: 원장 WP-039 상태, FR-AUTH-004 매핑

### WP-040 A-002·A-003 운영 콘솔

- 목표: 운영자가 저장소·잡·인덱스·시퀀스를 화면에서 제어한다.
- 관련 요구사항: FR-ING-009, FR-ADMIN-002, FR-ADMIN-003, FR-ING-006, FR-ING-008
- 관련 화면/플로우: A-001, A-002, A-003 / FLOW-007, FLOW-008
- 관련 API/데이터/잡: API-ADM-001~004, API-ADM-006~007
- 선행 WP: WP-010, WP-019, WP-028, WP-035
- 구현 범위:
  - A-001 완성: `C-040 PipelineMetricGrid`, `C-041 DeadLetterTable`, `C-042 ScanResultCard`
  - A-002: `C-043 RepositoryRegistrationForm`, 등록 요청 목록
  - A-003: `C-044 JobTable`, `C-045 JobRunForm`, `C-046 IndexStatusPanel`, `C-047 IntegrityReportCard`
  - 30초 폴링 (조작 중 보류, 백그라운드 탭 중단)
  - 파괴적 확인 다이얼로그: 해제("문서 유지" 명시), 일괄 재처리(100건 초과 재확인), 재채번(영향 범위 + 저장소명 입력)
  - `operator` 역할 제한
- 제외:
  - A-004 (WP-039)
- 완료 기준(DoD):
  - [ ] QA-A001-01 ~ QA-A001-10, QA-A002-01 ~ QA-A002-05, QA-A003-01 ~ QA-A003-11이 통과한다
  - [ ] 재채번 다이얼로그가 영향 범위를 표시하고 저장소명 직접 입력을 요구한다 (QA-A003-10)
  - [ ] 조작 중 자동 갱신이 보류된다 (QA-A001-09)
  - [ ] `operator`가 아닌 역할에게 내비게이션이 렌더링되지 않고 직접 진입 시 차단된다
  - [ ] FLOW-007, FLOW-008이 E2E로 통과한다
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test -- web/ops`, `pnpm test:e2e -- flow-007 flow-008`, `pnpm test:a11y -- ops`
- 기록: 원장 WP-040 상태, FR-ADMIN-002 매핑

---

## REL-006 조사 보조와 관계 시각화

### WP-041 안전 구간 표식

- 목표: "여기까지는 검증됐다"를 조직이 공유한다.
- 관련 요구사항: FR-SEQ-006
- 관련 화면/플로우: W-004
- 관련 API/데이터/잡: API-SEQ-004, ENT-SEQ-003
- 선행 WP: WP-023, WP-025
- 구현 범위:
  - `GET/PUT /safe-markers`
  - 시퀀스 공간당 현재 표식 1개, 이전 표식은 `superseded_at`으로 이력 보존
  - 메모 500자 상한, 에폭 함께 저장
  - `release_manager` 역할 제한, 그 외는 `blockedReason` 비활성
  - 에폭 변경 시 무효 표시
  - `C-031 SafeMarkerCard`
  - 감사 기록
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W004-12 ~ QA-W004-14가 통과한다
  - [ ] 새 표식이 이전 것을 이력으로 남기고 대체한다 (FR-SEQ-006 AC-1)
  - [ ] `release_manager` 외 역할의 쓰기가 403이다 (AC-3)
  - [ ] 에폭 변경 시 표식이 무효로 표시된다 (AC-4)
  - [ ] 등록·변경이 감사 기록에 남는다 (AC-5)
  - [ ] 존재하지 않는 시퀀스 지정 시 400이다 (예외 처리)
- 검증 방법: `pnpm test:integration -- safe-marker`, `pnpm test:e2e -- safe-marker`
- 기록: 원장 WP-041 상태, FR-SEQ-006 매핑

### WP-042 이분 탐색 보조

- 목표: 조사 구간의 후보를 절반씩 줄인다.
- 관련 요구사항: FR-SEQ-007
- 관련 화면/플로우: W-004 / FLOW-004
- 관련 API/데이터/잡: API-SEQ-005, ENT-SEQ-004
- 선행 WP: WP-023, WP-025
- 구현 범위:
  - `GET/POST/DELETE /bisect-sessions`
  - good/bad 표시로 구간 갱신, 다음 검사 지점은 실재 커밋 중 중앙값 최근접
  - 남은 후보 수 + 예상 잔여 검사 횟수(올림 log2)
  - 후보 1건 도달 시 결과 반환·종료
  - 모순 표시 시 409
  - 사용자·시퀀스 공간별 서버 저장, 에폭 변경 시 무효화
  - `C-029 BisectPanel`, `aria-live` 후보 수 알림
- 제외:
  - 실제 빌드·테스트 실행 (범위 밖)
- 완료 기준(DoD):
  - [ ] QA-W004-15 ~ QA-W004-20이 통과한다
  - [ ] 다음 검사 지점이 실재 커밋 시퀀스다 (FR-SEQ-007 AC-2)
  - [ ] 후보 1건 도달 시 탐색이 종료된다 (AC-3)
  - [ ] 예상 잔여 횟수가 올림 log2와 일치한다 (AC-4)
  - [ ] 브라우저를 닫았다 열어도 상태가 이어진다 (AC-5)
  - [ ] 에폭 변경 시 탐색이 무효화된다 (FLOW-004 예외)
  - [ ] FLOW-004가 E2E로 통과한다
- 검증 방법: `pnpm test:integration -- bisect`, `pnpm test:e2e -- flow-004`
- 기록: 원장 WP-042 상태, FR-SEQ-007 매핑

### WP-043 관계 그래프 API와 W-007

> 조건부 WP. OD-007(관계 정확도 표본 200건 검수 95% 이상) 충족 시에만 착수한다.

- 목표: 관계를 한 화면에서 조망한다.
- 관련 요구사항: FR-REL-008
- 관련 화면/플로우: W-007
- 관련 API/데이터/잡: API-REL-004
- 선행 WP: WP-031
- 구현 범위:
  - `GET /relation-graphs`: 깊이 1~3(기본 2), 노드 상한 300, 신뢰도 우선 포함, 2초 예산
  - 깊이당 1회 `terms` 질의 (노드당 질의 금지)
  - 접근 범위 밖 노드 제외
  - `precedes` 노드는 시퀀스 인접 조회로 합성
  - `C-036 RelationGraphCanvas` + 동등한 노드·간선 표 (키보드 순회)
  - `C-003 InspectorPanel`
  - 관계 유형·신뢰도 필터
  - 동적 import
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W007-01 ~ QA-W007-06이 통과한다
  - [ ] 노드 300개 초과 시 신뢰도 우선순위로 포함되고 절삭 표시된다 (FR-REL-008 AC-2)
  - [ ] 각 간선에 유형·방향·신뢰도·근거가 표시된다 (AC-3)
  - [ ] 접근 범위 밖 노드가 나타나지 않는다 (AC-4)
  - [ ] 캔버스와 동등한 표가 제공되고 키보드로 순회된다 (NFR-007)
  - [ ] 그래프 없이도 W-002·W-003에서 동일 정보를 확인할 수 있다 (와이어프레임 W-007 구현 메모)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test:integration -- relation/graph`, `pnpm test:a11y -- graph`
- 기록: 원장 WP-043 상태, FR-REL-008 매핑

### WP-044 검색 결과 내보내기

- 목표: 조사 결과를 티켓·보고서에 붙인다.
- 관련 요구사항: FR-SRCH-012
- 관련 화면/플로우: W-001
- 관련 API/데이터/잡: API-SRCH-006, JOB-SRCH-001
- 선행 WP: WP-013, WP-016
- 구현 범위:
  - `POST /exports`: 1000건 이하 동기, 초과 시 비동기 잡 + 다운로드 링크
  - 10만 건 상한
  - CSV·JSON 형식
  - 실행자 접근 범위 적용
  - 감사 기록
  - 실행 전 대상 건수 확인 다이얼로그
  - 잡 실패 시 부분 파일 미제공
- 제외: 없음
- 완료 기준(DoD):
  - [ ] QA-W001-20, QA-W001-21이 통과한다
  - [ ] 1000건 이하가 동기 응답이다 (FR-SRCH-012 AC-1)
  - [ ] 1000건 초과가 비동기 잡을 만든다 (AC-2)
  - [ ] 10만 건 초과가 400이다 (AC-3)
  - [ ] 내보내기가 감사 기록에 남는다 (AC-4)
  - [ ] 내보내기 결과에 접근 범위가 적용된다 (AC-5, THR-011)
  - [ ] 잡 실패 시 부분 파일이 제공되지 않는다 (예외 처리)
- 검증 방법: `pnpm test:integration -- export`, `pnpm test:e2e -- export`
- 기록: 원장 WP-044 상태, FR-SRCH-012 매핑

## 4. REL → WP 커버리지

| REL | WP | 개수 |
| --- | --- | --- |
| REL-001 | WP-001 ~ WP-010 | 10 |
| REL-002 | WP-011 ~ WP-019 | 9 |
| REL-003 | WP-020 ~ WP-028 | 9 |
| REL-004 | WP-029 ~ WP-036 | 8 |
| REL-005 | WP-037 ~ WP-040 | 4 |
| REL-006 | WP-041 ~ WP-044 | 4 |
| 합계 | | 44 |

모든 REL이 WP로 분해되었고, 모든 WP가 최소 1개 FR을 참조한다.
