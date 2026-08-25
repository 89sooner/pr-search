/**
 * 기존 데이터의 PR 정본 스냅숏 부트스트랩 (JOB-ING-010 / CR-037, DEV-194·195).
 *
 * ## 무엇을 메우나
 *
 * 마이그레이션 010이 `pull_request_snapshot`을 세웠지만 **빈 표로 시작한다.**
 * 업그레이드 시점에 이미 색인된 PR은 스냅숏을 얻지 못한다 — 투영은 바뀐 PR만
 * 쓰고, 조정 스캔은 이미 색인된 것을 건너뛴다. 그 PR들은 **색인에만 존재하며**,
 * ADR-004가 요구하는 "PostgreSQL만으로 전량 재구축 가능"이 그 데이터에 대해
 * 성립하지 않는다. 정합성 감시는 그것을 `extra_in_es`로 오보한다.
 *
 * ## 왜 마이그레이션이 하지 않나
 *
 * 스냅숏 내용은 GHE가 답하는 PR로만 만들 수 있다. 마이그레이션 안에서 네트워크를
 * 부르면 되돌릴 수도 재개할 수도 없는 배포 단계가 된다. 스키마 전이(012)와
 * 데이터 채우기(이 잡)를 나눈다.
 *
 * ## 왜 새 러너·새 클라이언트를 만들지 않나
 *
 * 필요한 것은 **백필과 같은 것**이다 — 같은 페이지네이션, 같은 커서, 같은 rate
 * limit 처리, 같은 중단 처리. 다른 것은 큐에서 집는 잡 유형과 "색인은 건드리지
 * 않는다"는 것뿐이다. 그래서 `startBackfillRunner`를 유형만 바꿔 재사용하고
 * `projectOne`에 `snapshotOnly`를 준다.
 *
 * **문서를 만드는 경로가 백필과 같아야 한다.** 다른 경로로 만들면 재구축의
 * 근거와 실제 색인 내용이 갈라지고, 그 순간 이 잡은 불변식을 지키는 대신
 * 지키는 척하게 된다.
 *
 * ## 재개와 멱등
 *
 * 커서는 백필과 같은 잡 행에 남는다 — 대규모 저장소에서 한 번 실패했다고 처음부터
 * 다시 하지 않는다. 스냅숏 업서트는 `document_version` 조건부라 같은 PR을 몇 번
 * 다시 처리해도 결과가 같고, **버전은 GitHub 엔티티의 `updated_at`**이라
 * (`backfillDocumentVersion`) 늦게 도착한 부트스트랩이 새 웹훅 상태를 덮지 않는다.
 */

import { jobRepo, repositoryRepo } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import {
  startBackfillRunner,
  type BackfillDeps,
  type BackfillResult,
  type BackfillRunner,
} from './backfill.js';

/** 잡 카탈로그 이름. `job.type`은 `snapshot_bootstrap`이다. */
export const SNAPSHOT_BOOTSTRAP_JOB = 'JOB-ING-010' as const;
export const SNAPSHOT_BOOTSTRAP_TYPE = 'snapshot_bootstrap' as const;

/** 한 주기에 큐에 넣는 저장소 수. 무한정 밀어 넣지 않는다. */
export const BOOTSTRAP_ENQUEUE_BATCH = 5;

/**
 * 아직 부트스트랩되지 않은 저장소를 큐에 넣는다.
 *
 * **한 주기에 일부만 집는다.** 전체를 한 번에 넣으면 첫 배포에서 GHE 한도를
 * 통째로 태우고, 그 한도는 조정 스캔·백필과 공유된다.
 *
 * `job_active_uk`가 같은 (유형, 대상)의 중복 활성 잡을 막으므로 이미 큐에 있는
 * 저장소는 조용히 건너뛴다 — 중복 삽입을 오류로 취급하지 않는다.
 *
 * @returns 이번에 실제로 큐에 넣은 수.
 */
export async function enqueueSnapshotBootstrap(
  pool: Pool,
  options: { readonly limit?: number; readonly requestedBy?: string } = {},
): Promise<number> {
  const pending = await repositoryRepo.listSnapshotBootstrapPending(
    pool,
    options.limit ?? BOOTSTRAP_ENQUEUE_BATCH,
  );

  let queued = 0;
  for (const repository of pending) {
    const target = `${repository.owner}/${repository.name}`;
    const active = await jobRepo.findActiveJob(pool, SNAPSHOT_BOOTSTRAP_TYPE, target);
    if (active !== undefined) continue;
    try {
      await jobRepo.enqueueJob(pool, SNAPSHOT_BOOTSTRAP_TYPE, target, options.requestedBy ?? 'system');
      queued += 1;
    } catch {
      // 같은 순간에 다른 복제본이 넣었다. 경합은 정상이며 다음 주기가 잇는다.
    }
  }
  return queued;
}

/**
 * 부트스트랩 완료를 기록한다.
 *
 * **부분 완료는 기록하지 않는다** — `stopped`·`failed`로 끝난 잡은 스냅숏이
 * 여전히 불완전하다는 뜻이고, 그때 완료로 적으면 정합성 감시가 그 저장소의
 * 누락을 색인 손상으로 읽는다. 그것이 이 정정이 없애려는 바로 그 오보다.
 */
export async function completeSnapshotBootstrap(
  pool: Pool,
  repository: RepositoryRow,
  result: BackfillResult,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  if (result.outcome !== 'completed' || result.failed.length > 0) return false;
  await repositoryRepo.markSnapshotBootstrapped(pool, repository.repository_id, now());
  return true;
}

/**
 * 부트스트랩 러너.
 *
 * 백필 러너를 **유형만 바꿔** 쓴다. 색인 조정(`indexTuning`)은 넘기지 않는다 —
 * 색인에 쓰지 않으므로 `refresh_interval`을 건드릴 이유가 없다.
 */
export function startSnapshotBootstrapRunner(
  deps: BackfillDeps & { readonly findRepository: (target: string) => Promise<RepositoryRow | undefined> },
  options: { readonly maxConcurrent?: number; readonly idlePollMs?: number } = {},
): BackfillRunner {
  return startBackfillRunner(
    { ...deps, snapshotOnly: true, snapshotSource: 'backfill' },
    {
      ...options,
      jobType: SNAPSHOT_BOOTSTRAP_TYPE,
      onCompleted: async (repository, result): Promise<void> => {
        const marked = await completeSnapshotBootstrap(deps.pool, repository, result, deps.now);
        deps.log({
          level: marked ? 'info' : 'warn',
          message: marked
            ? '정본 스냅숏 부트스트랩을 마쳤다'
            : '부트스트랩이 완전하지 않아 완료로 기록하지 않았다 — 다음 주기가 다시 집는다',
          target: `${repository.owner}/${repository.name}`,
          detail: `처리 ${String(result.processed)}건, 실패 ${String(result.failed.length)}건`,
        });
      },
    },
  );
}
