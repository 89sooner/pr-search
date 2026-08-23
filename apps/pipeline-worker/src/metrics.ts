/**
 * 워커 지표 (WP-007: `enrich_pending_total`, `stage_latency_seconds`;
 * WP-008: `ingestion_lag_seconds`; WP-009: 실패 대기열 처리 건수).
 *
 * 지표 원시 타입은 `@prs/metrics`가 갖는다 (WP-010). 이 파일은 워커가 무엇을
 * 세는지만 정의한다.
 */

import { Counter, Gauge, Histogram, STAGE_BUCKETS, renderMetrics } from '@prs/metrics';

export { METRICS_CONTENT_TYPE, STAGE_BUCKETS } from '@prs/metrics';
export type { Labels } from '@prs/metrics';

export interface WorkerMetrics {
  /** 부분 결과로 진행한 보강 건수 (FR-ING-004 AC-3). */
  readonly enrichPending: Counter;
  /**
   * 웹훅 수신부터 색인 반영까지의 지연(초).
   *
   * 대기열에 머문 시간과 재시도로 늘어난 시간이 전부 들어간다. p95 10초 SLO가
   * 보는 값이 이쪽이다. 라벨을 두지 않는다 — 저장소별로 나누면 카디널리티가
   * 저장소 수만큼 늘어난다. 저장소별 지연은 API-ADM-006이 `raw_event`에서
   * 직접 계산한다 (CR-013, DEV-029).
   */
  readonly ingestionLagSeconds: Histogram;
  /** 실패 대기열로 보낸 건수. 라벨: `stage`, `reason`. */
  readonly deadLettered: Counter;
  /** 재처리가 끝까지 성공해 닫은 실패 대기열 건수. 라벨: `stage`. */
  readonly deadLetterResolved: Counter;
  /** 단계 처리 시간(초). 라벨: `stage`, `outcome`. */
  readonly stageSeconds: Histogram;
  /** 무효화한 사용자 수 (JOB-AUTH-001). 라벨: `reason`. */
  readonly permissionInvalidated: Counter;
  /** 무효화 실패 건수. 라벨: `reason`. 0이 아니면 회수가 최대 5분 늦는다. */
  readonly permissionInvalidationFailed: Counter;
  /**
   * 시퀀스 공간 상태 (WP-021, 관측 문서 RB-10). 라벨: `state`.
   *
   * `stale`이 1 이상이면 P2 경보다 — 그 공간의 시퀀스가 브랜치 현실을 더는
   * 반영하지 않는다는 뜻이고, 범위 조회가 옛 답을 준다.
   */
  readonly sequenceSpaceState: Gauge;
  /** 붙인 서수 개수 (JOB-SEQ-001). 라벨: `repository`. */
  readonly sequenceAssigned: Counter;
  /**
   * 감지한 히스토리 재작성 건수 (FR-SEQ-005, 관측 문서 RB-11).
   *
   * WP-021은 감지만 하고 재채번하지 않는다. 이 값이 오르는데 시퀀스가 그대로면
   * 그 공간은 **재채번을 기다리는 중**이다.
   */
  readonly sequenceRewriteDetected: Counter;
  /** 시퀀스를 색인에 반영하지 못한 회차 수. PostgreSQL 값은 살아 있다. */
  readonly sequenceIndexFailed: Counter;
  /** 실행한 재채번 수 (FR-SEQ-005, 관측 문서 RB-11 — 증가 자체가 P3 알림 대상이다). 라벨: `repository`. */
  readonly sequenceReassignTotal: Counter;
  render(): string;
}

export function createWorkerMetrics(): WorkerMetrics {
  const enrichPending = new Counter('enrich_pending_total', '부분 결과로 진행한 보강 건수');
  const ingestionLagSeconds = new Histogram(
    'ingestion_lag_seconds',
    '웹훅 수신부터 색인 반영까지 지연(초)',
    STAGE_BUCKETS,
  );
  const deadLettered = new Counter('worker_dead_lettered_total', '실패 대기열로 보낸 이벤트 건수');
  const deadLetterResolved = new Counter(
    'worker_dead_letter_resolved_total',
    '재처리 성공으로 닫은 실패 대기열 건수',
  );
  const stageSeconds = new Histogram('stage_latency_seconds', '파이프라인 단계 처리 시간(초)', STAGE_BUCKETS);
  const permissionInvalidated = new Counter('permission_invalidated_total', '권한 캐시를 무효화한 사용자 수');
  const permissionInvalidationFailed = new Counter(
    'permission_invalidation_failed_total',
    '권한 캐시 무효화 실패 건수',
  );
  const sequenceSpaceState = new Gauge('sequence_space_state', '시퀀스 공간 상태');
  const sequenceAssigned = new Counter('sequence_assigned_total', '붙인 머지 서수 개수');
  const sequenceRewriteDetected = new Counter('sequence_rewrite_detected_total', '감지한 히스토리 재작성 건수');
  const sequenceIndexFailed = new Counter('sequence_index_failed_total', '시퀀스 색인 반영 실패 회차');
  const sequenceReassignTotal = new Counter('sequence_reassign_total', '실행한 시퀀스 재채번 수');

  return {
    enrichPending,
    ingestionLagSeconds,
    deadLettered,
    deadLetterResolved,
    stageSeconds,
    permissionInvalidated,
    permissionInvalidationFailed,
    sequenceSpaceState,
    sequenceAssigned,
    sequenceRewriteDetected,
    sequenceIndexFailed,
    sequenceReassignTotal,
    render: (): string =>
      renderMetrics([
        enrichPending,
        ingestionLagSeconds,
        deadLettered,
        deadLetterResolved,
        permissionInvalidated,
        permissionInvalidationFailed,
        sequenceAssigned,
        sequenceIndexFailed,
        sequenceReassignTotal,
        sequenceRewriteDetected,
        sequenceSpaceState,
        stageSeconds,
      ]),
  };
}
