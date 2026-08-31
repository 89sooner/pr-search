/**
 * 안전 구간 표식 리포지터리 (ENT-SEQ-003 / WP-041, CR-057).
 *
 * ## 여기가 소유하는 것
 *
 * "지금 이 시퀀스 공간의 현재 표식이 무엇인가"와 "그것을 어떻게 대체하는가"
 * 둘이다. **접근 통제는 여기 없다** — 시퀀스 공간을 얻는 통로가 이미 통제를
 * 지나며(`resolveSpace`), 저장소 ID를 받은 시점에는 그 판정이 끝나 있다.
 * 여기서 다시 하면 두 번째 경로가 생긴다 (ADR-008).
 *
 * ## 세 판정을 한 트랜잭션 안에서 한다
 *
 * `API-SEQ-004`의 검사 순서 7·8이 요구하는 것이 그것이다 — 현재 행을 읽고,
 * 완전 일치인지 보고, `expected`와 대조하고, 대체한다. 읽기와 쓰기 사이에
 * 다른 `PUT`이 끼어들면 **두 검사가 본 값과 실제로 대체되는 값이 갈린다.**
 *
 * `safe_marker_current_uk`는 그 직렬화를 만들지 못한다. 그 partial unique
 * index가 강제하는 것은 "현재 표식은 최대 하나"뿐이고, 제약은 잘못된 상태를
 * **거절할** 뿐 동시 요청의 **순서를 만들지 않는다.** 그리고 현재 표식이
 * 아예 없는 공간에서는 잠글 행조차 없어 `FOR UPDATE`가 닿지 않는다 — 첫
 * 등록 둘이 동시에 오면 둘 다 `INSERT`를 시도하고 한쪽이 23505로 튄다.
 * 그래서 공간 단위 advisory lock이 첫 관문이다.
 */

import type { Pool, PoolClient } from 'pg';
import { advisoryXactLock, safeMarkerLockKey } from '../advisory-lock.js';
import { withTransaction } from '../pool.js';

type Queryable = Pool | PoolClient;

export interface SafeMarkerRow {
  readonly marker_id: number;
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly merge_seq: number;
  readonly note: string | null;
  readonly created_by: string;
  /**
   * ISO 8601 UTC, **마이크로초까지**.
   *
   * `saved_search`와 같은 이유로 문자열로 받는다 — `node-postgres`의
   * timestamptz 파서가 주는 `Date`는 밀리초 정밀도라 값이 조용히 잘린다.
   * 표식의 등록 시각은 감사가 가리키는 사실이므로 그 절삭을 허용하지 않는다.
   */
  readonly created_at: string;
  readonly superseded_at: string | null;
}

/** 메모 상한 (FR-SEQ-006 AC-2). 마이그레이션 002의 `CHECK`와 같은 값이다. */
export const SAFE_MARKER_NOTE_LIMIT = 500;

const SELECT_COLUMNS = `
  marker_id, repository_id, base_branch, seq_epoch,
  merge_seq::int AS merge_seq, note, created_by,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS created_at,
  to_char(superseded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS superseded_at`;

/**
 * 그 공간의 현재 표식. 없으면 `null`.
 *
 * **`superseded_at IS NULL`이 현재의 정의다.** 가장 최근 행을 고르지 않는다 —
 * 대체가 실패해 이력만 남은 경우 그 둘이 갈리고, 유일 제약이 지키는 것은
 * 앞엣것이다.
 */
export async function findCurrentMarker(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
): Promise<SafeMarkerRow | null> {
  const { rows } = await db.query<SafeMarkerRow>(
    `SELECT ${SELECT_COLUMNS} FROM safe_marker
      WHERE repository_id = $1 AND base_branch = $2 AND superseded_at IS NULL`,
    [repositoryId, baseBranch],
  );
  return rows[0] ?? null;
}

export interface ReplaceMarkerInput {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly mergeSeq: number;
  readonly seqEpoch: number;
  readonly note: string | null;
  readonly createdBy: string;
  /**
   * 요청자가 본 현재 표식의 서수. 표식이 없는 상태를 봤으면 `null`.
   *
   * **"확인하지 않았다"를 표현하는 값이 아니다** — 라우트가 키의 존재를
   * 먼저 검증하므로 여기 닿는 `null`은 언제나 "없는 것을 봤다"이다.
   */
  readonly expectedMarkerSeq: number | null;
}

export type ReplaceMarkerOutcome =
  /** 현재 표식이 요청과 완전히 같다. 아무것도 쓰지 않았다. */
  | { readonly kind: 'unchanged'; readonly row: SafeMarkerRow }
  /** 대체했다. `replacedMergeSeq`는 직전 표식의 서수이며 첫 등록이면 `null`. */
  | { readonly kind: 'created'; readonly row: SafeMarkerRow; readonly replacedMergeSeq: number | null }
  /** 요청자가 본 표식이 더 이상 현재가 아니다. */
  | { readonly kind: 'conflict'; readonly currentMergeSeq: number | null };

/**
 * 현재 표식을 대체한다 (`API-SEQ-004` `PUT`).
 *
 * 순서가 계약이다: 공간 잠금 → 현재 읽기 → **완전 일치**(7) → **`expected`
 * 대조**(8) → 이력 기록 → 삽입.
 *
 * **7이 8보다 먼저인 것이 이 함수의 핵심이다** (DEV-464). 순서를 뒤집으면
 * 응답을 잃은 요청의 정직한 재시도가 **자기가 만든 상태 때문에** 충돌로
 * 거절된다 — 그 재시도의 `expected`는 이미 자기 자신이 낡게 만들었다.
 * 7이 먼저면 "이미 그 상태다"로 성공하고, 그 사이 **다른 값**이 끼어든
 * 경우에만 8이 걸린다.
 *
 * **`note`는 7의 재료다** (DEV-465). 서수와 에폭이 같아도 메모가 다르면
 * 그것은 재시도가 아니라 변경이며, `FR-SEQ-006` AC-5가 그 변경을 감사
 * 대상으로 요구한다. 백엔드 6.2의 멱등 키에 `note`가 없는 것은 그 키가
 * **같은 요청을 알아보는 재료**이기 때문이지 메모가 사소해서가 아니다.
 */
export async function replaceMarker(
  pool: Pool,
  input: ReplaceMarkerInput,
): Promise<ReplaceMarkerOutcome> {
  return withTransaction(pool, async (client) => {
    /*
     * 대기하는 락이다. 사람이 누르는 동기 요청이라 재큐할 곳이 없고, 겨루는
     * 상대도 같은 종류의 짧은 트랜잭션이다 — 채번 잡이 `try` + 재큐를 쓰는
     * 것과 반대 상황이다. `lock_timeout`이 그 대기를 잘라 응답이 무한정
     * 밀리지 않게 한다.
     */
    await advisoryXactLock(client, safeMarkerLockKey(input.repositoryId, input.baseBranch));

    const current = await findCurrentMarker(client, input.repositoryId, input.baseBranch);

    // 7. 완전 일치 — 아무것도 쓰지 않는다. 감사도 남기지 않는다.
    if (
      current !== null &&
      current.merge_seq === input.mergeSeq &&
      current.seq_epoch === input.seqEpoch &&
      current.note === input.note
    ) {
      return { kind: 'unchanged', row: current };
    }

    // 8. 요청자가 본 것이 아직 현재인가.
    const currentSeq = current === null ? null : current.merge_seq;
    if (currentSeq !== input.expectedMarkerSeq) {
      return { kind: 'conflict', currentMergeSeq: currentSeq };
    }

    if (current !== null) {
      await client.query(
        `UPDATE safe_marker SET superseded_at = now()
          WHERE marker_id = $1 AND superseded_at IS NULL`,
        [current.marker_id],
      );
    }

    const { rows } = await client.query<SafeMarkerRow>(
      `INSERT INTO safe_marker (repository_id, base_branch, seq_epoch, merge_seq, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.repositoryId,
        input.baseBranch,
        input.seqEpoch,
        input.mergeSeq,
        input.note,
        input.createdBy,
      ],
    );

    const row = rows[0];
    if (row === undefined) throw new Error('표식을 삽입했으나 행을 돌려받지 못했다');
    return { kind: 'created', row, replacedMergeSeq: currentSeq };
  });
}
