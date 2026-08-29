/**
 * 감사 목록 커서 (WP-039 / API-ADM-005, QA-A004-09, CR-054).
 *
 * 여기서 거는 것은 **위조와 조건 변경이 다른 사실로 드러나는가**다. 둘 다
 * 사용자를 첫 페이지로 되돌리지만 같은 기술 원인인 척하지 않는다.
 */

import { describe, expect, it } from 'vitest';
import { createCursorSigner, CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import { computeAuditFingerprint, decodeAuditCursor, encodeAuditCursor } from './cursor.js';

const signer = createCursorSigner('0'.repeat(32));
const NOW = Date.parse('2026-08-29T00:00:00.000Z');
const POSITION = { occurredAt: new Date('2026-08-29T04:12:07.412Z'), auditId: 4210 };

describe('왕복', () => {
  it('키셋 두 값을 그대로 되돌려준다', () => {
    const fp = computeAuditFingerprint({});
    const cursor = encodeAuditCursor(POSITION, fp, signer, NOW);
    const back = decodeAuditCursor(cursor, fp, signer, NOW + 1000);
    expect(back.auditId).toBe(4210);
    expect(back.occurredAt.toISOString()).toBe('2026-08-29T04:12:07.412Z');
  });

  it('밀리초를 잃지 않는다 — 같은 초 안의 무리를 가르는 값이다', () => {
    const fp = computeAuditFingerprint({});
    const cursor = encodeAuditCursor(POSITION, fp, signer, NOW);
    expect(decodeAuditCursor(cursor, fp, signer, NOW).occurredAt.getTime()).toBe(
      POSITION.occurredAt.getTime(),
    );
  });
});

describe('QA-A004-09: 조건이 바뀐 커서', () => {
  it('필터가 달라지면 `CURSOR_QUERY_MISMATCH`다', () => {
    const before = computeAuditFingerprint({ userId: 'alice' });
    const after = computeAuditFingerprint({ userId: 'bob' });
    const cursor = encodeAuditCursor(POSITION, before, signer, NOW);
    expect(() => decodeAuditCursor(cursor, after, signer, NOW)).toThrow(CursorQueryMismatchError);
  });

  it('여섯 축이 모두 지문에 들어간다', () => {
    const base = computeAuditFingerprint({});
    const variants = [
      { userId: 'a' },
      { action: 'search.execute' },
      { target: 'acme/payments' },
      { resultCode: 'ok' },
      { from: new Date('2026-08-01T00:00:00Z') },
      { to: new Date('2026-08-29T00:00:00Z') },
    ];
    for (const variant of variants) {
      expect(computeAuditFingerprint(variant), JSON.stringify(variant)).not.toBe(base);
    }
  });

  it('빈 문자열과 부재를 가른다', () => {
    // 서버는 빈 문자열을 400으로 막지만, 지문 자체가 둘을 섞으면 그 방어가
    // 커서 경로에서만 조용히 무력해진다.
    expect(computeAuditFingerprint({ action: '' })).not.toBe(computeAuditFingerprint({}));
  });

  it('축이 자리를 넘어가지 않는다 — 값에 구분자가 있어도', () => {
    // 순진한 `join('|')`은 `user_id`에 파이프가 있으면 다음 칸으로 샌다.
    const a = computeAuditFingerprint({ userId: 'x|y' });
    const b = computeAuditFingerprint({ userId: 'x', action: 'y' });
    expect(a).not.toBe(b);
  });
});

describe('쓸 수 없는 커서', () => {
  it('위조된 서명은 `CURSOR_INVALID`다', () => {
    const fp = computeAuditFingerprint({});
    const cursor = encodeAuditCursor(POSITION, fp, signer, NOW);
    const tampered = `${cursor.slice(0, -3)}xyz`;
    expect(() => decodeAuditCursor(tampered, fp, signer, NOW)).toThrow(CursorInvalidError);
  });

  it('만료되면 `CURSOR_INVALID`다', () => {
    const fp = computeAuditFingerprint({});
    const cursor = encodeAuditCursor(POSITION, fp, signer, NOW);
    expect(() => decodeAuditCursor(cursor, fp, signer, NOW + 6 * 60 * 1000)).toThrow(
      CursorInvalidError,
    );
  });

  it('다른 키로 서명된 커서를 받지 않는다', () => {
    const other = createCursorSigner('1'.repeat(32));
    const fp = computeAuditFingerprint({});
    const cursor = encodeAuditCursor(POSITION, fp, other, NOW);
    expect(() => decodeAuditCursor(cursor, fp, signer, NOW)).toThrow(CursorInvalidError);
  });

  it('봉투가 아니면 `CURSOR_INVALID`다', () => {
    expect(() => decodeAuditCursor('not-an-envelope', computeAuditFingerprint({}), signer, NOW)).toThrow(
      CursorInvalidError,
    );
  });

  /*
   * **위조 검사가 지문 검사보다 먼저다.** 순서가 뒤바뀌면 서명되지 않은
   * 바이트의 `q` 필드를 먼저 읽게 되고, 그 값으로 오류 갈래가 정해진다.
   */
  it('위조된 커서는 지문이 맞아 보여도 `CURSOR_INVALID`다', () => {
    const fp = computeAuditFingerprint({});
    const forged = `${Buffer.from(JSON.stringify({ v: 1, t: POSITION.occurredAt.toISOString(), i: 1, q: fp, x: NOW + 1000 })).toString('base64url')}.badsig`;
    expect(() => decodeAuditCursor(forged, fp, signer, NOW)).toThrow(CursorInvalidError);
  });
});
