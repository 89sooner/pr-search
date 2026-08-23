/**
 * 앵커 분류 (WP-023 / FR-SEQ-003, API-SEQ-002).
 *
 * 이 시험이 지키는 것은 **가르는 순서**다. 다섯 유형의 형태는 겹칠 수 있고
 * (`1234567`은 숫자이면서 hex다), 순서가 바뀌면 입력은 그대로 통과하지만
 * 사용자가 뜻하지 않은 구간이 나온다 — 오류 없이.
 */

import { describe, expect, it } from 'vitest';
import { MIN_ANCHOR_SHA_LENGTH, boundaryOf, classifyAnchor } from './anchor.js';

const SHA40 = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';

describe('classifyAnchor 시퀀스 값 (FR-SEQ-003)', () => {
  it('`seq:` 접두를 서수로 읽는다', () => {
    expect(classifyAnchor('seq:1342')).toEqual({ kind: 'sequence', value: 1342 });
  });

  it('`@` 접두도 같다', () => {
    expect(classifyAnchor('@1342')).toEqual({ kind: 'sequence', value: 1342 });
  });

  it('대소문자를 가리지 않는다', () => {
    expect(classifyAnchor('SEQ:7')).toEqual({ kind: 'sequence', value: 7 });
  });

  it('**0은 서수가 아니다** — 서수는 1부터 시작한다 (ADR-007)', () => {
    expect(classifyAnchor('seq:0').kind).toBe('invalid');
  });

  it('32비트를 넘는 값은 거절한다 — 없는 서수로 조회를 던지지 않는다', () => {
    expect(classifyAnchor('seq:99999999999999').kind).toBe('invalid');
  });
});

describe('classifyAnchor PR 번호 (AC-3)', () => {
  it('`#1234`를 PR로 읽는다', () => {
    expect(classifyAnchor('#1234')).toEqual({ kind: 'pull_request', number: 1234 });
  });

  it('저장소 접두가 붙은 형태는 받지 않는다 — 앵커의 저장소는 요청이 정한다', () => {
    // `acme/payments#1234`가 통과하면 요청의 저장소와 다른 저장소를 가리킬 수 있다.
    expect(classifyAnchor('acme/payments#1234').kind).toBe('release');
  });

  it('40자리 숫자가 PR 번호가 되지 않는다 (DEV-066과 같은 근거)', () => {
    expect(classifyAnchor(`#${'9'.repeat(40)}`).kind).toBe('invalid');
  });
});

describe('classifyAnchor 커밋 SHA (AC-2, ADR-012)', () => {
  it('40자는 정확 일치다', () => {
    expect(classifyAnchor(SHA40)).toEqual({ kind: 'commit', sha: SHA40, match: 'exact' });
  });

  it('대문자 SHA를 소문자로 정규화한다 — 색인이 소문자로 저장한다', () => {
    expect(classifyAnchor(SHA40.toUpperCase())).toEqual({ kind: 'commit', sha: SHA40, match: 'exact' });
  });

  it('7~39자는 접두 일치다', () => {
    expect(classifyAnchor('a3f9c21')).toEqual({ kind: 'commit', sha: 'a3f9c21', match: 'prefix' });
  });

  it(`**${String(MIN_ANCHOR_SHA_LENGTH)}자 미만은 조회 전에 거절한다** (FR-SRCH-004 AC-2와 같은 규칙)`, () => {
    const outcome = classifyAnchor('a3f9c2');
    expect(outcome.kind).toBe('invalid');
    // 몇 자가 필요한지 사유에 담겨야 화면이 "7자 이상"을 만들 수 있다.
    if (outcome.kind === 'invalid') expect(outcome.reason).toContain('7');
  });

  it('40자를 넘으면 거절한다', () => {
    expect(classifyAnchor(`${SHA40}ab`).kind).toBe('invalid');
  });
});

describe('classifyAnchor 시각 (AC-4)', () => {
  it('ISO 8601 시각을 시각으로 읽는다', () => {
    expect(classifyAnchor('2026-08-12T20:00:00Z')).toEqual({
      kind: 'time',
      instant: '2026-08-12T20:00:00.000Z',
    });
  });

  it('날짜만 있어도 시각이다', () => {
    expect(classifyAnchor('2026-08-12').kind).toBe('time');
  });

  it('**연도만으로는 시각이 아니다** — 태그 이름과 겹친다', () => {
    // `2026`이 시각이 되면 `2026`이라는 이름의 릴리스 태그를 영영 쓸 수 없다.
    expect(classifyAnchor('2026').kind).toBe('ambiguous');
  });

  it('날짜 모양이지만 실재하지 않는 날은 거절한다', () => {
    expect(classifyAnchor('2026-13-45').kind).toBe('invalid');
  });
});

describe('classifyAnchor 릴리스 태그 (AC-1)', () => {
  it('앞의 넷에 걸리지 않은 문자열은 태그다', () => {
    expect(classifyAnchor('build-20260812-03')).toEqual({ kind: 'release', tag: 'build-20260812-03' });
  });

  it('`v1.2.0`처럼 흔한 태그 형태도 태그다', () => {
    expect(classifyAnchor('v1.2.0')).toEqual({ kind: 'release', tag: 'v1.2.0' });
  });
});

describe('classifyAnchor 모호한 입력', () => {
  it('**맨 숫자는 어느 쪽으로도 읽지 않는다**', () => {
    /*
     * 이것이 이 파일의 핵심 단언이다. `1234`를 PR로 읽으면 서수를 뜻한 사용자가
     * 다른 구간을 받고, 서수로 읽으면 그 반대다. 어느 쪽이든 **오류가 나지 않으므로
     * 사용자는 틀린 줄 모른다.**
     */
    const outcome = classifyAnchor('1234');
    expect(outcome.kind).toBe('ambiguous');
    if (outcome.kind === 'ambiguous') {
      expect(outcome.candidates.some((c) => c.includes('#1234'))).toBe(true);
      expect(outcome.candidates.some((c) => c.includes('seq:1234'))).toBe(true);
    }
  });

  it('7자리 이상 숫자는 SHA 접두 후보까지 셋이다', () => {
    const outcome = classifyAnchor('1234567');
    expect(outcome.kind).toBe('ambiguous');
    if (outcome.kind === 'ambiguous') expect(outcome.candidates).toHaveLength(3);
  });

  it('6자리 숫자는 SHA 후보가 없어 둘이다 — 7자 미만은 SHA가 아니다', () => {
    const outcome = classifyAnchor('123456');
    expect(outcome.kind).toBe('ambiguous');
    if (outcome.kind === 'ambiguous') expect(outcome.candidates).toHaveLength(2);
  });

  it('**숫자 판정이 hex 판정보다 먼저다**', () => {
    // 뒤에 두면 `1234567`이 조용히 SHA 접두가 되고 PR #1234567은 사라진다.
    expect(classifyAnchor('1234567').kind).not.toBe('commit');
  });
});

describe('classifyAnchor 잡다한 입력', () => {
  it('빈 문자열은 거절한다', () => {
    expect(classifyAnchor('   ').kind).toBe('invalid');
  });

  it('양끝 공백을 지운다', () => {
    expect(classifyAnchor('  #12  ')).toEqual({ kind: 'pull_request', number: 12 });
  });
});

describe('boundaryOf (FR-SEQ-002 AC-1)', () => {
  it('**경계는 표현이 아니라 위치가 정한다**', () => {
    /*
     * 반개구간 `(from, to]`가 `git log A..B`와 같은 뜻이려면 시작은 늘 열려 있고
     * 끝은 늘 닫혀 있어야 한다. 앵커가 태그든 SHA든 이 규칙은 달라지지 않는다.
     */
    expect(boundaryOf('from')).toBe('exclusive');
    expect(boundaryOf('to')).toBe('inclusive');
  });
});
