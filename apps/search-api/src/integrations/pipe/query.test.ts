/**
 * 연동 경로의 엄격한 입력 해석 (CR-112 / PSI-F03~F05).
 */

import { describe, expect, it } from 'vitest';
import { PsiError } from './errors.js';
import { parseStrictQuery, strictPlainParam, strictRepositoryParam } from './query.js';

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PsiError);
    expect((error as PsiError).code).toBe('INVALID_REQUEST');
    return (error as PsiError).reason;
  }
  throw new Error('거절되어야 할 입력이 통과했다');
}

const SEARCH = ['q', 'sort', 'order', 'size', 'cursor', 'facets', 'seq_epoch'];

describe('parseStrictQuery', () => {
  it('허용된 key를 한 번씩 문자열로 준다 — 빈 값의 뜻은 원본 실행 함수가 정한다', () => {
    expect(parseStrictQuery('/x?q=repo%3A%22acme%2Fapp%22+is%3Aopen&size=50&facets=true&cursor=', SEARCH)).toEqual({
      q: 'repo:"acme/app" is:open',
      size: '50',
      facets: 'true',
      cursor: '',
    });
    expect(parseStrictQuery('/x', SEARCH)).toEqual({});
    expect(parseStrictQuery('/x?', SEARCH)).toEqual({});
  });

  it('`+`는 Fastify 기본 해석과 같게 공백이다', () => {
    expect(parseStrictQuery('/x?q=a+b', SEARCH)).toEqual({ q: 'a b' });
    expect(parseStrictQuery('/x?q=a%2Bb', SEARCH)).toEqual({ q: 'a+b' });
  });

  it('같은 key가 두 번 오면 거절한다 — 기존 라우트는 배열을 빈 질의로 읽는다 (PSI-F05)', () => {
    expect(reasonOf(() => parseStrictQuery('/x?q=a&q=b', SEARCH))).toBe('query_duplicate_parameter');
    expect(reasonOf(() => parseStrictQuery('/x?size=1&size=1', SEARCH))).toBe('query_duplicate_parameter');
  });

  it('목록에 없는 key를 거절한다', () => {
    expect(reasonOf(() => parseStrictQuery('/x?q=a&url=https://evil', SEARCH))).toBe('query_unknown_parameter');
    expect(reasonOf(() => parseStrictQuery('/x?page=2', ['ref', 'path']))).toBe('query_unknown_parameter');
  });

  it('깨진 percent-encoding과 UTF-8이 아닌 바이트를 거절한다 (PSI-F04)', () => {
    expect(reasonOf(() => parseStrictQuery('/x?q=%E0%A4%A', SEARCH))).toBe('query_malformed_encoding');
    expect(reasonOf(() => parseStrictQuery('/x?q=%ZZ', SEARCH))).toBe('query_malformed_encoding');
    expect(reasonOf(() => parseStrictQuery('/x?q=%C3%28', SEARCH))).toBe('query_malformed_encoding');
  });

  it('CR·LF·NUL 같은 제어 문자를 거절한다 (헤더 주입 재료)', () => {
    expect(reasonOf(() => parseStrictQuery('/x?q=a%0D%0ASet-Cookie:x', SEARCH))).toBe('query_control_character');
    expect(reasonOf(() => parseStrictQuery('/x?q=a%00', SEARCH))).toBe('query_control_character');
  });

  it('fragment가 든 요청 대상을 거절한다', () => {
    expect(reasonOf(() => parseStrictQuery('/x?q=a#frag', SEARCH))).toBe('fragment_in_target');
  });

  it('정당한 파일 경로·브랜치의 slash는 그대로 받는다', () => {
    expect(parseStrictQuery('/x?path=src%2Fpay%2Fretry.ts&ref=release%2F1.2', ['path', 'ref'])).toEqual({
      path: 'src/pay/retry.ts',
      ref: 'release/1.2',
    });
  });
});

describe('경로 파라미터', () => {
  it('owner/repo 하나를 받는다 (Fastify가 %2F를 한 번 푼 값)', () => {
    expect(strictRepositoryParam('acme/payments')).toBe('acme/payments');
    expect(strictRepositoryParam('acme-inc/app.v2_x')).toBe('acme-inc/app.v2_x');
  });

  it.each([
    ['이중 인코딩이 남긴 %', 'acme%2Fpayments'],
    ['slash 없음', 'acmepayments'],
    ['slash 둘', 'acme/pay/ments'],
    ['역슬래시', 'acme\\payments'],
    ['CRLF', 'acme/pay\r\nments'],
    ['빈 값', ''],
  ])('%s를 거절한다', (_label, value) => {
    expect(reasonOf(() => strictRepositoryParam(value))).toBe('path_repository_format');
  });

  it.each(['../payments', 'acme/..', './x', 'acme/.'])('dot segment %s를 거절한다', (value) => {
    expect(reasonOf(() => strictRepositoryParam(value))).toBe('path_dot_segment');
  });

  it('그 밖의 조각은 %·/·제어 문자를 거절하고 값 형식은 원본에 맡긴다', () => {
    expect(strictPlainParam('1842')).toBe('1842');
    expect(strictPlainParam('a'.repeat(40))).toBe('a'.repeat(40));
    for (const bad of ['18%42', '1/2', 'a\\b', 'x\ny', '']) {
      expect(reasonOf(() => strictPlainParam(bad))).toBe('path_segment_format');
    }
  });
});
