/**
 * 위임 신원 상태 판정 (FR-GH-008).
 *
 * 인가 왕복·봉인·DB는 통합 시험이 본다. 여기서는 순수 판정 — 어떤 연결이 「살아 있다」인가.
 */

import { describe, expect, it } from 'vitest';
import type { IdentityConnectionRow } from '@prs/db';
import { statusOf } from './identity.js';

const NOW = new Date('2026-09-13T12:00:00Z');
const base: IdentityConnectionRow = {
  user_id: 'u',
  github_login: 'alice',
  github_user_id: 1,
  host: 'ghe.example.com',
  token_ref: 'ids:x',
  scopes: [],
  connected_at: NOW,
  expires_at: new Date(NOW.getTime() + 3_600_000),
  refresh_expires_at: new Date(NOW.getTime() + 86_400_000),
  revoked_at: null,
  revoke_reason: null,
};

describe('statusOf', () => {
  it('연결 없음·철회·호스트 변경·만료를 가른다', () => {
    expect(statusOf(null, 'ghe.example.com', NOW).status).toBe('not_connected');
    expect(statusOf({ ...base, revoked_at: NOW }, 'ghe.example.com', NOW).status).toBe('revoked');
    expect(statusOf(base, 'other.example.com', NOW).status).toBe('host_changed');
    expect(statusOf(base, 'ghe.example.com', NOW).status).toBe('connected');
  });

  it('액세스 토큰이 만료돼도 갱신 토큰이 살아 있으면 connected다 — 실행 전에 갱신한다', () => {
    const expiredAccess = { ...base, expires_at: new Date(NOW.getTime() - 1) };
    expect(statusOf(expiredAccess, 'ghe.example.com', NOW).status).toBe('connected');
    const bothExpired = { ...expiredAccess, refresh_expires_at: new Date(NOW.getTime() - 1) };
    expect(statusOf(bothExpired, 'ghe.example.com', NOW).status).toBe('expired');
  });

  it('만료가 없는 토큰(만료 옵션을 켜지 않은 App)은 connected다', () => {
    expect(statusOf({ ...base, expires_at: null, refresh_expires_at: null }, 'ghe.example.com', NOW).status).toBe('connected');
  });
});
