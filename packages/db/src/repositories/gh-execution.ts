/**
 * 실행 기록 리포지터리 (ENT-GH-002, FR-GH-006·FR-GH-012, WP-047·WP-048 일부).
 *
 * 이 표는 감사 축이자 상태 기계다. 상태 전이는 전부 **조건부 UPDATE**다 — 「queued일
 * 때만 running으로」처럼 현재 상태를 WHERE에 걸어, 두 실행기가 같은 행을 집거나
 * 취소된 실행이 뒤늦게 성공으로 덮이는 일이 DB에서 막힌다.
 *
 * `execution_id`만으로 찾는 조회는 파티션 전체를 본다. 이력 규모(1년, 사용자 요청
 * 건수)에서 그 비용은 작고, 파티션 키를 클라이언트에 노출하지 않는 편이 낫다.
 */

import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../pool.js';

type Queryable = Pool | PoolClient;

export type GhExecutionState =
  | 'queued'
  | 'preflighting'
  | 'awaiting_confirmation'
  | 'awaiting_approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'policy_blocked';

export interface GhExecutionRow {
  readonly execution_id: number;
  readonly requested_at: Date;
  readonly user_id: string;
  readonly github_actor: string;
  readonly host: string;
  readonly repository: string | null;
  readonly repository_id: number | null;
  readonly target: string | null;
  readonly capability_id: string;
  readonly invocation: Record<string, unknown>;
  readonly context: Record<string, unknown>;
  readonly redacted_argv: string[];
  readonly env_keys: string[];
  readonly risk_level: string;
  readonly state: GhExecutionState;
  readonly gh_version: string;
  readonly manifest_version: string;
  readonly manifest_hash: string;
  readonly idempotency_key: string;
  readonly authorization_result: string;
  readonly confirmed_at: Date | null;
  readonly approval_id: number | null;
  readonly executor_id: string | null;
  readonly claimed_at: Date | null;
  readonly heartbeat_at: Date | null;
  readonly started_at: Date | null;
  readonly finished_at: Date | null;
  readonly cancel_requested_at: Date | null;
  readonly cancel_requested_by: string | null;
  readonly exit_code: number | null;
  readonly output_hash: string | null;
  readonly error: string | null;
  readonly result: Record<string, unknown> | null;
  readonly stdout_excerpt: string | null;
  readonly stderr_excerpt: string | null;
  readonly stdout_truncated: boolean;
  readonly stderr_truncated: boolean;
  readonly output_binary: boolean;
  readonly correlation_id: string;
  /** 요청을 수락한 시점의 운영 정책 revision (CR-090). 030 이전의 행은 `null`이며 실행되지 않는다. */
  readonly policy_revision: number | null;
}

export interface GhExecutionInsert {
  readonly userId: string;
  readonly githubActor: string;
  readonly host: string;
  readonly repository: string;
  readonly repositoryId: number;
  readonly capabilityId: string;
  readonly invocation: Record<string, unknown>;
  readonly context: Record<string, unknown>;
  readonly redactedArgv: readonly string[];
  readonly envKeys: readonly string[];
  readonly riskLevel: string;
  readonly ghVersion: string;
  readonly manifestVersion: string;
  readonly manifestHash: string;
  readonly idempotencyKey: string;
  readonly authorizationResult: string;
  readonly correlationId: string;
  /** 수락 판정이 본 운영 정책 revision. 실행권 확정 때 현재 revision과 같아야 한다 (FR-GH-011 AC-9). */
  readonly policyRevision: number;
}

/** 같은 사용자·같은 키가 이미 있다 — 새 실행을 만들지 않았다. */
export class DuplicateIdempotencyKeyError extends Error {
  constructor(readonly executionId: number) {
    super(`중복 방지 키가 이미 있다 (실행 ${String(executionId)})`);
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

/**
 * 실행 요청을 `queued`로 남긴다 (감사 선기록 — 백엔드 12.2의 11번).
 *
 * **한 트랜잭션이다.** 먼저 `gh_execution_idempotency`에 키를 넣고(충돌이면 아무 행도
 * 만들지 않고 던진다), 그다음 실행 행을 넣고, 키 행에 실행 ID를 적는다. 경합하는 두
 * 요청 중 하나만 키를 잡으므로 실행은 하나다 (FR-GH-012 AC-5).
 *
 * @throws {DuplicateIdempotencyKeyError} 같은 키가 이미 있으면.
 */
export async function insertExecution(pool: Pool, input: GhExecutionInsert): Promise<GhExecutionRow> {
  return withTransaction(pool, async (client) => {
    const reserved = await client.query<{ execution_id: number }>(
      `INSERT INTO gh_execution_idempotency (user_id, idempotency_key, execution_id)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING execution_id`,
      [input.userId, input.idempotencyKey],
    );
    if (reserved.rowCount === 0) {
      const existing = await client.query<{ execution_id: number }>(
        'SELECT execution_id FROM gh_execution_idempotency WHERE user_id = $1 AND idempotency_key = $2',
        [input.userId, input.idempotencyKey],
      );
      throw new DuplicateIdempotencyKeyError(existing.rows[0]?.execution_id ?? 0);
    }

    const result = await client.query<GhExecutionRow>(
      `INSERT INTO gh_execution
         (user_id, github_actor, host, repository, repository_id, target, capability_id, invocation, context,
          redacted_argv, env_keys, risk_level, state, gh_version, manifest_version, manifest_hash,
          idempotency_key, authorization_result, correlation_id, policy_revision)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::jsonb, $8::jsonb, $9, $10, $11, 'queued', $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        input.userId,
        input.githubActor,
        input.host,
        input.repository,
        input.repositoryId,
        input.capabilityId,
        JSON.stringify(input.invocation),
        JSON.stringify(input.context),
        [...input.redactedArgv],
        [...input.envKeys],
        input.riskLevel,
        input.ghVersion,
        input.manifestVersion,
        input.manifestHash,
        input.idempotencyKey,
        input.authorizationResult,
        input.correlationId,
        input.policyRevision,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('실행 기록 INSERT가 행을 돌려주지 않았다');
    await client.query(
      'UPDATE gh_execution_idempotency SET execution_id = $3, requested_at = $4 WHERE user_id = $1 AND idempotency_key = $2',
      [input.userId, input.idempotencyKey, row.execution_id, row.requested_at],
    );
    return row;
  });
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export async function findById(db: Queryable, executionId: number): Promise<GhExecutionRow | null> {
  const result = await db.query<GhExecutionRow>('SELECT * FROM gh_execution WHERE execution_id = $1', [executionId]);
  return result.rows[0] ?? null;
}

/** 같은 사용자·같은 키의 실행. 보조 표가 정본이므로 달을 넘어도 잡는다. */
export async function findByIdempotencyKey(db: Queryable, userId: string, key: string): Promise<GhExecutionRow | null> {
  const reserved = await db.query<{ execution_id: number }>(
    'SELECT execution_id FROM gh_execution_idempotency WHERE user_id = $1 AND idempotency_key = $2',
    [userId, key],
  );
  const executionId = reserved.rows[0]?.execution_id;
  if (executionId === undefined || executionId === 0) return null;
  return findById(db, executionId);
}

export interface ExecutionListFilter {
  /** 없으면 전체 — `security_officer`만 그렇게 부른다. */
  readonly userId?: string;
  readonly limit?: number;
  /** 이 실행 ID보다 오래된 것만 (키셋). */
  readonly beforeId?: number;
}

export const EXECUTION_LIST_DEFAULT_LIMIT = 50;
export const EXECUTION_LIST_MAX_LIMIT = 100;

export async function listExecutions(db: Queryable, filter: ExecutionListFilter = {}): Promise<GhExecutionRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.userId !== undefined) {
    params.push(filter.userId);
    where.push(`user_id = $${String(params.length)}`);
  }
  if (filter.beforeId !== undefined) {
    params.push(filter.beforeId);
    where.push(`execution_id < $${String(params.length)}`);
  }
  params.push(Math.min(filter.limit ?? EXECUTION_LIST_DEFAULT_LIMIT, EXECUTION_LIST_MAX_LIMIT));
  const result = await db.query<GhExecutionRow>(
    `SELECT * FROM gh_execution
      ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
      ORDER BY execution_id DESC
      LIMIT $${String(params.length)}`,
    params,
  );
  return result.rows;
}

/**
 * `queued` → `running` 원자적 claim. 두 실행기가 같은 행을 집지 못한다.
 *
 * @returns 집었으면 그 행, 이미 남이 집었거나 취소됐으면 `null`.
 */
export async function claimExecution(db: Queryable, executionId: number, executorId: string): Promise<GhExecutionRow | null> {
  const result = await db.query<GhExecutionRow>(
    `UPDATE gh_execution
        SET state = 'running', executor_id = $2, claimed_at = now(), heartbeat_at = now(), started_at = now()
      WHERE execution_id = $1 AND state = 'queued' AND cancel_requested_at IS NULL
      RETURNING *`,
    [executionId, executorId],
  );
  return result.rows[0] ?? null;
}

export async function heartbeat(db: Queryable, executionId: number, executorId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE gh_execution SET heartbeat_at = now()
      WHERE execution_id = $1 AND executor_id = $2 AND state = 'running'`,
    [executionId, executorId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 취소 요청. `queued`·`running`에만 걸린다. 종료된 실행은 그대로다. */
export async function requestCancel(db: Queryable, executionId: number, by: string): Promise<GhExecutionRow | null> {
  const result = await db.query<GhExecutionRow>(
    `UPDATE gh_execution
        SET cancel_requested_at = COALESCE(cancel_requested_at, now()), cancel_requested_by = COALESCE(cancel_requested_by, $2)
      WHERE execution_id = $1 AND state IN ('queued', 'running')
      RETURNING *`,
    [executionId, by],
  );
  return result.rows[0] ?? null;
}

/** 큐에서 집기 전에 취소된 것을 종료 상태로 옮긴다. */
export async function cancelQueued(db: Queryable, executionId: number): Promise<GhExecutionRow | null> {
  const result = await db.query<GhExecutionRow>(
    `UPDATE gh_execution
        SET state = 'cancelled', finished_at = now(), error = 'cancelled_before_start'
      WHERE execution_id = $1 AND state = 'queued' AND cancel_requested_at IS NOT NULL
      RETURNING *`,
    [executionId],
  );
  return result.rows[0] ?? null;
}

export async function isCancelRequested(db: Queryable, executionId: number): Promise<boolean> {
  const result = await db.query<{ requested: boolean }>(
    'SELECT cancel_requested_at IS NOT NULL AS requested FROM gh_execution WHERE execution_id = $1',
    [executionId],
  );
  return result.rows[0]?.requested === true;
}

export interface ExecutionOutcome {
  readonly state: Extract<GhExecutionState, 'succeeded' | 'failed' | 'cancelled' | 'timed_out'>;
  readonly exitCode: number | null;
  readonly outputHash: string | null;
  readonly error: string | null;
  readonly result: Record<string, unknown> | null;
  readonly stdoutExcerpt: string | null;
  readonly stderrExcerpt: string | null;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly outputBinary: boolean;
  readonly envKeys?: readonly string[];
}

/**
 * `running` → 종료 상태. **이 실행기가 집은 행만** 닫는다 — 회수된 뒤 뒤늦게 돌아온
 * 결과가 회수 판정을 덮지 않는다.
 */
export async function finishExecution(
  db: Queryable,
  executionId: number,
  executorId: string,
  outcome: ExecutionOutcome,
): Promise<GhExecutionRow | null> {
  const result = await db.query<GhExecutionRow>(
    `UPDATE gh_execution
        SET state = $3, finished_at = now(), exit_code = $4, output_hash = $5, error = $6,
            result = $7::jsonb, stdout_excerpt = $8, stderr_excerpt = $9,
            stdout_truncated = $10, stderr_truncated = $11, output_binary = $12,
            env_keys = COALESCE($13, env_keys)
      WHERE execution_id = $1 AND executor_id = $2 AND state = 'running'
      RETURNING *`,
    [
      executionId,
      executorId,
      outcome.state,
      outcome.exitCode,
      outcome.outputHash,
      outcome.error === null ? null : outcome.error.slice(0, 1000),
      outcome.result === null ? null : JSON.stringify(outcome.result),
      outcome.stdoutExcerpt,
      outcome.stderrExcerpt,
      outcome.stdoutTruncated,
      outcome.stderrTruncated,
      outcome.outputBinary,
      outcome.envKeys === undefined ? null : [...outcome.envKeys],
    ],
  );
  return result.rows[0] ?? null;
}

/**
 * 운영 정책 때문에 집지 않은 대기 요청을 닫는다 (FR-GH-011 AC-9, FR-GH-009 AC-8, CR-090). `queued`일 때만.
 *
 * 상태는 `policy_blocked`(종료)이고 `error`가 사유 코드다 — `admin_action_required`·`policy_blocked`·`policy_changed`.
 * 닫힌 요청은 다시 실행되지 않는다. 사용자가 새 요청으로 다시 제출한다.
 */
export async function closeQueuedByPolicy(db: Queryable, executionId: number, reason: string): Promise<GhExecutionRow | null> {
  const result = await db.query<GhExecutionRow>(
    `UPDATE gh_execution SET state = 'policy_blocked', finished_at = now(), error = $2
      WHERE execution_id = $1 AND state = 'queued'
      RETURNING *`,
    [executionId, reason.slice(0, 1000)],
  );
  return result.rows[0] ?? null;
}

/** 집기 전에 실패로 닫는다 (재검증 탈락·registry stale). `queued`일 때만. */
export async function failQueued(db: Queryable, executionId: number, error: string): Promise<GhExecutionRow | null> {
  const result = await db.query<GhExecutionRow>(
    `UPDATE gh_execution SET state = 'failed', finished_at = now(), error = $2
      WHERE execution_id = $1 AND state = 'queued'
      RETURNING *`,
    [executionId, error.slice(0, 1000)],
  );
  return result.rows[0] ?? null;
}

/**
 * 고아 회수 (JOB-GH-007, NFR-012 상태 정합성). 하트비트가 끊긴 `running`을 `failed`로.
 *
 * @returns 회수한 실행 ID.
 */
export async function reclaimOrphans(db: Queryable, staleBefore: Date): Promise<number[]> {
  const result = await db.query<{ execution_id: number }>(
    `UPDATE gh_execution
        SET state = 'failed', finished_at = now(), error = 'executor_lost'
      WHERE state = 'running' AND heartbeat_at IS NOT NULL AND heartbeat_at < $1
      RETURNING execution_id`,
    [staleBefore],
  );
  return result.rows.map((row) => row.execution_id);
}

/** 큐에 오래 남은 `queued` — 이벤트가 유실됐거나 발행이 실패한 것. 스윕이 집는다. */
export async function listStaleQueued(db: Queryable, olderThan: Date, limit = 20): Promise<number[]> {
  const result = await db.query<{ execution_id: number }>(
    `SELECT execution_id FROM gh_execution
      WHERE state = 'queued' AND requested_at < $1
      ORDER BY requested_at ASC LIMIT $2`,
    [olderThan, limit],
  );
  return result.rows.map((row) => row.execution_id);
}
