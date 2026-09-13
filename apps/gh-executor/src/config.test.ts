/**
 * 실행기 설정 (CR-078 규율 — 켜 놓고 비어 있으면 거부한다).
 */

import { describe, expect, it } from 'vitest';
import { executorConfigFailure, hostOfBaseUrl, resolveExecutorConfig, resolveOperationsEnabled } from './config.js';

const KEY = '0123456789abcdef'.repeat(4);

describe('GH_OPERATIONS_ENABLED', () => {
  it('true만 켠다. 빈 값·false는 꺼짐, 그 밖은 거부', () => {
    expect(resolveOperationsEnabled({})).toBe(false);
    expect(resolveOperationsEnabled({ GH_OPERATIONS_ENABLED: 'true' })).toBe(true);
    expect(resolveOperationsEnabled({ GH_OPERATIONS_ENABLED: ' false ' })).toBe(false);
    for (const bad of ['yes', 'TRUE', '1', 'on']) {
      expect(() => resolveOperationsEnabled({ GH_OPERATIONS_ENABLED: bad }), bad).toThrow();
    }
  });

  it('켜져 있는데 필수 값이 없으면 사유를 낸다', () => {
    const config = resolveExecutorConfig({ GH_OPERATIONS_ENABLED: 'true' });
    expect(executorConfigFailure(config)).toMatch(/GHE_BASE_URL, GH_IDENTITY_VAULT_KEY/);
    expect(executorConfigFailure(resolveExecutorConfig({}))).toBeNull();
  });

  it('완전한 설정은 성립하고 호스트에 포트가 남는다', () => {
    const config = resolveExecutorConfig({
      GH_OPERATIONS_ENABLED: 'true',
      GHE_BASE_URL: 'https://ghe.example.com:8443/',
      GH_IDENTITY_VAULT_KEY: KEY,
      NODE_EXTRA_CA_CERTS: '/certs/ca.crt',
    });
    expect(executorConfigFailure(config)).toBeNull();
    expect(config.host).toBe('ghe.example.com:8443');
    expect(config.caFile).toBe('/certs/ca.crt');
    expect(config.vaultKey?.keyId).toHaveLength(8);
  });

  it('동시 실행 상한은 파티션 수를 넘을 수 없다', () => {
    expect(() => resolveExecutorConfig({ GH_EXECUTOR_MAX_CONCURRENT: '99' })).toThrow(/GH_EXECUTOR_MAX_CONCURRENT/);
    expect(resolveExecutorConfig({ GH_EXECUTOR_MAX_CONCURRENT: '1' }).maxConcurrent).toBe(1);
  });

  it('GHE_BASE_URL은 절대 http(s) URL이어야 한다', () => {
    expect(hostOfBaseUrl(undefined)).toBeNull();
    expect(() => hostOfBaseUrl('ghe.example.com')).toThrow(/절대 URL/);
    expect(() => hostOfBaseUrl('ftp://ghe.example.com')).toThrow(/스킴/);
  });
});
