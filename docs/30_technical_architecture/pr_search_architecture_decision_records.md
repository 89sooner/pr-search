# PR Search Architecture Decision Records

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

구현 비용, 운영 리스크, 확장성, 보안, 개발 속도에 영향을 주는 아키텍처 결정을 기록한다. 제품 범위 관련 오픈 결정은 `OD-###`(요구사항 계층)이며 여기 두지 않는다. 실행 브리프는 이 문서의 확정 결정을 스택 지시로 인용하며, 구현 에이전트는 이 결정을 다시 판단하지 않는다.

## 2. ADR 목록

| ADR ID | 제목 | 상태 | 결정일 | 영향 문서 |
| --- | --- | --- | --- | --- |
| ADR-001 | 전 계층 TypeScript 단일 언어 | accepted | 2026-08-19 | system, frontend, backend |
| ADR-002 | 이벤트 전달: Redis Streams 시작, Kafka 교체 가능, Filebeat는 원본 레인 한정 | accepted | 2026-08-19 | system, async, infrastructure |
| ADR-003 | Elasticsearch 인덱스 전략: 엔티티 고정 인덱스 + 원본 아카이브만 ILM | accepted | 2026-08-19 | data, system, observability |
| ADR-004 | PostgreSQL을 시스템 오브 레코드로, Elasticsearch를 파생 뷰로 | accepted | 2026-08-19 | data, system, backend |
| ADR-005 | 커밋 그래프 접근: blobless 미러 우선, GitHub API 폴백 | accepted | 2026-08-19 | backend, async, infrastructure |
| ADR-006 | UI는 사내 Conductor 디자인 시스템만 사용 | accepted | 2026-08-19 | frontend, derived UI |
| ADR-007 | 머지 시퀀스는 first-parent 서수, 에폭으로 재작성 처리 | accepted | 2026-08-19 | data, backend, api |
| ADR-008 | 권한은 서버 측 강제 필터로 결합, 기본 거부 | accepted | 2026-08-19 | security, backend, api |
| ADR-009 | 관계는 별도 간선 인덱스 + 핫패스 비정규화 | accepted | 2026-08-19 | data, backend, api |
| ADR-010 | 페이지네이션은 `search_after` 커서 전용 | accepted | 2026-08-19 | api, frontend |
| ADR-011 | 프런트엔드는 Next.js App Router + 서버 라우트 프록시 | accepted | 2026-08-19 | frontend, security |
| ADR-012 | 축약 SHA 검색은 keyword prefix, 최소 7자 | accepted | 2026-08-19 | data, api |

## ADR-001 전 계층 TypeScript 단일 언어

### Context

수집 게이트웨이는 IO 바운드 고동시성 서비스, 워커는 외부 API 호출과 git 실행이 섞인 배치, 검색 API는 질의 변환 서비스, 프런트엔드는 React 대시보드다. 언어를 나누면 각 계층에 최적 도구를 고를 수 있지만, 도메인 타입(PR, 커밋, 시퀀스 공간, 관계 간선, 질의 AST)이 계층마다 재정의되어 표류한다. 사내 `design-system`도 TypeScript다.

### Options

1. **전 계층 TypeScript** — 도메인 타입·질의 AST·DTO를 워크스페이스 패키지로 공유.
2. **Go 게이트웨이 + TypeScript 나머지** — 수신 성능 우위. 대신 이벤트 스키마를 두 언어로 유지.
3. **Python 워커 + TypeScript 나머지** — 데이터 처리 생태계 우위. 대신 도메인 타입 3중 정의.

### Decision

전 계층 TypeScript(Node 20+, pnpm 워크스페이스). 게이트웨이는 Fastify, 워커는 순수 Node 프로세스, 검색 API는 Fastify, 프런트엔드는 Next.js.

핵심 공유 패키지:

- `@prs/domain` — 도메인 타입, 시퀀스 공간, 관계 유형, 상수
- `@prs/query` — 구조화 질의 파서와 AST (서버 파싱, 클라이언트 검증에 동일 코드 사용)
- `@prs/contracts` — API DTO와 오류 코드
- `@prs/es` — Elasticsearch 매핑 정의와 질의 빌더

### Consequences

- Positive: 질의 문법이 클라이언트·서버에서 같은 파서를 쓰므로 문법 표류가 구조적으로 불가능하다. DTO 변경이 컴파일 오류로 드러난다. Conductor와 동일 생태계라 도구 체인이 하나다.
- Negative: 수신 게이트웨이의 단일 프로세스 처리량이 Go보다 낮다. 워커의 CPU 바운드 작업(patch-id 대량 계산)에 불리하다.
- Follow-up: 게이트웨이는 클러스터 모드 + 수평 확장으로 대응한다. NFR-002의 버스트 2000 이벤트/초를 부하 시험으로 검증하고, 미달 시 게이트웨이만 별도 ADR로 재검토한다. patch-id는 `git patch-id` 프로세스에 위임하므로 Node의 CPU 특성 영향이 작다.

## ADR-002 이벤트 전달: Redis Streams 시작, Kafka 교체 가능, Filebeat는 원본 레인 한정

### Context

이 결정은 프로젝트 착수 시 가장 논쟁이 많았던 지점이다. 후보는 셋이었다.

1. 웹훅 payload가 이미 JSON이니 **Filebeat 또는 Logstash로 Elasticsearch에 직접 적재**한다.
2. **Kafka**를 두고 파티션별 순서와 재생을 보장한다.
3. 가벼운 **큐(Redis Streams / BullMQ / pg-boss)** 로 시작한다.

핵심은 엔티티 파이프라인이 무엇을 필요로 하는가다. 시스템 아키텍처 2장의 세 가지 사실을 대입하면:

| 요구 | Filebeat | Logstash | Redis Streams + 워커 | Kafka + 워커 |
| --- | --- | --- | --- | --- |
| GitHub API 보강 호출 (FR-ING-004) | 불가 | `http` 필터로 가능하나 rate limit 인지·백오프·토큰 풀 구현 불가 | 가능 | 가능 |
| (저장소, 브랜치) 단위 순서 보장 (FR-SEQ-001) | 불가 | 불가 | 가능 (키별 소비 + advisory lock) | 가능 (파티션 키) |
| 서수 채번용 트랜잭셔널 상태 | 불가 | 불가 | 가능 (PostgreSQL) | 가능 (PostgreSQL) |
| 10개 이상 이벤트에 걸친 부분 업서트 (FR-ING-005) | `index` 액션만 — 전체 덮어쓰기 | `update` + `doc_as_upsert` 가능하나 버전 조건부 갱신 불가 | 가능 | 가능 |
| 관계 그래프 파생 (FR-REL-003~006) | 불가 | 불가 | 가능 | 가능 |
| 전량 재생(매핑 변경 시) | 불가 | 불가 | 아웃박스 재적재로 가능 | 네이티브 |
| 운영 부담 | 매우 낮음 | 중간 | 낮음 | 높음 |

결론은 명확하다. **엔티티 레인은 shipper 계층으로 구현할 수 없다.** 보강·순서·상태·파생 넷 중 하나도 만족하지 못한다.

반대로 **원본 이벤트 아카이브 레인은 Filebeat에 정확히 맞는 일이다.** 불변, 무상태, 순서 무관, append-only. 애플리케이션이 이 일을 하면 오히려 손해다.

Kafka와 Redis Streams 사이는 규모 문제다. NFR-002의 목표는 지속 200 이벤트/초다. 이 수준에서 Kafka의 이점(다중 소비자 그룹, 장기 보존 로그, 파티션 재분배)은 대부분 쓰이지 않는 반면, 브로커 운영·모니터링·업그레이드 부담은 즉시 발생한다. 그리고 이 시스템에서 "재생"의 진짜 소스는 Kafka 로그가 아니라 PostgreSQL의 `raw_event`다(ADR-004). Kafka가 없어도 전량 재구성이 가능하다.

### Options

1. Filebeat/Logstash 직접 색인 단독.
2. Kafka 즉시 도입.
3. Redis Streams + `EventBus` 포트 추상화 + 원본 레인 Filebeat.

### Decision

**옵션 3.** 두 레인으로 분리한다.

- **레인 A (엔티티)**: `ingest-gateway` → PostgreSQL `raw_event` INSERT(아웃박스 포함) → Redis Streams enqueue → `pipeline-worker` → Elasticsearch 엔티티 인덱스. 파티션 키는 `repository_id`.
- **레인 B (원본 아카이브)**: `ingest-gateway`가 NDJSON 파일에 append → Filebeat → Elasticsearch 아카이브 인덱스(ILM 적용).

전달 계층은 `EventBus` 포트 뒤에 둔다.

```ts
interface EventBus {
  publish(topic: string, partitionKey: string, message: EventEnvelope): Promise<void>;
  subscribe(topic: string, group: string, handler: EventHandler): Promise<Subscription>;
}
```

`RedisStreamsEventBus`로 시작하고, 아래 전환 임계 중 하나를 넘으면 `KafkaEventBus`를 구현해 교체한다. 워커 코드는 변경하지 않는다.

**Kafka 전환 임계 (하나라도 충족 시 전환 검토 — OD-006):**

- 실측 피크 유입이 지속 200 이벤트/초를 넘는다.
- 파이프라인 외 소비자가 2개 이상 필요하다.
- 큐 보존 기간이 24시간을 넘어야 한다.
- Redis 메모리 압박으로 큐 트리밍이 잦다.

### Consequences

- Positive: 초기 운영 부담이 낮다. 원본 아카이브가 애플리케이션과 독립이라 애플리케이션 장애 시에도 원본이 남는다. 전달 계층 교체가 어댑터 1개 추가로 끝난다. "Filebeat로 바로 넣자"는 직관을 버리지 않고 맞는 자리에 배치했다.
- Negative: Redis Streams는 Kafka만큼의 내구성 보장이 없다. 소비자 그룹 관리·재분배 기능이 약하다.
- Follow-up: Redis 유실 대비로 아웃박스 재적재 잡(`JOB-ING-007`)을 만든다. `raw_event`에 `queued_at`/`processed_at`을 두고, 일정 시간 미처리 행을 재적재한다. 이 장치가 있으면 Redis 유실이 데이터 유실로 이어지지 않는다.
- Follow-up: `EventBus` 계약 테스트를 만들어 Redis 어댑터와 (장래) Kafka 어댑터가 같은 테스트를 통과하게 한다.

## ADR-003 Elasticsearch 인덱스 전략: 엔티티 고정 인덱스 + 원본 아카이브만 ILM

### Context

로그성 데이터의 표준 관행은 월별·일별 시계열 인덱스에 ILM(hot/warm/delete)을 적용하는 것이다. 그러나 이 제품의 데이터는 로그가 아니다.

- **PR 문서는 가변이다.** 생성 후 머지까지 여러 번 갱신된다. 시계열 인덱스에서는 갱신 대상 인덱스를 먼저 찾아야 하고, PR이 월 경계를 넘어 열려 있으면 어느 인덱스에 있는지가 시각 필드만으로 결정되지 않는다.
- **주요 조회가 시각 축이 아니다.** 이 제품의 1순위 질의는 "SHA로 PR 찾기"다. 시계열 인덱스에서는 시각을 모르므로 전 인덱스 팬아웃이 된다. 5년치 월별 인덱스면 60개 인덱스 팬아웃이다.
- **규모가 로그 규모가 아니다.** NFR-003 기준 PR 500만, 커밋 5000만이다. 단일 인덱스가 감당하는 범위다.

반면 원본 웹훅 이벤트(5억 건)는 정확히 로그다. 불변, append-only, 시각 축 조회, 보존 기간 후 삭제.

### Options

1. 모든 인덱스에 월별 ILM 적용.
2. 모든 인덱스를 고정으로 두고 ILM 미적용.
3. 엔티티는 고정 인덱스, 원본 아카이브만 ILM 시계열.

### Decision

**옵션 3.**

**엔티티 인덱스 (고정, 별칭 참조, ILM 없음)**

| 별칭 | 실제 인덱스 | 문서 | 샤드 | 라우팅 |
| --- | --- | --- | --- | --- |
| `prs-pull-requests` | `prs-pull-requests-v1` | PR | 6 | `repository_id` |
| `prs-commits` | `prs-commits-v1` | 커밋 | 12 | `repository_id` |
| `prs-links` | `prs-links-v1` | 관계 간선 | 12 | `repository_id` |
| `prs-releases` | `prs-releases-v1` | 릴리스 | 2 | `repository_id` |

- 문서 ID는 결정론적이다: PR은 `{repository_id}:{pr_number}`, 커밋은 `{repository_id}:{commit_sha}`. 같은 입력이면 같은 문서를 갱신한다 (FR-ING-002 AC-5).
- `index.sort.field: ["repository_id", "merge_seq"]`, `order: ["asc", "desc"]`를 설정해 시퀀스 범위 질의와 기본 정렬에서 조기 종료를 얻는다.
- `_routing`을 `repository_id`로 지정해 저장소 범위 질의를 단일 샤드로 좁힌다. 극단적으로 큰 저장소가 샤드 편향을 만들면 그 저장소만 라우팅에서 제외하는 예외 목록을 둔다.
- 매핑 변경은 새 버전 인덱스(`-v2`) 생성 → 재색인 → 별칭 원자 전환으로 처리한다 (FR-ING-008).

**아카이브 인덱스 (시계열, ILM 적용)**

| 별칭 | 패턴 | ILM |
| --- | --- | --- |
| `prs-raw-events` | `prs-raw-events-{yyyy.MM}` | hot 7일 → warm 90일 → delete (보존 기간은 OD-003) |

**집계 부하 격리**

- 검색 엔드포인트와 집계 엔드포인트를 분리해, 집계 지연이 목록 응답을 막지 않는다 (FR-STAT-006 AC-4).
- 집계 대상 100만 건 초과 시 `terms` 집계에 `execution_hint`와 샘플링을 적용하고 `approximate: true`를 반환한다.
- 전용 클러스터(OD-006 (a))로 가면 코디네이팅 노드를 분리한다. 공용 클러스터면 검색 스레드풀 상한과 서킷 브레이커 설정으로 격리한다.

### Consequences

- Positive: SHA→PR 단건 조회가 단일 인덱스 조회다. 부분 업서트가 인덱스 해석 없이 문서 ID만으로 동작한다. 원본은 ILM으로 자동 정리된다.
- Negative: 엔티티 인덱스가 시간이 지나며 계속 커진다. 오래된 데이터를 자동으로 떨궈내지 못한다.
- Follow-up: 저장소 폐기 시 해당 문서를 삭제하는 정리 잡을 둔다. 문서 수가 NFR-003 설계치의 70%를 넘으면 샤드 수 재산정을 위한 재색인을 계획한다.
- Follow-up: 실측(OD-007) 후 샤드 수를 재검토한다. 위 값은 샤드당 30~50GB 가정에서 나온 초기값이다.

## ADR-004 PostgreSQL을 시스템 오브 레코드로, Elasticsearch를 파생 뷰로

### Context

Elasticsearch만으로 구성하면 스토어가 하나라 단순하다. 그러나 다음이 걸린다.

- **시퀀스 채번에는 트랜잭션이 필요하다.** (저장소, 브랜치) 단위 직렬 실행 보장과 조건부 갱신이 필요한데 Elasticsearch에는 트랜잭션도 advisory lock도 없다.
- **매핑 변경이 일상이다.** 검색 제품에서 분석기·필드 추가는 반복된다. 원본이 별도로 없으면 매핑 변경마다 GitHub API 전량 재조회가 필요하고, 이는 rate limit 때문에 며칠이 걸린다.
- **RPO 0 요구(NFR-004)** 는 "durable 저장 후 202 응답"을 요구한다. Elasticsearch에 쓰고 202를 반환하려면 색인 완료를 기다려야 해서 수신 응답 시간(p95 300ms)을 만족하기 어렵다.

### Options

1. Elasticsearch 단독.
2. PostgreSQL을 SoR, Elasticsearch를 파생 뷰.
3. 객체 스토리지를 원본 저장소로, PostgreSQL은 상태만.

### Decision

**옵션 2.** PostgreSQL이 시스템 오브 레코드다.

| PostgreSQL 소유 | Elasticsearch 소유 |
| --- | --- |
| `raw_event` (원본 payload, 멱등 키) | PR 검색 문서 |
| `merge_sequence`, `sequence_space` (서수, 에폭) | 커밋 검색 문서 |
| `repository` (등록, 대상 브랜치, 미러 설정) | 관계 간선 문서 |
| `job`, `dead_letter` (잡·실패 상태) | 릴리스 문서 |
| `saved_search`, `bisect_session`, `safe_marker` | 원본 이벤트 아카이브 문서 |
| `audit_record` | |
| `permission_cache` (Redis 미스 시 백업) | |

불변 조건: **Elasticsearch의 모든 엔티티 문서는 PostgreSQL 데이터만으로 재구성 가능해야 한다.** 이를 자동 테스트로 검증한다 (FR-ING-003 AC-3).

### Consequences

- Positive: 매핑 변경이 위험 없는 일상 작업이 된다. RPO 0이 성립한다. 시퀀스 채번이 정확해진다. Elasticsearch 장애가 데이터 손실이 아니라 검색 중단으로 격리된다.
- Negative: 스토어가 둘이라 운영 대상이 늘고, 두 저장소 사이 정합성 감시가 필요하다.
- Follow-up: 정합성 감시 잡(`JOB-ING-008`)이 PostgreSQL 대비 Elasticsearch 문서 수와 표본 내용을 주기 대조한다.
- Follow-up: `raw_event` 테이블을 수신 시각 기준 월별 파티션으로 만들어 보존 기간 만료 삭제를 파티션 드롭으로 처리한다.

## ADR-005 커밋 그래프 접근: blobless 미러 우선, GitHub API 폴백

### Context

머지 시퀀스는 first-parent 체인을 걸어야 나온다 (ADR-007). 접근 방법은 둘이다.

- **GitHub REST API**: `GET /repos/{o}/{r}/commits?sha=<branch>`. 페이지당 100건, rate limit 소모. 반환 순서가 first-parent 체인임을 계약으로 보장하지 않으므로 각 커밋의 `parents[0]`을 따라 직접 체인을 재구성해야 한다. patch-id는 계산할 수 없다.
- **로컬 git 미러**: `git rev-list --first-parent --reverse A..B`가 정확히 필요한 것을 준다. `git patch-id`로 체리픽 탐지도 가능하다 (FR-REL-005). rate limit을 소모하지 않는다.

미러의 부담은 디스크다. 다만 이 시스템은 **파일 내용을 전혀 필요로 하지 않는다**. 커밋 그래프와 메타데이터만 쓴다. `--filter=blob:none` partial clone이 정확히 이 경우를 위한 기능이며, blob을 받지 않으므로 저장소 크기가 통상 전체 클론의 몇 퍼센트로 줄어든다.

### Options

1. GitHub API 단독.
2. 전체 미러 클론.
3. blobless partial mirror 우선 + API 폴백.

### Decision

**옵션 3.**

```bash
git clone --mirror --filter=blob:none <repo-url> /mirrors/<repository_id>.git
# push 이벤트 수신 시
git -C /mirrors/<repository_id>.git fetch --prune origin
git -C /mirrors/<repository_id>.git rev-list --first-parent --reverse <last_head>..<new_head>
```

- 미러 사용 여부는 저장소별 설정이다 (FR-ING-009 AC-1). 보안 정책이 불허하면(OD-001 (b)) 저장소 단위로 API 폴백 모드로 동작한다.
- API 폴백 모드에서는 `parents[0]`을 따라 체인을 재구성하고, patch-id 기반 체리픽 탐지를 비활성화하며 문서에 `patch_id_unavailable: true`를 표시한다 (FR-REL-005 AC-5).
- 미러는 읽기 전용이다. PR Search는 절대 push하지 않는다.
- 미러 볼륨은 재구성 가능한 캐시다. 백업 대상이 아니며, 손실 시 재클론한다.

### Consequences

- Positive: 시퀀스 계산이 rate limit과 무관해진다. patch-id 체리픽 탐지가 가능해진다. 대규모 백필이 API 소모 없이 진행된다.
- Negative: 저장소 수에 비례하는 디스크가 필요하고(3000 저장소 기준 용량은 인프라 문서에서 산정), 미러 동기화 실패라는 새 실패 모드가 생긴다.
- Follow-up: 미러 동기화 실패 시 시퀀스 공간을 `stale`로 표시하고 재시도한다 (FR-SEQ-001 예외 처리).
- Follow-up: 미러 디스크 사용률을 SLI로 감시하고 85% 임계에서 경보한다.
- Follow-up: OD-001 결정 전까지 두 경로 모두 구현·테스트한다. 폴백 경로를 나중에 만들지 않는다.

## ADR-006 UI는 사내 Conductor 디자인 시스템만 사용

### Context

사내 `design-system`(Conductor)은 `@conductor-by-89soone/tokens` → `css` → `react` 방향의 3계층 패키지를 제공한다. Radix 기반 React 프리미티브, 3계층 토큰, 다크 기준 + 라이트 팔레트, 접근성 테스트를 갖추고 있다. 사용을 지시받았다.

### Options

1. Conductor 단독.
2. Conductor + 보조 UI 라이브러리(테이블·차트 등).
3. 자체 컴포넌트 구축.

### Decision

**옵션 1.** UI 프리미티브는 Conductor만 사용한다.

- `@conductor-by-89soone/css`를 애플리케이션 진입점에서 1회 import한다.
- 제품 컴포넌트(`C-###`)는 Conductor 프리미티브의 조합이며 스타일을 새로 정의하지 않는다.
- 제품 코드에 리터럴 색상값을 두지 않는다. 정적 검사로 강제한다.
- Conductor에 없는 프리미티브(차트, 그래프 캔버스)는 Conductor semantic 토큰만 사용해 구현하고, `DEV-###`로 기록해 design-system 기여를 제안한다.
- Conductor의 `Status` / `Tone` / `Severity` 어휘를 그대로 쓴다. 제품 고유 상태 어휘를 새로 만들지 않는다.

### Consequences

- Positive: 사내 제품 간 시각 일관성. 접근성·대비 검증을 Conductor 도구(`checkContrast`, axe 시나리오)로 재사용한다. 테마 전환이 무료다.
- Negative: 차트·그래프를 직접 만들어야 한다. Conductor 릴리스 주기에 결합된다.
- Follow-up: Conductor 버전을 워크스페이스에서 고정하고 갱신을 계획적으로 수행한다.
- Follow-up: 차트 컴포넌트(C-033, C-034)는 Conductor 토큰만 참조하도록 코드 리뷰에서 확인한다.

## ADR-007 머지 시퀀스는 first-parent 서수, 에폭으로 재작성 처리

### Context

Perforce Changelist 번호는 submit 시점 채번이라 전역 단조 증가한다. GitHub에는 등가물이 없다. 후보는 셋이었다.

1. **머지 시각 정렬** — 서수가 아니라 연속 값이다. "1280번부터 1342번까지"라는 이산적 지시를 만들 수 없고, 동시 머지 시 순서가 흔들린다.
2. **수신 시점 카운터** — 웹훅 도착 순서로 번호를 매긴다. 구현이 가장 쉽지만, 웹훅 도착 순서가 머지 순서와 다를 수 있고, PR을 거치지 않은 직접 푸시 커밋에는 번호가 붙지 않으며, 웹훅 유실 시 번호가 건너뛴다. 무엇보다 이 번호는 **git 히스토리와 대조 검증할 수 없다.**
3. **first-parent 히스토리 서수** — 대상 브랜치를 루트부터 first-parent로 걸으며 1, 2, 3…을 부여한다.

옵션 3만이 "번호 순서 = 실제 반영 순서"를 **git 히스토리로 증명 가능하게** 만든다. `git log --first-parent <tagA>..<tagB>`의 결과와 시퀀스 범위 조회 결과가 항상 일치해야 한다는 회귀 검수 항목이 성립한다(QA 6장). 이 검증 가능성이 P4 CL이 주던 신뢰의 본질이다.

옵션 3의 약점은 히스토리 재작성이다. 대상 브랜치에 강제 푸시가 일어나면 서수가 밀린다. 이를 감추면 과거에 인용된 범위가 조용히 다른 것을 가리키게 되어, 조사 도구로서 가장 나쁜 실패가 된다.

### Decision

**옵션 3 + 에폭.**

```
merge_seq = git rev-list --first-parent --reverse <base_branch> 에서의 1-기반 위치
시퀀스 공간 = (repository_id, base_branch)
시퀀스 에폭 = 해당 공간의 재채번 세대 번호
```

규칙:

1. 시퀀스는 (저장소, 브랜치)마다 독립이다. 저장소 간 비교는 무의미하므로 전역 시퀀스를 만들지 않는다 (F-SEQ-008 제외).
2. 채번은 증분이다. 저장된 `head_sha`, `head_seq`에서 `<head_sha>..<new_head>` 구간만 처리한다.
3. 매 채번 전에 `git merge-base --is-ancestor <저장 head> <새 head>`로 조상 관계를 확인한다.
4. 조상이 아니면 히스토리 재작성이다. merge-base 이후를 무효 표시하고, `seq_epoch += 1` 후 재채번하며, 알림과 감사 기록을 남긴다 (FR-SEQ-005).
5. 시퀀스를 인용하는 모든 저장물(안전 구간 표식, 저장된 검색의 `seq:` 조건, 공유 URL)은 에폭을 함께 저장한다. 에폭이 다르면 무효로 표시하고 자동 재해석하지 않는다.
6. 범위는 반개구간 `(from, to]`다. `git log A..B`의 의미와 일치시켜, 도구 결과와 사람의 git 명령 결과가 어긋나지 않게 한다.
7. PR을 거치지 않은 직접 푸시 커밋도 시퀀스를 받는다. 그렇지 않으면 시퀀스가 브랜치 히스토리와 1:1 대응하지 않게 되어 검증 가능성이 깨진다.

### Consequences

- Positive: 시퀀스가 git 히스토리에서 결정론적으로 파생되므로 언제든 대조 검증 가능하다. 재채번이 멱등이다. 웹훅을 놓쳐도 다음 채번이 자동으로 메운다.
- Negative: 강제 푸시 시 과거 범위 인용이 무효가 된다. 첫 채번(백필)이 저장소 전체 히스토리 순회를 요구한다.
- Follow-up: 무효화는 감추지 말고 화면에 경고로 드러낸다 (`epoch_stale` 상태).
- Follow-up: 대상 브랜치에 보호 브랜치 정책(강제 푸시 금지)을 적용하도록 조직에 권고한다. 이는 제품 밖 운영 권고다.
- Follow-up: 첫 채번은 백필 잡으로 처리하고 진행률을 보고한다.

## ADR-008 권한은 서버 측 강제 필터로 결합, 기본 거부

### Context

사내 GHE에는 팀·개인별로 접근이 제한된 저장소가 있다. 검색 시스템이 이를 반영하지 않으면 GHE의 접근 통제를 우회하는 구멍이 된다. 검색 결과 건수만으로도 정보가 새므로, 문서를 숨기는 것으로는 부족하고 집계 건수에서도 제외해야 한다.

### Options

1. 애플리케이션이 결과를 받은 뒤 필터링 — 건수·집계가 오염되고 페이지네이션이 깨진다.
2. Elasticsearch 문서에 ACL 필드를 두고 질의에 조건을 결합.
3. 사용자별 별도 인덱스 — 문서 폭증.

### Decision

**옵션 2 + 단일 강제 지점.**

- 모든 엔티티 문서에 `repository_id`를 두고, 조회 시 `filter: { terms: { repository_id: <접근 범위> } }`를 결합한다.
- 결합은 질의 빌더의 단 한 함수에서 일어난다. 이 함수를 거치지 않는 Elasticsearch 호출 경로를 만들지 않으며, 이를 아키텍처 테스트로 강제한다.
- 접근 범위를 확인할 수 없으면 결과를 반환하지 않는다(기본 거부). 부분 결과를 내지 않는다 (FR-AUTH-002 AC-3).
- 접근 범위 밖 문서 직접 조회는 404다. 403이 아니다. 403은 "존재한다"를 노출한다 (AC-4).
- 접근 범위가 500 저장소를 넘으면 `terms` 목록 대신 조직·팀 조건으로 치환해 질의 크기를 제한한다 (AC-6). 이를 위해 문서에 `org_id`, `visibility`, `allowed_team_ids`를 함께 저장한다.
- 접근 범위 캐시는 Redis, TTL 5분. `member`/`team`/`repository` 웹훅 이벤트 수신 시 즉시 무효화한다 (FR-AUTH-003).

### Consequences

- Positive: 건수·집계·패싯·페이지네이션이 모두 일관되게 권한을 반영한다. 우회 경로가 구조적으로 없다.
- Negative: 접근 범위가 큰 사용자의 질의가 커진다. 권한 변경 반영에 최대 5분 지연이 있다.
- Follow-up: 역할 6종 × 화면 13종 권한 매트릭스 자동 테스트를 릴리스 게이트로 만든다 (NFR-005).
- Follow-up: 대량 무효화 시 GHE 조회 폭주를 막기 위해 사용자 단위 요청 병합과 동시 요청 상한(기본 20)을 둔다.

## ADR-009 관계는 별도 간선 인덱스 + 핫패스 비정규화

### Context

관계는 PR↔커밋↔릴리스↔이슈 사이의 다대다이며 유형·방향·신뢰도·근거를 가진다. 저장 방식은 셋이다.

1. PR/커밋 문서 안에 중첩 배열 — 조회는 빠르나 양방향 탐색이 어렵고, 대상이 나중에 색인되는 미해결 참조를 갱신하려면 양쪽 문서를 모두 고쳐야 한다.
2. 별도 간선 인덱스 — 양방향 탐색과 미해결 참조 갱신이 자연스럽다. 대신 상세 화면마다 추가 조회가 든다.
3. 그래프 데이터베이스 — 깊은 탐색에 유리하나 스토어가 하나 더 는다.

### Decision

**옵션 2 + 핫패스 비정규화.**

`prs-links` 인덱스의 문서 구조:

```
link_id, repository_id,
from_type, from_id, to_type, to_id,
link_type, confidence, evidence, direction,
resolved (bool), created_at
```

- 간선은 정방향 1건만 저장하고, 역방향 조회는 `to_id`로 질의한다. 두 벌 저장하지 않는다.
- 관계 그래프 탐색(FR-REL-008)은 깊이만큼 반복 질의한다. 깊이 최대 3, 노드 상한 300이므로 최대 3회 질의로 끝난다. 그래프 DB가 필요한 규모가 아니다.
- **핫패스 비정규화**: PR·커밋 문서에 `link_summary` 객체(`has_revert`, `has_cherry_pick`, `reverted_by_count`, `reference_count`)를 함께 저장한다. 검색 결과 목록의 관계 배지(C-015)와 `is:reverted` 필터(FR-REL-004 AC-4)가 간선 인덱스 조회 없이 동작한다.
- 미해결 참조(대상 미색인)는 `resolved: false`로 저장하고, 대상 색인 시 해결 상태로 갱신한다 (FR-REL-003 AC-3).

### Consequences

- Positive: 양방향 조회가 대칭적이다. 미해결 참조 해결이 간선 1건 갱신으로 끝난다. 목록 화면이 빠르다.
- Negative: `link_summary` 비정규화 필드가 간선 변경 시 갱신되어야 하므로 일관성 지점이 하나 는다.
- Follow-up: `link_summary` 갱신은 `link` 워커가 간선 쓰기와 같은 벌크 요청에 포함한다.
- Follow-up: 정합성 감시 잡이 `link_summary`와 간선 인덱스 실제 값을 표본 대조한다.

## ADR-010 페이지네이션은 `search_after` 커서 전용

### Context

Elasticsearch의 `from`/`size` 오프셋 페이징은 `index.max_result_window`(기본 10000)를 넘으면 실패하고, 깊은 오프셋에서 코디네이팅 노드 메모리를 소모한다. 이 제품은 수만 건 결과를 끝까지 훑는 사용(구간 조사)이 정상 시나리오다.

### Decision

`search_after` 커서 전용. 오프셋 파라미터를 API에 아예 두지 않는다.

- 커서는 정렬 키 값 배열과 질의 지문(질의 문자열·정렬·접근 범위의 해시)을 봉인한 불투명 문자열이다.
- 질의 지문이 다르면 `cursor_query_mismatch`를 반환한다 (FR-SRCH-008 AC-3). 조건이 바뀐 채 이어서 페이징하면 결과 집합이 조용히 어긋나기 때문이다.
- 모든 정렬에 문서 ID를 마지막 정렬 키로 추가해 결정론적 순서를 보장한다 (FR-SRCH-007 AC-4). 이것이 없으면 동점 문서에서 커서 페이징이 항목을 건너뛰거나 중복한다.
- UI에 페이지 번호를 두지 않는다 (C-016).
- 총 건수는 `track_total_hits`를 상한값(예: 10000)으로 두고, 초과 시 "10,000건 이상"으로 표시한다. 정확한 총계가 필요한 집계는 별도 엔드포인트를 쓴다.

### Consequences

- Positive: 결과 크기와 무관하게 일정한 성능. 깊은 페이징 실패가 없다.
- Negative: 임의 페이지 점프가 불가능하다. 사용자가 "3페이지로" 할 수 없다.
- Follow-up: 임의 위치 접근이 필요한 사용은 정렬·필터 조정으로 유도한다. 구간 조사에서는 시퀀스 앵커가 그 역할을 한다.

## ADR-011 프런트엔드는 Next.js App Router + 서버 라우트 프록시

### Context

대시보드는 인증이 필요하고, 세션 쿠키를 다루며, 딥링크 공유가 핵심 사용 방식이다. 브라우저가 `search-api`를 직접 호출하면 CORS·토큰 노출·CSRF를 각각 처리해야 한다.

### Decision

Next.js App Router. 브라우저는 항상 Next.js 서버 라우트(`/api/*`)를 호출하고, 서버 라우트가 세션을 검증해 `search-api`로 프록시한다.

- 세션 쿠키는 HttpOnly·Secure·SameSite=Lax. 브라우저 JavaScript가 토큰을 보지 않는다 (FR-AUTH-001 AC-2).
- 화면 상태의 단일 진실은 URL 질의 파라미터다. 필터 조작은 URL을 갱신하고, URL 변경이 조회를 유발한다. 두 방향 상태를 따로 두지 않는다.
- 서버 컴포넌트는 최초 렌더의 데이터 페치에 사용하고, 필터·정렬·페이징 같은 상호작용은 클라이언트에서 URL 갱신 후 라우트 핸들러로 조회한다.
- 서버 상태(검색 결과)와 클라이언트 상태(펼침, 선택)를 분리한다. 서버 상태를 클라이언트 스토어에 복제하지 않는다.

### Consequences

- Positive: CORS가 필요 없다. 토큰이 브라우저에 노출되지 않는다. 딥링크가 자연히 성립한다.
- Negative: 홉이 하나 늘어 지연이 소폭 증가한다. Next.js 서버가 배포 단위가 된다.
- Follow-up: 프록시 홉의 추가 지연을 NFR-001 예산에 포함해 부하 시험한다.

## ADR-012 축약 SHA 검색은 keyword prefix, 최소 7자

### Context

축약 SHA 검색(FR-SRCH-004)의 구현 후보는 셋이다.

1. `keyword` 필드에 `prefix` 질의.
2. `edge_ngram` 분석 필드를 별도로 색인.
3. `text` 필드에 `index_prefixes` 매핑 옵션.

핵심은 선택도다. SHA는 균등 분포 16진 문자열이다. 7자 접두는 16^7 ≈ 2.7억 분의 1 공간이다. 커밋 5000만 건(NFR-003)이어도 7자 접두에 일치하는 term은 통상 1개이며, `prefix` 질의는 term 사전에서 정렬된 범위를 seek하므로 이 범위 스캔은 매우 짧다. 즉 옵션 1로 충분하다.

옵션 2는 색인 크기를 크게 늘린다. SHA 하나당 7~40자 접두 34개를 색인해야 한다. 5000만 커밋이면 17억 term이다. 얻는 것은 6자 이하 검색 지원뿐인데, 6자 이하는 충돌이 흔해 검색 결과로서 유용하지 않다.

7자 하한에는 근거가 있다. git의 기본 축약 길이가 7자이고, git 자신도 저장소가 커지면 축약 길이를 늘린다. 6자 이하를 지원하면 결과 50건 절삭(AC-3)에 계속 걸려 사용자 경험이 오히려 나빠진다.

### Decision

**옵션 1.** `commit_sha`를 `keyword`로 매핑하고 `prefix` 질의를 사용한다. 최소 7자를 클라이언트·서버 양쪽에서 강제한다.

```
"commit_sha": { "type": "keyword", "normalizer": "lowercase_normalizer" }
```

- 입력은 소문자로 정규화한다 (AC-4).
- 저장소 조건이 함께 있으면 라우팅으로 단일 샤드에 좁혀 더 빨라진다.
- 결과 50건 초과 시 절삭하고 조건 추가를 안내한다 (AC-3).
- 3초 타임아웃을 걸고 초과 시 `search_timeout`을 반환한다 (예외 처리).

### Consequences

- Positive: 추가 색인 비용 0. 매핑이 단순하다. 40자 전체 SHA 조회는 `term` 질의로 더 빠르다.
- Negative: 6자 이하 검색을 지원하지 않는다.
- Follow-up: 부하 시험에서 7자 접두 질의의 p95를 측정해 NFR-001의 200ms를 만족하는지 확인한다. 미달 시 옵션 3(`index_prefixes`)을 별도 ADR로 검토한다.
