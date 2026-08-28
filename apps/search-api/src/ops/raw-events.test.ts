/**
 * API-ADM-008 조회 조건과 커서 (WP-036 / FR-ING-010, CR-052).
 *
 * 여기는 순수 판정만 본다. 접근 범위가 실제로 걸리는지, `payload`가 실제로
 * 빠지는지는 **실 Elasticsearch로** 재야 한다 — 대역이 실제보다 관대하면
 * 그만큼이 사각지대다. 그 몫은 `integration/ops/raw-events.test.ts`에 있다.
 */

import { describe, expect, it } from 'vitest';
import { createCursorSigner } from '../cursor/envelope.js';
import { AdminRejected } from './errors.js';
import {
  DEFAULT_RAW_EVENT_LIMIT,
  MAX_RAW_EVENT_LIMIT,
  computeRawEventFingerprint,
  decodeRawEventCursor,
  encodeRawEventCursor,
  parseIncludePayload,
  parseRawEventFilter,
  parseRawEventLimit,
  parseReceivedAt,
} from './raw-events.js';

const SIGNER = createCursorSigner('raw-events-test-key-that-is-long-enough');
const NOW = Date.parse('2026-08-28T12:00:00.000Z');

describe('조회 조건 파싱', () => {
  it('빈 질의는 기본값을 준다', () => {
    const filter = parseRawEventFilter({});
    expect(filter.limit).toBe(DEFAULT_RAW_EVENT_LIMIT);
    expect(filter.includePayload).toBe(false);
    expect(filter.deliveryId).toBeUndefined();
  });

  it('limit 상한을 넘기면 거절한다', () => {
    expect(() => parseRawEventLimit(String(MAX_RAW_EVENT_LIMIT + 1))).toThrow(AdminRejected);
    expect(parseRawEventLimit(String(MAX_RAW_EVENT_LIMIT))).toBe(MAX_RAW_EVENT_LIMIT);
  });

  it('include_payload는 세 상태를 구분한다 — 알 수 없는 값을 false로 접지 않는다', () => {
    expect(parseIncludePayload(undefined)).toBe(false);
    expect(parseIncludePayload('true')).toBe(true);
    expect(parseIncludePayload('false')).toBe(false);
    // 형식 오류를 기본값으로 접는 것이 DEV-363이 남긴 실패다.
    expect(() => parseIncludePayload('1')).toThrow(AdminRejected);
    expect(() => parseIncludePayload('')).toThrow(AdminRejected);
  });

  it('시각은 ISO 8601만 받는다', () => {
    expect(parseReceivedAt('2026-08-28T00:00:00.000Z', 'received_from')).toBe(
      '2026-08-28T00:00:00.000Z',
    );
    expect(parseReceivedAt(undefined, 'received_from')).toBeUndefined();
    expect(() => parseReceivedAt('어제', 'received_from')).toThrow(AdminRejected);
  });
});

describe('커서 지문', () => {
  it('접근 범위가 다르면 지문이 다르다', () => {
    const filter = parseRawEventFilter({});
    expect(computeRawEventFingerprint(filter, [1, 2])).not.toBe(
      computeRawEventFingerprint(filter, [1, 2, 3]),
    );
  });

  it('접근 범위의 순서는 지문을 바꾸지 않는다', () => {
    const filter = parseRawEventFilter({});
    expect(computeRawEventFingerprint(filter, [2, 1])).toBe(
      computeRawEventFingerprint(filter, [1, 2]),
    );
  });

  it('include_payload가 지문에 들어간다 — 순회 중 노출 범위가 조용히 바뀌지 않는다', () => {
    const closed = parseRawEventFilter({});
    const open = parseRawEventFilter({ include_payload: 'true' });
    expect(computeRawEventFingerprint(closed, [1])).not.toBe(
      computeRawEventFingerprint(open, [1]),
    );
  });

  it('조건이 같으면 지문이 같다', () => {
    const a = parseRawEventFilter({ repository: 'seg/payments', limit: '10' });
    const b = parseRawEventFilter({ repository: 'seg/payments', limit: '10' });
    expect(computeRawEventFingerprint(a, [1])).toBe(computeRawEventFingerprint(b, [1]));
  });
});

describe('커서 왕복', () => {
  it('같은 지문이면 정렬 위치를 되돌려 준다', () => {
    const fingerprint = computeRawEventFingerprint(parseRawEventFilter({}), [1]);
    const cursor = encodeRawEventCursor([1756382400000, 'd-9'], fingerprint, SIGNER, NOW);
    expect(decodeRawEventCursor(cursor, fingerprint, SIGNER, NOW)).toEqual([1756382400000, 'd-9']);
  });

  it('지문이 다르면 CURSOR_QUERY_MISMATCH다', () => {
    const closed = computeRawEventFingerprint(parseRawEventFilter({}), [1]);
    const open = computeRawEventFingerprint(parseRawEventFilter({ include_payload: 'true' }), [1]);
    const cursor = encodeRawEventCursor([1, 'd-1'], closed, SIGNER, NOW);
    expect(() => decodeRawEventCursor(cursor, open, SIGNER, NOW)).toThrow(
      /조회 조건이 커서와 다르다/,
    );
  });

  it('접근 범위가 줄면 옛 커서를 거절한다 — 권한 축소가 순회로 우회되지 않는다', () => {
    const wide = computeRawEventFingerprint(parseRawEventFilter({}), [1, 2, 3]);
    const narrow = computeRawEventFingerprint(parseRawEventFilter({}), [1]);
    const cursor = encodeRawEventCursor([1, 'd-1'], wide, SIGNER, NOW);
    expect(() => decodeRawEventCursor(cursor, narrow, SIGNER, NOW)).toThrow(AdminRejected);
  });

  it('훼손된 커서는 CURSOR_INVALID다', () => {
    const fingerprint = computeRawEventFingerprint(parseRawEventFilter({}), [1]);
    expect(() => decodeRawEventCursor('not-a-cursor', fingerprint, SIGNER, NOW)).toThrow(
      /커서를 해석할 수 없다/,
    );
  });

  it('다른 키로 서명된 커서는 받지 않는다', () => {
    const other = createCursorSigner('another-key-that-is-also-long-enough!!');
    const fingerprint = computeRawEventFingerprint(parseRawEventFilter({}), [1]);
    const cursor = encodeRawEventCursor([1, 'd-1'], fingerprint, other, NOW);
    expect(() => decodeRawEventCursor(cursor, fingerprint, SIGNER, NOW)).toThrow(AdminRejected);
  });
});
