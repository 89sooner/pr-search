/**
 * PIPE 연동 정본 (CR-112 / ADR-025, ENT-INT-001~005).
 *
 * ## 이 파일이 지키는 경합 규칙
 *
 * 1. **발급과 로그인 문맥 회수는 문맥 행 하나의 잠금으로 직렬화된다.** 발급은
 *    `INSERT … ON CONFLICT DO UPDATE`로 문맥 행을 잠근 채 `revoked_at`을 다시 읽고 grant를
 *    넣는다. 회수는 같은 행을 갱신한 뒤 그 문맥의 grant를 전부 회수한다. 어느 쪽이 먼저
 *    커밋해도 **회수가 끝난 뒤 살아 있는 grant가 남지 않는다** (PSI-C08). 다른 프로세스에서도
 *    같다 — 잠금이 DB에 있다.
 * 2. **발급은 binding 행을 `FOR SHARE`로 잡는다.** 비활성화(`UPDATE`)와 동시에 오면 둘 중 하나가
 *    기다린다. 발급이 먼저면 비활성화가 버전을 올려 그 grant는 다음 요청에서 거절되고,
 *    비활성화가 먼저면 발급이 바뀐 상태를 보고 멈춘다.
 * 3. **시각은 호출부가 준다.** 수명 상한(300초)이 DB 제약에도 걸려 있으므로 앱 시계로 만든
 *    `issued_at`·`expires_at`이 그대로 검사된다 — 시험의 고정 시계가 그대로 통한다.
 *
 * 원문 토큰·assertion은 이 파일에 들어오지 않는다. 토큰은 SHA-256 hex로만 온다.
 */

import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../pool.js';

type Queryable = Pool | PoolClient;

export type BindingStatus = 'pending' | 'active' | 'disabled' | 'conflict';

export interface IdentityBindingRow {
  readonly binding_id: number;
  readonly issuer: string;
  readonly subject: string;
  readonly prs_user_id: string;
  readonly ghe_host: string;
  readonly ghe_user_id: number;
  readonly status: BindingStatus;
  readonly binding_version: number;
  readonly verified_by: string;
  readonly verified_at: Date;
  readonly verification_reference: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const BINDING_COLUMNS = `binding_id, issuer, subject, prs_user_id, ghe_host, ghe_user_id, status, binding_version,
  verified_by, verified_at, verification_reference, created_at, updated_at`;

export async function findBindingBySubject(
  db: Queryable,
  issuer: string,
  subject: string,
): Promise<IdentityBindingRow | null> {
  const { rows } = await db.query<IdentityBindingRow>(
    `SELECT ${BINDING_COLUMNS} FROM pipe_integration_identity_binding WHERE issuer = $1 AND subject = $2`,
    [issuer, subject],
  );
  return rows[0] ?? null;
}

/** 같은 issuer 안에서 이 사용자에게 붙은 활성 binding (역방향 충돌 검사). */
export async function findActiveBindingByUser(
  db: Queryable,
  issuer: string,
  prsUserId: string,
): Promise<IdentityBindingRow | null> {
  const { rows } = await db.query<IdentityBindingRow>(
    `SELECT ${BINDING_COLUMNS} FROM pipe_integration_identity_binding
      WHERE issuer = $1 AND prs_user_id = $2 AND status = 'active'`,
    [issuer, prsUserId],
  );
  return rows[0] ?? null;
}

/** 같은 issuer 안에서 이 GHE 계정(호스트+숫자 ID)에 붙은 활성 binding. */
export async function findActiveBindingByGhe(
  db: Queryable,
  issuer: string,
  gheHost: string,
  gheUserId: number,
): Promise<IdentityBindingRow | null> {
  const { rows } = await db.query<IdentityBindingRow>(
    `SELECT ${BINDING_COLUMNS} FROM pipe_integration_identity_binding
      WHERE issuer = $1 AND ghe_host = $2 AND ghe_user_id = $3 AND status = 'active'`,
    [issuer, gheHost, gheUserId],
  );
  return rows[0] ?? null;
}

export interface BindingInsert {
  readonly issuer: string;
  readonly subject: string;
  readonly prsUserId: string;
  readonly gheHost: string;
  readonly gheUserId: number;
  readonly verifiedBy: string;
  readonly verifiedAt: Date;
  readonly verificationReference: string;
}

export async function insertBinding(db: Queryable, input: BindingInsert): Promise<IdentityBindingRow> {
  const { rows } = await db.query<IdentityBindingRow>(
    `INSERT INTO pipe_integration_identity_binding
       (issuer, subject, prs_user_id, ghe_host, ghe_user_id, status, binding_version,
        verified_by, verified_at, verification_reference, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', 1, $6, $7, $8, $7, $7)
     RETURNING ${BINDING_COLUMNS}`,
    [
      input.issuer,
      input.subject,
      input.prsUserId,
      input.gheHost,
      input.gheUserId,
      input.verifiedBy,
      input.verifiedAt,
      input.verificationReference,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('binding insert가 행을 돌려주지 않았다');
  return row;
}

/**
 * 비활성 binding을 **같은 사용자·같은 GHE 계정으로만** 다시 켠다. 버전이 오른다.
 *
 * 다른 사용자로 바꾸는 갱신은 없다 — 그것은 계정 교체이며 사람이 새 binding으로 판단한다.
 */
export async function reactivateBinding(
  db: Queryable,
  input: BindingInsert,
): Promise<IdentityBindingRow | null> {
  const { rows } = await db.query<IdentityBindingRow>(
    `UPDATE pipe_integration_identity_binding
        SET status = 'active', binding_version = binding_version + 1,
            verified_by = $6, verified_at = $7, verification_reference = $8, updated_at = $7
      WHERE issuer = $1 AND subject = $2 AND prs_user_id = $3 AND ghe_host = $4 AND ghe_user_id = $5
        AND status <> 'active'
      RETURNING ${BINDING_COLUMNS}`,
    [
      input.issuer,
      input.subject,
      input.prsUserId,
      input.gheHost,
      input.gheUserId,
      input.verifiedBy,
      input.verifiedAt,
      input.verificationReference,
    ],
  );
  return rows[0] ?? null;
}

/**
 * binding을 끈다. 버전이 올라 **이미 발급된 grant가 다음 요청에서 거절된다** (PSI-B08).
 *
 * @returns 바꾼 행. 이미 꺼져 있었거나 없으면 `null` — 재실행은 아무것도 바꾸지 않는다.
 */
export async function disableBinding(
  db: Queryable,
  input: { readonly issuer: string; readonly subject: string; readonly now: Date },
): Promise<IdentityBindingRow | null> {
  const { rows } = await db.query<IdentityBindingRow>(
    `UPDATE pipe_integration_identity_binding
        SET status = 'disabled', binding_version = binding_version + 1, updated_at = $3
      WHERE issuer = $1 AND subject = $2 AND status <> 'disabled'
      RETURNING ${BINDING_COLUMNS}`,
    [input.issuer, input.subject, input.now],
  );
  return rows[0] ?? null;
}

export async function listBindings(
  db: Queryable,
  filter: { readonly issuer?: string; readonly status?: BindingStatus } = {},
): Promise<IdentityBindingRow[]> {
  const { rows } = await db.query<IdentityBindingRow>(
    `SELECT ${BINDING_COLUMNS} FROM pipe_integration_identity_binding
      WHERE ($1::text IS NULL OR issuer = $1) AND ($2::text IS NULL OR status = $2)
      ORDER BY issuer, subject`,
    [filter.issuer ?? null, filter.status ?? null],
  );
  return rows;
}

// ---------------------------------------------------------------- 저장소 가시성 재료

/** 교집합 보정에 필요한 저장소 가시성 재료 — `isRepositoryInScope`가 읽는 넷이다. */
export interface RepositoryScopeRow {
  readonly repository_id: number;
  readonly org_id: number;
  readonly visibility: string;
  readonly allowed_team_ids: number[];
}

/**
 * 등록 저장소의 가시성 재료를 ID 목록으로 한 번에 읽는다.
 *
 * 연동 허용 목록은 최대 500개라(ADR-008의 명시 임계) 한 질의로 끝난다. **등록 상태를 거르지
 * 않는다** — 걸러내는 것은 사용자의 접근 범위(등록·활성 저장소만 담는다)가 이미 한다.
 */
export async function findRepositoryScopeRows(db: Queryable, repositoryIds: readonly number[]): Promise<RepositoryScopeRow[]> {
  if (repositoryIds.length === 0) return [];
  const { rows } = await db.query<RepositoryScopeRow>(
    `SELECT repository_id, org_id, visibility, allowed_team_ids
       FROM repository WHERE repository_id = ANY($1::bigint[])`,
    [[...repositoryIds]],
  );
  return rows;
}

// ---------------------------------------------------------------- 로그인 문맥

export interface AuthContextKey {
  readonly issuer: string;
  readonly subject: string;
  readonly authContextId: string;
}

export async function findAuthContext(
  db: Queryable,
  key: AuthContextKey,
): Promise<{ readonly revoked_at: Date | null; readonly auth_expires_at: Date } | null> {
  const { rows } = await db.query<{ revoked_at: Date | null; auth_expires_at: Date }>(
    `SELECT revoked_at, auth_expires_at FROM pipe_integration_auth_context
      WHERE issuer = $1 AND subject = $2 AND auth_context_id = $3`,
    [key.issuer, key.subject, key.authContextId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- grant

export interface GrantInsert extends AuthContextKey {
  readonly grantId: string;
  readonly tokenSha256: string;
  readonly clientId: string;
  readonly bindingId: number;
  readonly bindingVersion: number;
  readonly prsUserId: string;
  readonly issuedKid: string;
  readonly certificateSha256: string;
  readonly profile: string;
  readonly clientPolicyVersion: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly authExpiresAt: Date;
  readonly correlationId: string;
}

export type IssueGrantResult =
  | { readonly outcome: 'issued' }
  | { readonly outcome: 'context_revoked' }
  | { readonly outcome: 'binding_changed'; readonly status: BindingStatus | null };

/**
 * grant를 원자적으로 저장한다 (위 규칙 1·2).
 *
 * 회수된 문맥이면 넣지 않는다. binding이 검증 뒤에 바뀌었으면 넣지 않는다.
 */
export async function issueGrant(pool: Pool, input: GrantInsert): Promise<IssueGrantResult> {
  return withTransaction(pool, async (client) => {
    const context = await client.query<{ revoked_at: Date | null }>(
      `INSERT INTO pipe_integration_auth_context
         (issuer, subject, auth_context_id, client_id, first_seen_at, auth_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (issuer, subject, auth_context_id) DO UPDATE
         SET auth_expires_at = GREATEST(pipe_integration_auth_context.auth_expires_at, EXCLUDED.auth_expires_at)
       RETURNING revoked_at`,
      [input.issuer, input.subject, input.authContextId, input.clientId, input.issuedAt, input.authExpiresAt],
    );
    if ((context.rows[0]?.revoked_at ?? null) !== null) return { outcome: 'context_revoked' } as const;

    const binding = await client.query<{ status: BindingStatus; binding_version: number }>(
      `SELECT status, binding_version FROM pipe_integration_identity_binding WHERE binding_id = $1 FOR SHARE`,
      [input.bindingId],
    );
    const current = binding.rows[0];
    if (current === undefined || current.status !== 'active' || current.binding_version !== input.bindingVersion) {
      return { outcome: 'binding_changed', status: current?.status ?? null } as const;
    }

    await client.query(
      `INSERT INTO pipe_integration_grant
         (grant_id, token_sha256, client_id, issuer, subject, auth_context_id, binding_id, binding_version,
          prs_user_id, issued_kid, certificate_sha256, profile, client_policy_version, issued_at, expires_at,
          correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        input.grantId,
        input.tokenSha256,
        input.clientId,
        input.issuer,
        input.subject,
        input.authContextId,
        input.bindingId,
        input.bindingVersion,
        input.prsUserId,
        input.issuedKid,
        input.certificateSha256,
        input.profile,
        input.clientPolicyVersion,
        input.issuedAt,
        input.expiresAt,
        input.correlationId,
      ],
    );
    return { outcome: 'issued' } as const;
  });
}

/**
 * 로그인 문맥을 회수한다 — 표식을 남기고 그 문맥의 grant를 모두 회수한다 (위 규칙 1).
 *
 * 멱등이다. 이미 회수된 문맥이면 처음 회수 시각을 유지한다.
 */
export async function revokeAuthContext(
  pool: Pool,
  input: AuthContextKey & {
    readonly clientId: string;
    readonly now: Date;
    readonly authExpiresAt: Date;
    readonly correlationId: string;
  },
): Promise<{ readonly revokedAt: Date; readonly revokedGrants: number }> {
  return withTransaction(pool, async (client) => {
    const context = await client.query<{ revoked_at: Date }>(
      `INSERT INTO pipe_integration_auth_context
         (issuer, subject, auth_context_id, client_id, first_seen_at, auth_expires_at, revoked_at, revoke_correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $5, $7)
       ON CONFLICT (issuer, subject, auth_context_id) DO UPDATE
         SET revoked_at = COALESCE(pipe_integration_auth_context.revoked_at, EXCLUDED.revoked_at),
             revoke_correlation_id = COALESCE(pipe_integration_auth_context.revoke_correlation_id, EXCLUDED.revoke_correlation_id),
             auth_expires_at = GREATEST(pipe_integration_auth_context.auth_expires_at, EXCLUDED.auth_expires_at)
       RETURNING revoked_at`,
      [input.issuer, input.subject, input.authContextId, input.clientId, input.now, input.authExpiresAt, input.correlationId],
    );
    const revokedAt = context.rows[0]?.revoked_at;
    if (revokedAt === undefined) throw new Error('문맥 회수가 행을 돌려주지 않았다');

    const grants = await client.query(
      `UPDATE pipe_integration_grant SET revoked_at = $4, revoke_reason = 'context_revoked'
        WHERE issuer = $1 AND subject = $2 AND auth_context_id = $3 AND revoked_at IS NULL`,
      [input.issuer, input.subject, input.authContextId, input.now],
    );
    return { revokedAt, revokedGrants: grants.rowCount ?? 0 };
  });
}

/**
 * grant 하나를 회수한다. **자기 client의 것만** 바뀐다.
 *
 * 바뀐 grant ID는 이벤트 기록에만 쓴다. 호출부는 응답에 싣지 않는다 — 토큰의 존재를 알려 주지 않는다.
 *
 * @returns 이번에 회수한 grant ID. 없거나 다른 client의 것이거나 이미 회수됐으면 `null`.
 */
export async function revokeGrantByToken(
  db: Queryable,
  input: { readonly tokenSha256: string; readonly clientId: string; readonly now: Date },
): Promise<string | null> {
  const { rows } = await db.query<{ grant_id: string }>(
    `UPDATE pipe_integration_grant SET revoked_at = $3, revoke_reason = 'client_revoked'
      WHERE token_sha256 = $1 AND client_id = $2 AND revoked_at IS NULL
      RETURNING grant_id`,
    [input.tokenSha256, input.clientId, input.now],
  );
  return rows[0]?.grant_id ?? null;
}

/** 조회 한 번에 필요한 grant의 전부 — 문맥·binding·긴급 회수까지 한 질의로 읽는다. */
export interface GrantLookupRow {
  readonly grant_id: string;
  readonly client_id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly auth_context_id: string;
  readonly binding_id: number;
  readonly binding_version: number;
  readonly prs_user_id: string;
  readonly issued_kid: string;
  readonly certificate_sha256: string;
  readonly profile: string;
  readonly client_policy_version: number;
  readonly issued_at: Date;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
  readonly context_revoked_at: Date | null;
  readonly binding_status: BindingStatus | null;
  readonly current_binding_version: number | null;
  readonly credential_revoked: boolean;
}

export async function lookupGrant(db: Queryable, tokenSha256: string): Promise<GrantLookupRow | null> {
  const { rows } = await db.query<GrantLookupRow>(
    `SELECT g.grant_id, g.client_id, g.issuer, g.subject, g.auth_context_id, g.binding_id, g.binding_version,
            g.prs_user_id, g.issued_kid, g.certificate_sha256, g.profile, g.client_policy_version,
            g.issued_at, g.expires_at, g.revoked_at,
            c.revoked_at AS context_revoked_at,
            b.status AS binding_status, b.binding_version AS current_binding_version,
            EXISTS (
              SELECT 1 FROM pipe_integration_credential_revocation r
               WHERE r.client_id = g.client_id
                 AND ((r.credential_kind = 'client' AND r.credential_id = g.client_id)
                   OR (r.credential_kind = 'signing_key' AND r.credential_id = g.issued_kid)
                   OR (r.credential_kind = 'certificate' AND r.credential_id = g.certificate_sha256))
            ) AS credential_revoked
       FROM pipe_integration_grant g
       JOIN pipe_integration_auth_context c
         ON c.issuer = g.issuer AND c.subject = g.subject AND c.auth_context_id = g.auth_context_id
       LEFT JOIN pipe_integration_identity_binding b ON b.binding_id = g.binding_id
      WHERE g.token_sha256 = $1`,
    [tokenSha256],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- 긴급 회수

export type CredentialKind = 'client' | 'signing_key' | 'certificate';

export interface CredentialRevocationRow {
  readonly client_id: string;
  readonly credential_kind: CredentialKind;
  readonly credential_id: string;
  readonly reason: string;
  readonly revoked_by: string;
  readonly revoked_at: Date;
}

/** @returns 새로 기록했으면 `created`, 이미 있었으면 `exists` (처음 사유·시각을 유지한다). */
export async function insertCredentialRevocation(
  db: Queryable,
  input: {
    readonly clientId: string;
    readonly kind: CredentialKind;
    readonly credentialId: string;
    readonly reason: string;
    readonly revokedBy: string;
    readonly now: Date;
  },
): Promise<'created' | 'exists'> {
  const result = await db.query(
    `INSERT INTO pipe_integration_credential_revocation (client_id, credential_kind, credential_id, reason, revoked_by, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (client_id, credential_kind, credential_id) DO NOTHING`,
    [input.clientId, input.kind, input.credentialId, input.reason, input.revokedBy, input.now],
  );
  return (result.rowCount ?? 0) === 1 ? 'created' : 'exists';
}

export async function listCredentialRevocations(db: Queryable): Promise<CredentialRevocationRow[]> {
  const { rows } = await db.query<CredentialRevocationRow>(
    `SELECT client_id, credential_kind, credential_id, reason, revoked_by, revoked_at
       FROM pipe_integration_credential_revocation ORDER BY revoked_at, client_id`,
  );
  return rows;
}

/** 발급 전에 이 연결의 client·인증서·서명 키가 긴급 회수되었는지 본다. */
export async function isCredentialRevoked(
  db: Queryable,
  input: { readonly clientId: string; readonly kid: string | null; readonly certificateSha256: string },
): Promise<boolean> {
  const { rows } = await db.query<{ revoked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pipe_integration_credential_revocation
        WHERE client_id = $1
          AND ((credential_kind = 'client' AND credential_id = $1)
            OR (credential_kind = 'certificate' AND credential_id = $3)
            OR ($2::text IS NOT NULL AND credential_kind = 'signing_key' AND credential_id = $2))
     ) AS revoked`,
    [input.clientId, input.kid, input.certificateSha256],
  );
  return rows[0]?.revoked === true;
}

// ---------------------------------------------------------------- 보존

/**
 * 진단 창이 지난 grant와 보존 기간이 지난 문맥을 지운다 (운영 CLI 전용).
 *
 * 회수 표식은 `auth_expires_at`·회수 시각 중 늦은 쪽에서 `contextRetentionMs`가 지나야 지운다.
 * 문맥을 가리키는 grant가 남아 있으면 지우지 않는다.
 */
export async function purgeExpired(
  pool: Pool,
  input: { readonly grantsExpiredBefore: Date; readonly contextsIdleBefore: Date; readonly dryRun: boolean },
): Promise<{ readonly grants: number; readonly contexts: number }> {
  /*
   * 문맥은 **grant를 지운 뒤에** 센다 — 지울 grant가 남아 있는 문맥은 대상이 아니다. dry-run은
   * 그 순서를 흉내 내려고 grant 조건을 문맥 조건에 함께 적는다.
   */
  const contextFilter = `GREATEST(c.auth_expires_at, COALESCE(c.revoked_at, c.first_seen_at)) < $1
     AND NOT EXISTS (SELECT 1 FROM pipe_integration_grant g
                      WHERE g.issuer = c.issuer AND g.subject = c.subject AND g.auth_context_id = c.auth_context_id
                        AND g.expires_at >= $2)`;

  if (input.dryRun) {
    const grants = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pipe_integration_grant WHERE expires_at < $1',
      [input.grantsExpiredBefore],
    );
    const contexts = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pipe_integration_auth_context c WHERE ${contextFilter}`,
      [input.contextsIdleBefore, input.grantsExpiredBefore],
    );
    return { grants: grants.rows[0]?.n ?? 0, contexts: contexts.rows[0]?.n ?? 0 };
  }

  return withTransaction(pool, async (client) => {
    const grants = await client.query<{ n: number }>(
      'WITH gone AS (DELETE FROM pipe_integration_grant WHERE expires_at < $1 RETURNING 1) SELECT count(*)::int AS n FROM gone',
      [input.grantsExpiredBefore],
    );
    const contexts = await client.query<{ n: number }>(
      `WITH gone AS (DELETE FROM pipe_integration_auth_context c WHERE ${contextFilter} RETURNING 1)
       SELECT count(*)::int AS n FROM gone`,
      [input.contextsIdleBefore, input.grantsExpiredBefore],
    );
    return { grants: grants.rows[0]?.n ?? 0, contexts: contexts.rows[0]?.n ?? 0 };
  });
}

// ---------------------------------------------------------------- 이벤트

export type IntegrationEventType =
  | 'grant.issue'
  | 'grant.reject'
  | 'grant.revoke'
  | 'context.revoke'
  | 'context.reject'
  | 'context.view'
  | 'read'
  | 'read.reject'
  | 'binding.import'
  | 'binding.disable'
  | 'credential.revoke'
  | 'maintenance.purge';

export interface IntegrationEventInput {
  readonly eventType: IntegrationEventType;
  readonly resultCode: string;
  readonly httpStatus?: number | null;
  readonly clientId?: string | null;
  readonly issuer?: string | null;
  readonly subject?: string | null;
  readonly authContextId?: string | null;
  readonly prsUserId?: string | null;
  readonly grantId?: string | null;
  readonly operation?: string | null;
  readonly target?: string | null;
  readonly bindingVersion?: number | null;
  readonly clientPolicyVersion?: number | null;
  readonly correlationId: string;
  readonly upstreamCorrelationId?: string | null;
  readonly actor?: string | null;
  /** 짧은 사유 코드와 건수만. 토큰·assertion·검색어·응답 본문을 담지 않는다. */
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurredAt?: Date;
}

export async function recordEvent(db: Queryable, event: IntegrationEventInput): Promise<void> {
  await db.query(
    `INSERT INTO pipe_integration_event
       (occurred_at, event_type, result_code, http_status, client_id, issuer, subject, auth_context_id,
        prs_user_id, grant_id, operation, target, binding_version, client_policy_version,
        correlation_id, upstream_correlation_id, actor, detail)
     VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      event.occurredAt ?? null,
      event.eventType,
      event.resultCode,
      event.httpStatus ?? null,
      event.clientId ?? null,
      event.issuer ?? null,
      event.subject ?? null,
      event.authContextId ?? null,
      event.prsUserId ?? null,
      event.grantId ?? null,
      event.operation ?? null,
      event.target ?? null,
      event.bindingVersion ?? null,
      event.clientPolicyVersion ?? null,
      event.correlationId,
      event.upstreamCorrelationId ?? null,
      event.actor ?? null,
      JSON.stringify(event.detail ?? {}),
    ],
  );
}
