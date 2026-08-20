/** 비밀 값 가림 (THR-009, NFR-010, WP-006 DoD 5). */

import { describe, expect, it } from 'vitest';
import { REDACTED, redact, safeMessage } from './redact.js';
import { GitHubApiError } from './errors.js';

describe('THR-009: 토큰 형태를 가린다', () => {
  it('설치 토큰(ghs_)을 가린다', () => {
    const token = `ghs_${'a'.repeat(36)}`;
    expect(redact(`요청 실패: ${token}`)).not.toContain(token);
    expect(redact(`요청 실패: ${token}`)).toContain(REDACTED);
  });

  it('개인 액세스 토큰 계열을 가린다', () => {
    for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghr_']) {
      const token = `${prefix}${'b'.repeat(36)}`;
      expect(redact(token)).not.toContain(token);
    }
    const fine = `github_pat_${'c'.repeat(30)}`;
    expect(redact(fine)).not.toContain(fine);
  });

  it('Authorization 헤더 값을 가린다', () => {
    const line = 'headers: { authorization: "Bearer supersecretvalue123456" }';
    const out = redact(line);
    expect(out).not.toContain('supersecretvalue123456');
    expect(out).toContain(REDACTED);
  });

  it('App JWT를 가린다', () => {
    const jwt = `eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiIxMjMifQ.${'d'.repeat(40)}`;
    expect(redact(`jwt=${jwt}`)).not.toContain(jwt);
  });

  it('PEM 개인 키 블록을 통째로 가린다', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----';
    const out = redact(`key: ${pem}`);
    expect(out).not.toContain('MIIEow');
    expect(out).toContain(REDACTED);
  });

  it('평범한 문자열은 건드리지 않는다', () => {
    expect(redact('acme/payments#1234 머지됨')).toBe('acme/payments#1234 머지됨');
  });
});

describe('오류를 그대로 문자열로 만들지 않는다', () => {
  it('safeMessage가 Error 안의 토큰을 가린다', () => {
    const token = `ghs_${'e'.repeat(36)}`;
    expect(safeMessage(new Error(`fetch failed: authorization: Bearer ${token}`))).not.toContain(token);
  });

  it('safeMessage가 객체 안의 토큰도 가린다', () => {
    const token = `ghs_${'f'.repeat(36)}`;
    expect(safeMessage({ headers: { authorization: `Bearer ${token}` } })).not.toContain(token);
  });

  it('GitHubApiError는 생성 시점에 이미 가려진 메시지를 갖는다', () => {
    const token = `ghs_${'g'.repeat(36)}`;
    const error = new GitHubApiError('auth', `실패: ${token}`);
    expect(error.message).not.toContain(token);
    expect(String(error)).not.toContain(token);
    expect(JSON.stringify({ message: error.message })).not.toContain(token);
  });

  it('직렬화할 수 없는 값도 던지지 않는다', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => safeMessage(circular)).not.toThrow();
  });
});
