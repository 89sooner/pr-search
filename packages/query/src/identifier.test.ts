/**
 * 식별자 판별 (WP-014 / FR-SRCH-001, FR-SRCH-004).
 *
 * QA-W001-01~04가 여기서 걸린다. 특히 QA-W001-04("6자 이하 hex가 **서버 호출
 * 없이** 거부된다")는 이 코드가 브라우저에서도 도는 순수 함수여야 성립한다 —
 * 그래서 판별기는 아무것도 던지지 않고 `rejection`을 값으로 돌려준다.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_SHA_PREFIX_LENGTH,
  detectIdentifier,
  primaryKind,
  type Identifier,
} from './identifier.js';

const GHE = 'https://ghe.acme.example';
const SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';

function kinds(input: string, gheBaseUrl: string | undefined = GHE): string[] {
  return detectIdentifier(input, { gheBaseUrl }).interpretations.map((one) => one.kind);
}

function first(input: string, gheBaseUrl: string | undefined = GHE): Identifier {
  const [one] = detectIdentifier(input, { gheBaseUrl }).interpretations;
  if (one === undefined) throw new Error('해석이 비었다');
  return one;
}

describe('QA-W001-01: 40자 SHA (FR-SRCH-001 AC-1)', () => {
  it('정확 일치 커밋으로 읽는다', () => {
    expect(first(SHA)).toEqual({ kind: 'commit', match: 'exact', sha: SHA });
  });

  it('대문자도 같은 커밋이다 (FR-SRCH-004 AC-4)', () => {
    expect(first(SHA.toUpperCase())).toEqual({ kind: 'commit', match: 'exact', sha: SHA });
  });

  it('양끝 공백을 무시한다', () => {
    expect(first(`  ${SHA}  `)).toEqual({ kind: 'commit', match: 'exact', sha: SHA });
  });

  it('41자는 커밋이 아니다', () => {
    expect(kinds(`${SHA}a`)).toEqual(['text']);
  });

  it('hex가 아닌 40자는 커밋이 아니다', () => {
    expect(kinds('z'.repeat(40))).toEqual(['text']);
  });
});

describe('QA-W001-02: PR 참조 (FR-SRCH-001 AC-2, AC-3)', () => {
  it('`#1234`는 저장소 미확정 PR이다', () => {
    expect(first('#1234')).toEqual({ kind: 'pull_request', repository: null, number: 1234 });
  });

  it('`owner/repo#1234`는 저장소가 확정된 PR이다', () => {
    expect(first('acme/payments#1234')).toEqual({
      kind: 'pull_request',
      repository: 'acme/payments',
      number: 1234,
    });
  });

  it('GHE PR URL은 저장소까지 확정한다', () => {
    expect(first(`${GHE}/acme/payments/pull/1234`)).toEqual({
      kind: 'pull_request',
      repository: 'acme/payments',
      number: 1234,
    });
  });

  it('GHE 커밋 URL은 커밋이다', () => {
    expect(first(`${GHE}/acme/payments/commit/${SHA}`)).toEqual({
      kind: 'commit',
      match: 'exact',
      sha: SHA,
    });
  });

  it('URL 뒤에 무엇이 붙어도 앞의 네 마디로 읽는다', () => {
    expect(first(`${GHE}/acme/payments/pull/1234/files`)).toEqual({
      kind: 'pull_request',
      repository: 'acme/payments',
      number: 1234,
    });
  });

  it('PR 번호 0과 음수는 PR이 아니다', () => {
    expect(kinds('#0')).toEqual(['text']);
    expect(kinds('acme/payments#0')).toEqual(['text']);
  });
});

describe('DEV-064: 호스트가 다르면 우리 것이 아니다', () => {
  it('다른 호스트의 같은 경로는 `text`다', () => {
    // 접근 범위가 데이터를 막아 주더라도 엉뚱한 저장소로 해석하는 것 자체가 오답이다.
    expect(kinds('https://other.example/acme/payments/pull/1234')).toEqual(['text']);
  });

  it('github.com URL도 우리 것이 아니다', () => {
    expect(kinds('https://github.com/acme/payments/pull/1234')).toEqual(['text']);
  });

  it('호스트 비교는 대소문자를 구분하지 않는다', () => {
    expect(first('https://GHE.ACME.EXAMPLE/acme/payments/pull/7')).toMatchObject({
      kind: 'pull_request',
      number: 7,
    });
  });

  it('기준 URL이 설정되지 않으면 URL 해석을 아예 하지 않는다', () => {
    // 무엇이 우리 호스트인지 모르는 채로 경로를 파싱하면 아무 URL이나 우리 것이 된다.
    // `kinds` 헬퍼는 기본값이 있어 `undefined`를 삼키므로 여기서는 직접 부른다.
    const url = `${GHE}/acme/payments/pull/1234`;
    expect(detectIdentifier(url, {}).interpretations).toEqual([{ kind: 'text' }]);
    expect(detectIdentifier(url).interpretations).toEqual([{ kind: 'text' }]);
    expect(detectIdentifier(url, { gheBaseUrl: '' }).interpretations).toEqual([{ kind: 'text' }]);
  });

  it('경로가 모자라면 `text`다', () => {
    expect(kinds(`${GHE}/acme/payments`)).toEqual(['text']);
    expect(kinds(`${GHE}/`)).toEqual(['text']);
  });

  it('모르는 리소스 종류는 `text`다', () => {
    expect(kinds(`${GHE}/acme/payments/issues/1234`)).toEqual(['text']);
  });
});

describe('QA-W001-03: 축약 SHA (FR-SRCH-004 AC-1)', () => {
  it('7자는 접두 검색이다', () => {
    expect(first('a3f9c21')).toEqual({ kind: 'commit', match: 'prefix', sha: 'a3f9c21' });
  });

  it('39자까지 접두다', () => {
    const prefix = SHA.slice(0, 39);
    expect(first(prefix)).toEqual({ kind: 'commit', match: 'prefix', sha: prefix });
  });

  it('대소문자를 구분하지 않는다 (AC-4)', () => {
    expect(first('A3F9C21')).toEqual({ kind: 'commit', match: 'prefix', sha: 'a3f9c21' });
  });

  it('하한이 ADR-012의 7자다', () => {
    expect(MIN_SHA_PREFIX_LENGTH).toBe(7);
  });
});

describe('QA-W001-04: 7자 미만은 서버를 부르지 않고 거절한다 (FR-SRCH-004 AC-2)', () => {
  it('6자 hex를 거절 사유와 함께 돌려준다', () => {
    const detection = detectIdentifier('a3f9c2', { gheBaseUrl: GHE });

    expect(detection.rejection).toEqual({
      code: 'SHA_PREFIX_TOO_SHORT',
      message: '축약 SHA는 7자 이상이어야 합니다',
      min_length: 7,
      actual_length: 6,
    });
  });

  it('던지지 않는다 — 화면이 그대로 표시해야 한다', () => {
    expect(() => detectIdentifier('abcdef', { gheBaseUrl: GHE })).not.toThrow();
  });

  it('거절된 입력은 조회 해석을 남기지 않는다', () => {
    // `text`로 두면 전문 검색이 돌아 400을 내야 할 요청이 200이 된다.
    expect(detectIdentifier('abcdef', { gheBaseUrl: GHE }).interpretations).toEqual([{ kind: 'text' }]);
  });

  it('짧은 **숫자**는 거절하지 않는다 — 이미 PR 번호로 읽혔다', () => {
    // PR #123을 "7자 미만 SHA"라고 거절하면 안 된다.
    const detection = detectIdentifier('123', { gheBaseUrl: GHE });
    expect(detection.rejection).toBeNull();
    expect(detection.interpretations).toEqual([
      { kind: 'pull_request', repository: null, number: 123 },
    ]);
  });

  it('`#123`도 거절하지 않는다', () => {
    expect(detectIdentifier('#123', { gheBaseUrl: GHE }).rejection).toBeNull();
  });

  it('hex가 아닌 짧은 문자열은 거절이 아니라 `text`다', () => {
    const detection = detectIdentifier('fix', { gheBaseUrl: GHE });
    expect(detection.rejection).toBeNull();
    expect(detection.interpretations).toEqual([{ kind: 'text' }]);
  });
});

describe('DEV-066: 순수 정수는 PR이면서 SHA 접두다', () => {
  it('7자리 숫자는 해석이 둘이다', () => {
    expect(kinds('1234567')).toEqual(['pull_request', 'commit']);
  });

  it('PR 해석이 먼저다 — 해석 순서 3단계가 5단계보다 앞이다', () => {
    expect(first('1234567')).toEqual({ kind: 'pull_request', repository: null, number: 1234567 });
  });

  it('커밋 해석도 살아 있다 — 순서를 문자 그대로 읽어 막지 않는다', () => {
    const [, second] = detectIdentifier('1234567', { gheBaseUrl: GHE }).interpretations;
    expect(second).toEqual({ kind: 'commit', match: 'prefix', sha: '1234567' });
  });

  it('40자리 숫자는 PR이 아니라 커밋이다', () => {
    // PR 번호 상한을 넘는다. 이것이 없으면 40자리 숫자가 PR 번호가 된다.
    expect(kinds('1'.repeat(40))).toEqual(['commit']);
    expect(first('1'.repeat(40))).toEqual({ kind: 'commit', match: 'exact', sha: '1'.repeat(40) });
  });

  it('6자리 숫자는 PR 하나다 — SHA로는 너무 짧다', () => {
    expect(kinds('123456')).toEqual(['pull_request']);
  });

  it('`#1234567`은 PR 하나다 — `#`가 뜻을 확정한다', () => {
    expect(kinds('#1234567')).toEqual(['pull_request']);
  });

  it('16진수지만 숫자가 아니면 커밋 하나다', () => {
    expect(kinds('a3f9c21')).toEqual(['commit']);
  });
});

describe('FR-SRCH-001 AC-4: 나머지는 `text`다', () => {
  it.each([
    ['자유 문자열', 'payment retry'],
    ['구조화 질의', 'repo:acme/payments author:kim'],
    ['빈 문자열', ''],
    ['공백만', '   '],
    ['hex 아닌 긴 문자열', 'zzzzzzzzzz'],
  ])('%s', (_label, input) => {
    expect(kinds(input)).toEqual(['text']);
  });

  it('DEV-065: 태그처럼 보여도 릴리스로 읽지 않는다', () => {
    // 태그 패턴이 어디에도 정의되어 있지 않다. 추측해 넣으면 전문 검색으로
    // 가야 할 질의가 0건이 된다. WP-024가 패턴을 정의한다.
    expect(kinds('v1.2.0')).toEqual(['text']);
    expect(kinds('build-20260819-02')).toEqual(['text']);
  });
});

describe('해석 목록은 비지 않는다', () => {
  it.each([['', ''], ['숫자', '42'], ['SHA', SHA], ['텍스트', 'hello'], ['거절', 'abc123']])(
    '%s',
    (_label, input) => {
      expect(detectIdentifier(input, { gheBaseUrl: GHE }).interpretations.length).toBeGreaterThan(0);
    },
  );

  it('`primaryKind`가 우선순위 1위를 준다', () => {
    expect(primaryKind(detectIdentifier('1234567', { gheBaseUrl: GHE }))).toBe('pull_request');
    expect(primaryKind(detectIdentifier(SHA, { gheBaseUrl: GHE }))).toBe('commit');
    expect(primaryKind(detectIdentifier('hello', { gheBaseUrl: GHE }))).toBe('text');
  });
});
