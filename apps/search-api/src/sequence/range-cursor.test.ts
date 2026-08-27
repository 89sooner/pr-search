/**
 * W-004 구간 커서 (WP-032 / FR-SEQ-002 AC-6·7, CR-043 DEV-270).
 *
 * 여기서 거는 것은 **에폭이 반드시 커서를 무효화한다**는 불변식이다. 재채번
 * 뒤 옛 커서를 이어 쓰면 서수가 다른 두 공간을 한 목록으로 섞는다 — 그것이
 * 에폭이 존재하는 이유다 (ADR-007). 이 시험이 없으면 "지문에 다 넣었으니
 * 되겠지"라는 리팩터가 그 불변식을 조용히 지운다.
 */

import { describe, expect, it } from 'vitest';
import type { AccessScope } from '@prs/es';
import { CursorInvalidError, CursorQueryMismatchError, createCursorSigner } from '../cursor/envelope.js';
import {
  computeRangeFingerprint,
  decodeRangeCursor,
  encodeRangeCursor,
  type RangeCursorAnchor,
} from './range-cursor.js';

const signer = createCursorSigner('range-cursor-test-key-0123456789abcdef');
const NOW = 1_700_000_000_000;

const SCOPE: AccessScope = { kind: 'explicit', repositoryIds: [4021] };

const ANCHOR: RangeCursorAnchor = {
  repositoryId: 4021,
  baseBranch: 'main',
  seqEpoch: 3,
  fromExclusive: 1280,
  toInclusive: 1342,
};

const FINGERPRINT = computeRangeFingerprint({ query: 'path:src/pay', scope: SCOPE, scopeVersion: 5 });

function decode(
  overrides: Partial<RangeCursorAnchor> = {},
  fingerprint = FINGERPRINT,
  completeSeq = 1300,
): ReturnType<typeof decodeRangeCursor> {
  const raw = encodeRangeCursor(completeSeq, ANCHOR, FINGERPRINT, signer, NOW);
  return decodeRangeCursor(raw, { ...ANCHOR, ...overrides }, fingerprint, signer, NOW);
}

describe('완결 서수 왕복', () => {
  it('봉인한 서수를 그대로 돌려준다', () => {
    expect(decode().completeSeq).toBe(1300);
  });

  it('구간 경계 위의 값도 그대로다 — `to`는 포함이다', () => {
    const raw = encodeRangeCursor(1342, ANCHOR, FINGERPRINT, signer, NOW);
    expect(decodeRangeCursor(raw, ANCHOR, FINGERPRINT, signer, NOW).completeSeq).toBe(1342);
  });
});

describe('에폭 (ADR-007) — 반드시 거절한다', () => {
  /*
   * 재채번이 일어나면 같은 번호가 다른 커밋을 가리킨다. 옛 커서를 이어 쓰면
   * 목록 앞부분은 옛 공간, 뒷부분은 새 공간이 된다 — **오류 없이** 틀린다.
   */
  it('에폭이 오르면 `CURSOR_QUERY_MISMATCH`다', () => {
    expect(() => decode({ seqEpoch: 4 })).toThrow(CursorQueryMismatchError);
  });

  it('에폭이 내려가도 거절한다 — 방향을 판정하지 않는다', () => {
    expect(() => decode({ seqEpoch: 2 })).toThrow(CursorQueryMismatchError);
  });

  it('오류 메시지가 두 에폭을 말한다 — 사용자가 무엇이 일어났는지 알아야 한다', () => {
    expect(() => decode({ seqEpoch: 4 })).toThrow(/재채번/);
  });
});

describe('공간·경계·지문', () => {
  it('다른 저장소·브랜치의 커서를 거절한다', () => {
    expect(() => decode({ repositoryId: 9999 })).toThrow(CursorQueryMismatchError);
    expect(() => decode({ baseBranch: 'release' })).toThrow(CursorQueryMismatchError);
  });

  it('구간 경계가 달라지면 거절한다 — 다른 구간을 보고 있다', () => {
    expect(() => decode({ fromExclusive: 1200 })).toThrow(CursorQueryMismatchError);
    expect(() => decode({ toInclusive: 1400 })).toThrow(CursorQueryMismatchError);
  });

  it('`q`·필터가 달라지면 거절한다', () => {
    const other = computeRangeFingerprint({ query: 'path:src/other', scope: SCOPE, scopeVersion: 5 });
    expect(() => decode({}, other)).toThrow(CursorQueryMismatchError);
  });

  it('접근 범위·버전이 달라지면 거절한다', () => {
    const narrowed = computeRangeFingerprint({
      query: 'path:src/pay',
      scope: { kind: 'explicit', repositoryIds: [] },
      scopeVersion: 5,
    });
    const bumped = computeRangeFingerprint({ query: 'path:src/pay', scope: SCOPE, scopeVersion: 6 });
    expect(() => decode({}, narrowed)).toThrow(CursorQueryMismatchError);
    expect(() => decode({}, bumped)).toThrow(CursorQueryMismatchError);
  });

  it('`q`가 없는 조회의 지문은 빈 문자열이 재료다 — 그것도 지문이다', () => {
    const empty = computeRangeFingerprint({ query: '', scope: SCOPE, scopeVersion: 5 });
    expect(empty).not.toBe(FINGERPRINT);
    const raw = encodeRangeCursor(1300, ANCHOR, empty, signer, NOW);
    expect(decodeRangeCursor(raw, ANCHOR, empty, signer, NOW).completeSeq).toBe(1300);
  });
});

describe('훼손·만료는 `CURSOR_INVALID`다', () => {
  it('서명이 깨지면 거절한다', () => {
    const raw = encodeRangeCursor(1300, ANCHOR, FINGERPRINT, signer, NOW);
    const tampered = `${raw.slice(0, -1)}${raw.endsWith('A') ? 'B' : 'A'}`;
    expect(() => decodeRangeCursor(tampered, ANCHOR, FINGERPRINT, signer, NOW)).toThrow(CursorInvalidError);
  });

  it('만료되면 거절한다', () => {
    const raw = encodeRangeCursor(1300, ANCHOR, FINGERPRINT, signer, NOW);
    expect(() => decodeRangeCursor(raw, ANCHOR, FINGERPRINT, signer, NOW + 6 * 60 * 1000)).toThrow(
      CursorInvalidError,
    );
  });

  /*
   * 경계가 같은데 값만 구간 밖인 것은 **훼손**이지 조건 변경이 아니다.
   *
   * 서명이 그것을 막지만, 검사를 서명에만 기대면 서명 방식이 바뀔 때 이
   * 불변식이 함께 사라진다.
   */
  it('완결 서수가 구간 밖이면 거절한다', () => {
    for (const seq of [1279, 1343]) {
      const body = Buffer.from(
        JSON.stringify({ v: 1, r: 4021, b: 'main', e: 3, f: 1280, t: 1342, q: FINGERPRINT, c: seq, x: NOW + 1000 }),
        'utf8',
      ).toString('base64url');
      expect(() => decodeRangeCursor(`${body}.${signer.sign(body)}`, ANCHOR, FINGERPRINT, signer, NOW), String(seq)).toThrow(
        CursorInvalidError,
      );
    }
  });
});
