/**
 * 수신 지표 (WP-004, QA-A001-01).
 *
 * 지표 원시 타입은 `@prs/metrics`가 갖는다 (WP-010). 이 파일은 게이트웨이가
 * 무엇을 세는지만 정의한다.
 */

import { Counter, Histogram, RESPONSE_BUCKETS, renderMetrics } from '@prs/metrics';

export { METRICS_CONTENT_TYPE, RESPONSE_BUCKETS } from '@prs/metrics';
export type { Labels } from '@prs/metrics';

export interface IngestMetrics {
  /** 수신 건수. 라벨: `event_type`, `supported` (FR-ADMIN-001). */
  readonly received: Counter;
  /** 거부 건수. 라벨: `reason`. 5분간 10건 초과 시 경보 (FR-ING-001 AC-2, NFR-005). */
  readonly rejected: Counter;
  /** 중복 전달 건수 (FR-ING-002 AC-3). */
  readonly duplicate: Counter;
  /** 수신 응답 시간 히스토그램. p95 300ms (NFR-002). */
  readonly responseSeconds: Histogram;
  /** 아카이브 append 실패 건수. 레인 B 장애가 조용히 묻히지 않게 한다. */
  readonly archiveFailed: Counter;
  /** 큐 enqueue 실패 건수. 아웃박스 재적재(JOB-ING-007)가 얼마나 일하는지의 선행 지표다. */
  readonly enqueueFailed: Counter;
  render(): string;
}

export function createIngestMetrics(): IngestMetrics {
  const received = new Counter('ingest_received_total', '웹훅 수신 건수');
  const rejected = new Counter('ingest_rejected_total', '서명 검증 실패 등 거부 건수');
  const duplicate = new Counter('ingest_duplicate_total', '중복 전달 건수');
  const responseSeconds = new Histogram('ingest_response_seconds', '수신 응답 시간(초)', RESPONSE_BUCKETS);
  const archiveFailed = new Counter('ingest_archive_failed_total', 'NDJSON 아카이브 append 실패 건수');
  const enqueueFailed = new Counter('ingest_enqueue_failed_total', '큐 enqueue 실패 건수');

  return {
    received,
    rejected,
    duplicate,
    responseSeconds,
    archiveFailed,
    enqueueFailed,
    render: (): string =>
      renderMetrics([received, rejected, duplicate, archiveFailed, enqueueFailed, responseSeconds]),
  };
}
