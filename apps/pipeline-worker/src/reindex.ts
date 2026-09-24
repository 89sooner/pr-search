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
 *
 * ## 시퀀스는 replay로 복원한다 (CR-113 / FR-ING-008 AC-8)
 *
 * 스냅숏에는 서수가 없다(투영이 그 키를 싣지 않는다 — 그것이 옳다). 그래서 PR·커밋
 * 재구축 뒤에 **현재 정본**을 문서 단위 투영기로 다시 비추고(`replaySequenceForRepository`),
 * 전환 전 검증이 target 인덱스의 원시 필드와 대표 범위 정렬을 정본과 대조한다. 옛 active
 * 인덱스에 대한 투영 완료는 새 인덱스의 완료가 아니므로 판정은 언제나 target 결과다.
 * 전환 직후 durable full sweep을 남겨 검증과 전환 사이의 변경도 수렴시킨다.
 */

import {
  commitSnapshotRepo,
  jobRepo,
  prCommitLinkRepo,
  mergeSequenceRepo,
  prSnapshotRepo,
  releaseRepo,
  reindexRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  withReindexExclusive,
  withReindexWrite,
  type JobRow,
  type Pool,
  type ReindexProgress,
  type RepositoryRow,
} from '@prs/db';
import {
  applyCommitLinksToIndex,
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
  type CommitMetadataFields,
  type CommitMetadataOutcome,
  type CommitMetadataResult,
  type EntityAlias,
  type UpsertRequest,
  type VersionedIndexSchema,
} from '@prs/es';
import { commitDocId, pullRequestDocId } from '@prs/domain';
import type { Client } from '@elastic/elasticsearch';

import { commitCreateFields, commitMetadataFields, type CommitFactSource } from './commit-enrich.js';
import {
  replaySequenceForRepository,
  requestFullSweepForAllSpaces,
  verifySequenceProjection,
  type ProjectionDeps,
  type ReplaySpaceRecord,
} from './sequence-projection.js';
import { buildProjectedCommitDocument, registryOwnedFields } from './documents.js';
import { resolveAuthorTeams } from './author-teams.js';
import type { AuthorTeamResolution } from './documents.js';
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
  /** 작성자 팀 동기화를 낡은 것으로 보는 기준 (WP-069 / CR-058). 시험이 좁힌다. */
  readonly authorTeamStalenessMs?: number;
  /**
   * M 번호가 켜진 배포인가 (WP-074 / DEV-605).
   *
   * **꺼져 있으면 M 복구 의도를 만들지 않는다.** 러너가 `refresh`만 집으므로 그
   * 행들은 `ready`로 남고, `cleanupDoneWork`는 `done`만 지우므로 영영 남아 대기
   * 지표에 잡힌다 — 아무도 처리하지 않을 일을 표에 쌓지 않는다.
   */
  readonly mergeNumberEnabled?: boolean;
}

function nowOf(deps: ReindexDeps): Date {
  return (deps.now ?? ((): Date => new Date()))();
}

function logOf(deps: ReindexDeps): (fields: ReindexLogFields) => void {
  return deps.log ?? ((): void => undefined);
}

function projectionDepsOf(deps: ReindexDeps): ProjectionDeps {
  const log = logOf(deps);
  return {
    pool: deps.pool,
    es: deps.es,
    log: (fields) => {
      log({ level: fields.level, message: fields.message, detail: JSON.stringify({ ...fields, level: undefined, message: undefined }).slice(0, 300) });
    },
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };
}

/** `job.progress.sequence_replay` — 공간마다 replay 진행·에폭을 남긴다. 전환 울타리 안의 에폭 대조가 이것을 읽는다. */
export interface SequenceReplayProgress {
  readonly spaces: readonly ReplaySpaceRecord[];
  readonly repositories_done: number;
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
/**
 * 나중에 더해진 사전 계산 필드를 옛 스냅숏에 채운다 (CR-053, DEV-391).
 *
 * `changed_lines`는 `CR-053`이 더한 필드라 **그 전에 남긴 스냅숏에는 없다.**
 * 여기서 채우지 않으면 색인을 `update_by_query`로 소급해도 **다음 재구축이
 * 그것을 되돌린다** — 스냅숏이 `_source`의 정본이기 때문이다.
 *
 * 재료가 없으면(절삭 등으로 `additions`·`deletions`가 없는 문서) **아무것도
 * 넣지 않는다.** 0으로 채우면 `FR-STAT-005` AC-5의 `unknown`이 뜻하는
 * "모른다"가 "0줄 바꿨다"라는 사실 주장으로 바뀐다.
 */
function derivedFields(document: Readonly<Record<string, unknown>>): Record<string, number> {
  if (typeof document['changed_lines'] === 'number') return {};
  const additions = document['additions'];
  const deletions = document['deletions'];
  if (typeof additions !== 'number' || typeof deletions !== 'number') return {};
  return { changed_lines: additions + deletions };
}

/**
 * 재구축이 쓸 작성자 팀 (WP-069 / CR-058, DEV-485).
 *
 * 아는 값이면 그 배열을, 모르면 `null`을 돌려준다. **`undefined`를 쓰지 않는다** —
 * 그것은 `JSON.stringify`가 키를 버리는 것에 기대는 암묵적 표현이고, 지운다는
 * 뜻을 코드가 말하지 않는다. 호출부가 `null`을 보고 키를 **명시적으로 지운다.**
 */
function authorTeamIdsFor(
  document: Readonly<Record<string, unknown>>,
  teams: ReadonlyMap<string, AuthorTeamResolution>,
): readonly number[] | null {
  const author = document['author'];
  if (typeof author !== 'string' || author === '') return null;
  const resolved = teams.get(author);
  if (resolved === undefined || resolved.kind === 'unknown') return null;
  return [...new Set(resolved.teamIds)].sort((a, b) => a - b);
}

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

    /*
     * **작성자 팀도 스냅숏이 아니라 현재 값으로 쓴다** (WP-069 / CR-058, DEV-485).
     *
     * 스냅숏은 투영 시점의 사본이라 소속이 박제되어 있다. 그대로 재생하면 재구축이
     * **떠난 팀을 되살린다** — `allowed_team_ids`를 `scope`가 덮는 것과 같은 이유이며,
     * `registryOwnedFields`에 넣지 않는 것은 그 함수의 정본이 `repository` 행이고
     * 이 값의 정본은 `team_membership`이기 때문이다.
     *
     * **GHE를 부르지 않는다.** `ADR-004`의 불변 조건이 "PostgreSQL 데이터만으로
     * 재구성 가능"이므로 재구축이 외부 API에 기대면 그 조건이 깨진다. 표가 낡아
     * 있으면 모름이 되고, 그때는 **스냅숏의 옛 값을 지운다** — 모르는 것을 아는
     * 것처럼 되살리지 않는다.
     */
    const authors = rows.map((row) =>
      typeof row.document['author'] === 'string' ? row.document['author'] : null,
    );
    const teams = await resolveAuthorTeams(
      {
        pool: deps.pool,
        ...(deps.now === undefined ? {} : { now: deps.now }),
        ...(deps.authorTeamStalenessMs === undefined ? {} : { stalenessMs: deps.authorTeamStalenessMs }),
      },
      Number(repository.org_id),
      authors,
    );

    const requests: UpsertRequest[] = rows.map((row) => {
      const doc: Record<string, unknown> = {
        ...row.document,
        ...derivedFields(row.document as Readonly<Record<string, unknown>>),
        ...scope,
        /*
         * **버전의 정본은 본문이 아니라 열이다** (CI가 잡았다).
         *
         * `upsertPullRequestSnapshot`이 조건부 비교에 쓰는 값은
         * `pull_request_snapshot.document_version` 열이고, 본문에 같은 값이
         * 들어 있는 것은 투영이 그렇게 만들었기 때문일 뿐이다 — 본문에 그 키가
         * 없는 행도 있다. 본문을 믿으면 조건부 업서트 스크립트가 `null`과
         * 비교하다 `script_exception`으로 거부하고, 재구축 전체가 그 한 행에
         * 막힌다.
         */
        document_version: Number(row.document_version),
      };

      const teamIds = authorTeamIdsFor(row.document, teams);
      if (teamIds === null) delete doc['author_team_ids'];
      else doc['author_team_ids'] = teamIds;

      return {
        alias: 'prs-pull-requests' as const,
        id: pullRequestDocId(repositoryId, row.pr_number),
        routing: String(repositoryId),
        doc: doc as UpsertRequest['doc'],
        /*
         * 모르면 **지운다.** 재구축은 보통 빈 인덱스를 채우지만 같은 별칭을 다시
         * 훑는 경로가 있으므로, 키를 빼는 것만으로는 이미 색인된 옛 소속이 남는다
         * (DEV-484와 같은 규율).
         */
        ...(teamIds === null ? { remove: ['author_team_ids'] } : {}),
      };
    });

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
 *
 * ## 순서: 문서를 먼저 만들고 메타데이터를 그 뒤에 (CR-119 / FR-ING-008 AC-10)
 *
 * ```
 * 체인 패스        체인 커밋 — 문서 생성과 메타데이터를 한 번에(`createWith`)
 * PR 유래 패스     PR 스냅숏의 원본 커밋·병합 PR의 머지 커밋 문서를 만든다
 * 원본 커밋 패스   체인 밖 커밋에 메타데이터를 반영한다 — 이제 문서가 있다
 * 관계 replay      PR 연결을 정본에서 비춘다 (CR-116)
 * ```
 *
 * 전에는 한 번의 스냅숏 스캔이 체인 밖 커밋에도 메타데이터를 **PR 유래 문서보다 먼저** 보냈다.
 * 새 인덱스에는 그 문서가 아직 없어 값이 404로 사라졌고, 뒤이어 만들어진 원본 커밋 문서는
 * 메시지·작성자 없이 섰다. 그리고 그 행들이 결과와 무관하게 기대 문서 ID에 들어가, 생성 근거가
 * 없는 행(체인에도 없고 어느 PR 스냅숏에도 없는 커밋)이 있으면 전환 전 검증이 영영 통과하지
 * 못했다(사내 pilot.18 보고).
 */
async function rebuildCommits(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
  /** 이번 재구축의 대상 인덱스. 관계 replay가 별칭이 아니라 이것을 직접 쓴다 (CR-116). */
  targetIndex: string,
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
      after = row.commit_sha;
      tally.scanned += 1;
      const sha = row.commit_sha.toLowerCase();
      const points = await mergeSequenceRepo.findByCommitSha(deps.pool, repositoryId, sha);
      const point = points[0];

      /*
       * **체인 밖 커밋은 여기서 쓰지 않는다** (CR-119). 그 문서는 PR 투영이 만들고, 메타데이터는
       * 문서가 생긴 뒤 `rebuildSourceCommitMetadata`가 반영한다. 여기서 먼저 보내면 대상
       * 인덱스에서 `document_missing`이 되어 값이 사라진다.
       */
      if (point === undefined) continue;

      /*
       * **first-parent 체인에 있을 때만 역할을 싣는다** (DEV-207). 체인 밖 커밋의
       * 역할은 우리가 판정하지 않았고, 판정하지 않은 것을 문서에 적으면 그것이
       * 거짓말이 된다.
       */
      const fact = commitFactOf(row, point.pull_request_number === null ? 'direct_push' : 'merge_commit');

      const result = await withReindexWrite(deps.pool, (targets) =>
        upsertCommitMetadata(
          deps.es,
          {
            repositoryId,
            commitSha: sha,
            docId: commitDocId(repositoryId, sha),
            fields: commitMetadataFields(fact),
            /*
             * 체인에 있는 커밋만 만든다 — 접근 범위를 확신할 수 있는 자리이기
             * 때문이다 (DEV-213, fail closed).
             */
            createWith: commitCreateFields(repository, fact, {
              pullRequestNumber: point.pull_request_number,
              baseBranch: point.base_branch,
              indexedAt,
            }),
          },
          targets,
        ),
      );
      // `createWith`가 있으므로 대상에 문서가 없을 수 없다. 있으면 그것은 결함이다.
      if (targetOutcomeOf(result, sha) === 'document_missing') {
        throw new Error(`commit_rebuild_chain_document_missing: ${sha}`);
      }

      tally.written += 1;
      tally.documentIds.add(commitDocId(repositoryId, sha));
    }

    if (rows.length < REINDEX_BATCH) break;
  }

  await rebuildProjectedCommits(deps, repository, tally, indexedAt);
  await rebuildSourceCommitMetadata(deps, repository, tally);
  await replayCommitLinks(deps, repository, tally, targetIndex);
}

/**
 * 스냅숏 행 하나를 커밋 사실로 옮긴다. 체인 패스와 원본 커밋 패스, 전환 전 검증이
 * **같은 함수**를 쓴다 — 셋이 다른 값을 만들면 검증이 재구축과 다른 것을 기대한다.
 */
function commitFactOf(
  row: commitSnapshotRepo.CommitSnapshotRow,
  role?: 'direct_push' | 'merge_commit',
): CommitFactSource {
  return {
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
    ...(role === undefined ? {} : { role }),
  };
}

/**
 * 재구축의 쓰기가 **대상 인덱스**에 닿았는지 본다 (CR-119).
 *
 * 재구축은 `withReindexWrite`를 지나 서비스와 대상에 함께 쓴다. 서비스 쪽 결과는 새 인덱스에
 * 대해 아무것도 말하지 않으므로 판정은 대상 결과로만 한다. 대상이 없으면 잡이 더는 이중 쓰기
 * 중이 아니라는 뜻이고(취소·실패), 대상 쓰기가 던졌으면 그 실패는 울타리가 이미 기록해 잡이
 * 실패했다. 둘 다 재구축을 이어 갈 이유가 없다.
 */
function targetOutcomeOf(result: CommitMetadataResult, sha: string): CommitMetadataOutcome {
  if (result.shadow === undefined) throw new Error(`reindex_target_not_writable: ${sha}`);
  if (result.shadow === 'failed') throw new Error(`reindex_target_write_failed: ${sha}`);
  return result.shadow;
}

/**
 * 체인 밖 커밋 문서에 정본 메타데이터를 반영한다 (CR-119 / FR-ING-008 AC-10).
 *
 * ## 왜 PR 유래 문서를 만든 **뒤**인가
 *
 * 체인 밖 커밋(PR의 원본 커밋)의 문서는 PR 투영만 만든다 — 보강 경로는 접근 범위를 확신할 수
 * 없어 만들지 않는다(DEV-213). 그러니 메타데이터는 문서가 생긴 뒤에만 반영된다. 평시에는
 * 보강 방아쇠(`EVT-ING-003`)가 투영 뒤에 오므로 순서가 저절로 맞지만, 재구축은 그 순서를 스스로
 * 지켜야 한다.
 *
 * ## 문서가 없으면 만들지 않는다
 *
 * 체인에도 없고 어느 PR 스냅숏의 원본 목록에도 없는 커밋(rebase·force-push로 PR에서 빠진 옛
 * 커밋)은 생성 근거가 없다. 결과는 `document_missing`이고 **실패가 아니다** — 기대 집합에도
 * 없다(`verifyCommitDocuments`). 스냅숏은 지우지 않는다: 정본은 사실의 기록이고, 그 커밋이 다시
 * PR에 들어오면 이 값이 쓰인다.
 */
async function rebuildSourceCommitMetadata(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
): Promise<void> {
  const repositoryId = Number(repository.repository_id);
  let after = '';
  let applied = 0;
  let withoutDocument = 0;

  for (;;) {
    const rows = await commitSnapshotRepo.listCommitSnapshotsAfter(deps.pool, repositoryId, after, REINDEX_BATCH);
    if (rows.length === 0) break;
    // 체인 패스와 같은 술어다 — 거기서 이미 만들고 채웠다.
    const onChain = await mergeSequenceRepo.findShasWithSequence(
      deps.pool,
      repositoryId,
      rows.map((row) => row.commit_sha),
    );

    for (const row of rows) {
      after = row.commit_sha;
      const sha = row.commit_sha.toLowerCase();
      if (onChain.has(sha)) continue;

      const result = await withReindexWrite(deps.pool, (targets) =>
        upsertCommitMetadata(
          deps.es,
          {
            repositoryId,
            commitSha: sha,
            docId: commitDocId(repositoryId, sha),
            fields: commitMetadataFields(commitFactOf(row)),
          },
          targets,
        ),
      );
      const outcome = targetOutcomeOf(result, sha);
      if (outcome === 'document_missing') {
        withoutDocument += 1;
        continue;
      }
      // `createWith` 없이 문서가 생겼다면 근거 없는 생성이다. 조용히 넘기지 않는다.
      if (outcome === 'created') throw new Error(`commit_metadata_created_without_basis: ${sha}`);
      applied += 1;
      tally.written += 1;
      tally.documentIds.add(commitDocId(repositoryId, sha));
    }

    if (rows.length < REINDEX_BATCH) break;
  }

  logOf(deps)({
    level: 'info',
    message: '원본 커밋 메타데이터 반영',
    phase: 'backfill',
    detail: `repository_id=${String(repositoryId)} applied=${String(applied)} without_document=${String(withoutDocument)}`,
  });
}

/**
 * PR 연결을 **정본에서** 다시 비춘다 (CR-116 / WP-101, FR-ING-008 AC-9).
 *
 * ## 왜 필요한가
 *
 * `rebuildProjectedCommits`는 역할·범위·버전만 쓴다. 관계는 CR-116부터 전용
 * 투영기의 것이고 `params.union`에 실리지 않으므로, **이 단계가 없으면 새 인덱스의
 * 모든 커밋이 `pull_request_numbers` 없이 시작한다.** FR-SRCH-002가 그 커밋들에
 * 대해 "속한 PR 없음"으로 답한다는 뜻이다. 전에는 합집합이 그 구멍을 우연히
 * 메웠지만, 그것도 웹훅이 다시 와야 채워지는 것이었다 (상류 요청 4).
 *
 * ## 세대를 묻지 않는다
 *
 * `projected_generation`은 **옛 인덱스에 대한 사실**이다. 그 값을 새 대상의 완료로
 * 재사용하면 이미 비춘 것으로 착각해 새 인덱스가 빈 채로 전환된다. 그래서 러너와
 * 달리 여기서는 모든 행을 비추고 `projected_generation`을 **건드리지 않는다** —
 * 그 열은 서비스 별칭에 대한 진행이고, 재색인의 진행은 잡이 따로 적는다.
 *
 * ## 빈 집합과 미확정도 그대로 옮긴다
 *
 * 연결이 0개인 커밋에는 `[]`가 대입된다. 그것이 "검증한 범위에서 연결 없음"이라는
 * 사실이고, 필드를 비워 두면 "아직 모름"이 되어 뜻이 바뀐다.
 */
async function replayCommitLinks(
  deps: ReindexDeps,
  repository: RepositoryRow,
  tally: RebuildTally,
  targetIndex: string,
): Promise<void> {
  const repositoryId = Number(repository.repository_id);
  let after = '';

  for (;;) {
    const rows = await prCommitLinkRepo.listCommitLinkStatesAfter(deps.pool, repositoryId, after, REINDEX_BATCH);
    if (rows.length === 0) break;

    for (const row of rows) {
      const numbers = row.pr_numbers ?? [];
      /*
       * **대상 인덱스를 직접 지목한다.** 별칭으로 쓰면 서비스 인덱스의 상태가
       * 판정에 끼어들어, 거기 남은 충돌 하나가 새 인덱스의 그 커밋을 영영 비우게
       * 만든다 (DEV-750). 서비스 인덱스는 러너와 복구 명령이 맡는다.
       */
      const outcome = await applyCommitLinksToIndex(
        deps.es,
        {
          repositoryId,
          commitSha: row.commit_sha,
          numbers,
          generation: Number(row.generation),
          state: Number(row.unverified) === 0 ? 'verified' : 'partial',
        },
        targetIndex,
      );
      /*
       * 문서가 없고 연결도 없으면 비출 것이 없다. 문서가 없는데 연결이 있으면
       * **재구축이 그 커밋 문서를 만들지 못했다**는 뜻이므로 조용히 넘기지 않는다 —
       * 그대로 두면 전환 뒤에 그 커밋의 SHA → PR이 사라진다.
       */
      if (outcome === 'document_missing' && numbers.length > 0) {
        throw new Error(`commit_link_replay_document_missing: ${row.commit_sha}`);
      }
      tally.scanned += 1;
      if (outcome === 'updated') tally.written += 1;
      after = row.commit_sha;
    }

    if (rows.length < REINDEX_BATCH) break;
  }
}

/** PR 스냅숏 한 페이지가 만드는 커밋 문서의 재료 (CR-117·CR-119). */
interface ProjectedPage {
  /** 원본 커밋 후보 가운데 **현재 체인에 오른 것**. */
  readonly chain: ReadonlySet<string>;
  /** PR마다 지금 유효한 `source` 연결의 커밋 (CR-116 관계 정본). */
  readonly linked: ReadonlyMap<number, readonly string[]>;
}

/**
 * PR 스냅숏 한 페이지의 재료를 한 번에 묻는다.
 *
 * **체인 커밋은 원본 커밋 문서로 만들지 않는다** (CR-117 / FR-SRCH-002 AC-7). 피처 브랜치가
 * `git merge dev`로 받아 온 dev 체인 커밋이 원본 목록에 섞여 있다. 그 문서는 체인 패스가 체인에서
 * 정한 역할로 이미 만들었고, 원본 커밋 문서로 다시 쓰면 조건부 업서트가 더 큰 버전(웹훅 수신
 * 시각)으로 그 역할을 덮는다 — 실시간 투영(`buildCommitDocuments`)이 건너뛰는 것과 같은 규칙이다.
 *
 * **스냅숏의 목록만이 근거가 아니다** (CR-119 / FR-ING-008 AC-10, DEV-763). 관측이 불완전해 목록에서 빠진
 * 커밋의 `source` 연결은 지워지지 않고 남는다(CR-116). 정본은 그 커밋이 여전히 이 PR에 속한다고
 * 말하므로 그 문서도 만든다 — 만들지 않으면 관계 replay가 「문서를 만들지 못했다」로 재색인을
 * 실패시키고, 250건을 넘는 PR은 완전성을 영영 증명할 수 없어 그 실패가 풀리지 않는다.
 */
async function projectedPageOf(
  deps: ReindexDeps,
  repositoryId: number,
  rows: readonly prSnapshotRepo.PullRequestSnapshotRow[],
): Promise<ProjectedPage> {
  const linked = await prCommitLinkRepo.listEffectiveSourceShas(
    deps.pool,
    repositoryId,
    rows.map((row) => row.pr_number),
  );
  const candidates: string[] = [];
  for (const row of rows) {
    const listed = row.document['source_commit_shas'];
    if (!Array.isArray(listed)) continue;
    for (const raw of listed) if (typeof raw === 'string' && raw !== '') candidates.push(raw.toLowerCase());
  }
  for (const shas of linked.values()) candidates.push(...shas);
  const chain = new Set((await mergeSequenceRepo.findCurrentChainLanders(deps.pool, repositoryId, candidates)).keys());
  return { chain, linked };
}

/**
 * PR 스냅숏 하나가 만드는 커밋 문서와 그 역할.
 *
 * **재구축과 전환 전 검증이 같은 함수를 쓴다** (CR-119). 검증이 기대 집합을 따로 세면 두
 * 규칙이 갈라지는 날 검증이 재구축과 다른 문서를 기대한다 — 그러면 그 검증은 불변식을 지키는
 * 대신 지키는 척한다.
 *
 * 원본 커밋은 스냅숏의 목록과 유효한 `source` 연결의 합이다. 머지 커밋이 원본에도 있으면
 * 머지 커밋이 이긴다 — 투영과 같은 규칙이다.
 */
function projectedCommitRoles(
  document: Readonly<Record<string, unknown>>,
  prNumber: number,
  page: ProjectedPage,
): ReadonlyMap<string, 'source_commit' | 'merge_commit'> {
  const roles = new Map<string, 'source_commit' | 'merge_commit'>();
  const sources = document['source_commit_shas'];
  const candidates: string[] = [...(page.linked.get(prNumber) ?? [])];
  if (Array.isArray(sources)) {
    for (const raw of sources) if (typeof raw === 'string' && raw !== '') candidates.push(raw.toLowerCase());
  }
  for (const sha of candidates) {
    if (page.chain.has(sha)) continue;
    roles.set(sha, 'source_commit');
  }
  /*
   * **병합된 PR의 머지 커밋만 머지 커밋이다** (CR-116 / DEV-747, FR-SRCH-002 AC-1).
   *
   * 실시간 투영(`buildCommitDocuments`)은 `merged === true`를 확인해 왔는데 여기에는
   * 그 확인이 없었다. GitHub은 **열린 PR에도** `merge_commit_sha`를 준다 — 시험 병합으로
   * 만든 임시 커밋이다. 그래서 재색인이 지날 때마다 아직 병합되지 않은 PR이
   * 커밋 하나를 "병합했다"고 주장하는 문서가 만들어졌고, 그 역할은 실시간
   * 경로가 만든 문서와 **달랐다.**
   */
  const mergeSha = document['state'] === 'merged' ? document['merge_commit_sha'] : null;
  if (typeof mergeSha === 'string' && mergeSha !== '') roles.set(mergeSha.toLowerCase(), 'merge_commit');
  return roles;
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

    const page = await projectedPageOf(deps, repositoryId, rows);

    const requests: UpsertRequest[] = [];
    for (const row of rows) {
      const document = row.document;
      const prNumber = row.pr_number;
      const baseBranch = typeof document['base_branch'] === 'string' ? document['base_branch'] : undefined;
      const enrichmentPending = document['enrichment_pending'] === true;
      // 버전의 정본은 본문이 아니라 열이다 (위와 같은 이유).
      const documentVersion = Number(row.document_version);

      for (const [sha, role] of projectedCommitRoles(document, prNumber, page)) {
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

/**
 * 재구축한 PR 문서에 M 값을 다시 채울 의도를 남긴다 (WP-074 / 설계 8절, DEV-597).
 *
 * ## 왜 여기가 필요한가
 *
 * 재구축은 PostgreSQL 스냅숏에서 문서를 만드는데 **스냅숏에는 M 필드가 없다** —
 * 투영이 그 키를 아예 싣지 않기 때문이다(그것이 옳다, `documents.test.ts`). 그래서
 * 새 색인은 이미 확정된 번호를 하나도 모른 채 선다.
 *
 * `merge_seq`는 다음 채번이 `applySequenceToDocuments`로 다시 쓰지만, M에는 그에
 * 해당하는 "재구축 뒤에 도는 경로"가 없다. 새 채번이 일어나야만 그 PR 하나가
 * 채워지므로, **그전에 확정된 번호는 영영 색인에 없다.**
 *
 * 화면의 번호는 틀리지 않는다 — API가 언제나 정본을 답한다. 손상되는 것은
 * `merge_number_projection_state`이며, 그 값에 기대는 운영 watch가 "ES 관측 완료"를
 * 영원히 판정하지 못한다.
 *
 * ## 다시 쓰지 않고 의도만 남긴다
 *
 * `materialize` work는 **payload가 아니라 현재 정본을 읽는다.** 그래서 여기서
 * 예약해 두면 러너가 그때의 값으로 쓰고, 그 사이 에폭이 오르면 obsolete로 접힌다.
 * 재구축이 ES에 직접 쓰면 그 규율이 깨진다.
 */
async function requestMergeNumberMaterialize(deps: ReindexDeps, repository: RepositoryRow): Promise<void> {
  // 꺼진 배포에서는 아무도 집지 않을 의도를 만들지 않는다 (DEV-605).
  if (deps.mergeNumberEnabled !== true) return;
  const repositoryId = Number(repository.repository_id);
  for (const baseBranch of repository.sequence_branches) {
    const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, baseBranch);
    if (space === undefined) continue;
    let afterSeq = 0;
    for (;;) {
      const rows = await mergeSequenceRepo.listNumberedAfter(deps.pool, repositoryId, baseBranch, space.seq_epoch, afterSeq, 500);
      if (rows.length === 0) break;
      /*
       * **페이지 하나가 문장 하나다** (DEV-605). PR마다 부르면 5만 PR 저장소에서
       * 왕복이 5만 번이고 그 비용이 재색인 경로에 그대로 들어간다.
       */
      await sequenceWorkRepo.requestWorkBatch(
        deps.pool,
        rows
          .filter((row) => row.pull_request_number !== null)
          .map((row) => ({
            kind: 'materialize' as const,
            repositoryId,
            baseBranch,
            seqEpoch: space.seq_epoch,
            keyExtra: [row.pull_request_number as number],
            payload: { pr_number: row.pull_request_number, trigger_kind: 'reindex' },
          })),
      );
      afterSeq = Number(rows[rows.length - 1]?.merge_seq ?? afterSeq);
    }
  }
}

/** 별칭 하나의 정본 재구축. 별칭마다 정본이 다르다 (비동기 3.5장). */
async function rebuildAlias(deps: ReindexDeps, alias: EntityAlias, jobId: number): Promise<RebuildTally> {
  const tally: RebuildTally = { scanned: 0, written: 0, documentIds: new Set() };
  /*
   * 대상 인덱스 이름은 잡이 갖고 있다. 여기서 다시 해석하지 않는다 — 그 사이에
   * 전환이 일어나면 두 값이 갈라지고, 관계 replay가 엉뚱한 인덱스에 쓴다.
   */
  const job = await reindexRepo.findReindexJob(deps.pool, jobId);
  const targetIndex = job?.progress.target_index;
  if (targetIndex === undefined || targetIndex === '') throw new Error('대상 인덱스를 알 수 없다');
  const repositories = await allRepositories(deps.pool);
  const replay: { spaces: ReplaySpaceRecord[]; repositories_done: number } = { spaces: [], repositories_done: 0 };
  /*
   * 서수 replay (CR-113). 재구축이 만든 문서에 **현재 정본**의 서수를 비춘다. 공간마다
   * 진행과 에폭을 `job.progress.sequence_replay`에 남겨, 전환 울타리 안에서 에폭 이동을
   * 대조하고 중단 뒤에도 어디까지 갔는지 읽을 수 있게 한다. `mergeNumberEnabled`와
   * 무관하다 — M이 꺼진 배포에서도 서수는 복원돼야 한다.
   */
  const replayFor = async (repository: RepositoryRow, kind: 'commit' | 'pull_request'): Promise<void> => {
    // 진행 기록은 저장소마다 한 번 쓴다 — 공간마다 배열 전체를 다시 쓰면 쓰기량이 공간 수의 제곱이 된다.
    await replaySequenceForRepository(projectionDepsOf(deps), repository, kind, async (record) => {
      replay.spaces.push(record);
    });
    replay.repositories_done += 1;
    await advance(deps, jobId, { sequence_replay: replay } as Partial<ReindexProgress>);
  };

  for (const repository of repositories) {
    switch (alias) {
      case 'prs-pull-requests':
        await rebuildPullRequests(deps, repository, tally);
        await replayFor(repository, 'pull_request');
        // 새 색인에는 M 값이 없다. 러너가 정본을 읽어 채우도록 의도를 남긴다 (DEV-597).
        await requestMergeNumberMaterialize(deps, repository);
        break;
      case 'prs-commits':
        await rebuildCommits(deps, repository, tally, targetIndex);
        await replayFor(repository, 'commit');
        /*
         * 커밋 문서도 M 값을 갖는다 (CR-115 / FR-SEQ-012 AC-7). 재구축이 만든 merge_commit 문서에는
         * 그 값이 없으므로 PR 재색인과 같은 의도를 남긴다 — `materialize`가 PR·커밋 문서 둘 다 쓴다.
         * 이것이 없으면 commits-only 재색인 뒤 `kind:commit mnum:`이 조용히 0건이 된다(사내 pilot.17이
         * `merge_seq`에서 겪은 것과 같은 모양).
         */
        await requestMergeNumberMaterialize(deps, repository);
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
 *
 * @param expectedDocuments PR·릴리스는 재구축이 쓴 서로 다른 문서 수다. **커밋은 이 값을 쓰지
 *   않는다** — 기대 집합을 정본과 생성 정책에서 문서 ID로 다시 계산한다(CR-119, 5번 항목).
 *   간선은 셀 수 없어 `null`이다.
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
   * 4-b. 준비 단계에서 만든 **그** 인덱스다 (CR-119). 이름만 같은 다른 인덱스 — 도중에 지워진 뒤
   *      쓰기가 동적 매핑으로 자동 생성한 것 — 이면 나머지 항목을 모두 통과해도 전환하지 않는다.
   */
  const replaced = await targetReplaced(deps.es, target, job.progress.target_uuid);
  if (replaced !== null) reasons.push(`대상 인덱스가 바뀌었다: ${replaced}`);

  /*
   * 5. 커버리지 — **재구축이 쓴 서로 다른 문서 수**와 대조한다 (PR #52 리뷰 P1).
   *
   * 처리한 *source* 수와 대조하면 안 된다. 간선은 source 하나가 0개에서 여러
   * 개의 문서를 내므로, 관계가 없는 저장소에서 `0 < N`이 되어 **완전하고 정상적인
   * 재색인이 영원히 전환하지 못한다.**
   *
   * `null`은 "이 재구축이 쓴 문서 수를 셀 수 없다"는 뜻이며 그때는 이 항목을
   * 판정하지 않는다 — 셀 수 없는 것을 센 척하지 않는다. 나머지 여섯 항목은 그대로다.
   *
   * **커밋은 기대를 재구축의 쓰기에서 세지 않는다** (CR-119 / FR-ING-008 AC-10). 쓰기로 센 값은
   * 만들지 못한 문서를 넣기도 하고(사내 pilot.18: 생성 근거 없는 스냅숏 행이 기대 건수에 들어가
   * 전환이 영영 막혔다), 써야 했는데 쓰지 않은 문서를 빼기도 한다 — 기대가 자기 자신을 따라간다.
   * 커밋의 기대 집합은 정본과 생성 정책에서 문서 ID로 계산하고, 건수 비교에 더해 **ID마다 존재와
   * 알려진 메타데이터 값**을 대조한다. 개수만 맞춘 대상(필요한 문서 하나가 빠지고 무관한 문서
   * 하나가 더해진 인덱스)은 건수로는 통과하지만 ID 대조에서 막힌다.
   */
  let expected = expectedDocuments;
  if (alias === 'prs-commits') {
    try {
      const commits = await verifyCommitDocuments(deps, target);
      expected = commits.expected;
      reasons.push(...commits.reasons);
      logOf(deps)({
        level: commits.reasons.length === 0 ? 'info' : 'error',
        message: '전환 전 커밋 문서 검증',
        job_id: jobId,
        alias,
        target_index: target,
        detail:
          `expected=${String(commits.expected)} missing=${String(commits.missing)} ` +
          `metadata_checked=${String(commits.metadataChecked)} metadata_mismatched=${String(commits.metadataMismatched)}`,
      });
    } catch (error) {
      // 셀 수 없게 됐다고 통과시키지 않는다 — 판정하지 못한 것은 막는다.
      reasons.push(`커밋 문서 검증 실패: ${String(error).slice(0, 200)}`);
    }
  }
  const targetCount = await deps.es.count({ index: target });
  const sourceCount = await deps.es.count({ index: source });
  if (expected !== null && targetCount.count < expected) {
    reasons.push(`커버리지 부족: 기대 ${String(expected)} > 대상 ${String(targetCount.count)}`);
  }

  // 6. 대표 질의가 새 인덱스에서 성립한다.
  try {
    await deps.es.search({ index: target, size: 0, track_total_hits: true });
  } catch (error) {
    reasons.push(`대표 질의 실패: ${String(error)}`);
  }

  /*
   * 8. 시퀀스 투영 (CR-113 / FR-ING-008 AC-8) — target 인덱스의 서수 필드가 정본과 문서마다
   *    같고, 대표 범위의 실제 정렬이 정본 순서와 같다. 대상 집합은 PostgreSQL의 현재
   *    시퀀스·스냅숏으로 계산한다 — 전체 건수 비교가 아니다.
   */
  if (alias === 'prs-pull-requests' || alias === 'prs-commits') {
    try {
      const sequence = await verifySequenceProjection(projectionDepsOf(deps), alias === 'prs-commits' ? 'commit' : 'pull_request', target);
      reasons.push(...sequence.reasons);
      logOf(deps)({
        level: sequence.ok ? 'info' : 'error',
        message: '전환 전 시퀀스 투영 검증',
        job_id: jobId,
        alias,
        target_index: target,
        detail: `spaces=${String(sequence.spaces)} items=${String(sequence.items)} repaired=${String(sequence.repaired)} reasons=${String(sequence.reasons.length)}`,
      });
    } catch (error) {
      reasons.push(`시퀀스 투영 검증 실패: ${String(error).slice(0, 200)}`);
    }
  }

  /*
   * 9. PR 연결 (CR-116 / FR-ING-008 AC-9) — 대상 인덱스의 `pull_request_numbers`가
   *    정본과 문서마다 같다. **양방향으로 본다**: 정본에 있는데 색인에 없는 번호
   *    (누락)와, 색인에 있는데 정본에 없는 번호(잉여)가 둘 다 결함이다. 누락만 보면
   *    이 CR이 고치려는 오염이 새 인덱스로 그대로 넘어간 채 전환을 통과한다.
   */
  if (alias === 'prs-commits') {
    try {
      const links = await verifyCommitLinkProjection(deps, target);
      reasons.push(...links.reasons);
      logOf(deps)({
        level: links.reasons.length === 0 ? 'info' : 'error',
        message: '전환 전 PR 연결 검증',
        job_id: jobId,
        alias,
        target_index: target,
        detail: `checked=${String(links.checked)} missing=${String(links.missing)} extra=${String(links.extra)}`,
      });
    } catch (error) {
      reasons.push(`PR 연결 검증 실패: ${String(error).slice(0, 200)}`);
    }
  }

  logOf(deps)({
    level: 'info',
    message: '전환 전 검증',
    job_id: jobId,
    alias,
    target_index: target,
    detail:
      `source=${String(sourceCount.count)} target=${String(targetCount.count)} ` +
      `expected=${expected === null ? '(셀 수 없음)' : String(expected)}`,
  });

  return { ok: reasons.length === 0, reasons };
}

/** 인덱스의 UUID. 인덱스가 없으면 `undefined`다 (CR-119). */
async function indexUuidOf(es: Client, index: string): Promise<string | undefined> {
  const response = (await es.indices.getSettings(
    { index, name: 'index.uuid', flat_settings: true },
    { ignore: [404] },
  )) as Record<string, { readonly settings?: Readonly<Record<string, unknown>> } | undefined>;
  const uuid = response[index]?.settings?.['index.uuid'];
  return typeof uuid === 'string' ? uuid : undefined;
}

/**
 * 대상이 준비 단계의 그 인덱스가 아니면 사유를, 같으면 `null`을 돌려준다 (CR-119).
 *
 * UUID를 남기지 않은 잡(이 변경 전에 준비된 잡)은 대조할 것이 없어 `null`이다 — 나머지 검증
 * 항목은 그대로 선다.
 */
async function targetReplaced(es: Client, target: string, recorded: string | undefined): Promise<string | null> {
  if (recorded === undefined) return null;
  const now = await indexUuidOf(es, target);
  return now === recorded ? null : `target_index_replaced:${target}:${recorded}->${now ?? 'absent'}`;
}

/** 커밋 문서 대조 결과 (CR-119 / FR-ING-008 AC-10). */
interface CommitDocumentVerdict {
  /** 정본과 생성 정책이 말하는 필수 문서 수. */
  readonly expected: number;
  readonly missing: number;
  readonly metadataChecked: number;
  readonly metadataMismatched: number;
  readonly reasons: readonly string[];
}

/** 사유 표본 상한. 전부 싣지 않는다 — 수는 요약 사유가 따로 말한다. */
const COMMIT_REASON_SAMPLES = 10;

/**
 * 대상 인덱스의 커밋 문서를 정본과 맞댄다 (CR-119 / FR-ING-008 AC-10).
 *
 * ## 기대 집합은 재구축의 생성 정책 그대로다
 *
 * - **체인 커밋**: 스냅숏 행 가운데 `merge_sequence`에 행이 있는 것 — 체인 패스가
 *   `createWith`로 만든다(`findShasWithSequence`는 그 술어 그대로다).
 * - **PR 유래 커밋**: PR 스냅숏의 원본 커밋과 그 PR의 유효한 `source` 연결(현재 체인 커밋
 *   제외), 병합된 PR의 머지 커밋 — PR 유래 패스가 만든다(`projectedCommitRoles`를 함께 쓴다).
 *   스냅숏이 아직 없어도(미수집) 문서는 있어야 한다.
 * - 그 밖의 스냅숏 행은 **생성 근거가 없어** 기대하지 않는다.
 *
 * 재구축의 쓰기 결과를 쓰지 않고 **지금의 정본을 다시 읽는다** — 무엇을 썼는지가 아니라 무엇이
 * 있어야 하는지를 묻는다.
 *
 * ## 메타데이터는 값으로 대조한다
 *
 * 스냅숏이 있는 문서는 부모·메시지·작성자·커미터·두 시각·변경 경로·절삭 여부·patch-id가 정본과
 * 같아야 한다. **값이 `null`인 것과 필드가 없는 것은 다르다** — 정본이 `null`이면 그 필드가 `null`로
 * 있어야 한다. 스냅숏이 없는 문서는 대조하지 않는다 — 정본에 없는 값을 기대하지 않는다. 역할은
 * 대조하지 않는다 — 판정 규칙이 두 갈래이고(DEV-757) 이 검증의 몫이 아니다.
 */
async function verifyCommitDocuments(deps: ReindexDeps, targetIndex: string): Promise<CommitDocumentVerdict> {
  const samples: string[] = [];
  let expected = 0;
  let missing = 0;
  let metadataChecked = 0;
  let metadataMismatched = 0;
  const note = (reason: string): void => {
    if (samples.length < COMMIT_REASON_SAMPLES) samples.push(reason);
  };

  for (const repository of await allRepositories(deps.pool)) {
    const repositoryId = Number(repository.repository_id);

    // 1. PR 유래 기대 문서 — PR 유래 패스와 같은 규칙.
    const projected = new Set<string>();
    let afterPr = 0;
    for (;;) {
      const rows = await prSnapshotRepo.listSnapshotsAfter(deps.pool, repositoryId, afterPr, REINDEX_BATCH);
      if (rows.length === 0) break;
      const page = await projectedPageOf(deps, repositoryId, rows);
      for (const row of rows) for (const sha of projectedCommitRoles(row.document, row.pr_number, page).keys()) projected.add(sha);
      afterPr = rows[rows.length - 1]?.pr_number ?? afterPr;
      if (rows.length < REINDEX_BATCH) break;
    }

    // 2. 스냅숏이 있는 기대 문서 — 존재와 값.
    const withSnapshot = new Set<string>();
    let after = '';
    for (;;) {
      const rows = await commitSnapshotRepo.listCommitSnapshotsAfter(deps.pool, repositoryId, after, REINDEX_BATCH);
      if (rows.length === 0) break;
      const onChain = await mergeSequenceRepo.findShasWithSequence(
        deps.pool,
        repositoryId,
        rows.map((row) => row.commit_sha),
      );
      const wanted = rows.filter((row) => {
        const sha = row.commit_sha.toLowerCase();
        return onChain.has(sha) || projected.has(sha);
      });
      const found = await readCommitDocuments(
        deps,
        targetIndex,
        repositoryId,
        wanted.map((row) => row.commit_sha.toLowerCase()),
      );
      for (const row of wanted) {
        const sha = row.commit_sha.toLowerCase();
        withSnapshot.add(sha);
        expected += 1;
        const doc = found.get(sha);
        if (doc === undefined) {
          missing += 1;
          note(`커밋 문서 누락: ${sha.slice(0, 12)} (저장소 ${String(repositoryId)})`);
          continue;
        }
        metadataChecked += 1;
        const wrong = metadataMismatches(commitMetadataFields(commitFactOf(row)), doc);
        if (wrong.length > 0) {
          metadataMismatched += 1;
          note(`커밋 메타데이터 불일치: ${sha.slice(0, 12)} [${wrong.join(',')}]`);
        }
      }
      after = rows[rows.length - 1]?.commit_sha ?? after;
      if (rows.length < REINDEX_BATCH) break;
    }

    // 3. 스냅숏이 없는 PR 유래 문서 — 존재만 본다.
    const rest = [...projected].filter((sha) => !withSnapshot.has(sha)).sort();
    for (let offset = 0; offset < rest.length; offset += REINDEX_BATCH) {
      const page = rest.slice(offset, offset + REINDEX_BATCH);
      const found = await readCommitDocuments(deps, targetIndex, repositoryId, page);
      for (const sha of page) {
        expected += 1;
        if (found.has(sha)) continue;
        missing += 1;
        note(`커밋 문서 누락: ${sha.slice(0, 12)} (저장소 ${String(repositoryId)})`);
      }
    }
  }

  // 요약이 먼저다 — 잡 오류 칸은 잘리므로 수가 표본보다 앞에 있어야 한다.
  const reasons: string[] = [];
  if (missing > 0) reasons.push(`커밋 문서 누락 ${String(missing)}건 (기대 ${String(expected)})`);
  if (metadataMismatched > 0) {
    reasons.push(`커밋 메타데이터 불일치 ${String(metadataMismatched)}건 (대조 ${String(metadataChecked)})`);
  }
  reasons.push(...samples);
  return { expected, missing, metadataChecked, metadataMismatched, reasons };
}

/**
 * 대상 인덱스에서 커밋 문서를 ID로 읽는다. `_id`를 SHA로 되돌려 돌려준다.
 *
 * 라우팅은 저장소다 — 다른 샤드에 잘못 쓰인 문서는 여기서 없는 것으로 보이고, 그것이 옳다:
 * 검색도 같은 라우팅으로 읽는다. 항목 단위 오류는 없음으로 읽지 않고 던진다.
 */
async function readCommitDocuments(
  deps: ReindexDeps,
  targetIndex: string,
  repositoryId: number,
  shas: readonly string[],
): Promise<Map<string, Readonly<Record<string, unknown>>>> {
  const found = new Map<string, Readonly<Record<string, unknown>>>();
  if (shas.length === 0) return found;
  const byId = new Map(shas.map((sha) => [commitDocId(repositoryId, sha), sha] as const));
  const response = await deps.es.mget<Record<string, unknown>>({
    index: targetIndex,
    ids: [...byId.keys()],
    routing: String(repositoryId),
  });
  for (const doc of response.docs) {
    const hit = doc as { _id?: string; found?: boolean; _source?: Record<string, unknown>; error?: unknown };
    if (hit.error !== undefined) {
      throw new Error(`commit_document_read_failed: ${JSON.stringify(hit.error).slice(0, 200)}`);
    }
    const sha = hit._id === undefined ? undefined : byId.get(hit._id);
    if (sha === undefined || hit.found !== true) continue;
    found.set(sha, hit._source ?? {});
  }
  return found;
}

/**
 * 문서가 정본 메타데이터와 다른 필드 이름들 (CR-119).
 *
 * 기대값은 재구축이 쓰는 값 그대로다(`commitMetadataFields`). 시각은 같은 순간인지로 본다 —
 * 평시 보강은 그래프가 준 표기를, 재구축은 정본의 ISO 표기를 쓰므로 문자열이 다를 수 있다.
 * `patch_id`는 스크립트 규칙을 따른다: 정본이 값을 알면 같은 값이고 사유 필드가 없어야 하며,
 * 정본이 모르면 색인에도 값이 없어야 한다(정본에 없는 값을 색인이 알 수 없다).
 */
function metadataMismatches(
  expected: CommitMetadataFields,
  actual: Readonly<Record<string, unknown>>,
): readonly string[] {
  const wrong: string[] = [];
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(actual, key);
  const sameList = (value: unknown, want: readonly string[]): boolean =>
    Array.isArray(value) && value.length === want.length && value.every((one, index) => one === want[index]);
  const sameInstant = (value: unknown, want: string): boolean =>
    typeof value === 'string' && !Number.isNaN(Date.parse(want)) && Date.parse(value) === Date.parse(want);

  if (!has('parent_shas') || !sameList(actual['parent_shas'], expected.parent_shas)) wrong.push('parent_shas');
  if (!has('message') || actual['message'] !== expected.message) wrong.push('message');
  // `null`도 값이다 — 필드가 있어야 하고 그 값이 `null`이어야 한다.
  if (!has('author') || actual['author'] !== expected.author) wrong.push('author');
  if (!has('committer') || actual['committer'] !== expected.committer) wrong.push('committer');
  if (!has('authored_at') || !sameInstant(actual['authored_at'], expected.authored_at)) wrong.push('authored_at');
  if (!has('committed_at') || !sameInstant(actual['committed_at'], expected.committed_at)) wrong.push('committed_at');
  if (!has('changed_paths') || !sameList(actual['changed_paths'], expected.changed_paths)) wrong.push('changed_paths');
  if (!has('changed_paths_truncated') || actual['changed_paths_truncated'] !== expected.changed_paths_truncated) {
    wrong.push('changed_paths_truncated');
  }
  if (expected.patch_id !== undefined) {
    if (actual['patch_id'] !== expected.patch_id) wrong.push('patch_id');
    if (has('patch_id_unavailable')) wrong.push('patch_id_unavailable');
  } else {
    if (has('patch_id') && actual['patch_id'] !== null) wrong.push('patch_id');
    if (expected.patch_id_unavailable !== undefined && actual['patch_id_unavailable'] !== expected.patch_id_unavailable) {
      wrong.push('patch_id_unavailable');
    }
  }
  return wrong;
}

/**
 * 대상 인덱스의 PR 연결을 정본과 맞댄다 (CR-116 / WP-101, FR-ING-008 AC-9).
 *
 * **양방향이다.** 정본에만 있는 번호는 누락이고 색인에만 있는 번호는 잉여이며,
 * 둘 다 전환을 막는다. 누락만 보는 검증은 "합집합이 남긴 잘못된 번호"를 새
 * 인덱스로 그대로 통과시킨다 — 이 CR이 고치려는 바로 그 상태다.
 *
 * `[]`와 필드 부재를 구분한다. 정본이 빈 집합을 말하는데 색인의 필드가 없으면
 * 그것은 "같다"가 아니라 "아직 모름"이며, 재구축이 그 커밋을 비추지 못한 것이다.
 */
async function verifyCommitLinkProjection(
  deps: ReindexDeps,
  targetIndex: string,
): Promise<{ readonly checked: number; readonly missing: number; readonly extra: number; readonly reasons: readonly string[] }> {
  const reasons: string[] = [];
  let checked = 0;
  let missing = 0;
  let extra = 0;

  for (const repository of await allRepositories(deps.pool)) {
    const repositoryId = Number(repository.repository_id);
    let after = '';
    for (;;) {
      const rows = await prCommitLinkRepo.listCommitLinkStatesAfter(deps.pool, repositoryId, after, REINDEX_BATCH);
      if (rows.length === 0) break;
      const ids = rows.map((row) => commitDocId(repositoryId, row.commit_sha));
      const found = await deps.es.mget<{ pull_request_numbers?: readonly number[] }>({
        index: targetIndex,
        ids,
        routing: String(repositoryId),
        _source: ['pull_request_numbers'],
      });
      const byId = new Map<string, readonly number[] | undefined>();
      for (const doc of found.docs) {
        const hit = doc as { _id?: string; found?: boolean; _source?: { pull_request_numbers?: readonly number[] } };
        if (hit._id === undefined) continue;
        byId.set(hit._id, hit.found === true ? hit._source?.pull_request_numbers ?? undefined : undefined);
      }

      for (const row of rows) {
        after = row.commit_sha;
        checked += 1;
        const expected = [...new Set(row.pr_numbers ?? [])].sort((a, b) => a - b);
        const actual = byId.get(commitDocId(repositoryId, row.commit_sha));
        if (actual === undefined) {
          /*
           * 문서가 없거나 필드가 없다. 정본이 연결을 말하고 있으면 **누락**이다.
           *
           * 정본이 빈 집합이면 막지 않는다 (독립 검토 지적 B). 연결이 0개가 된 커밋의
           * tombstone은 상태 표에 남지만, 그 커밋이 어느 스냅숏의 원본 목록에도 없고
           * first-parent 체인에도 없으면 **재구축이 문서를 만들 재료가 없다.**
           * `replayCommitLinks`가 그 경우를 통과시키므로 여기서 막으면 replay가 용인한
           * 상태를 verify가 거부해 전환이 영영 되지 않는다. 없는 문서에 「연결 0개」를
           * 적을 자리도 없다 — 없는 것과 0은 그 커밋에 대해 같은 결론이다.
           */
          if (expected.length > 0) {
            missing += expected.length;
            if (reasons.length < 10) reasons.push(`PR 연결 누락: ${row.commit_sha.slice(0, 12)} 기대=[${expected.join(',')}] 색인=없음`);
          }
          continue;
        }
        const indexed = [...new Set(actual)].sort((a, b) => a - b);
        const missingHere = expected.filter((n) => !indexed.includes(n));
        const extraHere = indexed.filter((n) => !expected.includes(n));
        missing += missingHere.length;
        extra += extraHere.length;
        if ((missingHere.length > 0 || extraHere.length > 0) && reasons.length < 10) {
          reasons.push(`PR 연결 불일치: ${row.commit_sha.slice(0, 12)} 누락=[${missingHere.join(',')}] 잉여=[${extraHere.join(',')}]`);
        }
      }
      if (rows.length < REINDEX_BATCH) break;
    }
  }

  return { checked, missing, extra, reasons };
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
    /*
     * 대상의 UUID를 남긴다 (CR-119). 이름이 같아도 같은 인덱스라는 보장이 없다 — 도중에 지워지면
     * 다음 쓰기가 같은 이름의 인덱스를 동적 매핑으로 자동 생성한다. 검증과 전환이 이 값과 대조한다.
     */
    const targetUuid = await indexUuidOf(deps.es, target);
    if (targetUuid === undefined) throw new Error(`대상 인덱스를 확인하지 못했다: ${target}`);
    const recordedUuid = current.progress.target_uuid;
    if (recordedUuid !== undefined && recordedUuid !== targetUuid) {
      throw new Error(`target_index_replaced: ${target} ${recordedUuid} → ${targetUuid}`);
    }
    await advance(deps, jobId, { target_uuid: targetUuid });
    log({ level: 'info', message: '대상 인덱스 준비', job_id: jobId, alias, phase: 'prepare', target_index: target, detail: `uuid=${targetUuid}` });

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
    const tally = await rebuildAlias(deps, alias, jobId);
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
     * 재구축이 쓴 문서 수를 기대로 넘기는 것은 PR·릴리스뿐이다.
     *
     * - **커밋은 넘기지 않는다** (CR-119). 검증이 기대 집합을 정본과 생성 정책에서 문서 ID로 다시
     *   계산하고 건수·존재·메타데이터를 함께 대조한다. 쓰기로 센 값은 만들지 못한 문서까지
     *   세었다(사내 pilot.18).
     * - 간선은 `rebuildRepository`가 처리한 source 수만 돌려주므로 문서 수를 셀 수
     *   없다 — 그때는 커버리지를 판정하지 않고 나머지 여섯으로 건다.
     */
    const expected = alias === 'prs-pull-requests' || alias === 'prs-releases' ? tally.documentIds.size : null;
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
    let cutoverAbortReason: string | null = null;
    const switched = await withReindexExclusive(deps.pool, async (client) => {
      // 울타리를 잡은 지금 다시 본다 — 기다리는 동안 취소·실패가 들어왔을 수 있다.
      const latest = await reindexRepo.findReindexJob(client, jobId);
      if (latest === undefined || latest.state !== 'running') return false;
      if ((latest.progress.failures ?? 0) > 0) return false;

      /*
       * 시퀀스 에폭 대조 (CR-113). replay가 비춘 에폭과 지금 정본의 에폭이 다르면 그 사이에
       * 재채번이 있었다 — 새 인덱스의 서수는 옛 에폭이다. 전환하지 않는다. 옮기지 않은
       * 별칭은 그대로 서비스되고, 운영자가 다시 실행하면 새 에폭으로 replay한다.
       */
      const moved = await sequenceEpochsMoved(client, (latest.progress as Partial<ReindexProgress> & { sequence_replay?: SequenceReplayProgress }).sequence_replay);
      if (moved !== null) {
        cutoverAbortReason = moved;
        return false;
      }

      /*
       * 검증한 그 인덱스인가 (CR-119). 검증과 전환 사이에 대상이 지워지고 이중 쓰기가 같은 이름을
       * 자동 생성했다면, 별칭은 빈 동적 매핑 인덱스로 옮겨 간다. 울타리 안이라 이 뒤로는 쓰기가 없다.
       */
      const replaced = await targetReplaced(deps.es, target, latest.progress.target_uuid);
      if (replaced !== null) {
        cutoverAbortReason = replaced;
        return false;
      }

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
      const reason = cutoverAbortReason ?? 'cutover_aborted';
      log({ level: 'warn', message: '전환 직전에 취소·실패·에폭 이동이 확인됐다 — 별칭을 옮기지 않았다', job_id: jobId, alias, reason });
      await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', reason);
      return;
    }

    log({ level: 'info', message: '별칭 전환 완료', job_id: jobId, alias, phase: 'cutover', target_index: target });

    /*
     * 전환 뒤 durable full sweep (CR-113). 검증과 전환 사이에 들어온 채번·스냅숏은 별칭을 통해
     * 새 인덱스로 갔지만, 그 쓰기 하나가 실패했을 수 있다. 공간마다 한 행이고 정본을 다시
     * 읽으므로 비용은 한 번의 sweep이다. 실패해도 전환은 이미 끝났다 — 다음 채번·복구가 같은
     * work를 다시 남긴다.
     */
    if (alias === 'prs-pull-requests' || alias === 'prs-commits') {
      try {
        const requested = await requestFullSweepForAllSpaces(deps.pool, { trigger_kind: 'reindex_cutover', reindex_job_id: jobId, aliases: [alias] });
        log({ level: 'info', message: '전환 뒤 시퀀스 full sweep을 예약했다', job_id: jobId, alias, detail: `spaces=${String(requested)}` });
      } catch (error) {
        log({ level: 'warn', message: '전환 뒤 시퀀스 sweep 예약에 실패했다 — 다음 채번·복구가 다시 남긴다', job_id: jobId, alias, reason: 'sweep_request_failed', detail: String(error).slice(0, 200) });
      }
    }

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

/**
 * replay가 기록한 공간 에폭과 정본의 현재 에폭을 대조한다. 움직였으면 사유 문자열, 아니면 `null`.
 * replay 기록이 없는 별칭(릴리스·간선)은 대조할 것이 없다.
 */
async function sequenceEpochsMoved(client: Parameters<typeof sequenceSpaceRepo.findSequenceSpace>[0], replay: SequenceReplayProgress | undefined): Promise<string | null> {
  if (replay === undefined) return null;
  const seen = new Map<string, number>();
  for (const record of replay.spaces) seen.set(`${String(record.repository_id)}\n${record.base_branch}`, record.seq_epoch);
  for (const [key, epoch] of seen) {
    const [repositoryId, baseBranch] = key.split('\n');
    const space = await sequenceSpaceRepo.findSequenceSpace(client, Number(repositoryId), baseBranch ?? '');
    if (space !== undefined && space.seq_epoch !== epoch) {
      return `sequence_epoch_moved:${String(repositoryId)}@${baseBranch ?? ''}:${String(epoch)}->${String(space.seq_epoch)}`;
    }
  }
  return null;
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

