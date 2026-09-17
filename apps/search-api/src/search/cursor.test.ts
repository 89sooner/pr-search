/**
 * W-001 검색 커서 (WP-032 / FR-SRCH-008, CR-043 DEV-272·273).
 *
 * 지문이 **결과 집합의 정체성**이라는 주장을 여기서 건다. 무엇을 넣었는지보다
 * **무엇을 넣지 않았는지**가 더 쉽게 무너진다 — `size`를 지문에 넣는 것은
 * 언제나 "더 안전해 보이는" 변경이고, 그러면 페이지 크기를 바꾼 사용자가
 * 자기가 만들지 않은 오류를 본다.
 */

import { describe, expect, it } from 'vitest';
import type { AccessScope } from '@prs/es';
import { CursorInvalidError, CursorQueryMismatchError, createCursorSigner } from '../cursor/envelope.js';
import {
  SEARCH_CURSOR_VERSION,
  computeFingerprint,
  decodeSearchCursor,
  encodeSearchCursor,
} from './cursor.js';

const signer = createCursorSigner('search-cursor-test-key-0123456789abcdef');
const NOW = 1_700_000_000_000;

const SCOPE: AccessScope = { kind: 'explicit', repositoryIds: [10, 20, 30] };

const BASE = {
  query: 'repo:acme/payments 결제',
  sortKey: 'merge_seq',
  order: 'desc',
  scope: SCOPE,
  scopeVersion: 7,
  // `seq:`가 없는 질의다. 시퀀스 재료가 **없다** (CR-051).
  sequenceEpoch: null,
  // `mnum:`도 없는 질의다. M 번호 재료도 **없다** (CR-106).
  mergeNumberEpoch: null,
} as const;

const CURSOR = { pitId: 'pit-abc', searchAfter: [1342, 'acme/payments:1210'] };

function roundTrip(
  fingerprint: string,
  verifyWith: string = fingerprint,
  nowMs = NOW,
): ReturnType<typeof decodeSearchCursor> {
  const raw = encodeSearchCursor(CURSOR, fingerprint, signer, NOW);
  return decodeSearchCursor(raw, verifyWith, signer, nowMs);
}

describe('지문의 재료 (DEV-272)', () => {
  it('왕복이 PIT과 정렬 값을 보존한다', () => {
    expect(roundTrip(computeFingerprint(BASE))).toEqual(CURSOR);
  });

  it('질의가 달라지면 지문이 달라진다', () => {
    expect(computeFingerprint({ ...BASE, query: 'repo:acme/payments 환불' })).not.toBe(
      computeFingerprint(BASE),
    );
  });

  it('정렬 키·방향이 달라지면 지문이 달라진다', () => {
    expect(computeFingerprint({ ...BASE, sortKey: 'created_at' })).not.toBe(computeFingerprint(BASE));
    expect(computeFingerprint({ ...BASE, order: 'asc' })).not.toBe(computeFingerprint(BASE));
  });

  /*
   * **권한 회수가 페이징을 죽인다 — 그것이 옳다.**
   *
   * 이전 권한 집합 기준으로 계산된 순서를 회수 뒤에 이어 쓰면 사용자는 지금
   * 볼 수 없는 문서 사이의 위치에서 페이징을 계속하게 된다.
   */
  it('접근 범위가 달라지면 지문이 달라진다', () => {
    const narrowed: AccessScope = { kind: 'explicit', repositoryIds: [10, 20] };
    expect(computeFingerprint({ ...BASE, scope: narrowed })).not.toBe(computeFingerprint(BASE));
  });

  it('`access_scope_version`이 오르면 지문이 달라진다 — 같은 목록이어도 회수는 회수다', () => {
    expect(computeFingerprint({ ...BASE, scopeVersion: 8 })).not.toBe(computeFingerprint(BASE));
  });

  /*
   * 정렬하지 않으면 같은 권한이 조회마다 다른 지문을 만든다 — GHE가 주는
   * 순서도 캐시가 돌려주는 순서도 안정적이라는 보장이 없다. 그러면 사용자는
   * 아무것도 바꾸지 않았는데 두 번째 페이지에서 mismatch를 본다.
   */
  it('접근 범위의 **순서**는 지문을 바꾸지 않는다', () => {
    const shuffled: AccessScope = { kind: 'explicit', repositoryIds: [30, 10, 20] };
    expect(computeFingerprint({ ...BASE, scope: shuffled })).toBe(computeFingerprint(BASE));
  });

  it('`org_team` 범위도 정렬해 센다', () => {
    const a: AccessScope = { kind: 'org_team', orgIds: [1, 2], teamIds: [9, 8], visibilities: ['internal', 'public'] };
    const b: AccessScope = { kind: 'org_team', orgIds: [2, 1], teamIds: [8, 9], visibilities: ['public', 'internal'] };
    expect(computeFingerprint({ ...BASE, scope: a })).toBe(computeFingerprint({ ...BASE, scope: b }));
  });

  /*
   * **`size`와 패싯 요청 여부는 지문에 없다** — 표현이지 결과 집합의 정체성이
   * 아니다. 이 시험은 `computeFingerprint`의 입력에 그 둘이 아예 없다는 사실로
   * 성립한다: 넣으려면 타입을 바꿔야 하고 그러면 여기가 먼저 깨진다.
   */
  it('지문 입력에 `size`·`facets`가 없다', () => {
    const material = Object.keys(BASE);
    // `sequenceEpoch`은 CR-051이, `mergeNumberEpoch`는 CR-106이 더했다 — 둘 다
    // 없으면 같은 서수·M 번호가 다른 세대를 가리킬 수 있다.
    expect(material).toEqual([
      'query',
      'sortKey',
      'order',
      'scope',
      'scopeVersion',
      'sequenceEpoch',
      'mergeNumberEpoch',
    ]);
  });

  it('**에폭이 달라지면 지문이 달라진다** (CR-051, DEV-361)', () => {
    /*
     * `seq_epoch`은 `q` 밖의 파라미터라 지문에 넣지 않으면 질의가 같고
     * 에폭만 다른 두 조회가 같은 지문을 갖는다. 그러면 재채번 뒤에도 옛
     * 커서가 받아들여져 다른 세대의 서수 위에서 순회가 이어진다.
     */
    expect(computeFingerprint({ ...BASE, sequenceEpoch: 3 })).not.toBe(
      computeFingerprint({ ...BASE, sequenceEpoch: 4 }),
    );
  });

  it('`seq:`가 없는 질의와 에폭 있는 질의의 지문이 다르다', () => {
    expect(computeFingerprint(BASE)).not.toBe(computeFingerprint({ ...BASE, sequenceEpoch: 1 }));
  });

  it('에폭 3 커서를 에폭 4 조회에 쓰면 거절된다', () => {
    expect(() =>
      roundTrip(
        computeFingerprint({ ...BASE, sequenceEpoch: 3 }),
        computeFingerprint({ ...BASE, sequenceEpoch: 4 }),
      ),
    ).toThrow(CursorQueryMismatchError);
  });
});

describe('M 번호 에폭의 재료 (CR-106)', () => {
  /*
   * `sequenceEpoch`의 대응 시험을 그대로 본뜬다 — `mergeNumberEpoch`는 값이
   * 같은 공간이면 같은 정수일 수 있지만, 색인에서는 `seq_epoch`과 다른 필드
   * (`merge_number_epoch`)에 걸리는 **별도 재료**다 (query-builder.ts).
   */
  it('**M 번호 에폭이 달라지면 지문이 달라진다**', () => {
    expect(computeFingerprint({ ...BASE, mergeNumberEpoch: 3 })).not.toBe(
      computeFingerprint({ ...BASE, mergeNumberEpoch: 4 }),
    );
  });

  it('`mnum:`이 없는 질의와 M 번호 에폭 있는 질의의 지문이 다르다', () => {
    expect(computeFingerprint(BASE)).not.toBe(computeFingerprint({ ...BASE, mergeNumberEpoch: 1 }));
  });

  it('M 번호 에폭 3 커서를 에폭 4 조회에 쓰면 거절된다', () => {
    expect(() =>
      roundTrip(
        computeFingerprint({ ...BASE, mergeNumberEpoch: 3 }),
        computeFingerprint({ ...BASE, mergeNumberEpoch: 4 }),
      ),
    ).toThrow(CursorQueryMismatchError);
  });

  /*
   * **두 에폭 자리가 실제로 분리돼 있는지를 건다.** 값을 어느 자리에 넣었는지가
   * 서로 바뀌어도 같은 지문이 나오면, 두 옵션을 하나로 접어도(구현 결함) 이
   * 시험이 잡지 못한다 — `seq_epoch`이 오른 질의와 `merge_number_epoch`가 오른
   * 질의가 커서 단계에서 구분되지 않게 된다.
   */
  it('**시퀀스 에폭과 M 번호 에폭은 서로 다른 자리다** — 같은 값이라도 넣은 자리가 다르면 지문이 다르다', () => {
    const sequenceOnly = computeFingerprint({ ...BASE, sequenceEpoch: 3, mergeNumberEpoch: null });
    const mergeNumberOnly = computeFingerprint({ ...BASE, sequenceEpoch: null, mergeNumberEpoch: 3 });
    expect(sequenceOnly).not.toBe(mergeNumberOnly);
  });

  it('둘 다 있으면 둘 다 재료가 된다 — 하나만 바뀌어도 지문이 바뀐다', () => {
    const both = { ...BASE, sequenceEpoch: 3, mergeNumberEpoch: 5 };
    expect(computeFingerprint(both)).not.toBe(computeFingerprint({ ...both, sequenceEpoch: 4 }));
    expect(computeFingerprint(both)).not.toBe(computeFingerprint({ ...both, mergeNumberEpoch: 6 }));
  });
});

describe('두 실패를 가른다 (DEV-273)', () => {
  it('지문이 다르면 `CURSOR_QUERY_MISMATCH`다 — "조건이 바뀌었다"', () => {
    expect(() => roundTrip(computeFingerprint(BASE), computeFingerprint({ ...BASE, order: 'asc' }))).toThrow(
      CursorQueryMismatchError,
    );
  });

  /*
   * **검사 순서가 곧 오류의 뜻이다.**
   *
   * 서명이 깨진 커서에 대고 "조건이 바뀌었다"고 답하면 사용자는 질의를
   * 의심하고, 훼손된 입력을 서버가 해석하려 든 셈이 된다.
   */
  it('서명이 깨지면 지문을 보기 전에 `CURSOR_INVALID`다', () => {
    const fingerprint = computeFingerprint(BASE);
    const raw = encodeSearchCursor(CURSOR, fingerprint, signer, NOW);
    const tampered = `${raw.slice(0, -1)}${raw.endsWith('A') ? 'B' : 'A'}`;
    // 지문은 **맞는데도** invalid다 — 서명이 먼저다.
    expect(() => decodeSearchCursor(tampered, fingerprint, signer, NOW)).toThrow(CursorInvalidError);
  });

  it('만료되면 `CURSOR_INVALID`다', () => {
    const fingerprint = computeFingerprint(BASE);
    expect(() => roundTrip(fingerprint, fingerprint, NOW + 6 * 60 * 1000)).toThrow(CursorInvalidError);
  });

  it('모르는 스키마 버전은 `CURSOR_INVALID`다 — 조용히 잘못 해석하지 않는다', () => {
    const fingerprint = computeFingerprint(BASE);
    const body = Buffer.from(
      JSON.stringify({ v: SEARCH_CURSOR_VERSION + 1, p: 'pit', s: [1], f: fingerprint, x: NOW + 1000 }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeSearchCursor(`${body}.${signer.sign(body)}`, fingerprint, signer, NOW)).toThrow(
      CursorInvalidError,
    );
  });

  it('PIT이 없거나 정렬 값이 비면 `CURSOR_INVALID`다', () => {
    const fingerprint = computeFingerprint(BASE);
    for (const payload of [
      { v: SEARCH_CURSOR_VERSION, p: '', s: [1], f: fingerprint, x: NOW + 1000 },
      { v: SEARCH_CURSOR_VERSION, p: 'pit', s: [], f: fingerprint, x: NOW + 1000 },
      { v: SEARCH_CURSOR_VERSION, p: 'pit', s: 'not-array', f: fingerprint, x: NOW + 1000 },
    ]) {
      const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      expect(() => decodeSearchCursor(`${body}.${signer.sign(body)}`, fingerprint, signer, NOW)).toThrow(
        CursorInvalidError,
      );
    }
  });
});
