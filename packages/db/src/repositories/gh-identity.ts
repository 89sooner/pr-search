/**
 * 위임 신원 리포지터리 (ENT-GH-001, FR-GH-008, WP-046 일부).
 *
 * 두 표를 다룬다 — 연결(`github_identity_connection`)과 봉인된 토큰(`gh_identity_secret`).
 * **토큰 원문은 이 모듈을 지나지 않는다.** 봉인·해제는 `@prs/gh-cli/node`의 vault가
 * 하고, 여기는 바이트를 넣고 꺼낼 뿐이다.
 *
 * 연결과 봉인은 **한 트랜잭션**으로 쓴다. 봉인만 있고 연결이 없으면 아무도 참조하지
 * 못하는 토큰이 남고, 연결만 있고 봉인이 없으면 실행이 실체화 단계에서 실패한다.
 */

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export interface IdentityConnectionRow {
  readonly user_id: string;
  readonly github_login: string;
  readonly github_user_id: number;
  readonly host: string;
  readonly token_ref: string;
  readonly scopes: string[];
  readonly connected_at: Date;
  readonly expires_at: Date | null;
  readonly refresh_expires_at: Date | null;
  readonly revoked_at: Date | null;
  readonly revoke_reason: string | null;
}

export interface IdentitySecretRow {
  readonly secret_ref: string;
  readonly user_id: string;
  readonly key_id: string;
  readonly access_sealed: Buffer;
  readonly refresh_sealed: Buffer | null;
  readonly created_at: Date;
  readonly rotated_at: Date | null;
}

export interface ConnectIdentityInput {
  readonly userId: string;
  readonly githubLogin: string;
  readonly githubUserId: number;
  readonly host: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly refreshExpiresAt: Date | null;
  readonly keyId: string;
  readonly accessSealed: Buffer;
  readonly refreshSealed: Buffer | null;
}

export function newSecretRef(): string {
  return `ids:${randomUUID()}`;
}

/**
 * 연결을 만들거나 갈아 끼운다. 이전 봉인은 지운다 — 옛 토큰이 표에 남으면 그것이
 * 「참조되지 않는 비밀」이 된다.
 */
export async function connectIdentity(client: PoolClient, input: ConnectIdentityInput): Promise<IdentityConnectionRow> {
  const previous = await client.query<{ token_ref: string }>(
    'SELECT token_ref FROM github_identity_connection WHERE user_id = $1 FOR UPDATE',
    [input.userId],
  );
  const secretRef = newSecretRef();
  await client.query(
    `INSERT INTO gh_identity_secret (secret_ref, user_id, key_id, access_sealed, refresh_sealed)
     VALUES ($1, $2, $3, $4, $5)`,
    [secretRef, input.userId, input.keyId, input.accessSealed, input.refreshSealed],
  );
  const result = await client.query<IdentityConnectionRow>(
    `INSERT INTO github_identity_connection
       (user_id, github_login, github_user_id, host, token_ref, scopes, connected_at, expires_at, refresh_expires_at, revoked_at, revoke_reason)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, NULL, NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       github_login = EXCLUDED.github_login,
       github_user_id = EXCLUDED.github_user_id,
       host = EXCLUDED.host,
       token_ref = EXCLUDED.token_ref,
       scopes = EXCLUDED.scopes,
       connected_at = now(),
       expires_at = EXCLUDED.expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       revoked_at = NULL,
       revoke_reason = NULL
     RETURNING *`,
    [
      input.userId,
      input.githubLogin,
      input.githubUserId,
      input.host,
      secretRef,
      [...input.scopes],
      input.expiresAt,
      input.refreshExpiresAt,
    ],
  );
  for (const row of previous.rows) {
    await client.query('DELETE FROM gh_identity_secret WHERE secret_ref = $1', [row.token_ref]);
  }
  const row = result.rows[0];
  if (row === undefined) throw new Error('위임 연결 upsert가 행을 돌려주지 않았다');
  return row;
}

export async function findConnection(db: Queryable, userId: string): Promise<IdentityConnectionRow | null> {
  const result = await db.query<IdentityConnectionRow>('SELECT * FROM github_identity_connection WHERE user_id = $1', [
    userId,
  ]);
  return result.rows[0] ?? null;
}

export async function loadSecret(db: Queryable, secretRef: string): Promise<IdentitySecretRow | null> {
  const result = await db.query<IdentitySecretRow>('SELECT * FROM gh_identity_secret WHERE secret_ref = $1', [secretRef]);
  return result.rows[0] ?? null;
}

/** 갱신한 토큰으로 봉인을 바꾼다. 참조는 그대로다 — 연결 행을 건드리지 않는다. */
export async function rotateSecret(
  db: Queryable,
  secretRef: string,
  input: { readonly keyId: string; readonly accessSealed: Buffer; readonly refreshSealed: Buffer | null; readonly expiresAt: Date | null; readonly refreshExpiresAt: Date | null },
): Promise<void> {
  await db.query(
    `UPDATE gh_identity_secret
        SET key_id = $2, access_sealed = $3, refresh_sealed = $4, rotated_at = now()
      WHERE secret_ref = $1`,
    [secretRef, input.keyId, input.accessSealed, input.refreshSealed],
  );
  await db.query(
    'UPDATE github_identity_connection SET expires_at = $2, refresh_expires_at = $3 WHERE token_ref = $1',
    [secretRef, input.expiresAt, input.refreshExpiresAt],
  );
}

/**
 * 연결을 철회하고 봉인을 지운다. 행은 남긴다 — 「언제 왜 끊겼는가」가 A-007의 답이다.
 *
 * @returns 철회한 연결. 없었으면 `null`.
 */
export async function revokeConnection(client: PoolClient, userId: string, reason: string): Promise<IdentityConnectionRow | null> {
  const result = await client.query<IdentityConnectionRow>(
    `UPDATE github_identity_connection
        SET revoked_at = now(), revoke_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL
      RETURNING *`,
    [userId, reason.slice(0, 64)],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  await client.query('DELETE FROM gh_identity_secret WHERE secret_ref = $1', [row.token_ref]);
  return row;
}

/** A-007 — 연결 상태 전체. 보안 담당자용이다. */
export async function listConnections(db: Queryable, limit = 200): Promise<IdentityConnectionRow[]> {
  const result = await db.query<IdentityConnectionRow>(
    'SELECT * FROM github_identity_connection ORDER BY connected_at DESC LIMIT $1',
    [limit],
  );
  return result.rows;
}
