# PR Search 시스템 아키텍처

> 상태: review | 버전: v0.5 | 갱신일: 2026-09-11

CR-079 / ADR-023: WP-074의 런타임은 sequence 역할의 freshness→채번→증거→M→materialize와 기존 EventBus다. raw_event/snapshot/번호 트랜잭션의 durable intent가 마지막 이벤트 복구를 보장한다. 새 범용 orchestrator는 없다. [상세 설계](pr_search_wp074_design.md) 4~8절이 정본이며 GHE 읽기 App과 기존 권한 경계를 유지한다.

## 1. 목적

이 문서는 PR Search의 전체 런타임 구조와 기술 경계를 정의한다. 모든 결정은 `../10_requirements/srs_final.md`와 `../10_requirements/prd.md`의 승인 범위 안에서만 유효하며, 이 문서는 제품 범위를 추가하지 않는다.

## 2. 아키텍처를 규정하는 세 가지 사실

설계 전반을 결정하는 도메인 사실이 셋 있다. 이 문서의 거의 모든 선택이 여기서 나온다.

1. **머지 시퀀스는 이벤트가 아니라 그래프에서 나온다.** PR 번호와 머지 시각만으로는 "반영 순서"를 만들 수 없다. 시퀀스는 대상 브랜치의 first-parent 커밋 체인을 걸어야 나오며, 그 계산은 (저장소, 브랜치)마다 직렬이고 상태를 가진다. 따라서 파이프라인에는 순서 보장과 트랜잭셔널 상태가 필요하다.
2. **웹훅 payload만으로는 문서를 완성할 수 없다.** GitHub `pull_request` 웹훅에는 PR의 커밋 목록도, 변경 파일 목록도 없다. 이 둘은 GitHub API 또는 저장소 미러에서 별도로 가져와야 한다. 따라서 수집 경로에는 반드시 외부 호출을 하는 보강 단계가 있고, 그 단계는 rate limit을 인지해야 한다.
3. **PR 문서는 불변 로그가 아니라 가변 엔티티다.** 하나의 PR은 생성·리뷰·라벨 변경·머지에 이르기까지 10개 이상의 이벤트에 걸쳐 상태를 축적한다. 따라서 검색 인덱스는 append-only 시계열이 아니라 업서트되는 엔티티 인덱스여야 하고, 순서 역전 방지 장치가 필요하다.

이 세 가지가 "웹훅 JSON을 Filebeat로 Elasticsearch에 바로 넣는다"는 단순 경로를 엔티티 레인에서 배제하는 이유다. 자세한 비교는 ADR-002에 있다.

## 3. 품질 속성

| 속성 | 목표 | 관련 요구사항 | 설계 영향 |
| --- | --- | --- | --- |
| 검색 성능 | 단건 해석 p95 200ms, 목록 p95 500ms, 집계 p95 1500ms | NFR-001 | 색인 시점 사전 계산(`lead_time_seconds` 등), `repository_id` 라우팅, `index.sort` 기반 조기 종료, 검색/집계 엔드포인트 분리 |
| 수집 신뢰성 | 유실 0건, 반영 p95 10초 | NFR-002 | durable 저장 후 202 응답, 전달 식별자 멱등, 재시도·DLQ, 조정 스캔 |
| 용량 | PR 500만, 커밋 5000만, 간선 1억, 원본 5억 | NFR-003 | 엔티티 인덱스는 고정 샤드 + 라우팅, 원본 아카이브만 ILM 시계열 |
| 가용성 | 검색 99.5%, 수신 99.9%, RPO 0 | NFR-004 | 수신기 무상태 다중화, 검색 장애 시 수집 계속(저하 모드), PostgreSQL로부터 전량 재구성 |
| 보안·권한 | 비인가 노출 0건, 권한 신선도 5분 | NFR-005 | 서버 측 강제 필터, 기본 거부, 권한 캐시 무효화 이벤트 |
| 운영성 | 재색인 4시간, 롤백 10분 | NFR-008 | 별칭 기반 무중단 재색인, 이중 쓰기, 무상태 서비스 |
| 정확성(회귀) | 시퀀스·매핑 표본 검수 100% 일치 | QA 6장 | 시퀀스는 그래프에서 결정론적으로 파생, 관계 간선은 근거 필수 |

## 4. 상위 런타임 구조

```text
                      ┌──────────────────────────┐
                      │  GitHub Enterprise       │
                      │  (웹훅 / REST / Git)     │
                      └───┬──────────┬───────────┘
                webhook   │          │  REST + git fetch
                          ▼          │
   ┌──────────────────────────────┐  │
   │ ingest-gateway (Fastify, TS) │  │      ┌────────────────────┐
   │  · HMAC 검증                 │  │      │ 사내 OIDC IdP      │
   │  · raw_event INSERT (SoR)    │  │      └─────────┬──────────┘
   │  · NDJSON 아카이브 파일 append│  │                │
   │  · 큐 enqueue → 202          │  │                │
   └───┬──────────────────┬───────┘  │                │
       │                  │          │                │
       │ NDJSON 파일      │ job      │                │
       ▼                  ▼          │                ▼
  ┌─────────┐    ┌──────────────────────────┐   ┌──────────────────────┐
  │ Filebeat│    │ pipeline-worker (TS)     │   │ search-api (TS)      │
  │ (원본   │    │  · enrich (API/미러)     │   │  · 질의 파서         │
  │  레인)  │    │  · project (문서 생성)   │   │  · 강제 권한 필터    │
  └────┬────┘    │  · sequence (서수 채번)  │   │  · 검색/집계/상세    │
       │         │  · link (관계 파생)      │   │  · 감사 기록         │
       │         │  · backfill / reconcile  │   └──────────┬───────────┘
       │         │  · reindex               │              │
       │         └───┬──────────────┬───────┘              │
       │             │              │                      │
       │             ▼              ▼                      ▼
       │      ┌─────────────┐  ┌──────────────────────────────────┐
       └─────▶│Elasticsearch│  │ PostgreSQL (System of Record)    │
              │  엔티티 +   │  │  raw_event / sequence / job /    │
              │  원본 아카이브│  │  repository / saved_search /     │
              └─────────────┘  │  audit / permission_cache        │
                     ▲         └──────────────────────────────────┘
                     │                      ▲
                     │         ┌────────────┴───────────┐
              ┌──────┴──────┐  │ Redis (큐 + 캐시)      │
              │ web (Next.js│  │  Streams / 권한 캐시    │
              │  + Conductor)│ └────────────────────────┘
              └─────────────┘         ┌──────────────────┐
                                      │ git mirror 볼륨  │
                                      │ (blobless bare)  │
                                      └──────────────────┘
```

### 4.1 배포 단위

| 배포 단위 | 종류 | 상태성 | 스케일 기준 | 관련 요구사항 |
| --- | --- | --- | --- | --- |
| `ingest-gateway` | HTTP 서비스 | 무상태 | 초당 웹훅 수신량 | FR-ING-001, FR-ING-002, FR-ING-003 |
| `pipeline-worker` | 워커 (역할별 소비자 그룹) | 무상태 (진행 상태는 PostgreSQL) | 큐 적체 길이 | FR-ING-004~008, FR-SEQ-001, FR-REL-003~006 |
| `search-api` | HTTP 서비스 | 무상태 | 동시 검색 세션 수 | FR-SRCH-*, FR-STAT-*, FR-SEQ-002~007, FR-REL-001~008 |
| `web` | Next.js 서버 + 정적 자산 | 무상태 | 동시 사용자 수 | 전 화면 |
| `filebeat` | `ingest-gateway` 사이드카 (CR-052) | 파일 오프셋 상태 | 아카이브 파일 증가량 | FR-ING-010 |
| PostgreSQL | 관리형 스토어 | 상태 | 데이터량 | FR-ING-003, FR-SEQ-001 |
| Elasticsearch | 관리형 클러스터 | 상태 | 문서 수, 질의량 | FR-SRCH-*, FR-STAT-* |
| Redis | 관리형 캐시/스트림 | 상태(휘발 가능) | 큐 길이 | FR-AUTH-003, ADR-002 |
| git mirror 볼륨 | PVC | 상태 | 저장소 수 | FR-SEQ-001, FR-REL-005 |

`pipeline-worker`는 하나의 이미지이며 환경 변수로 소비 역할(`enrich` / `project` / `sequence` / `link` / `batch`)을 지정해 독립 배포·스케일한다. 백필과 실시간 처리는 서로 다른 소비자 그룹으로 분리해 백필이 실시간 지연을 만들지 않게 한다 (FR-ING-006 AC-3).

**이 표의 "관리형"과 "PVC"는 배포 Profile B의 표현이다** (CR-059 / ADR-021). 첫 사내 파일럿의 Profile A에서는 PostgreSQL·Elasticsearch·Redis가 **같은 호스트의 컨테이너**이고 미러·아카이브 볼륨은 **Compose 명명 볼륨**이다. 인프라 3.0장이 두 프로파일의 대응을 정한다. **배포 단위의 집합과 상태성은 프로파일이 바꾸지 않는다** — 바뀌는 것은 인스턴스 수와 실행 수단뿐이며, 서버가 하나라는 이유로 이 표의 경계를 합치지 않는다.

### 4.2 두 개의 수집 레인

```text
                    ┌─ 레인 A (엔티티) ─────────────────────────────┐
webhook → gateway ──┤  queue → enrich → project → sequence → link  │→ ES 엔티티 인덱스
                    │  (상태 축적, 외부 호출, 순서 보장 필요)       │
                    └───────────────────────────────────────────────┘
                    ┌─ 레인 B (원본 아카이브) ──────────────────────┐
                 ───┤  NDJSON 파일 → Filebeat → ES 아카이브 인덱스  │→ ES 시계열 인덱스 (ILM)
                    │  (불변, 무상태, 순서 무관)                    │
                    └───────────────────────────────────────────────┘
```

두 레인은 완전히 독립이다. 레인 B가 멈춰도 레인 A는 영향받지 않고, 그 반대도 같다 (FR-ING-010 AC-3). 이 분리가 "Filebeat/Logstash로 바로 넣는 방식"을 버리지 않으면서도 엔티티 파이프라인의 요구를 만족하는 방법이다 (ADR-002).

## 5. 시스템 경계

| 경계 | 책임 | 소유 문서 | 관련 요구사항 |
| --- | --- | --- | --- |
| Frontend | 화면 상태, 질의 문자열 관리, Conductor 조합, 접근성 | `pr_search_frontend_architecture.md` | 전 화면 FR |
| Backend | 도메인 모듈, 질의 파싱, 권한 강제, 오케스트레이션, 워커 | `pr_search_backend_architecture.md` | FR-SRCH, FR-SEQ, FR-REL, FR-ING, FR-STAT, FR-ADMIN |
| API | 오퍼레이션 계약, DTO, 오류 모델, 페이지네이션, 멱등성 | `pr_search_api_contracts.md` | 전 조회 FR |
| Data | PostgreSQL 스키마, Elasticsearch 매핑, 인덱스 전략, 보존 | `pr_search_data_model.md` | FR-ING-003, FR-ING-005, FR-SEQ-001, NFR-003 |
| Async | 큐, 잡, 이벤트, 재시도, DLQ, 진행률 | `pr_search_async_events_jobs.md` | FR-ING-004~008, FR-ING-011, FR-ADMIN-002 |
| Security | 인증, 권한 강제, 시크릿, 감사, 위협 모델 | `pr_search_security_privacy_architecture.md` | FR-AUTH-*, NFR-005, NFR-006 |
| Infra | 환경, 배포, 스케일, 백업, DR | `pr_search_infrastructure_operations.md` | NFR-004, NFR-008 |
| Observability | SLI/SLO, 로그, 메트릭, 트레이스, 알림, 런북 | `pr_search_observability_reliability.md` | NFR-002, NFR-004, NFR-008 |

## 6. 데이터 흐름

### 6.1 실시간 수집 (FR-ING-001 → FR-ING-005)

1. GHE가 `ingest-gateway`로 웹훅을 POST한다.
2. 게이트웨이가 HMAC-SHA256 서명을 상수 시간 비교로 검증한다. 불일치는 401 (FR-ING-001 AC-1, AC-2).
3. `raw_event` 테이블에 `delivery_id` 유일 제약으로 INSERT한다. 충돌이면 중복으로 간주하고 202를 반환한다 (FR-ING-002).
4. 같은 트랜잭션에서 아웃박스 행을 기록하고, 커밋 후 Redis Stream에 `repository_id`를 파티션 키로 enqueue한다.
5. NDJSON 아카이브 파일에 한 줄 append한다(레인 B).
6. 202를 반환한다. 여기까지 p95 300ms (NFR-002).
7. `enrich` 워커가 이벤트를 소비해 GitHub API 또는 미러에서 커밋·파일·리뷰를 가져온다 (FR-ING-004).
8. `project` 워커가 정규화 문서를 만들어 Elasticsearch에 버전 조건부 업서트한다 (FR-ING-005).
9. `push` 이벤트면 `sequence` 워커가 (저장소, 브랜치) 락을 잡고 증분 채번한다 (FR-SEQ-001).
10. `link` 워커가 관계 간선을 파생한다 (FR-REL-003~006).

### 6.2 시퀀스 채번 (FR-SEQ-001, FR-SEQ-005)

```text
push 이벤트 (refs/heads/<대상 브랜치>)
   │
   ▼
(repository_id, base_branch) advisory lock 획득   ← 시퀀스 공간당 동시 1개 (AC-6)
   │
   ▼
git fetch (미러) 또는 GitHub API로 새 head 확보
   │
   ▼
저장된 head_sha가 새 head의 조상인가?
   ├─ 예 → git rev-list --first-parent --reverse <저장 head>..<새 head>
   │        → head_seq + 1 부터 순차 부여 (증분, 멱등)
   │
   └─ 아니오 → 히스토리 재작성 감지 (FR-SEQ-005)
              merge-base 계산 → 그 이후 시퀀스 무효 표시
              → seq_epoch += 1 → 재채번 → 알림 + 감사 기록
   │
   ▼
merge_sequence 테이블 upsert → ES 문서의 merge_seq 필드 갱신
```

시퀀스는 PostgreSQL이 진실이고 Elasticsearch는 그 사본이다. 재색인 시 시퀀스는 PostgreSQL에서 다시 채워진다.

### 6.3 검색 질의 (FR-SRCH-*, FR-AUTH-002)

```text
클라이언트 질의 문자열
   │
   ▼
질의 파서 (search-api)  → 필터 트리 + 전문 검색어 + 정렬 + 커서
   │
   ▼
권한 강제 결합기        → filter: { terms: { repository_id: <접근 범위> } }   ← 제거 불가
   │                      접근 범위 500개 초과 시 조직·팀 조건으로 치환
   ▼
Elasticsearch 질의 빌더 → search_after 커서, index.sort 활용, 라우팅 힌트
   │
   ▼
응답 매퍼               → DTO + 커서 봉인 + 강조 구간
   │
   ▼
감사 기록 (비동기)
```

권한 필터는 파서 출력이 아니라 그 뒤 단계에서 결합한다. 클라이언트 질의가 어떻게 생겼든 이 단계를 우회할 수 없다 (FR-AUTH-002 AC-2).

## 7. 주요 의존성

| 의존 대상 | 용도 | 실패 시 영향 | 저하 모드 |
| --- | --- | --- | --- |
| GitHub Enterprise 웹훅 | 실시간 수집 | 신규 데이터 유입 중단 | 조정 스캔이 누락을 보정 (FR-ING-011) |
| GitHub Enterprise REST API | 보강, 백필, 권한 조회 | 보강 지연, 권한 조회 실패 | 부분 문서 우선 색인, 권한 실패는 기본 거부 |
| GitHub Enterprise Git 전송 | 미러 동기화, 시퀀스, patch-id | 시퀀스 갱신 중단 | API 폴백 경로, 시퀀스 공간 `stale` 표시 |
| 사내 OIDC IdP | 인증 | 신규 로그인 불가 | 기존 세션은 만료까지 유지 |
| Elasticsearch | 검색·집계 | 검색 전면 불가 | 수집은 큐에 계속 축적(저하 모드), 복구 후 소진 |
| PostgreSQL | 원본 보관, 시퀀스, 잡 상태 | 수집 중단(202 응답 불가) | 게이트웨이가 500을 반환해 GHE 재전송 유도 |
| Redis | 큐, 권한 캐시 | 큐 유실 시 아웃박스에서 재적재 | 아웃박스 재적재 잡 |
| git mirror 볼륨 | 커밋 그래프 | 시퀀스·patch-id 계산 불가 | API 폴백 |

## 8. 횡단 관심사

| 관심사 | 처리 위치 | 규칙 |
| --- | --- | --- |
| 권한 강제 | `search-api`의 질의 빌더 단일 지점 | 모든 조회 경로가 이 한 함수를 통과한다. 우회 경로를 만들지 않는다 |
| 멱등성 | 게이트웨이(`delivery_id`), 워커(문서 ID + 버전) | 두 계층 모두에서 보장한다 |
| 상관 ID | 게이트웨이에서 생성, 큐·로그·감사·응답으로 전파 | 하나의 웹훅이 만든 모든 작업을 한 ID로 추적 |
| 시각 | 저장은 UTC, 표시는 요청 시간대(기본 `Asia/Seoul`) | 집계 버킷 경계는 요청 시간대로 계산 (FR-STAT-002 AC-2) |
| 오류 모델 | 공통 오류 DTO(사유 코드 + 메시지 + 상관 ID) | 사유 코드는 API 계약 문서에 열거 |
| 설정 | ConfigMap + Secret. 재배포 없이 반영되는 항목은 명시 | 큐 동시성, 백필 상한, 보존 기간 등 |
| 소스 코드 미저장 | 투영 단계에서 필드 화이트리스트 적용 | diff 본문·파일 내용 필드를 애초에 매핑하지 않는다 (NFR-005) |

## 9. 핵심 아키텍처 리스크

| 리스크 | 영향 | 완화 | ADR |
| --- | --- | --- | --- |
| 시계열 파티셔닝을 엔티티 인덱스에 적용하면 SHA→PR 조회가 전 인덱스 팬아웃이 되고 부분 갱신이 인덱스 해석을 요구한다 | 단건 조회 지연 급증, 업서트 복잡도 폭증 | 엔티티는 고정 인덱스 + 라우팅, 원본 아카이브만 ILM 시계열 | ADR-003 |
| Filebeat/Logstash 직접 색인은 보강·순서·서수 채번·그래프 파생을 수행할 수 없다 | 핵심 기능(양방향 해석, 시퀀스) 구현 불가 | 엔티티 레인은 애플리케이션 워커, 원본 레인만 Filebeat | ADR-002 |
| Kafka를 초기부터 도입하면 운영 부담이 실측 없이 발생한다 | 인력·비용 낭비, 릴리스 지연 | `EventBus` 포트 뒤 Redis Streams로 시작, 임계 초과 시 어댑터 교체 | ADR-002 |
| GitHub API rate limit이 보강 처리량을 제한한다 | 수집 지연 SLO 위반 | 미러 우선 조회, 저장소별 토큰 풀, 적응형 백오프, 부분 문서 우선 노출 | ADR-005 |
| 대상 브랜치 강제 푸시로 시퀀스가 무효화된다 | 과거 범위 인용 신뢰도 붕괴 | 조상 검사 → 에폭 증가 → 재채번 → 알림. 이전 에폭 인용은 무효 표시 | ADR-007 |
| 권한 캐시 지연으로 비인가 노출이 발생한다 | 보안 사고 | TTL 5분 + 권한 이벤트 즉시 무효화 + 기본 거부 | ADR-008 |
| 집계 질의가 검색 자원을 소진한다 | 검색 지연 확산 | 검색·집계 엔드포인트 분리, 집계 상한과 근사 표기, 필요 시 노드 역할 분리 | ADR-003 |
| Elasticsearch를 시스템 오브 레코드로 쓰면 매핑 변경이 데이터 손실 위험이 된다 | 복구 불가 | PostgreSQL이 SoR, ES는 전량 재구성 가능한 파생 뷰 | ADR-004 |

## 10. 범위 경계 확인

이 문서는 승인 범위를 구현 구조로 번역할 뿐 범위를 추가하지 않는다.

| 검토했으나 제외한 구성 요소 | 사유 |
| --- | --- |
| 실시간 푸시 게이트웨이(WebSocket/SSE) | SRS 승인 범위에 실시간 알림·구독이 없다. 화면은 명시적 재조회 모델을 사용한다 |
| 그래프 전용 데이터베이스 | 관계 탐색 깊이가 최대 3이고 노드 상한이 300이다. Elasticsearch 간선 인덱스의 다단 조회로 충족한다. 깊이 요구가 커지면 ADR로 재검토한다 |
| 벡터 검색·임베딩 저장소 | F-REL-009가 보류 상태다. 관계는 결정론적 근거만 사용한다 |
| 객체 스토리지 | 원본 이벤트는 PostgreSQL과 NDJSON 아카이브로 충분하다. OD-003이 보존 3년으로 확정되어(CR-004) 계획 용량은 `raw_event` 4TB다. 이 규모에서는 파티션 드롭 운영이 객체 스토리지 계층을 추가하는 것보다 단순하다 |
| 별도 BFF 계층 | 소비자가 웹 대시보드 하나다. `search-api`가 직접 화면 요구에 맞춘 DTO를 제공한다 |

## 11. GitHub Operations Plane (CR-005 신규)

ADR-013에 따라 Operations Plane은 Search/Data Plane과 런타임·자격 증명·감사가 분리된다.

```text
                     ┌─────────────────────────────────────────────┐
  사용자 (웹) ──────▶ │ web (Next.js)                               │
                     │   W-010 Command Center / W-011~W-023        │
                     └──────────────────┬──────────────────────────┘
                                        │ 실행 요청 (중복 방지 키)
                                        ▼
                     ┌─────────────────────────────────────────────┐
                     │ search-api : /gh/*                          │
                     │   capability 조회 · 제약 검증               │
                     │   권한 판정 (App 권한 ∩ 사용자 권한)        │
                     │   위험도 판정 · 확인/승인 게이트            │
                     │   감사 선기록 (감사 실패 = 실행 안 함)      │
                     └──────────────────┬──────────────────────────┘
                                        │ prs:gh:executions
                                        ▼
                     ┌─────────────────────────────────────────────┐
                     │ gh-executor  (독립 배포 단위)               │
                     │   비루트 · 읽기 전용 루트 FS                │
                     │   실행별 임시 workspace (TTL·할당량)        │
                     │   고정 gh 바이너리 + argv 배열, shell 미경유│
                     │   토큰 주입 → 실행 → 즉시 폐기              │
                     │   타임아웃 · 출력 상한 · 프로세스 그룹 취소 │
                     └──────────────────┬──────────────────────────┘
                                        │ HTTPS (구성된 GHE 호스트만)
                                        ▼
                              GitHub Enterprise
```

**두 Plane이 공유하는 것과 공유하지 않는 것**

| 항목 | 공유 | 근거 |
| --- | --- | --- |
| `@prs/domain` 타입 | 공유 | 저장소 식별·권한 개념이 갈라지면 화면이 어긋난다 |
| PostgreSQL 인스턴스 | 공유 | 같은 사용자·저장소 레지스트리를 참조한다. 테이블은 분리 |
| Redis 인스턴스 | 공유하되 큐는 분리 | `prs:gh:*`는 수집 큐와 별개 (async 9.1장) |
| GitHub App | **분리** | Data App(read, server-to-server) vs Operations App(위임, user-to-server) — ADR-014 |
| 실행 런타임 | **분리** | `gh` 프로세스 부하가 수집·검색을 막지 않는다 |
| 감사 저장소 | **분리** | `audit_record`(조회 감사) vs `gh_execution`(작업 감사) |
| Elasticsearch | 미사용 | Operations Plane은 검색 인덱스를 읽지도 쓰지도 않는다 |

**금지 사항 (구조적으로 강제한다)**

- `search-api`와 `pipeline-worker`는 `gh` 프로세스를 직접 생성하지 않는다. 실행은 `gh-executor`만 한다.
- 어떤 경로에서도 shell을 경유해 `gh`를 실행하지 않는다.
- 수집 파이프라인은 Operations App 자격 증명에 접근하지 않는다.
