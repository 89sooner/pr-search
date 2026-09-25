/**
 * 스택 관계의 정본 (WP-104 / CR-121, FR-REL-006 AC-3·AC-6, OD-017, ENT-REL-003).
 *
 * `stacks_on` 간선은 이 표에서 파생한다. 성립 조건(「하위 PR의 base = 다른 **열린** PR의
 * head」)은 상위 PR이 병합되거나 하위 PR이 retarget되는 순간 현재 스냅숏에서 사라지는데,
 * FR-REL-006 AC-3은 그때 간선을 지우지 말고 해제 상태로 남기라고 요구한다. 그 사실을 색인에만
 * 두면 재색인이 PostgreSQL에서 다시 만들 수 없다(ADR-004) — 그래서 여기 둔다.
 *
 * 규칙은 셋이다.
 *
 * 1. **성립한 적 있는 관계만 행이 된다**(DEV-238). 한 번도 성립하지 않은 후보에 해제 상태를
 *    미리 두지 않는다.
 * 2. **행을 지우지 않는다.** 성립하지 않게 되면 `detached = true`, 다시 성립하면 `false`다.
 * 3. **`edge_created_at`은 성립해 있는 동안만 갱신한다.** 간선 문서의 `created_at`은 source의
 *    정본 시각이고(CR-039), 해제된 간선은 마지막으로 성립했을 때의 값을 유지해 왔다. 같은
 *    정본에서 재구축과 평시 파생이 같은 문서를 내게 하는 규칙이다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type StackOrigin = 'derived' | 'imported';

export interface StackRow {
  readonly repository_id: number;
  readonly child_pr_number: number;
  readonly parent_pr_number: number;
  readonly evidence: string;
  readonly edge_created_at: string;
  readonly detached: boolean;
  readonly origin: StackOrigin;
}

/** 지금 성립하는 관계 하나 — `planStacks`가 현재 스냅숏에서 찾은 것이다. */
export interface StackDesired {
  readonly parentPrNumber: number;
  readonly evidence: string;
  readonly edgeCreatedAt: string;
}

const COLUMNS = 'repository_id, child_pr_number, parent_pr_number, evidence, edge_created_at, detached, origin';

function toRow(raw: {
  repository_id: string | number;
  child_pr_number: number;
  parent_pr_number: number;
  evidence: string;
  edge_created_at: string;
  detached: boolean;
  origin: StackOrigin;
}): StackRow {
  return {
    repository_id: Number(raw.repository_id),
    child_pr_number: Number(raw.child_pr_number),
    parent_pr_number: Number(raw.parent_pr_number),
    evidence: raw.evidence,
    edge_created_at: raw.edge_created_at,
    detached: raw.detached,
    origin: raw.origin,
  };
}

/** `reconcileStacks`의 결과. */
export interface StackReconcileResult {
  /** 그 하위 PR의 모든 행(성립·해제). 간선은 이것에서 만든다. */
  readonly rows: readonly StackRow[];
  /** 이번에 새로 해제된 관계 수 — 파생 로그가 센다. */
  readonly detachedNow: number;
}

/**
 * 하위 PR 하나의 스택 행을 지금 성립하는 집합에 맞춘다. 결과는 그 하위 PR의 **모든** 행이다.
 *
 * - 성립하는 관계: 행을 만들거나 `detached = false`로 되돌리고 근거·시각을 지금 값으로 쓴다.
 *   가져온 행(`imported`)이 다시 성립하면 파생 행이 된다.
 * - 성립하지 않는 기존 행: `detached = true`. 근거·시각은 그대로 둔다(규칙 3).
 *
 * 한 트랜잭션이다 — 중간에 끊겨 「새 관계는 들어갔는데 옛 관계는 해제되지 않은」 상태가
 * 남지 않는다. 같은 하위 PR을 동시에 파생하면 행 잠금이 둘을 줄 세운다.
 */
export async function reconcileStacks(
  pool: Pool,
  repositoryId: number,
  childPrNumber: number,
  desired: readonly StackDesired[],
): Promise<StackReconcileResult> {
  const parents = desired.map((one) => one.parentPrNumber);
  if (new Set(parents).size !== parents.length) throw new Error('stack_desired_duplicate_parent');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (desired.length > 0) {
      await client.query(
        `INSERT INTO pull_request_stack (${COLUMNS})
         SELECT $1, $2, d.parent_pr_number, d.evidence, d.edge_created_at, false, 'derived'
           FROM unnest($3::int[], $4::text[], $5::text[]) AS d(parent_pr_number, evidence, edge_created_at)
         ON CONFLICT (repository_id, child_pr_number, parent_pr_number) DO UPDATE
            SET evidence = EXCLUDED.evidence,
                edge_created_at = EXCLUDED.edge_created_at,
                detached = false,
                origin = 'derived',
                updated_at = clock_timestamp()
          WHERE pull_request_stack.detached
             OR pull_request_stack.origin <> 'derived'
             OR pull_request_stack.evidence IS DISTINCT FROM EXCLUDED.evidence
             OR pull_request_stack.edge_created_at IS DISTINCT FROM EXCLUDED.edge_created_at`,
        [
          repositoryId,
          childPrNumber,
          parents,
          desired.map((one) => one.evidence),
          desired.map((one) => one.edgeCreatedAt),
        ],
      );
    }
    const detached = await client.query(
      `UPDATE pull_request_stack
          SET detached = true, updated_at = clock_timestamp()
        WHERE repository_id = $1 AND child_pr_number = $2 AND NOT detached
          AND NOT (parent_pr_number = ANY($3::int[]))`,
      [repositoryId, childPrNumber, parents],
    );
    const rows = await client.query(
      `SELECT ${COLUMNS} FROM pull_request_stack
        WHERE repository_id = $1 AND child_pr_number = $2
        ORDER BY parent_pr_number`,
      [repositoryId, childPrNumber],
    );
    await client.query('COMMIT');
    return { rows: rows.rows.map(toRow), detachedNow: detached.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 기존 행과 지금 성립하는 집합을 합친 결과 — `reconcileStacks`와 **같은 규칙을 쓰기 없이** 계산한다.
 * 전환 전 검증이 쓴다. 규칙을 두 곳에 두지 않으려고 여기 둔다: 성립하는 관계는 지금 근거·시각으로
 * `detached = false`, 성립하지 않는 기존 행은 근거·시각을 유지한 채 `detached = true`.
 */
export function mergeStackRows(
  repositoryId: number,
  childPrNumber: number,
  existing: readonly StackRow[],
  desired: readonly StackDesired[],
): readonly StackRow[] {
  const merged = new Map<number, StackRow>();
  for (const one of desired) {
    merged.set(one.parentPrNumber, {
      repository_id: repositoryId,
      child_pr_number: childPrNumber,
      parent_pr_number: one.parentPrNumber,
      evidence: one.evidence,
      edge_created_at: one.edgeCreatedAt,
      detached: false,
      origin: 'derived',
    });
  }
  for (const row of existing) {
    if (merged.has(row.parent_pr_number)) continue;
    merged.set(row.parent_pr_number, { ...row, detached: true });
  }
  return [...merged.values()].sort((a, b) => a.parent_pr_number - b.parent_pr_number);
}

/** 하위 PR들의 스택 행. 전환 전 검증이 쓴다 — 읽기만 한다. */
export async function listStacksOfChildren(
  db: Queryable,
  repositoryId: number,
  childPrNumbers: readonly number[],
): Promise<ReadonlyMap<number, readonly StackRow[]>> {
  const out = new Map<number, StackRow[]>();
  const numbers = [...new Set(childPrNumbers)];
  if (numbers.length === 0) return out;
  const result = await db.query(
    `SELECT ${COLUMNS} FROM pull_request_stack
      WHERE repository_id = $1 AND child_pr_number = ANY($2::int[])
      ORDER BY child_pr_number, parent_pr_number`,
    [repositoryId, numbers],
  );
  for (const raw of result.rows) {
    const row = toRow(raw);
    const list = out.get(row.child_pr_number) ?? [];
    list.push(row);
    out.set(row.child_pr_number, list);
  }
  return out;
}

/**
 * 이 PR 위에 쌓였던(쌓인) 하위 PR 번호 — 역방향 재평가가 쓴다.
 *
 * 상위 PR이 병합·retarget되면 하위 PR에는 이벤트가 오지 않는다(DEV-232). 전에는 서비스 색인의
 * 간선으로 찾았는데, 정본은 이제 이 표다.
 */
export async function listChildrenOf(
  db: Queryable,
  repositoryId: number,
  parentPrNumber: number,
  limit: number,
): Promise<readonly number[]> {
  const result = await db.query<{ child_pr_number: number }>(
    `SELECT child_pr_number FROM pull_request_stack
      WHERE repository_id = $1 AND parent_pr_number = $2
      ORDER BY child_pr_number
      LIMIT $3`,
    [repositoryId, parentPrNumber, limit],
  );
  return result.rows.map((row) => Number(row.child_pr_number));
}

/** 서비스 인덱스에서 옮겨 올 행 하나 (일회성 가져오기). */
export interface StackImport {
  readonly repositoryId: number;
  readonly childPrNumber: number;
  readonly parentPrNumber: number;
  readonly evidence: string;
  readonly edgeCreatedAt: string;
  readonly detached: boolean;
}

/**
 * 배포 전부터 서비스 인덱스에만 있던 스택 간선을 옮긴다 (OD-017, 일회성).
 *
 * **파생 행을 덮지 않는다** — 이미 있는 관계는 정본이 이긴다(`ON CONFLICT DO NOTHING`).
 * 두 번 돌려도 같은 표다.
 */
export async function importStacks(
  db: Queryable,
  rows: readonly StackImport[],
): Promise<{ readonly inserted: number; readonly existing: number }> {
  if (rows.length === 0) return { inserted: 0, existing: 0 };
  const result = await db.query(
    `INSERT INTO pull_request_stack (${COLUMNS})
     SELECT r, c, p, e, t, d, 'imported'
       FROM unnest($1::bigint[], $2::int[], $3::int[], $4::text[], $5::text[], $6::boolean[]) AS x(r, c, p, e, t, d)
     ON CONFLICT (repository_id, child_pr_number, parent_pr_number) DO NOTHING`,
    [
      rows.map((one) => one.repositoryId),
      rows.map((one) => one.childPrNumber),
      rows.map((one) => one.parentPrNumber),
      rows.map((one) => one.evidence),
      rows.map((one) => one.edgeCreatedAt),
      rows.map((one) => one.detached),
    ],
  );
  const inserted = result.rowCount ?? 0;
  return { inserted, existing: rows.length - inserted };
}

/** 주어진 (하위, 상위) 쌍 가운데 표에 있는 것. 가져오기 확인(전환 전 검증)이 쓴다. */
export async function findExistingPairs(
  db: Queryable,
  repositoryId: number,
  pairs: readonly { readonly child: number; readonly parent: number }[],
): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  if (pairs.length === 0) return found;
  const result = await db.query<{ child_pr_number: number; parent_pr_number: number }>(
    `SELECT s.child_pr_number, s.parent_pr_number
       FROM pull_request_stack s
       JOIN unnest($2::int[], $3::int[]) AS q(child, parent)
         ON s.child_pr_number = q.child AND s.parent_pr_number = q.parent
      WHERE s.repository_id = $1`,
    [repositoryId, pairs.map((one) => one.child), pairs.map((one) => one.parent)],
  );
  for (const row of result.rows) found.add(`${String(row.child_pr_number)}:${String(row.parent_pr_number)}`);
  return found;
}
