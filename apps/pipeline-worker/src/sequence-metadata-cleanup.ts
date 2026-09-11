/**
 * WP-074 운영 메타데이터 정리 (상세 설계 6.3 · 6.4, ADR-023 C6).
 *
 * `batch` 역할의 고정 함수 `cleanupSequenceMetadataOnce`가 기동 후 및 매시간 1000행씩
 * 지운다. 대상은 **30일 지난 완료 `refresh`·`announce` work와 지연 표본**뿐이다.
 * 활성 근거·번호·미완료 work는 건드리지 않는다. 기존 보존 잡(파티션 드롭)이나
 * 범용 job API를 확장하지 않는다.
 *
 * SQL 실패는 다음 회차의 재시도로 처리하고 기동 실패로 전파하지 않는다.
 */

import { sequenceLatencyRepo, sequenceWorkRepo, type Pool } from '@prs/db';

export const METADATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const METADATA_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
export const METADATA_CLEANUP_BATCH = 1_000;

export interface CleanupLogEntry {
  readonly level: 'info' | 'warn';
  readonly message: string;
  readonly deleted_work?: number;
  readonly deleted_samples?: number;
  readonly reason?: string;
}

export interface CleanupDeps {
  readonly pool: Pool;
  readonly log?: (entry: CleanupLogEntry) => void;
  readonly now?: () => Date;
  readonly retentionMs?: number;
}

export async function cleanupSequenceMetadataOnce(
  deps: CleanupDeps,
): Promise<{ readonly deletedWork: number; readonly deletedSamples: number }> {
  const now = deps.now ?? ((): Date => new Date());
  const olderThan = new Date(now().getTime() - (deps.retentionMs ?? METADATA_RETENTION_MS));
  const deletedWork = await sequenceWorkRepo.cleanupDoneWork(deps.pool, olderThan, METADATA_CLEANUP_BATCH);
  const deletedSamples = await sequenceLatencyRepo.cleanupSamples(deps.pool, olderThan, METADATA_CLEANUP_BATCH);
  return { deletedWork, deletedSamples };
}

export interface MetadataCleanup {
  stop(): Promise<void>;
}

export function startSequenceMetadataCleanup(
  deps: CleanupDeps,
  intervalMs = METADATA_CLEANUP_INTERVAL_MS,
): MetadataCleanup {
  const log = deps.log ?? ((): void => undefined);
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();

  const round = async (): Promise<void> => {
    try {
      const result = await cleanupSequenceMetadataOnce(deps);
      if (result.deletedWork > 0 || result.deletedSamples > 0) {
        log({ level: 'info', message: 'WP-074 메타데이터 정리', deleted_work: result.deletedWork, deleted_samples: result.deletedSamples });
      }
    } catch (error) {
      log({ level: 'warn', message: 'WP-074 메타데이터 정리 실패 — 다음 회차가 다시 시도한다', reason: String(error).slice(0, 200) });
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = round().finally(schedule);
    }, intervalMs);
    timer.unref();
  };

  inFlight = round().finally(schedule);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
    },
  };
}
