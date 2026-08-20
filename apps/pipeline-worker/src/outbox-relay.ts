/**
 * JOB-ING-007 아웃박스 재적재 (ADR-002 follow-up).
 *
 * **이 잡이 없으면 Redis가 잠깐만 내려가도 그 사이 이벤트가 영영 처리되지
 * 않는다.** 게이트웨이는 발행에 실패해도 202를 돌려준다 — 저장은 이미 끝났고
 * GHE에 재전송을 시켜 봐야 멱등 규칙에 걸려 중복으로 떨어질 뿐이기 때문이다.
 * 그래서 "저장은 됐는데 처리되지 않은" 행을 주기적으로 찾아 다시 발행한다.
 *
 * 판정 기준은 비동기 문서 3장 그대로다 — `queued_at`이 있고 `processed_at`이
 * 없으며 `queued_at`이 10분 넘게 지난 행. `queued_at`은 게이트웨이가 INSERT
 * 시점에 채우므로, 발행이 아예 안 된 행도 여기 걸린다.
 */

import { rawEventRepo, type Pool } from '@prs/db';
import { ingestEnvelope, ingestStreamKey, TOPICS, type EventBus } from '@prs/bus';

/** 비동기 문서 3장: 스케줄 5분, 대상은 10분 경과 행. */
export const RELAY_INTERVAL_MS = 5 * 60 * 1_000;
export const RELAY_STALE_AFTER_MS = 10 * 60 * 1_000;
const RELAY_BATCH_SIZE = 100;

export interface OutboxRelayOptions {
  /** 이만큼 지난 행을 대상으로 삼는다. */
  readonly staleAfterMs?: number;
  readonly batchSize?: number;
  readonly now?: () => Date;
  readonly log?: (entry: RelayLogEntry) => void;
}

export interface RelayLogEntry {
  readonly level: 'info' | 'error';
  readonly message: string;
  readonly delivery_id?: string;
  readonly correlation_id?: string;
  readonly reason?: string;
}

export interface RelayResult {
  /** 대상으로 잡힌 행 수. */
  readonly found: number;
  /** 다시 발행에 성공한 행 수. */
  readonly relayed: number;
  /** 발행에 실패해 다음 회차로 미룬 행 수. */
  readonly failed: number;
}

/**
 * 한 회차를 실행한다.
 *
 * 발행에 성공한 행만 `queued_at`을 지금으로 다시 찍는다. 실패한 행은 그대로
 * 두어야 다음 회차에서 다시 잡힌다 — 여기서 타이머를 재설정해 버리면 실패한
 * 행이 10분 더 방치된다.
 */
export async function relayOutboxOnce(
  pool: Pool,
  bus: EventBus,
  options: OutboxRelayOptions = {},
): Promise<RelayResult> {
  const now = options.now ?? ((): Date => new Date());
  const staleAfterMs = options.staleAfterMs ?? RELAY_STALE_AFTER_MS;
  const log = options.log ?? ((): void => undefined);

  const threshold = new Date(now().getTime() - staleAfterMs);
  const rows = await rawEventRepo.findStuckOutboxEvents(
    pool,
    threshold,
    options.batchSize ?? RELAY_BATCH_SIZE,
  );

  let relayed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await bus.publish(TOPICS.ingest, ingestStreamKey(row), ingestEnvelope(row));
      await rawEventRepo.markQueued(pool, row.delivery_id, row.received_at, now());
      relayed += 1;
      log({
        level: 'info',
        message: 'outbox relayed',
        delivery_id: row.delivery_id,
        correlation_id: row.correlation_id,
      });
    } catch (error) {
      failed += 1;
      log({
        level: 'error',
        message: 'outbox relay failed',
        delivery_id: row.delivery_id,
        correlation_id: row.correlation_id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  return { found: rows.length, relayed, failed };
}

export interface OutboxRelay {
  stop(): Promise<void>;
}

/** 5분 주기로 회차를 돈다. 회차가 겹치지 않도록 이전 회차가 끝난 뒤에 잡는다. */
export function startOutboxRelay(
  pool: Pool,
  bus: EventBus,
  options: OutboxRelayOptions & { readonly intervalMs?: number } = {},
): OutboxRelay {
  const intervalMs = options.intervalMs ?? RELAY_INTERVAL_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = relayOutboxOnce(pool, bus, options)
        .catch((error: unknown) => {
          (options.log ?? ((): void => undefined))({
            level: 'error',
            message: 'outbox relay round failed',
            reason: error instanceof Error ? error.name : 'unknown',
          });
        })
        .finally(schedule);
    }, intervalMs);
    timer.unref();
  };
  schedule();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
    },
  };
}
