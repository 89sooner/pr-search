/**
 * 검색 전용 opaque grant (CR-112 / 공통 계약 6장, PSI-C01~C07).
 *
 * ## 일반 세션과 섞이지 않는다
 *
 * - 형식이 다르다: `psig1_` + 32바이트 난수(base64url). 세션 ID는 쿠키에만 있고 접두가 없다.
 * - 저장소가 다르다: PostgreSQL `pipe_integration_grant`에 **SHA-256 hex만** 둔다. 세션은 Redis
 *   `prs:session:*`다. 원문 토큰은 발급 응답 한 번 말고는 어디에도 남지 않는다.
 * - 받는 곳이 다르다: private 리스너의 연동 경로만 이 토큰을 읽는다. `/api/v1/*`는 쿠키만 읽는다.
 *
 * ## 수명
 *
 * `min(now + 300초, 원 PIPE 인증 만료, client 인증서 만료)`. 요청마다 늘리지 않는다 (sliding 없음).
 * 만료 뒤 120초 동안은 행을 보고 `GRANT_EXPIRED`로 답해 PIPE가 한 번 재발급할 수 있게 하고,
 * 그 뒤에는 행이 남아 있어도 `GRANT_INVALID`다 — 진단 창은 인증 수명이 아니다.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { GrantLookupRow } from '@prs/db';
import type { PsiErrorCode } from './errors.js';
import type { VerifiedTransport } from './transport-auth.js';

export const GRANT_TOKEN_PREFIX = 'psig1_' as const;
export const GRANT_TTL_SECONDS = 300;
export const EXPIRED_DIAGNOSTIC_WINDOW_SECONDS = 120;

const TOKEN = /^psig1_[A-Za-z0-9_-]{43}$/;

export function grantTokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 새 토큰과 그 해시. 원문은 호출부가 응답에만 싣는다. */
export function mintGrantToken(): { readonly token: string; readonly digest: string } {
  const token = `${GRANT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, digest: grantTokenDigest(token) };
}

/**
 * `Authorization` 헤더에서 grant를 꺼낸다. 형식이 틀리면 `null` — 저장소를 조회하지 않는다.
 *
 * 헤더가 여럿이면(Node가 쉼표로 잇는다) 형식에서 떨어진다.
 */
export function readBearerGrant(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer (psig1_[A-Za-z0-9_-]{43})$/.exec(header);
  const token = match?.[1];
  return token !== undefined && TOKEN.test(token) ? token : null;
}

/**
 * grant 만료 시각 (epoch ms).
 *
 * @returns 발급할 수 없을 만큼 짧으면(1초 미만) `null`.
 */
export function grantExpiry(input: {
  readonly nowMs: number;
  readonly authExpiresAtSeconds: number;
  readonly certificateNotAfterMs: number;
}): number | null {
  // 초 단위로 내린다 — 응답의 `expires_at`(초 정밀도)과 DB 값이 어긋나지 않게.
  const expires = Math.floor(
    Math.min(input.nowMs + GRANT_TTL_SECONDS * 1000, input.authExpiresAtSeconds * 1000, input.certificateNotAfterMs) / 1000,
  ) * 1000;
  return expires - input.nowMs >= 1000 ? expires : null;
}

export type GrantDecision =
  | { readonly ok: true; readonly grant: GrantLookupRow }
  | { readonly ok: false; readonly code: PsiErrorCode; readonly reason: string; readonly grant: GrantLookupRow | null };

/**
 * 조회 한 번의 grant 판정 (계약 6.2·6.3·8장).
 *
 * **순서가 곧 뜻이다.** 회수는 만료보다 먼저다 — 회수된 grant를 만료로 답하면 PIPE가 자동
 * 재발급한다(PSI-E05). identity 판정도 만료보다 먼저다 — 비활성 사용자에게 재발급을 권하지 않는다.
 */
export function evaluateGrant(
  row: GrantLookupRow | null,
  input: { readonly transport: VerifiedTransport; readonly nowMs: number },
): GrantDecision {
  if (row === null) return { ok: false, code: 'GRANT_INVALID', reason: 'unknown_token', grant: null };

  const expiresAt = row.expires_at.getTime();
  if (input.nowMs >= expiresAt + EXPIRED_DIAGNOSTIC_WINDOW_SECONDS * 1000) {
    return { ok: false, code: 'GRANT_INVALID', reason: 'past_diagnostic_window', grant: null };
  }

  const { client, certificateSha256 } = input.transport;
  if (row.client_id !== client.clientId || row.certificate_sha256 !== certificateSha256) {
    // 다른 인증서로 가져온 grant는 쓸 수 없다 — 발급 자격(sender)에 묶여 있다 (PSI-C03).
    return { ok: false, code: 'GRANT_BINDING_MISMATCH', reason: 'sender_mismatch', grant: row };
  }

  if (row.credential_revoked || client.status !== 'active' || !client.signingKeys.has(row.issued_kid) || row.profile !== client.profile) {
    // 긴급 회수(DB)나 설정에서 뺀 키·client로 발급된 grant는 남은 수명과 무관하게 죽는다 (PSI-C06).
    return { ok: false, code: 'CLIENT_DISABLED', reason: 'credential_revoked', grant: row };
  }

  if (row.context_revoked_at !== null) return { ok: false, code: 'CONTEXT_REVOKED', reason: 'context_revoked', grant: row };
  if (row.revoked_at !== null) return { ok: false, code: 'GRANT_REVOKED', reason: 'grant_revoked', grant: row };

  switch (row.binding_status) {
    case 'active':
      break;
    case 'disabled':
      return { ok: false, code: 'IDENTITY_DISABLED', reason: 'binding_disabled', grant: row };
    case 'conflict':
      return { ok: false, code: 'IDENTITY_BINDING_CONFLICT', reason: 'binding_conflict', grant: row };
    default:
      return { ok: false, code: 'IDENTITY_BINDING_REQUIRED', reason: 'binding_missing', grant: row };
  }
  if (row.current_binding_version !== row.binding_version) {
    // 매핑이 바뀐 뒤 판정되는 요청은 옛 grant로 통과하지 않는다 (PSI-B08). 자동 재발급 대상이 아니다.
    return { ok: false, code: 'GRANT_REVOKED', reason: 'binding_changed', grant: row };
  }

  if (input.nowMs >= expiresAt) return { ok: false, code: 'GRANT_EXPIRED', reason: 'expired', grant: row };
  return { ok: true, grant: row };
}
