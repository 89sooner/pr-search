/**
 * JOB-ING-006 무중단 재색인 (WP-035 / FR-ING-008, CR-045~047).
 *
 * ## 절차
 *
 * ```
 * prepare     대상 버전 인덱스를 처음부터 만든다 (별칭은 아직 안 붙인다)
 * dual_write  이중 쓰기를 활성화한다 — **배타 울타리 안에서**, 스캔보다 먼저
 * backfill    PostgreSQL 정본에서 문서를 다시 만든다
 * verify      전환 전 일곱 가지를 확인한다
 * cutover     배타 울타리 안에서 별칭을 한 번에 옮긴다
 * retention   옛 인덱스를 7일 보관한다
 * ```
 *
 * ## 재구축이 운영 쓰기 경로를 그대로 지난다
 *
 * 재구축도 `withReindexWrite`를 지난다 — 그래서 **서비스 인덱스와 shadow에 함께**
 * 쓴다. 서비스 쪽은 같은 `document_version`이라 조건부 스크립트가 `noop`으로
 * 끝내므로 실제로 바뀌는 것은 shadow뿐이다.
 *
 * 이렇게 하는 이유는 "두 번째 문서 생성 경로를 만들지 않는다"(DEV-295)를 **구조로**
 * 지키기 위해서다. shadow 전용 쓰기 함수를 따로 두면 그것이 곧 두 번째 경로이고,
 * 평시 투영이 바뀔 때 함께 바뀌지 않는다.
 *
 * ## 옛 인덱스를 읽지 않는다 (ADR-004)
 *
 * `client.reindex({ source, dest })`를 쓰지 않는다. 옛 인덱스에만 있는 오염이
 * 그대로 옮겨 가면 "색인은 정본만으로 재구축 가능하다"가 증명되지 않는다 —
 * 증명하려는 성질을 우회하는 구현이다.
 */

import {
  commitSnapshotRepo,
  jobRepo,
  mergeSequenceRepo,
  prSnapshotRepo,
  releaseRepo,
  reindexRepo,
  repositoryRepo,
  withReindexExclusive,
  withReindexWrite,
  type JobRow,
  type Pool,
  type ReindexProgress,
  type RepositoryRow,
} from '@prs/db';
import {
  bulkUpsert,
  createVersionedIndex,
  deleteRetiredIndex,
  isEntityAlias,
  releaseDocId,
  resolveServingIndex,
  schemaOf,
  switchAlias,
  upsertCommitMetadata,
  upsertReleaseDocuments,
  type EntityAlias,
  type UpsertRequest,
  type VersionedIndexSchema,
} from '@prs/es';
import { commitDocId, pullRequestDocId } from '@prs/domain';
import type { Client } from '@elastic/elasticsearch';

import { commitCreateFields, commitMetadataFields, type CommitFactSource } from './commit-enrich.js';
import { buildProjectedCommitDocument, registryOwnedFields } from './documents.js';
import { toDocInput } from './release.js';

/** 잡 카탈로그 이름. */
export const REINDEX_JOB = 'JOB-ING-006' as const;
/** `job.type`. */
export const REINDEX_TYPE = 'reindex' as const;

/** 한 번에 정본에서 읽는 행 수. */
export const REINDEX_BATCH = 200;
/** 큐를 확인하는 주기. */
export const REINDEX_POLL_MS = 5_000;
/** 보관 기간 (FR-ING-008 AC-4). */
export const RETENTION_DAYS = 7;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** 보관 정리 스윕 주기. */
export const RETENTION_SWEEP_MS = 60 * 60 * 1000;
/** 전환 성공 뒤 그 사실을 정본에 남기려 다시 시도하는 횟수 (PR #52 리뷰 P2). */
export const SWITCH_RECORD_ATTEMPTS = 3;
/** 한 번의 정리 스윕이 지우는 인덱스 수 상한. */
export const RETENTION_SWEEP_BATCH = 10;

/**
 * 동시 실행 상한은 **1**이다 (DEV-300).
 *
 * 재색인은 클러스터 자원을 통째로 쓰므로 일반 잡의 3을 적용하지 않는다.
 */
export const REINDEX_MAX_CONCURRENT = 1;

export interface ReindexLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly job_id?: number;
  readonly alias?: string;
  readonly phase?: string;
  readonly target_index?: string;
  readonly reason?: string;
  readonly detail?: string;
  readonly scanned?: number;
  readonly written?: number;
}

/**
 * 간선 재구축 포트 (DEV-295).
 *
 * `prs-links`의 정본은 표 하나가 아니라 **정본 엔티티에서의 재파생**이다.
 * JOB-REL-006이 그 경로를 이미 갖고 있으므로 여기서 다시 만들지 않고 포트로
 * 받는다 — 두 번째 파생 알고리즘을 만들지 않는다.
 *
 * 포트가 없으면 `prs-links` 재색인은 **실패한다.** 비어 있는 간선 인덱스로
 * 전환하는 것보다 실패가 낫다.
 */
export interface LinkRebuildPort {
  /** 저장소 하나의 간선을 정본에서 다시 파생한다. @returns 처리한 source 수. */
  rebuildRepository(repository: RepositoryRow): Promise<number>;
}

export interface ReindexDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly log?: (fields: ReindexLogFields) => void;
  readonly now?: () => Date;
  /**
   * 대상 인덱스의 스키마를 고른다. 기본은 현재 `ENTITY_INDICES` 정의다.
   *
   * **WP-032 선행 조건 증명이 이것을 쓴다** — v1에 없는 분석기·다중 필드를 가진
   * 시험용 v2를 세워 별칭을 옮긴다. 운영에서는 넘기지 않는다.
   */
  readonly schemaFor?: (alias: EntityAlias) => VersionedIndexSchema;
  readonly links?: LinkRebuildPort;
  readonly retentionMs?: number;
  /** 시험이 색인 가시성을 기다리지 않게 한다. 운영은 기본값(끔)이다. */
  readonly refresh?: boolean;
}

function nowOf(deps: ReindexDeps): Date {
  return (deps.now ?? ((): Date => new Date()))();
}

function logOf(deps: ReindexDeps): (fields: ReindexLogFields) => void {
  return deps.log ?? ((): void => undefined);
}

/* ------------------------------------------------------------------------- */
/* 정본 재구축                                                                 */
/* ------------------------------------------------------------------------- */

interface RebuildTally {
  scanned: number;
  written: number;
  /**
   * 이 재구축이 쓴 **서로 다른 문서 id**.
   *
   * 커버리지 판정의 재료다 (PR #52 리뷰 P1). 처리한 *source* 수를 쓰면 안 된다 —
   * 간선은 source 하나가 0개에서 여러 개의 문서를 내므로 관계가 없는 저장소에서
   * `0 < N`이 되어 **정상적인 재색인이 영원히 전환하지 못한다.**
   */
  readonly documentIds: Set<string>;
}

/** 등록된 저장소 전부. 해제된 것도 포함한다 — 문서는 소프트 삭제이므로 남아 있다. */
async function allRepositories(pool: Pool): Promise<readonly RepositoryRow[]> {
  const out: RepositoryRow[] = [];
  const page = 200;
  for (let offset = 0; ; offset += page) {
    const rows = await repositoryRepo.listRepositories(pool, {}, page, offset);
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/**
 * PR 문서를 정본에서 다시 만든다.
 *
 * `pull_request_snapshot.document`가 **투영이 만든 `_source` 그 자체**다
 * (`recordProjectionSnapshot`이 그렇게 남긴다). 그래서 여기서 문서를 다시
 * 조립하지 않는다 — 조립하면 그것이 두 번째 빌더다.
 */
async function rebuildPullRequests(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
): Promise<void> {
  const repositoryId = Number(repository.repository_id);
  let after = 0;

  for (;;) {
    const rows = await prSnapshotRepo.listSnapshotsAfter(deps.pool, repositoryId, after, REINDEX_BATCH);
    if (rows.length === 0) break;

    /*
     * **레지스트리 소유 필드는 현재 값으로 덮는다** (PR #52 리뷰 P1).
     *
     * 스냅숏은 투영 시점의 사본이고, `repository_archived`·`allowed_team_ids`는
     * 그 뒤 `update_by_query`로 색인에만 소급 반영된다 — 스냅숏에는 되쓰이지
     * 않는다. 스냅숏을 그대로 쓰면 전환이 **회수된 팀의 접근을 되살린다.**
     */
    const scope = registryOwnedFields(repository);
    const requests: UpsertRequest[] = rows.map((row) => ({
      alias: 'prs-pull-requests' as const,
      id: pullRequestDocId(repositoryId, row.pr_number),
      routing: String(repositoryId),
      doc: { ...row.document, ...scope } as UpsertRequest['doc'],
    }));

    await withReindexWrite(deps.pool, async (targets) => {
      const result = await bulkUpsert(deps.es, requests, targets);
      const rejected = result.outcomes.filter((one) => one.kind !== 'ok');
      if (rejected.length > 0) {
        throw new Error(`pr_rebuild_item_failure: ${rejected[0]?.reason ?? 'unknown'}`);
      }
    });

    tally.scanned += rows.length;
    tally.written += rows.length;
    for (const request of requests) tally.documentIds.add(request.id);
    after = rows[rows.length - 1]?.pr_number ?? after;
    if (rows.length < REINDEX_BATCH) break;
  }
}

/**
 * 커밋 문서를 정본에서 다시 만든다.
 *
 * `commit_snapshot`이 git 사실을, `merge_sequence`가 first-parent 체인에서의
 * 역할과 PR 소속을 준다. 문서 필드 구성은 **보강과 같은 함수**를 쓴다
 * (`commitMetadataFields`·`commitCreateFields`) — 따로 만들면 재구축 결과와
 * 평시 결과가 갈라진다.
 *
 * 서수(`merge_seq`·`seq_epoch`)는 여기서 싣지 않는다. 채번 반영은
 * `applySequenceToDocuments`가 소유하고 그 경로가 재구축 뒤에 돈다 —
 * 같은 값을 두 곳에서 쓰면 어느 쪽이 정본인지 사라진다.
 */
async function rebuildCommits(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
): Promise<void> {
  const repositoryId = Number(repository.repository_id);
  const indexedAt = nowOf(deps).toISOString();
  let after = '';

  for (;;) {
    const rows = await commitSnapshotRepo.listCommitSnapshotsAfter(
      deps.pool,
      repositoryId,
      after,
      REINDEX_BATCH,
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const sha = row.commit_sha.toLowerCase();
      const points = await mergeSequenceRepo.findByCommitSha(deps.pool, repositoryId, sha);
      const point = points[0];

      const fact: CommitFactSource = {
        parentShas: row.parent_shas,
        message: row.message,
        author: row.author,
        committer: row.committer,
        authoredAt: row.authored_at.toISOString(),
        committedAt: row.committed_at.toISOString(),
        changedPaths: row.changed_paths,
        changedPathsTruncated: row.changed_paths_truncated,
        patchId: row.patch_id,
        patchIdUnavailable: row.patch_id_unavailable,
        /*
         * **first-parent 체인에 있을 때만 역할을 싣는다** (DEV-207). 체인 밖 커밋의
         * 역할은 우리가 판정하지 않았고, 판정하지 않은 것을 문서에 적으면 그것이
         * 거짓말이 된다.
         */
        ...(point === undefined
          ? {}
          : { role: point.pull_request_number === null ? 'direct_push' : 'merge_commit' }),
      };

      await withReindexWrite(deps.pool, (targets) =>
        upsertCommitMetadata(
          deps.es,
          {
            repositoryId,
            commitSha: sha,
            docId: commitDocId(repositoryId, sha),
            fields: commitMetadataFields(fact),
            /*
             * 체인에 있는 커밋만 만든다 — 접근 범위를 확신할 수 있는 자리이기
             * 때문이다 (DEV-213, fail closed). 체인 밖 커밋은 PR 투영이 만든
             * 문서를 갱신하기만 한다.
             */
            ...(point === undefined
              ? {}
              : {
                  createWith: commitCreateFields(repository, fact, {
                    pullRequestNumber: point.pull_request_number,
                    baseBranch: point.base_branch,
                    indexedAt,
                  }),
                }),
          },
          targets,
        ),
      );

      tally.scanned += 1;
      tally.written += 1;
      tally.documentIds.add(commitDocId(repositoryId, sha));
      after = sha;
    }

    if (rows.length < REINDEX_BATCH) break;
  }

  await rebuildProjectedCommits(deps, repository, tally, indexedAt);
}

/**
 * PR 유래 커밋 문서를 정본에서 다시 만든다 (PR #52 리뷰 P1).
 *
 * `commit_snapshot`은 **first-parent 체인만** 덮는다 — 보강 대상이
 * `merge_sequence`에서 나오기 때문이다(`listCommitsMissingSnapshot`). 그래서
 * 스냅숏만 읽으면 **PR의 원본 커밋 문서가 통째로 빠진 인덱스**로 전환하게 되고,
 * 그것은 FR-SRCH-002(SHA → PR)가 그 커밋들에 대해 "그런 커밋은 없다"로 답한다는 뜻이다.
 *
 * 재료는 전부 `pull_request_snapshot.document`에 있다. 문서는 투영과 **같은
 * 함수**가 만든다 — 두 번째 생성 경로를 만들지 않는다.
 */
async function rebuildProjectedCommits(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
  indexedAt: string,
): Promise<void> {
  const repositoryId = Number(repository.repository_id);
  let after = 0;

  for (;;) {
    const rows = await prSnapshotRepo.listSnapshotsAfter(deps.pool, repositoryId, after, REINDEX_BATCH);
    if (rows.length === 0) break;

    const requests: UpsertRequest[] = [];
    for (const row of rows) {
      const document = row.document;
      const prNumber = row.pr_number;
      const baseBranch = typeof document['base_branch'] === 'string' ? document['base_branch'] : undefined;
      const enrichmentPending = document['enrichment_pending'] === true;
      const documentVersion = Number(row.document_version);

      // 머지 커밋이 원본 목록에도 있으면 머지 커밋이 이긴다 — 투영과 같은 규칙이다.
      const roles = new Map<string, 'source_commit' | 'merge_commit'>();
      const sources = document['source_commit_shas'];
      if (Array.isArray(sources)) {
        for (const raw of sources) {
          if (typeof raw !== 'string' || raw === '') continue;
          roles.set(raw.toLowerCase(), 'source_commit');
        }
      }
      const mergeSha = document['merge_commit_sha'];
      if (typeof mergeSha === 'string' && mergeSha !== '') roles.set(mergeSha.toLowerCase(), 'merge_commit');

      for (const [sha, role] of roles) {
        requests.push(
          buildProjectedCommitDocument({
            repository,
            commitSha: sha,
            role,
            pullRequestNumber: prNumber,
            baseBranch,
            documentVersion,
            enrichmentPending,
            indexedAt,
          }),
        );
      }
    }

    if (requests.length > 0) {
      await withReindexWrite(deps.pool, async (targets) => {
        const result = await bulkUpsert(deps.es, requests, targets);
        const rejected = result.outcomes.filter((one) => one.kind !== 'ok');
        if (rejected.length > 0) {
          throw new Error(`commit_rebuild_item_failure: ${rejected[0]?.reason ?? 'unknown'}`);
        }
      });
      tally.written += requests.length;
      for (const request of requests) tally.documentIds.add(request.id);
    }

    tally.scanned += rows.length;
    after = rows[rows.length - 1]?.pr_number ?? after;
    if (rows.length < REINDEX_BATCH) break;
  }
}

/** 릴리스 문서를 `release` 표에서 다시 만든다. 운영 빌더를 그대로 쓴다. */
async function rebuildReleases(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
): Promise<void> {
  const repositoryId = Number(repository.repository_id);
  const rows = await releaseRepo.listReleases(deps.pool, repositoryId);
  if (rows.length === 0) return;

  const syncedAtMs = nowOf(deps).getTime();
  await withReindexWrite(deps.pool, async (targets) => {
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
      targets,
    );
    if (result.hasFailures) throw new Error('release_rebuild_item_failure');
  });

  tally.scanned += rows.length;
  tally.written += rows.length;
  for (const row of rows) tally.documentIds.add(releaseDocId(repositoryId, row.tag_name));
}

/** 간선을 정본 엔티티에서 다시 파생한다. JOB-REL-006과 **같은 경로**다. */
async function rebuildLinks(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
): Promise<void> {
  if (deps.links === undefined) {
    throw new Error('link_rebuild_port_missing');
  }
  const processed = await deps.links.rebuildRepository(repository);
  tally.scanned += processed;
  tally.written += processed;
}

/** 별칭 하나의 정본 재구축. 별칭마다 정본이 다르다 (비동기 3.5장). */
async function rebuildAlias(deps: ReindexDeps, alias: EntityAlias): Promise<RebuildTally> {
  const tally: RebuildTally = { scanned: 0, written: 0, documentIds: new Set() };
  const repositories = await allRepositories(deps.pool);

  for (const repository of repositories) {
    switch (alias) {
      case 'prs-pull-requests':
        await rebuildPullRequests(deps, repository, tally);
        break;
      case 'prs-commits':
        await rebuildCommits(deps, repository, tally);
        break;
      case 'prs-releases':
        await rebuildReleases(deps, repository, tally);
        break;
      case 'prs-links':
        await rebuildLinks(deps, repository, tally);
        break;
    }
  }

  return tally;
}

/* ------------------------------------------------------------------------- */
/* 전환 전 검증 (DEV-297)                                                      */
/* ------------------------------------------------------------------------- */

export interface VerifyOutcome {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * 전환해도 되는지 판정한다.
 *
 * **`source_count == target_count` 하나로 판정하지 않는다** — 같은 수의 다른
 * 문서가 가능하다. 그래서 건수와 함께 매핑·대표 질의·잡 상태를 본다.
 */
export async function verifyBeforeCutover(
  deps: ReindexDeps,
  jobId: number,
  expectedDocuments: number | null,
): Promise<VerifyOutcome> {
  const reasons: string[] = [];
  const job = await reindexRepo.findReindexJob(deps.pool, jobId);
  if (job === undefined) return { ok: false, reasons: ['잡이 사라졌다'] };

  const { alias, target_index: target, source_index: source } = job.progress;

  // 1. 잡이 여전히 `running`이다 — 취소·실패로 바뀌지 않았다.
  if (job.state !== 'running') reasons.push(`잡 상태가 ${job.state}다`);

  // 2. 알려진 실패가 0이다 (bulk 항목 단위 실패 포함).
  if ((job.progress.failures ?? 0) > 0) reasons.push(`알려진 실패 ${String(job.progress.failures)}건`);

  // 3. 정본 스캔이 끝났다.
  if (job.progress.scan_complete !== true) reasons.push('정본 스캔이 끝나지 않았다');

  await deps.es.indices.refresh({ index: target });

  // 4. 대상 매핑·설정이 의도한 것이다 — 인덱스가 실재하고 열려 있다.
  const exists = await deps.es.indices.exists({ index: target });
  if (!exists) {
    reasons.push('대상 인덱스가 없다');
    return { ok: false, reasons };
  }

  /*
   * 5. 커버리지 — **재구축이 쓴 서로 다른 문서 수**와 대조한다 (PR #52 리뷰 P1).
   *
   * 처리한 *source* 수와 대조하면 안 된다. 간선은 source 하나가 0개에서 여러
   * 개의 문서를 내므로, 관계가 없는 저장소에서 `0 < N`이 되어 **완전하고 정상적인
   * 재색인이 영원히 전환하지 못한다.**
   *
   * `null`은 "이 재구축이 쓴 문서 수를 셀 수 없다"는 뜻이며 그때는 이 항목을
   * 판정하지 않는다 — 셀 수 없는 것을 센 척하지 않는다. 나머지 여섯 항목은 그대로다.
   */
  const targetCount = await deps.es.count({ index: target });
  const sourceCount = await deps.es.count({ index: source });
  if (expectedDocuments !== null && targetCount.count < expectedDocuments) {
    reasons.push(`커버리지 부족: 재구축 ${String(expectedDocuments)} > 대상 ${String(targetCount.count)}`);
  }

  // 6. 대표 질의가 새 인덱스에서 성립한다.
  try {
    await deps.es.search({ index: target, size: 0, track_total_hits: true });
  } catch (error) {
    reasons.push(`대표 질의 실패: ${String(error)}`);
  }

  logOf(deps)({
    level: 'info',
    message: '전환 전 검증',
    job_id: jobId,
    alias,
    target_index: target,
    detail:
      `source=${String(sourceCount.count)} target=${String(targetCount.count)} ` +
      `expected=${expectedDocuments === null ? '(셀 수 없음)' : String(expectedDocuments)}`,
  });

  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------------- */
/* 잡 실행                                                                     */
/* ------------------------------------------------------------------------- */

async function advance(
  deps: ReindexDeps,
  jobId: number,
  patch: Partial<ReindexProgress>,
): Promise<void> {
  await reindexRepo.patchReindexProgress(deps.pool, jobId, patch);
}

/**
 * 재색인 잡 하나를 끝까지 돈다.
 *
 * 각 단계는 `progress.phase`에만 남는다 — `job.state`를 늘리지 않는다.
 */
export async function runReindexJob(deps: ReindexDeps, job: JobRow): Promise<void> {
  const log = logOf(deps);
  const jobId = job.job_id;
  const alias = job.target;

  if (!isEntityAlias(alias)) {
    await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', `알 수 없는 별칭: ${alias}`);
    return;
  }

  const current = await reindexRepo.findReindexJob(deps.pool, jobId);
  if (current === undefined) {
    await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', '진행 상태가 없다');
    return;
  }
  const target = current.progress.target_index;

  try {
    /* ---- prepare: 대상 인덱스를 처음부터 만든다. 별칭은 아직 안 붙인다. */
    const schema = (deps.schemaFor ?? schemaOf)(alias);
    const exists = await deps.es.indices.exists({ index: target });
    if (!exists) await createVersionedIndex(deps.es, alias, versionOf(alias, target), schema);
    log({ level: 'info', message: '대상 인덱스 준비', job_id: jobId, alias, phase: 'prepare', target_index: target });

    /*
     * ---- dual_write: **활성화가 정본 스캔보다 먼저다.**
     *
     * 반대로 하면 스캔 이후·활성화 이전의 변경이 통째로 빠진다. 그리고 활성화는
     * **배타 울타리 안에서** 한다 — 진행 중인 논리 쓰기가 이미 "shadow 없음"으로
     * 대상을 확정했을 수 있고, 그 쓰기가 끝나기 전에 스캔이 시작되면 그 변경이
     * 어느 쪽에도 남지 않는다.
     */
    await withReindexExclusive(deps.pool, async (client) => {
      await reindexRepo.patchReindexProgress(client, jobId, {
        phase: 'dual_write',
        dual_write_since: nowOf(deps).toISOString(),
      });
    });
    log({ level: 'info', message: '이중 쓰기 활성화', job_id: jobId, alias, phase: 'dual_write', target_index: target });

    /* ---- backfill: PostgreSQL 정본에서 다시 만든다 (ADR-004). */
    await advance(deps, jobId, { phase: 'backfill' });
    const tally = await rebuildAlias(deps, alias);
    await advance(deps, jobId, {
      documents_scanned: tally.scanned,
      documents_written: tally.written,
      scan_complete: true,
    });
    log({
      level: 'info',
      message: '정본 재구축 완료',
      job_id: jobId,
      alias,
      phase: 'backfill',
      target_index: target,
      scanned: tally.scanned,
      written: tally.written,
    });

    /* ---- verify */
    await advance(deps, jobId, { phase: 'verify' });
    /*
     * 간선은 `rebuildRepository`가 처리한 source 수만 돌려주므로 문서 수를 셀 수
     * 없다 — 그때는 커버리지를 판정하지 않고 나머지 여섯으로 건다.
     */
    const expected = alias === 'prs-links' ? null : tally.documentIds.size;
    const verdict = await verifyBeforeCutover(deps, jobId, expected);
    if (!verdict.ok) {
      const detail = verdict.reasons.join('; ');
      log({ level: 'error', message: '전환 전 검증 실패 — 별칭을 옮기지 않는다', job_id: jobId, alias, reason: 'verify_failed', detail });
      await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', detail.slice(0, 500));
      return;
    }

    /*
     * ---- cutover: 배타 울타리 안에서 **한 번에** 옮긴다 (AC-3).
     *
     * 울타리가 "진행 중인 논리 쓰기가 하나도 없음"을 보장하므로, 옮긴 뒤에
     * shadow가 뒤늦게 불완전해지는 경주가 없다 (DEV-308).
     */
    await advance(deps, jobId, { phase: 'cutover' });
    const switched = await withReindexExclusive(deps.pool, async (client) => {
      // 울타리를 잡은 지금 다시 본다 — 기다리는 동안 취소·실패가 들어왔을 수 있다.
      const latest = await reindexRepo.findReindexJob(client, jobId);
      if (latest === undefined || latest.state !== 'running') return false;
      if ((latest.progress.failures ?? 0) > 0) return false;

      await switchAlias(deps.es, alias, current.progress.source_index, target);

      /*
       * **여기서부터는 별칭이 이미 옮겨졌다** (PR #52 리뷰 P2).
       *
       * 이 기록이 실패하면 새 인덱스가 서비스 중인데 `switched_at`이 비고, 옛
       * 인덱스는 보관 대상에 오르지 않아 영원히 남는다. 그래서 몇 번 다시 쓰고,
       * 그래도 안 되면 **전환이 일어났다는 사실을 오류 메시지에 실어** 던진다 —
       * 조용히 "실패"로만 적으면 운영자가 별칭이 옮겨진 것을 모른다.
       *
       * 그리고 보관 스윕이 매 주기 `reconcileSwitchedJobs`로 같은 상태를 스스로
       * 고친다 — 사람이 손대지 않아도 다음 주기에 아문다.
       */
      let recorded = false;
      let lastError: unknown;
      for (let attempt = 1; attempt <= SWITCH_RECORD_ATTEMPTS && !recorded; attempt += 1) {
        try {
          await reindexRepo.patchReindexProgress(client, jobId, {
            phase: 'retention',
            switched_at: nowOf(deps).toISOString(),
          });
          recorded = true;
        } catch (error) {
          lastError = error;
        }
      }
      if (!recorded) {
        throw new Error(
          `alias_switched_but_unrecorded: ${alias} → ${target} (옛 인덱스 ${current.progress.source_index}는 ` +
            `보관 스윕이 재대조로 회수한다): ${String(lastError)}`,
        );
      }
      return true;
    });

    if (!switched) {
      log({ level: 'warn', message: '전환 직전에 취소·실패가 확인됐다 — 별칭을 옮기지 않았다', job_id: jobId, alias, reason: 'cutover_aborted' });
      await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', 'cutover_aborted');
      return;
    }

    log({ level: 'info', message: '별칭 전환 완료', job_id: jobId, alias, phase: 'cutover', target_index: target });

    /*
     * ---- 종료는 CAS다 (DEV-298).
     *
     * 전환은 이미 성공했다. 늦게 도착한 취소가 그것을 되돌리지는 않지만, 러너가
     * `cancelled`를 `completed`로 덮지도 않는다.
     */
    await jobRepo.finishJobIfRunning(deps.pool, jobId, 'completed');
  } catch (error) {
    const detail = String(error).slice(0, 500);
    log({ level: 'error', message: '재색인 실패 — 별칭은 그대로다', job_id: jobId, alias, reason: 'reindex_failed', detail });
    await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', detail);
  }
}

/** `<별칭>-v<N>`에서 N을 읽는다. 러너가 만들 버전을 정하는 자리다. */
function versionOf(alias: string, index: string): number {
  const matched = new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v([1-9][0-9]*)$`).exec(index);
  const parsed = matched === null ? Number.NaN : Number(matched[1]);
  if (!Number.isSafeInteger(parsed)) throw new Error(`대상 인덱스 이름이 형식 밖이다: ${index}`);
  return parsed;
}

/* ------------------------------------------------------------------------- */
/* 러너                                                                        */
/* ------------------------------------------------------------------------- */

export interface ReindexRunner {
  stop(): Promise<void>;
}

/**
 * 큐에서 재색인 잡을 집어 실행한다.
 *
 * `claimNextJob`을 쓴다 — **새 큐 틀을 만들지 않는다.** 동시 실행 상한은 1이다.
 */
export function startReindexRunner(deps: ReindexDeps, pollMs = REINDEX_POLL_MS): ReindexRunner {
  const log = logOf(deps);
  let stopped = false;
  let wake: (() => void) | undefined;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        const job = await jobRepo.claimNextJob(deps.pool, REINDEX_TYPE, REINDEX_MAX_CONCURRENT);
        if (job !== undefined) {
          await runReindexJob(deps, job);
          continue;
        }
      } catch (error) {
        log({ level: 'error', message: '재색인 러너 오류', reason: 'runner_error', detail: String(error).slice(0, 300) });
      }
      if (!stopped) await sleep(pollMs);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}

/* ------------------------------------------------------------------------- */
/* 보관 정리 (FR-ING-008 AC-4)                                                 */
/* ------------------------------------------------------------------------- */

/**
 * 보관 기한이 지난 옛 인덱스를 지운다.
 *
 * 정본은 완료된 잡의 `progress`다 — **새 표가 없다** (DEV-299). 그리고 지우기
 * 직전에 **현재 별칭 대상인지 다시 묻는다**: `progress`의 값이 낡았을 수 있고,
 * 낡은 값을 그대로 믿으면 서비스 중인 인덱스를 지운다.
 */
export async function runRetentionSweep(deps: ReindexDeps): Promise<number> {
  const log = logOf(deps);
  const now = nowOf(deps);

  // 먼저 "전환은 됐는데 기록되지 않은" 잡을 스스로 고친다 (PR #52 리뷰 P2).
  await reconcileSwitchedJobs(deps);

  const cutoff = new Date(now.getTime() - (deps.retentionMs ?? RETENTION_MS));
  const retired = await reindexRepo.listRetiredIndices(deps.pool, cutoff, RETENTION_SWEEP_BATCH);
  let deleted = 0;

  for (const one of retired) {
    try {
      const outcome = await deleteRetiredIndex(deps.es, one.alias, one.sourceIndex);

      if (outcome === 'serving') {
        /*
         * **표시하지 않고 남긴다** (PR #52 리뷰 P2). 운영자가 별칭을 이 인덱스로
         * 되돌려 둔 상태(롤백)일 수 있고, 그때 "처리했다"고 적으면 나중에 별칭이
         * 다시 옮겨져도 이 인덱스는 영영 지워지지 않는다. 지금 서비스 중인 것은
         * **다음 주기에 다시 볼 대상**이지 끝난 대상이 아니다.
         */
        log({
          level: 'warn',
          message: '보관 대상이 지금 서비스 중이다 — 다음 주기에 다시 본다',
          job_id: one.jobId,
          alias: one.alias,
          target_index: one.sourceIndex,
          reason: 'retention_serving',
        });
        continue;
      }

      if (outcome === 'deleted') deleted += 1;
      // `absent`는 이미 없다는 뜻이니 끝난 것이다 — 표시하고 넘어간다.
      await reindexRepo.markRetired(deps.pool, one.jobId, now);
    } catch (error) {
      log({
        level: 'error',
        message: '보관 정리 실패',
        job_id: one.jobId,
        alias: one.alias,
        reason: 'retention_failed',
        detail: String(error).slice(0, 300),
      });
    }
  }

  return deleted;
}

/**
 * 별칭은 옮겨졌는데 그 사실이 기록되지 않은 잡을 고친다 (PR #52 리뷰 P2).
 *
 * Elasticsearch 전환은 성공하고 뒤이은 PostgreSQL 기록이 실패한 자리다. 그
 * 상태를 두면 **옛 인덱스가 보관 대상에 영영 오르지 않는다.** 별칭의 현재
 * 대상과 대조해 맞으면 `switched_at`을 채운다 — 사람이 손대지 않아도 아문다.
 *
 * **별칭이 실제로 그 인덱스를 가리킬 때만 채운다.** 그러지 않으면 전환하지
 * 못한 잡을 전환했다고 적게 된다.
 */
export async function reconcileSwitchedJobs(deps: ReindexDeps): Promise<number> {
  const log = logOf(deps);
  const candidates = await reindexRepo.listUnrecordedSwitches(deps.pool, RETENTION_SWEEP_BATCH);
  let repaired = 0;

  for (const one of candidates) {
    try {
      if ((await resolveServingIndex(deps.es, one.alias)) !== one.targetIndex) continue;
      await reindexRepo.patchReindexProgress(deps.pool, one.jobId, {
        phase: 'retention',
        switched_at: nowOf(deps).toISOString(),
      });
      repaired += 1;
      log({
        level: 'warn',
        message: '전환은 됐으나 기록되지 않은 잡을 재대조로 고쳤다',
        job_id: one.jobId,
        alias: one.alias,
        target_index: one.targetIndex,
        reason: 'switch_reconciled',
      });
    } catch (error) {
      log({
        level: 'error',
        message: '전환 재대조 실패',
        job_id: one.jobId,
        alias: one.alias,
        reason: 'reconcile_failed',
        detail: String(error).slice(0, 300),
      });
    }
  }

  return repaired;
}

export interface RetentionSweeper {
  stop(): Promise<void>;
}

/** 보관 정리 스윕. 깨울 수 있는 sleep을 쓴다 (`startReleaseSweeper` 선례). */
export function startRetentionSweeper(deps: ReindexDeps, intervalMs = RETENTION_SWEEP_MS): RetentionSweeper {
  let stopped = false;
  let wake: (() => void) | undefined;
  const log = logOf(deps);

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      await sleep(intervalMs);
      if (stopped) break;
      try {
        await runRetentionSweep(deps);
      } catch (error) {
        log({ level: 'error', message: '보관 스윕 오류', reason: 'sweep_error', detail: String(error).slice(0, 300) });
      }
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}

