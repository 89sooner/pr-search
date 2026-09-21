/**
 * grant 형식·수명·판정 순서 (CR-112 / PSI-C01~C07, 계약 6장·8장).
 */

import { createHash, type KeyObject } from 'node:crypto';
import type { GrantLookupRow } from '@prs/db';
import { describe, expect, it } from 'vitest';
import type { PipeClientPolicy } from './config.js';
import {
  EXPIRED_DIAGNOSTIC_WINDOW_SECONDS,
  GRANT_TTL_SECONDS,
  evaluateGrant,
  grantExpiry,
  grantTokenDigest,
  mintGrantToken,
  readBearerGrant,
} from './grant-store.js';
import type { VerifiedTransport } from './transport-auth.js';

const NOW = Date.UTC(2033, 4, 18, 3, 33, 20);
const CERT = 'c'.repeat(64);

const CLIENT: PipeClientPolicy = {
  clientId: 'pipe-dev',
  status: 'active',
  policyVersion: 3,
  issuer: 'urn:test:pipe',
  audience: 'urn:test:prs',
  profile: 'search-read-v1',
  signingKeys: new Map<string, KeyObject>([['k1', {} as KeyObject]]),
  certificateSha256: new Set([CERT]),
  subjectAltNames: new Set(),
  repositoryIds: [101],
};

const TRANSPORT: VerifiedTransport = { client: CLIENT, certificateSha256: CERT, certificateNotAfterMs: NOW + 86_400_000 };

function row(overrides: Partial<GrantLookupRow> = {}): GrantLookupRow {
  return {
    grant_id: '11111111-1111-4111-8111-111111111111',
    client_id: 'pipe-dev',
    issuer: 'urn:test:pipe',
    subject: 'fixture-001',
    auth_context_id: 'ctx-0123456789',
    binding_id: 7,
    binding_version: 2,
    prs_user_id: 'github:1001',
    issued_kid: 'k1',
    certificate_sha256: CERT,
    profile: 'search-read-v1',
    client_policy_version: 3,
    issued_at: new Date(NOW - 60_000),
    expires_at: new Date(NOW + 240_000),
    revoked_at: null,
    context_revoked_at: null,
    binding_status: 'active',
    current_binding_version: 2,
    credential_revoked: false,
    ...overrides,
  };
}

const decide = (value: GrantLookupRow | null, nowMs = NOW, transport = TRANSPORT) => evaluateGrant(value, { transport, nowMs });

describe('토큰 형식 — 일반 세션과 다른 이름공간 (PSI-C01)', () => {
  it('psig1_ 접두 + 32바이트 난수, 저장은 SHA-256 hex뿐이다', () => {
    const { token, digest } = mintGrantToken();
    expect(token).toMatch(/^psig1_[A-Za-z0-9_-]{43}$/);
    expect(digest).toBe(createHash('sha256').update(token).digest('hex'));
    expect(grantTokenDigest(token)).toBe(digest);
    expect(mintGrantToken().token).not.toBe(token);
  });

  it('Bearer 형식이 정확할 때만 꺼낸다', () => {
    const { token } = mintGrantToken();
    expect(readBearerGrant(`Bearer ${token}`)).toBe(token);
    for (const header of [token, `bearer ${token}`, `Bearer  ${token}`, `Bearer ${token} `, `Bearer ${token}x`, 'Bearer psig2_abc', undefined]) {
      expect(readBearerGrant(header)).toBeNull();
    }
    expect(readBearerGrant([`Bearer ${token}`])).toBeNull();
  });
});

describe('수명 상한 (PSI-C02)', () => {
  it('300초·원 인증 만료·인증서 만료 중 이른 것이고 초 단위로 내린다', () => {
    const base = { nowMs: NOW + 400, authExpiresAtSeconds: Math.floor(NOW / 1000) + 3600, certificateNotAfterMs: NOW + 86_400_000 };
    expect(grantExpiry(base)).toBe(Math.floor((NOW + 400 + GRANT_TTL_SECONDS * 1000) / 1000) * 1000);
    expect(grantExpiry({ ...base, authExpiresAtSeconds: Math.floor(NOW / 1000) + 30 })).toBe(NOW + 30_000);
    expect(grantExpiry({ ...base, certificateNotAfterMs: NOW + 10_500 })).toBe(NOW + 10_000);
  });

  it('1초 미만이면 발급하지 않는다', () => {
    expect(grantExpiry({ nowMs: NOW, authExpiresAtSeconds: Math.floor(NOW / 1000), certificateNotAfterMs: NOW + 86_400_000 })).toBeNull();
  });
});

describe('판정 순서 (계약 6.2·8장)', () => {
  it('유효하면 통과한다', () => {
    expect(decide(row())).toMatchObject({ ok: true });
  });

  it('모르는 토큰과 진단 창이 지난 토큰은 GRANT_INVALID다', () => {
    expect(decide(null)).toMatchObject({ ok: false, code: 'GRANT_INVALID' });
    const expired = row({ expires_at: new Date(NOW - EXPIRED_DIAGNOSTIC_WINDOW_SECONDS * 1000) });
    expect(decide(expired)).toMatchObject({ ok: false, code: 'GRANT_INVALID', reason: 'past_diagnostic_window' });
  });

  it('만료 뒤 진단 창 안이면 GRANT_EXPIRED다 — PIPE가 한 번 재발급한다', () => {
    const expired = row({ expires_at: new Date(NOW - 1_000) });
    expect(decide(expired)).toMatchObject({ ok: false, code: 'GRANT_EXPIRED' });
  });

  it('다른 인증서·다른 client가 가져온 grant는 GRANT_BINDING_MISMATCH다 (PSI-C03)', () => {
    expect(decide(row({ certificate_sha256: 'd'.repeat(64) }))).toMatchObject({ ok: false, code: 'GRANT_BINDING_MISMATCH' });
    expect(decide(row({ client_id: 'pipe-other' }))).toMatchObject({ ok: false, code: 'GRANT_BINDING_MISMATCH' });
  });

  it('긴급 회수·설정에서 뺀 키·꺼진 client는 남은 수명과 무관하게 CLIENT_DISABLED다 (PSI-C06)', () => {
    expect(decide(row({ credential_revoked: true }))).toMatchObject({ ok: false, code: 'CLIENT_DISABLED' });
    expect(decide(row({ issued_kid: 'k-retired' }))).toMatchObject({ ok: false, code: 'CLIENT_DISABLED' });
    const disabled: VerifiedTransport = { ...TRANSPORT, client: { ...CLIENT, status: 'disabled' } };
    expect(decide(row(), NOW, disabled)).toMatchObject({ ok: false, code: 'CLIENT_DISABLED' });
  });

  it('회수는 만료보다 먼저다 — 회수된 grant를 만료로 답하면 PIPE가 자동 재발급한다 (PSI-E05)', () => {
    const past = new Date(NOW - 1_000);
    expect(decide(row({ revoked_at: past, expires_at: past }))).toMatchObject({ ok: false, code: 'GRANT_REVOKED' });
    expect(decide(row({ context_revoked_at: past, revoked_at: past, expires_at: past }))).toMatchObject({ ok: false, code: 'CONTEXT_REVOKED' });
  });

  it('binding 상태는 만료보다 먼저이고 코드가 갈린다 (PSI-B04·B08)', () => {
    const past = new Date(NOW - 1_000);
    expect(decide(row({ binding_status: 'disabled', expires_at: past }))).toMatchObject({ ok: false, code: 'IDENTITY_DISABLED' });
    expect(decide(row({ binding_status: 'conflict' }))).toMatchObject({ ok: false, code: 'IDENTITY_BINDING_CONFLICT' });
    expect(decide(row({ binding_status: null, current_binding_version: null }))).toMatchObject({ ok: false, code: 'IDENTITY_BINDING_REQUIRED' });
    expect(decide(row({ binding_status: 'pending' }))).toMatchObject({ ok: false, code: 'IDENTITY_BINDING_REQUIRED' });
    expect(decide(row({ current_binding_version: 3 }))).toMatchObject({ ok: false, code: 'GRANT_REVOKED', reason: 'binding_changed' });
  });
});
