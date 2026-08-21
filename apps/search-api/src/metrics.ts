/**
 * search-api 지표 (WP-009: `dead_letter_total{state}`).
 *
 * 지표 원시 타입은 `@prs/metrics`가 갖는다 (WP-010).
 *
 * 실패 대기열 건수는 카운터가 아니라 **게이지**다. 프로세스가 누적하는 값이
 * 아니라 그 순간 표의 상태이므로, 스크레이프 때 읽어 `replace`한다.
 */

export { Counter, Gauge, Histogram, METRICS_CONTENT_TYPE, renderMetrics } from '@prs/metrics';
export type { Labels, Metric } from '@prs/metrics';
