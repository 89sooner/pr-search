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
  /** 커밋 메타데이터 보강 결과 (WP-067 / CR-038). `source`는 mirror|api다. */
  readonly commitEnrichTotal: Counter;
  /** 파생한 참조 간선 수 (JOB-REL-001, FR-REL-003). */
  readonly linkReferencesTotal: Counter;
  /** 파생한 관계 간선 수 (JOB-REL-002·003·004). `link_type`·`confidence` 라벨 (CR-041). */
  readonly linkRelationsTotal: Counter;
  /**
   * 순환이 감지되어 스택 간선을 만들지 않은 횟수 (FR-REL-006 AC-5, DEV-247).
   *
   * **0이 정상이며 양수는 조사 대상이다.** 지표가 없으면 스택 관계가 비어 있는 것이
   * 정상인지 순환 때문인지 운영자가 가를 수 없다.
   */
  readonly linkStackCycleTotal: Counter;
  /** patch-id를 못 얻은 사유별 수 (FR-REL-005 AC-5). 대다수가 blob_fetch_disabled인 것이 정상이다. */
  readonly patchIdUnavailableTotal: Counter;
  readonly sequenceIndexFailed: Counter;
  /** 릴리스 스냅숏 동기화 성공 회차 (JOB-REL-007). */
  readonly releaseRefreshed: Counter;
  /** 동기화 실패 회차 — 미러·정본 단계의 실패다. 색인 실패와 가른다. */
  readonly releaseRefreshFailed: Counter;
  /** 색인 반영 실패 회차 — 정본은 맞고 표시만 늦는 상태다. */
  readonly releaseIndexFailed: Counter;
  /** 실행한 재채번 수 (FR-SEQ-005, 관측 문서 RB-11 — 증가 자체가 P3 알림 대상이다). 라벨: `repository`. */
  readonly sequenceReassignTotal: Counter;
  /**
   * 정합성 점검이 발견한 불일치 공간 수 (JOB-SEQ-003, FR-ADMIN-003 AC-3).
   *
   * 라벨은 `repository`·`base_branch`다. **커밋 SHA·PR 번호는 라벨로 쓰지
   * 않는다** — 값의 종류가 사실상 무한해 시계열이 폭발한다.
   */
  readonly sequenceIntegrityMismatch: Counter;
  /**
   * 점검을 마치지 못한 횟수. 라벨: `reason`.
   *
   * **공간 상태를 바꾸지 않으므로 실패는 이 지표로만 보인다** (CR-033, DEV-171).
   * 점검이 조용히 실패하면 아무도 모르는 상태가 되는 것을 이 값이 막는다.
   */
  readonly sequenceIntegrityCheckFailed: Counter;
  /** 조정 스캔이 발견한 누락 수 (JOB-ING-005, FR-ING-011 AC-4). 라벨: `repository`·`kind`. */
  readonly reconcileMissing: Counter;
  /**
   * 조정 스캔이 연속으로 완주하지 못한 주기 수 (FR-ING-011 예외 처리).
   *
   * 3 이상이면 경보다. 한도 소진으로 미룬 것이 계속 쌓이면 그 저장소는 사실상
   * 조정되지 않고 있다 — 미룸 자체는 정상이고, **미룸이 반복되는 것**이 문제다.
   */
  readonly reconcileIncompleteCycles: Gauge;
  /** PG↔ES 불일치 수 (JOB-ING-008, ADR-004). 라벨: `index`·`kind`. */
  readonly projectionConsistencyMismatch: Counter;
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
  const commitEnrichTotal = new Counter('commit_enrich_total', '커밋 메타데이터 보강 결과');
  const linkReferencesTotal = new Counter('link_references_total', '파생한 참조 간선 수');
  const linkRelationsTotal = new Counter('link_relations_total', '파생한 관계 간선 수');
  const linkStackCycleTotal = new Counter('link_stack_cycle_total', '순환 감지로 만들지 않은 스택 간선 수');
  const patchIdUnavailableTotal = new Counter('patch_id_unavailable_total', 'patch-id를 얻지 못한 사유별 수');
  const sequenceIndexFailed = new Counter('sequence_index_failed_total', '시퀀스 색인 반영 실패 회차');
  const sequenceReassignTotal = new Counter('sequence_reassign_total', '실행한 시퀀스 재채번 수');
  const releaseRefreshed = new Counter('release_refreshed_total', '릴리스 스냅숏 동기화 성공 회차');
  const releaseRefreshFailed = new Counter('release_refresh_failed_total', '릴리스 스냅숏 동기화 실패 회차');
  const releaseIndexFailed = new Counter('release_index_failed_total', '릴리스 색인 반영 실패 회차');
  const sequenceIntegrityMismatch = new Counter(
    'sequence_integrity_mismatch_total',
    '정합성 점검이 발견한 불일치 공간 수',
  );
  const sequenceIntegrityCheckFailed = new Counter(
    'sequence_integrity_check_failed_total',
    '정합성 점검을 마치지 못한 횟수',
  );
  const reconcileMissing = new Counter('reconcile_missing_total', '조정 스캔이 발견한 누락 수');
  const reconcileIncompleteCycles = new Gauge(
    'reconcile_incomplete_cycles',
    '조정 스캔이 연속으로 완주하지 못한 주기 수',
  );
  const projectionConsistencyMismatch = new Counter(
    'projection_consistency_mismatch_total',
    'PostgreSQL↔Elasticsearch 불일치 수',
  );

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
    commitEnrichTotal,
    linkReferencesTotal,
    linkRelationsTotal,
    linkStackCycleTotal,
    patchIdUnavailableTotal,
    releaseRefreshed,
    releaseRefreshFailed,
    releaseIndexFailed,
    sequenceReassignTotal,
    sequenceIntegrityMismatch,
    sequenceIntegrityCheckFailed,
    reconcileMissing,
    reconcileIncompleteCycles,
    projectionConsistencyMismatch,
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
        commitEnrichTotal,
        linkReferencesTotal,
        linkRelationsTotal,
        linkStackCycleTotal,
        patchIdUnavailableTotal,
        releaseRefreshed,
        releaseRefreshFailed,
        projectionConsistencyMismatch,
        reconcileIncompleteCycles,
        reconcileMissing,
        releaseIndexFailed,
        sequenceIntegrityCheckFailed,
        sequenceIntegrityMismatch,
        sequenceReassignTotal,
        sequenceRewriteDetected,
        sequenceSpaceState,
        stageSeconds,
      ]),
  };
}
