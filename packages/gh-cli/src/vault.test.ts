/**
 * 위임 토큰 봉인 (FR-GH-008 AC-5, 보안 문서 10.2).
 */

import { describe, expect, it } from 'vitest';
import { VaultUnsealError, parseVaultKey, sealSecret, unsealSecret } from './vault.js';

const KEY = parseVaultKey('0123456789abcdef'.repeat(4));
const OTHER = parseVaultKey('fedcba9876543210'.repeat(4));

describe('FR-GH-008 AC-5: 토큰 원문은 저장되지 않는다', () => {
  it('봉인한 바이트에 원문이 없고 같은 키·AAD로만 풀린다', () => {
    const token = 'ghu_' + 'q'.repeat(30);
    const sealed = sealSecret(KEY, token, 'user-1');
    expect(sealed.toString('latin1')).not.toContain('ghu_');
    expect(unsealSecret(KEY, sealed, 'user-1')).toBe(token);
  });

  it('다른 사용자의 행으로 옮겨 붙이면 풀리지 않는다 (AAD)', () => {
    const sealed = sealSecret(KEY, 'ghu_' + 'q'.repeat(30), 'user-1');
    expect(() => unsealSecret(KEY, sealed, 'user-2')).toThrow(VaultUnsealError);
  });

  it('다른 키로는 풀리지 않는다 — 회전 뒤 keyId로 구분한다', () => {
    const sealed = sealSecret(KEY, 'x', 'u');
    expect(() => unsealSecret(OTHER, sealed, 'u')).toThrow(VaultUnsealError);
    expect(KEY.keyId).not.toBe(OTHER.keyId);
    expect(KEY.keyId).toHaveLength(8);
  });

  it('같은 평문도 매번 다른 봉인이다 (무작위 iv)', () => {
    expect(sealSecret(KEY, 'x', 'u').equals(sealSecret(KEY, 'x', 'u'))).toBe(false);
  });

  it('키 형식을 강제한다', () => {
    expect(() => parseVaultKey('short')).toThrow(/64자/);
    expect(() => parseVaultKey(undefined)).toThrow(/64자/);
    expect(() => unsealSecret(KEY, Buffer.from([9, 1, 2]), 'u')).toThrow(VaultUnsealError);
  });
});
