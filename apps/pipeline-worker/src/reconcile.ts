/**
 * 조정 스캔 (JOB-ING-005 / WP-028, FR-ING-011, CR-033).
 *
 * 수집 결과와 GHE의 실제 상태를 주기적으로 대조해 **색인에서 빠진 PR**을 찾아
 * 되돌린다. 웹훅은 유실될 수 있고(전송 실패·재시작·서명 오류), 유실된 PR은
 * 아무도 눈치채지 못한 채 검색에서 영영 빠진다 — 조사 도구에서 그것이 가장 나쁜
 * 실패다.
 *
 * ## `since`가 없어서 `desc`로 읽는다 (CR-033, DEV-175)
 *
 * "최근 24시간 갱신 PR"(AC-2)을 물어야 하는데 `/pulls`에는 `since`가 없다.
 * `updated desc`로 읽어 컷오프에 닿으면 멈추는 것이 그 질문에 답하는 유일한
 * 방법이다 — **없는 파라미터를 있는 것처럼 만들지 않는다.** 백필의 `asc` 고정
 * (DEV-098)은 기본값으로 남아 그대로다.
 *
 * ## 되돌리는 방법은 백필과 같다
 *
 * `projectOne`을 그대로 쓴다. "간이 색인" 경로를 따로 만들면 문서 버전 규칙
 * (DEV-099)이나 벌크 항목 실패 처리(DEV-106) 중 하나만 갖는 두 번째 경로가
 * 생긴다.
 */

import { mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import { GitHubApiError, type CommitGraph, type GitHubClient } from '@prs/github';
import { TOPICS, type EventBus } from '@prs/bus';
import {
  deterministicEventId,
  sequencePartitionKey,
  type SequenceRequested,
} from '@prs/domain';
import { applyMandatoryScopeFilter, search } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import { projectOne, type BackfillDeps } from './backfill.js';
import type { WorkerMetrics } from './metrics.js';

/** 스케줄 기본값 (FR-ING-011 AC-1 — 설정값이며 기본 1시간). */
export const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
/** 대조 창 (AC-2). */
export const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 이 수 이상 연속으로 완주하지 못하면 경보다 (예외 처리). */
export const RECONCILE_ALERT_CYCLES = 3;
const PAGE_SIZE = 100;

export interface ReconcileLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository?: string;
  readonly reason?: string;
}

export interface ReconcileDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly client: GitHubClient;
  /** head 채번 요청을 싣는 버스. 게이트웨이가 쓰는 것과 같은 토픽이다 (DEV-180). */
  readonly bus: EventBus;
  readonly metrics: WorkerMetrics;
  readonly graphFor: (repository: RepositoryRow) => CommitGraph;
  /** 되돌리기가 쓸 백필 의존. `projectOne`이 요구하는 것과 같다. */
  readonly backfill: BackfillDeps;
  /**
   * 누락 PR 하나를 되돌린다. **기본값이 백필의 `projectOne`이다** — 되돌리기
   * 경로를 두 벌 두지 않는다는 결정(DEV-176)이 이 기본값에 있다.
   *
   * 주입은 시험을 위한 것이다. 되돌리기를 갈아 끼우라는 뜻이 아니라, 탐지·집계
   * 규칙을 백필 스택 전체 없이 검증하기 위한 이음매다.
   */
  /**
   * 팀 접근 범위 동기화 (WP-068 / CR-036, DEV-190).
   *
   * **마이그레이션은 기존 저장소에 빈 배열을 남긴다.** 등록 경로만이 그것을
   * 채우므로, 마이그레이션 이전부터 있던 저장소는 **누군가 다시 등록하기 전까지
   * 팀으로만 볼 수 있는 상태로 남는다** — 그리고 팀 웹훅의 역조회도 빈 배열이라
   * 그 저장소를 찾지 못한다. 정기 정비가 그 공백을 메운다.
   *
   * 없으면 하지 않는다 (GHE 자격 증명이 없는 배포).
   */
  readonly syncTeams?: (repository: RepositoryRow) => Promise<void>;
  /**
   * 정본 스냅숏 부트스트랩을 큐에 넣는다 (JOB-ING-010 / CR-037, DEV-194).
   *
   * **팀 접근 범위와 같은 이유로 여기에 있다** — 마이그레이션 010은 빈 표를
   * 남기고 그것을 채우는 경로가 없었다. 이미 저장소를 한 바퀴 도는 정기 정비에
   * 얹는 것이 새 스케줄러를 만들지 않는 길이다 (DEV-190의 선례).
   *
   * 한 주기에 일부만 넣는다 — 첫 배포에서 GHE 한도를 통째로 태우지 않는다.
   *
   * @returns 이번 주기에 큐에 넣은 저장소 수.
   */
  readonly enqueueSnapshotBootstrap?: () => Promise<number>;
  readonly reproject?: (
    deps: BackfillDeps,
    repository: RepositoryRow,
    summary: Parameters<typeof projectOne>[3],
  ) => Promise<boolean>;
  readonly log?: (fields: ReconcileLogFields) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ReconcileResult {
  readonly scanned: number;
  readonly missing: number;
  readonly reprojected: number;
  readonly sequenceScheduled: boolean;
  /** 한도 소진 등으로 창을 끝까지 읽지 못했다. 다음 주기로 미룬다. */
  readonly deferred: boolean;
}

/** 색인에 이 PR 문서가 있는가. */
async function isIndexed(deps: ReconcileDeps, repositoryId: number, prNumber: number): Promise<boolean> {
  /*
   * 범위는 **지금 조정 중인 저장소 하나**다 (ADR-008).
   *
   * 시스템 작업이라고 강제 필터를 우회하지 않는다 — 우회 경로를 한 번 만들면
   * 그것이 다음 조회의 선례가 된다. 조정 대상이 그 저장소이므로 그 범위를
   * 그대로 주는 것이 정확하고, 타입 강제도 그대로 지난다.
   */
  const scoped = applyMandatoryScopeFilter(
    { bool: { filter: [{ term: { repository_id: repositoryId } }, { term: { pr_number: prNumber } }] } },
    { kind: 'explicit', repositoryIds: [repositoryId] },
  );
  const response = await search<{ pr_number?: number }>(deps.es, 'prs-pull-requests', scoped, {
    size: 1,
    routing: String(repositoryId),
    _source: ['pr_number'],
  });
  return response.hits.hits.length > 0;
}

/**
 * 한 저장소를 조정한다.
 *
 * 한도가 소진되면 **던지지 않고 `deferred`로 끝낸다** (예외 처리) — 한 저장소의
 * 한도 때문에 나머지 저장소의 스캔까지 버리면 그 주기가 통째로 사라진다.
 */
export async function reconcileRepository(
  deps: ReconcileDeps,
  repository: RepositoryRow,
): Promise<ReconcileResult> {
  const log = deps.log ?? ((): void => undefined);
  const now = (deps.now ?? ((): Date => new Date()))();
  const cutoff = now.getTime() - RECONCILE_WINDOW_MS;
  const ref = { owner: repository.owner, repo: repository.name };
  const slug = `${repository.owner}/${repository.name}`;

  let scanned = 0;
  let missing = 0;
  let reprojected = 0;
  let deferred = false;

  scan: for (let page = 1; ; page += 1) {
    let items;
    try {
      const result = await deps.client.listPullRequestsPage(ref, page, {
        priority: 'backfill',
        perPage: PAGE_SIZE,
        // 최근 것부터. 컷오프에 닿으면 멈춘다 (DEV-175).
        direction: 'desc',
      });
      items = result.items;
      if (!result.hasMore && items.length === 0) break;
    } catch (error) {
      if (error instanceof GitHubApiError && error.kind === 'rate_limited') {
        deferred = true;
        log({ level: 'warn', message: '한도 소진으로 다음 주기로 미룬다', repository: slug, reason: 'rate_limited' });
        break;
      }
      throw error;
    }

    for (const summary of items) {
      const updatedAt = Date.parse(summary.updated_at ?? '');
      // 창을 벗어나면 그 뒤는 전부 더 오래된 것이다 — `desc`라서 성립한다.
      if (!Number.isNaN(updatedAt) && updatedAt < cutoff) break scan;

      scanned += 1;
      if (await isIndexed(deps, repository.repository_id, summary.number)) continue;

      missing += 1;
      deps.metrics.reconcileMissing.inc({ repository: slug, kind: 'pull_request' });
      // 되돌리기는 백필과 같은 경로다 — 두 번째 방식을 만들지 않는다.
      const reproject = deps.reproject ?? ((d, r, sm) => projectOne(d, null, r, sm));
      // 출처를 남긴다 — 스냅숏이 어느 경로에서 왔는지가 조사에 필요하다 (DEV-184).
      const backfillDeps = { ...deps.backfill, snapshotSource: 'reconcile' as const };
      if (await reproject(backfillDeps, repository, summary)) reprojected += 1;
    }

    if (items.length < PAGE_SIZE) break;
  }

  const sequenceScheduled = await scheduleHeadSequence(deps, repository);

  /*
   * 팀 접근 범위를 맞춘다 (CR-036, DEV-190). 등록 경로만으로는 마이그레이션
   * 이전 저장소가 영영 빈 채로 남는다. 실패해도 조정 스캔을 멈추지 않는다.
   */
  if (deps.syncTeams !== undefined) {
    try {
      await deps.syncTeams(repository);
    } catch (error) {
      log({
        level: 'warn',
        message: '팀 접근 범위 동기화 실패 — 다음 주기가 다시 시도한다',
        repository: slug,
        reason: String(error).slice(0, 200),
      });
    }
  }

  return { scanned, missing, reprojected, sequenceScheduled, deferred };
}

/**
 * 대상 브랜치 head에 서수가 없으면 채번을 요청한다 (FR-ING-011 AC-5).
 *
 * 원장 §7이 적어 둔 빈칸을 메우는 항목이다 — 채번은 push 웹훅이 온 저장소만
 * 따라가므로, 웹훅을 놓친 저장소는 아무도 채번을 요청하지 않는다.
 *
 * ## 잡 행이 아니라 **살아 있는 경로**로 보낸다 (CR-034, DEV-180)
 *
 * 처음에는 `sequence_assign` 잡 행을 넣었다. 그런데 **그 유형을 집는 러너가
 * 없다** — 데이터베이스 잡을 claim하는 곳은 백필뿐이고, 정상 채번은 버스
 * 이벤트가 몬다. 그래서 그 행은 영원히 `queued`로 남고, 게다가
 * `findActiveJob`이 그것을 보고 **이후의 모든 복구 시도를 막는다.** 고치려고
 * 만든 것이 고치지 못하게 막는 자물쇠가 된다.
 *
 * 두 번째 채번 실행 구조를 만들지 않는다. 이미 정식으로 살아 있는 경로
 * (`prs:sequence` → `sequence.requested` → JOB-SEQ-001 → `assignSequence`)로
 * 보낸다. 게이트웨이가 push 웹훅에서 내는 것과 **같은 이벤트**다.
 *
 * `head_sha`를 실어 보내지만 소비자는 그것을 맹신하지 않고 실행 시 그래프 head를
 * 다시 읽는다 — 기존 규칙이 그대로 통제한다.
 */
async function scheduleHeadSequence(deps: ReconcileDeps, repository: RepositoryRow): Promise<boolean> {
  const graph = deps.graphFor(repository);
  const ref = { owner: repository.owner, repo: repository.name };
  let scheduled = false;

  for (const baseBranch of repository.sequence_branches) {
    const head = await graph.resolveHead(ref, baseBranch);
    // 브랜치가 없는 것은 오류가 아니다 — 채번할 것이 없다.
    if (head === null) continue;

    const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
    if (space === undefined) continue;

    const seq = await mergeSequenceRepo.findSeqByCommit(
      deps.pool,
      repository.repository_id,
      baseBranch,
      space.seq_epoch,
      head,
    );
    if (seq !== null) continue;

    const correlationId = `reconcile:${String(repository.repository_id)}:${baseBranch}`;
    const payload: SequenceRequested = {
      repository_id: repository.repository_id,
      base_branch: baseBranch,
      head_sha: head,
      correlation_id: correlationId,
    };
    await deps.bus.publish(
      TOPICS.sequence,
      // 파티션 키는 게이트웨이와 같은 규칙이다 — 공간별 직렬이 유지된다.
      sequencePartitionKey(repository.repository_id, baseBranch),
      {
        // 같은 head에 대한 재요청은 같은 ID다 — 멱등이 결정론에서 나온다.
        event_id: deterministicEventId(
          'sequence.requested',
          String(repository.repository_id),
          baseBranch,
          head,
        ),
        event_name: 'sequence.requested',
        correlation_id: correlationId,
        occurred_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
        payload,
      },
    );
    scheduled = true;
  }

  return scheduled;
}

/** 저장소별 연속 미완주 횟수. 3 이상이면 경보다. */
const incompleteCycles = new Map<string, number>();

export function resetReconcileCycles(): void {
  incompleteCycles.clear();
}

/** 등록된 저장소를 한 바퀴 조정한다. */
export async function runReconcileSweep(deps: ReconcileDeps): Promise<{
  readonly repositories: number;
  readonly missing: number;
  readonly deferred: number;
}> {
  const log = deps.log ?? ((): void => undefined);
  const repositories = await repositoryRepo.listRepositories(deps.pool, { status: 'active' });
  let missing = 0;
  let deferred = 0;

  /*
   * 정본 스냅숏 부트스트랩 예약 (CR-037, DEV-194). 저장소 순회 **앞에** 둔다 —
   * 개별 저장소의 조정이 실패해도 예약은 이미 끝나 있다.
   *
   * 실패해도 조정 스캔을 멈추지 않는다. 다음 주기가 다시 시도하고, 그 사이
   * 정합성 감시는 그 저장소를 `snapshot_bootstrap_pending`으로 정직하게 보고한다.
   */
  if (deps.enqueueSnapshotBootstrap !== undefined) {
    try {
      const queued = await deps.enqueueSnapshotBootstrap();
      if (queued > 0) {
        log({ level: 'info', message: `정본 스냅숏 부트스트랩 ${String(queued)}건을 큐에 넣었다` });
      }
    } catch (error) {
      log({
        level: 'warn',
        message: '부트스트랩 예약 실패 — 다음 주기가 다시 시도한다',
        reason: String(error).slice(0, 200),
      });
    }
  }

  for (const repository of repositories) {
    const slug = `${repository.owner}/${repository.name}`;
    try {
      const result = await reconcileRepository(deps, repository);
      missing += result.missing;
      if (result.deferred) {
        deferred += 1;
        const streak = (incompleteCycles.get(slug) ?? 0) + 1;
        incompleteCycles.set(slug, streak);
        deps.metrics.reconcileIncompleteCycles.set(streak, { repository: slug });
        if (streak >= RECONCILE_ALERT_CYCLES) {
          /*
           * 미룸 자체는 정상이다. **미룸이 반복되는 것**이 문제다 — 그 저장소는
           * 사실상 조정되지 않고 있다.
           */
          log({
            level: 'error',
            message: `조정 스캔이 ${String(streak)}주기 연속 완주하지 못했다`,
            repository: slug,
            reason: 'incomplete_cycles',
          });
        }
      } else {
        incompleteCycles.set(slug, 0);
        deps.metrics.reconcileIncompleteCycles.set(0, { repository: slug });
      }
    } catch (error) {
      log({ level: 'error', message: '조정 스캔 실패', repository: slug, reason: String(error).slice(0, 200) });
    }
  }

  return { repositories: repositories.length, missing, deferred };
}

export interface ReconcileSweeper {
  stop(): Promise<void>;
}

/** 주기 조정 스캔. `startReleaseSweeper`와 같은 형태다 (깨울 수 있는 sleep). */
export function startReconcileSweeper(
  deps: ReconcileDeps,
  options: { readonly intervalMs?: number } = {},
): ReconcileSweeper {
  const interval = options.intervalMs ?? RECONCILE_INTERVAL_MS;
  const log = deps.log ?? ((): void => undefined);
  let stopped = false;

  let wake: () => void = () => undefined;
  const interruptibleSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = () => undefined;
        resolve();
      }, ms);
      wake = (): void => {
        clearTimeout(timer);
        wake = () => undefined;
        resolve();
      };
    });
  const sleep = deps.sleep ?? interruptibleSleep;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        const result = await runReconcileSweep(deps);
        log({
          level: result.missing > 0 ? 'warn' : 'info',
          message: `조정 스캔 완료 — 저장소 ${String(result.repositories)}개, 누락 ${String(result.missing)}, 미룸 ${String(result.deferred)}`,
        });
      } catch (error) {
        log({ level: 'error', message: '조정 스캔 스윕 실패', reason: String(error).slice(0, 200) });
      }
      if (stopped) break;
      await sleep(interval);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake();
      await loop;
    },
  };
}
