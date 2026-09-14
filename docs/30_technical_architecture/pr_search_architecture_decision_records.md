# PR Search Architecture Decision Records

> 상태: review | 버전: v0.10 | 갱신일: 2026-09-14

CR-079: ADR-023을 아래 목록과 상세 설계에 추가한다. 새 M 번호의 적용과 세부 계약은 [상세 설계](pr_search_wp074_design.md) 전문, 선택 대안은 4절, Agent-Initiated Decisions는 12절이 소유한다. 직접 부재 증거의 가용성 한계(DEV-581)는 accepted 동작인 pending과 별개인 검증 조건이며 해결됐다고 간주하지 않는다.

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
| ADR-013 | GitHub Operations Plane을 Search/Data Plane과 분리 | accepted | 2026-08-20 | system, security, infrastructure |
| ADR-014 | 사용자 주도 GitHub 작업은 별도 Operations App + 위임 사용자 토큰 | accepted | 2026-08-20 | security, backend, api |
| ADR-015 | 버전 고정 gh capability manifest + 생성형 command UI | accepted | 2026-08-20 | frontend, backend, data |
| ADR-016 | 격리 gh 실행기와 risk/policy/approval 모델 | accepted | 2026-08-20 | infrastructure, security, async |
| ADR-017 | 구조화 gh invocation + 의미 제약 모델을 UI·서버·실행기의 단일 진실로 | accepted | 2026-08-20 | frontend, backend, api, data |
| ADR-018 | gh 출력과 파일은 신뢰할 수 없으며 별도 무해화 경계를 통과한다 | accepted | 2026-08-20 | security, frontend, backend |
| ADR-019 | interactive 명령의 웹 등가 계층과 extension 신뢰 경계 | accepted | 2026-08-20 | frontend, security, backend |
| ADR-020 | typed gh 결과 계약과 capability 데이터흐름 그래프 | accepted | 2026-08-20 | data, frontend, backend, security |
| ADR-021 | 첫 사내 반입은 단일 호스트 프로파일 · 오프라인 번들 · 단방향 다운스트림 계보 | accepted | 2026-09-01 | infrastructure, security, delivery, system |
| ADR-022 | M 넘버 표기는 Data Plane이 수행하는 유일한 자동 GHE 쓰기 | accepted | 2026-09-10 | security, backend, data |
| ADR-023 | squash M 번호의 확정 근거·선행 freshness·영속 복구·인용 안전성 | proposed — 설계 review, DEV-581 증거 게이트 잔존 | 2026-09-11 | WP-074 상세 설계, data, async, API, UI, delivery |

## ADR-023 squash M 번호의 확정 근거와 복구

### Context

CR-079는 사용자 squash-only 지시의 설계 반영이다. DEV-576은 stale mirror를 읽고도 정상으로 종료하는 실행 공백이며 DEV-207의 direct_push는 교정 가능한 역할이므로 영구 skip 증거가 아니다. raw_event outbox는 M 전달을 복구하지 않는다. API-SEQ-007의 code/epoch 생략은 불변 인용과 어긋난다.

### Decision

상세 계약은 [WP-074 설계](pr_search_wp074_design.md) 3~10절이 소유한다. sequence 역할이 freshness를 선행하고 기존 repo/sequence 락 구조와 고정 kind durable work를 사용한다. 번호/체크포인트/work는 한 transaction이다. M 필드의 ES owner를 분리하고 API는 페이지당 DB batch 대조를 한다. 미확정은 뒤 번호를 막으며 API의 공간·코드·epoch 검증을 생략하지 않는다. WP-075와 인증 정책은 범위 밖이다.

### Alternatives and Consequences

webhook 동기 fetch, 독립 소비자 경주, 이벤트 발행만을 복구 근거로 삼는 안을 기각했다. 단일 역할 선행 갱신이 Profile A의 기존 볼륨·읽기 자격을 활용한다. 대가로 repo session lock 동안 connection을 점유하고 영속 메타데이터와 batch DB 조회가 증가한다. Profile B는 실제 volume 부재에 맞춰 API mode로 명시한다. 직접 푸시의 영구 부재 증서는 미확보이므로 production에서는 pending이고 root/direct 뒤 전체 번호가 막힐 수 있다. 근거가 확보되기 전 이 ADR과 WP 전체를 무조건 완료로 승격하지 않는다.

### Verification and Rollback

후속 실행서 T01~T06 및 필수 변이를 적용한다. 이번 세션에서 실제 앱 시험은 NOT RUN이다. additive 앱 rollback을 우선하며 DB down은 번호·증거 복구자료 확보와 새 producer/consumer 중지 후 수행한다. Agent-Initiated Decisions는 상세 설계 12절의 C1~C6을 따른다.

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

**Kafka 전환 임계 (하나라도 충족 시 전환 검토):**

- 실측 피크 유입이 지속 200 이벤트/초를 넘는다.
- 파이프라인 외 소비자가 2개 이상 필요하다.
- 큐 보존 기간이 24시간을 넘어야 한다.
- Redis 메모리 압박으로 큐 트리밍이 잦다.

이 네 가지는 모두 운영 실측으로 판정하는 임계이며 오픈 결정(OD-###)이 아니다. 이전 판에서 이 임계를 OD-006(Elasticsearch 클러스터 형태)에 연결해 둔 것은 참조 오류였고 CR-004에서 정정했다. OD-006은 Elasticsearch 토폴로지 결정이며 이벤트 버스 선택과 무관하다.

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
| `prs-raw-events` | `prs-raw-events-{yyyy.MM}` | hot 7일 → warm 90일 → delete (창 약 97일) |

아카이브 인덱스의 ILM 창은 PostgreSQL `raw_event`의 보존 기간(3년, OD-003)과 **별개 값**이다. FR-ING-010 AC-1이 아카이브 인덱스의 수명 정책을 엔티티 인덱스·원본 레코드와 분리하도록 요구하고, 아카이브는 `raw_event`에서 언제든 재구성할 수 있기 때문이다(백업 대상 아님). 보존 보증은 PostgreSQL이 지고, ES 아카이브는 최근 구간 조회 편의를 위한 파생 사본이다. 이전 판이 이 창을 OD-003에 묶어 둔 것은 참조 오류였고 CR-004에서 정정했다.

**집계 부하 격리**

- 검색 엔드포인트와 집계 엔드포인트를 분리해, 집계 지연이 목록 응답을 막지 않는다 (FR-STAT-006 AC-4).
- 집계 대상 100만 건 초과 시 `terms` 집계에 `execution_hint`와 샘플링을 적용하고 `approximate: true`를 반환한다.
- OD-006 결정(CR-004)에 따라 PR Search 전용 클러스터를 쓴다. 노드는 3개이며 모든 노드가 master/data/ingest 역할을 겸한다. 코디네이팅 전용 노드 분리는 결정된 3노드를 넘는 증설이므로 이번 결정 범위 밖이다 — 집계 부하 격리는 우선 검색 스레드풀 상한과 서킷 브레이커 설정으로 처리하고, 그것으로 부족하면 노드 증설을 별도 CR로 올린다.

### Consequences

- Positive: SHA→PR 단건 조회가 단일 인덱스 조회다. 부분 업서트가 인덱스 해석 없이 문서 ID만으로 동작한다. 원본은 ILM으로 자동 정리된다.
- Negative: 엔티티 인덱스가 시간이 지나며 계속 커진다. 오래된 데이터를 자동으로 떨궈내지 못한다.
- Follow-up: 저장소 폐기 시 해당 문서를 삭제하는 정리 잡을 둔다. 문서 수가 NFR-003 설계치의 70%를 넘으면 샤드 수 재산정을 위한 재색인을 계획한다.
- Follow-up: 위 샤드 수는 샤드당 30~50GB 가정에서 나온 초기값이며 OD-007 결정(CR-004) 이후에도 변경하지 않는다. 워크로드 기준선(1,000 PR/일)은 NFR-003 설계 상한보다 낮아 초기 샤드 수를 줄일 여지가 있으나, 샤드 수 축소는 재색인을 요구하는 비가역 작업이라 상한 기준을 유지하는 편이 안전하다. 재검토 트리거는 실운영 샤드당 크기 실측치이며, 위 Follow-up(설계치 70% 도달)과 같은 재색인 절차를 쓴다.

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

- 미러 사용 여부는 저장소별 설정이다 (FR-ING-009 AC-1). **OD-001은 2026-08-22 CR-024로 (a) 허용으로 닫혔다** — 미러가 기본 경로이고, `mirror_enabled`가 꺼진 저장소만 API 폴백 모드로 동작한다. 폴백은 "결정이 안 나서 남겨 둔 대안"이 아니라 **상시 운영 경로**이므로 계속 구현·시험 대상이다.
- API 폴백 모드에서는 `parents[0]`을 따라 체인을 재구성하고, patch-id 기반 체리픽 탐지를 비활성화하며 문서에 `patch_id_unavailable: no_mirror`를 표시한다 (FR-REL-005 AC-5). **사유를 구분해서 적는다** — `no_mirror`(미러 자체가 없음)와 `blob_fetch_disabled`(미러는 있으나 blob 인출이 꺼져 있음)는 운영자가 해야 할 일이 다르다. 전자는 저장소 설정, 후자는 보안 정책 판단이다.
- 미러는 읽기 전용이다. PR Search는 절대 push하지 않는다.
- **자격 증명을 remote URL에 넣지 않는다 (CR-023, DEV-110).** 넣으면 `.git/config`에 평문으로 남아 볼륨 수명 내내 존재한다. 설치 토큰은 호출마다 `-c http.extraHeader=...`로 넘기며, 그 값은 프로세스 인자라 디스크에 남지 않는다.
- **미러 볼륨 루트는 `MIRROR_ROOT`가 정한다 (CR-023, DEV-109).** 기본값은 아래 예시의 `/mirrors`이고, 저장소 디렉터리 이름은 `<repository_id>.git`이다 — 소유자·이름이 바뀌어도 경로가 따라 바뀌지 않아야 미러를 다시 클론하지 않는다.
- 미러 볼륨은 재구성 가능한 캐시다. 백업 대상이 아니며, 손실 시 재클론한다.

### Consequences

- Positive: 시퀀스 계산이 rate limit과 무관해진다. 대규모 백필이 API 소모 없이 진행된다.
- **정정 (CR-023, DEV-111): patch-id는 공짜가 아니다.** `git patch-id`는 diff를 요구하고 diff는 blob을 요구하는데, blobless 클론에는 blob이 없다. git은 그것을 promisor 원격에서 **지연 인출해 볼륨에 남긴다** — 실측으로 확인했다(커밋 3·트리 3·blob 0이던 미러에서 `diff-tree -p` 한 번에 blob 2개가 생겼다). 즉 patch-id를 쓰는 순간 **THR-015가 근거로 삼은 "blobless라 파일 내용이 없음"이 성립하지 않고**, 5장의 용량 산정(blob 제외 저장소당 50MB)도 시간이 지나며 어긋난다. WP-020은 `GIT_NO_LAZY_FETCH=1`을 **기본**으로 두어 지연 인출을 막고, `patchId`는 `blob_fetch_disabled` 사유와 함께 `null`을 돌려준다 (FR-REL-005 AC-5가 정의한 경로다). `MIRROR_ALLOW_BLOB_FETCH=true`로 켤 수 있으나 위의 대가를 진다. **운영 기본은 꺼짐으로 확정했다 (CR-024, 2026-08-22).** OD-001이 미러를 허용한 근거가 바로 "blobless라 blob이 0건"이라는 실측이므로, 지연 인출을 기본으로 켜면 그 근거를 스스로 무너뜨린다. 켜는 것은 저장소 단위의 **명시적 예외**이며, 그때는 해당 저장소의 미러 용량 산정이 blob을 포함하도록 다시 계산해야 한다.
- Negative: 저장소 수에 비례하는 디스크가 필요하고(3000 저장소 기준 용량은 인프라 문서에서 산정), 미러 동기화 실패라는 새 실패 모드가 생긴다.
- Follow-up: 미러 동기화 실패 시 시퀀스 공간을 `stale`로 표시하고 재시도한다 (FR-SEQ-001 예외 처리).
- Follow-up: 미러 디스크 사용률을 SLI로 감시하고 85% 임계에서 경보한다.
- ~~Follow-up: OD-001 결정 전까지 두 경로 모두 구현·테스트한다.~~ **완료 (CR-024).** OD-001이 (a)로 닫혔지만 **두 경로는 계속 유지한다** — `mirror_enabled`가 저장소별 설정이라 API 폴백은 영구 경로다. `selectCommitGraph`가 그 선택을 한 곳에서 한다.

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

### Clarification (CR-051, 2026-08-28) — 규칙 1과 규칙 5는 질의 계층에도 적용된다

**새 결정이 아니다.** 이 절은 위 규칙 1과 규칙 5가 어디까지 닿는지를 적는다 — DEV-349를 닫으면서
**규칙은 승인돼 있는데 세 저장물 중 둘에 닿지 않고 있었다**는 것이 드러났기 때문이다.

**규칙 1이 질의 문법에도 적용된다.** "시퀀스는 (저장소, 브랜치)마다 독립이고 저장소 간 비교는
무의미하다"는 저장 계층만의 규칙이 아니다. `seq:1200..1350`처럼 공간을 지목하지 않는 조건은
접근 범위의 모든 공간에 걸치고, **같은 번호가 공간마다 다른 커밋을 가리킨 채 한 목록에 섞인다.**
그래서 `seq:` 범위 조건은 `repo:`·`base:`를 하나씩 함께 요구한다 (FR-SRCH-005 AC-7).

이 판단은 이 저장소가 이미 한 번 내린 것이다 — `API-SEQ-004`가 "`base_branch`는 필수다, 서버가
시퀀스 공간을 고르지 않는다"로 정했다 (CR-032, DEV-168). **서버가 공간을 고르면 사용자가 묻지
않은 브랜치의 답이 나온다**는 그 절의 논리가 검색에도 그대로 성립한다.

**규칙 5의 저장물 셋이 실제로 무엇인지 적는다.**

| 인용 | 공간 정체성 | 에폭이 사는 곳 | 상태 |
| --- | --- | --- | --- |
| 안전 구간 표식 | `safe_marker.repository_id` + `base_branch` | `safe_marker.seq_epoch` | 마이그레이션 002부터 있었다 |
| 저장된 검색의 `seq:` | 질의의 `repo:`·`base:` | `saved_search.seq_epoch` | **마이그레이션 017이 더한다** (CR-051) |
| 공유 URL | 질의의 `repo:`·`base:` | URL의 `seq_epoch` 파라미터 | **CR-051이 세운다** |

셋째 줄이 이 Clarification의 핵심이다. 규칙 5는 처음부터 "공유 URL"을 열거하고 있었는데
W-001의 URL에 그 자리가 없었다 — **결정은 서 있었고 구현이 그것을 몰랐다.**

**에폭은 질의 문법이 아니라 참조 맥락이다.** `epoch:3` 같은 질의 키를 만들지 않는다. 에폭은
사용자가 고른 조건이 아니라 그 조건이 **어느 히스토리 세대를 뜻했는지**를 보존하는 값이며,
질의 문법에 넣으면 파서·직렬화·토큰 칩·패싯이 전부 그것을 조건으로 다루게 된다. `seq_epoch`은
`API-SEQ-001`이 이미 쓰는 것과 같은 요청 파라미터이고 URL 파라미터다.

**규칙 5의 "자동 재해석하지 않는다"는 빈 결과도 금지한다.** 무효인 인용에 `items: []`로 답하면
사용자는 "그 구간이 비었다"로 읽는다 — 다른 세대의 결과를 주는 것만큼이나 틀린 답이다.
계산하지 않았음을 응답의 모양으로 말한다: 결과 키를 넣지 않는다.

**복원할 수 없는 에폭을 지어내지 않는다.** CR-051 이전에 저장된 `seq:` 검색은 에폭이 없고 그
값은 어디에서도 되찾을 수 없다. 현재 값으로 채우는 것은 규칙 5를 지키는 것처럼 보이지만
실제로는 **자동 재해석을 데이터로 못 박는 일**이다. 그런 인용은 `unbound`로 남기고 사람이
다시 연결한다.

### Clarification (CR-077, 2026-09-10) — M 넘버는 이 서수의 파생이지 두 번째 시퀀스가 아니다

**새 결정이 아니다.** 2026-09-10 P4 회고 회의가 **M 넘버**를 결정했고, 이 절은 그것이 위 결정의 무엇인지를
적는다. M 넘버는 새로운 채번이 아니라 **이 서수의 부분 열거**다.

```
M 넘버 = 같은 시퀀스 공간에서 pull_request 연결이 있는 merge_seq 항목만 골라
         merge_seq 오름차순으로 1부터 매긴 조밀 서수
```

그래서 규칙 1~7이 M 넘버에도 그대로 적용된다. 공간은 `(repository_id, base_branch)`이고(규칙 1),
채번은 증분이며(규칙 2), 에폭이 오르면 M 넘버를 인용한 저장물도 함께 무효가 된다(규칙 5).

**회의는 "merged_at 순서"라고 말했고, 그것은 위 Context가 옵션 1로 기각한 기준이다.** 기각 근거는
지금도 유효하다 — 머지 시각은 연속 값이라 이산적 지시를 만들지 못하고 동시 머지에서 순서가 흔들린다.
그런데 **두 순서는 통상적인 흐름에서 일치한다**: 하나의 base 브랜치에 PR이 차례로 머지되면 머지 커밋이
붙는 순서가 곧 `merged_at` 순서다. 어긋나는 경우는 release 브랜치를 거쳐 들어온 머지와 base 강제
푸시인데, **그때 실제 반영 순서를 말하는 쪽은 first-parent이고 회의가 풀려던 문제(불편사항 1·3)가
바로 그 순서다.** 그래서 first-parent에서 파생해도 회의의 요구를 잃지 않으며, 오히려 회의가 원한 것을
더 정확히 준다.

**두 순서의 불일치는 감추지 않는다.** 채번할 때 `merged_at` 순서와 `merge_seq` 순서를 대조하고
어긋나면 지표로 남긴다 (`FR-SEQ-008` AC-6). 대조는 관측이며 채번을 막지 않는다 — 정본은 `merge_seq`다.

**규칙 7과 M 넘버의 관계가 이 값의 한계를 정한다.** 직접 푸시 커밋은 `merge_seq`를 받지만 M 넘버는
받지 않는다. 그래서 **M 넘버 순서는 브랜치 히스토리와 1:1 대응하지 않으며, 범위 인용의 소유는 계속
`merge_seq`에 있다.** `W-004`의 구간 조사와 `seq:` 질의는 `merge_seq`를 쓰고, M 넘버는
`FR-SEQ-008` AC-8이 정한 대로 **선후관계 확인용**으로만 쓴다. 두 값을 한 화면에 나란히 두되
어느 쪽이 무엇을 보증하는지 섞지 않는다.


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
- **`allowed_team_ids`의 주인은 저장소 등록(PostgreSQL `repository`)이고, 투영은 그것을 읽어 문서에 복사할 뿐이다 (CR-024).** 이 값을 `EVT-ING-002`에 실어 나르지 않는다 — 팀 권한은 PR·커밋 이벤트가 나르는 **엔티티 상태가 아니라 저장소의 운영 상태**이므로, 이벤트에 실으면 이벤트마다 값이 달라져 어느 것이 최신인지 판정할 수 없다(`document_version`은 저장소 권한의 버전이 아니다). 팀 구성이 바뀌면 `repository.allowed_team_ids`를 갱신한 뒤 `update_by_query`로 기존 문서에 **소급 적용**한다 — `markRepositoryArchived`가 이미 쓰는 것과 같은 형태다. 이 경로가 없으면 팀에서 빠진 사용자가 과거 문서를 계속 보게 된다.
- **파이프라인 건강 집계는 이 강제 필터의 유일한 예외다 (CR-024, DEV-051).** 저장소를 식별하지 않는 **전역 수치**(수신량, 대기열 길이, 지연 백분위, 실패·보강 대기 건수)는 필터를 거치지 않는다. 그 수치들은 "어느 저장소가 무엇을 했는가"가 아니라 "파이프라인이 살아 있는가"에 답하며, 저장소를 지목하지 않으므로 THR-003이 막으려는 **저장소별 활동량 추론**이 성립하지 않는다. 반대로 저장소를 **식별하는** 값(`slowest_repositories`)은 `operator`에게도 접근 범위 안으로 한정하고, 범위 밖은 건수로만 알린다 — 목록이 잘렸다는 사실까지 감추면 운영자가 "느린 저장소가 없다"로 잘못 읽는다. 아키텍처 테스트의 허용 목록은 이 두 갈래를 구분해서 유지한다.
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

`prs-links` 인덱스의 문서 구조 (**CR-039로 구현에 맞춰 정정**):

```
link_id, reference_key,
repository_id, org_id, visibility, allowed_team_ids,
from_type, from_id, to_type, to_id, to_repository_id,
link_type, confidence, evidence,
resolved (bool), detached (bool), created_at
```

- 간선은 정방향 1건만 저장하고, 역방향 조회는 `to_id`로 질의한다. 두 벌 저장하지 않는다.
- 관계 그래프 탐색(FR-REL-008)은 깊이만큼 반복 질의한다. 깊이 최대 3, 노드 상한 300이므로 최대 3회 질의로 끝난다. 그래프 DB가 필요한 규모가 아니다.
- **핫패스 비정규화**: PR·커밋 문서에 `link_summary` 객체(`has_revert`, `is_reverted`, `has_cherry_pick`, `has_stack`, `reference_count`)를 함께 저장한다. 검색 결과 목록의 관계 배지(C-015)와 `is:reverted` 필터(FR-REL-004 AC-4)가 간선 인덱스 조회 없이 동작한다.
- 미해결 참조(대상 미색인)는 `resolved: false`로 저장하고, 대상 색인 시 해결 상태로 갱신한다 (FR-REL-003 AC-3).
- **간선도 강제 접근 범위 필터를 지난다** (ADR-008). 접근 통제 material은 **근거를 소유한 저장소**(= `from` 쪽)의 것이며, 문서 생성 시점에 함께 넣는다.

### CR-039 개정 (2026-08-26) — 적힌 것을 구현된 것에 맞춘다

이 ADR의 결정을 뒤집지 않는다. 옵션 2 + 핫패스 비정규화는 그대로다. 아래 넷은 **문서가 초기 설계에 머물러 있던 자리**다.

1. **`direction` 필드는 존재한 적이 없다.** 방향은 `from_*`/`to_*`의 구조가 이미 표현한다. 목록에서 지운다.
2. **접근 통제 필드 넷과 `to_repository_id`·`detached`가 빠져 있었다.** 매핑은 처음부터 선언하고 있었고 `TEAM_SCOPED_ALIASES`가 `prs-links`를 포함한다.
3. **`link_summary`에 `reverted_by_count`가 아니라 `is_reverted`·`has_stack`이 있다.** 수를 세지 않고 불리언으로 둔 것은 `is:reverted` 필터가 필요로 하는 것이 존재 여부뿐이기 때문이다.
4. **`reference_key`를 더한다 (DEV-217).** 위 마지막 항목("미해결 참조를 간선 1건 갱신으로 해결한다")은 **`link_id`가 해결 전후로 같아야만** 성립한다. `to_id`를 ID 재료로 쓰면 축약 SHA 참조가 해결되는 순간 ID가 바뀌어 문서가 둘이 된다. `references` 간선의 안정 ID를 `link_type` + source + `reference_key`로 만들어 그 결정을 실제로 성립시킨다. 새 결정이 아니라 **이미 한 결정을 지키는 수단**이므로 새 ADR을 세우지 않는다.

### Consequences

- Positive: 양방향 조회가 대칭적이다. 미해결 참조 해결이 간선 1건 갱신으로 끝난다. 목록 화면이 빠르다.
- Negative: `link_summary` 비정규화 필드가 간선 변경 시 갱신되어야 하므로 일관성 지점이 하나 는다.
- Negative (CR-039): `link_summary`의 leaf 소유자가 WP-029와 WP-030으로 갈리므로 **객체 통째 대입을 쓸 수 없다.** leaf 단위 갱신 경로가 하나 는다 (DEV-222).
- Negative (CR-039): 간선이 대상 저장소를 가리킬 수 있으므로 **관계 조회 API가 대상 접근 범위를 다시 강제해야 한다.** 간선의 접근 범위는 source의 것이지 target의 것이 아니다 (DEV-224, THR-034).
- Follow-up: `link_summary` 갱신은 `link` 워커가 간선 쓰기와 같은 벌크 요청에 포함한다.
- Follow-up: 정합성 감시 잡이 `link_summary`와 간선 인덱스 실제 값을 표본 대조한다.
- Follow-up (CR-039): 간선은 재파생 가능한 파생 데이터이므로 PostgreSQL 간선 표를 두지 않는다. 대신 **`pull_request_snapshot`·`commit_snapshot`만으로 `prs-links` 전량을 다시 만들 수 있어야** ADR-004가 이 축에서도 성립한다 (JOB-REL-006, DEV-221).

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

### Amendment (CR-043, 2026-08-26) — 이 결정이 덮는 범위와 봉투의 아래층

결정을 바꾸지 않는다. 세 가지를 **명시**한다. 셋 다 WP-032 착수 전 감사에서 "적혀 있지 않아 구현이 아무렇게나 해도 통과하는 자리"로 드러났다.

**1. 이 결정은 Elasticsearch가 결과 집합을 소유하는 조회에 적용된다.** W-004 범위 조사는 다르다 — 구간의 멤버십과 순서는 PostgreSQL `merge_sequence`가 소유하고(ADR-007, ADR-004), Elasticsearch는 표시용 값과 `q` 판정만 준다. 그 화면의 커서는 `search_after` 값이 아니라 **마지막으로 검사한 서수**를 봉인한다. "커서 전용, 오프셋 없음"이라는 이 결정의 요지는 두 화면에 똑같이 적용되지만, **커서의 재료는 정본을 따라간다.** 하나의 알고리즘으로 묶으면 구간 멤버십의 소유가 색인으로 넘어가고 그것은 ADR-007을 깨는 최적화다.

**2. 커서 봉투는 버전·무결성·만료를 갖는다.** "불투명 문자열"은 인코딩을 정하지 않았고, base64 JSON만으로는 사용자가 정렬 키 값을 고쳐 정상 커서처럼 만들 수 있다. 강제 필터는 질의 시점에 다시 걸리므로 접근 통제가 깨지지는 않지만, 서버가 발급하지 않은 위치를 발급한 것처럼 신뢰하게 된다. HMAC-SHA256 한 겹과 스키마 버전, 만료 시각을 봉투에 넣는다. **새 범용 crypto 추상을 만들지 않는다** — 전용 서명 키 하나면 된다.

**3. 모든 커서 순회에 Point In Time이 필요하다.** 이 결정은 `search_after`가 "결과 크기와 무관하게 일정한 성능"을 준다고 적었고 그것은 참이지만, **살아 있는 인덱스 위에서는 일관성을 주지 않는다.** `search_after`는 "정렬 값이 이 커서보다 뒤"라는 조건이므로, 어떤 문서의 정렬 값이 페이지 사이에 움직이면 그 문서는 **두 번 나오거나 영영 나오지 않는다** — 커서를 넘어 앞으로 가면 다시 나오고, 뒤로 가면 사라진다.

**정렬 키가 문서 자신의 필드라는 것은 그 값이 불변이라는 뜻이 아니다.** 이 제품의 정렬 키 여덟 중 움직이지 않는 것은 `created_at` 하나뿐이다.

| 정렬 키 | 무엇이 값을 움직이나 |
| --- | --- |
| `updated_at` | 리뷰·댓글·라벨 등 모든 PR 갱신 웹훅 |
| `changed_files_count` · `additions` | 보강 완료, 새 커밋 푸시 |
| `lead_time_seconds` | 머지 시각 확정 |
| `merged_at` | 미머지 PR이 머지되면 `missing: _last` 무리에서 정렬 구간 안으로 들어온다 |
| `merge_seq` | 에폭 상향 시 재채번 (ADR-007) |
| `_score` | 새 문서 색인으로 BM25 term statistics가 바뀐다 |

그래서 **커서 순회는 정렬 키와 무관하게 PIT을 연다.** 첫 페이지에서 열어 색인 뷰를 고정하고 keep-alive는 5분이며 페이지마다 갱신하고 마지막 페이지에서 close한다. 만료된 PIT은 `cursor_invalid`이며 화면은 첫 페이지로 되돌아간다. `relevance`에는 이유가 하나 더 있을 뿐이다 — 다른 키는 **값**이 움직이고 점수는 **계산 근거**가 움직인다.

(정렬 키별로 PIT 여부를 가르는 안은 기각했다. 가르면 "이 키는 불변인가"를 매번 판정해야 하고, 이 Amendment의 첫 판정이 이미 틀렸다 — `updated_at`을 불변으로 셌다. 판정을 없애는 편이 싸고 안전하다.)

`cursor_query_mismatch`와 `cursor_invalid`는 다른 사실을 말한다 — 전자는 "조건이 바뀌었다", 후자는 "이 커서를 쓸 수 없다"다. 둘 다 첫 페이지로 되돌리지만 같은 원인인 척하지 않는다.

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

## ADR-013 GitHub Operations Plane을 Search/Data Plane과 분리

### Context

CR-005로 제품에 GitHub 쓰기 작업이 들어왔다. 기존 시스템은 웹훅을 받아 PostgreSQL에 넣고 Elasticsearch에 투영하는 읽기 전용 파이프라인이며, GitHub App 설치 토큰으로 서버가 자율 동작한다. 새 기능은 성격이 정반대다 — 사용자가 명시적으로 요청할 때만, 사용자 권한으로, GitHub 상태를 바꾼다.

두 성격을 한 런타임에 섞으면 세 가지가 무너진다. 첫째 자격 증명이다. 수집용 App에 쓰기 권한을 더하면 웹훅 처리 버그가 GitHub을 손상시킬 수 있는 경로가 생긴다. 둘째 장애 격리다. `gh` 프로세스가 실행기를 포화시키면 수집이 멈춘다. 셋째 감사다. 자동 파이프라인 동작과 사용자 지시 동작이 같은 로그에 섞이면 "누가 무엇을 시켰나"를 답할 수 없다.

### Options

1. **기존 서비스 확장** — `search-api`에 실행 엔드포인트를 더하고 거기서 `gh`를 호출한다.
2. **파이프라인을 gh로 교체** — 수집도 `gh`로 통일한다.
3. **별도 Plane 분리** — 실행 전용 런타임·패키지·App·감사 경계를 새로 만든다.

옵션 2는 즉시 배제된다. `gh`는 웹훅을 받지 못하고, 저장소 단위 순서 보장도, 트랜잭션 서수 채번도 하지 못한다 (ADR-002가 Filebeat를 배제한 것과 같은 이유). 옵션 1은 배포 단위가 하나 줄지만 위 세 가지 문제를 모두 안는다.

### Decision

**옵션 3.** 두 Plane을 분리한다.

| 구분 | Search / Data Plane | GitHub Operations Plane |
| --- | --- | --- |
| 런타임 | `ingest-gateway`, `pipeline-worker`, `search-api` | `gh-executor` (신규) |
| 패키지 | `@prs/github` (REST 클라이언트) | `@prs/gh-cli` (capability 모델·argv 조립) |
| GitHub App | Data App (server-to-server, read) | Operations App (user-to-server, 위임) |
| 트리거 | 웹훅·잡 | 사용자 명시 요청만 |
| 감사 | `audit_record` | `gh_execution` (별도 엔티티) |

`search-api`와 `pipeline-worker`는 `gh` 프로세스를 직접 띄우지 않는다. 실행은 반드시 `gh-executor`를 거친다. 기존 `@prs/github`를 gh 래퍼로 바꾸지 않는다 — REST 클라이언트는 rate limit 관리와 보강 로직을 갖고 있고 그 책임은 그대로 남는다.

### Consequences

- Positive: 수집 경로에 쓰기 권한이 없다. `gh` 실행 부하가 검색·수집에 영향을 주지 않는다. 사용자 지시 동작이 별도 감사 축에 남는다. Operations Plane을 통째로 비활성화해도 제품의 조사 기능은 동작한다.
- Negative: 배포 단위가 하나 늘고 GitHub App이 두 개가 된다. 저장소·브랜치 같은 공통 컨텍스트를 두 Plane이 각각 해석한다.
- Follow-up: 공통 컨텍스트(저장소 식별, 권한 판정 캐시)는 `@prs/domain`에 두어 두 Plane이 같은 타입을 쓴다.

## ADR-014 사용자 주도 GitHub 작업은 별도 Operations App + 위임 사용자 토큰

### Context

Operations Plane이 GitHub을 호출할 때 어떤 자격 증명을 쓰는가. 기존 수집 파이프라인은 GitHub App 설치 토큰을 쓴다. 설치 토큰은 설치 범위 전체에 대해 App에 부여된 권한을 갖는다 — 사용자가 누구든 상관없다.

이걸 그대로 쓰면 권한 승격이 일어난다. 저장소 A에 접근 권한이 없는 사용자가 웹 UI를 통해 저장소 A의 PR을 머지할 수 있게 된다. 애플리케이션 계층에서 막을 수는 있지만, 그 검사가 뚫리는 순간 GitHub 쪽에는 아무 방어선이 없다.

### Options

1. **설치 토큰 + 애플리케이션 권한 검사** — 구현이 단순하다. 방어선이 하나뿐이다.
2. **사용자 PAT 보관** — 사용자 권한과 정확히 일치한다. 대신 장기 자격 증명을 대신 보관해야 하고 범위를 좁힐 수 없다.
3. **별도 Operations App + 사용자 위임 액세스 토큰** — GitHub App user-to-server 토큰.

### Decision

**옵션 3.** GitHub App을 두 개로 나누고, 작업 실행에는 사용자 위임 토큰을 쓴다.

```text
GitHub Data App           GitHub Operations App
  server-to-server          user-to-server
  최소 read 권한            명시적으로 필요한 권한만
  수집·보강 전용            사용자 요청 실행 전용
```

유효 권한은 다음과 같이 정의한다.

```text
유효 권한 = Operations App 권한 ∩ 해당 사용자의 GitHub 권한
```

App 설치 권한이 사용자 권한보다 넓더라도 그 차이는 사용자에게 부여되지 않는다. GitHub이 위임 토큰에 대해 이 교집합을 강제하므로, 애플리케이션 검사가 뚫려도 GitHub이 거부한다. 방어선이 둘이 된다.

토큰은 평문으로 저장하지 않는다. 비밀 저장소 참조와 메타데이터만 DB에 두고, 실행 직전에 실체화해 프로세스 환경으로 전달한 뒤 즉시 폐기한다. 서버에서 `gh auth login`으로 자격 증명을 gh config에 영속 저장하지 않는다.

### Consequences

- Positive: 권한 승격 경로가 구조적으로 없다. 사용자가 GitHub에서 권한을 잃으면 다음 실행부터 즉시 반영된다. 감사에 실제 GitHub 행위자가 남는다.
- Negative: 사용자마다 App 인가 절차가 필요하다. 토큰 만료·갱신 처리가 늘어난다. 사용자가 인가하지 않으면 기능을 쓸 수 없다.
- Follow-up: 위임 토큰이 만료되고 갱신에 실패하면 재인가를 요구한다. 갱신 토큰을 요구하는 GitHub 구성이면 회전 주기를 명시한다.

## ADR-015 버전 고정 gh capability manifest + 생성형 command UI

### Context

`gh` 2.97.0 실측 기준으로 command node가 228개(실행 가능 leaf 196), command 고유 flag가 1,034개다. 이 규모를 화면으로 손수 만들면 유지가 불가능하고, gh가 올라갈 때마다 제품 전체를 다시 만져야 한다.

동시에 "빠짐없이"라는 요구가 있다. 어떤 command를 조용히 빠뜨리면 사용자는 그것이 없는지 못 만든 건지 알 수 없다.

### Options

1. **화면 수작업** — 자주 쓰는 것만 만든다. 나머지는 없다. 완전성 요구를 만족하지 못한다.
2. **help 출력 실시간 파싱** — 항상 최신이다. 대신 파싱 실패가 곧 기능 정지이고, 위험도·권한·의미 제약을 help에서 얻을 수 없다.
3. **버전 고정 manifest + 생성형 UI** — help에서 생성한 인벤토리에 사람이 만든 의미 정보를 덧입혀 검증된 manifest를 만들고, 거기서 UI를 생성한다.

### Decision

**옵션 3.** 파이프라인은 다음과 같다.

```text
gh help (고정 버전)
   ↓  자동 추출
generated capability inventory
   ↓  사람이 보강 (의미 오버라이드)
curated semantic overrides
   ↓  스키마 검증 + 커버리지 계산
validated capability manifest  (버전 + 해시)
   ↓
UI generator ──→ GenericCommandForm
            └──→ 전용 업무 화면이 참조
```

자동 파싱만 신뢰하지 않는 이유는 help가 주지 않는 정보가 실행 안전성의 핵심이기 때문이다 — 상호 배타 flag, flag 의존, 반복 가능 여부, 열거값, 자원 선택자 종류, 위험도, 필요 GitHub 권한, 비밀 값 여부, 확인 필요 여부, 파일·stdin 입력, 출력 스키마, 호스트·버전 호환성.

manifest는 버전과 내용 해시를 갖고, 실행 기록은 자신이 쓴 manifest 버전을 참조한다. 실행기의 gh 버전과 manifest 생성 버전이 다르면 `registry_stale` / `execution_disabled` / `admin_action_required` 중 하나로 처리하며, 새 기능을 조용히 실행하지 않는다.

CI는 설치된 gh와 커밋된 manifest의 차이를 검출하고, 분류 커버리지를 게이트로 검사한다 (NFR-009).

### Consequences

- Positive: gh가 올라가도 manifest 갱신과 오버라이드 보강으로 끝난다. 커버리지가 수치로 측정된다. 미분류가 CI에서 실패로 드러나므로 조용한 누락이 불가능하다.
- Negative: 오버라이드는 사람이 유지해야 하는 자산이다. gh 마이너 업그레이드마다 신규 flag의 의미 분류가 필요하다.
- Follow-up: 오버라이드가 없는 신규 flag는 `mapped_to_generic_control`로 자동 분류하되, 위험도가 정해지지 않은 command는 실행을 허용하지 않는다.

## ADR-016 격리 gh 실행기와 risk/policy/approval 모델

### Context

`gh` 실행은 외부 프로세스 실행이다. 잘못 설계하면 명령 주입, 자격 증명 유출, 자원 고갈, 되돌릴 수 없는 파괴적 작업으로 이어진다.

특히 웹 UI라는 맥락이 위험을 키운다. 터미널에서는 사용자가 명령 전체를 보고 엔터를 누르지만, 웹에서는 버튼 하나가 무엇을 하는지 가려질 수 있고, 같은 버튼을 두 번 누를 수도 있다.

### Options

1. **애플리케이션 프로세스에서 직접 실행** — 배포가 단순하다. 자격 증명과 자원이 애플리케이션과 공유된다.
2. **공용 워커에서 실행** — 격리는 되지만 실행 간 파일·상태가 섞인다.
3. **전용 실행기 + 실행별 격리 + 위험도 모델**.

### Decision

**옵션 3.** `apps/gh-executor`를 독립 배포 단위로 두고 다음을 강제한다.

실행 안전:

```text
고정 경로의 gh 바이너리 + argv 배열
shell 미경유 (shell: true, bash -c, sh -c 금지)
argv는 capability manifest에서 조립 — 사용자 문자열 연결 없음
비루트 · 읽기 전용 루트 파일시스템
실행별 임시 workspace (TTL, 디스크 할당량)
프로세스 타임아웃 · 출력 상한 · 프로세스 그룹 취소
동시 실행 상한
아웃바운드는 구성된 GHE 호스트만
```

자격 증명은 매 실행마다 주입하고 즉시 폐기한다. `GH_CONFIG_DIR`과 `HOME`은 실행 전용 임시 디렉터리를 쓴다. headless 동작을 위해 프롬프트를 비활성화하고 페이저와 색상을 끈다.

위험도 모델:

| 등급 | 성격 | 예 | 정책 |
| --- | --- | --- | --- |
| R0 | 읽기 전용 | `pr list`, `repo view`, `run view` | 즉시 실행 |
| R1 | 가역적 낮은 위험 쓰기 | `issue comment`, `pr edit --add-label` | 대상·동작 미리보기 |
| R2 | 영향도가 큰 쓰기 | `pr merge`, `run rerun`, `run cancel`, `release create` | 명시적 확인 + 실행 직전 대상 상태 재확인 |
| R3 | 파괴적·관리자·비밀 | `repo delete`, `repo rename`, `secret set`, `ruleset` 변경 | 강한 확인 + 정책에 따른 승인 |

R2 이상은 실행 직전에 대상 상태를 다시 조회한다. 사용자가 화면에서 본 상태와 달라졌으면 실행하지 않는다 — 웹에서는 화면을 열어둔 채 시간이 흐르기 때문이다.

중복 실행 방지: 쓰기 요청은 중복 방지 키를 갖고, 같은 대상에 상충하는 작업은 자원 잠금으로 직렬화한다.

### Consequences

- Positive: 명령 주입 경로가 구조적으로 없다. 실행 폭주가 애플리케이션을 무너뜨리지 않는다. 파괴적 작업에 사람의 확인이 강제된다. 실행 간 파일이 섞이지 않는다.
- Negative: 배포 단위와 운영 대상이 늘어난다. 임시 workspace 관리(할당량, 정리, 고아 회수)가 새 운영 부담이다. 확인 단계가 R2 이상 작업의 체감 속도를 늦춘다.
- Follow-up: workspace 정리 실패는 경보 대상이다. 종료된 실행이 비종료 상태로 남는 경우를 회수하는 정합성 감시 잡을 둔다.

## ADR-017 구조화 gh invocation + 의미 제약 모델을 UI·서버·실행기의 단일 진실로

### Context

CR-005는 capability manifest에서 폼을 생성하고 argv를 조립하기로 했다. 그런데 "유효한 조합"을 아는 주체가 넷이다 — 폼(무엇을 입력받을지), 서버 검증(무엇을 거부할지), argv 빌더(무엇을 조립할지), 테스트 생성기(무엇을 시험할지).

이 넷이 각자 규칙을 가지면 반드시 갈라진다. 폼이 막는 조합을 서버가 통과시키면 클라이언트를 우회한 요청이 그대로 실행되고, 서버가 막는 조합을 폼이 허용하면 사용자는 이유 없이 거부당한다. 미리보기 argv와 실제 argv가 다른 생성기에서 나오면 "보여준 것과 다른 것을 실행"하는 최악의 상태가 된다.

CR-008이 요구하는 제약은 단순 목록이 아니다. `--body`와 `--body-file`은 상호 배타이고, `--json`을 쓰면 가능한 필드 집합이 정해지며, 어떤 flag는 저장소 컨텍스트를 요구하고, 어떤 capability는 GHES 버전에 따라 아예 존재하지 않는다. 이것은 UI 힌트가 아니라 실행 가능성의 정의다.

### Options

1. 폼·서버·빌더가 각자 규칙을 갖고 테스트로 정합성을 확인한다.
2. 서버 검증만 진실로 두고 UI는 자유 입력을 받는다.
3. 의미 제약 모델 하나를 manifest에 두고 네 소비자가 그것만 읽는다.

### Decision

**옵션 3.** manifest의 `GhCapabilityConstraint`가 유효 조합의 유일한 정의이고, 사용자의 의도는 `GhInvocation` 구조로 표현한다.

```text
GhInvocation                     GhCapabilityConstraint
  capabilityId                     requires / conflicts
  context                          oneOf / exactlyOne / atLeastOne
  positionalArguments              implies
  flags                            repeatable / minItems / maxItems
  stdinSource                      value enum
  fileBindings                     conditional requirement
  outputOptions                    input source constraint
                                   context-dependent constraint
        |                                    |
        +------------------+-----------------+
                           v
   +-----------------------------------------------+
   | 1. GenericCommandForm  (폼 생성)               |
   | 2. server validation   (실행 직전 재검증)       |
   | 3. argv builder        (미리보기·실행 공용)     |
   | 4. property/pairwise test generator            |
   +-----------------------------------------------+
```

문자열 명령은 어느 단계에서도 진실이 아니다. 감사·이력·재실행도 `GhInvocation`을 저장하고, 표시용 argv는 거기서 파생한다.

argv 빌더는 하나뿐이다. 미리보기와 실행이 그 하나를 공유하므로 "보여준 argv와 실행된 argv가 다르다"가 구조적으로 불가능하다.

### Consequences

- Positive: 클라이언트 우회가 무력해진다. 폼과 서버 판정이 갈릴 수 없다. 테스트 생성기가 같은 모델을 읽으므로 제약이 늘어나면 시험도 자동으로 늘어난다. 재실행이 과거 문자열이 아니라 현재 규칙으로 재검증된다.
- Negative: manifest가 무거워지고, 제약 표현력이 부족하면 capability 하나가 통째로 막힌다. 제약 모델 자체에 버그가 있으면 네 소비자가 동시에 틀린다.
- Follow-up: 제약 모델의 표현력 부족은 `unknown`이 아니라 명시적 미지원으로 분류해 게이트에 드러낸다. WP-061이 이 엔진을 만든다.

## ADR-018 gh 출력과 파일은 신뢰할 수 없으며 별도 무해화 경계를 통과한다

### Context

실행기는 gh를 돌리고 그 stdout·stderr를 사용자 브라우저로 보낸다. 그 텍스트의 출처는 GitHub이고, GitHub의 내용은 아무나 쓸 수 있다 — PR 제목, 이슈 본문, 브랜치 이름, 파일 경로, 사용자 이름, 커밋 메시지 전부 외부 입력이다.

여기서 흔한 착각은 "gh가 알아서 안전하게 만들어 준다"는 것이다. 그렇지 않다. gh 2.97.0 자신이 외부 입력이 섞인 터미널 escape 시퀀스 처리 문제를 보안 수정한 이력을 갖고 있다. 도구가 고쳤다는 사실은 그 위험이 실재한다는 증거이지 앞으로 안전하다는 보장이 아니다.

터미널 escape는 웹에서도 위험하다. ANSI CSI로 화면을 조작해 사용자가 보는 내용을 속일 수 있고, OSC 시퀀스는 터미널 제목·클립보드·하이퍼링크를 건드린다. 출력을 그대로 HTML로 넣으면 그때부터는 XSS다.

### Options

1. gh 출력을 신뢰하고 그대로 렌더링한다.
2. 프런트엔드에서 렌더링 직전에 정리한다.
3. 실행기와 UI 사이에 무해화 경계를 두고, 그 경계를 통과하지 않은 출력은 UI에 도달할 수 없게 한다.

### Decision

**옵션 3.** `SafeGhOutput` 경계를 신설한다.

```text
gh stdout/stderr --> [SafeGhOutput 경계] --> 저장·스트리밍·렌더링
                       ANSI CSI 무해화
                       OSC 무해화
                       제어 문자 제거/escape
                       invalid UTF-8 치환
                       바이너리 탐지
                       바이트 상한
                       스트리밍 청크 경계 보정
```

프런트엔드는 gh 출력에 `dangerouslySetInnerHTML`을 쓰지 않는다. Markdown은 안전 렌더러로만 그린다.

파일도 같은 취급이다. 실행이 읽고 쓰는 경로는 workspace 안으로 정규화되어 갇히고, 사용자에게는 파일시스템 경로가 아니라 아티팩트 ID를 준다.

옵션 2를 고르지 않은 이유는 경계가 렌더링 지점마다 흩어지기 때문이다. 화면이 하나 늘 때마다 무해화를 다시 붙여야 하고, 언젠가 한 곳이 빠진다.

### Consequences

- Positive: gh 버전이 올라가며 출력 처리 동작이 바뀌어도 우리 경계는 그대로다. 렌더링 지점이 늘어도 무해화는 한 곳이다. 스트리밍 경계에서 escape가 잘리는 까다로운 경우를 한 번만 풀면 된다.
- Negative: 색상 같은 터미널 표현을 잃는다(필요하면 무해화 이후 구조화 표현으로 되살린다). 무해화 비용이 스트리밍 지연에 더해진다.
- Follow-up: WP-062가 이 경계를 만든다. 무해화 우회 시도는 보안 시험 대상이다 (THR-011~013).

## ADR-019 interactive 명령의 웹 등가 계층과 extension 신뢰 경계

### Context

gh 명령 상당수가 터미널을 전제한다 — 브라우저를 열고(`--web`, `gh browse`), 편집기를 띄우고, 프롬프트로 되묻고, TUI를 그린다. 이것을 전부 `terminal_only`로 밀어 넣으면 parity 수치는 맞지만 제품은 쓸모없어진다. "분류했다"가 "제공한다"를 대체할 수는 없다.

핵심은 **터미널 UX와 기능 의미가 다르다**는 것이다. `gh browse`의 의미는 "브라우저 프로세스를 실행한다"가 아니라 "이 대상의 GitHub URL로 간다"이다. 웹 앱에서는 후자가 더 자연스럽다. 실행기에서 브라우저를 띄우는 것은 오히려 잘못된 구현이다 — 서버에서 열린 브라우저를 사용자는 볼 수 없다.

extension은 다른 종류의 문제다. 임의 extension 실행은 임의 코드 실행이라 허용할 수 없다. 그러나 전부 숨기면 사용자는 왜 안 되는지도 모른다.

### Decision

**interactive 명령은 웹 등가를 먼저 찾는다.** 모든 명령은 아래 중 하나로 분류되며 `unknown`은 금지한다.

| 분류 | 의미 | 예 |
| --- | --- | --- |
| `web_native` | 그대로 웹 폼으로 표현 | 대부분의 조회·생성 명령 |
| `web_equivalent` | 터미널 UX를 웹 표현으로 대체 | `--web`·`gh browse` → URL 반환, editor 프롬프트 → 웹 편집기, `gh auth` → Operations App 연결 화면, `gh completion` → 스크립트 내려받기, `gh config` → 실행 단위 scoped profile |
| `sandbox_terminal` | 승인된 격리 웹 터미널이 있을 때만 | Codespace SSH·Jupyter |
| `terminal_only` | 웹 등가가 없음 + 사유 명시 | 승인된 웹 터미널이 없는 경우 |
| `policy_blocked` | 정책상 차단 + 사유 명시 | 임의 extension 실행 |
| `unsupported_by_host` | 대상 GHES가 지원하지 않음 | 호스트 기능 판정 결과 |

**extension은 별도 capability plane이다.** 탐색·목록·메타데이터·출처 저장소·설치 버전·pin·승인 상태는 조회할 수 있다. 실행은 관리자 허용 목록 + 정확한 버전 pin(태그 또는 커밋, 가능하면 digest 확인)을 만족할 때만, core gh와 같거나 더 강한 격리에서 허용한다. 실행기의 실제 사용자 HOME을 쓰지 않는다. core parity와 extension parity는 수치를 분리해 보고한다.

### Consequences

- Positive: `terminal_only`가 게으른 분류가 되지 않는다. 사용자는 왜 안 되는지 항상 알 수 있다. extension 위험이 core 실행 경로로 새지 않는다.
- Negative: 웹 등가마다 별도 UI가 필요해 구현량이 늘어난다. extension 승인은 관리자 운영 부담이다.
- Follow-up: WP-063이 웹 등가 어댑터와 extension 신뢰 경계를 만든다. 웹 등가가 없다고 분류할 때는 사유를 manifest에 남긴다.

## ADR-020 typed gh 결과 계약과 capability 데이터흐름 그래프

### Context

CR-008은 *한 command*의 입력을 완전히 표현했다. `GhCapabilityConstraint`가 유효 조합을 정의하고 `GhInvocation`이 사용자 의도를 담는다. 그런데 실제 업무는 명령 하나로 끝나지 않는다 — 검색해서 고르고, 고른 것의 상태를 보고, 받은 파일을 다음에 넘긴다.

**입력만 계약이 있고 출력은 계약이 없으면 조합은 일반화되지 않는다.** 지금 Recipe(FR-GH-005)가 표현할 수 있는 연결은 "이전 단계의 JSON 출력에서 필드 뽑기"뿐이다. 그런데 gh 출력이 전부 JSON은 아니다.

| 상황 | JSON 필드 바인딩으로 안 되는 이유 |
| --- | --- |
| 명령이 저장소 URL을 반환 → 다음 명령이 저장소를 요구 | URL은 JSON 필드가 아니다 |
| `gh release download`가 파일 생성 → 다음 명령이 파일 입력 | 파일은 JSON 필드가 아니고 실행기 경로를 넘겨서도 안 된다 |
| `gh search prs`가 집합 반환 → `gh pr checks`는 하나 필요 | 집합에서 하나를 고른다는 의미가 없다 |
| `gh run rerun`이 workflow run 참조 필요 | `owner/repo#123`을 매번 재파싱하게 된다 |

명령마다 특수 코드를 넣어 이어 붙이는 방법도 있다. 228개 노드에 그렇게 하면 조합의 수만큼 코드가 늘고, gh가 버전을 올릴 때마다 그 코드를 전부 다시 본다.

또 하나 놓치면 안 되는 것이 있다. **`gh auth token`은 값이 곧 자격 증명이다.** 이것을 "문자열을 반환하는 명령"으로 일반화해 다음 단계 stdin에 자동으로 이어 주면, 조합 기능이 그대로 자격 증명 유출 경로가 된다.

### Options

1. 조합이 필요한 쌍마다 어댑터 코드를 둔다.
2. 출력을 텍스트로 보고 정규식으로 필요한 것을 뽑는다.
3. 출력에도 계약을 두고, 연결을 타입으로 계산한다.

옵션 2는 처음에 빨라 보이지만 gh 출력 형식이 조금만 바뀌어도 조용히 깨진다. 그리고 깨진 것이 실행 실패가 아니라 **잘못된 대상에 대한 실행**으로 나타난다 — 파싱이 어긋나 엉뚱한 PR 번호를 뽑는 쪽이 아무것도 못 뽑는 쪽보다 위험하다.

### Decision

**옵션 3.** capability manifest가 입력 계약과 함께 결과 계약을 갖는다.

```text
GhCapability
  ├─ GhCapabilityConstraint   (CR-008, ADR-017)  입력의 유효 조합
  └─ GhResultContract         (CR-009, 이 ADR)   출력의 의미
       kind          json | resource | resource_list | url
                     | artifact | text | stream | exit_status
       schema        구조화 출력의 스키마
       resourceType  결과가 가리키는 자원 종류
       bindable      다음 단계 입력으로 이을 수 있는가
       sensitivity   public | internal | sensitive | secret
       adapters      native_json | gh_api_structured | resource_url
                     | artifact | opaque_text | stream | exit_status
                     | secret_non_bindable

              출력 port ──── 타입 일치 ────▶ 입력 port
                            (이름이 아니라 타입)
                                 │
                        GhCapabilityGraph
              node = capability, edge = 호환 가능한 연결
```

**연결의 공통 화폐는 `GhResourceRef`다.** `{ host, kind, repository, id, number, ref }`. 명령 사이에서 `owner/repo#123` 문자열을 다시 파싱하지 않는다. `kind`는 `repository`, `pull_request`, `issue`, `discussion`, `workflow`, `workflow_run`, `release`, `project`, `codespace`, `artifact`, `gist`, `user`, `team`, `branch`, `commit`이다.

**연결은 `GhBinding`이지 표현식이 아니다.** 출발 단계·출발 출력 port·도착 단계·도착 입력을 구조로 적는다. JSON 내부 필드가 필요하면 manifest에 선언된 named field 또는 스키마가 허용한 제한된 JSON Pointer만 쓴다. `eval`, JavaScript 표현식, shell 표현식, 템플릿 코드 실행, 임의 표현식 해석기는 어떤 형태로도 두지 않는다.

단일 명령의 `--jq` parity는 그대로 유지한다. 사용자가 한 명령에 `--jq`를 거는 것은 gh의 기능이고 우리가 막을 이유가 없다. 다만 **Recipe 내부의 데이터 연결을 임의 jq 표현식에 의존시키지 않는다** — 그렇게 하면 표현식 해석기를 우리가 신뢰 경계 안에서 돌리는 셈이 된다.

**`--json`이 없는 명령은 adapter로 분류한다.** 자체 `--json`이 없어도 같은 의미를 `gh api`로 구조화할 수 있으면 `gh_api_structured`를 web equivalent로 둔다. 단 **명령의 의미가 달라지면 쓰지 않는다.** 구조화할 수 없으면 `opaque_text`다 — 실행하고 화면에 보여줄 수 있지만 typed 바인딩의 source가 될 수 없다. 숨기지 않는다.

**`secret` 결과는 흐르지 않는다.** 화면 표시, 이력 저장, Recipe 바인딩, 감사 본문 저장, 다음 명령 stdin 자동 전달을 전부 금지한다. capability 자체는 목록에 있고 실행될 수 있다 — **기능이 존재한다는 사실과 비밀 값을 노출하는 것은 다른 문제다.**

**Recipe는 비순환 typed DAG다.** 순차 의존, 병렬 분기, 조건, 상한 있는 fan-out, join, typed 바인딩, 동시성 상한, 실패 정책. 순환은 저장 시 거부한다. 무한 루프·`while`·재귀 Recipe는 없다.

**fan-out에는 반드시 상한이 있다.** `gh search prs`가 10,000건을 돌려주고 각각에 `gh pr merge`를 거는 실수가 곧바로 대량 쓰기가 되어서는 안 된다. 최대 항목 수·동시성·위험도 집계·rate limit preflight가 없으면 저장도 실행도 거부한다. 동적으로 산출된 R2 이상 대상 집합은 preflight로 확정하고 plan 해시를 만들어 확인을 받는다. 확인 뒤 plan이 바뀌면 그 확인은 무효다.

**파일은 경로가 아니라 아티팩트 ID로 흐른다.** `/tmp/abc/file.zip` 같은 실행기 경로를 다음 단계에 넘기지 않는다. 아티팩트 ID를 넘기고 다음 단계가 실행 직전에 자기 workspace에 materialize한다 (ADR-018의 파일 경계와 같은 이유다).

### Consequences

- Positive: 조합이 명령 쌍마다의 특수 코드 없이 성립한다. 어떤 명령을 이을 수 있는지 UI가 계산해서 제안한다. 잘못된 연결이 실행 시점이 아니라 저장 시점에 잡힌다. 자격 증명이 조합 경로로 새지 않는다. gh 버전이 올라가면 결과 계약도 커버리지 게이트에 걸려 드러난다.
- Negative: manifest가 다시 무거워진다. 결과 계약을 사람이 정해 줘야 하는 부분이 있고(`gh help`가 출력 의미까지 알려주지는 않는다), 그 판단이 틀리면 잘못된 연결이 허용된다. `opaque_text`가 많으면 조합 가능 범위가 좁아진다.
- Follow-up: WP-066이 결과 계약과 그래프를 만든다. `opaque_text` 개수는 A-006에 노출해 줄여야 할 부채로 관리한다. 결과 계약의 사람 판단 부분은 CR-008의 semantic override와 같은 절차를 따른다.
- 구현 판 (CR-089 / WP-079, 2026-09-14): 결과 계약을 manifest 분류에 싣고(`r0.3`, leaf 196) 실행 정의는 구현 adapter만 가리킨다 — 의미 정본과 실행 허용이 갈라진다. 한 command의 기본 출력과 `--json` 출력은 다른 계약이라 계약을 **출력 모드마다** 둔다. gh 결과에는 출력 모드·필드 선택·URL 대조 조건이 늘 있어 `fully_bindable`은 0이다. 목록 → 목록은 상한 있는 fan-out(FR-GH-005 AC-9)이 정의되기 전까지 불가이고, 목록 → 단일은 `/<index>` 명시 선택 조건부다. 그래프는 판정기의 답에서 계산하며 실행 가능한 간선·다단계 흐름은 0이다. `gh_api_structured` adapter는 이 판에서 쓰지 않았다(`gh api` 구조화 브리지는 WP-064).

## ADR-021 첫 사내 반입은 단일 호스트 프로파일 · 오프라인 번들 · 단방향 다운스트림 계보

### Context

이 제품은 지금까지 **배포 오케스트레이션을 정한 ADR을 가진 적이 없다.** Kubernetes는 SRS 5.2 기술 제약 6번과 인프라 문서 3장에만 나타났고, 왜 그것인지를 기록한 결정은 어디에도 없다. 그 공백이 문제가 되지 않았던 것은 아직 아무 데도 배포하지 않았기 때문이다.

첫 사내 반입이 그 공백을 드러낸다. 실제 조건 셋이 지금까지의 전제와 다르다.

| 실제 조건 | 지금까지의 전제 |
| --- | --- |
| Linux 서버 **1대** | `web` 2~6, `search-api` 2~8 복제본, PostgreSQL primary + 대기 복제본, Redis HA, Elasticsearch 3노드 |
| **오프라인 반입** — 사내에서 컨테이너 레지스트리·npm에 닿지 않는다 | `image: prs/search-api:latest`를 클러스터가 pull한다 |
| 반입된 형상은 **외부로 돌아오지 않는다** | 저장소 하나가 유일한 형상 |

셋째가 가장 무겁다. 사내망에 들어간 코드는 반출할 수 없으므로 **내부 수정을 외부에 병합하는 workflow는 성립하지 않는다.** 양방향 동기화를 전제로 설계하면 첫 번째 사내 수정이 일어나는 순간 그 설계가 거짓이 되고, 그 뒤로는 어느 쪽이 정본인지 아무도 답할 수 없다.

여기에 이미 존재하는 결함이 겹친다. 컨테이너 이미지를 만드는 경로가 **저장소에 없다** — `Dockerfile`이 한 개도 없는데 매니페스트 다섯이 이미지를 참조한다(DEV-490). 즉 지금의 배포 계약은 어느 프로파일에서도 실행 가능한 상태가 아니었다.

### Options

1. **Kubernetes를 유지하고 사내에 단일 노드 클러스터를 세운다** (k3s, minikube 등).
2. **개발용 `docker-compose.yml`을 운영용으로 확장한다.**
3. **단일 호스트 Compose 프로파일을 별도로 만들고, Kubernetes를 선택 프로파일로 남긴다.**

옵션 1은 매니페스트를 그대로 쓸 수 있지만, 서버 1대에 오케스트레이터 운영 부담을 통째로 얹는다. 파일럿의 목적은 제품 검증이지 클러스터 운영 역량 확보가 아니며, **단일 노드 클러스터는 HA를 주지 않으면서 장애 표면만 늘린다.** 게다가 그 매니페스트들은 복제본 2를 전제로 쓰였다.

옵션 2는 파일 하나가 줄지만 두 목적이 한 파일에서 충돌한다. 개발용은 백킹 서비스만 띄우고 포트를 호스트에 열며 보안을 끈다 — 그 셋이 전부 운영에서 반대다. **한 파일이 두 뜻을 가지면 어느 쪽이 사실인지 읽는 쪽이 알 수 없다.**

### Decision

**옵션 3.** 배포 프로파일을 둘로 가르고, 첫 사내 반입의 형상·전달·계보를 함께 정한다.

```text
Profile A — 단일 호스트                    Profile B — 다중 호스트
  Docker Compose                             Kubernetes
  역할당 인스턴스 1                          복제본 2~8
  Elasticsearch single-node                  전용 3노드 (OD-006)
  호스트 장애 = 전체 장애 (승인된 trade-off)  HA
  ▲ 첫 사내 파일럿의 현재 기본                ▲ 다중 서버·HA가 필요해질 때
```

**1. 프로파일 A가 첫 파일럿의 기본이고, B는 삭제하지 않는다.** `deploy/k8s/`는 Profile B의 자산으로 남는다 — 지우면 그 프로파일로 갈 때 다시 만들어야 하고, 그 매니페스트들이 담은 판단(주기 스윕 역할은 복제본 1, `filebeat`는 사이드카)은 프로파일과 무관하게 유효하다.

**2. 서버가 하나라는 이유로 프로세스를 합치지 않는다.** 역할 경계는 그대로 두고 컨테이너를 나눈다. 경계를 지우면 그것이 곧 Profile B로 돌아갈 수 없는 상태가 되며, `pipeline-worker`의 역할 분리는 배포 형상이 아니라 **워커 풀을 나눌 수 있어야 한다**는 요구(FR-ING-006 AC-3)에서 나온 것이다. 반대로 Kubernetes의 복제본 수를 Compose에 기계적으로 번역하지도 않는다 — 기본은 **역할당 하나**이고, 동시 실행이 위험한 `batch`·`reconcile`은 그것이 상한이기도 하다.

**3. 첫 반입은 versioned offline bundle 하나로 한다.** 사내에서 `git clone`·`pnpm install`·레지스트리 접근을 요구하지 않는다. 번들은 애플리케이션 이미지와 백킹 이미지를 함께 담고, 모든 파일에 checksum이 붙으며, **어떤 시크릿도 담지 않는다.** `latest`는 릴리스 신원이 아니다 — 이미지는 버전 태그와 digest로 가리킨다.

**4. 번들은 자기가 어느 외부 커밋에서 나왔는지 증명한다.** `release-manifest.json`이 upstream 저장소·커밋·소스 아티팩트 checksum·lockfile checksum·Node/pnpm 버전·마이그레이션 수준·ES 매핑 버전·이미지 digest를 기계가 읽는 형태로 담는다. **"지금 사내에 있는 이 형상의 출발점이 어디인가"에 파일 하나로 답할 수 있어야 한다** — 그 질문에 답하지 못하면 다음 반입에서 무엇을 합쳐야 하는지도 알 수 없다.

**5. 형상 승계는 단방향이다.**

```text
External repository = upstream release producer
              │
              │  one-way import only
              ▼
Internal repository = permanent downstream product line
```

내부는 `vendor/upstream`(반입 baseline, 내부 수정 금지)과 `company/main`(운영 형상)을 나눈다. 다음 반입은 `vendor/upstream`을 갱신한 뒤 `company/main`으로 **merge**한다. 매번 내부 이력을 upstream 위로 재작성하는 방식은 택하지 않는다 — 다운스트림에서는 "우리가 무엇을 바꿨는가"가 감사 대상이고, 재작성은 그 이력을 반복해서 새로 만든다. **내부 수정을 외부로 되돌리는 절차는 설계하지 않는다.** 그것이 성립하지 않는 것이 이 반입의 전제이므로, 성립하는 척하는 절차를 만드는 것이 더 나쁘다.

**Upstream Feedback은 코드 반출이 아니다** (CR-073). 사내 서버는 public `github.com`에서 pull만 하고 private GHE에는 push·pull한다. 운영 중 upstream 수정이 필요한 사실이 드러나면 담당자가 증상·재현 조건·영향·필요한 정정을 텍스트로 옮겨 public origin에 전달한다. 토큰·키·사내 주소·고객 데이터·내부 코드 diff는 전달하지 않는다. public origin은 전역 ID를 다시 배정하고 실제 source에서 원인을 검증해 수정·시험·릴리스를 만든다. origin에 반영된 피드백 항목은 사내 목록에서 제거한다. 이 경로는 발견을 전달할 뿐 `company/main`을 upstream에 merge하거나 외부 저장소의 정본을 바꾸지 않는다.

**6. 환경 차이는 configuration으로 흡수하는 것을 우선한다.** GHE URL·OIDC·CA·프록시·호스트명·접속 URL·저장 경로가 core code 수정 없이 들어가야 한다. 내부 divergence를 줄이는 것이 영구 다운스트림의 장기 유지비를 정하기 때문이다. 다만 **아직 필요가 실증되지 않은 설정 표면을 미리 만들지 않는다** — 사내 요구가 실제로 생겼을 때 그 자리를 연다.

### Consequences

- **Positive**: 첫 사내 반입이 실행 가능한 절차를 갖는다. 오케스트레이터 운영 부담 없이 제품을 검증한다. 반입된 형상의 출처가 파일 하나로 증명된다. Profile B의 자산이 보존되어 다중 서버로 갈 때 다시 만들지 않는다. 이미지 빌드 경로가 생기면서 **DEV-490이 두 프로파일 모두에서 해소된다.**
- **Negative**: **호스트 장애가 곧 전체 장애다.** NFR-004의 가용성 목표와 RTO 30분을 Profile A에서 보장하지 않으며, 그것은 파일럿 단계에서 승인된 trade-off다(CR-059). 배포 산출물이 두 벌이 되어 역할을 더할 때 둘 다 갱신해야 한다 — 그 규율은 운영 도달성 회귀가 **프로파일마다** 묻는 것으로 강제한다. 번들 크기가 크다(백킹 이미지 셋만 1.6GB 이상).
- **Follow-up**: `WP-070`이 이미지 빌드·Compose 프로파일·번들·런북을 만든다. Profile A에서 실측할 수 없는 항목(사내 GHE·OIDC·CA·프록시·실서버 성능)은 릴리스 검증 계획이 `NOT RUN — internal environment required`로 구분한다. Profile B 승격은 다중 서버가 실제로 필요해질 때 별도 CR로 열며, 그때 `OD-006`의 3노드 결정이 다시 정본이 된다.

### 정정 — 사내 outbound 전제 (CR-063, 2026-09-02)

**Context 표의 "오프라인 반입 — 사내에서 컨테이너 레지스트리·npm에 닿지 않는다"는 실측하지 않은 가정이었다.** 결정자가 2026-09-02에 **사내 호스트나 사내 어느 위치에서든 github.com에 닿는다**고 확인했다(`DEV-528`). 그 확인은 결정자의 진술이며 사내에서의 실측은 아직 없다 — 그래서 런북 7장은 그것을 `NOT RUN — internal environment required`로 남긴다.

**결정 3~6은 그대로다.** 설치는 여전히 번들에서만 하고 레지스트리·npm·`git clone`을 요구하지 않으며, 계보 증명·단방향 계승·configuration 우선도 바뀌지 않는다. **바뀌는 것은 운반 경로 하나다** — 번들의 운반 아카이브를 GitHub Release 자산으로 발행하고, 사내에서 이 저장소 한정 읽기 토큰으로 받아 GitHub가 자산마다 계산하는 SHA-256 digest와 대조한다(`WP-072`). "조직의 반입 절차 / 물리적 이동"으로만 적혀 있던 경계가 실행 가능한 절차가 된다.

**사내가 github.com에 닿는다고 해서 번들을 버리고 사내에서 직접 `docker pull`·`git clone`하는 방식으로 가지 않는다.** 이유는 넷이다. ① 번들 경로는 checksum·manifest로 출처가 증명되고 설치·복구·롤백까지 실제로 관통 검증됐다(원장 6.60·6.61·6.64장). ② 직접 pull은 설치와 롤백을 외부 가용성에 묶는다 — 롤백에 이전 이미지가 로컬에 있어야 한다는 런북 3장의 규칙이 그것을 막으려는 것이다. ③ Docker 데몬이 사내 프록시·CA를 거쳐 레지스트리에 닿는지는 검증된 적이 없다(`DEV-494`와 같은 모양). ④ "github.com에 닿는다"가 Docker 호스트의 레지스트리 pull까지 뜻하는지 확인되지 않았다. github.com에 닿지 않는 환경이 나오면 같은 파일을 조직의 반입 채널로 옮기며 검증은 같다.


## ADR-022 M 넘버 표기는 Data Plane이 수행하는 유일한 자동 GHE 쓰기

### Context

`CR-077`이 `FR-SEQ-009`를 승인하면서 PR 제목에 M 넘버를 써넣기로 했다. 그런데 이 제품의 구조는
**Search/Data Plane이 읽기 전용**이라는 전제 위에 서 있다. `CR-005`가 연 GitHub Operations Plane에도
쓰기가 있지만 그것은 성격이 다르다 — 사용자가 명시적으로 요청한 실행이고, 위험도별 확인(`FR-GH-009`)과
감사(`FR-GH-012`)를 거치며, 실패하면 그 사용자에게 돌아간다.

M 넘버 표기는 **아무도 요청하지 않았는데 시스템이 스스로 남의 PR을 고치는 일**이다. 수집 파이프라인이
도는 것만으로 GHE의 상태가 바뀐다. 이것을 기존 쓰기와 같은 것으로 취급하면 두 가지가 무너진다:
Operations Plane의 "사용자 명시 요청만"이라는 정의가 거짓이 되고, Data Plane의 자격 증명이
읽기 최소 권한이라는 THR 완화 근거가 사라진다.

### Options

1. Operations Plane의 실행 경로를 재사용한다.
2. Data Plane 안에 **반경이 고정된 전용 쓰기 경로**를 둔다.
3. 표기를 포기하고 이 제품의 화면에서만 M 넘버를 보여 준다.

옵션 1은 위임 사용자 신원(`FR-GH-*`는 user-to-server 토큰을 쓴다)을 요구하는데 자동 잡에는 위임할
사용자가 없다. 옵션 3은 회의 결정을 이행하지 않는 것이다 — 회의가 제목 표기를 고른 이유는 M 넘버가
**PR Search 밖에서도**, 즉 GitHub 목록과 알림과 빌드 로그에서도 보여야 하기 때문이다.

### Decision

**옵션 2 + 제약 다섯.** 쓰기를 허용하되 반경을 못 박는다.

1. **전용 GitHub App을 쓴다.** 설치 토큰의 권한은 `pull_requests:write` 하나이며, 조회용 Data App과
   자격 증명을 공유하지 않는다. 조회 토큰에 쓰기를 얹으면 그 토큰이 유출됐을 때 피해 범위가 달라진다.
2. **쓰기 대상은 PR 제목 하나다.** 본문·레이블·상태·코멘트로 넓히지 않는다. 본문 표기는 별도 애플리케이션에서 다루기로
   했고(CR-077 범위 밖), 나머지는 승인한 적이 없다.
3. **저장소별로 끌 수 있다** (`FR-SEQ-009` AC-6). 꺼진 저장소는 채번만 하고 표기하지 않는다.
4. **감사 기록 대상이다** (`pull_request.annotate`). 시스템이 한 쓰기일수록 누가 언제 무엇을 고쳤는지가
   남아야 한다.
5. **덮어쓰지 않는다.** 다른 M 넘버 접두가 이미 있으면 교체하지 않고 불일치로 기록한다 — 사람이 손으로
   넣었거나 다른 도구가 쓴 값을 조용히 지우면, 이 제품이 조사 대상 자체를 오염시킨다.

### Consequences

- Positive: 회의가 요구한 것을 이행하면서 쓰기 반경이 **한 필드**로 갇힌다. 실패해도 PR의 내용은
  바뀌지 않고 제목의 접두만 없다.
- Negative: **"이 제품은 읽기 전용이다"라는 한 줄 설명이 더는 성립하지 않는다.** 보안 문서의 위협
  모델과 자격 증명 서술이 함께 바뀌어야 하고, 앞으로 "자동 쓰기를 하나 더 늘리자"는 요청이 올 때마다
  이 결정이 선례로 인용될 것이다. 그래서 제약 2를 명시적으로 적었다.
- **에폭이 오르면 이미 박힌 제목이 틀린 값을 가리킨다.** 재채번은 M 넘버를 바꾸지만 제목은 제약 5에
  따라 자동으로 고치지 않는다. 그 상태는 불일치로 드러나며, 사람이 판단한다.
- Follow-up: 에폭 상향 후의 제목 일괄 갱신은 운영자 승인 절차를 요구하므로 별도 CR로 연다. 자동으로
  수백 건의 제목을 고치면 그만큼의 알림이 나간다.
- Follow-up: 표기 실패율을 SLI로 감시한다. 조용히 실패하면 M 넘버가 있는 PR과 없는 PR이 섞인다.
