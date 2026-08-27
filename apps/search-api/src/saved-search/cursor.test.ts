/**
 * 저장된 검색 커서 (WP-033 / FR-SRCH-010 AC-5).
 *
 * 통합 시험이 "순회가 항목을 빠뜨리지 않는다"를 실제 PostgreSQL로 건다면,
 * 여기서는 **봉투가 무엇을 거절하는가**를 건다 — 거절은 실패 경로라 통합에서
 * 만들기 번거롭고, 그 경로가 바로 접근 통제가 사는 자리다.
 */

import { describe, expect, it } from 'vitest';
import { createCursorSigner, CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import {
  SAVED_SEARCH_CURSOR_VERSION,
  computeSavedSearchFingerprint,
  decodeSavedSearchCursor,
  encodeSavedSearchCursor,
  isSavedSearchView,
} from './cursor.js';

const SIGNER = createCursorSigner('unit-test-key-0123456789abcdef-wp033');
const OTHER_SIGNER = createCursorSigner('other-key-0123456789abcdef-wp033xx');
const NOW = 1_800_000_000_000;

const POSITION = { createdAt: '2026-08-27T09:00:00.123456Z', savedSearchId: 42 };

function fingerprintOf(userId: string, view: 'mine' | 'team', teamIds: readonly number[]): string {
  return computeSavedSearchFingerprint({ userId, view, teamIds });
}

const MINE = fingerprintOf('alice', 'mine', [10, 20]);

describe('지문', () => {
  it('같은 입력이면 같다', () => {
    expect(fingerprintOf('alice', 'mine', [10, 20])).toBe(fingerprintOf('alice', 'mine', [10, 20]));
  });

  it('**팀 순서가 달라도 같다** — 조회 순서가 지문을 흔들지 않는다', () => {
    expect(fingerprintOf('alice', 'mine', [20, 10])).toBe(fingerprintOf('alice', 'mine', [10, 20]));
  });

  it('사용자가 다르면 다르다', () => {
    expect(fingerprintOf('bob', 'mine', [10, 20])).not.toBe(MINE);
  });

  it('목록이 다르면 다르다', () => {
    expect(fingerprintOf('alice', 'team', [10, 20])).not.toBe(MINE);
  });

  it('**팀 소속이 바뀌면 다르다** — 회수도 추가도 집합을 바꾼다', () => {
    expect(fingerprintOf('alice', 'mine', [10])).not.toBe(MINE);
    expect(fingerprintOf('alice', 'mine', [10, 20, 30])).not.toBe(MINE);
  });
});

describe('왕복', () => {
  it('실은 위치를 그대로 돌려준다', () => {
    const cursor = encodeSavedSearchCursor(POSITION, 'mine', MINE, SIGNER, NOW);
    expect(decodeSavedSearchCursor(cursor, 'mine', MINE, SIGNER, NOW)).toEqual(POSITION);
  });

  it('**마이크로초를 잃지 않는다** — 키셋이 항목을 건너뛰지 않으려면 필요하다', () => {
    const cursor = encodeSavedSearchCursor(POSITION, 'mine', MINE, SIGNER, NOW);
    const decoded = decodeSavedSearchCursor(cursor, 'mine', MINE, SIGNER, NOW);
    expect(decoded.createdAt).toBe('2026-08-27T09:00:00.123456Z');
  });

  it('봉투는 불투명하다 — 화면이 읽을 것이 없다', () => {
    const cursor = encodeSavedSearchCursor(POSITION, 'mine', MINE, SIGNER, NOW);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('**사용자 ID가 평문으로 실리지 않는다** (DEV-345)', () => {
    const cursor = encodeSavedSearchCursor(POSITION, 'mine', MINE, SIGNER, NOW);
    const body = Buffer.from(cursor.split('.')[0] ?? '', 'base64url').toString('utf8');
    expect(body).not.toContain('alice');
  });
});

describe('거절', () => {
  const cursor = encodeSavedSearchCursor(POSITION, 'mine', MINE, SIGNER, NOW);

  it('다른 키로 서명한 커서는 CURSOR_INVALID다', () => {
    expect(() => decodeSavedSearchCursor(cursor, 'mine', MINE, OTHER_SIGNER, NOW)).toThrow(
      CursorInvalidError,
    );
  });

  it('훼손된 봉투는 CURSOR_INVALID다', () => {
    expect(() => decodeSavedSearchCursor('아무말.서명', 'mine', MINE, SIGNER, NOW)).toThrow(
      CursorInvalidError,
    );
  });

  it('만료되면 CURSOR_INVALID다', () => {
    expect(() =>
      decodeSavedSearchCursor(cursor, 'mine', MINE, SIGNER, NOW + 10 * 60 * 1000),
    ).toThrow(CursorInvalidError);
  });

  it('모르는 버전은 CURSOR_INVALID다', () => {
    const future = encodeSavedSearchCursor(POSITION, 'mine', MINE, SIGNER, NOW).split('.');
    const body = JSON.parse(Buffer.from(future[0] ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    body['v'] = SAVED_SEARCH_CURSOR_VERSION + 1;
    const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    const resigned = `${encoded}.${SIGNER.sign(encoded)}`;

    expect(() => decodeSavedSearchCursor(resigned, 'mine', MINE, SIGNER, NOW)).toThrow(
      CursorInvalidError,
    );
  });

  it('**다른 목록의 커서는 CURSOR_QUERY_MISMATCH다**', () => {
    expect(() =>
      decodeSavedSearchCursor(cursor, 'team', fingerprintOf('alice', 'team', [10, 20]), SIGNER, NOW),
    ).toThrow(CursorQueryMismatchError);
  });

  it('**남의 커서는 CURSOR_QUERY_MISMATCH다** — 서명은 유효하고 지문만 다르다', () => {
    expect(() =>
      decodeSavedSearchCursor(cursor, 'mine', fingerprintOf('bob', 'mine', [10, 20]), SIGNER, NOW),
    ).toThrow(CursorQueryMismatchError);
  });

  it('**팀 소속이 바뀌면 CURSOR_QUERY_MISMATCH다** — 순회 도중 회수를 막는다', () => {
    expect(() =>
      decodeSavedSearchCursor(cursor, 'mine', fingerprintOf('alice', 'mine', [10]), SIGNER, NOW),
    ).toThrow(CursorQueryMismatchError);
  });

  it('키셋 값이 빠진 커서는 CURSOR_INVALID다', () => {
    for (const broken of [{ c: '' }, { i: 0 }, { i: -1 }]) {
      const body = {
        v: SAVED_SEARCH_CURSOR_VERSION,
        w: 'mine',
        c: POSITION.createdAt,
        i: POSITION.savedSearchId,
        q: MINE,
        x: NOW + 60_000,
        ...broken,
      };
      const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
      expect(() =>
        decodeSavedSearchCursor(`${encoded}.${SIGNER.sign(encoded)}`, 'mine', MINE, SIGNER, NOW),
      ).toThrow(CursorInvalidError);
    }
  });

  it('**검사 순서가 오류의 뜻을 정한다** — 만료가 지문보다 먼저다', () => {
    /*
     * 만료된 남의 커서는 `CURSOR_INVALID`다. 지문을 먼저 보면
     * `CURSOR_QUERY_MISMATCH`가 되어 "조건이 바뀌었다"고 말하는데, 실제로는
     * 그냥 오래된 커서다 — 사용자가 할 일이 다르다.
     */
    expect(() =>
      decodeSavedSearchCursor(
        cursor,
        'mine',
        fingerprintOf('bob', 'mine', [10, 20]),
        SIGNER,
        NOW + 10 * 60 * 1000,
      ),
    ).toThrow(CursorInvalidError);
  });
});

describe('view 판정', () => {
  it("'mine'과 'team'만 받는다", () => {
    expect(isSavedSearchView('mine')).toBe(true);
    expect(isSavedSearchView('team')).toBe(true);
    expect(isSavedSearchView('all')).toBe(false);
    expect(isSavedSearchView(undefined)).toBe(false);
    expect(isSavedSearchView('')).toBe(false);
  });
});
