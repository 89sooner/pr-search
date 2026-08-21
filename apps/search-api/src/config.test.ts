import { describe, expect, it } from 'vitest';
import { auditUserId, parseAdminTokens, resolveSearchApiConfig } from './config.js';

describe('관리 토큰 파싱 (CR-013, DEV-030)', () => {
  it('이름과 토큰을 갈라 읽는다', () => {
    expect(parseAdminTokens({ ADMIN_API_TOKENS: 'alice:tok1,bob:tok2' })).toEqual([
      { name: 'alice', token: 'tok1' },
      { name: 'bob', token: 'tok2' },
    ]);
  });

  it('공백을 다듬는다', () => {
    expect(parseAdminTokens({ ADMIN_API_TOKENS: ' alice : tok1 , bob:tok2 ' })).toEqual([
      { name: 'alice', token: 'tok1' },
      { name: 'bob', token: 'tok2' },
    ]);
  });

  it('구분자 없는 항목도 받는다 — 이름은 unnamed다', () => {
    // 구분자를 빠뜨렸다고 토큰을 통째로 버리면 배포가 조용히 인증 불가가 된다.
    expect(parseAdminTokens({ ADMIN_API_TOKENS: 'justatoken' })).toEqual([
      { name: 'unnamed', token: 'justatoken' },
    ]);
  });

  it('WP-009의 단일 토큰도 계속 동작한다', () => {
    expect(parseAdminTokens({ ADMIN_API_TOKEN: 'legacy' })).toEqual([{ name: 'unnamed', token: 'legacy' }]);
  });

  it('같은 토큰이 두 번 오면 처음 이름만 남는다', () => {
    expect(parseAdminTokens({ ADMIN_API_TOKENS: 'alice:dup,bob:dup' })).toEqual([
      { name: 'alice', token: 'dup' },
    ]);
  });

  it('빈 항목과 토큰 없는 항목은 버리고, 이름 없는 항목은 unnamed로 받는다', () => {
    // `alice:`는 토큰이 없으니 버린다. `:tok`은 이름만 없으니 살린다 —
    // 구분자를 토큰에 남기면 그 토큰으로는 영영 인증되지 않는다.
    expect(parseAdminTokens({ ADMIN_API_TOKENS: ',,alice:,:tok,', ADMIN_API_TOKEN: '' })).toEqual([
      { name: 'unnamed', token: 'tok' },
    ]);
  });

  it('토큰이 하나도 없으면 빈 목록이다', () => {
    expect(parseAdminTokens({})).toEqual([]);
  });
});

describe('설정 해석', () => {
  it('지표 저장소 주소가 없으면 null이다', () => {
    expect(resolveSearchApiConfig({}).metricsQueryUrl).toBeNull();
    expect(resolveSearchApiConfig({ METRICS_QUERY_URL: '  ' }).metricsQueryUrl).toBeNull();
  });

  it('감사 주체에 접두를 붙여 사람 계정과 섞이지 않게 한다', () => {
    expect(auditUserId({ name: 'alice', token: 'x' })).toBe('admin:alice');
    expect(auditUserId({ name: 'unnamed', token: 'x' })).toBe('admin:unnamed');
  });
});
