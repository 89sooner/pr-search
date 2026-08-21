# PR Search 비동기 작업 및 이벤트

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

장시간 작업, 큐, 이벤트, 재시도, 실패 대기열, 진행률 계약을 정의한다. 전달 계층 결정은 ADR-002를 따른다.

## 2. 큐 구조

`EventBus` 포트(ADR-002) 뒤에 Redis Streams 어댑터를 둔다. 스트림과 소비자 그룹은 다음과 같다.

| 스트림 | 소비자 그룹 | 워커 역할 | 파티션 키 | 동시성 |
| --- | --- | --- | --- | --- |
| `prs:ingest` | `enrich` | 보강 | `repository_id` | 저장소당 1, 전체 기본 16 |
| `prs:enriched` | `project` | 문서 투영 | `repository_id` | 전체 기본 16 |
| `prs:projected` | `link` | 관계 파생 | `repository_id` | 전체 기본 8 |
| `prs:sequence` | `sequence` | 서수 채번 | `repository_id:base_branch` | 시퀀스 공간당 1 (advisory lock) |
| `prs:batch` | `batch` | 백필·스캔·재색인·점검 | `job_id` | 전체 기본 3 |
| `prs:permission` | `authz` | 권한 캐시 무효화 | `user_id` | 전체 기본 4 |

**백필은 `prs:batch`로 분리한다.** 실시간 스트림과 워커 풀을 공유하지 않으므로 대형 저장소 백필이 실시간 수집 지연을 만들지 않는다 (FR-ING-006 AC-3).

**시퀀스 스트림은 파티션 키가 `repository_id:base_branch`다.** 같은 시퀀스 공간의 채번이 직렬화되어야 하기 때문이다. 추가로 PostgreSQL advisory lock이 이중 안전장치가 된다 (FR-SEQ-001 AC-6).

## 3. Job 카탈로그

| Job ID | 작업 | Trigger | Worker | Retry | Timeout | Progress Event | 관련 요구사항 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| JOB-ING-001 | 원본 이벤트 아웃박스 enqueue | 게이트웨이 (동기) | ingest-gateway | 없음 (아웃박스가 보증) | 300ms | - | FR-ING-001 |
| JOB-ING-002 | PR 보강 (커밋·파일·리뷰) | EVT-ING-001 | enrich | 5회 지수 백오프 | 60초 | - | FR-ING-004 |
| JOB-ING-003 | 문서 투영·업서트 | EVT-ING-002 | project | 5회 지수 백오프 | 30초 | - | FR-ING-005 |
| JOB-ING-004 | 저장소 백필 | 수동 (API-ADM-002) / 저장소 등록 | batch | 항목별 3회, 잡 전체는 재개 | 없음 (중단·재개) | EVT-JOB-001 | FR-ING-006 |
| JOB-ING-005 | 조정 스캔 | 스케줄 (기본 1시간) / 수동 | batch | 3회 | 30분 | EVT-JOB-001 | FR-ING-011 |
| JOB-ING-006 | 재색인 | 수동 (API-ADM-004) | batch | 없음 (실패 시 별칭 미전환) | 없음 | EVT-JOB-001 | FR-ING-008 |
| JOB-ING-007 | 아웃박스 재적재 | 스케줄 (5분) | batch | 3회 | 5분 | - | ADR-002 follow-up |
| JOB-ING-008 | PostgreSQL↔ES 정합성 감시 | 스케줄 (6시간) | batch | 3회 | 30분 | EVT-JOB-001 | ADR-004 follow-up |
| JOB-ING-009 | 실패 대기열 재처리 | 수동 (API-ADM-003) | ops (WP-009) → batch (WP-019 이후) | 이벤트별 누적 | 10분 | EVT-JOB-001 (batch 이후) | FR-ING-007 |
| JOB-SEQ-001 | 시퀀스 증분 채번 | `push` 이벤트 / 백필 완료 | sequence | 5회 지수 백오프 | 10분 | EVT-SEQ-001 | FR-SEQ-001 |
| JOB-SEQ-002 | 시퀀스 재채번 | 재작성 감지 / 수동 (API-ADM-007) | sequence | 없음 (실패 시 `stale`) | 60분 | EVT-SEQ-002, EVT-JOB-001 | FR-SEQ-005 |
| JOB-SEQ-003 | 시퀀스 정합성 점검 | 수동 / 스케줄 (일 1회, 표본) | batch | 3회 | 30분 | EVT-JOB-001 | FR-ADMIN-003 |
| JOB-REL-001 | 참조 간선 추출 | EVT-ING-003 | link | 3회 | 30초 | - | FR-REL-003 |
| JOB-REL-002 | 되돌림 간선 파생 | EVT-ING-003 | link | 3회 | 30초 | - | FR-REL-004 |
| JOB-REL-003 | 체리픽 간선 파생 | EVT-ING-003 | link | 3회 | 60초 | - | FR-REL-005 |
| JOB-REL-004 | 스택 간선 파생 | EVT-ING-003 (PR 이벤트) | link | 3회 | 30초 | - | FR-REL-006 |
| JOB-REL-005 | 미해결 참조 해결 | EVT-ING-003 | link | 3회 | 30초 | - | FR-REL-003 AC-3 |
| JOB-REL-006 | 관계 전량 재파생 | 수동 (API-ADM-002) | batch | 항목별 3회 | 없음 | EVT-JOB-001 | FR-REL-003~006 |
| JOB-AUTH-001 | 권한 캐시 갱신·무효화 | EVT-AUTH-001 / TTL 만료 | authz | 3회 | 10초 | - | FR-AUTH-003 |

**JOB-AUTH-001의 대상 펼치기 (CR-015, DEV-042·DEV-045·DEV-046).** 게이트웨이는 웹훅이 준 것만 싣고, 펼치는 일은 전부 이 소비자가 한다 — 수신 경로에 GHE 동기 호출을 넣으면 NFR-002의 수신 p95 300ms가 무너지기 때문이다.

| 실린 필드 | 무효화 대상 | 찾는 방법 |
| --- | --- | --- |
| `user_ids[]` | 그 사용자들 | `app_user.github_user_id`로 조회한다. login은 개명될 수 있으나 숫자 id는 아니다 (DEV-043) |
| `team_id` | 팀 전원 | GHE에서 구성원을 다시 읽어 `team_member`를 갱신하고, 같은 응답을 무효화 대상으로 쓴다. 표가 비어 있어도 성립한다 |
| `repository_id` | 그 저장소를 볼 수 있던 사용자 | (`permission_cache.repository_ids`가 그 저장소를 담은 행) ∪ (`org_ids`가 그 저장소의 조직을 담은 `org_team` 행). 둘 다 GIN 색인으로 찾는다 |

무효화는 Redis 키 삭제 + `permission_cache` 행 삭제 + `app_user.access_scope_version` 증가다. **버전 증가가 울타리다** — 회수 직전에 시작된 GHE 조회가 회수 뒤에 끝나 회수 이전 범위를 캐시에 다시 써 넣는 것을 막는다 (DEV-044). 대량 무효화 시 사용자 단위 요청 병합과 동시 요청 상한 20을 적용한다 (FR-AUTH-003 예외 처리).

| JOB-SRCH-001 | 검색 결과 비동기 내보내기 | 수동 (API-SRCH-006) | batch | 없음 | 30분 | EVT-JOB-001 | FR-SRCH-012 |
| JOB-AUD-001 | 감사·원본 보존 만료 파티션 드롭 | 스케줄 (일 1회) | batch | 3회 | 10분 | - | FR-ING-003, FR-AUTH-004 |
| JOB-MIR-001 | 미러 fetch 동기화 | `push` 이벤트 / 스케줄 (6시간) | sequence | 3회 | 15분 | - | ADR-005 |

## 4. Event 카탈로그

| Event ID | 이름 | Producer | Consumer | Payload | Ordering/Dedupe |
| --- | --- | --- | --- | --- | --- |
| EVT-ING-001 | `ingestion.event_received` | ingest-gateway | enrich | `{ delivery_id, event_type, action, repository_id, correlation_id, occurred_at }` | 파티션 `repository_id`, 멱등 `delivery_id` |
| EVT-ING-002 | `ingestion.enriched` | enrich | project | **self-contained bounded (CR-010, DEV-013)** — `{ delivery_id, repository_id, entity_kind, pr_number, pull_request, source_commit_shas[], changed_files[], reviews[], source_commits_truncated, files_truncated, enrichment_pending, enrichment_errors[], correlation_id }`. `pull_request`는 **PR 문서 매핑(ENT-CORE-002)이 선언한 PR 고유 필드 전부**를 나른다 (CR-011, DEV-018) — `number, title, body, state, draft, labels[], author, created_at, updated_at, closed_at, merged, merged_at, merge_commit_sha, head_ref, head_sha, base_ref, base_sha`. `created_at`이 없으면 투영이 `lead_time_seconds`·`first_review_wait_seconds`를 계산할 수 없다. 투영이 GitHub API를 다시 부르지 않아도 되도록 필요한 것을 실어 보낸다. 원본 웹훅 전량·patch/diff 본문·소스 코드·토큰은 싣지 않는다. 커밋 250건·파일 3000건 상한 유지 | 위와 동일 |
| EVT-ING-003 | `ingestion.projected` | project | link | `{ repository_id, entity_kind, entity_id, document_version, correlation_id }` | 위와 동일 |
| EVT-ING-004 | `ingestion.failed` | 모든 워커 | ops | `{ delivery_id, stage, error, retry_count, correlation_id }` | 멱등 `(delivery_id, stage)` — **`dead_letter`의 유일 제약이 같은 키로 강제한다** (CR-012, DEV-022) |
| EVT-SEQ-001 | `sequence.assigned` | sequence | project, ops | `{ repository_id, base_branch, seq_epoch, from_seq, to_seq, head_sha }` | 시퀀스 공간별 직렬 |
| EVT-SEQ-002 | `sequence.reassigned` | sequence | project, 알림, ops | `{ repository_id, base_branch, old_epoch, new_epoch, diverged_at_seq, affected_count }` | 시퀀스 공간별 직렬 |
| EVT-SEQ-003 | `sequence.stale` | sequence | ops, 알림 | `{ repository_id, base_branch, reason, last_error }` | 최신 값 우선 |
| EVT-AUTH-001 | `permission.invalidated` | ingest-gateway | authz | `{ user_ids[], team_id, repository_id, reason }` — 세 대상 필드는 모두 선택이며 **하나 이상이 있어야 한다.** `member` 웹훅은 `user_ids`, `team` 웹훅은 `team_id`, `repository` 웹훅은 `repository_id`를 채운다. 게이트웨이는 펼치지 않는다 (CR-015, DEV-041·DEV-042) | 집합 연산이라 멱등 |
| EVT-JOB-001 | `job.progress` | 배치 워커 | ops | `{ job_id, type, target, state, progress: { done, total, unit }, cursor }` | 최신 값 우선 |

## 5. 재시도와 백오프

### 5.1 표준 재시도 정책 (FR-ING-007 AC-1)

| 시도 | 지연 |
| --- | --- |
| 1차 재시도 | 1초 |
| 2차 | 2초 |
| 3차 | 4초 |
| 4차 | 8초 |
| 5차 | 16초 |
| 초과 | 실패 대기열로 이동 |

각 지연에 ±20% 지터를 적용해 동시 실패 시 재시도가 몰리지 않게 한다.

**rate limit 대기는 이 재시도와 다르다 (CR-010, DEV-014).** 둘을 같은 것으로 세면 실제 장애가 아닌 대기가 실패로 집계된다.

| | 표준 재시도 | rate limit defer |
| --- | --- | --- |
| 언제 | 네트워크·5xx·타임아웃 등 실제 실패 | 주 한도 소진, `retry-after` 수신 |
| 얼마나 기다리나 | 1·2·4·8·16초 + ±20% 지터 | GitHub이 알려 준 회복 시각(`retryAt`)까지 |
| 재시도 예산 | 소비한다 (5회) | **소비하지 않는다** |
| 소진하면 | 실패 대기열 | 없음 — 회복 시각이 지나면 그냥 다시 시도한다 |

한도가 10분 뒤에 풀리는데 30초마다 재전달되면 회복 전에 5회를 소진해 멀쩡한 이벤트가 실패 대기열로 간다. 그래서 `EventBus` 핸들러가 처분을 돌려준다 — `retry`(표준 백오프), `defer`(지정 시각까지, 예산 미소비), `dead_letter`(종료 기록 후 ack). 어느 어댑터를 쓰든 아래는 지켜야 한다.

- `retryAt` 이전에 GHE로 HTTP 요청을 다시 보내지 않는다
- rate limit defer는 재시도 예산을 소비하지 않는다
- 관계없는 파티션을 프로세스 전역 sleep으로 막지 않는다
- 같은 파티션의 기존 순서 보장을 깨지 않는다
- 표준 재시도는 5회다
- 재시도 소진 뒤 실패 대기열에 기록하고 **원 이벤트는 ack해 파티션을 푼다**
- 404는 즉시 실패 대기열로 보내고 ack한다

### 5.2 재시도 대상 판정

| 분류 | 예시 | 처리 |
| --- | --- | --- |
| **재시도 가능** | GHE 5xx, 네트워크 타임아웃, ES 429, PostgreSQL 일시 연결 실패, advisory lock 획득 실패 | 표준 백오프로 재시도 |
| **재시도 가능 (특수)** | GHE rate limit 소진 (403 + `x-ratelimit-remaining: 0`) | 표준 백오프가 아니라 `x-ratelimit-reset` 시각까지 대기 후 재시도 (FR-ING-004 AC-2) |
| **재시도 가능 (특수)** | GHE secondary rate limit (429 + `retry-after`) | 헤더가 지정한 시간만큼 해당 토큰 격리 |
| **재시도 불가** | 서명 불일치, 404 (삭제된 PR), 매핑 위반(`dynamic: strict` 거부), payload 파싱 실패 | 즉시 실패 대기열로 이동. 재시도 낭비 없음 |
| **부분 성공** | 보강 일부 실패 (파일 목록은 얻고 리뷰는 실패) | 얻은 것만 반영하고 `enrichment_pending: true` 유지 후 재시도 |

### 5.3 실패 대기열 (FR-ING-007)

- 상한 초과 이벤트는 `dead_letter` 테이블에 `state: 'pending'`으로 저장한다. 실패 사유, 마지막 오류 메시지, 재시도 횟수를 함께 남긴다 (AC-2).
- 운영자가 개별 또는 일괄 재처리한다 (AC-3). 재처리는 `raw_event`에서 원본을 읽어 파이프라인에 재투입하며 멱등 규칙이 그대로 적용된다 (AC-4).
- 같은 이벤트가 3회 재처리 실패하면 `state: 'held'`로 전환하고 자동 재처리 대상에서 제외한다. 운영자 개입이 필요함을 A-001에 표시한다.
- 실패 대기열 잔량이 100건을 넘으면 경보를 발생시킨다 (AC-5). 세는 대상은 `state IN ('pending','reprocessing')`이다 — `held`는 이미 사람이 보기로 한 것이고 `resolved`는 끝난 것이라 임계를 잠식하면 안 된다.

**재투입 지점은 항상 `prs:ingest`다 (CR-012).** 어느 단계에서 실패했든 마찬가지다. `EVT-ING-002`·`EVT-ING-003`은 어디에도 보존되지 않으므로 `project` 단계 실패를 그 단계부터 되살릴 방법이 없다. 다시 만들 수 있는 유일한 출발점은 `raw_event`의 원본이며, 앞 단계를 다시 도는 비용은 멱등 규칙(FR-ING-002)이 중복을 만들지 않는다는 보장으로 상쇄된다.

**JOB-ING-009의 실행 주체는 단계에 따라 다르다 (CR-012, DEV-024).** 재처리 자체는 "행을 읽어 스트림에 다시 넣는" I/O 가벼운 작업이라 `ops` 모듈이 요청 안에서 직접 수행한다(1회 최대 500건). `batch` 워커와 `prs:batch` 스트림은 WP-019가 세우므로, 진행률 이벤트 `EVT-JOB-001`과 10분 타임아웃은 그때부터 적용된다. 그전까지 재처리 결과는 응답 본문이 그대로 알려 준다.

**`EVT-ING-004`는 아직 발행되지 않는다 (CR-012, DEV-026).** 카탈로그가 정한 소비자 `ops`는 스트림 소비자가 아니라 `dead_letter` 테이블을 읽는 조회 모듈이고, 경보 경로는 `dead_letter_total{state}` 지표가 맡는다(WP-009 범위). 지금 토픽을 만들면 소비자 없는 스트림이 하나 생길 뿐이다. 알림 소비자가 생기는 운영 고도화(REL-005)에서 발행 여부를 정한다 — **워커가 `dead_letter` 행을 동기적으로 남기므로 이벤트가 없다고 기록이 유실되지는 않는다.**

## 6. 진행률 보고

배치 잡은 `job.progress` 필드를 30초 이내 간격으로 갱신한다 (FR-ADMIN-002 AC-3).

```json
{
  "job_id": 8801,
  "type": "backfill",
  "target": "acme/payments",
  "state": "running",
  "progress": { "done": 1842, "total": 5210, "unit": "pull_request" },
  "cursor": { "page": 19, "last_pr_number": 3368 },
  "started_at": "2026-08-19T02:00:00Z"
}
```

- `cursor`는 중단 후 재개 지점이다 (FR-ING-006 AC-4). 잡이 중단되어도 이 값에서 이어간다.
- `total`을 미리 알 수 없는 잡(조정 스캔)은 `unit`을 `repository`로 두고 저장소 수를 총량으로 쓴다.
- 진행률 갱신은 잡 처리 트랜잭션과 분리한다. 진행률 쓰기 실패가 잡을 중단시키지 않는다.

## 7. 잡 동시성과 중복 방지

- `job` 테이블의 부분 유니크 인덱스(`WHERE state IN ('queued','running','paused')`)가 같은 `(type, target)` 잡의 동시 실행을 막는다 (FR-ADMIN-002 AC-4).
- 중복 요청은 409 `JOB_CONFLICT`와 실행 중 잡 ID를 반환한다.
- 동시 실행 백필 잡 수는 설정값이며 기본 3이다 (FR-ING-006 AC-6). `prs:batch` 소비자 동시성으로 강제한다.
- 중단 요청 후 30초 안에 잡이 멈추지 않으면 강제 종료하고 `cancelled`로 기록한다 (FR-ADMIN-002).

## 8. 순서 보장

| 대상 | 보장 수준 | 방법 |
| --- | --- | --- |
| 같은 저장소의 이벤트 처리 | 느슨한 순서 | 파티션 키 `repository_id`. 워커 동시성 때문에 완전 직렬은 아님 |
| 같은 문서의 업서트 | 강한 순서 | `document_version` 조건부 업서트. 순서가 뒤바뀌어도 최신이 이긴다 (FR-ING-005 AC-1) |
| 같은 시퀀스 공간의 채번 | 강한 직렬 | 파티션 키 + PostgreSQL advisory lock (FR-SEQ-001 AC-6) |
| 실패 대기열 재처리 | 순서 무관 | 멱등과 버전 조건부 업서트가 순서 의존을 제거 |
| 백필과 실시간 이벤트 | 순서 무관 | 백필 문서도 `document_version` 규칙을 따라 실시간을 덮어쓰지 않는다 (FR-ING-006 AC-5) |

**설계 원칙**: 순서 보장을 큐에만 의존하지 않는다. `document_version` 조건부 업서트가 있으면 순서가 어긋나도 최종 상태가 옳다. 큐의 순서 보장은 시퀀스 채번에만 필수다.

## 9. 스케줄

| 잡 | 주기 | 시각 | 비고 |
| --- | --- | --- | --- |
| JOB-ING-005 조정 스캔 | 1시간 | 매시 정각 + 저장소별 분산 | 저장소를 시간 단위로 분산해 API 부하 평탄화 |
| JOB-ING-007 아웃박스 재적재 | 5분 | - | `queued_at`이 10분 이상 지나고 `processed_at`이 없는 행 |
| JOB-ING-008 정합성 감시 | 6시간 | - | PostgreSQL↔ES 문서 수·표본 대조 |
| JOB-SEQ-003 정합성 점검 (표본) | 1일 | 04:00 KST | 시퀀스 공간별 최근 1000개 대조 |
| JOB-MIR-001 미러 동기화 (보정) | 6시간 | - | push 이벤트 누락 대비 |
| JOB-AUD-001 보존 만료 | 1일 | 03:00 KST | 파티션 드롭 |

## 10. 운영 지표

| 지표 | 정의 | 임계 | 관련 요구사항 |
| --- | --- | --- | --- |
| `ingest_received_total` | 웹훅 수신 건수 | - | FR-ADMIN-001 |
| `ingest_rejected_total` | 서명 검증 실패 건수 | 5분간 10건 초과 시 경보 | FR-ING-001 AC-2, NFR-005 |
| `ingest_duplicate_total` | 중복 전달 건수 | - | FR-ING-002 AC-3 |
| `ingest_response_seconds` | 수신 응답 시간 히스토그램 | p95 300ms 초과 시 경보 | NFR-002 |
| `queue_depth{stream}` | 스트림별 대기 길이 | 10000 초과 시 경보 | FR-ADMIN-001 |
| `stage_latency_seconds{stage}` | 단계별 처리 지연 | - | FR-ADMIN-001 AC-1 |
| `ingestion_lag_seconds` | 수신 → 색인 반영 지연 | p95 10초, p99 60초 초과 시 경보 | NFR-002 |
| `enrich_pending_total` | 보강 대기 문서 수 | 증가 추세 시 경보 | FR-ING-004 |
| `github_rate_limit_remaining{token}` | 토큰별 잔여 한도 | 10% 미만 시 경고 | FR-ING-004 AC-2 |
| `dead_letter_total{state}` | 실패 대기열 잔량 | pending 100건 초과 시 경보 | FR-ING-007 AC-5 |
| `retry_total{stage,reason}` | 재시도 횟수 | 급증 시 경보 | - |
| `sequence_space_state{state}` | 시퀀스 공간 상태별 수 | `stale` 1개 이상 시 경보 | FR-SEQ-001 |
| `sequence_reassign_total` | 재채번 발생 횟수 | 1건이라도 발생 시 알림 | FR-SEQ-005 AC-5 |
| `reconcile_missing_total` | 조정 스캔이 발견한 누락 수 | 0 초과 시 경고 | FR-ING-011 AC-4, NFR-002 |
| `job_duration_seconds{type}` | 잡 소요 시간 | 재색인 4시간 초과 시 경보 | NFR-008 |
| `mirror_disk_usage_ratio` | 미러 볼륨 사용률 | 85% 초과 시 경보 | ADR-005 |
| `patch_id_failure_total` | patch-id 계산 실패 수 | 증가 추세 시 경고 | FR-REL-005 |
| `permission_cache_hit_ratio` | 권한 캐시 적중률 | 0.8 미만 시 경고 | FR-AUTH-003 AC-5 |
| `link_pending_total` | 관계 파생 대기 문서 수 | 증가 추세 시 경고 | FR-REL-003 |

## 11. 사용자 가시 복구 경로

| 상황 | 화면 표시 | 사용자 행동 |
| --- | --- | --- |
| 보강 대기 | `enrichment_pending` 배지 + 재조회 버튼 | 잠시 후 재조회 |
| 관계 파생 대기 | `links_pending` 배지 | 잠시 후 재조회 |
| 시퀀스 채번 중단 | `sequence_stale` 경고 배너 | 운영자 문의 |
| 재채번 진행 중 | `sequence_reassigning` 배너 | 완료 후 재조회 |
| 에폭 무효 | `epoch_stale` 경고 + 현재 에폭 재조회 액션 | 재조회 |
| 실패 대기열 적체 | A-001 경보 상태 | 운영자 재처리 |
| 백필 진행 중 | W-009·A-003 진행률 | 대기 |
| 검색 엔진 장애 | `degraded` 배너 ("검색 실패, 수집은 계속됨") | 복구 대기 |
| 내보내기 잡 실패 | 잡 상태 `failed` + 사유 | 재실행 |

부분 파일은 제공하지 않는다. 내보내기 실패 시 완성된 파일만 다운로드 가능하다 (FR-SRCH-012 예외 처리).

## 9. GitHub Operations Plane 잡과 이벤트 (CR-005 신규)

Operations Plane의 비동기 처리는 수집 파이프라인과 큐를 공유하지 않는다 (ADR-013). 실행 요청은 사용자 지시로만 생기고, 처리 지연이 수집에 영향을 주면 안 되기 때문이다.

### 9.1 큐

| 큐 | 생산자 | 소비자 | 파티션 키 | 비고 |
| --- | --- | --- | --- | --- |
| `prs:gh:executions` | `search-api`(실행 수락) | `gh-executor` | `{host}:{repository}` | 같은 저장소 작업의 순서를 유지한다 |
| `prs:gh:recipes` | `search-api` | `gh-executor` | `recipe_id` | Recipe 단계 진행 |

### 9.2 잡

| Job ID | 이름 | 트리거 | 동시 실행 | 재시도 | 관련 FR |
| --- | --- | --- | --- | --- | --- |
| JOB-GH-001 | gh 명령 실행 | `prs:gh:executions` 소비 | 실행기 상한까지 | **쓰기 작업은 재시도하지 않는다.** R0 읽기만 1회 재시도 | FR-GH-002, FR-GH-006 |
| JOB-GH-002 | Recipe 단계 진행 | `prs:gh:recipes` 소비 | Recipe당 1 | 실패 정책에 따름 (기본 `abort`) | FR-GH-005 |
| JOB-GH-003 | capability 드리프트 점검 | 일 1회 + 배포 시 | 1 | 3회 | FR-GH-001, FR-GH-011 |
| JOB-GH-004 | 위임 토큰 갱신 | 만료 30분 전 | 사용자당 1 | 3회 | FR-GH-008 |
| JOB-GH-005 | 임시 workspace 정리 | 10분 주기 | 1 | 재시도 없음 (다음 주기) | FR-GH-007 |
| JOB-GH-006 | 아티팩트 만료 정리 | 일 1회 | 1 | 3회 | FR-GH-007 |
| JOB-GH-007 | 고아 실행 회수 | 5분 주기 | 1 | 재시도 없음 | FR-GH-006, FR-GH-012 |
| JOB-GH-008 | 실행 잠금 만료 해제 | 1분 주기 | 1 | 재시도 없음 | FR-GH-012 |

**JOB-GH-001이 재시도하지 않는 이유.** 쓰기 작업의 자동 재시도는 중복 실행 위험을 만든다. `pr merge`가 타임아웃으로 실패했을 때 실제로 머지되었는지 아닌지 실행기는 알 수 없다. 재시도는 사용자가 결과를 보고 판단한다.

**JOB-GH-007이 필요한 이유.** 실행기 파드가 죽으면 `running` 상태 행이 영원히 남는다. 이 잡이 실행기 하트비트가 끊긴 실행을 `failed`로 회수한다 (NFR-012 상태 정합성).

### 9.3 이벤트

| Event ID | 이름 | 발행자 | 구독자 | 페이로드 요지 | 관련 FR |
| --- | --- | --- | --- | --- | --- |
| EVT-GH-001 | `gh.execution.requested` | `search-api` | `gh-executor`, 감사 | 실행 ID, capability, 위험도, 중복 방지 키 | FR-GH-002 |
| EVT-GH-002 | `gh.execution.state_changed` | `gh-executor` | 웹(SSE), 감사 | 실행 ID, 이전·현재 상태 | FR-GH-006 |
| EVT-GH-003 | `gh.execution.output` | `gh-executor` | 웹(SSE) | 실행 ID, 스트림 종류, 청크 (영속 저장 안 함) | FR-GH-006 |
| EVT-GH-004 | `gh.execution.finished` | `gh-executor` | 감사, 이력 | 실행 ID, 종료 코드, 출력 해시, 아티팩트 | FR-GH-012 |
| EVT-GH-005 | `gh.approval.requested` | `search-api` | 알림, A-007 | 실행 ID, 필요 역할, 위험도 | FR-GH-009 |
| EVT-GH-006 | `gh.capability.drift_detected` | JOB-GH-003 | 알림, A-006 | 설치 gh 버전, manifest 버전, 차이 요약 | FR-GH-011 |
| EVT-GH-007 | `gh.identity.revoked` | JOB-GH-004 | 웹, 감사 | 사용자, 사유 | FR-GH-008 |

`EVT-GH-003`은 영속 저장하지 않는다. 출력 원문을 저장하면 비밀이 흘러들 수 있고 크기 상한도 지키기 어렵다. 이력에는 출력 해시와 절삭된 요약만 남는다 (FR-GH-012).
