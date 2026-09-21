/**
 * `sequence_work` 리포지터리 (ENT-SEQ-006, FR-SEQ-008 AC-11 / WP-074, ADR-023, DEV-582).
 *
 * ## 왜 `raw_event`의 아웃박스를 재사용하지 않는가
 *
 * `JOB-ING-007`은 `prs:ingest`만 재발행하고 `processed_at`은 투영이 찍는다. push의
 * 채번 요청, 늦은 PR 스냅숏 뒤의 재개, 번호 커밋 뒤의 ES·이벤트 전달은 **그 표식이
 * 말하지 않는 상태**다. 그것을 `processed_at`에 겹쳐 쓰면 투영의 완료가 채번의
 * 완료로 읽힌다. 그래서 M 경로 전용 durable inbox/outbox를 따로 둔다.
 *
 * ## 키가 곧 멱등이다
 *
 * `refresh`는 전달 하나마다 한 행이고(`push:<delivery_id>`), 나머지는 공간·에폭
 * (·PR)마다 한 행이며 `requested_generation`으로 "다시 해야 한다"를 센다. 같은
 * 공간에 대한 요청이 백 번 와도 행은 하나다 — 행 수가 요청 수에 비례하지 않는다.
 *
 * ## 늦은 ack는 0행이다
 *
 * 모든 완료·재시도 갱신은 `lease_token`과 `state = 'leased'`를 함께 본다. lease가
 * 만료되어 다른 워커가 집어 간 뒤 옛 워커가 ack하면 **아무 행도 바뀌지 않는다.**
 * 그것이 "실패한 worker의 늦은 ack는 0행 갱신"이라는 계약이다 (상세 설계 6.3).
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

/**
 * `project`는 정본 시퀀스를 색인에 다시 비추는 의도다 (CR-113 / FR-SEQ-001 AC-7). M 기능과
 * 무관하게 러너가 집으며, payload의 `scope`(`tail`·`full`·`doc`)가 범위를 가른다.
 */
export type SequenceWorkKind = 'refresh' | 'reconcile' | 'materialize' | 'announce' | 'project';
export type SequenceWorkState = 'ready' | 'leased' | 'retry' | 'parked' | 'done' | 'obsolete';

export interface SequenceWorkRow {
  readonly work_key: string;
  readonly kind: SequenceWorkKind;
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number | null;
  readonly requested_generation: number;
  readonly completed_generation: number;
  readonly payload: Record<string, unknown>;
  /**
   * lease 보유자만 갱신하는 진행 상태 (마이그레이션 034). `payload`는 요청마다 덮이므로
   * 페이지 커서·generation·완료 요약은 여기 둔다. 시험·운영 조회가 읽는다.
   */
  readonly progress: Record<string, unknown>;
  readonly state: SequenceWorkState;
  readonly available_at: Date;
  readonly lease_until: Date | null;
  readonly lease_token: string | null;
  readonly attempt_count: number;
  readonly last_reason: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** `refresh` work의 payload. 전달 식별자와 수신 시각이 측정의 출처다. */
export interface RefreshWorkPayload {
  readonly delivery_id: string;
  readonly received_at: string;
  readonly head_sha: string;
  readonly correlation_id: string;
}

/** 전달 하나가 곧 행 하나다. */
export function refreshWorkKey(deliveryId: string): string {
  return `push:${deliveryId}`;
}

/**
 * 공간 단위 work 키. 브랜치 이름에 `:`이 들어갈 수 있으므로 **JSON 튜플**로 직렬화한다
 * — 단순 `:` 결합은 `release:v1`과 `release` + `v1`을 구분하지 못한다.
 */
export function spaceWorkKey(
  kind: Exclude<SequenceWorkKind, 'refresh'>,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  ...extra: readonly (string | number)[]
): string {
  return `${kind}:${JSON.stringify([repositoryId, baseBranch, seqEpoch, ...extra])}`;
}

export interface EnqueueRefreshInput {
  readonly deliveryId: string;
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly receivedAt: Date;
  readonly correlationId: string;
}

/**
 * push 수신의 refresh intent. **원본 저장과 같은 트랜잭션에서 부른다** (상세 설계 4).
 *
 * @returns 새로 만들었으면 `true`. 같은 전달이 이미 있으면 `false` — 재전송은
 *   두 번째 fetch 이유가 아니다.
 */
export async function enqueueRefreshWork(db: Queryable, input: EnqueueRefreshInput): Promise<boolean> {
  const payload: RefreshWorkPayload = {
    delivery_id: input.deliveryId,
    received_at: input.receivedAt.toISOString(),
    head_sha: input.headSha.toLowerCase(),
    correlation_id: input.correlationId,
  };
  const result = await db.query(
    `INSERT INTO sequence_work (work_key, kind, repository_id, base_branch, seq_epoch, payload)
     VALUES ($1, 'refresh', $2, $3, NULL, $4::jsonb)
     ON CONFLICT (work_key) DO NOTHING`,
    [refreshWorkKey(input.deliveryId), input.repositoryId, input.baseBranch, JSON.stringify(payload)],
  );
  return (result.rowCount ?? 0) === 1;
}

export interface RequestWorkInput {
  readonly kind: Exclude<SequenceWorkKind, 'refresh'>;
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly payload: Readonly<Record<string, unknown>>;
  /** 기본 키는 공간·에폭이다. PR별 `materialize`처럼 더 좁히려면 넘긴다. */
  readonly keyExtra?: readonly (string | number)[];
  /** `available_at`을 앞당기거나 미룬다. 기본은 지금이다. */
  readonly availableAt?: Date;
}

/**
 * 공간 단위 work를 요청한다 — 없으면 만들고, 있으면 `requested_generation`을 올린다.
 *
 * **실행 중(`leased`)이면 lease를 건드리지 않는다.** generation만 올리고, 실행 중인
 * 워커가 완료할 때 `completed_generation < requested_generation`을 보고 다시
 * `ready`로 돌린다. 실행 중 추가된 요청이 완료로 덮이지 않는 것이 이 규칙이다.
 *
 * @returns 갱신된 행.
 */
/**
 * 같은 종류의 work 여럿을 **한 문장으로** 요청한다 (WP-074 / DEV-605).
 *
 * 재색인은 채번된 PR마다 `materialize` 의도를 남기는데, 5만 PR 저장소에서 하나씩
 * 부르면 왕복이 5만 번이다. 의미는 `requestWork`와 같다 — 같은 키가 있으면
 * generation을 올리고, `leased` 중인 행의 진행을 빼앗지 않는다.
 *
 * @returns 실제로 만들어졌거나 generation이 오른 행 수.
 */
export async function requestWorkBatch(db: Queryable, inputs: readonly RequestWorkInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const keys = inputs.map((one) => spaceWorkKey(one.kind, one.repositoryId, one.baseBranch, one.seqEpoch, ...(one.keyExtra ?? [])));
  const result = await db.query(
    `INSERT INTO sequence_work
       (work_key, kind, repository_id, base_branch, seq_epoch, payload, available_at)
     SELECT k.work_key, k.kind, k.repository_id, k.base_branch, k.seq_epoch, k.payload::jsonb, now()
       FROM unnest($1::text[], $2::text[], $3::bigint[], $4::text[], $5::bigint[], $6::text[])
         AS k(work_key, kind, repository_id, base_branch, seq_epoch, payload)
     ON CONFLICT (work_key) DO UPDATE
        SET requested_generation = sequence_work.requested_generation + 1,
            payload              = EXCLUDED.payload,
            state                = CASE WHEN sequence_work.state = 'leased' THEN 'leased' ELSE 'ready' END,
            available_at         = CASE WHEN sequence_work.state = 'leased' THEN sequence_work.available_at ELSE now() END,
            attempt_count        = CASE WHEN sequence_work.state = 'leased' THEN sequence_work.attempt_count ELSE 0 END,
            last_reason          = CASE WHEN sequence_work.state = 'leased' THEN sequence_work.last_reason ELSE NULL END,
            updated_at           = clock_timestamp()`,
    [
      keys,
      inputs.map((one) => one.kind),
      inputs.map((one) => one.repositoryId),
      inputs.map((one) => one.baseBranch),
      inputs.map((one) => one.seqEpoch),
      inputs.map((one) => JSON.stringify(one.payload)),
    ],
  );
  return result.rowCount ?? 0;
}

export async function requestWork(db: Queryable, input: RequestWorkInput): Promise<SequenceWorkRow> {
  const key = spaceWorkKey(input.kind, input.repositoryId, input.baseBranch, input.seqEpoch, ...(input.keyExtra ?? []));
  const result = await db.query<SequenceWorkRow>(
    `INSERT INTO sequence_work
       (work_key, kind, repository_id, base_branch, seq_epoch, payload, available_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7, now()))
     ON CONFLICT (work_key) DO UPDATE
        SET requested_generation = sequence_work.requested_generation + 1,
            payload              = EXCLUDED.payload,
            state                = CASE WHEN sequence_work.state = 'leased' THEN 'leased' ELSE 'ready' END,
            available_at         = CASE
                                     WHEN sequence_work.state = 'leased' THEN sequence_work.available_at
                                     ELSE COALESCE($7, now())
                                   END,
            attempt_count        = CASE WHEN sequence_work.state = 'leased' THEN sequence_work.attempt_count ELSE 0 END,
            last_reason          = CASE WHEN sequence_work.state = 'leased' THEN sequence_work.last_reason ELSE NULL END,
            updated_at           = clock_timestamp()
     RETURNING *`,
    [
      key,
      input.kind,
      input.repositoryId,
      input.baseBranch,
      input.seqEpoch,
      JSON.stringify(input.payload),
      input.availableAt ?? null,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`work 요청이 행을 돌려주지 않았다: ${key}`);
  return row;
}

export interface ClaimOptions {
  readonly kinds: readonly SequenceWorkKind[];
  readonly limit: number;
  readonly leaseMs: number;
}

/**
 * 실행할 work를 집는다 (짧은 트랜잭션, `FOR UPDATE SKIP LOCKED`).
 *
 * 한 문장으로 끝낸다 — 고르는 것과 lease를 세우는 것이 갈라지면 그 사이에 다른
 * 워커가 같은 행을 본다. `attempt_count`는 claim마다 오른다.
 */
export async function claimDueWork(db: Queryable, options: ClaimOptions): Promise<SequenceWorkRow[]> {
  if (options.kinds.length === 0 || options.limit < 1) return [];
  const result = await db.query<SequenceWorkRow>(
    `UPDATE sequence_work AS w
        SET state         = 'leased',
            lease_until   = now() + ($3::int * interval '1 millisecond'),
            lease_token   = gen_random_uuid(),
            attempt_count = w.attempt_count + 1,
            updated_at    = clock_timestamp()
      WHERE w.work_key IN (
        SELECT work_key FROM sequence_work
         WHERE state IN ('ready', 'retry') AND available_at <= now() AND kind = ANY($1::text[])
         ORDER BY available_at, work_key
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      RETURNING w.*`,
    [options.kinds, options.limit, Math.trunc(options.leaseMs)],
  );
  return result.rows;
}

export interface LeaseRef {
  readonly workKey: string;
  readonly leaseToken: string;
}

/**
 * 완료 ack. `generation`은 claim 시점에 본 `requested_generation`이다.
 *
 * 그 사이 generation이 올랐으면 `done`이 아니라 다시 `ready`다 — 실행 중 들어온
 * 요청을 완료로 덮지 않는다.
 *
 * @returns 실제로 갱신됐으면 `true`. lease를 잃었으면 `false`(0행).
 */
export async function completeWork(db: Queryable, lease: LeaseRef, generation: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_work
        SET completed_generation = GREATEST(completed_generation, $3),
            state        = CASE WHEN requested_generation > $3 THEN 'ready' ELSE 'done' END,
            lease_until  = NULL,
            lease_token  = NULL,
            available_at = now(),
            last_reason  = NULL,
            updated_at   = clock_timestamp()
      WHERE work_key = $1 AND lease_token = $2 AND state = 'leased'`,
    [lease.workKey, lease.leaseToken, generation],
  );
  return (result.rowCount ?? 0) > 0;
}

export type ReleaseState = 'retry' | 'parked' | 'obsolete' | 'ready';

/**
 * lease를 놓고 상태를 정한다 — 재시도(`retry`)·보류(`parked`)·무효(`obsolete`)·
 * 즉시 재실행(`ready`, 락 경합의 defer).
 *
 * `attempt_count`는 건드리지 않는다. 락 경합처럼 실패로 세지 않을 사유는 호출
 * 측이 `resetAttempts`로 되돌린다.
 */
export async function releaseWork(
  db: Queryable,
  lease: LeaseRef,
  next: { readonly state: ReleaseState; readonly availableAt: Date; readonly reason: string | null; readonly resetAttempts?: boolean },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_work
        SET state         = $3,
            available_at  = $4,
            last_reason   = $5,
            attempt_count = CASE WHEN $6 THEN 0 ELSE attempt_count END,
            lease_until   = NULL,
            lease_token   = NULL,
            updated_at    = clock_timestamp()
      WHERE work_key = $1 AND lease_token = $2 AND state = 'leased'`,
    [lease.workKey, lease.leaseToken, next.state, next.availableAt, next.reason, next.resetAttempts === true],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 진행 상태를 남긴다 (CR-113). **lease 보유자만** 쓸 수 있다 — 만료된 lease의 늦은 저장은
 * 0행이라 다른 워커가 이어 가는 커서를 되돌리지 못한다.
 *
 * @returns 실제로 갱신됐으면 `true`.
 */
export async function updateWorkProgress(
  db: Queryable,
  lease: LeaseRef,
  progress: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_work
        SET progress = $3::jsonb, updated_at = clock_timestamp()
      WHERE work_key = $1 AND lease_token = $2 AND state = 'leased'`,
    [lease.workKey, lease.leaseToken, JSON.stringify(progress)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** lease 연장 (heartbeat). 잃었으면 `false`이며 호출 측은 결과를 커밋하지 않는다. */
export async function heartbeatWork(db: Queryable, lease: LeaseRef, leaseMs: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_work
        SET lease_until = now() + ($3::int * interval '1 millisecond'), updated_at = clock_timestamp()
      WHERE work_key = $1 AND lease_token = $2 AND state = 'leased'`,
    [lease.workKey, lease.leaseToken, Math.trunc(leaseMs)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 만료된 lease를 회수한다. 죽은 워커의 몫은 `retry`로 돌아온다. */
export async function reclaimExpiredLeases(db: Queryable): Promise<number> {
  const result = await db.query(
    `UPDATE sequence_work
        SET state = 'retry', lease_until = NULL, lease_token = NULL, available_at = now(),
            last_reason = 'lease_expired', updated_at = clock_timestamp()
      WHERE state = 'leased' AND lease_until < now()`,
  );
  return result.rowCount ?? 0;
}

export interface CoveredRefresh {
  readonly work_key: string;
  readonly payload: RefreshWorkPayload;
}

/**
 * 성공한 fetch가 덮을 refresh intent의 집합을 **fetch 직전에** 고정한다 (상세 설계 4.1의 7, DEV-670).
 *
 * 경계는 시각이 아니라 **커밋 가시성**이다. 이 SELECT가 본 행은 그 시점에 이미 커밋된
 * push이고, fetch는 그 뒤에 원격의 현재 상태를 읽으므로 전부 덮인다. SELECT 뒤에
 * 커밋된 행은 이번 회차가 덮었다고 말하지 않는다 — 다음 회차가 처리한다.
 *
 * 시각으로 자르지 않는 이유: `created_at`은 DB의 `clock_timestamp()`(µs)이고 애플리케이션의
 * `Date`는 ms다. 같은 밀리초 안에 들어온 마지막 push가 `created_at <= startedAt`에서 경계
 * **뒤**로 읽혀 남았다(2026-09-13 main CI 실측). 워커와 DB가 다른 호스트면 시계 차이가
 * 같은 자리에서 반대 방향의 오류(fetch 뒤 push를 덮음)도 만든다. 집합에는 그런 자리가 없다.
 *
 * 집어 든 work 자신(`leased` + 같은 토큰)도 집합에 든다.
 */
export async function listCoverableRefreshWorkKeys(
  db: Queryable,
  input: {
    readonly repositoryId: number;
    readonly baseBranch: string;
    readonly leaseToken: string | null;
  },
): Promise<string[]> {
  const result = await db.query<{ work_key: string }>(
    `SELECT work_key
       FROM sequence_work
      WHERE kind = 'refresh' AND repository_id = $1 AND base_branch = $2
        AND (state IN ('ready', 'retry') OR (state = 'leased' AND lease_token = $3))
      ORDER BY work_key`,
    [input.repositoryId, input.baseBranch, input.leaseToken],
  );
  return result.rows.map((row) => row.work_key);
}

/**
 * `listCoverableRefreshWorkKeys`가 고정한 집합을 완료한다.
 *
 * 집합에 있어도 그 사이 상태가 바뀐 행(다른 워커가 집어 `leased`가 됐거나 `parked`)은
 * 닫지 않는다 — 상태 조건을 다시 본다. 빈 집합은 질의 없이 빈 결과다.
 *
 * @returns 완료한 intent의 payload — 어느 전달이 이 회차에 덮였는지가 측정의 출처다.
 */
export async function completeCoveredRefreshWorks(
  db: Queryable,
  input: {
    readonly workKeys: readonly string[];
    readonly leaseToken: string | null;
  },
): Promise<CoveredRefresh[]> {
  if (input.workKeys.length === 0) return [];
  const result = await db.query<CoveredRefresh>(
    `UPDATE sequence_work
        SET state = 'done', completed_generation = requested_generation,
            lease_until = NULL, lease_token = NULL, last_reason = 'covered', updated_at = clock_timestamp()
      WHERE kind = 'refresh' AND work_key = ANY($1::text[])
        AND (state IN ('ready', 'retry') OR (state = 'leased' AND lease_token = $2))
      RETURNING work_key, payload`,
    [input.workKeys, input.leaseToken],
  );
  return result.rows;
}

export async function findWork(db: Queryable, workKey: string): Promise<SequenceWorkRow | undefined> {
  const result = await db.query<SequenceWorkRow>('SELECT * FROM sequence_work WHERE work_key = $1', [workKey]);
  return result.rows[0];
}

/** 공간의 work 목록. 시험과 운영 조회가 쓴다. */
export async function listWorkForSpace(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  kinds?: readonly SequenceWorkKind[],
): Promise<SequenceWorkRow[]> {
  const result = await db.query<SequenceWorkRow>(
    `SELECT * FROM sequence_work
      WHERE repository_id = $1 AND base_branch = $2 AND ($3::text[] IS NULL OR kind = ANY($3::text[]))
      ORDER BY created_at, work_key`,
    [repositoryId, baseBranch, kinds === undefined ? null : [...kinds]],
  );
  return result.rows;
}

/** 실행 대기 중인 work 수 (운영 지표). */
export async function countPendingWork(db: Queryable): Promise<Readonly<Record<string, number>>> {
  const result = await db.query<{ kind: string; state: string; count: string }>(
    `SELECT kind, state, count(*)::text AS count FROM sequence_work
      WHERE state IN ('ready', 'retry', 'leased', 'parked')
      GROUP BY kind, state`,
  );
  const out: Record<string, number> = {};
  for (const row of result.rows) out[`${row.kind}:${row.state}`] = Number(row.count);
  return out;
}

/**
 * 완료된 `refresh`·`announce` work와 **문서 단위** `project` work를 정리한다 (기본 30일, 1회 1000행).
 *
 * `materialize`·`reconcile`과 공간 단위 `project`(`tail`·`full`)는 공간·PR당 한 행이라
 * 지우지 않는다 — generation이 이어져야 옛 요청·완료를 분류할 수 있다. 문서 단위 `project`는
 * 문서마다 한 행이고 완료 뒤 다시 요청되면 새 행이 만들어지므로 지워도 된다 (CR-113).
 * 미완료·`parked`도 지우지 않는다.
 */
export async function cleanupDoneWork(db: Queryable, olderThan: Date, limit = 1_000): Promise<number> {
  const result = await db.query(
    `DELETE FROM sequence_work
      WHERE work_key IN (
        SELECT work_key FROM sequence_work
         WHERE state = 'done' AND updated_at < $1
           AND (kind IN ('refresh', 'announce') OR (kind = 'project' AND payload ->> 'scope' = 'doc'))
         ORDER BY updated_at
         LIMIT $2
      )`,
    [olderThan, limit],
  );
  return result.rowCount ?? 0;
}

/**
 * `after`가 이 커밋인 push 의도 (측정의 원인 delivery 연결, 상세 설계 6.4).
 *
 * squash 머지의 push는 `after`가 곧 squash 커밋이다. 그 연결이 증명될 때만 표본의
 * `received_at`을 채운다 — 일괄 fetch로 들어온 옛 PR에는 이 행이 없어 NULL로 남는다.
 * 여럿이면 가장 이른 수신이다.
 */
export async function findRefreshWorkByHead(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  headSha: string,
): Promise<SequenceWorkRow | undefined> {
  const result = await db.query<SequenceWorkRow>(
    `SELECT * FROM sequence_work
      WHERE kind = 'refresh' AND repository_id = $1 AND base_branch = $2 AND payload ->> 'head_sha' = $3
      ORDER BY created_at
      LIMIT 1`,
    [repositoryId, baseBranch, headSha.toLowerCase()],
  );
  return result.rows[0];
}
