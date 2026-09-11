/**
 * JOB-MIR-001 실행 자리 (WP-020 / CR-023, DEV-113).
 *
 * ## 왜 `mirror` 역할인가
 *
 * 잡 카탈로그는 이 잡의 워커 그룹을 `sequence`로 적지만 그 역할은 WP-021이
 * 세운다. 없는 역할에 얹을 수 없으므로 `mirror` 역할을 따로 둔다 —
 * WP-021이 `sequence`를 세우면 같은 프로세스에 합치든 그대로 두든
 * **미러 동기화의 호출 지점은 바뀌지 않는다.**
 *
 * ## 두 경로로 돈다
 *
 * `push` 이벤트가 실시간 경로이고, 6시간 스윕이 **그 이벤트가 유실됐을 때의
 * 보정**이다. 하나만 두면 각각의 실패 모드가 그대로 남는다 — 이벤트만 두면
 * 유실이 영구 지연이 되고, 스윕만 두면 반영이 최대 6시간 늦는다.
 */

import { repositoryRepo, type Pool, type RepositoryRow } from '@prs/db';
import { mirrorDiskUsage, MIRROR_DISK_ALERT_RATIO, type MirrorSync, type RepoRef } from '@prs/github';
import { Counter, Gauge } from '@prs/metrics';
import { MirrorLockBusyError, withMirrorLock } from './mirror-lock.js';

export interface MirrorLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository_id?: number;
  readonly target?: string;
  readonly reason?: string;
  readonly detail?: string;
}

export interface MirrorRunnerDeps {
  readonly pool: Pool;
  readonly sync: MirrorSync;
  readonly log: (entry: MirrorLogEntry) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** 잡 카탈로그의 보정 주기 (6시간). */
export const MIRROR_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export const mirrorSyncTotal = new Counter('mirror_sync_total', '미러 동기화 실행 수');
export const mirrorDiskUsageRatio = new Gauge('mirror_disk_usage_ratio', '미러 볼륨 사용률 (0~1)');

/**
 * 저장소 하나를 동기화한다.
 *
 * @returns 동기화했으면 `true`. **미러를 쓰지 않는 저장소는 `false`이고
 * 실패가 아니다** — 그 저장소는 API 폴백으로 답하기로 되어 있다
 * (FR-ING-009 AC-1, ADR-005).
 */
export async function syncOne(deps: MirrorRunnerDeps, repository: RepositoryRow): Promise<boolean> {
  if (!repository.mirror_enabled) return false;
  if (repository.status !== 'active') return false;

  const ref: RepoRef = { owner: repository.owner, repo: repository.name };
  const target = `${repository.owner}/${repository.name}`;
  try {
    /*
     * 저장소 단위 미러 락 아래에서 fetch한다 (WP-074 / ADR-023 C1). 채번의 선행
     * fetch와 같은 디렉터리에 동시에 쓰지 않는다. 스윕은 잠깐 기다려도 잃는 것이
     * 없으므로 `wait`다 — 상한을 넘기면 이번 회차는 건너뛰고 다음 스윕이 잇는다.
     */
    const result = await withMirrorLock(
      deps.pool,
      repository.repository_id,
      () => deps.sync.sync(ref, repository.repository_id),
      { wait: true },
    );
    mirrorSyncTotal.inc({ action: result.action, outcome: 'ok' });
    deps.log({
      level: 'info',
      message: '미러 동기화 완료',
      repository_id: repository.repository_id,
      target,
      reason: result.action,
    });
    return true;
  } catch (error) {
    if (error instanceof MirrorLockBusyError) {
      // 다른 호출자가 방금 fetch했거나 하는 중이다. 실패가 아니라 "이미 최신이 되는 중"이다.
      mirrorSyncTotal.inc({ action: 'sync', outcome: 'lock_busy' });
      deps.log({ level: 'info', message: '미러 락 경합 — 이번 스윕은 건너뛴다', repository_id: repository.repository_id, target, reason: 'mirror_lock_busy' });
      return false;
    }
    /*
     * **던지지 않는다.** 저장소 하나의 동기화 실패로 스윕 전체를 버리면
     * 나머지 저장소가 전부 늦어진다. 실패는 지표와 로그로 드러나고,
     * 그동안 그 저장소의 조회는 API 폴백이 답한다.
     */
    mirrorSyncTotal.inc({ action: 'sync', outcome: 'failed' });
    deps.log({
      level: 'error',
      message: '미러 동기화 실패 — 이 저장소는 API 폴백으로 답한다',
      repository_id: repository.repository_id,
      target,
      reason: 'mirror_sync_failed',
      detail: String(error).slice(0, 300),
    });
    return false;
  }
}

/** 등록된 활성 저장소 전부를 훑는다 (6시간 보정). */
export async function sweep(deps: MirrorRunnerDeps): Promise<{ readonly synced: number; readonly skipped: number }> {
  const repositories = await repositoryRepo.listActiveRepositories(deps.pool);
  let synced = 0;
  let skipped = 0;
  for (const repository of repositories) {
    if (await syncOne(deps, repository)) synced += 1;
    else skipped += 1;
  }
  await reportDiskUsage(deps);
  return { synced, skipped };
}

/**
 * 볼륨 사용률을 지표에 싣는다 (ADR-005 follow-up, 관측성 문서 4장).
 *
 * 읽지 못하면 **지표를 갱신하지 않는다.** 0을 실으면 "여유롭다"로 읽혀
 * 85% 경보가 영영 울리지 않는다.
 */
export async function reportDiskUsage(deps: MirrorRunnerDeps): Promise<number | null> {
  const ratio = await mirrorDiskUsage(deps.sync.root);
  if (ratio === null) {
    deps.log({ level: 'warn', message: '미러 볼륨 사용률을 읽지 못했다', reason: 'disk_usage_unavailable' });
    return null;
  }
  mirrorDiskUsageRatio.set(ratio);
  if (ratio >= MIRROR_DISK_ALERT_RATIO) {
    deps.log({
      level: 'warn',
      message: '미러 볼륨 사용률이 경보 임계를 넘었다',
      reason: 'mirror_disk_pressure',
      detail: `${(ratio * 100).toFixed(1)}%`,
    });
  }
  return ratio;
}

/** 저장소 슬러그(`owner/name`)로 한 건만 동기화한다. `push` 이벤트가 이 경로로 온다. */
export async function syncByTarget(deps: MirrorRunnerDeps, target: string): Promise<boolean> {
  const slash = target.indexOf('/');
  if (slash < 0) return false;
  const repository = await repositoryRepo.findRepositoryBySlug(
    deps.pool,
    target.slice(0, slash),
    target.slice(slash + 1),
  );
  if (repository === undefined) {
    // 등록되지 않은 저장소의 push다. 미러를 만들지 않는다 — 등록이 수집의 경계다.
    return false;
  }
  return syncOne(deps, repository);
}

export interface MirrorRunner {
  stop(): Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 6시간마다 스윕한다. `push` 경로는 호출 측이 `syncByTarget`으로 잇는다. */
export function startMirrorSweeper(
  deps: MirrorRunnerDeps,
  options: { readonly intervalMs?: number } = {},
): MirrorRunner {
  const interval = options.intervalMs ?? MIRROR_SWEEP_INTERVAL_MS;
  const sleep = deps.sleep ?? defaultSleep;
  let stopped = false;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        const result = await sweep(deps);
        deps.log({
          level: 'info',
          message: '미러 보정 스윕 완료',
          detail: `동기화 ${String(result.synced)}건, 건너뜀 ${String(result.skipped)}건`,
        });
      } catch (error) {
        deps.log({ level: 'error', message: '미러 스윕 실패', detail: String(error).slice(0, 300) });
      }
      await sleep(interval);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      await loop;
    },
  };
}
