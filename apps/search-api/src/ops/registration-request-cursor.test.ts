/**
 * 등록 검토 요청 대기열 커서 (API-ADM-009, CR-125 / DEV-777).
 *
 * 판 2는 키셋 시각을 PostgreSQL의 마이크로초 UTC 문자열 그대로 싣는다. 여기서 거는 것은 셋이다 —
 * 그 문자열이 글자 그대로 돌아오는가, 밀리초로 잘린 판 1 커서를 이어 읽지 않고 옛 판 갈래로 거절하는가,
 * 위조·만료·조건 변경이 기존 갈래를 그대로 지키는가.
 */

import { describe, expect, it } from 'vitest';
import {
  createCursorSigner,
  CursorInvalidError,
  CursorOutdatedError,
  CursorQueryMismatchError,
  encodeEnvelope,
} from '../cursor/envelope.js';
import {
  REGISTRATION_REQUEST_CURSOR_VERSION,
  computeRequestFingerprint,
  decodeRequestCursor,
  encodeRequestCursor,
} from './registration-request-cursor.js';

const signer = createCursorSigner('0'.repeat(32));
const NOW = Date.parse('2026-09-27T00:00:00.000Z');
const PENDING = computeRequestFingerprint({ status: 'pending' });
/** PostgreSQL이 주는 마이크로초 UTC 문자열 그대로다. */
const POSITION = { createdAt: '2026-09-26T10:00:00.123456Z', requestId: 42 };

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('왕복', () => {
  it('키셋 두 값을 글자 그대로 되돌려준다', () => {
    const cursor = encodeRequestCursor(POSITION, PENDING, signer, NOW);
    expect(decodeRequestCursor(cursor, PENDING, signer, NOW + 1000)).toEqual(POSITION);
  });

  it('**같은 밀리초 안의 마이크로초 차이를 잃지 않는다** (DEV-777)', () => {
    for (const createdAt of ['2026-09-26T10:00:00.123000Z', '2026-09-26T10:00:00.123001Z', '2026-09-26T10:00:00.123999Z']) {
      const cursor = encodeRequestCursor({ createdAt, requestId: 7 }, PENDING, signer, NOW);
      expect(decodeRequestCursor(cursor, PENDING, signer, NOW).createdAt, createdAt).toBe(createdAt);
    }
  });
});

describe('옛 판 커서 (CR-125, DEV-777)', () => {
  const envelope = (v: number, t: string): string =>
    encodeEnvelope({ v, t, i: 42, q: PENDING, x: NOW + 1000 }, signer);

  it('밀리초로 잘린 판 1 커서는 이어 읽지 않고 옛 판 갈래로 거절한다', () => {
    expect(REGISTRATION_REQUEST_CURSOR_VERSION).toBe(2);
    const error = caught(() => decodeRequestCursor(envelope(1, '2026-09-26T10:00:00.123Z'), PENDING, signer, NOW));
    expect(error).toBeInstanceOf(CursorOutdatedError);
    expect(error).toBeInstanceOf(CursorInvalidError);
    expect((error as CursorOutdatedError).detail).toEqual({
      reason: 'cursor_version_outdated',
      issued_version: 1,
      current_version: 2,
    });
  });

  it('판 1은 지문이 달라도 옛 판 갈래가 먼저다 — 조건 변경으로 오인하지 않는다', () => {
    const other = computeRequestFingerprint({ status: 'dismissed' });
    expect(caught(() => decodeRequestCursor(envelope(1, '2026-09-26T10:00:00.123Z'), other, signer, NOW))).toBeInstanceOf(
      CursorOutdatedError,
    );
  });

  it('만료된 판 1도 옛 판 갈래다 — 판 판정이 만료보다 먼저다(어느 쪽이든 첫 페이지로 돌아간다)', () => {
    const expired = encodeEnvelope({ v: 1, t: '2026-09-26T10:00:00.123Z', i: 42, q: PENDING, x: NOW - 1 }, signer);
    expect(caught(() => decodeRequestCursor(expired, PENDING, signer, NOW))).toBeInstanceOf(CursorOutdatedError);
  });

  it('모르는 판은 옛 판 갈래가 아니다', () => {
    const error = caught(() => decodeRequestCursor(envelope(9, POSITION.createdAt), PENDING, signer, NOW));
    expect(error).toBeInstanceOf(CursorInvalidError);
    expect(error).not.toBeInstanceOf(CursorOutdatedError);
  });

  it('현재 판이라도 시각이 마이크로초 여섯 자리 UTC가 아니면 받지 않는다', () => {
    for (const t of ['2026-09-26T10:00:00.123Z', '2026-09-26T10:00:00.1234567Z', '2026-09-26T10:00:00.123456', '2026-09-26 10:00:00.123456Z', '']) {
      expect(() => decodeRequestCursor(envelope(2, t), PENDING, signer, NOW), t).toThrow(CursorInvalidError);
    }
  });
});

describe('기존 갈래는 그대로다', () => {
  it('조건이 바뀌면 `CURSOR_QUERY_MISMATCH`다', () => {
    const cursor = encodeRequestCursor(POSITION, PENDING, signer, NOW);
    expect(() =>
      decodeRequestCursor(cursor, computeRequestFingerprint({ status: 'dismissed' }), signer, NOW),
    ).toThrow(CursorQueryMismatchError);
  });

  it('만료되면 옛 판이 아닌 `CURSOR_INVALID`다', () => {
    const cursor = encodeRequestCursor(POSITION, PENDING, signer, NOW);
    const error = caught(() => decodeRequestCursor(cursor, PENDING, signer, NOW + 6 * 60 * 1000));
    expect(error).toBeInstanceOf(CursorInvalidError);
    expect(error).not.toBeInstanceOf(CursorOutdatedError);
  });

  it('위조된 서명은 `CURSOR_INVALID`다', () => {
    const cursor = encodeRequestCursor(POSITION, PENDING, signer, NOW);
    expect(() => decodeRequestCursor(`${cursor.slice(0, -3)}xyz`, PENDING, signer, NOW)).toThrow(CursorInvalidError);
  });
});
