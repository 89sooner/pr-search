/**
 * 수신 응답 시간 부하 시험 (WP-004 DoD 6, FR-ING-001 AC-4, NFR-002).
 *
 * "저장까지 포함해 p95 300ms"를 재는 것이 목적이라 실제 HTTP와 실제 PostgreSQL을
 * 쓴다. 1000건을 GHE의 웹훅 유입 형태에 맞춰 어느 정도 동시에 밀어 넣는다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '@prs/db';
import { countRawEvents, migratedPool, postWebhook, startGateway, truncateRawEvents, type RunningGateway } from './helpers.js';

const REQUESTS = 1000;
const CONCURRENCY = 20;
/** NFR-002. 저장까지 포함한 값이다. */
const P95_BUDGET_MS = 300;

let pool: Pool;
let gateway: RunningGateway;

beforeAll(async () => {
  pool = await migratedPool();
  await truncateRawEvents(pool);
  gateway = await startGateway(pool);
});

afterAll(async () => {
  await gateway.stop();
  await truncateRawEvents(pool);
  await pool.end();
});

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

describe('DoD 6 — FR-ING-001 AC-4: 수신 응답 p95가 300ms 이하다', () => {
  it(`${String(REQUESTS)}건을 보내 p95를 잰다`, async () => {
    const durations: number[] = [];
    let accepted = 0;
    let next = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= REQUESTS) return;

        const body = JSON.stringify({
          action: 'closed',
          number: index,
          repository: { id: 4021, full_name: 'acme/payments' },
        });
        const started = process.hrtime.bigint();
        const response = await postWebhook(gateway.baseUrl, {
          body,
          eventType: 'pull_request',
          deliveryId: `load-${String(index)}`,
        });
        await response.arrayBuffer();
        durations.push(Number(process.hrtime.bigint() - started) / 1e6);
        if (response.status === 202) accepted += 1;
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const sorted = [...durations].sort((left, right) => left - right);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    process.stdout.write(
      `수신 응답 지연: p50 ${p50.toFixed(1)}ms / p95 ${p95.toFixed(1)}ms / p99 ${p99.toFixed(1)}ms ` +
        `(요청 ${String(REQUESTS)}건, 동시 ${String(CONCURRENCY)})\n`,
    );

    expect(accepted).toBe(REQUESTS);
    // 유실 없음: 보낸 만큼 그대로 남는다.
    expect(await countRawEvents(pool)).toBe(REQUESTS);
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });
});
