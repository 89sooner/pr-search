/**
 * 커서 실패의 갈래 (C-016 CursorPager · A-002 · A-004, CR-125 / DEV-777).
 *
 * 서버는 옛 판(판 1, 밀리초) 커서를 `CURSOR_INVALID`로 답하고 `detail.reason`에 그 사실을 싣는다.
 * 화면은 그 사유만 셋째 갈래로 읽고, 나머지는 서버 코드를 그대로 쓴다.
 */

import { describe, expect, it } from 'vitest';
import { CURSOR_FAILURE_TEXT, readCursorFailureBody, toCursorFailure } from './cursor-failure';

const OUTDATED = { reason: 'cursor_version_outdated', issued_version: 1, current_version: 2 };

describe('toCursorFailure', () => {
  it('서버 코드 둘은 그대로다', () => {
    expect(toCursorFailure('CURSOR_INVALID')).toBe('CURSOR_INVALID');
    expect(toCursorFailure('CURSOR_QUERY_MISMATCH')).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('`CURSOR_INVALID`에 옛 판 사유가 있으면 셋째 갈래다', () => {
    expect(toCursorFailure('CURSOR_INVALID', OUTDATED)).toBe('CURSOR_OUTDATED');
  });

  it('사유가 없거나 다르면, 또는 다른 코드면 옛 판이 아니다', () => {
    expect(toCursorFailure('CURSOR_INVALID', undefined)).toBe('CURSOR_INVALID');
    expect(toCursorFailure('CURSOR_INVALID', null)).toBe('CURSOR_INVALID');
    expect(toCursorFailure('CURSOR_INVALID', { reason: 'expired' })).toBe('CURSOR_INVALID');
    expect(toCursorFailure('CURSOR_INVALID', 'cursor_version_outdated')).toBe('CURSOR_INVALID');
    expect(toCursorFailure('CURSOR_QUERY_MISMATCH', OUTDATED)).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('커서가 아닌 오류는 `null`이다', () => {
    expect(toCursorFailure('INVALID_PARAMETER', OUTDATED)).toBeNull();
    expect(toCursorFailure(undefined)).toBeNull();
  });
});

describe('readCursorFailureBody', () => {
  it('오류 본문의 코드와 사유를 함께 읽는다', () => {
    expect(readCursorFailureBody({ error: { code: 'CURSOR_INVALID', detail: OUTDATED } })).toBe('CURSOR_OUTDATED');
    expect(readCursorFailureBody({ error: { code: 'CURSOR_INVALID' } })).toBe('CURSOR_INVALID');
  });

  it('본문 모양이 다르면 `null`이다', () => {
    for (const body of [null, 'x', {}, { error: null }, { error: 'CURSOR_INVALID' }, { error: { code: 7 } }]) {
      expect(readCursorFailureBody(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe('안내 문구', () => {
  it('세 갈래 모두 첫 페이지로 돌아가라고 말한다 — 옛 판은 서비스가 바뀌었다고 밝힌다', () => {
    for (const text of Object.values(CURSOR_FAILURE_TEXT)) expect(text.impact).toMatch(/first page/);
    expect(CURSOR_FAILURE_TEXT.CURSOR_OUTDATED.title).toMatch(/earlier version/);
    expect(CURSOR_FAILURE_TEXT.CURSOR_OUTDATED.impact).toMatch(/updated/);
  });
});
