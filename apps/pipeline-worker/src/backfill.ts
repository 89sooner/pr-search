/**
 * JOB-ING-004 저장소 백필 (WP-019 / FR-ING-006).
 *
 * 판정은 `backfill-plan.ts`가 한다. 이 파일은 그 판정으로 GHE를 읽고 문서를
 * 만든다.
 *
 * ## 실시간을 방해하지 않는다 (AC-3)
 *
 * 모든 GHE 호출이 `priority: 'backfill'`이다. `RequestScheduler`가 실시간
 * 대기열을 먼저 비우므로, 백필이 아무리 길어도 웹훅 보강이 뒤에 서지 않는다.
 * **호출마다 명시한다** — 기본값에 기대면 새 호출을 더할 때 조용히 실시간
 * 우선순위를 받는다.
 *
 * ## 잡을 중단시키지 않는 것들
 *
 * 개별 PR 실패는 **모아서 보고하고 계속한다** (WP-019 구현 범위). 저장소
 * 하나에 PR이 수만 건인데 그중 하나가 삭제됐다고 백필 전체를 버리면, 운영자는
 * 무엇이 색인됐는지 알 수 없는 채로 처음부터 다시 해야 한다.
 */

import { jobRepo, type JobRow, type Pool, type RepositoryRow } from '@prs/db';
import { GitHubApiError, safeMessage, type GitHubClient } from '@prs/github';
import type { Client } from '@elastic/elasticsearch';
import { bulkUpsert } from '@prs/es';
import { buildUpsertRequests } from './documents.js';
import { toEnrichedPullRequest } from './enriched-payload.js';
import {
  advanceCursor,
  backfillDeliveryId,
  backfillDocumentVersion,
  BACKFILL_PAGE_SIZE,
  buildProgress,
  PROGRESS_INTERVAL_MS,
  rateLimitRetryAt,
  readCursor,
  sleepMsUntil,
} from './backfill-plan.js';
import type { EnrichmentComponent, EnrichmentError, IngestionEnriched } from '@prs/domain';

export const BACKFILL_JOB = 'JOB-ING-004' as const;

export interface BackfillLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly job_id?: number;
  readonly target?: string;
  readonly pr_number?: number;
  readonly reason?: string;
  readonly detail?: string;
}

export interface BackfillDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly client: GitHubClient;
  readonly log: (entry: BackfillLogEntry) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 색인 설정을 조정한다. 없으면 조정하지 않는다 (CR-022, DEV-105). */
  readonly indexTuning?: IndexTuning;
}

/** 백필 중 `refresh_interval` 조정 (CR-022, DEV-105). */
export interface IndexTuning {
  /** 백필용 설정으로 올린다 (`30s`). */
  readonly relax: () => Promise<void>;
  /** 기본값(`1s`)으로 되돌린다. */
  readonly restore: () => Promise<void>;
}

export interface BackfillResult {
  readonly jobId: number;
  readonly processed: number;
  readonly failed: readonly number[];
  readonly outcome: 'completed' | 'stopped' | 'failed';
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 잡 하나를 끝까지(또는 중단될 때까지) 돌린다.
 *
 * @returns `stopped`는 운영자가 멈춘 것이다 — **실패가 아니다.** 커서가
 * 남아 있어 `resume`이 이어받는다 (AC-4).
 */
export async function runBackfillJob(
  deps: BackfillDeps,
  job: JobRow,
  repository: RepositoryRow,
): Promise<BackfillResult> {
  const now = deps.now ?? ((): Date => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const [owner, repo] = splitTarget(job.target);
  const ref = { owner, repo };

  let cursor = readCursor(job.cursor);
  if (job.cursor !== null && cursor.page === 1 && cursor.done === 0) {
    // 커서가 있었는데 처음으로 되돌아갔다 = 모양이 틀렸다. 조용히 넘기지 않는다.
    deps.log({
      level: 'warn',
      message: '커서를 읽을 수 없어 처음부터 시작한다',
      job_id: job.job_id,
      target: job.target,
      detail: JSON.stringify(job.cursor).slice(0, 200),
    });
  }

  const failed: number[] = [];
  let lastProgressAt = 0;

  /*
   * 시작할 때 **무조건 되돌린 뒤 올린다** (CR-022, DEV-105).
   *
   * 앞선 잡이 프로세스와 함께 죽으면 `finally`가 돌지 않아 인덱스가 `30s`에
   * 남는다. 그대로 두면 NFR-002(수집 반영 p95 10초)를 영구히 어긴다.
   * 설정 실패는 **잡을 중단시키지 않는다** — 색인은 느려질 뿐 계속되고,
   * 백필을 통째로 멈추는 편이 더 나쁘다.
   */
  await tune(deps, 'restore');
  await tune(deps, 'relax');

  try {
    for (;;) {
      // 페이지 **사이**에서만 멈춘다. 중간에 끊으면 커서와 실제 지점이 어긋난다.
      if (!(await jobRepo.isJobRunning(deps.pool, job.job_id))) {
        deps.log({ level: 'info', message: '중단 지시로 멈춘다', job_id: job.job_id, target: job.target });
        return { jobId: job.job_id, processed: cursor.done, failed, outcome: 'stopped' };
      }

      let page;
      try {
        page = await deps.client.listPullRequestsPage(ref, cursor.page, {
          priority: 'backfill',
          perPage: BACKFILL_PAGE_SIZE,
        });
      } catch (error) {
        const retryAt = rateLimitRetryAt(error);
        if (retryAt === null) throw error;
        /*
         * 한도는 시간이 지나면 회복된다. **잡을 실패시키지 않는다** —
         * 실패로 끝내면 운영자가 손으로 다시 눌러야 한다.
         *
         * 상태는 `running`을 유지하고 사유만 진행률에 남긴다 (DEV-104):
         * `paused`로 바꾸면 자동 재개가 운영자의 중단까지 되살린다.
         */
        await jobRepo.updateJobProgress(
          deps.pool,
          job.job_id,
          { ...buildProgress(cursor, null, retryAt) },
          { ...cursor },
        );
        await sleep(sleepMsUntil(retryAt, now()));
        continue;
      }

      for (const summary of page.items) {
        const ok = await projectOne(deps, job, repository, summary);
        if (!ok) failed.push(summary.number);
      }

      cursor = advanceCursor(cursor, page.items.length);

      /*
       * 진행률은 **페이지를 다 처리한 뒤에** 쓴다. 30초 이내 갱신(AC-2)을
       * 지키되 페이지마다 쓰지는 않는다.
       */
      const nowMs = now().getTime();
      if (!page.hasMore || nowMs - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = nowMs;
        await jobRepo.updateJobProgress(
          deps.pool,
          job.job_id,
          // 목록을 끝까지 읽어야 총계를 안다. 그전에는 `null`이다.
          { ...buildProgress(cursor, page.hasMore ? null : cursor.done) },
          { ...cursor },
        );
      }

      if (!page.hasMore) break;
    }

    await jobRepo.finishJob(deps.pool, job.job_id, 'completed');
    deps.log({
      level: 'info',
      message: '백필 완료',
      job_id: job.job_id,
      target: job.target,
      detail: `처리 ${String(cursor.done)}건, 실패 ${String(failed.length)}건`,
    });
    return { jobId: job.job_id, processed: cursor.done, failed, outcome: 'completed' };
  } catch (error) {
    const detail = error instanceof GitHubApiError ? error.message : String(error);
    await jobRepo.finishJob(deps.pool, job.job_id, 'failed', detail.slice(0, 500));
    deps.log({ level: 'error', message: '백필 실패', job_id: job.job_id, target: job.target, detail });
    return { jobId: job.job_id, processed: cursor.done, failed, outcome: 'failed' };
  } finally {
    await tune(deps, 'restore');
  }
}

/**
 * PR 하나를 보강해 색인한다.
 *
 * @returns 실패하면 `false`. **던지지 않는다** — 개별 PR 실패로 잡 전체를
 * 버리지 않는다 (WP-019 구현 범위).
 */
async function projectOne(
  deps: BackfillDeps,
  job: JobRow,
  repository: RepositoryRow,
  summary: Parameters<typeof toEnrichedPullRequest>[0],
): Promise<boolean> {
  const documentVersion = backfillDocumentVersion(summary.updated_at);
  if (documentVersion === null) {
    /*
     * 버전을 모르면 **색인하지 않는다.** 0으로 넣으면 어떤 갱신에도 져서
     * 문서가 영영 안 생기고, 지금 시각으로 넣으면 실시간을 덮어쓴다.
     */
    deps.log({
      level: 'warn',
      message: '갱신 시각을 읽을 수 없어 건너뛴다',
      job_id: job.job_id,
      pr_number: summary.number,
      reason: 'unparsable_updated_at',
    });
    return false;
  }

  const ref = { owner: repository.owner, repo: repository.name };
  const enriched = await enrichForBackfill(deps, repository, ref, summary);

  try {
    const requests = buildUpsertRequests({
      enriched,
      repository,
      // 엔티티가 갱신된 시각이다. 지금 시각이 아니다 (CR-022, DEV-099).
      documentVersion,
      indexedAt: (deps.now ?? ((): Date => new Date()))(),
    });
    await bulkUpsert(deps.es, requests);
    return true;
  } catch (error) {
    deps.log({
      level: 'warn',
      message: 'PR 색인 실패',
      job_id: job.job_id,
      pr_number: summary.number,
      reason: 'index_failed',
      detail: String(error).slice(0, 200),
    });
    return false;
  }
}

/**
 * 백필용 보강.
 *
 * 실시간 보강(`enrich.ts`)과 달리 웹훅 payload가 없어 **API가 유일한 출처**다.
 * 구성 요소가 실패하면 그 부분만 비우고 `enrichment_pending`을 세운다 —
 * 실시간이 하는 것과 같은 규칙이다 (FR-ING-004 AC-3).
 */
async function enrichForBackfill(
  deps: BackfillDeps,
  repository: RepositoryRow,
  ref: { readonly owner: string; readonly repo: string },
  summary: Parameters<typeof toEnrichedPullRequest>[0],
): Promise<IngestionEnriched> {
  const opts = { priority: 'backfill' } as const;
  let sourceCommitShas: readonly string[] = [];
  let sourceCommitsTruncated = false;
  let changedFiles: IngestionEnriched['changed_files'] = [];
  let filesTruncated = false;
  let reviews: IngestionEnriched['reviews'] = [];
  const errors: EnrichmentError[] = [];

  try {
    const commits = await deps.client.listPullRequestCommitsPaged(ref, summary.number, opts);
    sourceCommitShas = commits.items.map((commit) => commit.sha);
    sourceCommitsTruncated = commits.truncated;
  } catch (error) {
    errors.push(failure('commits', error));
  }

  try {
    const files = await deps.client.listPullRequestFilesPaged(ref, summary.number, opts);
    changedFiles = files.items.map((file) => ({
      filename: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
    }));
    filesTruncated = files.truncated;
  } catch (error) {
    errors.push(failure('files', error));
  }

  try {
    const list = await deps.client.listPullRequestReviews(ref, summary.number, opts);
    reviews = list.map((review) => ({
      id: review.id,
      state: review.state,
      reviewer: review.user?.login ?? null,
      submitted_at: review.submitted_at,
    }));
  } catch (error) {
    errors.push(failure('reviews', error));
  }

  return {
    // 결정론적 합성 ID (CR-022, DEV-100).
    delivery_id: backfillDeliveryId(repository.repository_id, summary.number),
    repository_id: repository.repository_id,
    entity_kind: 'pull_request',
    pr_number: summary.number,
    pull_request: toEnrichedPullRequest(summary),
    source_commit_shas: sourceCommitShas,
    changed_files: changedFiles,
    reviews,
    source_commits_truncated: sourceCommitsTruncated,
    files_truncated: filesTruncated,
    enrichment_pending: errors.length > 0,
    enrichment_errors: errors,
    /*
     * 상관 ID를 델리버리 ID와 같게 둔다. 백필에는 요청을 묶는 상위 단위가
     * 없고, 조사할 때 필요한 것은 **어느 PR이었나**뿐이다.
     */
    correlation_id: backfillDeliveryId(repository.repository_id, summary.number),
  };
}

/**
 * 실패를 구성 요소 단위로 기록한다.
 *
 * 메시지는 `safeMessage`를 거친다 — 토큰이 오류 문자열에 섞여 들어오는
 * 경로가 실재하고, 이 값은 이벤트에 실려 나간다 (NFR-005: 로그·응답에
 * 토큰 0건).
 */
function failure(component: EnrichmentComponent, error: unknown): EnrichmentError {
  const kind = error instanceof GitHubApiError ? error.kind : 'unknown';
  const message = error instanceof GitHubApiError ? error.message : String(error);
  return { component, kind, message: safeMessage(message).slice(0, 200) };
}

/** 설정 조정. **실패해도 잡을 멈추지 않는다** (CR-022, DEV-105). */
async function tune(deps: BackfillDeps, action: 'relax' | 'restore'): Promise<void> {
  if (deps.indexTuning === undefined) return;
  try {
    await deps.indexTuning[action]();
  } catch (error) {
    deps.log({
      level: 'warn',
      message: `색인 설정 ${action} 실패 — 백필은 계속한다`,
      reason: 'index_tuning_failed',
      detail: String(error).slice(0, 200),
    });
  }
}

/** `owner/repo` → `[owner, repo]`. 잡의 `target`이 그 모양이다. */
function splitTarget(target: string): readonly [string, string] {
  const slash = target.indexOf('/');
  if (slash < 0) return [target, ''];
  return [target.slice(0, slash), target.slice(slash + 1)];
}

// ------------------------------------------------------------------ 러너

export interface BackfillRunnerOptions {
  readonly maxConcurrent?: number;
  /** 잡이 없을 때 다시 볼 때까지의 간격. */
  readonly idlePollMs?: number;
}

export interface BackfillRunner {
  stop(): Promise<void>;
}

const DEFAULT_IDLE_POLL_MS = 5_000;

/**
 * 큐를 지켜보며 백필을 돌린다 (CR-022, DEV-101).
 *
 * **이벤트를 구독하지 않고 `job` 테이블을 폴링한다.** 동시 실행 상한은
 * "지금 몇 개가 도는가"에 대한 제약이라 어차피 공유 저장소에서 세어야 하고,
 * 실행 지시를 이벤트로도 나르면 진실이 둘이 되어 상한이 새어 나간다.
 *
 * 폴링 간격이 5초인 것은 백필이 **분 단위 작업**이기 때문이다 — 즉시성이
 * 필요한 경로가 아니고, 짧게 두면 잡이 없는 대부분의 시간에 DB만 때린다.
 */
export function startBackfillRunner(
  deps: BackfillDeps & { readonly findRepository: (target: string) => Promise<RepositoryRow | undefined> },
  options: BackfillRunnerOptions = {},
): BackfillRunner {
  const idle = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
  const sleep = deps.sleep ?? defaultSleep;
  let stopped = false;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      let job: JobRow | undefined;
      try {
        job = await jobRepo.claimNextJob(deps.pool, 'backfill', options.maxConcurrent);
      } catch (error) {
        deps.log({ level: 'error', message: '잡 claim 실패', detail: String(error).slice(0, 200) });
      }

      if (job === undefined) {
        // 잡이 없거나 상한에 닿았다. **둘을 구분하지 않는다** — 할 일이 같다.
        await sleep(idle);
        continue;
      }

      const repository = await deps.findRepository(job.target);
      if (repository === undefined) {
        /*
         * 등록이 해제된 저장소다. **잡을 남겨 두지 않는다** — 활성 잡이
         * 남으면 재등록 시 `job_active_uk`가 새 백필을 막는다.
         */
        await jobRepo.finishJob(deps.pool, job.job_id, 'failed', '등록되지 않은 저장소');
        deps.log({
          level: 'warn',
          message: '등록되지 않은 저장소라 잡을 종료한다',
          job_id: job.job_id,
          target: job.target,
        });
        continue;
      }

      await runBackfillJob(deps, job, repository);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      await loop;
    },
  };
}
