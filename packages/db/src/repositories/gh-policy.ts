/**
 * GitHub Operations 운영 정책 리포지터리 (ENT-GH-013 · ENT-GH-014, FR-GH-011 AC-6~AC-10 · FR-GH-009 AC-8, CR-090 / WP-080).
 *
 * **이 모듈에는 정책 표를 직접 쓰는 SQL이 없다.** 쓰기는 마이그레이션 030의 `gh_operations_policy_apply` 함수 하나로만
 * 간다. `prs_app`은 두 표를 읽기만 하고 그 함수만 실행할 수 있다 — 여기에 `UPDATE gh_operations_policy`를 적어도 DB가
 * 권한으로 거절한다. 그래서 revision·이력·감사가 빠진 상태 변경이 애플리케이션 경로에서 생기지 않는다.
 *
 * 함수가 낸 SQLSTATE(PRS01~PRS05)는 호출자가 가를 수 있는 `PolicyChangeRejected`로 바꾼다. 그 밖의 오류는 그대로 던진다 —
 * 연결 장애를 「충돌」로 보이게 하지 않는다.
 */

import type { Pool, PoolClient } from 'pg';
import { ghPolicyLockKey } from '../advisory-lock.js';

type Queryable = Pool | PoolClient;

export type GhPolicyAction = 'approve' | 'revoke' | 'block' | 'resume';

export interface GhPolicyRow {
  readonly scope: string;
  readonly revision: number;
  readonly approved_snapshot_id: number | null;
  readonly approved_verification_id: number | null;
  readonly approved_report_hash: string | null;
  readonly approved_manifest_version: string | null;
  readonly approved_manifest_hash: string | null;
  readonly approved_gh_version: string | null;
  readonly approved_at: Date | null;
  readonly approved_by: string | null;
  readonly blocked_capabilities: string[];
  readonly updated_at: Date;
  readonly updated_by: string;
}

/**
 * 판정 입력의 모양(`@prs/gh-cli`의 `GhPolicyState`와 구조가 같다). 행이 없으면 revision 0·승인 없음·차단 없음이다.
 * 이 변환을 API와 실행기가 각자 적지 않게 여기 하나만 둔다.
 */
export interface GhPolicyStateView {
  readonly scope: string;
  readonly revision: number;
  readonly approval: {
    readonly snapshotId: number;
    readonly verificationId: number;
    readonly reportHash: string;
    readonly manifestVersion: string;
    readonly manifestHash: string;
    readonly ghVersion: string;
    readonly approvedAt: Date;
    readonly approvedBy: string;
  } | null;
  readonly blockedCapabilities: readonly string[];
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
}

export function policyStateOf(scope: string, row: GhPolicyRow | null): GhPolicyStateView {
  if (row === null) return { scope, revision: 0, approval: null, blockedCapabilities: [], updatedAt: null, updatedBy: null };
  const approval =
    row.approved_snapshot_id !== null && row.approved_verification_id !== null && row.approved_report_hash !== null &&
    row.approved_manifest_version !== null && row.approved_manifest_hash !== null && row.approved_gh_version !== null &&
    row.approved_at !== null && row.approved_by !== null
      ? {
          snapshotId: row.approved_snapshot_id,
          verificationId: row.approved_verification_id,
          reportHash: row.approved_report_hash,
          manifestVersion: row.approved_manifest_version,
          manifestHash: row.approved_manifest_hash,
          ghVersion: row.approved_gh_version,
          approvedAt: row.approved_at,
          approvedBy: row.approved_by,
        }
      : null;
  return { scope, revision: row.revision, approval, blockedCapabilities: row.blocked_capabilities, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

/** 배포 범위의 현재 정책. 한 번도 바뀐 적이 없으면 `null`이다(revision 0·승인 없음·차단 없음으로 읽는다). */
export async function findPolicy(db: Queryable, scope: string): Promise<GhPolicyRow | null> {
  const result = await db.query<GhPolicyRow>('SELECT * FROM gh_operations_policy WHERE scope = $1', [scope]);
  return result.rows[0] ?? null;
}

/**
 * 정책 잠금(공유)을 이 트랜잭션에 건다 — 실행권 확정이 쓴다. 정책 변경(배타)이 커밋되기 전에는 여기서 기다리고,
 * 그 뒤에는 바뀐 정책을 읽는다. 트랜잭션이 끝나면 풀린다. `lock_timeout`을 넘기면 55P03으로 던진다.
 */
export async function lockPolicyShared(client: PoolClient, scope: string, lockTimeoutMs = 10_000): Promise<void> {
  await client.query(`SET LOCAL lock_timeout = ${String(Math.trunc(lockTimeoutMs))}`);
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [ghPolicyLockKey(scope)]);
}

/**
 * 정책 잠금(배타)을 이 트랜잭션에 건다 — 승인 판정과 변경 함수 호출을 **한 잠금 안에** 두려는 search-api가 쓴다.
 * 함수도 같은 키를 다시 잡는다(같은 트랜잭션이면 이미 쥔 잠금이다).
 */
export async function lockPolicyExclusive(client: PoolClient, scope: string, lockTimeoutMs = 10_000): Promise<void> {
  await client.query(`SET LOCAL lock_timeout = ${String(Math.trunc(lockTimeoutMs))}`);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ghPolicyLockKey(scope)]);
}

export interface GhPolicyRevisionRow {
  readonly revision_id: number;
  readonly scope: string;
  readonly revision: number;
  readonly previous_revision: number;
  readonly action: GhPolicyAction;
  readonly capability_id: string | null;
  readonly snapshot_id: number | null;
  readonly verification_id: number | null;
  readonly report_hash: string | null;
  readonly manifest_version: string | null;
  readonly manifest_hash: string | null;
  readonly gh_version: string | null;
  readonly actor: string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly created_at: Date;
}

export const POLICY_REVISION_LIST_MAX = 100;

/** 최근 revision부터. 중복 방지 키와 요청 지문은 조회 화면에 내지 않는다 — 호출자가 고른다. */
export async function listPolicyRevisions(db: Queryable, scope: string, limit = 20): Promise<GhPolicyRevisionRow[]> {
  const result = await db.query<GhPolicyRevisionRow>(
    'SELECT * FROM gh_operations_policy_revision WHERE scope = $1 ORDER BY revision DESC LIMIT $2',
    [scope, Math.max(1, Math.min(limit, POLICY_REVISION_LIST_MAX))],
  );
  return result.rows;
}

/**
 * 같은 행위자·같은 중복 방지 키로 이미 만든 revision. 있으면 호출자는 자격을 다시 판정하지 않고 함수에 그대로 넘긴다 —
 * 함수가 같은 지문이면 기존 결과(replayed)를, 다르면 거절(PRS02)을 낸다. 이미 적용된 승인의 재요청을 「이미 승인됨」으로
 * 거절하지 않기 위해서다.
 */
export async function findRevisionByKey(db: Queryable, scope: string, actor: string, idempotencyKey: string): Promise<GhPolicyRevisionRow | null> {
  const result = await db.query<GhPolicyRevisionRow>(
    'SELECT * FROM gh_operations_policy_revision WHERE scope = $1 AND actor = $2 AND idempotency_key = $3',
    [scope, actor, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export interface ApplyPolicyChangeInput {
  readonly scope: string;
  readonly action: GhPolicyAction;
  readonly expectedRevision: number;
  readonly actor: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** 같은 키의 재요청이 같은 내용인지 가르는 sha256 hex. 호출자가 행위·대상·근거·사유로 만든다. */
  readonly requestFingerprint: string;
  readonly capabilityId?: string | null;
  readonly snapshotId?: number | null;
  readonly verificationId?: number | null;
  readonly reportHash?: string | null;
  readonly evidenceMaxAgeMs?: number | null;
}

export interface ApplyPolicyChangeResult {
  readonly outcome: 'applied' | 'replayed';
  readonly revision: number;
  readonly revisionId: number;
}

/** 함수가 거절한 변경. `reason`은 함수의 사유 코드(`revision_changed`, `evidence_stale` …)다. */
export type PolicyChangeRejectionKind = 'conflict' | 'key_reused' | 'ineligible' | 'no_change' | 'invalid';

export class PolicyChangeRejected extends Error {
  constructor(
    readonly kind: PolicyChangeRejectionKind,
    readonly reason: string,
    /** 충돌이면 현재 revision, 키 재사용이면 그 키가 만든 revision. 없으면 `null`. */
    readonly detail: string | null,
  ) {
    super(`운영 정책 변경이 거절됐다: ${kind}/${reason}`);
    this.name = 'PolicyChangeRejected';
  }
}

const SQLSTATE_KIND: ReadonlyMap<string, PolicyChangeRejectionKind> = new Map([
  ['PRS01', 'conflict'],
  ['PRS02', 'key_reused'],
  ['PRS03', 'ineligible'],
  ['PRS04', 'no_change'],
  ['PRS05', 'invalid'],
]);

/** 실행권 확정 가드가 거절했다 (PRS10: revision 누락·변경·대기 아닌 새 행, PRS11: 현재 정책과 다름). */
export function isPolicyGuardViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PRS10' || code === 'PRS11';
}

/**
 * 정책 잠금을 `lock_timeout` 안에 얻지 못했다(`55P03` lock_not_available). 다른 변경이 배타 잠금을 오래 쥐었다는 뜻이며,
 * 트랜잭션 전체가 롤백되므로 이 트랜잭션이 쓴 것은 없다 — 판정의 거절이 아니라 「지금은 판정할 수 없음」이다.
 */
export function isPolicyLockTimeout(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '55P03';
}

/**
 * 정책을 바꾼다. 트랜잭션은 호출자가 연다 — 판정과 호출을 같은 잠금 안에 두기 위해서다. 함수가 던지면 그 트랜잭션은
 * 이미 중단됐으므로 호출자는 롤백해야 한다(`withTransaction`이 한다).
 *
 * @throws {PolicyChangeRejected} 함수가 거절하면.
 */
export async function applyPolicyChange(client: Queryable, input: ApplyPolicyChangeInput): Promise<ApplyPolicyChangeResult> {
  try {
    const result = await client.query<{ outcome: string; revision: number; revision_id: number }>(
      `SELECT outcome, revision, revision_id
         FROM gh_operations_policy_apply($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.scope,
        input.action,
        input.expectedRevision,
        input.actor,
        input.reason,
        input.correlationId,
        input.idempotencyKey,
        input.requestFingerprint,
        input.capabilityId ?? null,
        input.snapshotId ?? null,
        input.verificationId ?? null,
        input.reportHash ?? null,
        input.evidenceMaxAgeMs ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined || (row.outcome !== 'applied' && row.outcome !== 'replayed')) throw new Error('unreachable: 정책 변경 함수가 결과를 돌려주지 않았다');
    return { outcome: row.outcome, revision: row.revision, revisionId: row.revision_id };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const kind = code === undefined ? undefined : SQLSTATE_KIND.get(code);
    if (kind !== undefined) {
      throw new PolicyChangeRejected(kind, (error as Error).message, (error as { detail?: string }).detail ?? null);
    }
    throw error;
  }
}
