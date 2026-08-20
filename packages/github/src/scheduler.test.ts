/** 실시간 우선 배분 (WP-006 DoD 4, 백엔드 아키텍처 4.2). */

import { describe, expect, it } from 'vitest';
import { RequestScheduler } from './scheduler.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('DoD 4: 실시간 요청이 백필보다 먼저 슬롯을 받는다', () => {
  it('백필이 먼저 줄을 섰어도 실시간이 앞선다', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 1 });
    const order: string[] = [];
    const blocker = deferred();

    // 슬롯 하나를 잡아 둔다. 뒤에 오는 것들은 전부 큐에 쌓인다.
    const held = scheduler.run('realtime', async () => {
      order.push('held');
      await blocker.promise;
    });
    await new Promise((r) => setTimeout(r, 5));

    const backfillFirst = scheduler.run('backfill', async () => {
      order.push('backfill-1');
    });
    const backfillSecond = scheduler.run('backfill', async () => {
      order.push('backfill-2');
    });
    await new Promise((r) => setTimeout(r, 5));
    const realtimeLate = scheduler.run('realtime', async () => {
      order.push('realtime-late');
    });

    blocker.resolve();
    await Promise.all([held, backfillFirst, backfillSecond, realtimeLate]);

    // 백필 둘이 먼저 줄을 섰지만, 나중에 온 실시간이 그 앞으로 간다.
    expect(order).toEqual(['held', 'realtime-late', 'backfill-1', 'backfill-2']);
  });

  it('같은 우선순위 안에서는 먼저 온 것이 먼저다', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 1 });
    const order: number[] = [];
    const blocker = deferred();
    const held = scheduler.run('realtime', async () => {
      await blocker.promise;
    });
    await new Promise((r) => setTimeout(r, 5));

    const queued = [0, 1, 2, 3].map(async (index) =>
      scheduler.run('backfill', async () => {
        order.push(index);
      }),
    );
    blocker.resolve();
    await Promise.all([held, ...queued]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('동시 실행 상한을 넘지 않는다', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 3 });
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, async () =>
        scheduler.run('realtime', async () => {
          peak = Math.max(peak, scheduler.inFlight);
          await new Promise((r) => setTimeout(r, 2));
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(scheduler.inFlight).toBe(0);
  });

  it('작업이 던져도 슬롯을 돌려준다', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 1 });
    await expect(
      scheduler.run('realtime', async () => {
        throw new Error('실패');
      }),
    ).rejects.toThrow('실패');
    expect(scheduler.inFlight).toBe(0);
    await expect(scheduler.run('realtime', async () => 'ok')).resolves.toBe('ok');
  });
});
