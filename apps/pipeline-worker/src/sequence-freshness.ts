/**
 * 채번 전 미러 최신화 (WP-074 / CR-079, ADR-023 C1, DEV-576 / FR-SEQ-008 AC-11).
 *
 * ## 낡은 미러의 성공을 최신성 근거로 쓰지 않는다
 *
 * `MirrorCommitGraph.resolveHead`는 `rev-parse`만 하고 fetch하지 않는다. push 웹훅이
 * 미러 fetch를 부르지 않던 상태(DEV-576)에서 채번은 옛 head를 읽고 "새 커밋 없음"으로
 * 조용히 끝났다 — 오류가 아니라 **정상 종료**였다는 것이 이 결함의 성질이다.
 *
 * 그래서 mirror 모드의 채번은 **fetch가 끝난 뒤에만** 시작한다. fetch가 실패하면
 * 채번하지 않고 재시도로 남긴다 — 이 설계는 fetch 실패 시 API로 자동 전환하지
 * 않는다 (상세 설계 4.1의 3). 낡은 미러로 채번하는 것보다 채번을 늦추는 편이 옳다.
 *
 * ## 락 순서: 미러 → 시퀀스 트랜잭션
 *
 * 미러 세션 락은 fetch와 그 뒤의 git 읽기(채번)가 끝날 때까지 유지한다. 그 안에서
 * 채번이 시퀀스 공간 트랜잭션 락을 잡는다. 반대 순서는 만들지 않는다.
 *
 * `repository.mirror_enabled = false`거나 API 모드면 fetch할 것이 없다 — 그래프가
 * 호출 시점에 GHE에서 head를 다시 읽으므로 그 자체가 최신이다.
 */

import type { Pool, RepositoryRow } from '@prs/db';
import type { MirrorSync, MirrorSyncAction, RepoRef } from '@prs/github';
import { MirrorLockBusyError, withMirrorLock } from './mirror-lock.js';
import type { SequenceGraphMode } from './mnumber-config.js';

export interface FreshnessLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface FreshnessDeps {
  readonly pool: Pool;
  readonly mode: SequenceGraphMode;
  /** mirror 모드에서 필수다. 기동 검증이 그것을 확인한다. */
  readonly sync?: MirrorSync;
  readonly log?: (fields: FreshnessLogFields) => void;
  readonly now?: () => Date;
}

/** 한 회차의 최신화 결과. boolean으로 뭉치지 않는다 (상세 설계 4.1의 `FreshnessOutcome`). */
export type FreshnessResult<T> =
  | {
      readonly kind: 'ready';
      readonly mode: 'mirror' | 'api';
      /** mirror 모드에서 fetch가 한 일. API 모드는 `null`이다. */
      readonly action: MirrorSyncAction | null;
      readonly startedAt: Date;
      readonly completedAt: Date;
      readonly result: T;
    }
  /** 다른 호출자가 같은 저장소를 fetch 중이다. 5초 뒤에 다시 온다. */
  | { readonly kind: 'defer'; readonly reason: 'mirror_locked' }
  /** fetch가 실패했다. 낡은 미러로 채번하지 않는다. */
  | { readonly kind: 'failed'; readonly reason: 'mirror_sync_failed'; readonly detail: string };

/** 락 경합 뒤 다시 오기까지. 채번의 공간 락과 같은 값이다 (CR-025, DEV-117). */
export const FRESHNESS_DEFER_MS = 5_000;

function refOf(repository: RepositoryRow): RepoRef {
  return { owner: repository.owner, repo: repository.name };
}

/**
 * 저장소의 그래프를 최신으로 만든 뒤 `run`을 **락 아래에서** 실행한다.
 *
 * `run`이 던지면 그대로 전파한다 — 채번의 실패 처리는 채번이 한다.
 */
export async function withFreshness<T>(
  deps: FreshnessDeps,
  repository: RepositoryRow,
  run: () => Promise<T>,
): Promise<FreshnessResult<T>> {
  const now = deps.now ?? ((): Date => new Date());
  const startedAt = now();

  if (deps.mode === 'api' || !repository.mirror_enabled) {
    const result = await run();
    return { kind: 'ready', mode: 'api', action: null, startedAt, completedAt: startedAt, result };
  }

  const sync = deps.sync;
  if (sync === undefined) {
    // 기동 검증이 막아야 할 상태다. 여기까지 왔다면 조용히 API로 바꾸지 않고 실패한다.
    throw new Error('mirror 모드인데 MirrorSync가 없다 — SEQUENCE_GRAPH_MODE와 미러 볼륨 구성을 확인한다');
  }

  try {
    return await withMirrorLock(deps.pool, repository.repository_id, async () => {
      let action: MirrorSyncAction;
      try {
        action = (await sync.sync(refOf(repository), repository.repository_id)).action;
      } catch (error) {
        const detail = String(error instanceof Error ? error.message : error).slice(0, 300);
        deps.log?.({
          level: 'error',
          message: '채번 전 미러 fetch 실패 — 낡은 미러로 채번하지 않고 재시도로 남긴다',
          repository_id: repository.repository_id,
          reason: 'mirror_sync_failed',
          detail,
        });
        return { kind: 'failed', reason: 'mirror_sync_failed', detail } as const;
      }
      const completedAt = now();
      const result = await run();
      return { kind: 'ready', mode: 'mirror', action, startedAt, completedAt, result } as const;
    });
  } catch (error) {
    if (error instanceof MirrorLockBusyError) {
      return { kind: 'defer', reason: 'mirror_locked' };
    }
    throw error;
  }
}
