/**
 * W-001 상태 판정 (WP-016 DoD / 상태 매트릭스 W-001).
 *
 * DoD가 "상태 매트릭스의 **모든 상태**에 대응하는 시험"을 요구한다. 상태
 * 판정이 순수 함수라 여기서 13종 전부를 직접 건다 — 렌더링을 거치지 않으므로
 * 조합이 늘어도 시험이 느려지지 않는다.
 */

import { describe, expect, it } from 'vitest';
import { QueryParseError } from '@prs/query';
import { isTooShortShaPrefix, resolveScreenState, type SearchStateInput } from './search-state';

const BASE: SearchStateInput = {
  rawQuery: 'repo:acme/payments',
  parseError: null,
  loading: false,
  networkFailed: false,
  errorBody: null,
  status: 200,
  itemCount: 3,
  candidateCount: null,
  candidatesTruncated: false,
  loginPath: '/auth/login',
};

const state = (over: Partial<SearchStateInput>) => resolveScreenState({ ...BASE, ...over });

describe('7자 미만 hex 사전 판정 (FR-SRCH-004 AC-2)', () => {
  it('6자 hex는 너무 짧다', () => {
    expect(isTooShortShaPrefix('a1b2c3')).toBe(true);
  });

  it('7자 hex는 통과한다 — 하한이 7이다 (ADR-012)', () => {
    expect(isTooShortShaPrefix('a1b2c3d')).toBe(false);
  });

  it('경계를 정확히 본다', () => {
    expect(isTooShortShaPrefix('abcdef')).toBe(true);
    expect(isTooShortShaPrefix('abcdef0')).toBe(false);
  });

  it('hex가 아니면 SHA 후보가 아니다 — 짧아도 통과시킨다', () => {
    // `bug`는 3자지만 전문 검색어다. 이것을 막으면 짧은 단어를 못 찾는다.
    expect(isTooShortShaPrefix('bug')).toBe(false);
    expect(isTooShortShaPrefix('a1b2z3')).toBe(false);
  });

  it('대문자 hex도 hex다 (AC-4: 대소문자 구분 없음)', () => {
    expect(isTooShortShaPrefix('A1B2C3')).toBe(true);
  });

  it('빈 문자열은 짧은 SHA가 아니다 — 그것은 `empty_no_query`다', () => {
    expect(isTooShortShaPrefix('')).toBe(false);
    expect(isTooShortShaPrefix('   ')).toBe(false);
  });

  it('앞뒤 공백을 무시한다 — 붙여넣기에 딸려 온다', () => {
    expect(isTooShortShaPrefix('  a1b2c3  ')).toBe(true);
  });
});

describe('상태 매트릭스 13종', () => {
  it('`empty_no_query` — 질의가 없다', () => {
    expect(state({ rawQuery: '' }).kind).toBe('empty_no_query');
    expect(state({ rawQuery: '   ' }).kind).toBe('empty_no_query');
  });

  it('`error_prefix_too_short` — **서버를 부르기 전에** 정해진다', () => {
    // 조회를 아예 하지 않았으므로 `itemCount`가 null이어도 이 상태다.
    const result = state({ rawQuery: 'a1b2c3', itemCount: null });
    expect(result.kind).toBe('error_prefix_too_short');
    if (result.kind === 'error_prefix_too_short') expect(result.input).toBe('a1b2c3');
  });

  it('`error_query_syntax` — 클라이언트 파서가 먼저 잡는다', () => {
    const error = new QueryParseError('QUERY_SYNTAX_ERROR', '지원하지 않는 키', {
      token: 'assignee:kim',
      offset_start: 0,
      offset_end: 12,
    });
    const result = state({ parseError: error });
    expect(result.kind).toBe('error_query_syntax');
    if (result.kind === 'error_query_syntax') expect(result.error.detail.offset_start).toBe(0);
  });

  it('`loading_initial` — 조회 중', () => {
    expect(state({ loading: true }).kind).toBe('loading_initial');
  });

  it('**로딩이 직전 결과를 이긴다** — 옛 결과를 새 질의의 답으로 보이지 않게', () => {
    expect(state({ loading: true, itemCount: 42 }).kind).toBe('loading_initial');
  });

  it('`ambiguous` — 후보 2건 이상이면 자동 이동하지 않는다 (AC-5)', () => {
    const result = state({ candidateCount: 2, itemCount: null });
    expect(result.kind).toBe('ambiguous');
  });

  it('후보 1건은 모호하지 않다 — 상위 화면이 이동을 결정한다', () => {
    expect(state({ candidateCount: 1, itemCount: 0 }).kind).not.toBe('ambiguous');
  });

  it('`ambiguous`가 절삭 여부를 나른다 (QA-W001-06)', () => {
    const result = state({ candidateCount: 50, candidatesTruncated: true });
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.truncated).toBe(true);
  });

  it('`ready` — 결과 1건 이상', () => {
    expect(state({ itemCount: 1 }).kind).toBe('ready');
  });

  it('`empty_no_result` — 0건', () => {
    expect(state({ itemCount: 0 }).kind).toBe('empty_no_result');
  });

  it('`error_search_timeout` — 504', () => {
    expect(
      state({ status: 504, errorBody: { error: { code: 'SEARCH_TIMEOUT', message: 'x' } } }).kind,
    ).toBe('error_search_timeout');
  });

  it('`no_permission` — 볼 수 있는 저장소가 없다', () => {
    expect(
      state({ status: 503, errorBody: { error: { code: 'NO_ACCESSIBLE_REPOSITORY', message: 'x' } } })
        .kind,
    ).toBe('no_permission');
  });

  it('`auth_expired` — 401과 재인증 경로', () => {
    const result = state({
      status: 401,
      errorBody: {
        error: { code: 'UNAUTHENTICATED', message: 'x', detail: { login_path: '/auth/login?x=1' } },
      },
    });
    expect(result.kind).toBe('auth_expired');
    if (result.kind === 'auth_expired') expect(result.loginPath).toBe('/auth/login?x=1');
  });

  it('`auth_expired`에 힌트가 없으면 기본 로그인 경로를 쓴다', () => {
    const result = state({ status: 401, errorBody: { error: { code: 'UNAUTHENTICATED', message: 'x' } } });
    if (result.kind === 'auth_expired') expect(result.loginPath).toBe('/auth/login');
    else throw new Error('auth_expired여야 한다');
  });

  it('`offline` — 네트워크 자체가 실패', () => {
    expect(state({ networkFailed: true }).kind).toBe('offline');
  });

  it('`error_other` — 그 밖의 서버 오류는 코드와 문구를 그대로 나른다', () => {
    const result = state({ status: 500, errorBody: { error: { code: 'INTERNAL', message: '내부 오류' } } });
    expect(result.kind).toBe('error_other');
    if (result.kind === 'error_other') {
      expect(result.code).toBe('INTERNAL');
      // 화면이 문구를 다시 쓰지 않는다 — 서버가 정한 것을 보여 준다.
      expect(result.message).toBe('내부 오류');
    }
  });
});

describe('우선순위', () => {
  it('**클라이언트 거절이 서버 결과를 이긴다** — 부르지 않았어야 할 조회다', () => {
    expect(state({ rawQuery: 'a1b2c3', itemCount: 10 }).kind).toBe('error_prefix_too_short');
  });

  it('짧은 hex 판정이 문법 오류보다 먼저다', () => {
    const error = new QueryParseError('QUERY_SYNTAX_ERROR', 'x', {
      token: 'x', offset_start: 0, offset_end: 1,
    });
    expect(state({ rawQuery: 'abc123', parseError: error }).kind).toBe('error_prefix_too_short');
  });

  it('**오류가 0건을 이긴다** — 실패를 "결과 없음"으로 감추지 않는다', () => {
    const result = state({
      itemCount: 0,
      status: 503,
      errorBody: { error: { code: 'PERMISSION_UNAVAILABLE', message: 'x' } },
    });
    expect(result.kind).toBe('no_permission');
  });

  it('오류가 모호성보다 먼저다', () => {
    expect(
      state({
        candidateCount: 5,
        status: 401,
        errorBody: { error: { code: 'UNAUTHENTICATED', message: 'x' } },
      }).kind,
    ).toBe('auth_expired');
  });

  it('네트워크 실패가 서버 오류 본문보다 먼저다 — 본문이 남아 있을 수 있다', () => {
    expect(
      state({ networkFailed: true, errorBody: { error: { code: 'INTERNAL', message: 'x' } } }).kind,
    ).toBe('offline');
  });

  it('조회 전(`itemCount: null`)이면 로딩으로 본다 — 0건으로 그리지 않는다', () => {
    expect(state({ itemCount: null, loading: false }).kind).toBe('loading_initial');
  });
});
