/**
 * 위임 토큰 봉인 (FR-GH-008 AC-5·AC-6, ADR-014, 보안 문서 10.2).
 *
 * ## 왜 여기에 있는가
 *
 * 계약은 「토큰은 비밀 저장소 참조로 보관한다」고 적는다. 단일 호스트 형상(Profile A)에는
 * 비밀 저장소가 없다 — 시크릿은 호스트의 파일이고 Kubernetes Secret도 없다. 그래서
 * **최소 구현**을 계약에 적는다: PostgreSQL에는 AES-256-GCM으로 봉인한 바이트만 두고,
 * 봉인 키는 `.env`의 `GH_IDENTITY_VAULT_KEY`로 `search-api`(저장)와 `gh-executor`
 * (실체화) 둘만 받는다. DB 덤프에는 토큰 원문이 없고, 키 없는 DB만으로는 토큰을
 * 되살릴 수 없다.
 *
 * 이것은 「비밀 저장소」의 대체이지 동등물이 아니다. 키와 데이터가 같은 호스트에
 * 있으므로 호스트 전체가 탈취되면 둘 다 잃는다 — 그 대가는 원장에 적었다.
 *
 * ## 형식
 *
 * `버전(1바이트=1) | iv(12) | tag(16) | 암호문`. AAD는 사용자 ID다 — 다른 사용자의
 * 행을 옮겨 붙여도 풀리지 않는다. `keyId`는 키의 SHA-256 앞 8자로, 회전 뒤 어느
 * 키로 봉인됐는지 구분한다.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const VAULT_KEY_BYTES = 32;
const VAULT_FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface VaultKey {
  readonly keyId: string;
  readonly bytes: Buffer;
}

/**
 * 64자 16진수 키를 읽는다. 형식이 틀리면 던진다 — 짧은 키로 조용히 봉인하면
 * 「봉인했다」가 거짓이 된다.
 */
export function parseVaultKey(raw: string | undefined): VaultKey {
  const value = (raw ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('GH_IDENTITY_VAULT_KEY는 64자 16진수(32바이트)여야 한다 — `openssl rand -hex 32`로 만든다');
  }
  const bytes = Buffer.from(value, 'hex');
  return { keyId: createHash('sha256').update(bytes).digest('hex').slice(0, 8), bytes };
}

export function sealSecret(key: VaultKey, plaintext: string, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key.bytes, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VAULT_FORMAT_VERSION]), iv, tag, encrypted]);
}

export class VaultUnsealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultUnsealError';
  }
}

export function unsealSecret(key: VaultKey, sealed: Buffer, aad: string): string {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES) throw new VaultUnsealError('봉인 형식이 짧다');
  if (sealed[0] !== VAULT_FORMAT_VERSION) throw new VaultUnsealError(`모르는 봉인 형식 버전: ${String(sealed[0])}`);
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key.bytes, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // 키가 다르거나(회전) 행이 옮겨졌다(AAD). 어느 쪽인지 말하지 않는다 — 둘 다 「풀 수 없다」다.
    throw new VaultUnsealError('봉인을 풀 수 없다 (키 또는 소유자 불일치)');
  }
}
