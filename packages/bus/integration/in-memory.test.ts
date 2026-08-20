/**
 * 인메모리 어댑터의 계약 준수.
 *
 * Redis 어댑터와 **같은 파일**을 돌린다. 두 어댑터가 같은 스위트를 통과해야
 * 그 스위트가 특정 구현에 맞춰 쓰인 것이 아님이 증명된다 (ADR-002).
 */

import { InMemoryEventBus } from '@prs/bus';
import { runEventBusContract, type BusFixture } from './contract.js';
import { TEST_PARTITION_OVERRIDES } from './helpers.js';

runEventBusContract('InMemoryEventBus', async (): Promise<BusFixture> => {
  const bus = new InMemoryEventBus(TEST_PARTITION_OVERRIDES);
  return {
    bus,
    reset: async (): Promise<void> => {
      /* 매 테스트가 새 인스턴스를 받으므로 지울 것이 없다 */
    },
    dispose: async (): Promise<void> => {
      await bus.close();
    },
  };
});
