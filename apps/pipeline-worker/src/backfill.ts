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

import { jobRepo, type JobRow, type Pool, type RepositoryRow, type SnapshotSource } from '@prs/db';
import { GitHubApiError, safeMessage, type GitHubClient } from '@prs/github';
import type { Client } from '@elastic/elasticsearch';
import { bulkUpsert } from '@prs/es';
import { withReindexWrite } from '@prs/db';
import { buildUpsertRequests } from './documents.js';
import { recordProjectionSnapshot } from './snapshot.js';
import { toEnrichedPullRequest } from './enriched-payload.js';
import { describeFailedItems, retryFailedItems } from './index-retry.js';
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
  /** 잡 밖(조정 스캔)에서 부르면 `null`이다 (CR-033, DEV-176). */
  readonly job_id?: number | null;
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
  /** 정본 스냅숏에 남길 출처. 조정 스캔이 `reconcile`로 바꾼다 (CR-034, DEV-184). */
  readonly snapshotSource?: SnapshotSource;
  /**
   * **정본만 남기고 색인은 건드리지 않는다** (CR-037, DEV-194).
   *
   * 부트스트랩(JOB-ING-010)이 쓰는 모드다. 이미 색인된 문서를 다시 쓸 이유가
   * 없고, 전량 재색인은 운영 색인에 부하를 주며 `document_version` 규칙상
   * 결과도 같다. 만드는 문서는 백필과 **완전히 같은 경로**로 만든다 — 다른
   * 경로로 만들면 재구축의 근거와 실제 색인 내용이 갈라진다.
   */
  readonly snapshotOnly?: boolean;
  /**
   * 목록 정렬 키. 기본은 클라이언트 기본값(`updated`)이다 (CR-037, DEV-204).
   *
   * **전량 열거에는 `created`가 안전하다.** `updated`로 페이지를 넘기는 동안 어떤
   * PR이 갱신되면 그 항목이 목록 끝으로 이동하고, 뒤에 있던 항목이 **이미 지나온
   * 페이지 자리로 당겨져 영영 방문되지 않는다.** 생성 시각은 바뀌지 않으므로
   * `created`에서는 어떤 항목도 앞으로 당겨지지 않는다 — 스캔 중 새로 만들어진
   * PR이 끝에 붙을 뿐이고 그것은 우리가 지나갈 자리다.
   *
   * 부트스트랩이 이 값을 쓴다. 완결 표시를 찍는 잡이므로 **건너뜀이 곧 영구 누락**이다.
   */
  readonly listSort?: 'created' | 'updated';
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
          ...(deps.listSort === undefined ? {} : { sort: deps.listSort }),
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
        const ok = await projectOne(deps, job.job_id, repository, summary);
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
 * **조정 스캔(JOB-ING-005)도 이 함수를 쓴다** (CR-033, DEV-176). 색인에서 빠진
 * PR을 되살리는 일은 백필이 하는 일과 정확히 같으므로, "간이 색인" 경로를 따로
 * 만들지 않는다 — 두 경로가 문서 버전 규칙(DEV-099)이나 벌크 항목 실패 처리
 * (DEV-106) 중 하나만 갖게 되는 날이 오기 때문이다.
 *
 * @param jobId 로그에 남길 잡 번호. 잡 밖에서 부르면 `null`이다.
 * @returns 실패하면 `false`. **던지지 않는다** — 개별 PR 실패로 잡 전체를
 * 버리지 않는다 (WP-019 구현 범위).
 */
export async function projectOne(
  deps: BackfillDeps,
  jobId: number | null,
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
      job_id: jobId,
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

    /*
     * **부트스트랩은 부분 보강을 정본으로 쓰지 않는다** (CR-037, DEV-203).
     *
     * `enrichForBackfill`은 커밋·파일·리뷰 조회가 실패해도 던지지 않고
     * `enrichment_pending` 문서를 만든다. 그 문서를 스냅숏에 쓰면 두 가지가
     * 한꺼번에 잘못된다: 스냅숏 업서트는 **같은 `document_version`을 덮으므로**
     * 이미 완전한 스냅숏을 반쪽으로 되돌릴 수 있고, 그러고도 이 PR이 성공으로
     * 세어져 저장소가 "부트스트랩 완료"로 찍힌다 — 그 뒤에는 아무도 다시 채우지
     * 않는다. 실패로 세어 **다음 회차가 같은 PR을 다시 보게** 한다.
     *
     * 실시간·백필 경로는 그대로다. 그쪽은 부분 문서라도 색인에 실어 두는 것이
     * 맞고(`enrichment_pending`이 그 사실을 말한다) 보강 재시도 경로가 따로 있다.
     */
    if (deps.snapshotOnly === true && enriched.enrichment_pending) {
      deps.log({
        level: 'warn',
        message: '보강이 불완전해 정본 스냅숏을 남기지 않는다 — 다음 회차가 다시 본다',
        job_id: jobId,
        pr_number: summary.number,
        reason: 'enrichment_pending',
      });
      return false;
    }

    /*
     * **정본을 색인보다 먼저 남긴다** (CR-034, DEV-184 / ADR-004). 백필·조정은
     * GHE에서 직접 읽어 색인에만 써 왔다 — `raw_event`가 없으므로 이 스냅숏이
     * 없으면 그 PR들은 색인에만 존재하고, 색인을 잃으면 되살릴 근거가 없다.
     */
    await recordProjectionSnapshot(deps.pool, requests, {
      repositoryId: repository.repository_id,
      prNumber: summary.number,
      source: deps.snapshotSource ?? 'backfill',
    });

    if (deps.snapshotOnly === true) {
      /*
       * 부트스트랩은 여기서 끝난다 (CR-037, DEV-194). 색인은 이미 그 문서를
       * 갖고 있고, 우리가 메우려는 공백은 **PostgreSQL 쪽**이다.
       */
      return true;
    }

    /*
     * **벌크가 200이어도 항목은 실패할 수 있다** (CR-022, DEV-106).
     *
     * `bulkUpsert`는 항목 실패를 던지지 않고 분류해서 돌려준다. 결과를 보지
     * 않으면 매핑 거부(THR-010)로 문서가 하나도 안 생긴 PR을 "색인했다"고
     * 세게 되고, 운영자는 실패 0건인 완료 보고를 받는다 — 검색에서 그 PR은
     * "그런 PR은 없다"로 읽힌다.
     *
     * 재시도 사다리는 실시간 투영과 같은 것을 쓴다. 여기서 끝내 실패한
     * 항목은 **이 PR 하나만** 실패로 세고 잡은 계속 간다.
     */
    // 재색인 울타리 안에서 쓴다 (WP-035, DEV-296·308) — 재시도까지 같은 구간이다.
    const settled = await withReindexWrite(deps.pool, async (targets) => {
      const { outcomes } = await bulkUpsert(deps.es, requests, targets);
      return retryFailedItems(deps.es, outcomes, targets, deps.sleep);
    });
    const detail = describeFailedItems(settled);
    if (detail !== '') {
      deps.log({
        level: 'warn',
        message: 'PR 색인 실패',
        job_id: jobId,
        pr_number: summary.number,
        reason: 'index_failed',
        detail: detail.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (error) {
    deps.log({
      level: 'warn',
      message: 'PR 색인 실패',
      job_id: jobId,
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
  /**
   * 집을 잡 유형. 기본은 `backfill` (CR-037, DEV-194).
   *
   * 부트스트랩은 같은 페이지네이션·커서·중단 처리를 쓰므로 두 번째 러너를
   * 만들지 않는다 — 큐에서 집는 유형만 다르다.
   */
  readonly jobType?: 'backfill' | 'snapshot_bootstrap';
  /** 잡이 정상 완료했을 때. 부트스트랩이 완료 시점을 기록하는 자리다. */
  readonly onCompleted?: (repository: RepositoryRow, result: BackfillResult) => Promise<void>;
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
        job = await jobRepo.claimNextJob(deps.pool, options.jobType ?? 'backfill', options.maxConcurrent);
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

      const result = await runBackfillJob(deps, job, repository);
      if (result.outcome === 'completed' && options.onCompleted !== undefined) {
        try {
          await options.onCompleted(repository, result);
        } catch (error) {
          deps.log({
            level: 'warn',
            message: '완료 후 처리에 실패했다 — 다음 주기가 다시 집는다',
            job_id: job.job_id,
            target: job.target,
            detail: String(error).slice(0, 200),
          });
        }
      }
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      await loop;
    },
  };
}
