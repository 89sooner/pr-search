# WP-074 사내 지연 측정 가이드 및 도구 계약

> 상태: review | 버전: v0.1 | 갱신일: 2026-09-11

## 1. 현재 사용 가능 여부

이 문서는 설계 산출물이다. 아래 `measure:sequence-latency` CLI와 `sequence_latency_sample` 표는 **아직 구현되지 않았다.** WP-074 후속 구현자가 이 계약대로 도구·fixture test·번들 포함을 완료한 뒤 사내 사용자가 실행한다. pilot.4/024에서 가능한 제한된 기준 측정과 WP-074 추가 계측을 구분한다. 사내 측정 결과는 아직 없으며 로컬 fixture 결과는 운영 보장이 아니다.

도구 구현 경로는 `scripts/measure-sequence-latency.mjs`(Node 22), root package script는 `measure:sequence-latency`로 정한다. bundle에는 소스만 넣고 pnpm install을 요구하지 말고 db 패키지 runtime와 함께 실행 가능한 CLI 경로를 포함해야 한다. 실제 번들에서 실행되는 명령을 검증 후 RUNBOOK에 기입한다. 권한은 읽기 전용이고 GHE 쓰기 App을 요구하지 않는다.

## 2. 024에서 얻을 수 있는 기준값

현재 `merge_sequence`에는 committed_at/assigned_at이 있다. 아래 SQL은 기존 데이터에 대해 읽기 전용으로 실행 가능하다. **커밋 작성→채번 간격**이며 웹훅 수신 지연이라고 명명하지 않는다. 아래 7일 창은 보조 관측 예이며 운영 전체 보증이 아니다.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT count(*) AS samples,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY assigned_at - committed_at) AS p50,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY assigned_at - committed_at) AS p95,
       percentile_disc(0.99) WITHIN GROUP (ORDER BY assigned_at - committed_at) AS p99,
       max(assigned_at - committed_at) AS maximum,
       count(*) FILTER (WHERE assigned_at < committed_at) AS negative_count
FROM merge_sequence
WHERE assigned_at >= now() - interval '7 days';
ROLLBACK;
```

raw_event.received_at은 존재하지만 현재 데이터만으로 모든 채번 행의 원인 push를 1:1 매핑하거나 mirror 완료·M 부여·검색 가시성 시각을 복원할 수 없다. 기존 로그에 repo와 상관 ID 및 완료시각이 모두 있는 개별 사례는 별도 evidence로 조사할 수 있으나 누락 시 `unavailable`다. 024 baseline 모드는 없는 열/표를 조회해 죽지 않고 `to_regclass`·information_schema의 read-only capability 검사로 가용 구간만 반환한다. 원본 payload 본문을 출력하지 않는다.

`6시간 스윕`은 코드의 보정 주기이지 운영 실측 지연 상한이 아니다. 다음 push가 없거나 후속 단계가 멈췄으면 그보다 길 수 있다. 보고서에 “최대 6시간 보장”을 쓰지 않는다.

## 3. 025 이후 측정 정의

| 구간 이름 | 시작 / 종료 | 가용성·제외 사유 |
| --- | --- | --- |
| received_to_mirror | 원인 push raw received_at → freshness mirror_completed_at | API mode는 not_applicable; 이를 mirror 0ms로 표시하지 않음 |
| received_to_sequence | 같은 received_at → 해당 PR merge_seq 최초 assigned_at | 원인 push 매핑 없으면 unavailable |
| received_to_mnumber | 같은 received_at → mnumber_assigned_at | 미확정은 pending, 임의 종료 시각 없음 |
| mnumber_to_search_observed | mnumber_assigned_at → 같은 repo/branch/epoch/PR/M이 실제 검색에서 보인 최초 관측 | ES ACK나 DB read만으로 통과 불가 |
| received_to_search_observed | received_at → search_observed_at | NFR-002와 비교할 end-to-end 관측값 |
| pending_age | blocker 최초 first_pending_at → 관측시각 | 현재 epoch만 집계, 과거 epoch와 합산 금지 |

각 단계는 동일 sample_id/epoch 기준이다. 재시도 attempt와 최초 수신시각을 혼동하지 않는다. source가 섞인 항목은 신규 squash cohort에 넣지 않고 `unattributed`로 따로 센다. `assigned_at - committed_at` 보조 통계는 별도 열에 둔다. 종료시각이 없으면 latency NULL이고 percentile 유효 표본에서 제외하되 missing/pending으로 반드시 집계한다.

NFR-002의 시작은 수신, 끝은 검색에 나타남이다(p95≤10초/p99≤60초). stage별 독립 SLA를 만들지 않는다. 새 squash **전체 요청 수와 완료 비율**을 함께 출력해 pending을 빼고 p95만 좋은 것처럼 보고하지 않는다. 기준선 없는 024→025 mirror/M 구간은 개선율을 계산하지 않고 새 관측으로 표시한다.

## 4. CLI 인터페이스

후속 구현의 고정 사용법:

```bash
pnpm run measure:sequence-latency -- baseline --window 7d --format json
pnpm run measure:sequence-latency -- report --window 24h --cohort new_squash --format json
pnpm run measure:sequence-latency -- report --window 24h --cohort all --format table
pnpm run measure:sequence-latency -- watch --repository acme/smp1900 --base-branch main --pr-number 21 --timeout 120s --poll 2s --format json
```

이는 **구현 예정 명령**이다. 개발환경에서 pnpm을 쓰는 예이며 offline bundle의 실제 런타임 명령은 구현 검증 후 같은 인자 규약으로 제공한다.

`baseline`: 024 또는 025를 read-only 검사하고 제공 가능한 보조 구간만 출력. `report`: 025 필요; window 기본 24h, 최대 30d, cohort=new_squash/backfill/retry/reassign/reconcile/all. 기본 table, JSON은 schema_version=1. `watch`: 인증된 기존 검색 API를 polling하며 해당 PR의 epoch를 최초 성공 read 때 고정한다. epoch가 이동하면 `epoch_changed`로 종료하고 자동 새 epoch 재조회 금지. API filter는 repo/PR로 한정하고 최대 100개 응답을 순회하며 넘치면 `partial_lookup`로 보고한다. no refresh API, no `_refresh`, no UPDATE.

환경 입력: `MEASURE_DATABASE_URL`(읽기 전용 DB DSN), `MEASURE_API_BASE_URL`(필요 시), `MEASURE_SESSION_FILE`(기존 인증 세션 credential 파일, chmod 600)만 받는다. 비밀은 argv에 두지 않는다. DSN/세션 파일 내용/HTTP headers를 출력하지 않는다. 인증 실패는 401로 종료하며 익명 fallback 금지. 세션 파일은 단일 cookie header 문자열을 담고 newline/control character가 있으면 거절; origin 외 redirect를 따라가지 않는다. 사내 운영자는 기존 정상 로그인으로 얻은 읽기 세션을 사용하며 이 도구는 신규 login/쓰기 토큰을 발급하지 않는다.

입력 숫자는 엄격한 범위 검사, SQL은 바인딩 parameter만 사용. `--window`는 양수 정수+단위 h/d, `--timeout` 1..600s, `--poll` 1..30s. window/timezone는 UTC start/end로 결과에 포함. 잘못된 인자는 2; 정상 완전 측정은 0; 조회 실패/권한 실패는 1; 자료 부족/timeout/부분/clock anomaly/epoch 이동은 3. exit 3은 서비스 실패를 단정하지 않으며 reason을 읽는다. output 생성만 하고 운영 DB나 로컬 session 파일을 수정하지 않는다.

ES 관측 판정: 검색 API가 DB의 최신 M을 보완할 수 있으므로 `merge_number_state=assigned`만으로 검색 색인 반영을 판정하지 않는다. `merge_number_projection_state=in_sync`(실제 ES 검색 hit와 정본 일치)까지 확인한다. 이 필드가 없는 024 API는 측정 불가다. 코드가 DB 값만 보고 in_sync를 만드는 변이를 T06c가 잡아야 한다. 일반 화면에서 번호가 보이기 시작한 시각과 ES 수렴 시각이 다를 수 있음을 결과에 표시한다.

## 5. 권한·SQL·자원 경계

report/baseline은 `BEGIN READ ONLY`, statement_timeout=10s, lock_timeout=1s, application_name=prs-sequence-measure를 설정한다. `default_transaction_read_only`에만 기대지 않고 모든 transaction을 read-only로 연다. raw_event는 payload 제외 view 또는 received_at·delivery_id·repository_id의 열 권한만 필요하다. 새 표는 sequence_latency_sample과 M 상태의 한정 view SELECT만 요구하며 operator용 DB 계정 provisioning은 배포 관리자가 기존 절차로 수행한다.

표준 report는 DB에서 percentile_disc로 집계한다. 유효 양수/0 latency에 대해 p50/p95/p99/max를 milliseconds로 산출하고 sample_count를 명시한다. 음수는 `clock_anomaly_count`로 별도 집계하며 실제 음수 최소값도 기록한다. 0으로 clamp하지 않는다. 유효 표본이 0이면 percentile은 null. negative를 제외한 분모임을 `valid_samples`로 명시한다. missing은 이유별 집계하며 DB 집계 timeout을 빈 결과로 바꾸지 않는다.

조회 window는 indexed 시각으로 제한한다. pending은 현재 epoch의 checkpoint 다음 unresolved와 후속 PR 수를 나누어 보고한다. `pending_items`는 미확정 commit 수, `pending_prs`는 이미 아는 PR 중 번호 대기 수라 합이 같을 필요 없다. oldest는 first_pending_at 기준이며 과거 commit 작성시각을 기다림 시작으로 쓰지 않는다. pending이 없어도 자료 누락이면 “0 pending 확정”이라고 쓰지 않는다.

watch의 poll 관측은 실제 반영 시점보다 늦을 수 있다. poll interval과 마지막 부재 관측/첫 존재 관측을 함께 적어 `(last_absent,first_present]` 구간을 보여준다. report에 저장되는 자동 observer도 이 규칙을 따른다. 수집한 과거 파일을 watch가 DB에 다시 넣지 않는다. 측정 샘플 저장은 worker의 계측 책임이며 도구는 읽기 전용이다.

## 6. 비식별 JSON 예제

다음은 설명용 값이며 실측 결과가 아니다. 공간은 sha256 기반 로컬 label로 치환하고 내부 hostname/owner/PR 제목/본문/token/원본 payload를 포함하지 않는다. 실제 PR 번호/commit SHA도 public 공유 출력에서는 기본 제외한다. 내부 detailed 모드도 secret은 출력하지 않는다.

```json
{
  "schema_version": 1,
  "illustrative": true,
  "mode": "report",
  "release": "candidate-version",
  "schema": 25,
  "cohort": "new_squash",
  "space": "space-6e91",
  "window": {"from": "2026-09-11T00:00:00Z", "to": "2026-09-12T00:00:00Z"},
  "requests": 12,
  "stages": [{
    "name": "received_to_mnumber",
    "unit": "ms",
    "valid_samples": 8,
    "p50": 2100, "p95": 5200, "p99": 5200, "max": 5200,
    "missing": 1, "failed": 1, "pending": 1, "clock_anomaly_count": 1,
    "clock_anomaly_min_ms": -35
  }],
  "pending": {"items": 1, "known_prs": 2, "oldest_ms": 120000,
    "reasons": {"negative_evidence_unavailable": 1}},
  "coverage": {"observation_available": true, "poll_interval_ms": 2000},
  "comparison": {"target_p95_ms": 10000, "target_p99_ms": 60000, "production_verified": false}
}
```

각 stage의 request 분모와 valid/missing/failed/pending/clock anomaly 분류는 서로 배타적으로 만든다. 같은 요청의 재시도 attempt를 여러 요청으로 늘리지 않는다. all cohort 출력은 cohort별 행을 유지하며 전체 평균으로 서로 다른 모집단을 합치지 않는다. p95 숫자만 비교하지 말고 release commit·schema·workload·window·완료율·clock 이상·poll 주기를 함께 비교한다.

## 7. 사내 실행 순서와 해석

1. 현재 release/manifest/DB migration 버전을 확인한다. pilot.4에서는 baseline만 가능하며 M 표가 없다는 출력이 정상이다.
2. WP-074 후보 반입과 필수 구성 검증·load·사내 CA 복원·upgrade 절차를 기존 RUNBOOK대로 수행한다. 이 가이드는 업그레이드 자체를 자동 실행하지 않는다.
3. 정상 로그인·조회 세션과 read-only DB 계정을 준비한다. 도구의 `--help`와 secret 없는 capability 출력을 확인한다.
4. 이미 승인된 소규모 시험 저장소에서 사용자가 평소 절차로 squash PR 하나를 머지한다. 도구는 PR 생성/머지를 수행하지 않는다.
5. watch로 그 PR을 관측하고 report로 cohort 전체를 확인한다. blocker가 있으면 저장소 운영자에게 사유와 비식별 report를 전달한다. direct 판정의 근거가 부족한 경우 재실행을 반복해도 확정되지 않을 수 있다.
6. M이 보이지 않으면 raw 수신 여부 → refresh intent → fetch 결과 → merge_seq → 증거/blocker → M row → materialize work → ES 검색 가시성 → API/UI를 순서대로 확인한다. API-only mode에서 mirror 지연이 unavailable인 것은 오류가 아니다.
7. 제출은 내부 값 제거 후 `release/commit/schema/cohort/window/counts/percentiles/pending reasons`만 한다. 사내 결과가 도착한 뒤 원장에 별도 검증 기록을 남긴다.

## 8. 구현자가 제출할 도구 검증

golden fixture에 empty/024/missing table/partial/negative/duplicate/retry/epoch changed/unauthorized 케이스를 둔다. `[100,200,300,400]`의 percentile_disc p50=200,p95=400,p99=400,max=400을 독립 상수로 검증한다. 전체 sample 분류 합계도 검증한다. read-only PostgreSQL 계정으로 성공하고 UPDATE 시도는 test proxy에서 0이어야 한다. secret marker를 credential·raw payload fixture에 심어 stdout/stderr/JSON 어디에도 없는지 확인한다. 실제 offline bundle에서 pnpm 설치 없이 CLI help 및 격리 report/watch를 실행한 결과가 있어야 도구 완료다.
