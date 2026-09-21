/**
 * assertion 재생 방지 (CR-112 / PSI-A10·A11). 두 복제본 동시 소비는 실제 Redis로 통합 시험이 건다.
 */

import { describe, expect, it, vi } from 'vitest';
import type { VerifiedAssertion } from './assertion.js';
import { PsiError } from './errors.js';
import { REPLAY_KEY_PREFIX, consumeAssertion, replayKey, type ReplayRedis } from './replay-store.js';

const NOW_S = 2_000_000_000;
const ASSERTION: VerifiedAssertion = {
  issuer: 'urn:test:pipe',
  audience: 'urn:test:prs',
  subject: 'fixture-001',
  clientId: 'pipe-dev',
  purpose: 'grant',
  profile: 'search-read-v1',
  authContextId: 'ctx-0123456789',
  authExpiresAt: NOW_S + 3600,
  issuedAt: NOW_S,
  notBefore: NOW_S,
  expiresAt: NOW_S + 60,
  jti: 'jti-secret-looking-value-000',
  kid: 'k1',
};

function memoryRedis(): ReplayRedis & { readonly calls: { key: string; seconds: number }[] } {
  const keys = new Set<string>();
  const calls: { key: string; seconds: number }[] = [];
  return {
    calls,
    setIfAbsent: async (key, seconds) => {
      calls.push({ key, seconds });
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
  };
}

describe('consumeAssertion', () => {
  it('처음은 통과하고 같은 jti의 두 번째는 ASSERTION_REPLAYED다', async () => {
    const redis = memoryRedis();
    await consumeAssertion(redis, ASSERTION, NOW_S * 1000);
    await expect(consumeAssertion(redis, ASSERTION, NOW_S * 1000)).rejects.toMatchObject({ code: 'ASSERTION_REPLAYED' });
  });

  it('보관 기간은 남은 유효 시간 + 허용 오차다', async () => {
    const redis = memoryRedis();
    await consumeAssertion(redis, ASSERTION, (NOW_S + 20) * 1000);
    expect(redis.calls[0]?.seconds).toBe(60 - 20 + 5);
  });

  it('목적이 다르면 다른 키다 — 발급용 jti로 문맥 회수를 막지 않는다', () => {
    expect(replayKey(ASSERTION)).not.toBe(replayKey({ ...ASSERTION, purpose: 'revoke_context' }));
    expect(replayKey(ASSERTION)).not.toBe(replayKey({ ...ASSERTION, clientId: 'pipe-other' }));
  });

  it('키 이름에 jti 원문을 두지 않는다', () => {
    const key = replayKey(ASSERTION);
    expect(key.startsWith(REPLAY_KEY_PREFIX)).toBe(true);
    expect(key).not.toContain(ASSERTION.jti);
  });

  it('저장소가 답하지 않으면 503이다 — fail open하지 않는다 (PSI-A11)', async () => {
    const redis: ReplayRedis = { setIfAbsent: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379')) };
    const error = await consumeAssertion(redis, ASSERTION, NOW_S * 1000).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PsiError);
    expect((error as PsiError).code).toBe('AUTH_STORE_UNAVAILABLE');
    expect((error as PsiError).status).toBe(503);
    // 원인 문자열(주소 등)을 싣지 않는다.
    expect((error as PsiError).message).not.toContain('ECONNREFUSED');
  });
});
