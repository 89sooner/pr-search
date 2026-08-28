# PR Search 작업 패키지

> 상태: review | 버전: v2.0 | 갱신일: 2026-08-28

## 1. 목적

구현 로드맵의 릴리스 슬라이스(REL)를 코딩 에이전트가 한 세션에서 완료·검증할 수 있는 작업 패키지(WP)로 분해한다. WP는 범위를 새로 만들 수 없으며, 모든 WP는 승인된 FR을 참조해야 한다.

## 2. WP 작성 규칙

- 1 WP = 1 에이전트 세션 규모. 구현과 검증이 한 번에 끝나는 크기로 자른다.
- FE/API/데이터/테스트를 관통하는 수직 슬라이스를 우선한다. 앱 셸·인프라 부트스트랩 WP는 예외적으로 수평일 수 있다.
- 선행 WP를 명시하고 순환 의존을 만들지 않는다.
- 완료 기준(DoD)은 체크 가능한 항목만 적는다. QA 체크리스트 항목 ID와 상태 매트릭스 항목을 **인용**하고 다시 서술하지 않는다.
- WP 완료 시 `pr_search_implementation_traceability.md`를 갱신한다.

## 3. WP 순서와 의존성

**이 표는 ID 순이 아니라 실행 순이다** (CR-043). WP-035가 WP-032보다 앞에 있는 것은 오타가 아니라 의존이다 — WP-032의 `edge_ngram` 활성화가 살아 있는 인덱스에 배포될 수 없고, 그것을 배포하는 기계가 WP-035다. **WP ID를 재번호화하지 않는다**: 안정 ID는 문서 전체가 인용하는 값이고, "번호가 뒤라서 나중"이라는 규칙은 이 저장소에 없다. 순서를 정하는 것은 의존이다.

| WP ID | 이름 | REL | 선행 WP | 상태 |
| --- | --- | --- | --- | --- |
| WP-001 | 워크스페이스와 공유 패키지 골격 | REL-001 | - | in_progress |
| WP-002 | PostgreSQL 스키마와 마이그레이션 | REL-001 | WP-001 | done |
| WP-003 | Elasticsearch 매핑과 인덱스 부트스트랩 | REL-001 | WP-001 | done |
| WP-004 | 웹훅 수신 게이트웨이 | REL-001 | WP-002 | done |
| WP-005 | EventBus 포트와 Redis Streams 어댑터 | REL-001 | WP-001 | done |
| WP-006 | GHE 클라이언트와 rate limit 관리 | REL-001 | WP-001 | done |
| WP-007 | 보강 워커 | REL-001 | WP-005, WP-006 | done |
| WP-008 | 투영 워커와 버전 조건부 업서트 | REL-001 | WP-003, WP-007 | done |
| WP-009 | 실패 대기열과 재처리 | REL-001 | WP-007, WP-008 | done |
| WP-010 | 저장소 등록 API와 파이프라인 지표 | REL-001 | WP-008 | done |
| WP-011 | 구조화 질의 파서 | REL-002 | WP-001 | done |
| WP-012 | 인증과 접근 범위 강제 | REL-002 | WP-002 | done |
| WP-013 | 검색 API 목록 조회 | REL-002 | WP-011, WP-012 | done |
| WP-014 | 식별자 해석 API | REL-002 | WP-013 | done |
| WP-015 | 웹 앱 셸과 Conductor 통합 | REL-002 | WP-001 | done |
| WP-016 | W-001 통합 검색 화면 | REL-002 | WP-013, WP-014, WP-015 | done |
| WP-017 | W-002 PR 상세 화면 | REL-002 | WP-015, WP-016 | done |
| WP-018 | W-003 커밋 상세 화면 | REL-002 | WP-015, WP-016 | done |
| WP-019 | 저장소 백필 잡 | REL-002 | WP-006, WP-008 | done |
| WP-020 | 커밋 그래프 접근 계층 | REL-003 | WP-006 | done |
| WP-021 | 시퀀스 증분 채번 | REL-003 | WP-002, WP-020 | done |
| WP-022 | 시퀀스 재채번과 에폭 | REL-003 | WP-021 | done |
| WP-023 | 앵커 정규화와 범위 조회 API | REL-003 | WP-021, WP-013 | done |
| WP-024 | 릴리스 수집과 포함 관계 | REL-003 | WP-021, WP-008 | done |
| WP-025 | W-004 범위 조사 화면 | REL-003 | WP-023, WP-015 | done |
| WP-026 | W-005 릴리스 화면과 구간 비교 | REL-003 | WP-024, WP-025 | done |
| WP-027 | 선행·후행 조회와 상세 화면 통합 | REL-003 | WP-023, WP-017, WP-018 | done |
| WP-028 | 정합성 점검과 조정 스캔 | REL-003 | WP-021, WP-019 | done |
| WP-067 | 커밋 메타데이터 보강 (JOB-MIR-002) | REL-003 | WP-020, WP-008 | done |
| WP-068 | 저장소 팀 접근 범위 채우기 | REL-003 | WP-010, WP-012 | done |
| WP-029 | 관계 간선 인덱스와 참조 추출 | REL-004 | WP-008, WP-003, **WP-067** | done |
| WP-030 | 되돌림·체리픽·스택 관계 파생 | REL-004 | WP-029, WP-020, **WP-067** | done |
| WP-031 | 관계 조회 API와 상세 화면 관계 섹션 | REL-004 | WP-030, WP-017, WP-016 | done |
| WP-035 | 무중단 재색인 | REL-004 | WP-003, WP-008 | done |
| WP-032 | 패싯·커서 페이지네이션·전문 검색 | REL-004 | WP-013, WP-016, **WP-035** | done |
| WP-033 | 저장된 검색 | REL-004 | WP-013, WP-016 | done |
| WP-034 | W-009 저장소 개요 화면 | REL-004 | WP-010, WP-028 | done |
| WP-036 | 원본 아카이브 레인(Filebeat) | REL-004 | WP-004 | done |
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
  - [~] QA-W001-01 ~ QA-W001-13, QA-W001-22, QA-W001-23이 통과한다 — 화면 몫은 전부 통과. 08·09·10·13·23은 **서버가 판정**하고 WP-012·WP-013이 이미 검증했다 (원장 6.16장)
  - [x] **QA-W001-14는 절반만** — "페이지 번호 UI가 없다"는 여기서, "커서 기반으로 동작한다"는 WP-032 (CR-019, DEV-075)
  - [x] 상태 매트릭스 W-001의 모든 상태에 대응하는 컴포넌트 테스트가 있다 — **13종 전부**
  - [x] 필터를 5회 조작한 뒤 뒤로가기 1회로 이전 화면에 돌아간다 — 실제 브라우저에서 확인
  - [x] URL을 복사해 새 탭에 붙여넣으면 동일 화면이 재현된다 (QA-COMMON-09)
  - [x] axe 위반 0건 — 13종 상태 각각에서 0건, `checkContrast` 80쌍 실패 0건
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
  - 타임라인 단계는 `done`/`done_at_unknown`/`pending`/`out_of_scope`를 구분한다 — 승인은 시각을 모르고 릴리스는 WP-024다 (CR-020, DEV-084)
  - 리뷰 상태는 "승인함 / 아직 아님"까지만 — "변경 요청"은 데이터가 없다 (CR-020, DEV-085)
  - GHE 링크는 `GHE_BASE_URL`로 만들고 **미구성이면 버튼을 그리지 않는다** (CR-020, DEV-086)
  - **`repository_archived`·`files_truncated` 표시** — 파이프라인이 채우는데 어느 화면도 보여 주지 않던 것을 여기서 연다 (CR-020, DEV-089)
  - 딥링크 `/pr/[owner]/[repo]/[number]`. **번호는 앞자리 0이 없는 양의 정수만** 받고, 그 밖은 조회 없이 `not_found`를 보인다 — 문구는 접근 범위 밖과 같아야 한다 (FR-AUTH-002 AC-4)
- 제외:
  - 선행·후행 데이터 (WP-027), 관계 (WP-031), 릴리스 (WP-024), 동시 변경 (WP-031)
  - `epoch_stale` 상태 — 지금 도달할 수 없어 만들지 않는다. WP-021이 시퀀스와 함께 정한다 (CR-020, DEV-087)
- 완료 기준(DoD):
  - [x] QA-W002-01, QA-W002-02, QA-W002-15, QA-W002-18이 통과한다
  - [x] **QA-W002-03은 절반만** — "절삭 표시"는 여기서, "전체 건수"는 `EVT-ING-002` 확장 뒤 (CR-020, DEV-082)
  - [x] **QA-W002-17도 절반만** — "확장 전에 조회하지 않는다"는 여기서, "확장하면 조회한다"는 WP-031 (CR-020, DEV-088)
  - [x] 상태 매트릭스 W-002의 `loading_initial`, `ready`, `enrichment_pending`, `truncated`, `not_found` 상태가 렌더링된다
  - [x] 미머지 PR에서 선행·후행 섹션이 숨겨지지 않고 비활성 + 사유로 표시된다 (QA-W002-07)
  - [x] axe 위반 0건
- 검증 방법: `pnpm test web/pr`, `pnpm test:e2e flow-002`, `pnpm test:a11y pr`
- 기록: 원장 WP-017 상태

### WP-018 W-003 커밋 상세 화면

- 목표: 커밋 SHA에서 소속 PR로 이어지는 역추적 경로를 완성한다.
- 관련 요구사항: FR-SRCH-002
- 관련 화면/플로우: W-003 / FLOW-002
- 관련 API/데이터/잡: API-SRCH-002
- 선행 WP: WP-015, WP-016
- 구현 범위:
  - `C-024 ShaChip` (12자 표시, 전체 40자 복사, `aria-live` 복사 **성공·실패** 알림 — 조용한 실패 금지, CR-021 DEV-096)
  - `C-025 ChangedPathList` — 골격과 사유만. `totalCount`는 널 허용이고 `null`을 `0`으로 그리지 않는다 (CR-021, DEV-094). **파일 내용 미표시는 지금 세운다** (`QA-W003-08`, 금지 규칙)
  - 소속 PR 섹션, 역할 배지(`merge_commit`/`source_commit`/`direct_push` — **셋째는 WP-021 전까지 도달하지 않는다**, DEV-061·093)
  - `no_sequence`(원본 커밋) 상태를 오류가 아닌 설명 + 머지 커밋 링크로 표시. **역할로 판정한다** — 시퀀스 값은 전부 `null`이라 근거가 되지 못한다 (CR-021, DEV-092)
  - `multi_pr` 상태 목록 표시
  - **헤더는 축약 SHA를 표시명으로 쓴다.** 메시지·작성자·시각은 커밋 문서에 없고(DEV-060) **소속 PR에서 빌려오지 않는다** (CR-021, DEV-090)
  - `W-003-SEQPOS` 섹션 골격 (데이터는 WP-027)
  - 딥링크 `/commit/[owner]/[repo]/[sha]`
  - `API-SRCH-002`의 `pull_requests[]`에 `merge_commit_sha` 추가 (CR-021, DEV-091 — 없으면 `no_sequence`의 복구 경로가 성립하지 않는다)
  - **화면 라우트의 세션 확인을 공통 함수로 묶는다** — 네 번째 화면이 서면서 복제가 넷이 된다 (WP-017이 여기로 넘긴 일)
- 제외:
  - 시퀀스 위치 데이터 (WP-027), 릴리스 (WP-024), 관계 (WP-031)
  - 커밋 메타데이터(메시지·작성자·부모 SHA·변경 경로) — WP-020
- 완료 기준(DoD):
  - [x] QA-W003-01, QA-W003-02, QA-W003-04 ~ QA-W003-08이 통과한다
  - [x] **QA-W003-03은 절반만** — "PR이 없을 때 사유를 표시한다"는 여기서, "**직접 푸시**로 표시한다"는 `role: 'direct_push'`가 도달하는 WP-021 뒤 (CR-021, DEV-093 / DEV-061)
  - [x] 상태 매트릭스 W-003의 전 상태가 렌더링된다 (`no_pr`의 `direct_push` 갈래는 도달 불가 — 매핑은 있고 시험은 합성 입력으로 건다)
  - [x] FLOW-002 전 경로(SHA 입력 → 커밋 상세 → PR 상세)가 E2E로 통과한다 — **이 항목을 쓰다가 DEV-097을 찾았다**
  - [x] axe 위반 0건
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
  - **`GitHubClient.listPullRequestsPaged`** — 없던 메서드다. **정렬은 `updated asc` 고정** (CR-022, DEV-098): 기본값 `created desc`면 백필 도중 갱신된 PR이 페이지를 밀어 항목이 조용히 건너뛰어진다
  - 저장소 단위 백필: PR 목록 페이지네이션 → 보강 → 투영
  - `job.cursor`에 진행 지점 저장, 중단 후 재개
  - 진행률 30초 이내 갱신 (`done`/`total`/`unit`)
  - **잡은 이벤트가 아니라 `job` 행으로 지시하고 워커가 원자적으로 claim한다** (CR-022, DEV-101)
  - 동시 실행 상한 기본 3 (`BACKFILL_MAX_CONCURRENCY`). **세는 것과 잡는 것을 한 트랜잭션에** 둔다 (CR-022, DEV-102)
  - 실시간보다 낮은 우선순위 (GHE 토큰 배분, 워커 풀 분리)
  - 백필 문서의 `document_version`은 **엔티티의 `updated_at`** — 지금 시각을 쓰면 실시간을 덮어쓴다 (CR-022, DEV-099)
  - 합성 델리버리 ID `backfill:{repository_id}:{pr_number}` — 결정론적이고 출처를 밝힌다 (CR-022, DEV-100)
  - 개별 PR 실패는 목록으로 보고하고 잡을 중단하지 않음
  - `GET/POST/PATCH /admin/jobs` (조회·실행·중단). `PATCH`는 `cancel`·`pause`·`resume`만 받는다 (CR-022, DEV-103)
  - API 한도 대기는 `paused`가 아니라 `running` + `progress.waiting_until` (CR-022, DEV-104)
  - 백필 중 해당 인덱스 `refresh_interval`을 `30s`로 두고 복원. **시작 시 무조건 기본값으로 되돌린 뒤 올린다** — 앞선 잡이 죽어 남긴 것을 치운다 (CR-022, DEV-105)
- 제외:
  - A-003 화면 (WP-040)
  - 시퀀스 채번 (WP-021)
- 완료 기준(DoD):
  - [~] QA-A003-05, QA-A003-06이 통과한다 — **06(재개)은 CI 통과**, **05(우선순위)는 구조로만 세웠다**(모든 백필 호출이 `priority: 'backfill'`, 워커 풀 분리). 실제 지연 영향은 운영 규모 측정이 필요하다
  - [ ] 백필 실행 중 실시간 수집 지연 p95가 10초를 유지한다 (FR-ING-006 AC-3) — **NOT RUN**, 부하 harness 부재 (DEV-058과 같은 형태)
  - [x] 중단 후 재개 시 마지막 커서부터 이어진다 (AC-4) — CI 통과 (`24c1fdb`)
  - [x] 백필 문서가 더 새로운 실시간 문서를 덮어쓰지 않는다 (AC-5) — CI 통과. **처음 시험은 거짓 통과였다** — 씨앗 문서를 `_routing` 없이 넣어 조건부 업서트가 없어도 통과했다. 라우팅을 맞춰 실제로 조건부 업서트가 판정하게 고쳤다
  - [x] 동시 실행 4개 요청 시 3개만 실행된다 (AC-6) — CI 통과 + **로컬 실측**. **처음 구현은 이것을 전혀 지키지 못했다**(상한 3에 다섯이 돌았다, DEV-107). 세기 전에 유형 단위 advisory lock을 잡아야 성립한다
  - [x] API 한도 소진 시 잡이 대기하고 회복 시각에 자동 재개된다 (예외 처리) — CI 통과

  판정 근거: CI run 55 (`24c1fdb`) 통합 **32파일 419건 전부 통과**. AC-6은 그와 별개로 이 환경의 네이티브 PostgreSQL 16.13에서 `packages/db/integration/job-claim.test.ts` 6건으로 직접 확인했다 — 수정을 되돌리면 2건이 실패하는 것까지 양방향으로 봤다.
- 검증 방법: `pnpm test:integration jobs/backfill`, `pnpm test:integration packages/db/integration/job-claim.test.ts` (ES 없이 돈다)
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
  - [x] `MirrorCommitGraph.firstParentRevList`가 `git rev-list --first-parent --reverse`와 동일한 결과를 낸다 — **실제 git 픽스처로 대조**(병합 커밋·직접 푸시 혼재). 전 구간·부분 구간 모두 일치
  - [x] `ApiCommitGraph`가 같은 픽스처에서 `MirrorCommitGraph`와 동일한 체인을 만든다 (ADR-005)
  - [x] blobless 클론에 파일 blob이 없다 (THR-015) — 커밋·트리 > 0, **blob = 0**. 부분 클론 설정(`promisor`·`partialclonefilter`)도 함께 검사해 필터가 무시된 클론을 blobless로 오인하지 않는다
  - [x] 미러 미사용 저장소에서 `patchId`가 null이고 사유가 표시된다 (FR-REL-005 AC-5) — `no_mirror`. **미러가 있어도 `blob_fetch_disabled`가 나온다** (CR-023, DEV-111)
  - [x] 미러 fetch 실패 시 API 폴백으로 전환된다 — `FallbackCommitGraph`. 폴백은 **조용히 넘어가지 않고** 콜백으로 알린다
- 구현 범위에서 뺀 것 (CR-023, DEV-112): **커밋 메타데이터(`message`·`author`·`parent_shas`·`changed_paths`) 채우기.** API 계약과 원장 일부가 "WP-020 이후 붙는다"고 적었으나 이 WP의 구현 범위·DoD에 없고 그것을 수행하는 잡도 카탈로그에 없었다. **CR-024가 `JOB-MIR-002`를 정의하고 WP-067에 소유를 줬다** — 빈칸이 주인을 찾았다
- 검증 방법: `pnpm test:integration graph` (로컬 git 픽스처 저장소 사용 — **Elasticsearch가 필요 없어 로컬에서 판정된다**)
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
  - [x] 채번 결과가 `git rev-list --first-parent --reverse`의 순서와 정확히 일치한다 (FR-SEQ-001 AC-2) — **실제 git 픽스처로 대조**
  - [x] 시퀀스 공간별로 독립이며 루트가 1이다 (AC-1)
  - [x] 직접 푸시 커밋이 시퀀스를 받고 PR 연결이 null이다 (AC-3) — **머지 커밋과 같은 히스토리에서 대조한다.** 직접 푸시만 있는 픽스처로 "null이다"를 확인하면 PR 조회를 아예 하지 않는 구현도 통과한다
  - [x] 같은 채번을 두 번 실행해도 값이 변하지 않는다 (AC-4)
  - [x] 증분 채번이 저장된 head 이후만 처리한다 (AC-5)
  - [x] 동일 시퀀스 공간에 대한 채번이 동시에 1개만 실행된다 (AC-6) — 실제 PostgreSQL에서 동시 5건
  - [x] 그래프 접근 실패 시 공간이 `stale`이 되고 기존 시퀀스가 보존된다 (예외 처리) — **첫 시도 실패도 포함한다** (DEV-122)
  - [x] **회귀 픽스처 검증**: 병합 커밋·직접 푸시가 섞인 히스토리에서 채번이 git 결과와 일치한다 (QA 6장) — `pnpm test:regression`
- 구현 범위에서 뺀 것:
  - **재작성 감지 후의 재채번** (WP-022). 감지는 여기서 하고 공간을 `stale`로 두며 소리를 낸다. 조용히 다시 번호를 매기면 과거에 인용된 범위가 말없이 다른 것을 가리킨다 (ADR-007)
  - **회귀 픽스처의 나머지 형태** — 강제 푸시 재작성·체리픽·되돌림·태그는 그 기능을 내는 WP가 `regression/` 아래에 더한다. 빈 통을 만들어 놓고 "회귀 시험이 있다"고 적지 않는다
- 검증 방법: `pnpm test:integration apps/pipeline-worker/integration/sequence` (**Elasticsearch가 필요 없다** — 시퀀스는 PostgreSQL이 정본이므로 PostgreSQL과 git만으로 판정된다), `pnpm test:regression`
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
  - [x] 강제 푸시 픽스처에서 조상 관계 위반이 감지된다 (FR-SEQ-005 AC-1, AC-2) — 실제 git 픽스처
  - [x] 재채번 시 에폭이 1 증가한다 (AC-3)
  - [x] 이전 에폭 인용이 조회 시 `epoch_stale`로 판정된다 (AC-4) — **저장 시점 쓰기가 아니라 에폭 비교다** (CR-026, DEV-126). 표식 조회 화면은 REL-006이 이 규칙을 그대로 쓴다
  - [x] 재채번이 감사 기록(`system:sequence`)과 EVT-SEQ-002를 남긴다 (AC-5) — 알림 소비자는 REL-005 (DEV-127)
  - [x] 재채번 중 조회가 마지막 확정 값과 `reassigning` 상태를 함께 본다 (예외 처리) — 본 트랜잭션이 도는 동안 다른 커넥션으로 실측
  - [x] 재채번 실패 시 부분 채번 상태로 남지 않는다 (트랜잭션 경계) — 실패 뒤 새 에폭 행 0건, 다음 회차가 완주
  - [x] merge-base 이전 시퀀스 값이 새 에폭에서도 동일하다 — **`pull_request_number`까지** 동일 (복사가 재계산이 아닌 이유)
- 구현 범위에서 뺀 것:
  - **수동 재채번 API (API-ADM-007 POST)와 잡 테이블 경유** — WP-028 소유. 잡 유형 이름 불일치(DEV-128)도 그때 함께 푼다
  - **merge-base가 체인 밖이면 전체 재채번** (CR-026, DEV-125) — walk가 결정론이라 히스토리가 같은 구간은 같은 서수가 재현된다. 회귀 시험이 그 성질 자체를 건다
- 검증 방법: `pnpm test:integration apps/pipeline-worker/integration/sequence` (**Elasticsearch가 필요 없다**), `pnpm test:regression`
- 기록: 원장 WP-022 상태, FR-SEQ-005 매핑

### WP-023 앵커 정규화와 범위 조회 API

- 목표: 어떤 형태의 앵커든 시퀀스 값으로 바꾸고 `(from, to]` 구간을 조회한다.
- 관련 요구사항: FR-SEQ-002, FR-SEQ-003
- 관련 화면/플로우: W-004 / FLOW-003
- 관련 API/데이터/잡: API-SEQ-001, API-SEQ-002
- 선행 WP: WP-021, WP-013
- 구현 범위:
  - `POST /sequence-anchors/resolve`: SHA·PR 번호·시각·시퀀스 값 4종 정규화. **릴리스 태그는 `ANCHOR_UNRESOLVABLE`** (CR-027, DEV-132 — 근거가 되는 릴리스 수집이 WP-024)
  - `GET /sequence-ranges`: 반개구간 조회, 시퀀스 오름차순
  - **멤버십·건수는 PostgreSQL `merge_sequence`, 표시 필드·요약 집계는 Elasticsearch** (CR-027, DEV-130)
  - 요약: PR 수, 커밋 수, 작성자 수, 변경 경로 상위 20, 절삭 PR 수. **되돌림 보유 수는 WP-030 이후** (DEV-133)
  - 구간 5만 건 초과 시 조회 전 정확 count 후 400 (DEV-140)
  - 시퀀스 공간 불일치·역전·브랜치 밖 앵커·미머지 앵커 오류
  - `sequence_state`, `epoch_stale`, `items_missing_in_index` 함께 반환
  - `q` 파라미터로 구간 내 추가 필터 — 목록과 요약 양쪽에 적용 (DEV-136)
- 제외:
  - 화면 (WP-025)
  - 릴리스 비교 (WP-026)
  - **릴리스 태그 앵커 해석** (WP-024가 `prs-releases`를 채운 뒤)
  - **`summary.reverted_pull_request_count`** (WP-030 되돌림 관계 파생)
  - **커서 페이지네이션** — `next_cursor`는 늘 `null` (WP-032)
  - `index.sort` 조기 종료 — 오름차순 범위 조회에는 서지 않으며, 범위 스캔 자체가 Elasticsearch에서 일어나지 않는다 (CR-027, DEV-131)
- 완료 기준(DoD):
  - [x] QA-W004-02·04·05·06·07·08·10·11이 API 계층에서 통과한다 (01·09는 화면 규칙이라 WP-025, 03은 5종 중 4종만 — DEV-132)
  - [x] 시작 앵커 PR이 결과에서 제외되고 끝 앵커 PR이 포함된다 (FR-SEQ-002 AC-1)
  - [x] 브랜치 밖 앵커에 머지 커밋 대체 제안이 포함된다 (FR-SEQ-003 AC-2)
  - [~] 범위 조회 p95가 400ms 이하다 (구간 5000건, NFR-001) — **부분 실측**: PostgreSQL 구간 p95 7.50ms, ES 포함 전체는 NOT RUN (6.23장)
  - [x] **`git log --first-parent <A>..<B>` 결과와 건수·구성이 일치한다** (QA 6장). 태그가 아니라 커밋 앵커로 건다 — 미러가 태그를 갱신하지 않으므로 (DEV-132)
  - [x] 색인에 없는 항목이 조용히 빠지지 않고 `items_missing_in_index`로 드러난다 (DEV-130)
  - [x] API 계약의 응답 예시와 실제 응답이 일치한다
- 검증 방법: `pnpm test:integration sequence/range`, `pnpm test:regression range-vs-git`
- 기록: 원장 WP-023 상태, FR-SEQ-002·FR-SEQ-003 매핑

### WP-024 릴리스 수집과 포함 관계

- 목표: 릴리스가 앵커로 수집되고 "이 PR이 어느 배포에 들어갔는가"에 답한다.
- 관련 요구사항: FR-SEQ-004, FR-REL-002
- 관련 화면/플로우: W-002, W-003, W-005
- 관련 API/데이터/잡: API-REL-002, ENT-REL-001
- 선행 WP: WP-021, WP-008
- 구현 범위:
  - **PostgreSQL `release` 테이블 신설** (마이그레이션 008, CR-028 DEV-142 — ADR-004). 포함 판정·앵커 해석의 정본이다. `prs-releases`는 투영
  - **태그의 정본은 미러다** (CR-028, DEV-143 실측 — `--mirror` refspec은 `--no-tags`와 무관하게 태그를 옮긴다). `for-each-ref refs/tags`로 전량 열거해 diff 동기화: 신규 upsert, 삭제 반영, 서수는 현재 에폭으로 전량 재해석(DEV-149)
  - `release`·`create(tag)`·`delete(tag)`·`push(refs/tags)` 웹훅 → 게이트웨이가 `prs:release`에 갱신 신호 발행 (JOB-REL-007, EVT-REL-001) + 6시간 보정 스윕 + 재채번 후 재해석
  - `released_at` = git `creatordate`(주석=taggerdate, 경량=커밋 시각). GHE 자격 증명이 있으면 GitHub Release `published_at`이 덮는다(`source: github_release`, DEV-147)
  - `GET /containments`: **PostgreSQL에서** 시퀀스 정수 비교로 포함 판정 (간선 생성 없음). 릴리스 미수집은 **200 + `reason: "release_not_indexed"`** (DEV-146)
  - `release_tags` 비정규화 (**가장 이른 5개**, DEV-148), `unreleased` 플래그 — 표시 전용, 판정은 PG
  - 미배포 시 대기 PR 수 계산 (정본 `merge_sequence`에서)
  - **WP-023에서 이월: `POST /sequence-anchors/resolve`의 `release` 앵커** 해석 (FR-SEQ-003 AC-1) — PostgreSQL `release` 표를 본다 (DEV-143이 이월 사유의 미러 문구를 정정했다)
  - `C-020 ReleaseContainmentList` 구현, W-002·W-003 섹션 연결
- 제외:
  - CI 배포 이벤트 소스 (조건부, OD-004)
  - 릴리스 화면 (WP-026)
  - C-022 PrTimeline의 릴리스 단계 연결 (별도 정리 — 원장 8장)
- 완료 기준(DoD):
  - [ ] QA-W002-08, QA-W002-09가 통과한다
  - [ ] 포함 판정이 시퀀스 비교로 이루어진다 (FR-REL-002 AC-5)
  - [ ] 릴리스 목록이 시각 오름차순이다 (AC-3)
  - [ ] 미배포 시 `unreleased: true`와 대기 PR 수가 반환된다 (AC-4)
  - [ ] 릴리스 미수집 저장소에서 200 + `release_not_indexed` 사유가 반환된다 (예외 처리, DEV-146)
  - [ ] **태그 삭제·강제 이동·재채번 뒤에도 동기화가 git과 일치한다** (diff·재해석의 자가 치유)
  - [ ] 릴리스 앵커가 `seq:` 앵커와 같은 구간을 낸다 (FR-SEQ-003 AC-1 ↔ WP-023 회귀)
- 검증 방법: `pnpm test:integration release/`, `pnpm test:regression releases-vs-git`
- 기록: 원장 WP-024 상태, FR-REL-002·FR-SEQ-003 AC-1 매핑

### WP-025 W-004 범위 조사 화면

- 목표: 릴리스 매니저가 두 지점 사이 반영분을 60초 안에 확정한다.
- 관련 요구사항: FR-SEQ-002, FR-SEQ-003
- 관련 화면/플로우: W-004 / FLOW-003
- 관련 API/데이터/잡: API-SEQ-001, API-SEQ-002
- 선행 WP: WP-023, WP-015
- 구현 범위:
  - **`GET /sequence-spaces` (API-SEQ-006) 신설** — C-027이 쓸 접근 범위 안 시퀀스 공간 목록 (CR-029, DEV-152)
  - `C-027 SequenceSpaceSelector` (에폭·상태 표시)
  - `C-026 AnchorInput` (정규화 결과, "제외"/"포함" 라벨 상시 표시)
  - `C-028 RangeSummaryCard` — **되돌림 수는 "준비 중" 표기** (CR-029, DEV-150: API가 키를 주지 않는다, DEV-133). 값이 서는 것은 WP-030
  - 결과 목록은 **전용 표**로 그린다 — C-013은 정렬 컨트롤을 갖는 W-001 전용이고 범위 결과는 서수 오름차순 고정 + `indexed:false` 표기가 필요하다 (CR-029, DEV-154)
  - `C-012 FacetRail` (구간 내 패싯 — 데이터는 WP-032, 골격+사유 표시)
  - 시퀀스 공간 불일치 시 클라이언트에서 조회 버튼 비활성 + 즉시 사유
  - 구간 5만 건 초과 예상 시 조회 전 안내 (앵커 서수 차로 클라이언트 계산, 서버 RANGE_TOO_LARGE가 이중 방어)
  - `sequence_reassigning`/`sequence_stale`/`epoch_stale` 배너
  - 딥링크 `/ranges?repo=&branch=&from=&to=&epoch=` (경로는 셸이 소유한 `/ranges` — CR-029, DEV-153)
- 제외:
  - 안전 구간 표식 (WP-041), 이분 탐색 (WP-042) — **그 상태(`bisect_contradiction` 등)도 함께 제외한다** (CR-029, DEV-151: 도달 불가 상태는 만들지 않는다)
  - 패싯 데이터와 `q` 파라미터 (WP-032)
- 완료 기준(DoD):
  - [ ] QA-W004-01 ~ QA-W004-09, QA-W004-11, QA-W004-21, QA-W004-22가 통과한다
  - [ ] QA-W004-10은 **되돌림 수를 제외한 넷**으로 통과하고, 되돌림 자리는 "준비 중"과 사유가 보인다 (CR-029, DEV-150)
  - [ ] 반개구간 규칙이 화면에 상시 표시된다 (QA-W004-01)
  - [ ] 상태 매트릭스 W-004 중 **이 WP가 도달 가능한 상태 전부**가 렌더링된다: `empty_no_anchor`·`loading_initial`·`ready`·`error_range_inverted`·`error_range_too_large`·`error_space_mismatch`·`error_anchor_not_on_branch`·`error_anchor_not_merged`·`sequence_reassigning`·`sequence_stale`·`epoch_stale`·`no_permission`·`auth_expired` (표식·이분 상태는 WP-041·042 — CR-029, DEV-151)
  - [ ] URL 에폭 불일치 시 자동 재조회하지 않는다 (QA-W004-21)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test web/lib/range`, `pnpm test:e2e flow-003-range`, `pnpm test:a11y ranges`
- 기록: 원장 WP-025 상태

### WP-026 W-005 릴리스 화면과 구간 비교

- 목표: 릴리스 2건을 골라 그 사이 반영분을 본다.
- 관련 요구사항: FR-SEQ-004
- 관련 화면/플로우: W-005 / FLOW-003
- 관련 API/데이터/잡: API-REL-005, API-SEQ-003, API-SEQ-006
- 선행 WP: WP-024, WP-025
- 구현 범위:
  - **`GET /releases` (API-REL-005) 신설** — C-032가 읽을 저장소 릴리스 목록 (CR-030, DEV-155). 목록을 줄 경로가 어디에도 없었다. **저장소 스코프**(브랜치는 선택 필터), 저장된 서수를 믿지 않고 **현재 에폭으로 재조인**(DEV-149), 직전 대비 PR 수는 서수 차가 아니라 PR 문서 수, 릴리스 0건은 200 + `reason`
  - **`GET /release-comparisons` (API-SEQ-003)** — WP-023의 `runRange`를 그대로 딛는다. 이 API가 따로 소유하는 것은 셋뿐이다: `to=unreleased`, 서수 기준 방향 정규화(AC-4), `size=0`(요약만). 요약·항목·에폭 봉투는 API-SEQ-001과 같은 계층이다 (CR-030, DEV-156)
  - `C-032 ReleaseTimeline` (체크박스 2건 선택 상한, 행에 브랜치·서수 표기, **서수 없는 릴리스는 표시하되 선택 불가**)
  - `C-027 SequenceSpaceSelector` 재사용 — 저장소 선택 (API-SEQ-006)
  - `C-028 RangeSummaryCard` 재사용 — 릴리스 상세 요약. **되돌림 수는 "준비 중"** (CR-027 DEV-133, CR-029 DEV-150)
  - 미배포 구간 진입 (`to=unreleased`)
  - 다른 시퀀스 공간의 릴리스 2건 선택 시 **클라이언트에서 비교 차단** + 사유 (FR-SEQ-004 AC-3)
  - 구간 비교 실행은 **W-004로 이동한다** — 결과 목록·패싯·뒤로가기 복귀는 W-004 한 곳에만 둔다 (FLOW-003)
  - 딥링크 `/releases?repo=&branch=` (경로는 셸이 소유한 `/releases` — CR-030, DEV-157)
- 제외:
  - 릴리스 목록의 커서 페이지네이션 (WP-032) — `limit` 상한과 `truncated` 표기로 대신하고 **말없이 자르지 않는다**
  - 되돌림 보유 PR 수의 **값** (WP-030) — 자리와 사유만 그린다
  - W-009 저장소 개요 링크 (REL-004~005) — 화면이 없으므로 링크를 걸지 않는다 (CR-030, DEV-159)
  - 옴니 검색의 `release` 유형 해석 — `/resolve` 소유 WP의 후속이다 (CR-017, DEV-065). W-005 진입은 내비게이션·딥링크·W-002/W-003 포함 릴리스로 충분하다
- 완료 기준(DoD):
  - [ ] QA-W005-01 ~ QA-W005-04, QA-W005-06이 통과한다
  - [ ] QA-W005-05는 **절반**이다: `release_not_indexed`와 두 원인 안내는 통과하고, 저장소 개요 경로는 W-009가 서는 REL-004~005로 이월한다 (CR-030, DEV-159)
  - [ ] 지정 순서와 무관하게 정규화되고 방향이 응답에 명시된다 (FR-SEQ-004 AC-4)
  - [ ] 미배포 구간 조회가 동작한다 (AC-5)
  - [ ] 상태 매트릭스 W-005 중 **이 WP가 도달 가능한 상태 전부**가 렌더링된다: `loading_initial`·`ready`·`release_not_indexed`·`error_space_mismatch`·`not_found`·`no_permission`·`auth_expired`
  - [ ] **다른 브랜치의 릴리스가 한 목록에 함께 보인다** — 그래야 QA-W005-03이 도달 가능하다 (CR-030, DEV-158)
  - [ ] `pull_request_count_since_previous`가 서수 차와 다른 경우(직접 푸시 혼재)를 시험이 구분한다 (QA-W005-06)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test:integration release`, `pnpm test web/lib/release`, `pnpm test:e2e flow-003`, `pnpm test:a11y releases`
- 기록: 원장 WP-026 상태, FR-SEQ-004 매핑

### WP-027 선행·후행 조회와 상세 화면 통합

- 목표: 문제 PR 주변에 무엇이 들어갔는지 즉시 본다.
- 관련 요구사항: FR-REL-001
- 관련 화면/플로우: W-002, W-003
- 관련 API/데이터/잡: API-REL-001
- 선행 WP: WP-023, WP-017, WP-018, WP-021
- 구현 범위:
  - `GET /sequence-neighbors` (앞뒤 **각각** 기본 10·최대 50, 기준 개체 `is_anchor: true` 포함)
  - **앵커 두 갈래**: `pr_number` 또는 `commit_sha` — 직접 푸시 커밋은 PR이 없어 커밋 앵커가 필요하다 (CR-031, DEV-163)
  - **직접 푸시 커밋을 목록에 포함한다** (CR-031, DEV-161 / FR-REL-001 AC-2 정정, SRS v2.4). 빼면 서수가 건너뛴 채 보여 누락으로 읽힌다. 제목·작성자는 `null`이고 소속 PR 값으로 채우지 않는다
  - `indexed`·`url`을 항목에 싣는다 — 색인 미반영 이웃도 서수·SHA로 그린다 (DEV-166, DEV-130과 같은 규칙)
  - 공간 경계에서 존재하는 만큼만 반환하고 `boundary`로 밝힌다
  - 409 `NO_SEQUENCE`의 **사유를 가른다**: `not_merged` / `not_sequenced` (DEV-164)
  - `C-019 NeighborSequenceList` 구현, W-002 섹션 연결 — **열 때 1회 조회**(진입 조회 금지, DEV-162)
  - W-003 시퀀스 위치 섹션 연결 (커밋 앵커)
  - "범위로 확장" → W-004 이동. **앵커는 지금 보고 있는 이웃 창**(첫 항목 서수 제외, 마지막 항목 서수 포함, DEV-167)
  - `C-014 SequenceBadge`에 실제 시퀀스 값 표시
  - **W-002의 에폭 경고 배너** (QA-W002-16 / FR-SEQ-005 AC-4) — DEV-087의 이월을 닫는다. 자동 재조회는 하지 않는다 (DEV-165)
- 제외:
  - 커밋 메타데이터(제목·작성자) 채우기 — JOB-MIR-002, **WP-067**. 직접 푸시 행은 그때까지 자리와 사유만 그린다
  - 이분 탐색 보조 (WP-042) — SCN-003의 뒤쪽 절반이다
- 완료 기준(DoD):
  - [ ] QA-W002-04 ~ QA-W002-07, QA-W002-16, QA-W002-19가 통과한다
  - [ ] QA-W002-17이 **선행·후행까지 포함해** 통과한다 — 진입 시 요청은 PR 문서 하나뿐이다 (CR-031, DEV-162)
  - [ ] 개수 조절이 앞뒤 각각 최대 50까지 동작한다 (FR-REL-001 AC-1)
  - [ ] 기준 개체가 포함되고 강조된다 (AC-3)
  - [ ] 공간 경계에서 오류 없이 존재분만 반환되고 `boundary`가 그것을 밝힌다 (AC-4)
  - [ ] **직접 푸시 커밋이 목록에 있고 서수가 연속이다** (AC-2, CR-031)
  - [ ] 미머지 PR에서 **조회를 보내지 않고** 섹션이 비활성 + 사유로 표시된다. 미채번은 다른 문구다 (예외 처리, DEV-164)
  - [ ] W-003이 커밋 앵커로 같은 목록을 그린다 (DEV-163)
  - [ ] 에폭 불일치 시 경고가 뜨고 자동 재조회하지 않는다 (QA-W002-16)
  - [ ] **조회가 대상 브랜치를 지정하고 응답의 시퀀스 공간이 그것과 같다** — 같은 커밋이 두 공간에 있어도 요청한 공간의 서수를 낸다 (QA-W002-20·QA-W003-09, CR-032 DEV-168)
  - [ ] 색인에 없는 PR 이웃의 "머지 시각"이 비어 있다 — 커밋 시각으로 채우지 않는다 (QA-W002-22, CR-032 DEV-169)
  - [ ] 조회 실패 상태에서 화면의 재시도 수단으로 복구된다 (QA-W002-21, CR-032 DEV-170)
  - [ ] axe 위반 0건
- 검증 방법: `pnpm test:integration sequence/neighbors`, `pnpm test web/lib/neighbors`, `pnpm test:e2e flow-002`, `pnpm test:a11y pr-detail`
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
- 완료 기준(DoD):
  - [x] QA-A003-09가 통과한다
  - [x] 표본 모드가 최근 1000개를 대조한다 (FR-ADMIN-003 AC-2)
  - [x] 불일치 시 최초 지점의 저장 SHA와 실제 SHA가 보고된다 (AC-3)
  - [x] `confirmation` 불일치 시 400이다 (FLOW-008)
  - [x] 조정 스캔이 색인에 없는 PR을 발견해 재투입한다 (FR-ING-011 AC-3)
  - [x] 누락 건수가 메트릭으로 노출된다 (AC-4)
  - [x] 점검이 감사 기록에 남는다 (FR-ADMIN-003 AC-5)
  - [x] **점검 실패가 시퀀스 공간 상태를 바꾸지 않는다** — 그래프를 읽지 못해도 기존 상태가 보존되고, 실패를 `consistent`로 표현하지 않는다 (CR-033, DEV-171 / SRS v2.5)
  - [x] **`sequence_reassign` 잡 행이 실제로 만들어진다** — 마이그레이션 009가 `job_type_chk`를 넓혔고 up/down이 쌍으로 돈다 (CR-033, DEV-172 / DEV-128 해소)
  - [x] `new_epoch_expected`가 현재 에폭 + 1의 **실제 계산 결과**다 (고정값이 아니다)
  - [x] `affected_saved_search_count`가 **`@prs/query` 파서**로 판정된다 — 문자열 검색이 아니며, `repo:`·`base:`가 없는 질의는 보수적으로 센다 (CR-033, DEV-173)
  - [x] `impact_estimate`의 세 항목이 실제 데이터로 계산된다 — 계산하지 않은 항목을 `0`으로 채우지 않는다
  - [x] 조정 스캔이 **주기 설정값(기본 1시간)**으로 돈다 (FR-ING-011 AC-1)
  - [x] 조정 스캔이 **최근 24시간 갱신 PR**을 읽는다 — `/pulls`에 `since`가 없으므로 `updated desc` + 컷오프다. 백필의 `asc` 고정(DEV-098)은 기본값으로 유지된다 (CR-033, DEV-175)
  - [x] **대상 브랜치 head에 시퀀스가 없으면 채번 잡을 예약한다** (FR-ING-011 AC-5) — 기존 채번 경로로 예약할 뿐 서수를 직접 붙이지 않는다
  - [x] 한도 소진 시 전체 주기를 실패시키지 않고 다음 주기로 미룬다. **3주기 연속 미완주면 경보 상태·지표가 발생한다** (FR-ING-011 예외 처리)
  - [x] **JOB-ING-008이 개수와 표본 내용을 각각 대조하고**, PG에 있고 ES에 없는 항목만 재투영 대상이며 **ES에만 있는 잉여 문서는 자동 삭제하지 않는다** (CR-033, DEV-174 / ADR-004)
  - [x] 조사 가능한 보고에 민감 페이로드·소스 코드가 들어가지 않는다 (NFR-005)
  - [x] **운영 도달성** (CR-034): 아래가 각각 한 줄로 이어진다 — 선언 → 운영 entrypoint 기동 → 종료 정리 → 배포 manifest → 통합 증거. 함수가 존재하는 것으로는 충족되지 않는다
    - [x] API-ADM-007이 **운영 조립**에서 등록된다. GHE 미구성이면 등록하지 않되 기동 로그가 그 사실을 밝힌다 (DEV-177)
    - [x] `sequence_reassign` 잡을 **실제로 집는 러너**가 있고 잡 수명주기가 행에 남는다. 영구 `queued`가 없다 (DEV-178)
    - [x] 조정 스캔이 **전용 역할에서 기동**하고 SIGTERM에서 정리된다 (DEV-179)
    - [x] head 복구가 **살아 있는 채번 경로**로 간다. 집는 러너가 없는 잡 행을 만들지 않는다 (DEV-180)
    - [x] 내용 대조가 **정규 필드**를 본다. `content` 불일치가 실제로 도달한다 (DEV-181)
    - [x] 수동 복구가 **head 그대로인 중간 손상**을 실제 git 체인과 같게 고친다 (DEV-182)
    - [x] 각 역할의 **배포 manifest**가 있다 (DEV-183)
    - [x] 두 투영 경로가 **PostgreSQL 정본**을 남긴다 — ADR-004가 백필 경로에서도 성립한다 (DEV-184)
  - [x] **머지 후 정정** (CR-037): 아래가 실제 동작으로 검증된다
    - [x] 수동 복구가 **락 아래에서 저장 head를, 커밋 직전에 실제 Git head를** 다시 확인한다. 분석 중 head가 전진하면 아무것도 커밋하지 않는다 (DEV-192)
    - [x] 정합성 지문이 **접근 통제 필드**(`org_id`·`visibility`·`allowed_team_ids`·`repository_archived`)를 포함하고, 그 기대값을 `repository` 표에서 합성한다 (DEV-193)
    - [x] 마이그레이션 이전 데이터가 **재개 가능한 부트스트랩**(JOB-ING-010)으로 정본 스냅숏을 얻는다. 마이그레이션 안에서 GHE·ES를 부르지 않는다 (DEV-194)
    - [x] 부트스트랩 전 상태를 **`snapshot_bootstrap_pending`**으로 구분해 보고한다 — `extra_in_es`로 확정하지 않는다 (DEV-195)
    - [x] 실행 중 잡의 취소가 **조건부 전이(CAS)**로 보존된다. `cancelled`를 `completed`로 덮지 않는다 (DEV-196)
    - [x] 수동 복구가 성공하면 **`EVT-SEQ-002`를 발행한다** — 자동 경로와 같은 확정 절차다 (DEV-197)
    - [x] `reassigning`이 재구축 중 **다른 연결에서 관측된다** (DEV-198)
    - [x] 그래프를 읽지 못한 실패가 **`stale`로 영속된다** — 서수 값은 보존한다 (DEV-199)
- 제외:
  - A-003 화면 (WP-040)
  - **실제 outbound 알림 발송** — 알림 어댑터는 REL-005 소유다 (DEV-026·DEV-127 이월). FLOW-008 7단계는 이 WP에서 **감사 기록·지표·잡 상태**까지만 성립한다. 발송했다고 보고하지 않는다 (CR-033, DEV-176)
- 검증 방법: `pnpm test:integration ops/sequence-integrity`, `pnpm test:integration job-type-reassign`, `pnpm test:integration sequence/repair`, `pnpm test:integration jobs/snapshot-bootstrap`, `pnpm test pipeline-worker/src/{integrity,reconcile,consistency}`, `pnpm test:regression`
- 기록: 원장 WP-028 상태, FR-ADMIN-003·FR-ING-011 매핑

### WP-067 커밋 메타데이터 보강 (JOB-MIR-002)

> CR-024 신설. WP-020이 그래프 **읽기** 계층을 세웠으나 그 값을 커밋 문서에 **쓰는** 잡이 없었다 (DEV-112).
>
> **CR-038이 계약을 경화했다 (DEV-205~214).** 원래 계약("기존 커밋 문서를 부분 갱신한다")대로 구현하면 **사용자에게 보이는 것이 하나도 달라지지 않는다** — 조사 품질을 떨어뜨리는 직접 푸시 커밋에는 문서 자체가 없고, 채운 값을 읽어 주는 화면 경로도 없다. 제품 범위를 넓히지 않고 이미 승인된 요구사항을 실제 커밋과 API/UI까지 잇는다.

- 목표: `prs-commits` 문서의 커밋 자체 메타데이터를 채우고, **직접 푸시 커밋도 조회 가능한 문서로 만든다.**
- 관련 요구사항: FR-SRCH-002 (AC-3), FR-REL-005 (AC-5), FR-SRCH-004, FR-REL-001
- 관련 API/데이터/잡: `JOB-MIR-002` / ENT-CORE-003, API-SRCH-003 (커밋 상세), API-REL-001 (선행·후행)
- 선행 WP: WP-020, WP-008, **WP-068** (접근 범위 소스)
- 구현 범위:
  - **버스**: 토픽별 **복수 논리 소비자 그룹**. `prs:projected`를 `link`와 `commit-enrich`가 **각각** 받는다 (CR-038, DEV-205)
  - **그래프**: `CommitGraph`에 `readCommit(ref, sha)` — `parent_shas`, `message`, `author`, `committer`, `authored_at`, `committed_at`
  - **그래프**: `changedPaths(ref, sha)` — 미러는 `git diff-tree --no-commit-id --name-only -r`, 폴백은 커밋 API `files[].filename` (상한 300, 초과 시 `changed_paths_truncated`)
  - `patch_id`: `MIRROR_ALLOW_BLOB_FETCH=true`인 저장소에서만. 그 외에는 `patch_id_unavailable`에 사유를 적는다
  - **PostgreSQL 정본** `commit_snapshot` (additive 마이그레이션). ADR-004가 커밋 축에서도 성립해야 한다 (CR-038, DEV-208). 소스 코드 본문·patch 본문은 **어떤 경로로도** 저장하지 않는다
  - **방아쇠 넷** (CR-038, DEV-206):
    - `sequence.assigned`(EVT-SEQ-001) → `from_seq..to_seq` 구간을 `merge_sequence`에서 읽어 보강. **직접 푸시 커밋이 여기로 들어온다**
    - `sequence.reassigned`(EVT-SEQ-002) → 새 에폭의 영향 구간 재확인
    - `EVT-ING-003`(`entity_kind: commit`) → 기존 PR 유래 커밋 문서 보강
    - 미보강 잔여분 스윕 (일 1회 05:00 KST) — **보정용이며 주 전달 수단이 아니다**
  - **문서 생성**: 색인에 없는 first-parent 커밋은 문서를 **만든다.** 생성 시점에 `repositoryScope()`의 접근 통제 material을 함께 싣는다 (DEV-213)
  - **역할 판정**: `direct_push`는 근거를 요구한다 — first-parent 커밋이고, 현재 알려진 PR 머지 매핑이 없다. 이후 매핑이 생기면 `merge_commit`으로 **교정 가능**하다 (DEV-207)
  - **API/UI 연결**: 커밋 상세 응답(DEV-210), PR 상세 `source_commits` batch join(DEV-211), 선행·후행 직접 푸시 행 batch join(DEV-212)
  - 메트릭: `commit_enrich_total{source,result}`, `patch_id_unavailable_total{reason}`
- 제외:
  - 체리픽 **간선 생성** (WP-030) — 이 WP는 `patch_id` 값을 채우기만 한다
  - `release_tags` (WP-024)
  - 소스 코드 본문·patch 본문 저장 — 어떤 경로로도 하지 않는다 (NFR-005)
  - 기존 커밋 문서의 대량 소급 보강 — 스윕이 점진적으로 메운다
- 완료 기준(DoD):
  - [x] 미러 경로와 API 폴백 경로가 **같은 픽스처에서 같은 메타데이터**를 낸다
  - [x] `changed_paths`를 얻은 뒤에도 미러의 **blob 수가 0이다** — `diff-tree --name-only`가 트리만 읽음을 실측으로 확인한다 (THR-015)
  - [x] `MIRROR_ALLOW_BLOB_FETCH`가 꺼진 저장소에서 `patch_id` 키가 **없고** `patch_id_unavailable`이 `blob_fetch_disabled`다 (FR-REL-005 AC-5)
  - [x] 미러가 없는 저장소에서 사유가 `no_mirror`다
  - [x] 같은 SHA로 두 번 돌려도 문서가 동일하고 `document_version`이 변하지 않는다
  - [x] 커밋 상세 API가 채워진 키를 실제로 반환한다 (API 계약 §커밋 상세)
  - [x] **`link`와 `commit-enrich`가 같은 projected 이벤트를 각각 받는다** (CR-038, DEV-205)
  - [x] **직접 푸시 first-parent 커밋이 실제 `prs-commits` 문서로 존재하고** 검색·해석·커밋 상세에서 조회된다 (DEV-206 / FR-SRCH-002 AC-3)
  - [x] 그 문서에 **접근 범위가 강제된다** — 권한 필드 없는 문서를 먼저 만들지 않는다 (DEV-213)
  - [x] 후발 PR 매핑이 생기면 잘못된 `direct_push` 역할이 **교정된다** (DEV-207)
  - [x] 새 직접 푸시 문서의 초기 `document_version`이 **커밋 시각**이며, 이후 정상 투영이 밀려나지 않는다 (DEV-209)
  - [x] PR 상세 `source_commits`에 제목·작성자·시각이 실제로 채워지고 **N+1 조회가 없다** (DEV-211)
  - [x] 선행·후행의 직접 푸시 행에 메타데이터가 실제로 표시되고 **N+1 조회가 없다** (DEV-212)
  - [x] **PostgreSQL 정본에서 ES 커밋 문서를 재구성할 수 있다** (DEV-208 / ADR-004)
  - [x] **운영 도달성** (DEV-214): 선언 → 소비자 그룹 → 워커 역할 → entrypoint 기동 → 핸들러 → PG 정본 → ES 투영 → 종료 정리 → 배포 manifest가 한 줄로 이어진다. 함수가 존재하는 것으로는 충족되지 않는다
- 검증 방법: `pnpm test:integration jobs/commit-enrich`, `pnpm test:integration graph`, `pnpm test:integration commit-snapshot`, `pnpm test:regression`
- 기록: 원장 WP-067 상태, DEV-112 해소, FR-REL-005·FR-SRCH-002 매핑 갱신

### WP-068 저장소 팀 접근 범위 채우기

> CR-024 신설. 네 매핑이 모두 `allowed_team_ids`를 선언하고 강제 필터가 그것을 읽는데, 그 값을 만드는 자리가 없었다 (DEV-114).

- 목표: `allowed_team_ids`를 레지스트리가 소유하고 투영이 읽어 문서에 싣게 한다.
- 관련 요구사항: FR-AUTH-002 (AC-6), FR-AUTH-003, FR-SRCH-005 (`team:` 필터), FR-ING-009
- 관련 API/데이터/잡: API-ADM-001 / ENT-CORE-001~004
- 선행 WP: WP-010, WP-012
- 구현 범위:
  - 마이그레이션: `repository.allowed_team_ids BIGINT[] NOT NULL DEFAULT '{}'` + GIN 색인
  - 저장소 등록·갱신 시 GHE 팀 API로 채운다 (OD-002가 정한 소스와 같다)
  - `repositoryScope()`가 `allowed_team_ids`를 문서에 싣는다
  - 팀 구성 변경(`team` 웹훅) 시 `update_by_query` 소급 적용 — `markRepositoryArchived`와 같은 형태. `document_version`은 건드리지 않는다
  - 소급 적용을 `EVT-AUTH-001`의 권한 캐시 무효화와 **함께** 돌린다
- 제외:
  - 팀 이름 → ID 해석 (WP-013이 이미 세웠다)
  - 문서에 팀 **이름** 저장 — 하지 않는다 (데이터 모델 §3.3)
- 완료 기준(DoD):
  - [x] `team:<slug>` 질의가 실제 투영 문서를 맞힌다 — 지금은 한 건도 맞히지 못한다
  - [x] 접근 범위 500 저장소 초과 시 `org_team` 경로가 **팀을 통해서만 볼 수 있는** 비공개 저장소를 반환한다
  - [x] 팀에서 제거된 사용자가 그 팀으로만 보이던 과거 문서를 **더 이상 보지 못한다** (소급 적용 검증)
  - [x] 소급 적용 후 `document_version`이 변하지 않는다
  - [x] 권한 매트릭스 테스트가 팀 경로를 포함한다
  - [x] **동기화가 저장소 단위로 직렬화된다** (CR-037, DEV-191) — GHE 조회부터 색인 반영까지가 한 락 안에 있고, 겹친 두 동기화의 GHE 응답이 뒤집힌 순서로 끝나도 **회수된 팀이 되살아나지 않는다.** 프로세스 내부 mutex가 아니라 저장소 단위 세션 advisory lock이며, GHE 왕복 동안 DB 트랜잭션을 열지 않는다
- 검증 방법: `pnpm test:integration scope-enforcement`, `pnpm test:integration resolve`, `pnpm test:integration team-scope-race`
- 기록: 원장 WP-068 상태, DEV-114 해소

---

## REL-004 관계 파생과 전문 검색

### WP-029 관계 간선 인덱스와 참조 추출

> **CR-039로 계약을 경화했다 (DEV-215~229).** 원래 계약은 "추출하여 간선을 생성한다"까지였고,
> **다시 만드는 일**(본문 수정·대상 등장·과거 데이터)이 없었다. 아래 범위는 그 공백을 메운 것이며
> 제품 범위를 넓히지 않는다 — SRS는 v2.5 유지.

- 목표: 텍스트에 적힌 참조가 탐색 가능한 간선이 되고, **본문이 바뀌거나 대상이 나중에 나타나도 계속 맞다.**
- 관련 요구사항: FR-REL-003
- 관련 API/데이터/잡: JOB-REL-001, JOB-REL-005, **JOB-REL-006**, ENT-REL-002, **EVT-ING-005**
- 선행 WP: WP-008, WP-003, **WP-067** (직접 푸시 커밋 문서와 `commit_snapshot`이 있어야 한다)
- 구현 범위:
  - `pipeline-worker` **`link` 역할 신설** — 현재 역할 아홉에 없다. 배포 manifest와 README 적용 순서까지 함께 (DEV-214 선례)
  - `prs:projected`를 **기본 그룹 `link`** 로 소비. 카탈로그에 이미 있다 — 이름을 바꾸지 않는다
  - **방아쇠 둘**: `EVT-ING-003` + **`EVT-ING-005 commit.metadata_ready`**. 후자를 `commit-enrich`가 새로 발행한다 — 그 경로가 없으면 직접 푸시 커밋의 참조가 영원히 간선이 되지 않는다 (DEV-215)
  - **되먹임 금지**: `commit-enrich`가 자기 이벤트를 되받지 않도록 `event_name`으로 가른다 (DEV-216)
  - **파생 정본은 PostgreSQL** — `pull_request_snapshot.document`의 `title`·`body`, `commit_snapshot.message`. 이벤트 payload의 텍스트도, Elasticsearch 현재 문서도 정본으로 쓰지 않는다 (ADR-004)
  - 참조 패턴 추출: `#N`, `owner/repo#N`, GHE PR·커밋 URL, `Refs:`/`Closes:`/`Fixes:`/`Resolves:`, 40자·7~12자 hex
  - 코드 블록(펜스·인라인 백틱)·인용 구간 제거
  - 신뢰도: 트레일러 `derived`, 본문 언급 `heuristic`
  - **안정 참조 식별자 `reference_key`** — 해결 대상과 독립인 정규화 locator. `references` 간선의 `link_id`는 `link_type` + source + `reference_key`로 만든다. **`resolved`가 바뀌어도 `link_id`가 바뀌지 않는다** (DEV-217)
  - 미해결 참조 `resolved: false` + `JOB-REL-005`가 **대상 ready 신호마다 경계 있는 역방향 조회**로 해결. 전량 스캔하지 않는다
  - 축약 SHA는 **유일할 때만** 해결한다. 0건·2건 이상은 미해결 유지 — 첫 결과를 임의로 고르지 않는다
  - 등록되지 않은 저장소·승인되지 않은 호스트는 미해결 유지. **임의의 외부 GitHub 조회로 확장하지 않는다**
  - **중복 제거**: 같은 `reference_key`가 본문과 트레일러에 함께 나오면 간선 하나, 신뢰도는 `derived`가 이긴다
  - **상한 100건은 중복 제거된 고유 참조 기준**이며 선택이 결정론적이다 (등장 순서 보존)
  - **완전한 파생 집합 + stale 제거** — 본문에서 사라진 참조의 간선을 지운다. 단 **추출 실패 회차는 제거하지 않는다** (DEV-220)
  - `link_summary.reference_count` **leaf 단위 갱신** — 객체를 통째 대입하면 WP-030의 네 값을 지운다 (DEV-222)
  - **커밋 매핑에 `links_pending`·`link_summary.reference_count` 추가** (DEV-218·219)
  - **접근 통제 material을 간선 생성 시점에 함께** 싣는다. 확정할 수 없으면 색인하지 않는다 — fail closed (DEV-224, THR-035)
  - **`JOB-REL-006`을 references subset에 대해 실행 가능하게** — PostgreSQL 정본에서 재개 가능·경계 있는 열거. `job.type`은 이미 있는 `link_rebuild`다 (DEV-221)
  - **재시도 예산을 핸들러가 `delivery_count`로 집행**한다. 어댑터는 상한을 보지 않는다 (DEV-228)
  - `@prs/domain`의 `LinkSummary`·`CommitRole`·`Link` 드리프트 정정 (DEV-225)
- 제외:
  - 되돌림·체리픽·스택 파생, `detached`, `link_summary`의 나머지 네 leaf (WP-030)
  - 관계 조회 API·그래프 탐색 (WP-031). **대상 접근 범위 교집합 강제가 거기 필수 수용 기준이다** (THR-034)
  - `co_changes`·`precedes` (조회 시점 계산, 저장하지 않음)
  - 새 PostgreSQL 간선 표 — 간선은 재파생 가능한 파생 데이터다
- 완료 기준(DoD):
  - [x] 패턴 6종이 모두 추출된다 (FR-REL-003 AC-1)
  - [x] 신뢰도가 트레일러·본문에 따라 구분된다 (AC-2)
  - [x] 미해결 참조가 대상 색인 시 **같은 `link_id`로** 해결 상태로 갱신된다 (AC-3, DEV-217)
  - [x] 코드 블록·인용 안의 표현이 추출되지 않는다 (AC-4)
  - [x] 중복 제거된 고유 참조 100건 상한이 적용되고 **재실행 시 같은 100건**이 선택된다 (AC-5)
  - [x] 추출 실패가 색인을 막지 않고 `links_pending: true`가 되며 **기존 간선을 지우지 않는다** (예외 처리, DEV-220)
  - [x] 같은 문서를 두 번 처리해도 간선이 중복되지 않는다 (ADR-009)
  - [x] **본문에서 사라진 참조의 간선이 제거된다** (DEV-220)
  - [x] **이벤트 순서가 역전돼도 최종 결과가 현재 정본과 일치한다** (DEV-215)
  - [x] **직접 푸시 커밋의 참조가 실제 운영 방아쇠 사슬로 간선이 된다** — 이벤트를 손으로 만들어 넣지 않는다 (DEV-215)
  - [x] **`commit-enrich`가 자기 이벤트를 되받지 않는다** (DEV-216)
  - [x] **축약 SHA가 모호하면 해결하지 않는다** (DEV-217)
  - [x] **`link_summary`의 WP-030 leaf가 보존된다** (DEV-222)
  - [x] **접근 통제 material 없이 간선이 만들어지지 않는다** (THR-035)
  - [x] **PostgreSQL 정본만으로 `prs-links`를 다시 만들 수 있다** — JOB-REL-006 (ADR-004, DEV-221)
  - [x] **`link` 역할이 선언 → 기동 → 핸들러 → 종료 → manifest → README 적용 순서로 이어진다** (DEV-214 선례)
- 검증 방법: `pnpm run test link/reference`, `pnpm run test:integration worker/link`, `pnpm run test:regression`
- 기록: 원장 WP-029 상태, FR-REL-003 매핑, 원장 6.34장

### WP-030 되돌림·체리픽·스택 관계 파생

> **CR-041로 계약을 경화했다 (DEV-230~247).** 원래 계약은 "파생한다"까지였고 **후보가 나중에 나타나거나 사라질 때**가
> 없었다. WP-029가 참조 축에서 겪은 것과 같은 공백이 세 계열에 그대로 있었다 — 다만 여기서는 한 겹 더 있다:
> **참조는 source 본문만 보면 되지만, 되돌림 제목 대조·체리픽 patch-id·스택은 다른 엔티티의 상태에 달려 있다.**
> 아래 범위는 그 공백을 메운 것이며 제품 범위를 넓히지 않는다 — SRS는 v2.6 유지.

- 목표: 되돌림·백포트·의존 PR을 근거와 함께 찾고, **후보가 나중에 나타나거나 사라져도 계속 맞다.**
- 관련 요구사항: FR-REL-004, FR-REL-005, FR-REL-006 (+ FR-SEQ-002 AC-2 이월분)
- 관련 API/데이터/잡: JOB-REL-002, JOB-REL-003, JOB-REL-004, **JOB-REL-006**, ENT-REL-002, **EVT-ING-005**, API-SEQ-001·003
- 선행 WP: WP-029, WP-020, **WP-067** (`commit_snapshot.patch_id`가 있어야 한다)
- 구현 범위:
  - **`link` 역할·소비자 그룹·manifest를 재사용한다.** 새 역할·새 그룹·새 manifest를 만들지 않는다 — WP-029가 세운 것을 그대로 쓴다
  - **방아쇠에 `EVT-ING-005`를 더한다** (DEV-230·231): 직접 푸시 커밋 문서는 `project`가 만들지 않으므로 `EVT-ING-003`만으로는 그 커밋의 되돌림이 영원히 간선이 되지 않는다. 체리픽은 이유가 하나 더 있다 — `patch_id`는 커밋 보강이 채우므로 `EVT-ING-003` 시점에는 아직 없다
  - **후보 변화 재평가** (DEV-232·242): 이벤트마다 **두 방향**을 본다 — 이 엔티티를 source로 한 재파생, 그리고 **이 엔티티의 변화가 영향을 주는 다른 source들**의 재파생. 경계 있는 역방향 조회로 좁힌다. 저장소 전량 스캔을 방아쇠마다 돌지 않는다
  - **파생 정본은 PostgreSQL** — `pull_request_snapshot.document`(`title`·`state`·`base_branch`·`head_branch`), `commit_snapshot`(`message`·`patch_id`·`committed_at`). Elasticsearch 현재 문서를 파생 근거로 읽지 않는다 (ADR-004). 영향 source를 **좁히는 데**는 쓸 수 있고, 좁힌 뒤 판정은 정본에서 다시 한다
  - **되돌림**: `This reverts commit <sha>` 트레일러(`exact`), `Revert "<제목>"`·PR 제목 접두 `Revert` 제목 대조(`heuristic`), 연쇄 재적용. **후보가 2건 이상이면 모두 저장한다** — `LIMIT 1`·첫 결과·최신 하나로 좁히지 않는다 (FR-REL-004 예외 처리, DEV-237)
  - **체리픽**: 트레일러(`exact`)는 `patch_id` 가용성과 **무관하게** 동작한다. `patch_id` 일치(`derived`)는 **트레일러가 없고 값이 실제로 있을 때만**, 동일 저장소 안에서. 세 사유(`no_mirror`·`blob_fetch_disabled`·`compute_failed`)를 하나로 뭉개지 않는다 (FR-REL-005 AC-2·AC-5, CR-024 DEV-111, DEV-235)
  - **체리픽 방향·상위 5건을 결정론으로 고정한다** (DEV-243): 방향은 **나중 커밋 → 이른 커밋**, 정렬은 `committed_at` 내림차순 + 동률 시 `commit_sha` 오름차순, 같은 쌍을 양방향 중복 저장하지 않는다. 순서가 비결정론이면 같은 정본에서 다른 색인이 나와 ADR-004 재구축 증명이 깨진다
  - **동일 저장소 한정을 질의 자신이 강제한다** (AC-3) — 넓게 가져와 뒤에서 거르지 않는다
  - **스택**: `base_branch` == 같은 저장소의 다른 `open` PR의 `head_branch`, 방향 하위→상위, 신뢰도 `derived`, 깊이 최대 10, 순환 감지. **후보가 여럿이면 모두 평가한다** — 계약이 `head_branch` 유일성을 보장하지 않는다 (DEV-244)
  - **`detached` 수명** (DEV-238): 조건이 깨지면 **지우지 않고** `detached: true`. 다시 성립하면 `false`. **한 번도 성립한 적 없는 후보에는 간선을 만들지 않는다**
  - **완전한 파생 집합 — 계열마다 수명이 다르다** (DEV-233): `reverts`·`cherry_picks`는 근거가 사라지면 **제거**, `stacks_on`은 **`detached`**. 하나의 일반 추상으로 뭉치지 않는다. **실패한 회차는 어느 계열에서도 제거하지 않는다**
  - **`link_summary` 네 leaf를 leaf 단위로 갱신한다** — 객체 통째 대입 금지(WP-029의 `reference_count`가 사라진다, DEV-222). **boolean은 조정 후 현재 active 간선 집합에서 다시 계산한다** — 간선 하나를 지웠다는 이유로 `false`를 쓰지 않는다 (DEV-241)
  - **`links_pending`을 재해석하지 않는다** (DEV-246): 그것은 FR-REL-003 참조 추출의 완결 상태다. WP-030 실패는 `retry` → 예산 소진 시 실패 대기열 + JOB-REL-006 보정으로 처리한다. **새 pending 필드도 만들지 않는다** — SRS가 요구하지 않는다
  - **재시도 예산을 핸들러가 `delivery_count`로 집행한다** — 어댑터는 상한을 보지 않는다 (DEV-228 규율)
  - **접근 통제 material을 간선 생성 시점에 함께** 싣는다. 확정할 수 없으면 색인하지 않는다 — fail closed (THR-035)
  - **`JOB-REL-006`을 네 계열 전부로 확장한다** (DEV-234): 한 source를 만나면 그 종류에 적용되는 계열을 모두 실행한다. **두 번째 재구축 틀을 만들지 않는다**
  - **마이그레이션 014 — 후보 조회 인덱스** (DEV-240): 정본에 제목·분기·`patch_id` 조회 인덱스가 없어 후보 탐색이 전체 스캔이 된다. 새 엔티티 표가 아니라 **인덱스만** 더한다
  - **`link_relations_total`·`link_stack_cycle_total` 지표** (DEV-247): FR-REL-006 AC-5가 순환을 "운영 지표로 기록"하라고 요구하는데 그 지표가 없었다
  - **WP-023에서 이월: `GET /sequence-ranges`·`/release-comparisons` 요약의 `summary.reverted_pull_request_count`** (CR-027 DEV-133 / FR-SEQ-002 AC-2, FR-SEQ-004 AC-2, DEV-239). **요약 집계 왕복 안의 `filter` 집계로 계산한다** — 간선 인덱스를 PR마다 다시 묻지 않는다
- 제외:
  - **관계 조회 API·상세 화면 관계 섹션 (WP-031).** 이 WP는 **저장된 간선의 방향·신뢰도·역방향 조회 가능성**까지 증명하고 멈춘다 — 화면에 그리는 것은 WP-031이다 (DEV-236)
  - 동시 변경 (조회 시점 계산, WP-031)
  - 그래프 탐색 (WP-043)
  - `is:reverted` **질의 문법의 파서·검색 API 연결** — `link_summary.is_reverted`가 실제 값을 갖게 하는 것까지가 이 WP이며, 필터 문법은 검색 소관이다
- 완료 기준(DoD):
  - [x] **되돌림 트레일러가 `exact`로 저장된다** (FR-REL-004 AC-1·AC-2)
  - [x] **제목 대조가 `heuristic`으로 저장되고, 후보가 2건 이상이면 전부 저장된다** (AC-2, 예외 처리, DEV-237)
  - [x] **되돌림 간선이 방향(주체→대상)으로 저장되고 `to_id`로 역방향 조회된다** (AC-3) — 화면 표시는 WP-031
  - [x] **되돌림의 되돌림이 연쇄로 표현된다** (AC-5) — 전용 분기 없이
  - [x] **source 본문이 바뀌면 사라진 되돌림 간선이 제거된다** (DEV-233)
  - [x] **제목 후보가 나중에 하나 더 생기면 source 이벤트 없이 간선이 둘이 된다** (DEV-242)
  - [x] **체리픽 트레일러가 `patch_id` 부재 상태에서도 `exact`로 저장된다** (FR-REL-005 AC-1, DEV-235)
  - [x] **`patch_id` 일치가 `derived`로 저장된다** (AC-2)
  - [x] **`no_mirror`·`blob_fetch_disabled`에서는 `derived` 판정을 시도하지 않고, `compute_failed`와 구분된다** (AC-5, DEV-235)
  - [x] **patch-id 비교가 동일 저장소 안으로 한정된다 — 질의 자신이 강제한다** (AC-3)
  - [x] **후보가 5건을 넘으면 결정론적 상위 5건이 저장되고, 재실행 시 같은 5건이다** (AC-4, DEV-243)
  - [x] **같은 `patch_id` 커밋이 나중에 들어오면 source 이벤트 없이 간선이 생긴다** (DEV-242)
  - [x] **스택 간선이 하위→상위로 저장된다** (FR-REL-006 AC-1·AC-2)
  - [x] **같은 `head_branch`를 가진 열린 PR이 여럿이면 모두 평가된다** (DEV-244)
  - [x] **상위 PR이 머지되면 하위 PR에 이벤트가 없어도 간선이 `detached`가 된다** (AC-3, DEV-232)
  - [x] **조건이 다시 성립하면 `detached`가 해제된다** (DEV-238)
  - [x] **순환이 감지되면 간선을 만들지 않고 지표에 기록된다** (AC-5, DEV-247)
  - [x] **깊이 10을 넘기면 탐색을 중단한다** (AC-4)
  - [x] **직접 푸시 커밋의 되돌림·체리픽이 실제 운영 방아쇠 사슬로 간선이 된다** — 이벤트를 손으로 만들어 넣지 않는다 (DEV-230·231)
  - [x] **`link_summary`의 네 leaf가 active 간선 집합에서 재계산되고 `reference_count`가 보존된다** (DEV-241·222)
  - [x] **접근 통제 material 없이 간선이 만들어지지 않는다** (THR-035)
  - [x] **PostgreSQL 정본만으로 네 계열 전부를 다시 만들 수 있다** — JOB-REL-006 (ADR-004, DEV-234)
  - [x] **`summary.reverted_pull_request_count`가 두 API에 실리고 N+1 조회가 없다** (DEV-239)
  - [x] **마이그레이션 014가 up → down → up으로 되돌아오고, 실제 질의가 그 인덱스 형태를 쓴다** (DEV-240)
  - [x] **JOB-REL-002·003·004가 운영 `link` 핸들러에서 실제로 호출된다** — 이름이 파일에 있는지가 아니라 호출 형태로 건다 (도달성 회귀)
  - QA-W002-11·QA-W002-12는 **WP-031 소유다** (DEV-236) — 둘 다 W-002 화면 동작이고 관계 조회 API가 그 WP다
- 검증 방법: `pnpm run test link/revert`, `pnpm run test:integration worker/relations`, `pnpm run test:integration worker/link-rebuild`, `pnpm run test:regression`
- 기록: 원장 WP-030 상태, FR-REL-004~006 매핑, 원장 6.35장

### WP-031 관계 조회 API와 상세 화면 관계 섹션

- 목표: 관계가 근거·신뢰도와 함께 화면에 보인다. **파생(WP-029·030)은 섰고, 이 WP가 그것을 읽는 경로를 세운다.**
- 관련 요구사항: FR-REL-003, FR-REL-004, FR-REL-005, FR-REL-006, FR-REL-007, FR-AUTH-002
- 관련 화면/플로우: **W-001**, W-002, W-003 / FLOW-006 (CR-042, DEV-262 — W-001의 관계 배지 열이 이 WP로 이월돼 있었으나 관련 화면에 적혀 있지 않았다)
- 관련 API/데이터/잡: **API-REL-006(신설)**, API-REL-003
- 선행 WP: WP-030, WP-017, WP-016

- **대상 저장소 접근 범위 교집합이 필수 수용 기준이다** (THR-034, CR-039). 간선의 접근 범위는 `from` 저장소의 것이므로, 대상의 **내용**을 반환하는 이 API는 대상 범위를 다시 교집합해야 한다
- 구현 범위:
  - **`GET /relations` (API-REL-006) 신설** — 저장된 간선 조회. 한 요청 = 한 `link_type` × 한 `direction`, `limit` 기본 50·최대 100, `truncated` 봉투. **오프셋을 만들지 않는다** (ADR-010)
  - **역방향 조회는 저장소 라우팅을 쓰지 않는다** — 간선은 source 저장소에 살기 때문에 대상 저장소로 라우팅하면 cross-repo 참조를 구조적으로 놓친다 (DEV-250)
  - **대상 내용 교집합** — 간선 조회와 대상 내용 조회를 **두 번의 독립한 강제 접근 범위 필터**로 가른다. `get`·`mget` 금지, batch 조회 (THR-034, DEV-253)
  - **사용자 대면 읽기 투영** — `confidence`·`evidence`·`resolved`·`detached`·`ambiguous`·`content_available`·반대쪽 끝점. 워커의 `StoredLink`를 HTTP DTO로 쓰지 않는다 (DEV-251)
  - `GET /co-changes` (API-REL-003): **정확한** 자카드 유사도, 머지 시각 ±90일, 상위 20건, 겹치는 경로 사전순 상위 10, 자격 상태 셋(`not_merged`·`enrichment_pending`·`too_many_changed_files`). **앱단 pre-limit 금지** (DEV-254·255·256)
  - `C-021 LinkGroupList` 구현: 유형별 그룹, 신뢰도 배지, `heuristic`은 근거 `CodeBlock` 필수, 방향을 텍스트로, `detached`·`ambiguous`·`content_unavailable`·섹션 `error` 표현
  - `C-015 RelationBadgeGroup` (목록 화면 배지) + **`ResultRow`에 `link_summary` 배선** (DEV-264)
  - W-002·W-003 관계 섹션 연결 (확장 시 조회, 관계와 동시 변경은 독립 하위 섹션)
  - 미해결 참조는 링크 비활성
  - **운영 배선** — `server.ts` 라우트 등록 + `runtime.ts` `buildServerDeps`까지 이어진다는 것을 회귀로 건다 (WP-028의 실패를 반복하지 않는다)
- 제외:
  - 그래프 시각화 (WP-043) — `API-REL-004`는 이 WP가 만들지 않는다
  - 관계 목록의 커서 페이지네이션 — 현재 어떤 요구사항도 전량 열람을 요구하지 않는다. 필요해지면 별도 CR
  - 새 마이그레이션 — 필요한 데이터가 `prs-links`·`changed_paths.raw`·`changed_files_count`·`merged_at`에 전부 있다
  - 새 파생 잡·새 소비자 그룹·새 배포 manifest — 이 WP는 **읽기 전용**이다
- 완료 기준(DoD):
  - [x] QA-W002-10, QA-W002-13, QA-W002-14가 통과한다
  - [x] **QA-W002-11, QA-W002-12가 통과한다** (CR-041, DEV-236에서 WP-030으로부터 이관). 둘 다 W-002 화면 동작이다 — WP-030은 간선의 방향·신뢰도·역방향 조회 **가능성**까지 증명하고, 사용자가 그것을 보는 것은 이 WP다
  - [x] QA-W002-23~28이 통과한다 (해제·다중 후보·대상 내용 부재·`links_pending` 범위·부분 실패·동시 변경 자격)
  - [x] QA-W001-24, QA-W001-25가 통과한다 (관계 배지 세 상태 · 행마다 조회하지 않음)
  - [x] QA-W003-10, QA-W003-11이 통과한다 (커밋 관계 지연 조회 · 스택/동시 변경 미요청)
  - [x] `heuristic` 항목에 근거 문자열이 반드시 표시된다 (FR-REL-003 AC-2)
  - [x] 동시 변경이 상위 20건, 경로 상위 10개와 함께 반환된다 (FR-REL-007 AC-3, AC-5)
  - [x] 변경 파일 200개 초과 PR이 제외되고 사유가 표시된다 (AC-4). **판정은 `changed_files_count`로 한다** — `files_truncated`(3000 상한)는 다른 계약이다
  - [x] **미머지 PR의 동시 변경이 `not_merged`로 답한다** — `created_at`·`updated_at`으로 창을 대체하지 않는다 (AC-2)
  - [x] **상위 20이 정확한 자카드로 선정된다** — 후보를 먼저 자른 뒤 계산하지 않는다. 상위 20 밖에 놓인 후보를 포함한 픽스처로 건다 (DEV-255)
  - [x] **겹치는 경로가 사전순 상위 10으로 결정론적이다** (DEV-256)
  - [x] 관계 섹션이 확장 시에만 조회된다 (QA-W002-17). 진입 시 `/relations`·`/co-changes` 요청이 **0건**이다
  - [x] `evidence`가 평문으로 렌더링된다 (THR-020)
  - [x] **THR-034 대적 매트릭스 넷이 통과한다** (DEV-253): ① 양쪽 접근 가능 → 내용·이동 링크 있음 ② 대상 접근 불가 → 간선·식별자·근거만 ③ **A→B·C→B에서 A만 접근 가능하면 B의 incoming에 A→B만** ④ 앵커 접근 불가 → 404, 존재 누설 0
  - [x] **cross-repo 역방향 참조가 빠지지 않는다** — 대상 저장소 라우팅을 넣는 변이가 시험을 깬다 (DEV-250)
  - [x] **응답에 상한이 있다** — `limit`을 넘는 fixture에서 `truncated: true`이고 전량을 메모리에 올리지 않는다 (DEV-252)
  - [x] **대상 조인이 N+1이 아니다** — 관계 N건에 대해 대상 조회 왕복이 유형별 1회다 (DEV-253)
  - [x] **`links_pending`이 참조 그룹에만 적용된다** — 되돌림·체리픽·스택이 그 상태에서도 보인다 (DEV-258)
  - [x] **운영 조립이 관계 경로를 실제로 세운다** — `runtime.ts` → `server.ts` → 핸들러 → 강제 필터 조회가 이어짐을 회귀가 건다. 시험이 의존을 직접 꽂았을 때만 도는 상태는 실패다
  - [x] ADR-008 가드레일이 `get`·`mget`도 검사하고, 관계 조회 계층이 `links.ts`의 면제를 물려받지 않는다 (DEV-265)
  - [x] axe 위반 0건
- 검증 방법: `pnpm test:integration relation`, `pnpm test:integration co-change`, `pnpm test:e2e flow-006`, `pnpm run test:regression`
- 기록: 원장 WP-031 상태, FR-REL-003~007 매핑

### WP-032 패싯·커서 페이지네이션·전문 검색

- 목표: 대용량 결과를 끝까지 훑고 분포로 좁힌다.
- 관련 요구사항: FR-SRCH-008, FR-SRCH-009, FR-SRCH-011, **FR-SEQ-002** (SRS v2.7 AC-6·7·8, CR-043)
- 관련 화면/플로우: W-001, W-004
- 관련 API/데이터/잡: API-SRCH-004, **API-SEQ-001**
- 선행 WP: WP-013, WP-016, **WP-035**
- **선행 이유 (CR-043, DEV-266·267 — 실측으로 확인했다)**: 이 WP의 `edge_ngram` 부분 일치 필드는 **살아 있는 인덱스에 배포할 수 없다.** 두 벽이 각각 독립이다. ① `edge_ngram` 필터·분석기는 `index.analysis` 아래의 **비동적 설정**이라 열린 인덱스에 추가하면 `illegal_argument_exception`으로 거절된다 — 실제 Elasticsearch 8로 확인했고, `bootstrap.ts`의 기존 인덱스 경로는 `putMapping`만 부르므로 settings를 갱신하지도 않는다. close→reopen은 검색 중단이라 NFR-008·FR-ING-008이 막는다. ② 분석기가 있더라도 `putMapping`으로 더한 **새 서브필드는 기존 문서에서 비어 있다** — 같은 확인에서 `title.partial` 조회가 재색인 전에는 0건, `_update_by_query` 뒤에 1건이었다. 매핑만 올리고 배포하면 전문 검색이 과거 데이터에 대해 **조용히 적게** 답한다. **WP 번호 순서가 아니라 의존이 실행 순서를 정한다** — WP-035가 먼저다
- 구현 범위:
  - **W-001 커서**: PIT + `search_after`. **PIT은 정렬 키와 무관하게 모든 순회에 연다** — 정렬 키가 문서 자신의 필드라는 것은 불변이라는 뜻이 아니며 `created_at` 말고는 전부 움직인다 (CR-044, DEV-286). 봉투는 스키마 버전·PIT 식별자·정렬 키 값·질의 지문·만료를 싣고 **HMAC-SHA256으로 무결성 보호**한다. 전용 서명 키를 쓰고 새 범용 crypto 추상을 만들지 않는다 (ADR-010 Amendment)
  - **지문 정규화**: 정규화한 `q` + 정렬 키 + 정렬 방향 + 유효 `AccessScope`(정렬 후) + `access_scope_version`. `size`와 패싯 요청 여부는 **넣지 않는다** — 표현이지 결과 집합의 정체성이 아니다. 같은 요청에서 접근 범위를 두 번 산출하지 않는다(auth seam을 작게 확장한다)
  - **오류 갈래 둘**: `CURSOR_QUERY_MISMATCH`(지문 불일치)와 `CURSOR_INVALID`(디코딩·서명·버전·만료·PIT 부재·형식). 화면 문구를 구분하고 자동 재시도 루프를 만들지 않는다
  - **`relevance`가 요청한 `order`를 존중한다** — 현재 `buildSort`는 인자를 무시하고 언제나 `_score desc`다 (DEV-275)
  - **패싯 6종** (상위 20), 목록과 **동일 질의 조건**(선택된 패싯 포함), **별도 요청**으로 실행하고 상한 1.5초. 응답 상태 넷: 없음 / `ready` / `budget_omitted` / `failed`
  - **`team` 패싯은 `allowed_team_ids`를 센다** — `team:` 질의 키와 같은 필드다. 표시값은 레지스트리에서 일괄 해석(N+1 금지)
  - **W-004 구간 커서와 패싯 넷**(작성자·팀·라벨·경로). 커서는 공간·에폭·경계·질의 지문·`last_scanned_merge_seq`를 봉인한다
  - **`runRange`의 필터-후-절삭 정정** (DEV-270): 정본 구간을 상한 있는 chunk로 읽어 판정하고 `size`가 차거나 구간 끝까지 스캔한다. 일치가 적다는 이유로 순회가 중간에 끝나지 않는다. **커서는 실은 마지막 일치까지만 전진한다** — chunk 끝까지 밀면 같은 chunk의 남은 일치가 사라져 고치려던 결함이 그대로 재현된다 (CR-044, DEV-287)
  - **전문 검색**: `multi_match` (title^3, body, 브랜치명, 커밋 메시지). 커밋 축은 **first-parent 체인의 커밋**(머지 커밋·직접 푸시)으로 한정한다 — `source_commit` 메시지까지 넓히면 FR-SRCH-011 AC-1이 정한 범위를 넘는다 (DEV-283)
  - **강조는 평문 조각 + 일치 구간**이다. `<em>` 같은 raw HTML을 API 경계 밖으로 내지 않는다 (THR-018, DEV-282). 항목당 최대 3개·160자
  - **분석기는 `standard` 기반 `text_ko_en` + `edge_ngram` 부분 일치 필드다** (OD-005 resolved, CR-040). `nori` 플러그인은 초기 REL-004 의존성이 아니다 — **플러그인 설치를 전제한 코드나 설정 분기를 만들지 않는다.** 분석기의 안정 이름 `text_ko_en`은 유지하므로, 재검토 조건 셋이 충족되어 나중에 토크나이저를 교체해도 매핑 4종은 바뀌지 않는다 (FR-SRCH-011 AC-4)
  - **1자 검색어 거부를 코드 포인트 기준으로 고친다** — 현재는 UTF-16 코드 단위라 `𠮷`·이모지 한 글자가 통과한다 (DEV-284)
  - `C-016 CursorPager` 구현, `C-012 FacetRail` 데이터 연결, **W-004에도 둘 다 적용**
  - **매핑 버전 상향은 WP-035의 재색인 경로로 적용한다** — 이 WP가 별도 배포 수단을 만들지 않는다
- 제외:
  - 무중단 재색인 기계 자체 (WP-035). 이 WP는 그것이 만든 경로에 **새 매핑 버전을 얹는다**
  - disjunctive facet(자기 필드 필터만 제외하고 분포 계산) — SRS AC-3은 "목록과 동일한 질의 조건"이며 다른 동작은 별도 요구사항이다
  - 기간·시퀀스 패싯 — 연속 값이라 상위 20 분포가 뜻이 없고 SRS AC-1도 여섯만 정한다
- 완료 기준(DoD):
  - [x] QA-W001-14 ~ QA-W001-19가 통과한다. **QA-W001-14의 "페이지 번호 UI가 없다"는 WP-016이 이미 세웠으므로** 여기서는 "커서 기반으로 동작한다"를 채운다 (CR-019, DEV-075)
  - [x] 마지막 페이지에서 `next_cursor`가 null이다 (FR-SRCH-008 AC-1)
  - [x] `size` 200 초과가 절삭된다 (AC-2)
  - [x] 질의 변경 후 이전 커서가 `CURSOR_QUERY_MISMATCH`를 낸다 (AC-3)
  - [x] **훼손·만료 커서가 `CURSOR_INVALID`를 내고 화면 문구가 mismatch와 다르다** (예외 처리, QA-W001-15)
  - [x] **커서 봉투를 손으로 고친 값이 거절된다** — 서명 검증이 실제로 걸린다
  - [x] **권한 회수로 `access_scope_version`이 바뀌면 진행 중 커서가 거절된다**
  - [x] 오프셋 파라미터가 API에 존재하지 않는다 (AC-4, ADR-010)
  - [x] **어떤 정렬 키에서도 페이지 사이에 항목이 중복·누락되지 않는다** — `relevance`는 새 문서 색인 뒤에도, `updated_at`은 페이지 밖 문서의 값을 옮긴 뒤에도 그대로다 (QA-W001-29, DEV-286)
  - [x] **`sort=relevance&order=asc`가 실제로 오름차순이다** (FR-SRCH-007 AC-1, DEV-275)
  - [x] **패싯 검증이 bucket 단위다** (QA-W001-16): 각 bucket에 그 필터만 더한 독립 조회의 건수가 bucket count와 같다. `sum(buckets) == total`로 검증하지 않는다
  - [x] 패싯 실패가 목록을 막지 않는다 (예외 처리) — **`budget_omitted`와 `failed`가 다른 상태로 나간다**
  - [x] **패싯 집계가 강제 필터를 지난다** — 접근 범위 밖 저장소의 팀·라벨·작성자가 bucket·count 어디에도 없다 (THR-003)
  - [x] **이어 보기가 패싯을 다시 계산하지 않는다** (QA-W001-27)
  - [x] 제목 일치가 본문 일치보다 상위다 (FR-SRCH-011 AC-2)
  - [x] **강조 응답에 raw HTML이 없다** — 마크업을 담은 제목도 평문 조각과 일치 구간으로 나간다 (QA-W001-26, THR-018)
  - [x] **`source_commit` 메시지가 전문 검색 점수 절에 들어가지 않는다** (DEV-283)
  - [x] 한글·영문 혼용 질의에서 두 언어 토큰이 매칭된다 (AC-4). **`nori` 없이 `standard` + `edge_ngram`으로 성립함을 증명한다** (OD-005, CR-040)
  - [x] **코드 포인트 한 글자(`𠮷`·이모지)가 `QUERY_TOO_SHORT`로 거절된다** (QA-W001-28)
  - [x] **QA-W004-23 ~ QA-W004-29가 통과한다** — 특히 "일치가 첫 페이지 밖이어도 요약과 목록이 어긋나지 않는다"(DEV-270)와 "한 chunk의 일치가 `size`보다 많아도 나머지가 사라지지 않는다"(DEV-287)
  - [x] **W-004 패싯이 페이지가 아니라 구간 전체를 센다** (FR-SEQ-002 AC-8)
  - [x] **에폭이 바뀐 뒤 이전 구간 커서가 거절된다** (FR-SEQ-002 AC-7)
  - [x] **새 매핑 버전이 WP-035의 재색인·별칭 전환으로 적용된다** — 이 WP가 `putMapping`으로 분석기를 바꾸려 시도하지 않는다
- 검증 방법: `pnpm test:integration search/facets`, `pnpm test:integration sequence/range`, `pnpm test:e2e search-paging`
- 기록: 원장 WP-032 상태(3장), FR-SRCH-008·009·011·FR-SEQ-002 매핑(4장), 검증 기록 6.40장
- **구현이 등록한 편차**: DEV-327(가드레일 주석 제거가 CRLF에서 무력) · DEV-328(매핑 버전 상향이 부트스트랩을 이중 별칭 경로로) · DEV-329(`missing: '_last'` 센티널을 커서로 되먹일 수 없다). **리뷰가 셋을 더 잡았다**: DEV-330(커서가 응답이 준 PIT을 쓰지 않는다) · DEV-331(팀 slug 하나가 팀 여럿을 가리키는데 하나만 골랐다 — WP-068이 이월해 둔 자리) · DEV-332(첫 페이지 재시도가 무력하다). 여섯 다 CR 없이 구현 정정으로 닫혔다 — 제품 계약을 바꾸지 않는다
- **배포 전제**: `SEARCH_CURSOR_HMAC_KEY`(32자 이상, 복제본 공통). 없으면 운영에서 기동하지 않는다. 그리고 `prs-pull-requests`·`prs-commits`를 **재색인으로** v2에 올린 뒤에야 전문 검색이 과거 데이터에 답한다

### WP-033 저장된 검색

- 목표: 반복 조회 조건을 재사용·공유한다.
- 관련 요구사항: FR-SRCH-010
- 관련 화면/플로우: W-008, W-001
- 관련 API/데이터/잡: API-SRCH-005, ENT-CORE-006
- 선행 WP: WP-013, WP-016
- 구현 범위:
  - `GET/POST/PATCH/DELETE /saved-searches`, `POST /saved-searches/{id}/run`, `GET /saved-searches/share-targets` — 전부 API-SRCH-005 하위다 (CR-049)
  - 공개 범위 `private`/`team`, **대상 팀 하나를 명시적으로 지정**, 소유자 기준 100건 상한
  - 실행 시 실행자 접근 범위 적용 (저장자 권한 미승계). `/run`은 검색을 대신 수행하지 않는다
  - 목록은 **PostgreSQL 키셋 커서** — W-001의 PIT 커서를 재사용하지 않는다 (CR-049)
  - 마이그레이션 015 — `visibility`↔`team_id` 불변식과 목록 인덱스 둘. **새 표 없음**
  - `C-037 SavedSearchList`, W-008 화면(두 논리 목록 + 각자의 커서)
  - W-001 저장 액션 다이얼로그(이름·공개 범위·대상 팀 선택기)
  - 파싱 실패 질의는 실행 비활성 + 오류 구간. 저장·수정 시점 검증으로 새 무효 질의를 만들지 않는다
  - `buildServerDeps`·`buildServer` 배선과 도달성 회귀 (CR-034 DEV-177이 남긴 규율)
- 제외:
  - 저장된 검색의 정렬·패싯 선택 저장 (질의 문자열만 저장한다 — 넓히려면 별도 CR)
  - 질의 문자열 자체의 토큰 단위 가림 (THR-012 절 참조 — 별도 CR)
  - 조직 이름 레지스트리 (동명 팀은 `org_id`로 구분한다 — 새 표를 만들지 않는다)
- 완료 기준(DoD):
  - [x] QA-W008-01 ~ QA-W008-12가 통과한다
  - [x] `team` 공개 검색이 **지정된 대상 팀**에게만 보이고 다른 팀에는 `NOT_FOUND`다 (FR-SRCH-010 AC-2)
  - [x] 같은 `slug`을 가진 다른 조직의 팀으로 공유가 새지 않는다 (AC-1, DEV-331 계열)
  - [x] 공유받은 구성원이 편집·삭제를 할 수 없고, 화면이 액션을 그리지 않을 뿐 아니라 **서버가 거절한다** (AC-2)
  - [x] 실행자 권한이 적용되고 저장자 권한이 승계되지 않는다 (AC-3, THR-012). 저장자만 볼 수 있는 저장소를 담은 질의를 공유받은 사람이 실행해도 그 저장소 결과가 나오지 않는다
  - [x] 저장자의 접근 범위가 행에도 응답에도 없다 (AC-3)
  - [x] 100건 초과 시 409다 (AC-4)
  - [x] **99건 상태에서 동시 저장 둘이면 하나만 성공하고 최종 개수가 100이다** (AC-4)
  - [x] 목록이 커서로 이어지고 누락·중복이 없으며, 팀 구성이 바뀐 뒤의 커서는 `CURSOR_QUERY_MISMATCH`다 (AC-5)
  - [x] 훼손·만료·모르는 스키마 커서는 `CURSOR_INVALID`이고, **남의 커서는 `CURSOR_QUERY_MISMATCH`다** — 사용자 ID가 지문에 있어 서명은 유효하고 지문이 다르다 (AC-5, API-SRCH-005 커서 절)
  - [x] 문법 오류가 있는 질의는 저장·수정에서 거절되고, 이미 저장된 무효 질의는 목록에서 사유와 함께 표시되며 직접 실행하면 `SAVED_SEARCH_QUERY_INVALID`다 (AC-6)
  - [x] 무효·권한 없는 실행에서 `last_run_at`이 갱신되지 않는다 (AC-6)
  - [x] 저장자가 대상 팀에서 이탈해도 항목이 남고, 삭제·`private` 전환은 되며 그 팀을 대상으로 남기는 수정은 거절된다 (AC-7)
  - [x] 마이그레이션 015가 up/down/up을 견디고, 불변식이 어긋난 행을 거절한다
  - [x] `/share-targets`가 정적 경로로 먼저 등록되어 `{id}`로 해석되지 않는다
  - [x] 운영 `buildServerDeps`가 의존을 넘기고 `buildServer`가 경로를 세우는 것을 회귀가 건다 (DEV-177 계열)
  - [x] axe 위반 0건
- 검증 방법: `pnpm test:integration saved-search`, `pnpm test:e2e saved-search`
- 기록: 원장 WP-033 상태, FR-SRCH-010 매핑

### WP-034 W-009 저장소 개요 화면

- 목표: "왜 이 저장소 결과가 없는가"를 사용자가 스스로 확인한다.
- 관련 요구사항: FR-ING-006, FR-ING-009(AC-6~AC-10), FR-ING-011(AC-6), FR-SEQ-001, FR-SEQ-005, **FR-AUTH-002**, FR-ADMIN-001(AC-1 — API-ADM-006의 만기 이월 정정만)
- 관련 화면/플로우: W-009
- 관련 API/데이터/잡: **API-ING-002**(신설), **API-ING-003**(신설), API-ADM-006(정정), **ENT-CORE-008**(신설), ENT-CORE-001(열 둘 추가), JOB-ING-005(기록 추가)
- 선행 WP: WP-010, WP-028
- **계약 근거: CR-050 (SRS v2.10).** 착수 전 감사가 일곱을 찾았고 `API-ADM-001`·`API-ADM-006`이 둘 다 `operator` 전용이라는 것이 그 중심이었다 (DEV-350)
- 구현 범위:
  - **마이그레이션 016** — `repository_registration_request` 표 신설, `repository`에 `last_reconciled_at`·`last_reconcile_missing_count` 추가와 음수 금지 `CHECK`. **다른 표를 만들지 않는다**
  - **`API-ING-002 GET /repositories`** — 접근 범위 안 저장소의 진단 조회. `/admin` 아래에 두지 않으며 `API-ADM-001`·`API-ADM-006`의 권한을 **한 글자도 완화하지 않는다**
    - `registration_state`(`active`·`archived` 둘 다 싣는다), `last_ingested_at`(durable `raw_event`의 최근 `received_at`), `document_counts`(PR·커밋 투영 문서만), `backfill`(기존 `job` 모델 그대로), `sequence_spaces`(등록된 브랜치 전부, 행 없으면 `unknown`), `reconciliation`(최근 **완료** 회차), `unavailable`
    - **N+1 금지** — 페이지의 저장소 전체를 축마다 한 번에 읽는다. ES 문서 수는 인덱스당 집계 한 번이다
  - **PostgreSQL 키셋 커서** — 정렬 `owner ASC, name ASC, repository_id ASC`. 봉인은 `apps/search-api/src/cursor/envelope.ts`를 재사용하고 **순회 의미는 자기 모듈에 둔다**. 지문에 접근 범위 **해시**를 담고 원본 사용자 식별자를 싣지 않는다. PIT·`search_after`·오프셋 금지
  - **`API-ING-003 POST /repository-registration-requests`** — `owner/name`만 받는다. GHE에 묻지 않고, 같은 사용자의 같은 식별자는 자연 멱등이다
  - **W-009 화면** (`/repositories`) — `C-038`·`C-039`·`C-004`·`C-016`·`C-005`. 판정은 `apps/web/lib/`의 뷰 모델에 두고 컴포넌트에서 다시 하지 않는다
  - **`null`·`0`·`unavailable` 세 값을 다른 문구로** 그린다
  - W-001의 결과 없음 안내, W-002·W-003의 `not_indexed`, **W-005의 `release_not_indexed`**(DEV-159 만기)에서 `/repositories?repository=owner/name`으로 연결
  - **조정 스캔 완료 결과 보존** — `apps/pipeline-worker/src/reconcile.ts`가 **완주한 회차만** 기록한다. `deferred`와 예외는 기존 값을 덮지 않는다. `reconcile_missing_total` 지표는 그대로 둔다
  - **WP-068 접근 범위 이월 정정** (DEV-353) — `resolveRepository`·`listSequenceSpaces`가 `allowedTeamIds`를 넘기게 하고 stale 주석을 지운다. `explicit`/`org_team` parity 회귀를 세운다
  - **`API-ADM-006`에 `sequence_space_state` 추가** (DEV-354) — 기존 `sequenceSpaceRepo.countByState()`를 재사용한 **전역 건수**. `operator` 전용은 그대로이고 저장소를 식별하지 않는다
- 제외:
  - 등록 실행 UI와 등록 요청 **처리** 경로 (WP-040의 A-002). 요청의 승인·반려 상태 열을 미리 만들지 않는다
  - 백필·재채번·재색인 실행 액션 (A-003)
  - 파이프라인 전역 지표 표시 (A-001)
  - **DEV-349**(저장된 `seq:`의 에폭) — 계약의 재료가 없어 별도 CR이다. 이 WP에서 열 하나로 임의 해법을 만들지 않는다
  - FR-GH-004의 Operations Plane 진입점 (REL-007 이후)
  - FR-SEQ-006 안전 구간 표식 UI (이 화면에 없다 — 추적 정정으로 처리)
- 완료 기준(DoD):
  - [ ] QA-W009-01 ~ QA-W009-13이 통과한다
  - [ ] "결과 없음 / 권한 없음 / 미수집" 세 상태가 시각적으로 구분된다 (QA-COMMON-03)
  - [ ] 상태 매트릭스 W-009의 전 상태가 렌더링된다
  - [ ] axe 위반 0건
  - [ ] **`explicit`와 `org_team`이 같은 논리 권한 집합에서 같은 결과를 낸다** — 팀 소속으로만 허용되는 비공개 저장소가 두 표현 모두에서 보인다 (DEV-353)
  - [ ] **`allowedTeamIds` 전달을 지우면 시험이 실패한다** — `API-ING-002`·`resolveRepository`·`listSequenceSpaces` 세 경로 전부
  - [ ] **ES 문서 수 집계가 필수 접근 범위 필터를 지난다** — PostgreSQL이 이미 걸렀다는 이유로 생략하지 않는다. 범위 밖 저장소는 목록·bucket·건수 어디에도 없다
  - [ ] **커서로 끝까지 순회해 중복·누락이 0이고**, 접근 범위가 바뀐 뒤의 옛 커서는 `CURSOR_QUERY_MISMATCH`, 훼손·만료는 `CURSOR_INVALID`다
  - [ ] **커서 봉투에 원본 사용자 식별자가 없다**
  - [ ] **오프셋 파라미터를 지원하지 않는다**
  - [ ] **`archived` 저장소가 접근 범위 안이면 목록에 남는다**
  - [ ] **등록 요청이 GHE를 조회하지 않는다** — 응답 모양이 대상의 실재 여부를 구분하지 않는다
  - [ ] **같은 사용자의 같은 식별자 반복 요청이 행 하나로 유지되고 실패가 아니다**
  - [ ] **계약 밖 필드(`repository_id`·`org_id`·`visibility` 등)를 보내도 신뢰하지 않는다**
  - [ ] **사용자를 지우면 그의 등록 요청도 사라진다**
  - [ ] **미룬 조정 회차가 최근 완료 결과를 덮지 않는다** — 완료 3 → 미룸 9 뒤에도 저장된 값은 3이고, 다음 완료 0에서 0이 된다. 예외로 끝난 회차도 덮지 않는다
  - [ ] **`reconcile_missing_total` 지표가 그대로 증가한다** — PG 기록이 지표를 대체하지 않는다
  - [ ] **`API-ADM-006`이 `sequence_space_state`를 반환하고 여전히 `operator` 전용이다.** 이 수치 때문에 저장소 식별자가 새로 나가지 않는다
  - [ ] **새 라우트가 운영 조립에서 실제로 응답한다** — `runtime.ts`에서 의존을 빼거나 `server.ts`에서 등록을 빼면 회귀가 실패한다. 문자열 존재가 아니라 호출 형태로 단언한다 (DEV-177이 배운 것)
  - [ ] `null`·`0`·`unavailable` 셋이 화면에서 구분된다
- 검증 방법: `pnpm run test:integration repositories`(0건이 아닌지 확인), `pnpm run test:integration reconcile`, `pnpm run test:regression`, `pnpm run test:a11y repositories`, `pnpm --filter @prs/web run build && pnpm run test:e2e`
- 기록: 원장 WP-034 상태, FR-ING-009·FR-ING-011 매핑, DEV-159 해소

### WP-035 무중단 재색인

- 목표: 매핑 변경이 서비스 중단 없이 반영된다.
- 관련 요구사항: FR-ING-008, NFR-008, **ADR-004**(정본만으로 재구축)
- 관련 화면/플로우: A-003 (API만)
- 관련 API/데이터/잡: API-ADM-004, JOB-ING-006
- 선행 WP: WP-003, WP-008
- **차단 대상: WP-032** — `edge_ngram` 활성화가 이 WP의 기계를 요구한다 (CR-043, DEV-266·267)
- 구현 범위:
  - **`batch` 역할 배포 manifest 신설** (`deploy/k8s/pipeline-worker-batch.yaml`)과 README 적용 순서 등재. 인프라 3장이 `pipeline-worker:batch`를 이미 배포 단위로 승인했는데 **파일이 없었다** — JOB-ING-006이 그 역할이고, **이미 구현된 JOB-ING-007(아웃박스 재적재)도 그래서 배포되지 않고 있었다** (CR-045, DEV-292)
  - **배포 단위 ↔ manifest 양방향 회귀**: 정본이 **둘**이다 — 코드의 `roles.includes(...)` 갈래(구현했는데 배포되지 않았다를 잡는다)와 인프라 3장의 배포 단위 표(승인했는데 만들지 않았다를 잡는다). 기존 검사는 "존재하는 manifest가 적용 순서에 있는가"뿐이라 **없는 파일이 보이지 않았다** (DEV-293). 한쪽만 읽으면 반대쪽 공백이 그대로 통과한다 (CR-046, DEV-310)
  - **API-ADM-004 `POST /admin/reindex`** — `alias`만 받고 다음 버전은 서버가 정한다. `operator` 전용. 같은 별칭 활성 잡은 409, 전 별칭 동시 재색인 상한 **1**
  - **JOB-ING-006 러너**를 `batch` 역할에서 실제로 기동·종료한다. `claimNextJob('reindex')`를 쓰고 새 큐 틀을 만들지 않는다
  - **`pnpm es:reindex --alias <별칭>` CLI** — API와 **같은 enqueue seam**을 부른다. 두 번째 알고리즘을 만들지 않는다
  - **버전 인덱스 생성**: 현재 별칭 대상의 버전을 하나 올려 desired settings·mappings로 처음부터 만든다. 기존 인덱스에 파괴적 설정을 억지로 밀어 넣지 않는다
  - **이중 쓰기 seam**: 논리 쓰기 대상 집합을 한 곳에서 해석한다(평시 `[serving]`, 재색인 중 `[serving, shadow]`). **대상 열일곱 전부**를 덮는다 — `bulkUpsert`·`upsertOne`·`upsertCommitMetadata`·`applySequenceToDocuments`·`applyEpochBump`·`markRepositoryArchived`·`applyRepositoryTeams`·`pruneReleaseDocuments`·`applyReleaseTagsToDocuments`·`writeReferenceLinks`·`deleteStaleReferenceLinks`·`resolveReferenceLinks`·`updateLinkSummary`·`writeDerivedLinks`·`deleteStaleDerivedLinks`·`setLinkDetached`·`setLinkResolved`. **`@prs/es`가 `@prs/db`에 의존하게 하지 않는다**
  - **활성화·전환 울타리**: 별칭 단위 advisory lock. 논리 쓰기는 시작 시점에 구체 대상을 확정하고, 활성화와 전환이 그 구간과 겹치지 않는다. 활성화는 **정본 스캔보다 먼저**다
  - **PostgreSQL 정본에서만 재구축**한다. 옛 인덱스를 `_reindex` source로 쓰지 않는다 (ADR-004). 운영 투영·파생 빌더를 재사용하고 두 번째 문서 생성 경로를 만들지 않는다
  - **전환 전 검증**: 스캔 완료 · 알려진 실패 0(bulk **item 단위** 포함) · 이중 쓰기 구간 치명 실패 0 · 대상 매핑 버전 · 커버리지 · 대표 질의 · 잡이 여전히 `running`
  - **단일 원자 별칭 전환** (`indices.updateAliases` 한 번). `remove` → `add` 두 호출로 나누지 않는다
  - **실패·취소 처분**: shadow 실패는 서비스를 끊지 않되 잡을 `failed`로 만들고 전환을 막는다. 늦은 취소가 `completed`를 덮지 않도록 CAS로 종료한다
  - **보관 7일 정리 스윕**. 정본은 완료 잡의 `progress`(`source_index`·`switched_at`)다 — **새 표를 만들지 않는다**. 현재 별칭 대상은 어떤 경우에도 지우지 않는다
  - `job.state`를 늘리지 않는다. 세부 단계는 `progress.phase`(`prepare`·`dual_write`·`backfill`·`verify`·`cutover`·`retention`)에 둔다
  - `OPERATOR_JOB_TYPES`에 `reindex` 추가 — 집는 러너가 생겼으므로 (DEV-301)
- 제외:
  - A-003 화면 (WP-040)
  - **WP-032의 구체 매핑**(`edge_ngram` 필드 이름·`min_gram`·`search_analyzer`) — 이 WP는 **버전 전환 기계**를 만들고, 무엇을 얹을지는 WP-032가 정한다. 미리 하드코딩하면 그 WP의 결정을 검증 없이 선점한다
  - 부분 재색인, 자동 트리거
  - 새 워커 역할·새 consumer group·새 마이그레이션
- 완료 기준(DoD):
  - [x] **QA-A003-08**이 통과한다 — 재색인 실패 시 별칭이 전환되지 않고 기존 인덱스가 서비스를 유지한다 (통합 T3·T4)
  - [ ] QA-A003-07(이중 쓰기 상태 상시 표시)은 **A-003 화면이 서야 통과한다 — WP-040 소관.** 이 WP가 그 화면이 읽을 상태를 `job.progress`(`phase`·`dual_write_since`·`target_index`)로 실재시켰고 API-ADM-002가 그것을 내준다. 남은 것은 표시뿐이다
  - [x] 애플리케이션이 실제 인덱스명이 아닌 별칭만 참조한다 (FR-ING-008 AC-1) — **아키텍처 시험이 강제한다**
  - [x] 재색인 중 신규 이벤트가 양쪽 인덱스에 기록된다 (AC-2) — **열일곱 경로 전부**
  - [x] 별칭 전환이 원자적이다 (AC-3) — `updateAliases` **한 번**
  - [x] 재색인 실패 시 별칭이 전환되지 않는다 (AC-5)
  - [x] 재색인 중 검색 요청이 실패하지 않는다 (무중단 검증) — 실제 ES로 재색인 중 반복 조회
  - [x] **원본만으로 인덱스를 전량 재구성했을 때 결과가 동일하다** (FR-ING-003 AC-3, ADR-004)
  - [x] **`batch` 역할이 배포 manifest를 갖고 README 적용 순서에 있다** (DEV-292)
  - [x] **승인된 배포 단위에 manifest가 없으면 회귀가 실패한다** (DEV-293)
  - [x] **코드 갈래와 배포 단위 표가 서로를 덮는다** — 표에만 있는 단위와 코드에만 있는 역할을 각각 잡는다 (DEV-310)
  - [x] **대상 버전은 아직 쓰이지 않은 다음 번호다** — 실패로 남은 shadow가 재시도를 막지 않는다 (DEV-309)
  - [x] **울타리를 두 인덱스 쓰기가 끝날 때까지 쥔다** — 진행 중인 논리 쓰기가 있으면 전환하지 않는다 (DEV-308)
  - [x] **reindex 러너가 운영 조립에서 실제로 기동·종료된다** — 문자열 존재가 아니라 **호출 형태**로 단언한다 (CR-034가 배운 것)
  - [x] **API-ADM-004가 운영 조립으로 세운 서버에서 실제로 응답한다** (401이면 있고 404면 없다)
  - [x] **CLI가 API와 같은 enqueue seam을 부른다** — 별도 가짜 구현을 부르지 않는다
  - [x] 클라이언트가 임의 구체 인덱스를 대상으로 지정할 수 없다
  - [x] shadow의 **item 단위 부분 실패**가 전환을 막는다
  - [x] 전환 뒤 늦은 취소가 결과를 되돌리지 않는다
  - [x] 보관 7일 전에는 옛 인덱스가 남고, 뒤에는 지워지며, **현재 별칭 대상은 지워지지 않는다**
  - [x] **WP-032가 쓸 능력이 증명된다** — 현재 v1에 없는 분석기·다중 필드를 가진 시험용 v2를 이 기계로 세워 별칭을 옮긴다. **WP-032의 실제 필드 이름을 선점하지 않는다**
- 검증 방법: `pnpm test:integration reindex` (0건이 아닌지 확인), `pnpm test:regression`
- 기록: 원장 WP-035 상태, FR-ING-008 매핑

### WP-036 원본 아카이브 레인(Filebeat)

- 목표: 원본 이벤트가 애플리케이션과 독립적으로 검색 가능하게 보관된다.
- 관련 요구사항: FR-ING-010
- 관련 화면/플로우: A-001
- 관련 API/데이터/잡: API-ADM-008 / ENT-ING-003
- 선행 WP: WP-004
- 구현 범위:
  - `prs-raw-events-{yyyy.MM}` 매핑 (`payload`는 `enabled: false`, `repository`와 `repository_id`를 함께 담는다), ILM 정책
  - 게이트웨이 아카이브 레코드의 필드를 계약에 맞춘다 (CR-052, DEV-366)
  - 아카이브 파일 회전: 크기 상한 × 보관 개수, 초과 시 오래된 조각부터 삭제 (AC-7)
  - Filebeat **사이드카** 설정과 `emptyDir` 볼륨 배선 (CR-052, DEV-368·369·373)
  - 오프셋 상태 유지, 재기동 시 이어서 적재
  - `API-ADM-008 GET /admin/raw-events` — 역할 제한 + 필수 접근 범위 필터, `payload`는 기본 미포함
- 제외:
  - 아카이브 전문 검색 (payload는 색인하지 않음)
  - **A-001 화면 (WP-040).** 이 WP는 API까지다 — `WP-010`이 같은 자리에서 내린 판단과 같다 (CR-052, DEV-371)
- 완료 기준(DoD):
  - [ ] 아카이브 인덱스의 별칭·매핑·ILM이 엔티티 인덱스와 분리된다 (FR-ING-010 AC-1)
  - [ ] ILM으로 기간 경과 문서가 자동 삭제된다 (AC-2)
  - [ ] Filebeat를 정지시켜도 엔티티 색인이 정상 동작한다 (AC-3)
  - [ ] 아카이브 인덱스가 없어도 `API-ADM-008`이 500이 아니라 `index_available: false`를 반환한다 (AC-3)
  - [ ] `delivery_id`로 `raw_event`와 대조된다 (AC-4)
  - [ ] `API-ADM-008`이 `operator`·`security_officer` 외의 역할에 403을 반환한다 (AC-5)
  - [ ] `API-ADM-008`이 접근 범위 밖 저장소와 미등록 저장소의 원본을 반환하지 않는다 (AC-6)
  - [ ] 보관 개수 한도를 넘기면 가장 오래된 조각부터 삭제되어 디스크가 차지 않는다 (AC-7)
  - [ ] Filebeat 재기동 시 마지막 오프셋부터 이어서 적재한다 (예외 처리)
- 검증 방법: `pnpm test:integration archive`, `pnpm test:integration admin/raw-events`, 수동 Filebeat 중단·재기동 시나리오
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
  - A-001 완성: `C-040 PipelineMetricGrid`, `C-041 DeadLetterTable`, `C-042 ScanResultCard`, `A-001-ARCHIVE` (CR-052 — `API-ADM-008`은 WP-036이 낸다)
  - A-002: `C-043 RepositoryRegistrationForm`, 등록 요청 목록
  - A-003: `C-044 JobTable`, `C-045 JobRunForm`, `C-046 IndexStatusPanel`, `C-047 IntegrityReportCard`
  - 30초 폴링 (조작 중 보류, 백그라운드 탭 중단)
  - 파괴적 확인 다이얼로그: 해제("문서 유지" 명시), 일괄 재처리(100건 초과 재확인), 재채번(영향 범위 + 저장소명 입력)
  - `operator` 역할 제한
- 제외:
  - A-004 (WP-039)
- 완료 기준(DoD):
  - [ ] QA-A001-01 ~ QA-A001-14, QA-A002-01 ~ QA-A002-05, QA-A003-01 ~ QA-A003-11이 통과한다
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
| REL-003 | WP-020 ~ WP-028, WP-067, WP-068 | 11 |
| REL-004 | WP-029 ~ WP-036 | 8 |
| REL-005 | WP-037 ~ WP-040 | 4 |
| REL-006 | WP-041 ~ WP-044 | 4 |
| REL-007 | WP-045 ~ WP-048, WP-061, WP-062, WP-066 | 7 |
| REL-008 | WP-049 ~ WP-050 | 2 |
| REL-009 | WP-051 ~ WP-053, WP-057 | 4 |
| REL-010 | WP-054 ~ WP-056, WP-063, WP-064 | 5 |
| REL-011 | WP-058 ~ WP-060, WP-065 | 4 |
| 합계 | | 68 |

모든 REL이 WP로 분해되었고, 모든 WP가 최소 1개 FR을 참조한다.
