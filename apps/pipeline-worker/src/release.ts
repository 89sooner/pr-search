/**
 * JOB-REL-007 릴리스 태그 스냅숏 동기화 (WP-024 / CR-028, DEV-142~145).
 *
 * ## 흐름
 *
 *   미러 fetch → `refs/tags` 전량 열거 → 서수 재해석 → PostgreSQL diff
 *   (upsert + 스냅숏 밖 삭제) → COMMIT → Elasticsearch 투영 → 배지 비정규화
 *
 * ## 왜 전량 diff인가
 *
 * 신호(EVT-REL-001)는 태그 이름을 나르지 않는다 — 이벤트 순서 역전이 스냅숏을
 * 되돌리지 못하게 하기 위해서다. 갱신은 언제나 "미러가 지금 말하는 태그 전부"를
 * 정본과 맞추므로 멱등하고, 놓친 신호는 다음 신호나 6시간 스윕이 메운다.
 *
 * ## 왜 서수를 매번 다시 해석하는가 (DEV-149)
 *
 * 릴리스의 `merge_seq`는 `seq_epoch`에 묶인다. 재채번(WP-022)이 에폭을 올리면
 * 이전 에폭 서수는 다른 커밋을 가리킬 수 있다 — 태그 수는 작으므로 매 회차
 * 전량을 현재 에폭 기준으로 다시 해석하는 것이 조건부 갱신보다 싸고 안전하다.
 */

import type { Client } from '@elastic/elasticsearch';
import type { EventBus, DeliveredEvent, EventHandler, SubscribeOptions, Subscription } from '@prs/bus';
import { TOPICS, consumerGroup } from '@prs/bus';
import {
  mergeSequenceRepo,
  releaseLockKey,
  releaseRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  tryAdvisoryXactLock,
  withTransaction,
  type Pool,
  type ReleaseRow,
  type RepositoryRow,
} from '@prs/db';
import {
  applyReleaseTagsToDocuments,
  deleteReleaseDocuments,
  upsertReleaseDocuments,
  DENORM_TAG_LIMIT,
  type ReleaseDocInput,
} from '@prs/es';
import { sequenceSpaceLabel, type ReleaseRefreshRequested } from '@prs/domain';
import type { MirrorTag, RepoRef, ReleaseSummary } from '@prs/github';
import type { WorkerMetrics } from './metrics.js';

export interface ReleaseLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository_id?: number;
  readonly correlation_id?: string;
  readonly reason?: string;
  readonly tag_count?: number;
  readonly deleted_count?: number;
  readonly resolved_count?: number;
  readonly dropped_count?: number;
}

export interface ReleaseDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly bus: EventBus;
  readonly metrics: WorkerMetrics;
  /** 미러를 최신으로 만든다. 태그의 정본이 미러이므로(DEV-143) 갱신은 fetch로 시작한다. */
  readonly sync: (ref: RepoRef, repositoryId: number) => Promise<unknown>;
  /** 미러의 refs/tags 스냅숏. */
  readonly listTags: (ref: RepoRef) => Promise<readonly MirrorTag[]>;
  /**
   * GitHub Release 목록 (DEV-147). **없어도 된다** — GHE 자격 증명이 없는
   * 배포에서는 `git_tag` 소스만으로 돈다. 있으면 발행된 릴리스의 `published_at`이
   * 같은 태그의 시각을 덮는다.
   */
  readonly listReleases?: (ref: RepoRef) => Promise<readonly ReleaseSummary[]>;
  readonly log?: (fields: ReleaseLogFields) => void;
  readonly now?: () => Date;
}

export type RefreshOutcome =
  | {
      readonly kind: 'refreshed';
      readonly tagCount: number;
      readonly deletedCount: number;
      /** 서수까지 해석된(체인 위) 릴리스 수. */
      readonly resolvedCount: number;
    }
  /** 다른 갱신이 락을 쥐고 있다. diff는 멱등이므로 그쪽 결과가 곧 이쪽 결과다. */
  | { readonly kind: 'locked' }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

function refOf(repository: RepositoryRow): RepoRef {
  return { owner: repository.owner, repo: repository.name };
}

/**
 * GitHub Release의 `published_at` 덮어쓰기 표 (DEV-147).
 *
 * 초안(draft)과 `published_at` 없는 항목은 걸러진다 — 발행되지 않은 릴리스는
 * 앵커가 아니다.
 */
export function publishedAtByTag(
  releases: readonly ReleaseSummary[],
): ReadonlyMap<string, string> {
  const byTag = new Map<string, string>();
  for (const release of releases) {
    if (release.draft || release.published_at === null) continue;
    byTag.set(release.tag_name, release.published_at);
  }
  return byTag;
}

/**
 * 저장소 하나의 릴리스 스냅숏을 정본·색인과 맞춘다.
 */
export async function refreshReleases(
  deps: ReleaseDeps,
  repositoryId: number,
  correlationId = '',
): Promise<RefreshOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  if (repository === undefined) {
    log({
      level: 'warn',
      message: '등록되지 않은 저장소의 릴리스 갱신 신호다',
      repository_id: repositoryId,
      correlation_id: correlationId,
      reason: 'repository_not_registered',
    });
    return { kind: 'skipped', reason: 'repository_not_registered' };
  }

  const ref = refOf(repository);

  /*
   * 1. 미러를 최신으로. **fetch가 실패하면 여기서 끝낸다** — 오래된 스냅숏으로
   * diff하면 방금 원격에 생긴 태그를 "없다"고 판단해 지워 버릴 수 있다.
   * 아무것도 바꾸지 않고 실패로 남기는 쪽이 옳다.
   */
  try {
    await deps.sync(ref, repositoryId);
  } catch (error) {
    log({
      level: 'error',
      message: '미러 동기화 실패 — 릴리스 스냅숏을 갱신하지 않는다',
      repository_id: repositoryId,
      correlation_id: correlationId,
      reason: 'mirror_sync_failed',
    });
    deps.metrics.releaseRefreshFailed.inc();
    void error;
    return { kind: 'failed', reason: 'mirror_sync_failed' };
  }

  let tags: readonly MirrorTag[];
  try {
    tags = await deps.listTags(ref);
  } catch {
    log({
      level: 'error',
      message: '태그 열거 실패 — 릴리스 스냅숏을 갱신하지 않는다',
      repository_id: repositoryId,
      correlation_id: correlationId,
      reason: 'tag_list_failed',
    });
    deps.metrics.releaseRefreshFailed.inc();
    return { kind: 'failed', reason: 'tag_list_failed' };
  }

  // 2. GHE 덮어쓰기 (선택). 실패해도 git_tag 값으로 계속 간다 — 덮어쓰기는 보강이지 조건이 아니다.
  let published: ReadonlyMap<string, string> = new Map();
  if (deps.listReleases !== undefined) {
    try {
      published = publishedAtByTag(await deps.listReleases(ref));
    } catch {
      log({
        level: 'warn',
        message: 'GitHub Release 조회 실패 — git_tag 시각으로 계속 간다',
        repository_id: repositoryId,
        correlation_id: correlationId,
        reason: 'github_releases_unavailable',
      });
    }
  }

  /*
   * 3. 브랜치별 현재 에폭. 시퀀스 공간이 없는 브랜치는 서수를 해석할 기준이
   * 없다 — 그 브랜치로는 해석을 시도하지 않는다(채번이 서면 다음 갱신이 잡는다).
   */
  const spaces: { branch: string; epoch: number }[] = [];
  for (const branch of repository.sequence_branches) {
    const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, branch);
    if (space !== undefined) spaces.push({ branch, epoch: space.seq_epoch });
  }

  // 4. 정본 diff. 락 → 태그별 서수 해석 → upsert → 스냅숏 밖 삭제, 트랜잭션 하나.
  let deletedTags: string[] = [];
  let resolvedCount = 0;
  try {
    const outcome = await withTransaction(deps.pool, async (client) => {
      if (!(await tryAdvisoryXactLock(client, releaseLockKey(repositoryId)))) {
        return 'locked' as const;
      }

      for (const tag of tags) {
        /*
         * 시퀀스 브랜치를 **등록 순서대로** 시도해 첫 체인 적중을 쓴다. 같은
         * 커밋이 두 브랜치의 first-parent 체인에 함께 있는 경우는 드물고,
         * 그때 순서가 결정론을 만든다 — 실행마다 답이 흔들리면 안 된다.
         */
        let resolved: { branch: string; epoch: number; seq: number } | null = null;
        for (const space of spaces) {
          const seq = await mergeSequenceRepo.findSeqByCommit(
            client,
            repositoryId,
            space.branch,
            space.epoch,
            tag.commitSha,
          );
          if (seq !== null) {
            resolved = { branch: space.branch, epoch: space.epoch, seq };
            break;
          }
        }
        if (resolved !== null) resolvedCount += 1;

        await releaseRepo.upsertRelease(client, {
          repository_id: repositoryId,
          tag_name: tag.name,
          commit_sha: tag.commitSha.toLowerCase(),
          base_branch: resolved?.branch ?? null,
          seq_epoch: resolved?.epoch ?? null,
          merge_seq: resolved?.seq ?? null,
          released_at: new Date(published.get(tag.name) ?? tag.createdAt),
          source: published.has(tag.name) ? 'github_release' : 'git_tag',
        });
      }

      deletedTags = await releaseRepo.deleteReleasesNotIn(
        client,
        repositoryId,
        tags.map((tag) => tag.name),
      );
      return 'committed' as const;
    });

    if (outcome === 'locked') return { kind: 'locked' };
  } catch (error) {
    log({
      level: 'error',
      message: '릴리스 정본 갱신 실패',
      repository_id: repositoryId,
      correlation_id: correlationId,
      reason: 'release_upsert_failed',
    });
    deps.metrics.releaseRefreshFailed.inc();
    void error;
    return { kind: 'failed', reason: 'release_upsert_failed' };
  }

  /*
   * 5. 커밋 뒤 색인 반영. 실패해도 정본은 이미 맞다 — 다음 갱신이 다시 비춘다
   * (ADR-004: PostgreSQL이 먼저다). 각 단계는 자기 try를 갖는다: 투영 실패가
   * 배지 비정규화를 막을 이유가 없다.
   */
  const rows = await releaseRepo.listReleases(deps.pool, repositoryId);
  const syncedAtMs = (deps.now ?? ((): Date => new Date()))().getTime();

  try {
    const result = await upsertReleaseDocuments(
      deps.es,
      {
        repositoryId,
        orgId: repository.org_id,
        visibility: repository.visibility,
        repository: `${repository.owner}/${repository.name}`,
      },
      rows.map(toDocInput(repository)),
      syncedAtMs,
    );
    if (result.hasFailures) throw new Error('release_index_partial_failure');
    await deleteReleaseDocuments(deps.es, repositoryId, deletedTags);
  } catch {
    log({
      level: 'error',
      message: '릴리스 색인 반영 실패 — 정본은 갱신됐고 다음 회차가 다시 비춘다',
      repository_id: repositoryId,
      correlation_id: correlationId,
      reason: 'release_index_failed',
    });
    deps.metrics.releaseIndexFailed.inc();
  }

  // 6. 배지 비정규화 (표시 전용). 공간별로 released_at 오름차순 목록을 넘긴다.
  for (const space of spaces) {
    const denorm = rows
      .filter(
        (row) =>
          row.base_branch === space.branch && row.seq_epoch === space.epoch && row.merge_seq !== null,
      )
      .sort((a, b) => a.released_at.getTime() - b.released_at.getTime())
      .map((row) => ({ tagName: row.tag_name, mergeSeq: Number(row.merge_seq) }));

    if (denorm.length > DENORM_TAG_LIMIT) {
      // 조용한 절삭 금지 — 상한을 넘긴 만큼은 배지에서 빠진다고 말한다.
      log({
        level: 'warn',
        message: '비정규화 태그가 상한을 넘어 잘랐다 — 배지가 일부 릴리스를 놓친다',
        repository_id: repositoryId,
        correlation_id: correlationId,
        dropped_count: denorm.length - DENORM_TAG_LIMIT,
      });
    }

    try {
      await applyReleaseTagsToDocuments(deps.es, {
        repositoryId,
        baseBranch: space.branch,
        seqEpoch: space.epoch,
        releases: denorm,
      });
    } catch {
      log({
        level: 'error',
        message: '릴리스 배지 비정규화 실패 — 표시 전용이라 판정은 그대로다',
        repository_id: repositoryId,
        correlation_id: correlationId,
        reason: 'release_denorm_failed',
      });
      deps.metrics.releaseIndexFailed.inc();
    }
  }

  log({
    level: 'info',
    message: '릴리스 스냅숏 동기화 완료',
    repository_id: repositoryId,
    correlation_id: correlationId,
    tag_count: tags.length,
    deleted_count: deletedTags.length,
    resolved_count: resolvedCount,
  });
  deps.metrics.releaseRefreshed.inc();
  return { kind: 'refreshed', tagCount: tags.length, deletedCount: deletedTags.length, resolvedCount };
}

function toDocInput(repository: RepositoryRow): (row: ReleaseRow) => ReleaseDocInput {
  return (row) => ({
    tagName: row.tag_name,
    commitSha: row.commit_sha,
    baseBranch: row.base_branch,
    seqEpoch: row.seq_epoch,
    mergeSeq: row.merge_seq === null ? null : Number(row.merge_seq),
    releasedAt: row.released_at.toISOString(),
    source: row.source,
    sequenceSpace:
      row.base_branch === null
        ? null
        : sequenceSpaceLabel(`${repository.owner}/${repository.name}`, row.base_branch),
  });
}

/** JOB-REL-007의 락 재시도 지연. */
export const RELEASE_LOCK_RETRY_MS = 15_000;

export async function handleReleaseEvent(
  deps: ReleaseDeps,
  event: DeliveredEvent,
): Promise<{ kind: 'ack' } | { kind: 'defer'; until: Date; reason: string }> {
  const payload = event.payload as Partial<ReleaseRefreshRequested> | undefined;
  const repositoryId = payload?.repository_id;

  if (typeof repositoryId !== 'number') {
    (deps.log ?? ((): void => undefined))({
      level: 'error',
      message: '릴리스 이벤트의 모양이 틀렸다',
      reason: 'malformed_release_event',
    });
    return { kind: 'ack' };
  }

  const outcome = await refreshReleases(deps, repositoryId, event.correlation_id);
  if (outcome.kind === 'locked') {
    const now = (deps.now ?? ((): Date => new Date()))();
    return { kind: 'defer', until: new Date(now.getTime() + RELEASE_LOCK_RETRY_MS), reason: 'release_locked' };
  }
  return { kind: 'ack' };
}

export interface StartReleaseOptions {
  readonly subscribe?: SubscribeOptions;
}

/** `prs:release` 소비를 시작한다. */
export async function startReleaseWorker(
  deps: ReleaseDeps,
  options: StartReleaseOptions = {},
): Promise<Subscription> {
  const handler: EventHandler = async (event) => handleReleaseEvent(deps, event);
  return deps.bus.subscribe(TOPICS.release, consumerGroup(TOPICS.release), handler, options.subscribe ?? {});
}

/** 6시간 보정 스윕 (JOB-REL-007의 두 번째 트리거). 신호 유실을 상한 6시간의 지연으로 바꾼다. */
export const RELEASE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export interface ReleaseSweeper {
  stop(): Promise<void>;
}

/**
 * 활성 저장소 전체를 순회하며 릴리스 스냅숏을 맞춘다.
 *
 * 미러 스윕과 같은 이유·같은 모양이다: 실시간 신호가 유실됐을 때의 보정이며,
 * 갱신이 멱등 diff라 겹쳐 돌아도 결과가 같다.
 */
export function startReleaseSweeper(
  deps: ReleaseDeps & { readonly sleep?: (ms: number) => Promise<void> },
  options: { readonly intervalMs?: number } = {},
): ReleaseSweeper {
  const interval = options.intervalMs ?? RELEASE_SWEEP_INTERVAL_MS;
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? ((): void => undefined);
  let stopped = false;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        const repositories = await repositoryRepo.listRepositories(deps.pool, { status: 'active' });
        let refreshed = 0;
        for (const repository of repositories) {
          if (stopped) break;
          const outcome = await refreshReleases(deps, repository.repository_id, 'release-sweep');
          if (outcome.kind === 'refreshed') refreshed += 1;
        }
        log({ level: 'info', message: `릴리스 보정 스윕 완료 — ${String(refreshed)}건 동기화` });
      } catch (error) {
        log({ level: 'error', message: '릴리스 스윕 실패', reason: String(error).slice(0, 200) });
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
