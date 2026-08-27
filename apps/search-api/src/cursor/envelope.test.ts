/**
 * 커서 봉투 (WP-032 / ADR-010 Amendment, CR-043 DEV-271·273).
 *
 * 여기서 확인하는 것은 **봉인**이다 — 서명, 만료, 형식, 그리고 두 실패를
 * 가르는 경계. 순회의 뜻은 각 커서 모듈이 갖는다.
 */

import { describe, expect, it } from 'vitest';
import {
  CURSOR_TTL_MS,
  CursorInvalidError,
  MIN_CURSOR_KEY_LENGTH,
  assertNotExpired,
  createCursorSigner,
  decodeEnvelope,
  encodeEnvelope,
  ephemeralCursorKey,
} from './envelope.js';

const KEY = 'envelope-test-key-0123456789abcdef-wp032';
const signer = createCursorSigner(KEY);

describe('서명 (DEV-271)', () => {
  it('왕복이 값을 보존한다', () => {
    const payload = { v: 1, s: [1, 'a'], f: 'fp', x: 999 };
    expect(decodeEnvelope(encodeEnvelope(payload, signer), signer)).toEqual(payload);
  });

  /*
   * 이것이 봉인이 존재하는 이유다.
   *
   * base64 JSON만으로는 사용자가 정렬 키 값을 고쳐 **정상 커서처럼** 만들 수
   * 있다. 접근 통제가 깨지지는 않는다 — 강제 필터는 질의 시점에 다시 걸린다 —
   * 그러나 서버는 자기가 발급하지 않은 위치를 자기가 발급한 것처럼 신뢰하게 된다.
   */
  it('본문을 손으로 고친 커서를 거절한다', () => {
    const cursor = encodeEnvelope({ v: 1, s: [10] }, signer);
    const [body, signature] = cursor.split('.');
    const tampered = Buffer.from(JSON.stringify({ v: 1, s: [99999] }), 'utf8').toString('base64url');

    expect(() => decodeEnvelope(`${tampered}.${String(signature)}`, signer)).toThrow(CursorInvalidError);
    // 서명만 바꾼 것도 마찬가지다.
    expect(() => decodeEnvelope(`${String(body)}.AAAA`, signer)).toThrow(CursorInvalidError);
  });

  it('다른 키로 서명한 커서를 거절한다 — 키 회전이 옛 커서를 끊는다', () => {
    const other = createCursorSigner('another-key-0123456789abcdef-wp032-xx');
    const cursor = encodeEnvelope({ v: 1 }, other);
    expect(() => decodeEnvelope(cursor, signer)).toThrow(CursorInvalidError);
  });

  it('형식이 봉투가 아니면 거절한다', () => {
    for (const raw of ['', '.', 'nodot', 'a.', '.b']) {
      expect(() => decodeEnvelope(raw, signer), raw).toThrow(CursorInvalidError);
    }
  });

  it('본문이 객체가 아니면 거절한다 — 배열도 아니다', () => {
    const array = Buffer.from(JSON.stringify([1, 2]), 'utf8').toString('base64url');
    expect(() => decodeEnvelope(`${array}.${signer.sign(array)}`, signer)).toThrow(CursorInvalidError);
  });
});

describe('키 길이 (fail closed)', () => {
  it('짧은 키를 거절한다 — 서명이 있다는 사실만 남기는 것을 막는다', () => {
    expect(() => createCursorSigner('short')).toThrow(/너무 짧다/);
    expect(() => createCursorSigner('x'.repeat(MIN_CURSOR_KEY_LENGTH - 1))).toThrow();
    expect(() => createCursorSigner('x'.repeat(MIN_CURSOR_KEY_LENGTH))).not.toThrow();
  });

  it('임시 키도 하한을 넘는다 — 개발이라고 약한 서명을 쓰지 않는다', () => {
    expect(() => createCursorSigner(ephemeralCursorKey())).not.toThrow();
    // 프로세스마다 다르다 — 재기동하면 옛 커서가 CURSOR_INVALID다.
    expect(ephemeralCursorKey()).not.toBe(ephemeralCursorKey());
  });
});

describe('만료', () => {
  it('만료 시각이 지나면 거절한다', () => {
    expect(() => {
      assertNotExpired(1_000, 1_001);
    }).toThrow(CursorInvalidError);
  });

  it('아직이면 통과한다', () => {
    expect(() => {
      assertNotExpired(1_000, 999);
    }).not.toThrow();
  });

  it('없거나 숫자가 아니면 거절한다 — 만료 없는 커서를 만들지 않는다', () => {
    for (const value of [undefined, null, 'soon', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => {
        assertNotExpired(value, 0);
      }).toThrow(CursorInvalidError);
    }
  });

  it('수명이 PIT keep-alive와 같은 크기다 — 커서가 살아 있는데 뷰가 없는 구간을 만들지 않는다', () => {
    expect(CURSOR_TTL_MS).toBe(5 * 60 * 1000);
  });
});
