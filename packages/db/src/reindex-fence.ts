/**
 * 논리 쓰기와 재색인 전환 사이의 울타리 (WP-035 / CR-045·046, DEV-296·308).
 *
 * ## 막아야 할 경주 둘이 있고 방향이 반대다
 *
 * ```
 * [유실]   writer: 대상이 [old]뿐이라고 판단
 *          reindex: 이중 쓰기 활성화
 *          writer: old에만 쓴다
 *          backfill: 그 문서를 이미 지나갔다
 *          cutover  → 그 변경이 new에서 사라진다
 *
 * [불완전] writer: [old, new] 쓰기 시작
 *          cutover: 별칭을 new로 옮긴다
 *          writer: new 쓰기가 실패한다
 *                  → 이미 new가 서비스 중인데 불완전하다
 * ```
 *
 * ## 울타리가 덮는 구간
 *
 * **"대상 확정 → 두 인덱스 쓰기 완료 → shadow 실패 기록"까지다** (CR-046,
 * DEV-308). 대상 확정만 감싸고 놓으면 두 번째 경주가 그대로 남는다. 그리고
 * shadow 실패 기록이 울타리 밖으로 밀리면 전환이 "실패 없음"을 보고 지나간다 —
 * 기록도 같은 구간 안에서 끝나야 한다.
 *
 * CR-045가 그 경주를 표로 적어 놓고 울타리를 그것보다 짧게 잡았고, PR #50 리뷰가
 * 잡았다. 성능을 이유로 이 구간을 좁히려면 **먼저 정확성 증명이 있어야 한다.**
 */

import type { Pool, PoolClient } from 'pg';

import {
  acquireAdvisorySharedLock,
  acquireAdvisorySessionLock,
  reindexFenceKey,
  releaseAdvisorySessionLock,
  releaseAdvisorySharedLock,
} from './advisory-lock.js';
import {
  findActiveReindexRow,
  findDualWriteShadows,
  recordLinkPending,
  recordShadowFailures,
  type LinkPendingInput,
} from './repositories/reindex.js';

/** shadow 쓰기 실패 하나. `@prs/es`의 `ShadowWriteFailure`와 구조가 같다. */
export interface FenceShadowFailure {
  readonly alias: string;
  readonly index: string;
  readonly operation: string;
  readonly reason: string;
}

/**
 * shadow에서 **부분 갱신의 대상 문서가 아직 없었던** 간선 하나 (CR-121 / FR-ING-008 AC-11).
 * `@prs/es`의 `ShadowPendingWork`와 구조가 같다.
 *
 * 실패가 아니라 회수할 일이다 — 그 간선의 소유 source가 재구축에서 아직 처리되지 않았다. 새 문서를
 * 여기서 만들지 않는다(근거·권한 필드가 없다). 소유 source를 정본에서 다시 파생해 회수한다.
 */
export interface FenceShadowPending {
  readonly alias: string;
  readonly index: string;
  readonly repositoryId: number;
  readonly sourceKind: 'pull_request' | 'commit';
  readonly sourceId: string;
  readonly linkId: string;
}

/**
 * 이 논리 쓰기가 닿을 대상.
 *
 * `@prs/es`의 `WriteTargets`와 **구조적으로 같다** — 그래서 어댑터 없이 그대로
 * 넘길 수 있고, `@prs/db`가 `@prs/es`를 의존하지 않아도 된다.
 */
export interface ReindexWriteTargets {
  readonly shadows: Readonly<Record<string, string>>;
  readonly recordShadowFailure?: (failure: FenceShadowFailure) => void;
  readonly recordShadowPending?: (pending: FenceShadowPending) => void;
}

/** 울타리를 얻지 못했을 때. 쓰기는 진행하지 않는다. */
export class ReindexFenceUnavailableError extends Error {
  constructor() {
    super('reindex_fence_unavailable');
    this.name = 'ReindexFenceUnavailableError';
  }
}

/** 울타리 대기 상한. 전환은 밀리초 단위라 이보다 오래 걸릴 이유가 없다. */
export const FENCE_LOCK_TIMEOUT_MS = 30_000;

/**
 * 논리 쓰기 하나를 울타리 안에서 실행한다.
 *
 * 1. **공유** 울타리를 잡는다 — 다른 쓰기와는 겹치되 활성화·전환과는 겹치지 않는다
 * 2. 그 안에서 이중 쓰기 대상을 읽는다 (밖에서 읽으면 읽은 직후 활성화가 끼어든다)
 * 3. `run`이 두 인덱스 쓰기를 끝낸다
 * 4. shadow 실패가 있으면 **같은 구간 안에서** 잡을 `failed`로 만든다
 * 5. shadow 미처리가 있으면 **같은 구간 안에서** 잡의 대기열에 남긴다 (CR-121). 실행 중인
 *    prs-links 재색인의 **바로 그** 대상 인덱스일 때만 미처리이고, 아니면 실패로 올린다 — 누구의
 *    회수 책임인지 모르는 미처리는 조용히 사라지기 때문이다
 * 6. 울타리를 푼다
 *
 * `run`이 던지면 그대로 전파한다 — 서비스 인덱스 쓰기 실패는 기존 오류 처리
 * 그대로이고, 재색인 때문에 달라지지 않는다 (DEV-298).
 */
export async function withReindexWrite<T>(
  pool: Pool,
  run: (targets: ReindexWriteTargets) => Promise<T>,
): Promise<T> {
  const key = reindexFenceKey();
  const client = await pool.connect();
  const failures: FenceShadowFailure[] = [];
  const pendings: FenceShadowPending[] = [];

  try {
    const locked = await acquireAdvisorySharedLock(client, key, FENCE_LOCK_TIMEOUT_MS);
    if (!locked) throw new ReindexFenceUnavailableError();

    try {
      const shadows = await findDualWriteShadows(client);
      const targets: ReindexWriteTargets = {
        shadows,
        recordShadowFailure: (failure) => failures.push(failure),
        recordShadowPending: (pending) => pendings.push(pending),
      };

      const result = await run(targets);

      /*
       * 실패 기록이 울타리 안이어야 하는 이유 (DEV-308): 밖으로 밀면 그 사이에
       * 전환이 배타 락을 잡고 "알려진 실패 0"을 보고 별칭을 옮긴다.
       */
      if (failures.length > 0 || pendings.length > 0) {
        const active = await findActiveReindexRow(client);
        const promoted = await recordPendings(client, active, pendings);
        const all = [...failures, ...promoted];
        if (active !== undefined && all.length > 0) await recordShadowFailures(client, active.job_id, all);
      }

      return result;
    } finally {
      await releaseAdvisorySharedLock(client, key);
    }
  } finally {
    client.release();
  }
}

/**
 * 미처리를 활성 잡의 대기열에 남긴다. 그 잡의 것이 아니면 실패로 돌려준다 (CR-121).
 *
 * 조건은 전부 참이어야 한다: 잡이 `running`이고, 별칭이 같고, 미처리가 난 인덱스가 그 잡의
 * `target_index` 그대로다. 이름이 같은 다른 인덱스(도중에 지워졌다 자동 생성된 것)는 UUID 대조가
 * 전환 전 검증과 울타리에서 막는다(CR-119).
 */
async function recordPendings(
  client: PoolClient,
  active: Awaited<ReturnType<typeof findActiveReindexRow>>,
  pendings: readonly FenceShadowPending[],
): Promise<readonly FenceShadowFailure[]> {
  if (pendings.length === 0) return [];
  const progress = (active?.progress ?? {}) as { readonly target_index?: unknown };
  const accepted: LinkPendingInput[] = [];
  const promoted: FenceShadowFailure[] = [];
  for (const pending of pendings) {
    const owned =
      active !== undefined &&
      active.state === 'running' &&
      active.target === pending.alias &&
      progress.target_index === pending.index;
    if (owned) {
      accepted.push({
        repositoryId: pending.repositoryId,
        sourceKind: pending.sourceKind,
        sourceId: pending.sourceId,
        reason: 'partial_update_document_missing',
        sampleLinkId: pending.linkId,
      });
    } else {
      promoted.push({
        alias: pending.alias,
        index: pending.index,
        operation: 'bulk',
        reason: `document_missing_exception (회수할 잡이 없다: ${pending.linkId})`,
      });
    }
  }
  if (active !== undefined && accepted.length > 0) await recordLinkPending(client, active.job_id, accepted);
  return promoted;
}

/**
 * 활성화·전환을 **배타** 울타리 안에서 실행한다.
 *
 * `pg_advisory_lock`은 공유 보유자를 기다린다 — 그래서 이 콜백이 시작될 때
 * **진행 중인 논리 쓰기가 하나도 없음**이 보장된다. 그것이 전환의 전제다.
 */
export async function withReindexExclusive<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
  lockTimeoutMs = FENCE_LOCK_TIMEOUT_MS,
): Promise<T> {
  const key = reindexFenceKey();
  const client = await pool.connect();

  try {
    const locked = await acquireAdvisorySessionLock(client, key, lockTimeoutMs);
    if (!locked) throw new ReindexFenceUnavailableError();
    try {
      return await run(client);
    } finally {
      await releaseAdvisorySessionLock(client, key);
    }
  } finally {
    client.release();
  }
}
