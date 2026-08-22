/**
 * 상세 화면 공통 상태 판정 (WP-018 / CR-021).
 *
 * WP-017이 W-002를 위해 쓴 것을 그대로 옮겼다. 판정이 공유되므로 시험도
 * 공유한다 — **404를 403처럼 다루지 않는가**가 두 화면 모두에 걸린다.
 */

import { describe, expect, it } from 'vitest';
import { resolveDetailScreenState, type DetailStateInput } from './screen-state';

describe('화면 상태', () => {
  const BASE: DetailStateInput = {
    loading: false,
    networkFailed: false,
    errorBody: null,
    status: 200,
    /*
     * **내용은 상관없다.** 이 판정은 본문이 있고 없고만 본다 — 무엇이
     * 실렸는지는 화면별 모듈(`pr-detail`·`commit-detail`)의 일이다.
     * 그래서 W-002의 PR fixture가 아니라 아무 객체나 둔다.
     */
    detail: { anything: true },
    loginPath: '/auth/login',
  };
  const state = (over: Partial<DetailStateInput>) => resolveDetailScreenState({ ...BASE, ...over });

  it('`loading_initial`', () => {
    expect(state({ loading: true }).kind).toBe('loading_initial');
  });

  it('`ready`', () => {
    expect(state({}).kind).toBe('ready');
  });

  it('**`not_found` — 접근 범위 밖도 같다** (QA-W002-18, THR-004)', () => {
    /*
     * 404가 "없다"와 "못 본다"를 함께 뜻한다. 403을 내면 "있긴 있다"가
     * 새어 나간다 — 화면도 둘을 구분해 보여 주면 안 된다.
     */
    expect(state({ status: 404, errorBody: { error: { code: 'NOT_FOUND', message: 'x' } } }).kind).toBe(
      'not_found',
    );
  });

  it('`auth_expired`가 재인증 경로를 나른다', () => {
    const result = state({
      status: 401,
      errorBody: { error: { code: 'UNAUTHENTICATED', message: 'x', detail: { login_path: '/auth/login?a=1' } } },
    });
    expect(result.kind).toBe('auth_expired');
    if (result.kind === 'auth_expired') expect(result.loginPath).toBe('/auth/login?a=1');
  });

  it('`no_permission`', () => {
    expect(
      state({ status: 503, errorBody: { error: { code: 'PERMISSION_UNAVAILABLE', message: 'x' } } }).kind,
    ).toBe('no_permission');
  });

  it('`offline`', () => {
    expect(state({ networkFailed: true }).kind).toBe('offline');
  });

  it('`error_other`가 상관 ID를 나른다 (C-005)', () => {
    const result = state({
      status: 500,
      errorBody: { error: { code: 'INTERNAL', message: '내부 오류' }, correlation_id: 'corr-1' },
    });
    expect(result.kind).toBe('error_other');
    if (result.kind === 'error_other') expect(result.correlationId).toBe('corr-1');
  });

  it('로딩이 오류보다 먼저다 — 직전 오류를 새 조회의 답으로 보이지 않게', () => {
    expect(
      state({ loading: true, status: 404, errorBody: { error: { code: 'NOT_FOUND', message: 'x' } } }).kind,
    ).toBe('loading_initial');
  });

  it('네트워크 실패가 서버 오류 본문보다 먼저다', () => {
    expect(
      state({ networkFailed: true, errorBody: { error: { code: 'INTERNAL', message: 'x' } } }).kind,
    ).toBe('offline');
  });

  it('조회 전이면 로딩으로 본다 — `not_found`로 그리지 않는다', () => {
    expect(state({ detail: null }).kind).toBe('loading_initial');
  });
});
