/**
 * 실행 환경 허용 목록 (FR-GH-002 AC-6·AC-7, FR-GH-008 AC-6·AC-7, NFR-010).
 */

import { describe, expect, it } from 'vitest';
import { GH_EXECUTION_ENV_KEYS, GH_SECRET_ENV_KEYS, buildExecutionEnv, describeExecutionEnv } from './env.js';

const input = {
  host: 'ghe.example.com',
  token: 'ghu_' + 'x'.repeat(30),
  workspace: { home: '/ws/home', configDir: '/ws/config', tmp: '/ws/tmp' },
};

describe('NFR-010: 부모 환경을 상속하지 않는다', () => {
  it('키 집합이 허용 목록의 부분집합이다 — GH_TOKEN·GITHUB_TOKEN이 없다', () => {
    const env = buildExecutionEnv(input);
    for (const key of Object.keys(env)) expect(GH_EXECUTION_ENV_KEYS).toContain(key);
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env).not.toHaveProperty('GH_REPO');
  });

  it('토큰은 GH_ENTERPRISE_TOKEN 하나에만 있다', () => {
    const env = buildExecutionEnv(input);
    const carriers = Object.entries(env).filter(([, value]) => value.includes(input.token)).map(([key]) => key);
    expect(carriers).toEqual(['GH_ENTERPRISE_TOKEN']);
  });

  it('headless 값이 고정된다', () => {
    const env = buildExecutionEnv(input);
    expect(env).toMatchObject({ GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', TERM: 'dumb', GH_PAGER: '' });
    expect(env.GH_HOST).toBe('ghe.example.com');
    expect(env.HOME).toBe('/ws/home');
    expect(env.GH_CONFIG_DIR).toBe('/ws/config');
  });

  it('CA 파일은 있을 때만 SSL_CERT_FILE로 간다', () => {
    expect(buildExecutionEnv(input)).not.toHaveProperty('SSL_CERT_FILE');
    expect(buildExecutionEnv({ ...input, caFile: '/certs/ca.crt' }).SSL_CERT_FILE).toBe('/certs/ca.crt');
  });

  it('미리보기 설명에서 비밀 키의 값은 가려진다', () => {
    const described = describeExecutionEnv(buildExecutionEnv(input));
    const token = described.find((entry) => entry.key === 'GH_ENTERPRISE_TOKEN');
    expect(token?.value).toBe('<redacted>');
    expect(GH_SECRET_ENV_KEYS).toContain('GH_ENTERPRISE_TOKEN');
    expect(JSON.stringify(described)).not.toContain(input.token);
  });
});
