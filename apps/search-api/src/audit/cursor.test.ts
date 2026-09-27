/**
 * 감사 목록 커서 (WP-039 / API-ADM-005, QA-A004-09, CR-054).
 *
 * 여기서 거는 것은 **위조와 조건 변경이 다른 사실로 드러나는가**다. 둘 다
 * 사용자를 첫 페이지로 되돌리지만 같은 기술 원인인 척하지 않는다.
 */

import { describe, expect, it } from 'vitest';
import {
  createCursorSigner,
  CursorInvalidError,
  CursorOutdatedError,
  CursorQueryMismatchError,
  encodeEnvelope,
} from '../cursor/envelope.js';
import { AUDIT_CURSOR_VERSION, computeAuditFingerprint, decodeAuditCursor, encodeAuditCursor } from './cursor.js';

const signer = createCursorSigner('0'.repeat(32));
const NOW = Date.parse('2026-08-29T00:00:00.000Z');
/** PostgreSQL이 주는 마이크로초 UTC 문자열 그대로다 (DEV-777). */
const POSITION = { occurredAt: '2026-08-29T04:12:07.412345Z', auditId: 4210 };

describe('왕복', () => {
  it('키셋 두 값을 그대로 되돌려준다', () => {
    const fp = computeAuditFingerprint({});
    const cursor = encodeAuditCursor(POSITION, fp, signer, NOW);
    const back = decodeAuditCursor(cursor, fp, signer, NOW + 1000);
    expect(back.auditId).toBe(4210);
    expect(back.occurredAt).toBe('2026-08-29T04:12:07.412345Z');
  });

  it('**마이크로초를 잃지 않는다** — 같은 밀리초 안의 무리를 가르는 값이다 (DEV-777)', () => {
    const fp = computeAuditFingerprint({});
    for (const occurredAt of ['2026-08-29T04:12:07.412000Z', '2026-08-29T04:12:07.412001Z', '2026-08-29T04:12:07.412999Z']) {
      const cursor = encodeAuditCursor({ occurredAt, auditId: 1 }, fp, signer, NOW);
      expect(decodeAuditCursor(cursor, fp, signer, NOW).occurredAt, occurredAt).toBe(occurredAt);
    }
  });
});

describe('옛 판 커서 (CR-125, DEV-777)', () => {
  const legacy = (v: number, t: string): string =>
    encodeEnvelope({ v, t, i: 4210, q: computeAuditFingerprint({}), x: NOW + 1000 }, signer);

  it('밀리초로 잘린 판 1 커서는 이어 읽지 않고 옛 판 갈래로 거절한다', () => {
    expect(AUDIT_CURSOR_VERSION).toBe(2);
    const error = (() => {
      try {
        decodeAuditCursor(legacy(1, '2026-08-29T04:12:07.412Z'), computeAuditFingerprint({}), signer, NOW);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(CursorOutdatedError);
    // 응답 코드는 `CURSOR_INVALID` 그대로다 — 같은 갈래로 처리된다.
    expect(error).toBeInstanceOf(CursorInvalidError);
    expect((error as CursorOutdatedError).detail).toEqual({
      reason: 'cursor_version_outdated',
      issued_version: 1,
      current_version: 2,
    });
  });

  it('만료된 판 1도 옛 판 갈래다 — 판 판정이 만료보다 먼저다(어느 쪽이든 첫 페이지로 돌아간다)', () => {
    const expired = encodeEnvelope(
      { v: 1, t: '2026-08-29T04:12:07.412Z', i: 4210, q: computeAuditFingerprint({}), x: NOW - 1 },
      signer,
    );
    expect(() => decodeAuditCursor(expired, computeAuditFingerprint({}), signer, NOW)).toThrow(CursorOutdatedError);
  });

  it('모르는 판은 옛 판 갈래가 아니다', () => {
    let caught: unknown;
    try {
      decodeAuditCursor(legacy(9, POSITION.occurredAt), computeAuditFingerprint({}), signer, NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CursorInvalidError);
    expect(caught).not.toBeInstanceOf(CursorOutdatedError);
  });

  it('현재 판이라도 시각이 마이크로초 여섯 자리 UTC가 아니면 받지 않는다', () => {
    for (const t of ['2026-08-29T04:12:07.412Z', '2026-08-29T04:12:07.4123456Z', '2026-08-29T04:12:07.412345', '2026-08-29 04:12:07.412345Z']) {
      expect(() => decodeAuditCursor(legacy(2, t), computeAuditFingerprint({}), signer, NOW), t).toThrow(CursorInvalidError);
    }
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
    const forged = `${Buffer.from(JSON.stringify({ v: AUDIT_CURSOR_VERSION, t: POSITION.occurredAt, i: 1, q: fp, x: NOW + 1000 })).toString('base64url')}.badsig`;
    expect(() => decodeAuditCursor(forged, fp, signer, NOW)).toThrow(CursorInvalidError);
  });
});
