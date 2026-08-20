/**
 * 이벤트 카탈로그의 이름과 payload 모양 (비동기 문서 4장).
 *
 * 전송 수단을 모르는 순수 타입이라 `@prs/domain`에 둔다. 게이트웨이(발행)와
 * 아웃박스 재적재 잡(재발행)이 같은 정의를 써야 소비자가 둘을 구분하지 않고
 * 처리할 수 있다.
 */

export const EVENT_NAMES = {
  /** EVT-ING-001 */
  ingestionEventReceived: 'ingestion.event_received',
  /** EVT-ING-002 */
  ingestionEnriched: 'ingestion.enriched',
  /** EVT-ING-003 */
  ingestionProjected: 'ingestion.projected',
  /** EVT-ING-004 */
  ingestionFailed: 'ingestion.failed',
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/** EVT-ING-001 `ingestion.event_received`. */
export interface IngestionEventReceived {
  readonly delivery_id: string;
  readonly event_type: string;
  readonly action: string | null;
  readonly repository_id: number | null;
  readonly correlation_id: string;
  readonly occurred_at: string;
}

/**
 * 수집 레인의 파티션 키 (비동기 문서 2장: `prs:ingest` → `repository_id`).
 *
 * 저장소를 알 수 없는 이벤트(조직 단위 `team` 등)는 전달 식별자를 쓴다. 그런
 * 이벤트에는 저장소별 순서라는 개념 자체가 없으므로 아무 파티션에 흩어져도
 * 되지만, 재전송이 같은 파티션에 떨어져야 중복 처리가 한 소비자에서 걸린다.
 */
export function ingestPartitionKey(repositoryId: number | null, deliveryId: string): string {
  return repositoryId === null ? deliveryId : String(repositoryId);
}
