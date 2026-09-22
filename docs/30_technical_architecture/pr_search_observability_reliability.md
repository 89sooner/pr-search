# PR Search 관측성 및 신뢰성

> 상태: review | 버전: v0.8 | 갱신일: 2026-09-22

CR-112 / FR-INT-001: PIPE 연동은 지표 둘을 더한다 — `pipe_integration_request_total{operation, outcome}`(operation은 고정 14종과 `unknown`, outcome은 `ok`·오류 코드·`HTTP_<상태>`)와 `pipe_integration_event_failed_total`(0이 아니면 연동 요청의 행위 주체가 기록되지 않고 있다). 사용자·저장소·질의는 라벨로 쓰지 않는다. 행위 주체·거절 사유는 `pipe_integration_event`(ENT-INT-005)에, 조회 감사는 기존 `audit_record`에 같은 `correlation_id`로 남는다. 알림 기준값은 운영 입력이 모인 뒤 정한다.

CR-079: [설계](pr_search_wp074_design.md) 6.4·10절과 [측정 가이드](../40_delivery/pr_search_wp074_measurement_guide.md)가 stage timestamps, sample attribution, p50/p95/p99/max·누락·음수·pending·retention을 정의한다. NFR-002 수신→검색 p95 10초/p99 60초를 검증 목표로 비교하되 로컬 수치를 사내 보장으로 승격하지 않는다. assigned_at-committed_at은 별도 보조 지표다. DEV-576의 6시간은 스윕 주기이고 실측 상한이 아니다.

## 1. 목적

SLO, SLI, 로그, 메트릭, 트레이스, 알림, 대시보드, 런북, 장애 모드, 용량 계획을 정의한다. 근거 요구사항은 NFR-001, NFR-002, NFR-004, NFR-008이다.

## 2. SLO / SLI

| SLO | SLI | 목표 | 측정 | 관련 요구사항 |
| --- | --- | --- | --- | --- |
| 식별자 해석 지연 | `http_request_duration{route="/resolve"}` p95 | 200ms | API 히스토그램, 5분 창 | NFR-001 |
| 목록 조회 지연 | `http_request_duration{route="/search"}` p95 | 500ms | 위와 동일 | NFR-001 |
| 시퀀스 범위 조회 지연 | `http_request_duration{route="/sequence-ranges"}` p95 | 400ms | 위와 동일 | NFR-001 |
| 집계 지연 | `http_request_duration{route=~"/analytics/.*"}` p95 | 1500ms | 위와 동일 | NFR-001 |
| 검색 가용성 | 성공 응답 / 전체 (5xx 제외) | 월 99.5% | 합성 모니터링 + 실요청 | NFR-004 |
| 웹훅 수신 가용성 | 2xx / 전체 | 월 99.9% | 합성 모니터링 | NFR-004 |
| 웹훅 수신 지연 | `ingest_response_seconds` p95 | 300ms | 게이트웨이 히스토그램 | NFR-002 |
| 수집 반영 지연 | `ingestion_lag_seconds` p95 / p99 | 10초 / 60초 | 수신 시각과 색인 반영 시각의 차 | NFR-002 |
| 이벤트 유실 | `reconcile_missing_total` 30일 합계 | 0 | 조정 스캔 결과 | NFR-002 |
| 시퀀스 정합성 | `sequence_integrity_mismatch_total` | 0 (재작성 제외) | 일 1회 표본 점검 | ADR-007 |
| 재색인 소요 | `job_duration_seconds{type="reindex"}` | 4시간 이내 | 잡 실측 | NFR-008 |
| 롤백 소요 | 배포 훈련 측정 | 10분 이내 | 분기 1회 훈련 | NFR-008 |

에러 예산: 검색 가용성 99.5%는 월 약 3.6시간의 예산이다. 예산의 50%를 소진하면 기능 배포를 멈추고 안정화에 집중한다.

## 3. Telemetry

### 3.1 구조화 로그

모든 로그는 JSON이며 다음 공통 필드를 갖는다.

```json
{
  "timestamp": "2026-08-19T05:02:11.412Z",
  "level": "info",
  "service": "pipeline-worker",
  "role": "enrich",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8",
  "repository_id": 4021,
  "delivery_id": "72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5",
  "message": "enrichment completed",
  "duration_ms": 842
}
```

| 로그 유형 | 내용 | 보존 |
| --- | --- | --- |
| 요청 로그 | 경로, 상태 코드, 지연, 사용자 ID, 상관 ID. **질의 문자열 포함, 응답 본문 제외** | 30일 |
| 잡 로그 | 잡 ID, 유형, 대상, 단계, 진행률, 오류 | 30일 |
| 파이프라인 로그 | 전달 식별자, 단계, 저장소, 소요, 재시도 횟수 | 30일 |
| 시퀀스 로그 | 시퀀스 공간, 에폭, 채번 범위, 재작성 감지 여부 | 1년 (조사 근거) |
| 감사 로그 | PostgreSQL `audit_record` (로그 저장소와 별개) | 1년 |
| 프런트엔드 이벤트 | LCP·INP·CLS, 라우트, 오류 경계 발동 | 30일 |

로그 금지 항목: 토큰, 시크릿, 세션 쿠키, PR 본문 전문, 응답 본문. 배포 게이트의 로그 스캔이 이를 검사한다 (NFR-005).

**시퀀스 로그만 1년 보존한다.** 재채번이 발생했을 때 "언제, 어떤 이유로, 어느 범위가 바뀌었는가"를 나중에 추적할 수 있어야 하기 때문이다.

### 3.2 트레이스

OpenTelemetry로 분산 추적을 수집한다.

| 추적 대상 | 스팬 |
| --- | --- |
| 검색 요청 | `web` 프록시 → `search-api` → 질의 파싱 → 권한 산출 → ES 질의 → 응답 매핑 |
| 수집 파이프라인 | 게이트웨이 수신 → 큐 → 보강(GHE 호출 포함) → 투영(ES 벌크) → 관계 파생 |
| 시퀀스 채번 | 락 획득 → 미러 fetch → rev-list → PostgreSQL 업서트 → ES 갱신 |

상관 ID를 trace ID와 연결해, 하나의 웹훅이 만든 전 과정과 그로 인해 갱신된 문서를 한 흐름으로 추적할 수 있게 한다.

샘플링: 정상 요청 1%, 오류·느린 요청(p95 초과) 100%.

### 3.3 메트릭

메트릭 카탈로그는 `pr_search_async_events_jobs.md` 10장에 정의되어 있다. 여기서는 서비스 계층 메트릭을 추가한다.

| 메트릭 | 유형 | 라벨 |
| --- | --- | --- |
| `http_request_duration_seconds` | 히스토그램 | `service`, `route`, `method`, `status` |
| `http_requests_total` | 카운터 | 위와 동일 |
| `es_query_duration_seconds` | 히스토그램 | `index`, `query_kind` |
| `es_query_errors_total` | 카운터 | `index`, `reason` |
| `pg_query_duration_seconds` | 히스토그램 | `operation` |
| `access_scope_size` | 히스토그램 | `scope_kind` |
| `search_result_count` | 히스토그램 | `route` |
| `facet_omitted_total` | 카운터 | - |
| `aggregation_approximate_total` | 카운터 | - |
| `audit_record_failed_total` | 카운터 | `action` (CR-054) |
| `frontend_web_vitals` | 히스토그램 | `metric`(LCP/INP/CLS), `route` |

**`audit_record_failed_total`의 라벨은 `action` 하나다 (CR-054).** 감사 실패가 특정 경로에 몰리는지 보려면 그 축이 필요하고, 정본 표의 액션은 유한하므로 카디널리티가 닫힌다. **`user_id`·`repository`·`target`·`query`·`correlation_id`는 라벨로 쓰지 않는다** — 셋 다 무한에 가깝고, 지표 라벨은 시계열마다 메모리를 쓰며 **감사가 담은 값을 지표로 다시 내보내면 지표 엔드포인트가 두 번째 유출 경로가 된다.

### 3.4 지표를 누가 읽는가 (CR-013)

노출과 질의는 다른 일이다. 세 프로세스(`ingest-gateway`, `pipeline-worker`, `search-api`)가 각자 `/metrics`로 **노출**하고, 사내 Prometheus 호환 저장소가 그것을 긁어 **보관·집계**한다 (인프라 4장).

그래서 API-ADM-006이 값을 어디서 얻는지는 항목마다 다르다.

| 항목 | 출처 | 이유 |
| --- | --- | --- |
| 수신량(분당), 수집 반영 지연 p50/p95, 저장소별 지연 상위 10 | PostgreSQL `raw_event` | `received_at`·`processed_at`이 행에 있어 정확히 계산된다. 표본이 곧 사실이다 |
| 대기열 길이 | Redis 파티션 스트림 | 그 순간의 길이다 |
| 실패 대기열 건수 | PostgreSQL `dead_letter` | 위와 같다 |
| 보강 대기 건수 | Elasticsearch `enrichment_pending` | 문서에 붙은 표식이다 |
| **단계별 지연 p50/p95** | **지표 저장소 (설정 시)** | 워커 프로세스의 히스토그램에만 있다. `search-api`가 읽을 방법이 없다 |

**단계별 지연만 외부 의존이다.** 워커 복제본 하나의 `/metrics`를 직접 긁으면 그 복제본의 히스토그램일 뿐 클러스터 전체가 아니다 — 그것을 전체인 양 내놓는 것은 틀린 답을 자신 있게 말하는 일이라 하지 않는다. 지표 저장소가 설정되지 않으면 그 항목만 `unavailable`로 남긴다 (FR-ADMIN-001 예외 처리).

## 4. 알림

**실패 대기열 임계가 세는 것 (CR-012).** `dead_letter_open_total`은 `pending`과 `reprocessing`의 합이다. `pending`만 세면 **200건을 일괄 재처리한 직후 경보가 사라진다** — 아직 아무것도 해결되지 않았는데도 그렇다. 반대로 `held`와 `resolved`는 세지 않는다. 전자는 이미 사람이 보기로 한 것이고 후자는 끝난 것이라, 둘 다 "지금 쌓이고 있다"의 근거가 아니다. 상태별 세부는 `dead_letter_total{state}`가 따로 노출한다.


| Alert | 조건 | Severity | Runbook |
| --- | --- | --- | --- |
| 수집 중단 | `ingest_received_total` 15분간 0 (평시 유입이 있는 시간대) | P1 | RB-01 |
| 수신 지연 | `ingest_response_seconds` p95 300ms 초과 10분 지속 | P2 | RB-02 |
| 수집 반영 지연 | `ingestion_lag_seconds` p95 10초 초과 15분 지속 | P2 | RB-03 |
| 큐 적체 | `queue_depth` 10000 초과 15분 지속 | P2 | RB-03 |
| 실패 대기열 적체 | `dead_letter_open_total` 100건 초과 (CR-012) | P2 | RB-04 |
| 검색 불가 | `/search` 5xx 비율 10분간 5% 초과 | P1 | RB-05 |
| 검색 지연 | `/search` p95 500ms 초과 15분 지속 | P2 | RB-06 |
| ES 클러스터 이상 | 클러스터 상태 red | P1 | RB-07 |
| ES 색인 거부 | `es_query_errors_total{reason="429"}` 5분 지속 | P2 | RB-08 |
| PostgreSQL 연결 실패 | 연결 오류 5분 지속 | P1 | RB-09 |
| 시퀀스 공간 stale | `sequence_space_state{state="stale"}` 1개 이상 | P2 | RB-10 |
| 시퀀스 재채번 발생 | `sequence_reassign_total` 증가 | P3 (알림) | RB-11 |
| 시퀀스 정합성 불일치 | `sequence_integrity_mismatch_total` 1건 이상 | P2 | RB-11 |
| 시퀀스 색인 투영 미수렴 (CR-113) | `sequence_work_total{kind="project",outcome=~"retry|document_missing|parked|exception"}` 10분 동안 증가하고 같은 창에서 `outcome="done"`이 늘지 않음, 또는 `sequence_index_failed_total` 5분 지속 증가 | P2 | RB-20 |
| 이벤트 유실 발견 | `reconcile_missing_total` 0 초과 | P2 | RB-12 |
| GHE rate limit 소진 | `github_rate_limit_remaining` 10% 미만 30분 지속 | P3 | RB-13 |
| 미러 디스크 부족 | `mirror_disk_usage_ratio` 85% 초과 | P2 | RB-14 |
| 원본 저장 용량 부족 | PostgreSQL 사용률 85% 초과 | P2 | RB-15 |
| 권한 조회 실패 | `PERMISSION_UNAVAILABLE` 5분간 10건 초과 | P1 | RB-16 |
| 권한 캐시 적중률 저하 | `permission_cache_hit_ratio` 0.8 미만 30분 지속 | P3 | RB-16 |
| 서명 검증 실패 급증 | `ingest_rejected_total` 5분간 10건 초과 | P2 (보안) | RB-17 |
| 감사 기록 실패 | `audit_record_failed_total` 증가가 5분 지속 | P2 | RB-18 |
| 재색인 지연 | `job_duration_seconds{type="reindex"}` 4시간 초과 | P3 | RB-19 |
| 조정 스캔 미완주 | 3주기 연속 미완주 | P3 | RB-12 |

P1은 5분 이내 발보한다 (NFR-008).

## 5. 대시보드

| 대시보드 | 대상 | 패널 |
| --- | --- | --- |
| 수집 파이프라인 | 운영자 | 수신량, 단계별 지연, 큐 적체, 실패 대기열, 보강 대기, GHE 한도 잔량, 저장소별 지연 상위 10 |
| 검색 서비스 | 운영자 | 경로별 RPS·지연·오류율, ES 질의 지연, 결과 건수 분포, 패싯 생략률, 근사 집계 비율 |
| 시퀀스 건강 | 운영자 | 공간별 상태, 마지막 채번 시각, 에폭 변경 이력, 정합성 점검 결과 |
| 데이터 정합성 | 운영자 | PostgreSQL↔ES 문서 수 차이, 조정 스캔 누락 건수, 미해결 참조 수 |
| 인프라 | 플랫폼 | ES 클러스터 상태·힙·디스크, PostgreSQL 연결·복제 지연, Redis 메모리, 미러 디스크 |
| 사용자 경험 | 제품 | LCP/INP/CLS, 화면별 오류율, 주간 활성 사용자, SHA→PR 역추적 소요 시간 |

A-001 운영 콘솔 화면은 이 중 "수집 파이프라인" 대시보드의 핵심 지표를 제품 안에서 재현한 것이다 (FR-ADMIN-001). 운영자가 별도 도구를 열지 않아도 1차 판단을 할 수 있게 한다.

## 6. 런북

| ID | 상황 | 절차 요약 |
| --- | --- | --- |
| RB-01 | 수집 중단 | ① GHE 웹훅 전달 상태 확인 ② `ingest-gateway` 파드·헬스체크 확인 ③ PostgreSQL 연결 확인 ④ GHE 측 웹훅 설정 확인 ⑤ 복구 후 조정 스캔 실행으로 누락 보정 |
| RB-02 | 수신 지연 | ① PostgreSQL 쓰기 지연 확인 ② 게이트웨이 CPU·메모리 확인 ③ 파드 증설 ④ 개선 없으면 PostgreSQL 인스턴스 점검 |
| RB-03 | 큐 적체 / 반영 지연 | ① 어느 스트림이 적체됐는지 확인 ② 해당 역할 워커 증설 ③ enrich 적체면 GHE 한도 확인(RB-13) ④ project 적체면 ES 색인 상태 확인(RB-08) |
| RB-04 | 실패 대기열 적체 | ① 실패 사유 분포 확인 ② 단일 원인이면 근본 원인 해소 후 일괄 재처리 ③ `held` 상태 이벤트는 개별 조사 |
| RB-05 | 검색 불가 | ① ES 클러스터 상태 확인(RB-07) ② `search-api` 파드 확인 ③ 권한 조회 실패 여부 확인(RB-16) ④ 저하 모드 배너가 표시되는지 확인 |
| RB-06 | 검색 지연 | ① 느린 질의 로그 확인 ② 집계 부하 여부 확인 ③ ES 노드 CPU·힙 확인 ④ 필요 시 집계 상한 강화(ConfigMap, 재배포 불필요) |
| RB-07 | ES 클러스터 red | ① 미할당 샤드 확인 ② 노드 상태·디스크 확인 ③ 복구 불가 시 스냅샷 복원 ④ 최종 수단으로 PostgreSQL에서 재색인 |
| RB-08 | ES 색인 거부 | ① 서킷 브레이커·힙 확인 ② 백필 중이면 일시 중단 ③ `refresh_interval` 일시 상향 ④ 노드 증설 |
| RB-09 | PostgreSQL 연결 실패 | ① Primary 상태 확인 ② 페일오버 여부 확인 ③ 커넥션 풀 소진 확인 ④ 게이트웨이가 500 반환 중이면 GHE 재전송으로 유실 없음을 확인 |
| RB-10 | 시퀀스 공간 stale | ① `last_error` 확인 ② 미러 상태 확인(RB-14) ③ GHE 접근 확인 ④ 원인 해소 후 채번 잡 재실행 ⑤ 기존 시퀀스 값은 보존됨을 확인 |
| RB-11 | 시퀀스 재작성·불일치 | ① 정합성 점검 실행(표본 → 전량) ② 최초 불일치 지점 확인 ③ 대상 브랜치 강제 푸시 이력 확인 ④ 영향 범위(무효 표식·저장 검색 수) 산출 ⑤ 2단계 확인 후 재채번 ⑥ 사용자 공지 |
| RB-12 | 이벤트 유실 발견 | ① 누락 건수·저장소 확인 ② 해당 저장소 조정 스캔 즉시 실행 ③ 유실 원인(웹훅 미도달 / DLQ / 처리 실패) 판별 ④ 반복되면 GHE 웹훅 설정 점검 |
| RB-13 | GHE rate limit 소진 | ① 소진 토큰 확인 ② 백필 잡 일시 중단 ③ 미러 사용 저장소 비율 확인 ④ 미러 미사용 저장소를 미러 모드로 전환 검토 |
| RB-14 | 미러 디스크 부족 | ① 저장소별 미러 크기 상위 확인 ② `git gc` 실행 ③ PVC 확장 ④ 대형 저장소를 API 폴백 모드로 전환 |
| RB-15 | 원본 저장 용량 부족 | ① 파티션별 크기 확인 ② 보존 기간이 3년 정책값과 일치하는지 확인(OD-003) ③ 정책 초과분이 있으면 오래된 파티션 드롭 ④ 정책 내인데 부족하면 볼륨 확장 (보존 기간 단축은 CR 필요) |
| RB-16 | 권한 조회 실패 | ① GHE API 상태 확인 ② 토큰 유효성 확인 ③ 대량 무효화로 인한 폭주 여부 확인 ④ 동시 요청 상한 조정 ⑤ **만료 캐시로 대체하지 않는다**(기본 거부 유지) |
| RB-17 | 서명 검증 실패 급증 | ① 소스 IP 확인 ② 웹훅 시크릿 회전 중인지 확인 ③ 회전 중이 아니면 보안 담당자 에스컬레이션 ④ 인그레스 제한 강화 검토 |
| RB-18 | 감사 기록 실패 | ① PostgreSQL 쓰기 상태 확인 ② **파티션 존재 확인(월 경계)** — `audit_record`는 파티션 테이블이라 해당 월 파티션이 없으면 모든 INSERT가 거부된다. 파티션을 만드는 것은 `pnpm db:partitions`(`ensureMonthlyPartitions`, 기본 3개월치)이며 **`JOB-ING-006`은 Elasticsearch 재색인 잡이라 무관하다** (PR #83 리뷰). 없으면 그 명령으로 즉시 만든다 ③ 감사 누락 구간을 보안 담당자에게 보고 ④ **주 동작은 계속 처리되고 있다** (FR-AUTH-004 AC-6) — 이 경보는 조회가 막혔다는 신호가 아니라 **기록이 비고 있다**는 신호다 |
| RB-20 | 시퀀스 색인 투영 미수렴 (CR-113) | ① 배포 SHA·endpoint·별칭 확인(`prsctl lineage`, `GET /api/v1/admin/reindex`) ② `prsctl sequence status --repository … --base-branch …`로 현재 에폭·head와 `project` work 상태(`ready`/`retry`/`leased`/`parked`/`done`/`obsolete`, `last_reason`) 확인 ③ `prsctl sequence reproject … --expected-epoch <현재> --dry-run`으로 `would_update`·`document_missing`·`guard_rejected` 건수와 표본 확인 — 아무것도 쓰지 않는다 ④ `document_missing`이면 투영·보강 상태(RB-12·RB-14)를 먼저 본다 — 문서가 없는 것은 투영기가 만들 수 없다 ⑤ `--dry-run` 없이 같은 명령으로 제한 범위(저장소·브랜치·에폭·`--alias`) 재투영을 실행하고 잡 `progress`(`projection`·`pending_documents`)를 본다 ⑥ 새 검색 요청으로 「M number」 정렬·`seq:` 범위·cursor 순회를 확인한다(기존 cursor/PIT는 이전 스냅숏을 유지한다) ⑦ 예외: `epoch_mismatch`는 현재 에폭을 다시 지정, `projection_partial`은 남은 문서의 생성 경로 점검, `mapping_conflict`(같은 SHA를 가리키는 PR 스냅숏 둘)·`other_space`(다른 시퀀스 브랜치가 가진 커밋 문서)는 쓰지 않는 것이 옳다 — 재채번(RB-11)으로 풀지 않는다 |
| RB-19 | 재색인 지연 | ① 진행률 확인 ② 소스(PostgreSQL) 읽기 속도 확인 ③ ES 색인 처리량 확인 ④ 벌크 크기·동시성 조정 ⑤ 별칭 전환 전이므로 서비스 영향 없음을 확인 |

런북 커버리지 요구(NFR-008)는 상위 실패 모드 8종이다. 위 20종이 이를 초과 충족한다.

## 7. 장애 모드와 저하 동작

| 장애 | 영향 | 저하 동작 | 사용자 표시 |
| --- | --- | --- | --- |
| Elasticsearch 불가 | 검색 전면 불가 | **수집은 계속.** 큐에 축적되고 복구 후 소진 | `degraded` 배너: "검색을 일시적으로 사용할 수 없습니다. 수집은 계속되고 있습니다" |
| PostgreSQL 불가 | 수집 중단 | 게이트웨이가 500 반환 → GHE 재전송 대기. 검색은 ES로 계속 동작 | 검색 정상, 신규 데이터 미반영 |
| Redis 불가 | 큐·세션·권한 캐시 불가 | 신규 이벤트는 아웃박스에 남고 복구 후 재적재. 세션은 재로그인 필요. 권한은 PostgreSQL 백업 사용 | 재로그인 안내 |
| GHE API 불가 | 보강·권한 조회 불가 | 웹훅 수집은 계속. 부분 문서로 색인. **권한 조회 실패는 조회 거부**(기본 거부) | `enrichment_pending` 배지 / `permission_unavailable` |
| GHE Git 불가 | 시퀀스 채번 중단 | 기존 시퀀스 보존, 공간 `stale`. API 폴백 시도 | 시퀀스 경고 배너 |
| 미러 볼륨 손실 | 위와 동일 | API 폴백으로 동작, patch-id 비활성 | `patch_id_unavailable` 표시 |
| OIDC 불가 | 신규 로그인 불가 | 기존 세션은 만료까지 유지 | 로그인 실패 안내 + 상관 ID |
| 워커 전체 중단 | 파이프라인 정지 | 큐에 축적. 검색은 기존 데이터로 동작 | 수집 지연 지표 상승 |
| Filebeat 중단 | 원본 아카이브 적재 중단 | **엔티티 색인에 영향 없음.** 파일은 디스크에 유지, 재기동 시 오프셋부터 이어서 적재 | 영향 없음 |

**설계의 핵심 저하 특성**: 검색과 수집이 서로 독립적으로 실패한다. 검색이 죽어도 데이터는 계속 모이고, 수집이 죽어도 기존 데이터는 계속 검색된다. 이 분리가 ADR-004(PostgreSQL SoR)의 실질적 이득이다.

## 8. 용량 계획

| 지표 | 현재 설계 기준 | 감시 | 재산정 트리거 |
| --- | --- | --- | --- |
| ES 문서 수 | PR 500만, 커밋 5000만 | 인덱스별 문서 수 | 설계치 70% 도달 |
| ES 디스크 (엔티티 인덱스) | 약 250GB (복제본 포함) | 인덱스별 저장 크기 | 75% 도달 |
| ES 디스크 (`prs-raw-events` 아카이브) | 약 700GB (복제본 포함, 건당 크기 가정치) | 인덱스별 저장 크기 | 75% 도달 또는 가정치 대비 30% 이상 편차 |
| ES 디스크 (노드 합계) | 약 950GB (복제본 포함) | 노드별 디스크 사용률 | 75% 도달 |
| PostgreSQL `raw_event` | 3년 4TB (OD-003 결정값) | 파티션별 크기 | 볼륨 75% 도달 |
| 미러 디스크 | 약 150GB | `mirror_disk_usage_ratio` | 85% 도달 |
| 웹훅 유입 | 지속 200/s, 버스트 2000/s | `ingest_received_total` | 지속 150/s 도달 |
| 동시 검색 세션 | 500 | 활성 세션 수 | 400 도달 |
| GHE API 소모 | 시간당 한도의 60% 이하 | `github_rate_limit_remaining` | 80% 지속 소모 |

분기 1회 용량 리뷰에서 위 지표를 검토하고, 트리거에 걸린 항목은 CR로 설계 수치를 조정한다. 리뷰에서는 실측 유입을 워크로드 기준선(1,000 PR/일, OD-007)과 대조하고, 기준선을 지속 초과하면 NFR-003 설계 상한까지의 여유(약 2.7배)가 얼마나 남았는지 함께 본다.

## 9. 사고 대응

| 단계 | 내용 |
| --- | --- |
| 탐지 | 알림 발보 (P1 5분 이내) 또는 사용자 문의 |
| 분류 | P1: 검색 불가·수집 중단·보안 사고 / P2: 지연·부분 실패 / P3: 성능 저하·경고 |
| 초동 | 해당 런북 실행. 상관 ID로 영향 범위 확인 |
| 소통 | P1은 사내 채널에 즉시 공지. 저하 모드면 화면 배너로도 표시 |
| 복구 | 런북 절차 완료 후 지표 정상화 확인 |
| 데이터 검증 | 수집 관련 사고는 반드시 조정 스캔을 실행해 유실 여부를 확인한다 |
| 사후 | P1·P2는 사후 분석 작성. 재발 방지 항목을 WP로 등록 |

**수집 관련 사고의 마지막 단계는 항상 조정 스캔이다.** "복구됐다"는 서비스가 살아났다는 뜻이지 데이터가 온전하다는 뜻이 아니다. 유실 0건(NFR-002)을 주장하려면 대조 검증이 필요하다.

## 10. 관측성 구현 체크리스트

- [ ] 상관 ID가 게이트웨이에서 생성되어 큐·워커·로그·감사·응답까지 전파된다.
- [ ] 모든 SLI 메트릭이 노출되고 대시보드에 연결되어 있다.
- [ ] 모든 알림이 런북 ID를 포함한다.
- [ ] 런북이 실제로 실행 가능하다 (분기 1회 훈련으로 검증).
- [ ] 로그에 토큰·시크릿·응답 본문이 없다 (배포 게이트 스캔).
- [ ] 트레이스 샘플링이 오류·느린 요청을 100% 포함한다.
- [ ] A-001 화면의 지표가 대시보드 지표와 동일 소스에서 나온다.
- [ ] 저하 모드가 사용자 화면에 실제로 표시된다 (장애 주입 시험으로 검증).

## 10. GitHub Operations Plane 관측 (CR-005 신규)

### 10.1 SLO

| SLO | 목표 | 관련 NFR |
| --- | --- | --- |
| 실행 요청 수락 지연 | p95 500ms 이하 | NFR-011 |
| R0 읽기 명령 완료 | p95 5초 이하 | NFR-011 |
| 첫 출력 스트리밍 지연 | p95 2초 이하 | NFR-011 |
| 취소 반영 | 3초 이내 | NFR-011 |
| 쓰기 실행 감사 누락 | 0건 | NFR-012 |
| 비종료 상태로 남은 실행 | 0건 | NFR-012 |

### 10.2 알림

| 알림 | 조건 | 등급 |
| --- | --- | --- |
| capability 드리프트 | 실행기 지표 `gh_registry_stale == 1`, 또는 최신 `gh_capability_verification.status ∈ {drift, failed}`, 또는 `/healthz`의 `registry.stale == true` (CR-088). 그 동안 실행은 `registry_stale`로 거절된다 | P2 |
| 레지스트리 검사 오류 반복 | `gh_registry_check_total{result="error"}`·`{result="record_failed"}` 증가, 또는 최신 검사가 주기의 두 배(기본 2일)를 넘김 | P2 |
| 운영 승인 필요 지속 (CR-090) | `GH_OPERATIONS_ENABLED=true`인데 `GET /api/v1/gh/policies`의 `policy.approval`이 없거나 `matches_served=false`(배포 직후·정의 변경·철회), 또는 실행 수락 거절 `GH_ADMIN_ACTION_REQUIRED` 증가 — `RB-25` | P3 |
| 운영 정책 확인 불가 (CR-090) | 실행 수락·정책 변경의 `GH_POLICY_UNAVAILABLE`(503), 또는 실행기 지표 `gh_execution_total{result="policy_unavailable"}` 증가 — `RB-26` | P2 |
| 미분류 capability 발견 | 검증기 보고서의 `GATE-GH-01` 미달(`unclassified > 0`) — CI 단위 시험이 먼저 잡는다. 운영에서는 `gh_capability_snapshot.unclassified_count > 0` | P2 |
| 실행기 포화 | 대기 중 실행이 상한의 80% 초과 | P2 |
| 고아 실행 누적 | JOB-GH-007이 회수한 실행 수 급증 | P2 |
| workspace 정리 실패 | JOB-GH-005 실패 반복 | P2 |
| 감사 기록 실패 | 쓰기 실행 차단 발생 | **P1** |
| 위임 토큰 대량 만료 | 갱신 실패율 급등 | P2 |

### 10.3 런북

| ID | 상황 | 절차 |
| --- | --- | --- |
| RB-20 | capability 드리프트 감지 | ① A-006(「운영 › gh 레지스트리」)에서 실행기 마지막 검사의 상태·gh 관측 버전·바이너리 SHA-256·diff(added/removed/changed)를 본다 — 같은 사실이 실행기 로그 `레지스트리 검사 실패`와 `/healthz`의 `registry`에 있다 ② search-api와 gh-executor의 이미지 버전이 같은지 확인한다(다르면 `PRS_VERSION`을 맞춰 다시 세운다 — 런북 7.C) ③ 저장소에서 `GH_PINNED_BIN=<gh> pnpm gh:diff-capabilities`로 같은 diff를 재현한다 ④ 인벤토리 재생성(`pnpm gh:manifest`) 후 분류 표·규칙 보강 → `pnpm gh:validate-capabilities`가 `GATE-GH-01` 통과 ⑤ 새 manifest는 새 판·새 CR로 반입한다 — 새 정의는 자동으로 승인되지 않는다: 배포 뒤 실행기 기동 검사가 통과하면 운영자가 A-006에서 근거를 확인하고 운영 승인한다(CR-090, `API-GH-008`). 최초 승인이 스냅숏의 `activated_at`을 한 번 채운다 ⑥ 그때까지 실행은 `registry_stale`로 거절된다(실행기가 자동으로 유지) |
| RB-21 | 실행기 포화 | ① 대기열 길이와 장기 실행 확인 ② 타임아웃 임박 실행 식별 ③ 필요 시 실행기 증설 ④ 반복되면 명령군별 타임아웃 재검토 |
| RB-22 | 고아 실행 | ① JOB-GH-007 동작 확인 ② 실행기 파드 재시작 이력 확인 ③ 회수된 실행을 사용자에게 통지 ④ **실패한 쓰기 작업을 자동 재시도하지 않는다** — GitHub 실제 상태를 먼저 확인한다 |
| RB-23 | 감사 기록 실패 | ① PostgreSQL 쓰기 상태 확인 ② 파티션 존재 확인 ③ 차단된 실행 목록을 보안 담당자에게 보고 ④ 감사 복구 전까지 쓰기 실행 차단 유지 |
| RB-24 | 비밀 유출 의심 | ① 해당 실행의 마스킹 경로 점검 ② 관련 GitHub 시크릿 회전 요청 ③ 로그·이력에서 노출 범위 산정 ④ 보안 담당자 에스컬레이션 |
| RB-25 | 운영 승인 필요 (CR-090) | ① A-006 「운영 승인」에서 상태를 본다 — 승인 없음·철회·「승인된 정의가 현재 정의와 다름」 중 무엇인가 ② 승인 자격이 없으면 사유 목록대로 조치한다(실행기 기동 검사 기록 없음·오래됨·드리프트·보고서 판·재현 불가 등) — 실행기가 서 있고 `/healthz`의 `registry.lastPassedAt`이 신선한지 본다 ③ 자격이 있으면 운영자가 미리보기(대상 정의·근거·게이트·열리는 기능)를 확인하고 사유와 함께 승인한다 ④ 승인 뒤 한 사용자·한 저장소로 `pr.list`를 확인한다(런북 7.C) ⑤ **승인을 우회하려고 DB를 직접 고치지 않는다** — 정책 표는 애플리케이션 롤로 쓸 수 없고, 소유자 계정의 직접 변경은 revision·이력·감사를 남기지 않는다 |
| RB-26 | 운영 정책 확인 불가 (CR-090) | ① search-api 로그 `운영 정책을 읽지 못했다`와 실행기 로그 `운영 정책을 읽지 못해 대기 요청을 집지 않는다`를 본다 ② 마이그레이션 030 적용 여부(`prsctl migrate` 상태)와 PostgreSQL 연결을 확인한다 ③ 그 동안 새 실행은 거절되고 대기 요청은 닫히지 않고 남는다 — 복구 뒤 잔여 스윕이 현재 정책으로 다시 판정한다 ④ 검색·수집·M 번호 경로는 영향을 받지 않는다 ⑤ **읽지 못한 것이 아니라 잠금을 얻지 못한 경우** — 실행기 로그 `운영 정책 잠금을 기다리다 시간이 지나 대기 요청을 집지 않았다`(`reason: policy_lock_timeout`)나 정책 변경 응답 503의 `detail.reason = policy_lock_timeout`이면 다른 정책 변경이 배타 잠금을 10초 넘게 쥔 것이다. `pg_locks`(`locktype = 'advisory'`)와 `pg_stat_activity`에서 오래 열린 트랜잭션을 찾는다. 지표 `policy_unavailable`은 두 원인을 합치므로 실행기 로그의 `reason`으로 가르고, search-api는 정책 변경의 잠금 대기 초과를 로그로 남기지 않는다(응답만) ⑥ 정책 변경이 500이고 PostgreSQL 로그에 `audit_record`의 파티션이 없다는 오류가 있으면, 적용 감사가 변경과 같은 트랜잭션이라 변경도 커밋되지 않은 것이다 — `RB-18` ②대로 파티션을 만든 뒤 다시 제출한다(search-api는 처리하지 않은 오류를 로그로 남기지 않는다) |
