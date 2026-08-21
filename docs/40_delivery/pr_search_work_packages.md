# PR Search 작업 패키지

> 상태: review | 버전: v0.3 | 갱신일: 2026-08-20

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
| WP-045 | gh capability 레지스트리와 parity 검증기 | REL-007 | WP-001 | todo |
| WP-046 | 위임 GitHub 신원과 Operations App | REL-007 | WP-012 | todo |
| WP-047 | 격리 gh 실행기와 실행 수명주기 | REL-007 | WP-045, WP-046 | todo |
| WP-048 | W-010 GitHub Command Center 수직 슬라이스 | REL-007 | WP-047 | todo |
| WP-049 | PR 작업 (W-011) | REL-008 | WP-048 | todo |
| WP-050 | Issue·Discussion 작업 (W-012) | REL-008 | WP-048 | todo |
| WP-051 | 저장소 작업 (W-013) | REL-009 | WP-048, WP-057 | todo |
| WP-052 | Actions·워크플로·실행·캐시 (W-014) | REL-009 | WP-048 | todo |
| WP-053 | 릴리스·프로젝트 작업 (W-015, W-016) | REL-009 | WP-048, WP-057 | todo |
| WP-054 | 시크릿·변수·레이블·룰셋·키 (W-018) | REL-010 | WP-048 | todo |
| WP-055 | Codespace·Gist·Attestation·고급 도구 (W-017, W-019, W-022) | REL-010 | WP-048 | todo |
| WP-056 | gh API 탐색기 (W-020) | REL-010 | WP-048 | todo |
| WP-057 | 임시 workspace와 로컬 git 작업 | REL-009 | WP-047 | todo |
| WP-058 | Recipe 빌더 (W-023) | REL-011 | WP-049, WP-052, WP-066 | todo |
| WP-059 | capability 드리프트와 정책 관리 (A-005, A-006) | REL-011 | WP-045, WP-048 | todo |
| WP-060 | 전체 parity 검증 | REL-011 | WP-045 ~ WP-059, WP-061 ~ WP-066 | todo |
| WP-061 | 의미 capability 제약 엔진 | REL-007 | WP-045 | todo |
| WP-062 | gh 출력·파일 안전 경계 | REL-007 | WP-047 | todo |
| WP-063 | interactive 웹 등가와 extension 신뢰 어댑터 | REL-010 | WP-045, WP-055 | todo |
| WP-064 | gh api 스키마 브리지와 호스트 capability 판정 | REL-010 | WP-056 | todo |
| WP-065 | 조합 parity 검증기 | REL-011 | WP-061, WP-063, WP-064, WP-066 | todo |
| WP-066 | typed 결과 계약과 capability 그래프 | REL-007 | WP-045, WP-061 | todo |

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
- 검증 방법: `pnpm test:integration db` (testcontainers PostgreSQL)
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
- 검증 방법: `pnpm test:integration es`
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
- 검증 방법: `pnpm test:integration gateway`, `pnpm test gateway/signature`
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
  - Kafka 어댑터 (조건부 — ADR-002의 전환 임계 충족 시)
  - 실제 소비자 로직 (WP-007, WP-008)
- 완료 기준(DoD):
  - [ ] 같은 파티션 키의 메시지가 같은 소비자에게 순서대로 전달된다
  - [ ] 소비자 장애 시 미ack 메시지가 재전달된다
  - [ ] 계약 테스트가 통과한다
  - [ ] Redis를 정지시킨 뒤 이벤트를 수신하면 게이트웨이는 202를 반환하고, Redis 복구 후 `JOB-ING-007`이 해당 이벤트를 재적재한다 (ADR-002 follow-up)
- 검증 방법: `pnpm test:integration bus`
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
- 검증 방법: `pnpm test github` (목 서버 기반)
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
- 검증 방법: `pnpm test:integration worker/enrich`
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
  - `document_version` 조건부 스크립트 업서트 (데이터 모델 5장). 버전 출처는 **웹훅 수신 시각**이다 — 보강 시각을 쓰면 순서가 바뀐 두 웹훅 중 늦게 보강된 쪽이 이긴다
  - 누적 필드(`pull_request_numbers`)는 버전과 무관하게 합집합 (CR-011, DEV-019)
  - 투영이 소유하지 않는 필드(`merge_seq`·`link_summary`·`links_pending`·`release_tags`)는 생성 시 `upsert` 본문에만 초깃값으로 둔다 — `params.doc`에 넣으면 투영이 돌 때마다 다른 워커의 결과를 되돌린다
  - 미등록 저장소 이벤트는 투영하지 않고 ack한다 (FR-ING-009 AC-4, CR-011 DEV-020). 실패가 아니므로 실패 대기열로 보내지 않는다
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
  - [ ] 커밋이 두 PR에 속해도 `pull_request_numbers`가 합집합으로 남는다 (FR-SRCH-002, CR-011)
  - [ ] 미등록 저장소 이벤트는 문서를 만들지 않고 실패로도 세지 않는다 (FR-ING-009 AC-4)
- 검증 방법: `pnpm test:integration worker/project`
- 기록: 원장 WP-008 상태, FR-ING-005 매핑

### WP-009 실패 대기열과 재처리

- 목표: 실패 이벤트가 격리되고 운영자가 재처리할 수 있다.
- 관련 요구사항: FR-ING-007
- 관련 API/데이터/잡: API-ADM-003, ENT-ING-002, JOB-ING-009, EVT-ING-004
- 선행 WP: WP-007, WP-008
- 구현 범위:
  - `dead_letter` 적재: 실패 사유, 마지막 오류, 재시도 횟수, 단계, 저장소
  - `(delivery_id, stage)` 업서트 — 한 이벤트의 한 단계에 행 하나 (CR-012, DEV-022)
  - `GET /api/v1/admin/dead-letters` 목록 조회 (필터: 단계, 상태, 저장소)
  - `POST /api/v1/admin/dead-letters/reprocess` 개별·일괄 재처리
  - 재처리는 `raw_event`에서 원본을 읽어 `prs:ingest`에 재투입, 멱등 규칙 적용
  - 3회 재처리 실패 시 `held` 전환, 자동 재처리 제외
  - 끝까지 성공한 이벤트는 투영이 `processed_at`을 찍는 자리에서 `resolved`로 닫는다 (CR-012, DEV-023)
  - 임시 인증: `ADMIN_API_TOKEN`. 미설정이면 경로를 등록하지 않는다 (CR-012, DEV-025)
  - 메트릭: `dead_letter_total{state}`, 100건 초과 시 경보 규칙
- 제외:
  - A-001 화면 (WP-010의 최소 콘솔)
  - `operator` 역할 판정과 감사 기록 (WP-012 인증, WP-010 감사)
  - `EVT-JOB-001` 진행률 보고 (`batch` 워커를 세우는 WP-019)
- 완료 기준(DoD):
  - [ ] 재시도 5회 소진 이벤트가 사유와 함께 DLQ에 저장된다 (FR-ING-007 AC-2)
  - [ ] 개별·일괄 재처리가 동작한다 (AC-3)
  - [ ] 재처리가 중복 문서를 만들지 않는다 (AC-4)
  - [ ] 3회 재처리 실패 이벤트가 `held`로 전환된다 (예외 처리)
  - [ ] 100건 초과 시 경보 메트릭이 임계를 넘는다 (AC-5)
  - [ ] 일괄 재처리 100건 초과 시 재확인이 요구된다 (QA-A001-05)
- 검증 방법: `pnpm test:integration ops/dead-letter`
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
  - `GET /admin/pipeline-status`: 수신량, 큐 길이, 수집 반영 지연 p50/p95, DLQ 수, 보강 대기 수, 저장소별 지연 상위 10
  - 단계별 지연은 지표 저장소가 설정된 경우에만. 없으면 `unavailable` (CR-013, DEV-029)
  - `repository_archived`를 커밋 문서까지 확장하고 해제 시 기존 문서에 소급 표시 (CR-013, DEV-028)
  - 이름 붙은 관리 토큰과 감사 기록 적재 (CR-013, DEV-030)
  - k8s 매니페스트 (게이트웨이, 워커, PostgreSQL/ES/Redis 연결)
  - Prometheus 메트릭 엔드포인트 — 세 앱이 손으로 복제한 지표 모듈을 `@prs/metrics` 한 곳으로 합친다
- 제외:
  - A-002 화면 (WP-040)
  - A-001 화면 (WP-015 웹 셸과 Conductor가 선 뒤). 이 WP는 API까지다
  - 시퀀스 공간 상태 (WP-021 이후)
  - 백필 잡의 **실행** (WP-019가 `batch` 워커를 세운다). 여기서는 `job` 행만 큐에 넣는다
- 완료 기준(DoD):
  - [ ] 대상 브랜치 11개 등록 시 400 `BRANCH_LIMIT_EXCEEDED`를 반환한다 (FR-ING-009 AC-2)
  - [ ] 해제 후에도 기존 문서가 조회된다 (AC-3)
  - [ ] 미등록 저장소 이벤트가 `raw_event`에는 있고 ES에는 없다 (AC-4)
  - [ ] 접근 권한 없는 저장소 등록이 403으로 거부된다 (예외 처리)
  - [ ] 파이프라인 상태 응답의 데이터 신선도가 30초 이내다 (FR-ADMIN-001 AC-2)
  - [ ] 등록·해제가 감사 기록에 남는다 (AC-5)
- 검증 방법: `pnpm test:integration admin/repositories`, `pnpm test:integration ops/pipeline-status` (CR-013, DEV-032 — `test:e2e` 스크립트가 없고 이 WP는 화면을 만들지 않으므로 API 수준 end-to-end로 대체)
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
  - 범위 문법 `a..b` (숫자, 날짜, 날짜시각) — `seq`·`merged`·`created` 세 키만 (CR-014, DEV-037)
  - 부정 접두 `-`. 범위에도 붙으며 `op`는 `not_range`다 (CR-014, DEV-035)
  - `is` 값 검증 (`merged`/`open`/`closed`/`reverted`). 값이 열거되지 않은 키는 검증하지 않는다 (CR-014, DEV-036)
  - 전문 검색어 1자는 `QUERY_TOO_SHORT` (CR-014, DEV-038)
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
- 검증 방법: `pnpm test query`
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
  - `GET /me`: 사용자, 역할, 접근 범위 **요약** (저장소 ID 목록 미포함 — CR-015, DEV-040)
  - 신원 seam: `web`은 세션 쿠키·상관 ID만 전달하고 `search-api`가 Redis에서 직접 해석한다 (CR-015, DEV-047)
  - 역할 합성: {`developer`} ∪ IdP 그룹 매핑(`manager`·`qa`) ∪ DB 지정값 (CR-015, DEV-049)
  - `access_scope_version` 울타리 — 무효화와 겹친 갱신은 캐시에 쓰지 않는다 (CR-015, DEV-044)
  - 무효화 대상 산출: `github_user_id` 조회, `team_id` → GHE 구성원 + `team_member` 갱신, `repository_id` → GIN 색인 (CR-015, DEV-043·DEV-045·DEV-046)
  - `/admin/*` 인증 인계: OIDC 구성 시 세션 + `operator`, 이름 붙은 토큰은 OIDC 미구성 시에만 (CR-015, DEV-048)
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
- 검증 방법: `pnpm test:integration authz`, `pnpm test authz/architecture`
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
  - 결과 0건 시 `relaxation_hints` 산출 — `msearch` 1회, 후보 상한 8개, 절삭 시 표식 (CR-016, DEV-055)
  - 질의 키 15종 → ES 필드. `org`·`team`은 레지스트리에서 이름→ID 해석 (CR-016, DEV-052)
  - `is`는 파생 상태 — `reverted`는 `link_summary.is_reverted` (CR-016, DEV-053)
  - 대상 인덱스는 PR·커밋 둘. **모든 정렬 키에 `unmapped_type`, `_shards.failed` 검사** (CR-016, DEV-054)
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
- 검증 방법: `pnpm test:integration search`, `pnpm test:perf search`
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
  - URL 해석은 `GHE_BASE_URL` 호스트가 맞을 때만. 다른 호스트는 `text` (CR-017, DEV-064)
  - 채워지지 않은 필드는 **키를 넣지 않는다** — CR-016 DEV-057의 규칙과 같다 (CR-017, DEV-060)
- 제외:
  - 시퀀스 값 (WP-021 이후 채워짐)
  - 관계·릴리스 (WP-024, WP-031)
  - 릴리스 태그 판별 — 패턴이 정의되어 있지 않다. WP-024가 정의한다 (CR-017, DEV-065)
  - 커밋 자체의 메시지·작성자·부모 SHA·파일 목록 — 투영이 채우지 않는다. WP-020 (CR-017, DEV-060)
  - `direct_push` 역할 — push 이벤트 라우팅이 없어 도달하지 않는다. WP-021 (CR-017, DEV-061)
- 완료 기준(DoD):
  - [ ] QA-W001-01 ~ QA-W001-06이 API 계층에서 통과한다
  - [ ] QA-W003-01, QA-W003-02, QA-W003-04, QA-W003-05가 통과한다 (**QA-W003-03 `direct_push`는 도달 불가 — CR-017, DEV-061**)
  - [ ] QA-W002-01 ~ QA-W002-03이 통과한다
  - [ ] 단건 해석 p95가 200ms 이하다 (NFR-001) — 커밋 1000만 건 데이터셋
  - [ ] 7자 접두 질의가 통상 후보 1건으로 좁혀진다 (ADR-012 근거 검증)
  - [ ] API 계약의 응답 예시 3종과 실제 응답이 일치한다
- 검증 방법: `pnpm test:integration resolve`, `pnpm test:perf resolve`
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
    — **신원 헤더를 만들지 않는다.** 세션 쿠키만 전달한다 (CR-018, DEV-067)
  - `test:a11y`·`test:e2e` harness 수립 — 화면을 처음 세우는 WP다 (CR-018, DEV-069 / DEV-032)
  - `⌘K`는 셸이 소유하고 `omniSearch` 슬롯의 첫 포커스 가능 요소를 잡는다. C-010은 WP-016 (CR-018, DEV-070)
  - 클라이언트는 `@prs/authz/roles` 서브패스만 쓴다 — 진입점은 `@prs/es`를 끌어온다 (CR-018, DEV-068)
  - OIDC 콜백 라우트, 경로 보존 리다이렉트
  - 역할 기반 내비게이션 필터링 (운영 그룹은 렌더링하지 않음)
  - `C-004 EmptyState`, `C-005 ErrorBanner` 구현
  - `lib/query-url.ts`: 질의 문자열 ↔ URL 동기화 (`@prs/query` 사용)
  - `lib/format.ts`: SHA 축약(12자), 시퀀스 표기(구분 기호 없음), 기간 포맷
  - 라우트 전환 시 `main` 포커스 이동 + `aria-live` 제목 알림
  - 좁은 화면(≤800px) 내비게이션 서랍을 여는 버튼 — `TopBar`의 `menuButton` 슬롯. 없으면 그 폭에서 내비게이션에 도달할 수 없다 (DEV-073)
  - 라이트·다크 테마 확인
- 제외:
  - 개별 화면 (WP-016 이후)
- 완료 기준(DoD):
  - [~] QA-COMMON-01, QA-COMMON-06, QA-COMMON-07, QA-COMMON-09, QA-COMMON-11, QA-COMMON-12, QA-COMMON-14, QA-COMMON-16, QA-COMMON-17, QA-COMMON-18이 통과한다 — **7/10 통과**. 01·09·14는 화면이 없어 셸 몫까지만 (원장 6.15장)
  - [x] `operator`가 아닌 역할에게 운영 내비게이션이 렌더링되지 않는다 (QA-A001-10)
  - [x] `⌘K`/`Ctrl+K`로 옴니 검색에 포커스한다 — 셸이 슬롯 계약을 소유한다 (DEV-070)
  - [~] 세션 만료 후 재인증 시 원래 경로로 복귀한다 (FLOW-000) — 라우트와 왕복 상태는 서고 시험도 있으나 **실제 IdP 왕복은 NOT RUN**이고 경로가 `/` 하나뿐이다
  - [x] `query-url` 왕복 테스트가 통과한다
  - [x] axe 위반 0건, `checkContrast` 위반 0건 — axe 24건 위반 0, `checkContrast` 80쌍 실패 0
- 검증 방법: `pnpm test web/lib`, `pnpm test:a11y shell`, `pnpm test:e2e auth` — **세 스크립트를 이 WP가 만들었다** (DEV-069 / DEV-032)
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
  - 해석 호출은 **`limit=50`을 명시한다** — 기본 10으로는 11건에서 절삭 표시가 떠 FR-SRCH-004 AC-3의 50 경계와 어긋난다 (CR-019, DEV-080)
  - 상태 매트릭스 W-001의 전 상태 렌더링. 패싯은 `not_computed`, 시퀀스는 `not_computed`를 각각 구분해 그린다 (CR-019, DEV-076·077)
  - URL이 단일 진실: 필터·정렬은 `router.replace`, 화면 이동은 `push`
- 제외:
  - 패싯 데이터, 커서 페이징, 전문 검색 강조 (WP-032)
  - 관계 배지 열 — `C-015`와 함께 WP-031이 붙인다. 빈 열은 "관계 없음"으로 읽힌다 (CR-019, DEV-081)
  - 집계 탭 (WP-038)
  - 저장·내보내기 (WP-033, WP-044)
- 완료 기준(DoD):
  - [ ] QA-W001-01 ~ QA-W001-13, QA-W001-22, QA-W001-23이 통과한다
  - [ ] **QA-W001-14는 절반만** — "페이지 번호 UI가 없다"는 여기서, "커서 기반으로 동작한다"는 WP-032 (CR-019, DEV-075)
  - [ ] 상태 매트릭스 W-001의 모든 상태에 대응하는 컴포넌트 테스트가 있다
  - [ ] 필터를 5회 조작한 뒤 뒤로가기 1회로 이전 화면에 돌아간다
  - [ ] URL을 복사해 새 탭에 붙여넣으면 동일 화면이 재현된다 (QA-COMMON-09)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test web/search`, `pnpm test:e2e flow-001`, `pnpm test:a11y search`
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
- 검증 방법: `pnpm test web/pr`, `pnpm test:e2e flow-002`, `pnpm test:a11y pr`
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
- 검증 방법: `pnpm test web/commit`, `pnpm test:e2e flow-002`, `pnpm test:a11y commit`
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
- 검증 방법: `pnpm test:integration jobs/backfill`
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
- 검증 방법: `pnpm test:integration graph` (로컬 git 픽스처 저장소 사용)
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
- 검증 방법: `pnpm test:integration sequence/assign`, `pnpm test:regression sequence`
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
- 검증 방법: `pnpm test:integration sequence/reassign`, `pnpm test:regression sequence-rewrite`
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
- 검증 방법: `pnpm test:integration sequence/range`, `pnpm test:regression range-vs-git`
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
- 검증 방법: `pnpm test:integration release/containment`
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
- 검증 방법: `pnpm test web/range`, `pnpm test:e2e flow-003`, `pnpm test:a11y range`
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
- 검증 방법: `pnpm test:integration release/comparison`, `pnpm test:e2e flow-003`
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
- 검증 방법: `pnpm test:integration relation/neighbors`, `pnpm test:e2e flow-002`
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
- 검증 방법: `pnpm test:integration ops/integrity`, `pnpm test:integration jobs/reconcile`
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
- 검증 방법: `pnpm test link/reference`, `pnpm test:integration worker/link`
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
- 검증 방법: `pnpm test link/revert`, `pnpm test:integration link/cherry-pick`
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
- 검증 방법: `pnpm test:integration relation`, `pnpm test:e2e flow-006`
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
  - [ ] QA-W001-14 ~ QA-W001-19가 통과한다. **QA-W001-14의 "페이지 번호 UI가 없다"는 WP-016이 이미 세웠으므로** 여기서는 "커서 기반으로 동작한다"를 채운다 (CR-019, DEV-075)
  - [ ] 마지막 페이지에서 `next_cursor`가 null이다 (FR-SRCH-008 AC-1)
  - [ ] `size` 200 초과가 절삭된다 (AC-2)
  - [ ] 질의 변경 후 이전 커서가 400을 낸다 (AC-3)
  - [ ] 오프셋 파라미터가 API에 존재하지 않는다 (AC-4, ADR-010)
  - [ ] 패싯 건수 합계가 목록 총 건수와 정합한다 (FR-SRCH-009 AC-3)
  - [ ] 패싯 실패가 목록을 막지 않는다 (예외 처리)
  - [ ] 제목 일치가 본문 일치보다 상위다 (FR-SRCH-011 AC-2)
  - [ ] 한글·영문 혼용 질의에서 두 언어 토큰이 매칭된다 (AC-4)
- 검증 방법: `pnpm test:integration search/facets`, `pnpm test:e2e search-paging`
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
- 검증 방법: `pnpm test:integration saved-search`, `pnpm test:e2e saved-search`
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
- 검증 방법: `pnpm test web/repositories`, `pnpm test:a11y repositories`
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
- 검증 방법: `pnpm test:integration reindex`
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
- 검증 방법: `pnpm test:integration archive`, 수동 Filebeat 중단·재기동 시나리오
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
- 검증 방법: `pnpm test:integration analytics`, `pnpm test:perf analytics`
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
- 검증 방법: `pnpm test web/analytics`, `pnpm test:e2e flow-005`, `pnpm test:a11y analytics`
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
- 검증 방법: `pnpm test:integration audit`, `pnpm test:e2e audit`
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
- 검증 방법: `pnpm test web/ops`, `pnpm test:e2e flow-007 flow-008`, `pnpm test:a11y ops`
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
- 검증 방법: `pnpm test:integration safe-marker`, `pnpm test:e2e safe-marker`
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
- 검증 방법: `pnpm test:integration bisect`, `pnpm test:e2e flow-004`
- 기록: 원장 WP-042 상태, FR-SEQ-007 매핑

### WP-043 관계 그래프 API와 W-007

> 조건부 WP. REL-004의 ACC-06(관계 간선 정확도 표본 200건 검수 95% 이상)을 충족할 때만 착수한다.

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
- 검증 방법: `pnpm test:integration relation/graph`, `pnpm test:a11y graph`
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
- 검증 방법: `pnpm test:integration export`, `pnpm test:e2e export`
- 기록: 원장 WP-044 상태, FR-SRCH-012 매핑

### WP-045 gh capability 레지스트리와 parity 검증기

- 목표: 고정 gh 버전의 전 command와 flag가 분류된 검증 가능한 manifest가 선다.
- 관련 요구사항: FR-GH-001, FR-GH-011, NFR-009
- 관련 화면/플로우: A-006
- 관련 API/데이터/잡: API-GH-001 / ENT-GH-006 / JOB-GH-003
- 선행 WP: WP-001
- 구현 범위:
  - `packages/gh-cli` 신규: `GhCapability` 타입, manifest 스키마, 로더
  - `pnpm gh:inventory`: 설치된 gh를 걸어 command path·positional·flag·JSON 필드 추출
  - 의미 오버라이드 파일: conflicts / requires / oneOf, 반복 가능, 열거값, 자원 선택자, 위험도, 필요 권한, 비밀 여부, 확인 필요, 파일·stdin 입력, 출력 종류
  - `pnpm gh:validate-capabilities`: 스키마 검증 + 분류 커버리지 계산 + 미분류 시 종료 코드 1
  - `pnpm gh:diff-capabilities`: 설치 gh와 커밋된 manifest의 차이 출력
  - manifest 버전·해시 생성과 `gh_capability_snapshot` 기록 (마이그레이션 009)
  - CI에 드리프트 검출 잡 추가
- 제외:
  - UI (WP-048)
  - 실행 (WP-047)
- 완료 기준(DoD):
  - [ ] `pnpm gh:inventory`가 설치된 gh에서 command node와 flag를 추출한다
  - [ ] `pnpm gh:validate-capabilities`가 command path 분류 100%, flag 분류 100%를 확인한다
  - [ ] 미분류 항목을 하나 만들면 검증기가 종료 코드 1로 실패한다
  - [ ] manifest에 없는 command를 gh가 갖고 있으면 `gh:diff-capabilities`가 검출한다
  - [ ] manifest 해시가 내용 변경 시 달라진다
- 검증 방법: `pnpm gh:inventory && pnpm gh:validate-capabilities && pnpm test gh-cli`
- 기록: 원장 WP-045 상태, FR-GH-001·FR-GH-011 매핑, 측정한 gh 버전과 command·flag 수

### WP-046 위임 GitHub 신원과 Operations App

- 목표: 사용자를 대신하는 GitHub 자격 증명이 수집용과 분리되어 안전하게 관리된다.
- 관련 요구사항: FR-GH-008
- 관련 화면/플로우: A-007
- 관련 API/데이터/잡: API-GH-007 / ENT-GH-001 / JOB-GH-004
- 선행 WP: WP-012
- 구현 범위:
  - 마이그레이션 006: `github_identity_connection` (토큰 원문 없음, 비밀 저장소 참조만)
  - GitHub App user authorization 흐름 (인가 시작·콜백·연결 해제)
  - 비밀 저장소 연동: 토큰 저장·조회·폐기
  - 권한 교집합 판정: Operations App 권한 ∩ 사용자 GitHub 권한
  - JOB-GH-004 토큰 갱신, 만료·철회 처리
  - A-007의 연결 상태 표시
- 제외:
  - 실행 경로 (WP-047)
  - 권한별 UI 표현 (WP-048)
- 완료 기준(DoD):
  - [ ] 사용자가 Operations App을 인가하면 연결이 생기고 토큰 원문이 DB에 없다
  - [ ] 사용자에게 없는 저장소 권한의 작업이 권한 판정에서 거부된다
  - [ ] 설치 권한이 더 넓어도 사용자 권한을 넘는 작업이 허용되지 않는다
  - [ ] 토큰 만료 시 갱신되고, 갱신 실패 시 재인가를 요구한다
  - [ ] 연결 해제 시 비밀 저장소의 토큰이 폐기된다
- 검증 방법: `pnpm test:integration gh-identity`
- 기록: 원장 WP-046 상태, FR-GH-008 매핑

### WP-047 격리 gh 실행기와 실행 수명주기

- 목표: gh 명령이 격리된 실행기에서 안전하게 실행되고 진행 상황과 취소가 동작한다.
- 관련 요구사항: FR-GH-002, FR-GH-006, NFR-010, NFR-011
- 관련 화면/플로우: 없음 (W-010이 소비)
- 관련 API/데이터/잡: API-GH-002, API-GH-005, API-GH-011 / ENT-GH-002 / JOB-GH-001, JOB-GH-007
- 선행 WP: WP-045, WP-046
- 구현 범위:
  - `apps/gh-executor` 신규 배포 단위 (비루트, 읽기 전용 루트 FS, 고정 gh 바이너리)
  - argv 조립: manifest + 타입 있는 입력 → argv 배열. shell 미경유
  - 실행별 임시 workspace (TTL, 할당량), `GH_CONFIG_DIR`·`HOME` 격리
  - 자격 증명 주입과 즉시 폐기, headless 환경 설정
  - 마이그레이션 007: `gh_execution`(월별 파티션), `gh_execution_lock`
  - 수명주기 10개 상태, 타임아웃, 출력 상한, 프로세스 그룹 취소
  - SSE 스트리밍 (API-GH-005)
  - JOB-GH-007 고아 실행 회수
- 제외:
  - capability UI (WP-048)
  - Recipe (WP-058)
  - 로컬 git workspace 심화 (WP-057)
- 완료 기준(DoD):
  - [ ] `gh pr list` 같은 R0 명령이 실행되고 결과가 반환된다
  - [ ] shell 메타문자가 포함된 입력이 명령으로 해석되지 않는다
  - [ ] 타임아웃 초과 실행이 `timed_out`으로 종료된다
  - [ ] 취소 요청이 3초 내 프로세스 그룹을 종료시킨다
  - [ ] 출력 상한 초과 시 절삭 사실과 함께 잘린다
  - [ ] 실행 종료 후 workspace와 토큰이 남지 않는다
  - [ ] 실행기 파드를 강제 종료하면 JOB-GH-007이 해당 실행을 `failed`로 회수한다
- 검증 방법: `pnpm test:integration gh-exec`
- 기록: 원장 WP-047 상태, FR-GH-002·FR-GH-006 매핑, NFR-010·NFR-011 매핑

### WP-048 W-010 GitHub Command Center 수직 슬라이스

- 목표: 사용자가 웹에서 capability를 골라 실행하고 결과와 이력을 볼 수 있다. Operations Plane의 첫 사용자 가치다.
- 관련 요구사항: FR-GH-003, FR-GH-009, FR-GH-012, FR-GH-007
- 관련 화면/플로우: W-010, W-021
- 관련 API/데이터/잡: API-GH-002, API-GH-003, API-GH-006, API-GH-010, API-GH-012 / ENT-GH-002, ENT-GH-005
- 선행 WP: WP-047
- 구현 범위:
  - W-010: GitHub 컨텍스트, capability 검색, GenericCommandForm, 실행 미리보기, 실행 패널
  - flag 타입별 컨트롤 생성 (Conductor 프리미티브만)
  - 제약 검증 (클라이언트 + 서버 재검증)
  - 권한 미리보기와 위험도 미리보기
  - 정확한 argv 미리보기 (비밀 마스킹). 미리보기와 실제 argv는 같은 모델에서 파생
  - 위험도 게이트: R0 즉시, R1 미리보기, R2 확인, R3 강한 확인 + 승인 (마이그레이션 009 `gh_approval`)
  - R2 이상 실행 직전 대상 상태 재조회
  - 중복 방지 키와 자원 잠금
  - 감사 선기록
  - W-021 실행 이력 조회·재실행·아티팩트 내려받기
  - 초기 개방 범위는 R0 읽기 전용 capability
- 제외:
  - 업무 전용 화면 (WP-049~WP-056)
  - Recipe (WP-058)
  - 정책 관리 화면 (WP-059)
- 완료 기준(DoD):
  - [ ] 저장소를 고르고 R0 capability를 골라 옵션을 넣고 실행될 argv를 확인한 뒤 실행해 결과를 볼 수 있다
  - [ ] 제약을 위반하는 조합에서 실행 버튼이 활성화되지 않고, 서버도 같은 조합을 거부한다
  - [ ] 미리보기 argv와 실제 실행 argv가 일치한다
  - [ ] R2 capability는 확인 없이 실행되지 않는다
  - [ ] 대상 상태를 실행 직전에 바꾸면 R2 실행이 `GH_TARGET_CHANGED`로 중단된다
  - [ ] 같은 요청을 두 번 보내면 실행이 하나만 생성된다
  - [ ] 감사 기록에 실패하면 쓰기 실행이 시작되지 않는다
  - [ ] 실행 이력에서 동일 구성으로 재실행할 수 있다
- 검증 방법: `pnpm test:integration gh-command`, `pnpm test:e2e gh-command-center`
- 기록: 원장 WP-048 상태, FR-GH-003·FR-GH-009·FR-GH-012 매핑

### WP-049 PR 작업 (W-011)

- 목표: PR 대상 작업을 업무 화면에서 수행한다. 첫 쓰기 capability 개방이다.
- 관련 요구사항: FR-GH-004, FR-GH-009
- 관련 화면/플로우: W-011, W-002
- 관련 API/데이터/잡: API-GH-002, API-GH-003
- 선행 WP: WP-048
- 구현 범위:
  - W-011: PR 목록·상세에서 적용 가능한 작업 제시
  - `gh pr` 하위 명령 전체를 capability로 노출 (생성·목록·조회·상태·체크·차이·편집·코멘트·리뷰·준비/초안·브랜치 갱신·닫기·재개·머지·되돌리기·잠금·체크아웃)
  - 머지 폼: 전략, 자동 머지, 관리자 강제, head 커밋 일치, 커밋 제목·본문, 브랜치 삭제
  - W-002 PR 상세에서 W-011로 진입
  - R1·R2 위험도 부여와 확인 흐름
- 제외:
  - Issue·Discussion (WP-050)
  - 체크아웃이 요구하는 로컬 workspace (WP-057)
- 완료 기준(DoD):
  - [ ] PR 머지가 전략 선택과 함께 실행된다
  - [ ] `--match-head-commit`이 실제 head와 다르면 GitHub이 거부하고 그 사유가 표시된다
  - [ ] 머지 확인 없이 실행되지 않는다
  - [ ] 같은 PR에 머지를 두 번 요청하면 두 번째가 `GH_RESOURCE_LOCKED` 또는 중복으로 처리된다
  - [ ] 권한 없는 사용자의 머지가 `GH_PERMISSION_DENIED`로 거부된다
- 검증 방법: `pnpm test:integration gh-pr`, `pnpm test:e2e pr-operations`
- 기록: 원장 WP-049 상태, FR-GH-004 매핑

### WP-050 Issue·Discussion 작업 (W-012)

- 목표: 이전 판에서 범위 밖이던 Issue와 Discussion을 작업 대상으로 편입한다.
- 관련 요구사항: FR-GH-004
- 관련 화면/플로우: W-012
- 관련 API/데이터/잡: API-GH-002, API-GH-003
- 선행 WP: WP-048
- 구현 범위:
  - W-012: Issue 생성·조회·목록·상태·편집·코멘트·닫기·재개·삭제·잠금·고정·이관·개발 브랜치·하위 이슈
  - Discussion 생성·목록·조회·코멘트·편집
  - GHE 버전이 미지원이거나 preview면 사유 표시
- 제외:
  - Project 연동 (WP-053)
- 완료 기준(DoD):
  - [ ] Issue를 만들고 코멘트를 달고 닫을 수 있다
  - [ ] Discussion이 대상 GHE에서 preview 또는 미지원이면 그 사유가 화면에 표시된다
  - [ ] 삭제는 R3로 분류되어 강한 확인을 요구한다
- 검증 방법: `pnpm test:integration gh-issue`
- 기록: 원장 WP-050 상태, FR-GH-004 매핑

### WP-051 저장소 작업 (W-013)

- 목표: 저장소 수준 작업을 수행한다. 파괴적 작업이 다수 포함된다.
- 관련 요구사항: FR-GH-004, FR-GH-009
- 관련 화면/플로우: W-013, W-009
- 관련 API/데이터/잡: API-GH-002 / ENT-GH-002
- 선행 WP: WP-048, WP-057
- 구현 범위:
  - W-013: 조회·목록·생성·클론·포크·동기화·편집·이름 변경·보관·해제·삭제·배포 키·오토링크·파일 읽기
  - 삭제·이름 변경·가시성 변경을 R3로 분류
  - 로컬 git이 필요한 명령은 임시 workspace에서 수행 (WP-057)
- 제외:
  - 설정·보안 영역 (WP-054)
- 완료 기준(DoD):
  - [ ] 저장소 조회·편집이 동작한다
  - [ ] 삭제·이름 변경이 강한 확인과 정책에 따른 승인을 거친다
  - [ ] 클론이 서버의 실제 소스 트리가 아니라 임시 workspace에서 수행된다
- 검증 방법: `pnpm test:integration gh-repo`
- 기록: 원장 WP-051 상태, FR-GH-004 매핑

### WP-052 Actions·워크플로·실행·캐시 (W-014)

- 목표: GitHub Actions를 1급 UI로 제공한다. 실행 로그 스트리밍이 핵심이다.
- 관련 요구사항: FR-GH-004, FR-GH-006
- 관련 화면/플로우: W-014
- 관련 API/데이터/잡: API-GH-002, API-GH-005
- 선행 WP: WP-048
- 구현 범위:
  - W-014: 워크플로 목록·조회·활성화·비활성화·수동 실행
  - 실행 목록·조회·감시·재실행·취소·삭제, 아티팩트 내려받기
  - 캐시 목록·삭제
  - 실행 로그 스트리밍 UI
  - 워크플로 수동 실행 입력을 워크플로 스키마에서 읽어 타입 있는 컨트롤로 표시
- 제외:
  - Release (WP-053)
- 완료 기준(DoD):
  - [ ] 워크플로를 수동 실행하고 입력이 타입 있는 컨트롤로 표시된다
  - [ ] 실행 로그가 진행 중 스트리밍된다
  - [ ] 재실행·취소가 R2 확인을 거친다
  - [ ] 아티팩트를 내려받을 수 있다
- 검증 방법: `pnpm test:integration gh-actions`, `pnpm test:e2e workflow-run`
- 기록: 원장 WP-052 상태, FR-GH-004 매핑

### WP-053 릴리스·프로젝트 작업 (W-015, W-016)

- 목표: 릴리스와 프로젝트 작업을 제공한다. 파일 업로드·내려받기가 포함된다.
- 관련 요구사항: FR-GH-004, FR-GH-007
- 관련 화면/플로우: W-015, W-016
- 관련 API/데이터/잡: API-GH-002, API-GH-006
- 선행 WP: WP-048, WP-057
- 구현 범위:
  - W-015: 릴리스 생성·조회·목록·편집·삭제, 자산 업로드·내려받기·삭제·검증
  - W-016: 프로젝트 생성·조회·목록·편집·복사·닫기·재개, 필드·항목 관리, 연결·해제
  - 파일 업로드 크기 상한과 아티팩트 보존
- 제외:
  - Recipe 조합 (WP-058)
- 완료 기준(DoD):
  - [ ] 릴리스를 만들고 자산을 업로드·내려받을 수 있다
  - [ ] 업로드 파일이 실행 후 workspace에서 제거된다
  - [ ] 프로젝트 항목 관리가 동작한다
- 검증 방법: `pnpm test:integration gh-release`
- 기록: 원장 WP-053 상태, FR-GH-004 매핑

### WP-054 시크릿·변수·레이블·룰셋·키 (W-018)

- 목표: 비밀 값을 다루는 작업을 별도 보안 정책 아래 제공한다.
- 관련 요구사항: FR-GH-004, FR-GH-009, NFR-010
- 관련 화면/플로우: W-018
- 관련 API/데이터/잡: API-GH-002 / ENT-GH-005
- 선행 WP: WP-048
- 구현 범위:
  - W-018: `secret`, `variable`, `label`, `ruleset`, `gpg-key`, `ssh-key`
  - 비밀 값은 stdin 또는 제한된 임시 파일로 전달. argv 금지
  - 비밀 값 재표시 없음. 미리보기에서 `<redacted>`
  - 전 항목 R3 분류와 승인 정책
- 제외:
  - 정책 관리 화면 (WP-059)
- 완료 기준(DoD):
  - [ ] 시크릿을 설정할 수 있고 값이 argv·URL·로그·이력·감사 어디에도 남지 않는다
  - [ ] 설정한 시크릿 값을 화면에서 다시 볼 수 없다
  - [ ] R3 확인·승인 없이 실행되지 않는다
- 검증 방법: `pnpm test:integration gh-secret`
- 기록: 원장 WP-054 상태, FR-GH-004 매핑

### WP-055 Codespace·Gist·Attestation·고급 도구 (W-017, W-019, W-022)

- 목표: 나머지 core 영역을 제공하고, 터미널 전용 기능을 분류해 노출한다.
- 관련 요구사항: FR-GH-004, FR-GH-013
- 관련 화면/플로우: W-017, W-019, W-022
- 관련 API/데이터/잡: API-GH-001, API-GH-002
- 선행 WP: WP-048
- 구현 범위:
  - W-017: Codespace 생성·목록·조회·중지·삭제·재빌드·포트·로그
  - W-019: `gh search`, `gh org`, `gh status`
  - W-022: Gist, Attestation, Skill, Agent-task, Extension 탐색, `licenses`
  - 대화형 기능(`ssh`, `code`, `jupyter`, `cp`)을 웹 등가·격리 workspace·`terminal_only` 중 하나로 분류
  - 확장은 탐색·메타데이터만. 실행은 기본 차단
- 제외:
  - 확장 허용 목록 관리 (WP-059)
- 완료 기준(DoD):
  - [ ] Codespace 비대화형 작업이 동작한다
  - [ ] 대화형 기능이 사유와 함께 분류되어 표시되고 숨겨지지 않는다
  - [ ] 확장 실행이 기본 차단되고 `policy_blocked`으로 표시된다
- 검증 방법: `pnpm test:integration gh-advanced`
- 기록: 원장 WP-055 상태, FR-GH-004 매핑

### WP-056 gh API 탐색기 (W-020)

- 목표: gh api를 command와 동일한 정책 아래 제공한다. 정책 우회 통로가 되면 안 된다.
- 관련 요구사항: FR-GH-010
- 관련 화면/플로우: W-020
- 관련 API/데이터/잡: API-GH-009
- 선행 WP: WP-048
- 구현 범위:
  - W-020: 엔드포인트, 메서드, 필드, 원시 필드, 헤더, 페이지네이션, 미리보기, 필터, 템플릿, 본문·파일
  - 인증·라우팅 헤더 override 차단
  - 대상 호스트를 구성된 GHE로 고정
  - 쓰기 메서드에 위험도 정책 적용
  - 엔드포인트 허용·차단 목록 평가
- 제외:
  - 정책 편집 UI (WP-059)
- 완료 기준(DoD):
  - [ ] REST와 GraphQL 요청이 실행된다
  - [ ] `Authorization`·`Host`·`Cookie` 헤더를 지정하면 거부된다
  - [ ] 구성된 호스트 밖 요청이 거부된다
  - [ ] 쓰기 메서드가 위험도 확인을 거친다
  - [ ] 차단 목록의 엔드포인트가 `GH_ENDPOINT_BLOCKED`로 거부된다
- 검증 방법: `pnpm test:integration gh-api-explorer`
- 기록: 원장 WP-056 상태, FR-GH-010 매핑

### WP-057 임시 workspace와 로컬 git 작업

- 목표: 로컬 git이나 파일이 필요한 명령을 격리된 임시 공간에서 수행한다.
- 관련 요구사항: FR-GH-007, NFR-010
- 관련 화면/플로우: 없음 (W-013, W-015가 소비)
- 관련 API/데이터/잡: API-GH-006 / JOB-GH-005, JOB-GH-006
- 선행 WP: WP-047
- 구현 범위:
  - 실행별 workspace 생성·할당량·TTL
  - clone / sync / checkout 계열 명령의 workspace 실행
  - 파일 업로드 입력과 생성 아티팩트 처리 (마이그레이션 007 `gh_execution_artifact`)
  - JOB-GH-005 고아 workspace 정리, JOB-GH-006 아티팩트 만료 정리
- 제외:
  - 웹 터미널 (범위 밖)
- 완료 기준(DoD):
  - [ ] clone이 서버의 실제 소스 트리를 건드리지 않는다
  - [ ] workspace가 실행 종료와 함께 폐기된다
  - [ ] 할당량 초과 시 실행이 시작되지 않는다
  - [ ] 고아 workspace가 정리 잡에서 회수된다
- 검증 방법: `pnpm test:integration gh-workspace`
- 기록: 원장 WP-057 상태, FR-GH-007 매핑

### WP-058 Recipe 빌더 (W-023)

- 목표: 등록된 capability만 조합하는 다단계 작업을 제공한다.
- 관련 요구사항: FR-GH-005
- 관련 화면/플로우: W-023, W-021
- 관련 API/데이터/잡: API-GH-004 / ENT-GH-003, ENT-GH-004 / JOB-GH-002
- 선행 WP: WP-049, WP-052, **WP-066** (CR-009)
- 구현 범위:
  - 마이그레이션 008: `gh_recipe`, `gh_recipe_revision`
  - W-023: 순차 단계, 타입 있는 입력 변수, 이전 단계 JSON 출력 바인딩, 조건, 팬아웃, 동시 실행 상한, 실패 정책
  - JOB-GH-002 단계 진행
  - R2 이상 단계 포함 시 전체 계획 확인
  - Recipe 개정 보존
  - **(CR-009) 비순환 typed DAG** — 순차 의존, 병렬 분기, 조건, join. 저장 시 순환 거부
  - **(CR-009) `GhBinding`** — 출발 단계·출력 port·도착 단계·도착 입력을 구조로. 표현식 없음
  - **(CR-009) 호환 capability 제안** — 현재 출력과 이을 수 있는 것을 먼저 보여준다. 호환되지 않는 연결은 저장 전 사유와 함께 거부
  - **(CR-009) 상한 있는 fan-out** — 최대 항목·동시성·위험도 집계·rate limit preflight. 상한 없으면 저장·실행 거부
  - **(CR-009) 아티팩트 바인딩** — 실행기 경로가 아니라 아티팩트 ID
  - **(CR-009) 자원 바인딩** — `GhResourceRef`로 잇는다. 문자열 재파싱 없음
  - **(CR-009) 동적 R2/R3 preflight** — 대상 집합 확정 → plan 해시 → 확인 → 실행. 확인 뒤 plan이 바뀌면 무효
- 제외:
  - 임의 shell·표현식 (영구 금지)
- 완료 기준(DoD):
  - [ ] 여러 단계를 조합한 Recipe가 저장·실행된다
  - [ ] manifest에 없는 capability를 단계에 넣을 수 없다
  - [ ] 임의 명령 문자열을 단계로 만들 수 없다
  - [ ] 실패 정책이 동작하고 앞선 단계를 자동으로 되돌리지 않는다
  - [ ] Recipe 개정이 보존된다
- 검증 방법: `pnpm test:integration gh-recipe`, `pnpm test:e2e recipe-builder`
- 기록: 원장 WP-058 상태, FR-GH-005 매핑

### WP-059 capability 드리프트와 정책 관리 (A-005, A-006)

- 목표: 관리자가 실행 정책과 capability 레지스트리를 운영할 수 있게 한다.
- 관련 요구사항: FR-GH-013, FR-GH-011, FR-GH-009
- 관련 화면/플로우: A-005, A-006
- 관련 API/데이터/잡: API-GH-001, API-GH-008 / ENT-GH-006
- 선행 WP: WP-045, WP-048
- 구현 범위:
  - A-006: manifest 버전·해시, gh 버전 대조, 분류 커버리지, 드리프트, 호스트 지원 상태
  - A-005: capability 허용·차단, 위험도 재정의, 승인 필요 지정, `gh api` 엔드포인트 정책, 확장 허용 목록
  - 드리프트 시 `registry_stale` / `execution_disabled` / `admin_action_required` 처리
  - 정책 변경의 감사 기록
- 제외:
  - parity 최종 검증 (WP-060)
- 완료 기준(DoD):
  - [ ] 설치 gh 버전과 manifest 버전이 다르면 새 command 실행이 차단된다
  - [ ] 관리자가 capability를 차단하면 사용자 화면에서 `policy_blocked`으로 표시된다
  - [ ] 확장 허용 목록에 추가한 확장만 실행된다
  - [ ] 정책 변경이 감사에 남는다
- 검증 방법: `pnpm test:integration gh-policy`
- 기록: 원장 WP-059 상태, FR-GH-013 매핑

### WP-060 전체 parity 검증

- 목표: 고정 gh 버전에 대한 완전 분류를 릴리스 게이트로 확정한다.
- 관련 요구사항: FR-GH-001, NFR-009
- 관련 화면/플로우: A-006
- 관련 API/데이터/잡: API-GH-001
- 선행 WP: WP-045 ~ WP-059, **WP-061, WP-062, WP-063, WP-064, WP-065** (CR-008)
- 구현 범위:
  - NFR-009가 정의한 전 차원 분류 최종 감사 (command path, alias, positional, command 고유 flag, inherited/global flag, short alias, 반복 가능 flag, interaction 모드, 입출력 모드, `--json` 필드)
  - WP-065의 조합 검증기 실행 결과 검수
  - 터미널 전용·정책 차단·호스트 미지원 분류의 사유 문구 검수
  - core / extension 커버리지 분리 리포트 산출과 릴리스 게이트 연결
- 제외:
  - 모든 조합의 실제 실행 (조합 폭발. NFR-009가 정의한 대로 스키마 표현 가능성으로 판정한다)
- 완료 기준(DoD):
  - [ ] NFR-009의 모든 분류율 지표가 100%다
  - [ ] 미분류 command·positional·flag·interaction 모드가 각각 0이다
  - [ ] 페어와이즈 조합 시험이 통과한다
  - [ ] 숨겨진 capability가 없다 — 미지원·차단도 사유와 함께 노출된다
  - [ ] core parity와 extension parity 수치가 분리 보고된다
- 검증 방법: `pnpm gh:validate-capabilities && pnpm test parity`
- 기록: 원장 WP-060 상태, FR-GH-001 매핑

### WP-061 의미 capability 제약 엔진

- 목표: 유효 조합의 정의가 한 곳에만 존재하고, 폼·서버·argv 빌더·테스트 생성기가 그것만 읽는다.
- 관련 요구사항: FR-GH-003, FR-GH-002, NFR-009
- 관련 화면/플로우: W-010
- 관련 API/데이터/잡: API-GH-002 / ENT-GH-006
- 선행 WP: WP-045
- 구현 범위:
  - `GhCapabilityConstraint` 스키마: `requires`, `conflicts`, `oneOf`, `exactlyOne`, `atLeastOne`, `implies`, `repeatable`, `minItems`, `maxItems`, 값 열거, 조건부 필수, 입력원 제약, 컨텍스트 의존 제약
  - `GhInvocation` 구조: capability ID, 컨텍스트, positional, flag, stdin 원본, 파일 바인딩, 출력 옵션
  - 제약 평가기 (순수 함수, 클라이언트·서버 공용)
  - 단일 argv 빌더 — 미리보기와 실행이 공유
  - 서버 측 실행 직전 재검증
- 제외:
  - 폼 렌더링 (WP-046)
  - 실행기 (WP-047)
- 완료 기준(DoD):
  - [ ] 13종 제약을 전부 표현하고 평가한다
  - [ ] 같은 invocation이 같은 manifest에서 항상 같은 argv를 만든다 (결정론)
  - [ ] 클라이언트 검증을 우회한 API 직접 호출이 서버에서 같은 사유로 거부된다
  - [ ] UI 판정과 서버 판정이 갈리면 시험이 실패한다
  - [ ] 미리보기 argv와 실행 argv가 같은 빌더에서 나온다 — 두 번째 빌더가 없음을 코드 검사로 확인한다
- 검증 방법: `pnpm test gh/constraint`, `pnpm test gh/argv`
- 기록: 원장 WP-061 상태, FR-GH-003 매핑

### WP-062 gh 출력·파일 안전 경계

- 목표: gh 출력과 파일이 사용자에게 닿기 전에 반드시 무해화 경계를 통과한다.
- 관련 요구사항: FR-GH-006, FR-GH-007, NFR-010
- 관련 화면/플로우: W-010, W-021
- 관련 API/데이터/잡: API-GH-005, API-GH-006 / ENT-GH-002-A
- 선행 WP: WP-047
- 구현 범위:
  - `SafeGhOutput` 경계: ANSI CSI·OSC 무해화, 제어 문자 처리, invalid UTF-8 치환, 바이트 상한, 바이너리 탐지
  - 스트리밍 청크 경계에서 분할된 escape 시퀀스 복원
  - 프런트엔드 안전 렌더러 (원시 HTML 금지)
  - workspace 경로 정규화·탈출 차단·symlink 차단
  - 아티팩트 ID 발급, 파일명 정규화, 할당량·TTL·부분 파일 정리
- 제외:
  - 터미널 색상 재현 (무해화 이후 구조화 표현으로 별도 판단)
- 완료 기준(DoD):
  - [ ] CSI·OSC·제어 문자가 포함된 출력이 무해화되어 전달된다
  - [ ] 청크 경계에서 잘린 escape 시퀀스도 무해화된다
  - [ ] gh 출력 렌더링 경로에 `dangerouslySetInnerHTML`이 0건이다 (코드 검사)
  - [ ] `..`·절대 경로·symlink로 workspace 밖 파일에 접근하려는 시도가 차단된다
  - [ ] 아티팩트가 파일시스템 경로 없이 ID로만 전달된다
  - [ ] 바이너리 출력이 텍스트로 렌더링되지 않는다
- 검증 방법: `pnpm test gh/safe-output`, `pnpm test:integration gh/workspace`
- 기록: 원장 WP-062 상태, NFR-010 매핑

### WP-063 interactive 웹 등가와 extension 신뢰 어댑터

- 목표: `terminal_only`가 마지막 분류가 되고, extension이 신뢰 경계 안에서만 실행된다.
- 관련 요구사항: FR-GH-013, FR-GH-001
- 관련 화면/플로우: W-022, A-005, A-006
- 관련 API/데이터/잡: API-GH-001, API-GH-008 / ENT-GH-005, ENT-GH-006
- 선행 WP: WP-045, WP-055
- 구현 범위:
  - interaction 분류기: `web_native`, `web_equivalent`, `sandbox_terminal`, `terminal_only`, `policy_blocked`, `unsupported_by_host`
  - 웹 등가 어댑터: `--web`·`gh browse` → URL 반환, editor → 웹 편집기, `gh auth` → Operations App 연결, `gh completion` → 스크립트 내려받기, `gh config` → 실행 단위 scoped profile
  - extension capability plane: 탐색·목록·메타데이터·출처·버전·pin·승인 상태 조회
  - extension 실행 게이트: 관리자 허용 목록 + 정확한 버전 pin + 강화 격리
  - core / extension 커버리지 분리 집계
- 제외:
  - 격리 웹 터미널 자체 구현 (별도 승인 필요. 없으면 `terminal_only`로 분류하고 사유 기록)
- 완료 기준(DoD):
  - [ ] 모든 command가 6종 interaction 분류 중 하나를 갖고 `unknown`이 0이다
  - [ ] 실행기에서 브라우저 프로세스를 띄우는 경로가 0건이다
  - [ ] 승인되지 않은 extension 실행이 차단되고, 그 존재와 사유는 UI에서 보인다
  - [ ] 버전 pin이 없는 extension 실행이 거부된다
  - [ ] core parity와 extension parity가 분리 집계된다
- 검증 방법: `pnpm test gh/interaction`, `pnpm test gh/extension`
- 기록: 원장 WP-063 상태, FR-GH-013 매핑

### WP-064 gh api 스키마 브리지와 호스트 capability 판정

- 목표: `gh api`가 원시 입력창이 아니라 타입 있는 폼이 되고, 호스트가 지원하지 않는 것을 미리 안다.
- 관련 요구사항: FR-GH-010, FR-GH-011
- 관련 화면/플로우: W-020, A-006
- 관련 API/데이터/잡: API-GH-009 / ENT-GH-002, ENT-GH-006
- 선행 WP: WP-056
- 구현 범위:
  - REST 스키마 브리지: 메서드·엔드포인트·경로 파라미터·질의·본문·헤더·페이지네이션·미리보기
  - GraphQL introspection 브리지: query·variables·operation·페이지네이션
  - 타입 폼 생성과 원시 모드 병행 (둘 다 같은 정책·위험도·감사 경로)
  - GHES 버전 기반 호스트 capability 판정과 `unsupported_by_host` 표기
- 제외:
  - GitHub 리소스 선택기 고도화 (WP-051 컨텍스트 해석 재사용)
- 완료 기준(DoD):
  - [ ] REST·GraphQL 각각 타입 폼이 스키마에서 생성된다
  - [ ] 원시 모드 요청도 타입 폼과 동일한 정책·감사 경로를 거친다
  - [ ] `Authorization`·`Host`·`Cookie` 등 보안 헤더 덮어쓰기가 거부된다
  - [ ] 쓰기 메서드에 command와 동일한 위험도·확인·승인이 적용된다
  - [ ] 호스트가 지원하지 않는 capability가 숨겨지지 않고 사유와 함께 표시된다
- 검증 방법: `pnpm test gh/api-bridge`, `pnpm test:integration gh/host-capability`
- 기록: 원장 WP-064 상태, FR-GH-010·FR-GH-011 매핑

### WP-065 조합 parity 검증기

- 목표: "모든 유효 조합 지원"을 데카르트 곱 없이 검증 가능한 형태로 만든다.
- 관련 요구사항: NFR-009, FR-GH-003
- 관련 화면/플로우: A-006
- 관련 API/데이터/잡: API-GH-001 / ENT-GH-006
- 선행 WP: WP-061, WP-063, WP-064
- 구현 범위:
  - 인벤토리 커버리지 검사 (실제 gh 바이너리 기준)
  - manifest 스키마 검증
  - 제약 속성 시험: 유효 조합의 argv 표현 가능성, 무효 조합의 서버 거부, UI·서버 판정 일치, argv 결정론
  - 유효/무효 조합 생성기
  - 페어와이즈 조합 시험
  - golden argv 시험
  - 커버리지 리포트 산출 (차원별, core/extension 분리)
- 제외:
  - 전 조합 실제 실행
- 완료 기준(DoD):
  - [ ] 사용자 입력이 command path를 바꿀 수 없음을 속성 시험이 증명한다
  - [ ] shell 메타문자가 shell 의미를 갖지 않음을 속성 시험이 증명한다
  - [ ] `shell: true` 사용 경로가 0건임을 코드 검사가 확인한다
  - [ ] 페어와이즈 조합 시험이 통과한다
  - [ ] 차원별 커버리지 리포트가 A-006이 소비할 형식으로 산출된다
- 검증 방법: `pnpm gh:validate-capabilities`, `pnpm test gh/parity`
- 기록: 원장 WP-065 상태, NFR-009 매핑

### WP-066 typed 결과 계약과 capability 그래프

- 목표: command의 출력에도 계약이 생기고, 어떤 명령을 이을 수 있는지 타입으로 계산된다.
- 관련 요구사항: FR-GH-001, FR-GH-005, NFR-009, NFR-010
- 관련 화면/플로우: W-023, A-006
- 관련 API/데이터/잡: API-GH-001, API-GH-004 / ENT-GH-006, ENT-GH-009, ENT-GH-010, ENT-GH-011
- 선행 WP: WP-045, WP-061
- 구현 범위:
  - `GhResultContract` 스키마: `kind`(json/resource/resource_list/url/artifact/text/stream/exit_status), `schema`, `resourceType`, `bindable`, `sensitivity`, `adapters`
  - 결과 sensitivity 분류: `public`/`internal`/`sensitive`/`secret`. `secret`은 표시·이력·바인딩·감사 본문·stdin 자동 전달 전부 차단
  - `GhResourceRef` 공통 타입과 자원 종류 확정
  - capability별 typed 입출력 port 선언
  - `GhBinding` 구조와 제한된 JSON Pointer 평가기 (표현식 해석기 없음)
  - `GhCapabilityGraph` 계산: 출력 port → 호환 입력 port 간선
  - result adapter 분류기: `native_json`/`gh_api_structured`/`resource_url`/`artifact`/`opaque_text`/`stream`/`exit_status`/`secret_non_bindable`
  - composability 상태 분류기 (`unknown` 금지)
  - `GhResultEnvelope` 통일 (SafeGhOutput 경계 통과값만)
- 제외:
  - Recipe 그래프 UI (WP-058)
  - 조합 커버리지 리포트 산출 (WP-065)
- 완료 기준(DoD):
  - [ ] 모든 capability가 결과 계약을 가지며 `unknown`이 0이다
  - [ ] `secret` 결과가 바인딩 대상으로 제안되지 않고, 저장 시도가 거부된다
  - [ ] 출력 port와 입력 port의 호환이 이름이 아니라 타입으로 계산된다
  - [ ] `gh search prs` → `gh pr checks` → `gh run rerun` 같은 연쇄가 그래프에서 자동으로 도출된다
  - [ ] `opaque_text` capability가 typed 바인딩 source로 선택되지 않고, 목록에서 숨겨지지도 않는다
  - [ ] 아티팩트 결과가 경로가 아니라 ID로 표현된다
  - [ ] `GhBinding` 평가에 표현식 해석기가 쓰이지 않음을 코드 검사로 확인한다
- 검증 방법: `pnpm test gh/result-contract`, `pnpm test gh/capability-graph`
- 기록: 원장 WP-066 상태, FR-GH-001·FR-GH-005 매핑

## 4. REL → WP 커버리지

| REL | WP | 개수 |
| --- | --- | --- |
| REL-001 | WP-001 ~ WP-010 | 10 |
| REL-002 | WP-011 ~ WP-019 | 9 |
| REL-003 | WP-020 ~ WP-028 | 9 |
| REL-004 | WP-029 ~ WP-036 | 8 |
| REL-005 | WP-037 ~ WP-040 | 4 |
| REL-006 | WP-041 ~ WP-044 | 4 |
| REL-007 | WP-045 ~ WP-048, WP-061, WP-062, WP-066 | 7 |
| REL-008 | WP-049 ~ WP-050 | 2 |
| REL-009 | WP-051 ~ WP-053, WP-057 | 4 |
| REL-010 | WP-054 ~ WP-056, WP-063, WP-064 | 5 |
| REL-011 | WP-058 ~ WP-060, WP-065 | 4 |
| 합계 | | 66 |

모든 REL이 WP로 분해되었고, 모든 WP가 최소 1개 FR을 참조한다.
