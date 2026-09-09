/** FR-SEQ-007 / WP-042: 개인별 이분 탐색의 정본과 원자적 축소. */
import type { Pool, PoolClient } from 'pg';
import { advisoryXactLock } from '../advisory-lock.js';
import { withTransaction } from '../pool.js';

export interface BisectPoint {
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly pull_request_number: number | null;
}
export interface BisectView {
  readonly session_id: string;
  readonly seq_epoch: number;
  readonly good_seq: number;
  readonly bad_seq: number;
  readonly epoch_stale: boolean;
  readonly remaining: number | null;
  readonly estimated_steps: number | null;
  readonly next: BisectPoint | null;
  readonly result: BisectPoint | null;
  readonly converged: boolean;
}
interface Row {
  session_id: string;
  seq_epoch: number;
  good_seq: number;
  bad_seq: number;
}
export type BisectAction =
  | { kind: 'read' }
  | { kind: 'start'; seqEpoch: number; fromSeq: number; toSeq: number }
  | { kind: 'mark'; seqEpoch: number; sessionId: string; mergeSeq: number; verdict: 'good' | 'bad' }
  | { kind: 'reset'; sessionId: string };
export type BisectOutcome =
  | { kind: 'ok'; seqEpoch: number; session: BisectView | null }
  | { kind: 'missing' }
  | { kind: 'stale'; seqEpoch: number }
  | { kind: 'session_missing' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'contradiction'; goodSeq: number; badSeq: number };

const columns = 'session_id::text, seq_epoch, good_seq::float8, bad_seq::float8';

async function view(client: PoolClient, repositoryId: number, branch: string, row: Row, epoch: number, reassigning: boolean): Promise<BisectView> {
  const base = { ...row, epoch_stale: row.seq_epoch !== epoch || reassigning };
  if (base.epoch_stale) return { ...base, remaining: null, estimated_steps: null, next: null, result: null, converged: false };
  const args = [repositoryId, branch, row.seq_epoch, row.good_seq, row.bad_seq];
  const count = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM merge_sequence WHERE repository_id=$1 AND base_branch=$2
     AND seq_epoch=$3 AND merge_seq>$4 AND merge_seq<=$5`, args);
  const remaining = count.rows[0]?.n ?? 0;
  const points = await client.query<BisectPoint>(
    `SELECT merge_seq::float8, commit_sha, pull_request_number FROM merge_sequence
     WHERE repository_id=$1 AND base_branch=$2 AND seq_epoch=$3 AND merge_seq>$4 AND merge_seq<=$5
     AND ($6::boolean OR merge_seq<$5)
     ORDER BY abs(merge_seq::numeric - ($4::numeric + $5::numeric)/2), merge_seq LIMIT 1`,
    [...args, remaining === 1]);
  const point = points.rows[0] ?? null;
  return { ...base, remaining, estimated_steps: remaining > 0 ? Math.ceil(Math.log2(remaining)) : 0,
    next: remaining > 1 ? point : null, result: remaining === 1 ? point : null, converged: remaining === 1 };
}

export async function applyBisectAction(pool: Pool, userId: string, repositoryId: number, branch: string, action: BisectAction): Promise<BisectOutcome> {
  return withTransaction(pool, async (client) => {
    // 첫 생성과 삭제도 같은 잠금을 지난다. 행이 없을 때 FOR UPDATE만으로는 부족하다.
    await advisoryXactLock(client, JSON.stringify(['bisect', userId, repositoryId, branch]));
    const space = await client.query<{ seq_epoch: number; state: string }>(
      'SELECT seq_epoch, state FROM sequence_space WHERE repository_id=$1 AND base_branch=$2 FOR SHARE', [repositoryId, branch]);
    const current = space.rows[0];
    if (current === undefined) return { kind: 'missing' };
    const key = [userId, repositoryId, branch];
    const stored = await client.query<Row>(`SELECT ${columns} FROM bisect_session WHERE user_id=$1 AND repository_id=$2 AND base_branch=$3`, key);
    let row = stored.rows[0];
    if (action.kind === 'reset') {
      if (row !== undefined && row.session_id !== action.sessionId) return { kind: 'session_missing' };
      await client.query('DELETE FROM bisect_session WHERE user_id=$1 AND repository_id=$2 AND base_branch=$3 AND session_id=$4', [...key, action.sessionId]);
      return { kind: 'ok', seqEpoch: current.seq_epoch, session: null };
    }
    if (action.kind !== 'read') {
      if (action.seqEpoch !== current.seq_epoch || current.state === 'reassigning' || (row !== undefined && row.seq_epoch !== current.seq_epoch)) {
        return { kind: 'stale', seqEpoch: current.seq_epoch };
      }
      if (action.kind === 'mark' && (row === undefined || row.session_id !== action.sessionId)) return { kind: 'session_missing' };
      if (action.kind === 'start' && row === undefined) {
        if (action.fromSeq >= action.toSeq) return { kind: 'invalid', reason: '조사 구간은 from_seq < to_seq여야 합니다.' };
        const endpoints = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM merge_sequence WHERE repository_id=$1 AND base_branch=$2 AND seq_epoch=$3 AND merge_seq=ANY($4::bigint[])`,
          [repositoryId, branch, current.seq_epoch, [action.fromSeq, action.toSeq].filter((n) => n !== 0)]);
        if (endpoints.rows[0]?.n !== (action.fromSeq === 0 ? 1 : 2)) return { kind: 'invalid', reason: '구간 경계는 실재 시퀀스여야 합니다 (시작 0 제외).' };
        const inserted = await client.query<Row>(
          `INSERT INTO bisect_session (user_id,repository_id,base_branch,seq_epoch,good_seq,bad_seq)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${columns}`, [...key, current.seq_epoch, action.fromSeq, action.toSeq]);
        row = inserted.rows[0];
      } else if (action.kind === 'mark' && row !== undefined) {
        const good = action.verdict === 'good' ? Math.max(row.good_seq, action.mergeSeq) : row.good_seq;
        const bad = action.verdict === 'bad' ? Math.min(row.bad_seq, action.mergeSeq) : row.bad_seq;
        if (good >= bad) return { kind: 'contradiction', goodSeq: good, badSeq: bad };
        const point = await client.query('SELECT 1 FROM merge_sequence WHERE repository_id=$1 AND base_branch=$2 AND seq_epoch=$3 AND merge_seq=$4', [repositoryId, branch, current.seq_epoch, action.mergeSeq]);
        if (point.rowCount !== 1) return { kind: 'invalid', reason: '표시 지점이 실재 시퀀스가 아닙니다.' };
        const updated = await client.query<Row>(
          `UPDATE bisect_session SET good_seq=$4,bad_seq=$5,updated_at=now()
           WHERE user_id=$1 AND repository_id=$2 AND base_branch=$3 RETURNING ${columns}`, [...key, good, bad]);
        row = updated.rows[0];
      }
    }
    return { kind: 'ok', seqEpoch: current.seq_epoch, session: row === undefined ? null : await view(client, repositoryId, branch, row, current.seq_epoch, current.state === 'reassigning') };
  });
}
