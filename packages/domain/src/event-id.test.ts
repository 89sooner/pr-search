import { describe, expect, it } from 'vitest';
import { EVENT_NAMES } from './events.js';
import { deterministicEventId } from './event-id.js';

describe('deterministicEventId', () => {
  it('같은 입력은 같은 ID를 준다 — 재시도를 추적할 수 있다', () => {
    const first = deterministicEventId(EVENT_NAMES.ingestionEnriched, 'delivery-1');
    const second = deterministicEventId(EVENT_NAMES.ingestionEnriched, 'delivery-1');
    expect(first).toBe(second);
  });

  it('전달 식별자가 다르면 ID도 다르다', () => {
    expect(deterministicEventId(EVENT_NAMES.ingestionEnriched, 'delivery-1')).not.toBe(
      deterministicEventId(EVENT_NAMES.ingestionEnriched, 'delivery-2'),
    );
  });

  it('이벤트 이름이 다르면 ID도 다르다 — 같은 전달의 서로 다른 단계가 겹치지 않는다', () => {
    expect(deterministicEventId(EVENT_NAMES.ingestionEnriched, 'delivery-1')).not.toBe(
      deterministicEventId(EVENT_NAMES.ingestionProjected, 'delivery-1'),
    );
  });

  it('구성 요소 경계가 고정되어 이어 붙임이 모호해지지 않는다', () => {
    expect(deterministicEventId('e', 'ab', 'c')).not.toBe(deterministicEventId('e', 'a', 'bc'));
  });

  it('UUIDv8 형식이다 — SHA-256을 쓰면서 v5라고 적지 않는다', () => {
    const id = deterministicEventId(EVENT_NAMES.ingestionEnriched, 'delivery-1');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
