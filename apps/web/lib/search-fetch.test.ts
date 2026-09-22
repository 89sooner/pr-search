/**
 * 조회 경로 선택 (WP-016 / FLOW-001).
 *
 * "어떤 입력이 해석으로 가고 어떤 것이 목록 조회로 가는가"가 이 화면의
 * 분기 전부다. `fetch` 없이 건다.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, type QueryState } from './query-url';
import { RESOLVE_LIMIT, chooseRoute, resolveUrl, searchUrl } from './search-fetch';

const q = (value: string): QueryState => ({ ...EMPTY_STATE, q: value });
const GHE = 'https://ghe.acme.example';

describe('식별자는 해석으로 (FLOW-001)', () => {
  it('40자 SHA (QA-W001-01)', () => {
    expect(chooseRoute(q('a'.repeat(40))).kind).toBe('resolve');
  });

  it('7자 접두 (QA-W001-03)', () => {
    expect(chooseRoute(q('a1b2c3d')).kind).toBe('resolve');
  });

  it('`#1234` (QA-W001-02)', () => {
    expect(chooseRoute(q('#1234')).kind).toBe('resolve');
  });

  it('`owner/repo#1234`', () => {
    expect(chooseRoute(q('acme/payments#1234')).kind).toBe('resolve');
  });

  it('GHE PR URL — 호스트가 맞을 때만', () => {
    expect(chooseRoute(q(`${GHE}/acme/payments/pull/1234`), GHE).kind).toBe('resolve');
  });

  it('**다른 호스트의 URL은 해석하지 않는다** (DEV-064)', () => {
    // 호스트를 안 보면 남의 저장소 URL이 우리 PR로 해석된다.
    expect(chooseRoute(q('https://evil.example/acme/payments/pull/1234'), GHE).kind).toBe('search');
  });

  it('순수 정수도 해석으로 간다 — PR 번호와 SHA 접두가 겹친다 (DEV-066)', () => {
    expect(chooseRoute(q('1234567')).kind).toBe('resolve');
  });

  it('M 번호 문자열도 해석으로 간다 (CR-114, FR-SRCH-001 AC-7)', () => {
    expect(chooseRoute(q('M-1900-1450'))).toEqual({ kind: 'resolve', input: 'M-1900-1450' });
    expect(chooseRoute(q('[M-1900-1450]')).kind).toBe('resolve');
  });

  it('M 번호 모양이 아닌 `M-` 문자열은 검색어다', () => {
    expect(chooseRoute(q('M-1900')).kind).toBe('search');
    expect(chooseRoute(q('M-1900-0')).kind).toBe('search');
  });

  it('해석 경로가 원본 입력을 그대로 나른다', () => {
    const route = chooseRoute(q('  #1234  '));
    expect(route.kind).toBe('resolve');
    if (route.kind === 'resolve') expect(route.input).toBe('#1234');
  });
});

describe('질의는 목록 조회로', () => {
  it('구조화 질의', () => {
    expect(chooseRoute(q('repo:acme/payments author:kim')).kind).toBe('search');
  });

  it('**키가 있으면 식별자처럼 보여도 질의다**', () => {
    // `repo:a/b 1234`는 "그 저장소에서 1234"이지 PR 번호 해석이 아니다.
    expect(chooseRoute(q('repo:acme/a 1234')).kind).toBe('search');
  });

  it('부정 조건도 질의다 (AC-6)', () => {
    expect(chooseRoute(q('-author:kim')).kind).toBe('search');
  });

  it('범위도 질의다 (AC-2)', () => {
    expect(chooseRoute(q('seq:1200..1350')).kind).toBe('search');
  });

  it('자유 텍스트', () => {
    expect(chooseRoute(q('결제 재시도')).kind).toBe('search');
  });

  it('hex가 아닌 짧은 단어 — 검색어이지 SHA가 아니다', () => {
    expect(chooseRoute(q('bug')).kind).toBe('search');
  });
});

describe('부르지 않는 경우', () => {
  it('빈 질의', () => {
    expect(chooseRoute(q('')).kind).toBe('none');
    expect(chooseRoute(q('   ')).kind).toBe('none');
  });

  it('**7자 미만 hex는 아무 API도 부르지 않는다** (QA-W001-04)', () => {
    // 화면이 이미 막지만 여기서도 막는다 — 두 겹이어야 왕복이 정말 없다.
    expect(chooseRoute(q('a1b2c3')).kind).toBe('none');
  });
});

describe('URL 조립', () => {
  it('목록 조회에 질의를 싣는다', () => {
    expect(searchUrl(q('repo:acme/a'))).toBe('/api/search?q=repo%3Aacme%2Fa');
  });

  it('정렬·순서·크기를 싣는다', () => {
    const url = searchUrl({ ...q('x'), sort: 'merged_at', order: 'asc', size: 50 });
    expect(url).toContain('sort=merged_at');
    expect(url).toContain('order=asc');
    expect(url).toContain('size=50');
  });

  it('비어 있는 값은 키째 뺀다 — 같은 조건이 같은 URL이어야 한다', () => {
    expect(searchUrl(q('x'))).toBe('/api/search?q=x');
  });

  it('**해석은 `limit=50`을 명시한다** (CR-019, DEV-080)', () => {
    /*
     * 기본값 10으로 부르면 11건에서 절삭 표시가 떠 FR-SRCH-004 AC-3이
     * 정한 50 경계와 어긋난다. QA-W001-06이 그 경계를 건다.
     */
    expect(RESOLVE_LIMIT).toBe(50);
    expect(resolveUrl('a1b2c3d')).toBe('/api/resolve?q=a1b2c3d&limit=50');
  });

  it('해석 입력을 인코딩한다 — `#`이 조각 구분자로 새면 안 된다', () => {
    expect(resolveUrl('acme/a#12')).toBe('/api/resolve?q=acme%2Fa%2312&limit=50');
  });
});
