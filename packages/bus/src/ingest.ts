/**
 * `EVT-ING-001` 재발행 (CR-012).
 *
 * 원본 `raw_event` 행을 수집 레인에 다시 넣는 자리가 둘이다 — 아웃박스
 * 재적재(JOB-ING-007)와 실패 대기열 재처리(JOB-ING-009). 두 곳이 봉투를 따로
 * 만들면 한쪽만 고쳐졌을 때 소비자가 조용히 갈린다. 게이트웨이의 최초 발행과
 * 같은 모양이어야 한다는 것이 이 함수의 전부다.
 *
 * 이 파일이 `@prs/bus`에 있는 이유는 봉투 타입(`EventEnvelope`)과 토픽이
 * 여기 있기 때문이다. payload 자체는 전송 수단을 모르는 순수 타입이라
 * `@prs/domain`이 만든다.
 */

import { EVENT_NAMES, ingestPartitionKey, toIngestionEvent, type RawEventSource } from '@prs/domain';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from './types.js';

/** 이 행이 떨어질 `prs:ingest` 파티션 키. */
export function ingestStreamKey(row: RawEventSource): string {
  return ingestPartitionKey(row.repository_id, row.delivery_id);
}

/**
 * 재발행 봉투.
 *
 * **새 `event_id`를 받는다.** 소비자의 멱등 기준은 `event_id`가 아니라 payload의
 * `delivery_id`다 (EVT-ING-001 Ordering/Dedupe). 같은 전달이 여러 번 흘러도
 * 중복 문서가 생기지 않는 것은 그 규칙 덕이다.
 */
export function ingestEnvelope(row: RawEventSource, eventId: string = randomUUID()): EventEnvelope {
  return {
    event_id: eventId,
    event_name: EVENT_NAMES.ingestionEventReceived,
    correlation_id: row.correlation_id,
    occurred_at: row.received_at.toISOString(),
    payload: toIngestionEvent(row),
  };
}
