/**
 * JOB-MIR-002 커밋 메타데이터 보강 (WP-067 / CR-038, DEV-205~214).
 *
 * ## 무엇을 메우나
 *
 * `prs-commits` 문서에는 커밋 자체의 값이 비어 있었다 — 메시지·작성자·부모 SHA·
 * 변경 경로·patch-id. WP-020이 그래프를 **읽는** 계층을 세웠지만 그 값을 **쓰는**
 * 잡이 없었다 (DEV-112).
 *
 * ## 원래 계약대로는 아무것도 달라지지 않는다 (CR-038)
 *
 * 계약은 "기존 커밋 문서를 부분 갱신한다"였다. 그런데 조사 품질을 실제로
 * 떨어뜨리는 커밋 — **직접 푸시 커밋** — 에는 문서 자체가 없다. 투영은 PR 이벤트의
 * `source_commit_shas`와 머지 커밋으로만 문서를 만들고, 시퀀스 투영도
 * `update_by_query`뿐이라 없는 문서를 만들지 않는다. 그래서 이 잡은 **문서를
 * 만들기도 한다** (DEV-206).
 *
 * ## 방아쇠 넷
 *
 * | 방아쇠 | 무엇을 보강하나 |
 * | --- | --- |
 * | `sequence.assigned` | 새로 채번된 `from_seq..to_seq` 구간. **직접 푸시 커밋이 여기로 들어온다** |
 * | `sequence.reassigned` | 새 에폭에서 영향받은 구간을 다시 확인한다 |
 * | `EVT-ING-003`(commit) | PR 유래 커밋 문서를 보강한다 |
 * | 일 1회 스윕 | 놓친 것을 메운다 — **주 전달 수단이 아니다** |
 *
 * `EVT-ING-003`만으로는 성립하지 않는다: 그 이벤트는 커밋 문서 투영 **뒤에**
 * 나오므로, 애초에 문서가 없는 커밋에 대해서는 발생하지 않는다.
 *
 * ## 정본을 색인보다 먼저 쓴다 (ADR-004)
 *
 * `commit_snapshot`이 먼저다. 반대로 하면 색인에만 있고 정본에는 없는 창이 생기고,
 * 그 창에서 프로세스가 죽으면 ADR-004가 깨진 상태로 남는다 — CR-034가 PR 축에서
 * 겪은 것과 같다.
 */

import {
  EVENT_NAMES,
  commitDocId,
  deterministicEventId,
  ingestPartitionKey,
  type CommitMetadataReady,
  type IngestionProjected,
  type SequenceAssigned,
  type SequenceReassigned,
} from '@prs/domain';
import {
  TOPICS,
  consumerGroup,
  type DeliveredEvent,
  type EventBus,
  type HandlerDisposition,
  type SubscribeOptions,
  type Subscription,
} from '@prs/bus';
import { commitSnapshotRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import { upsertCommitMetadata } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import type { CommitGraph, RepoRef } from '@prs/github';
import type { WorkerMetrics } from './metrics.js';

/** 잡 카탈로그 이름. */
export const COMMIT_ENRICH_JOB = 'JOB-MIR-002' as const;
/** `prs:projected`의 두 번째 논리 소비자 (CR-038, DEV-205). */
export const COMMIT_ENRICH_CONSUMER = 'commit-enrich' as const;

/** 스윕 주기: 일 1회 (비동기 문서 9장, 05:00 KST). */
export const COMMIT_ENRICH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 한 스윕 회차가 보강하는 커밋 수 상한. 무한정 돌지 않는다. */
export const COMMIT_ENRICH_SWEEP_BATCH = 500;
/** 한 이벤트가 보강하는 커밋 수 상한. 큰 백필 구간이 한 번에 들어와도 잘린다. */
export const COMMIT_ENRICH_EVENT_BATCH = 500;

export interface CommitEnrichLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository_id?: number;
  readonly commit_sha?: string;
  readonly correlation_id?: string;
  readonly reason?: string;
  readonly enriched?: number;
  readonly skipped?: number;
}

export interface CommitEnrichDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly bus: EventBus;
  readonly metrics: WorkerMetrics;
  readonly graphFor: (repository: RepositoryRow) => CommitGraph;
  readonly log?: (fields: CommitEnrichLogFields) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** 보강 대상 하나. 역할 판정의 근거를 함께 나른다 (CR-038, DEV-207). */
export interface EnrichTarget {
  readonly commitSha: string;
  /**
   * first-parent 체인에 있는가.
   *
   * **`direct_push` 판정의 필수 근거다.** 원본 커밋(PR 브랜치 위의 커밋)은 체인에
   * 없으므로 이 경로가 그 역할을 건드리면 안 된다.
   */
  readonly firstParent: boolean;
  /**
   * 정본이 아는 PR 번호. `null`은 **"아직 모른다"**이지 "PR이 없다"가 아니다.
   *
   * push 웹훅과 PR 투영 사이에는 경주가 있고 `merge_sequence.pull_request_number`는
   * 나중에 채워질 수 있다. 그래서 역할은 매번 정본에서 다시 계산하고,
   * **매핑이 생기면 다음 보강이 `merge_commit`으로 교정한다** (DEV-207).
   */
  readonly pullRequestNumber: number | null;
  /** 문서를 새로 만들 때 실을 대상 브랜치. 없으면 넣지 않는다. */
  readonly baseBranch?: string;
}

export interface EnrichOutcome {
  readonly enriched: number;
  readonly skipped: number;
}

function refOf(repository: RepositoryRow): RepoRef {
  return { owner: repository.owner, repo: repository.name };
}

/**
 * 문서 생성 시 실을 접근 통제 material (CR-038, DEV-213).
 *
 * 투영의 `repositoryScope()`와 **같은 필드**다. 여기가 어긋나면 이 경로로 만든
 * 문서만 강제 필터의 판정이 달라진다.
 */
function scopeFields(repository: RepositoryRow): Readonly<Record<string, unknown>> {
  return {
    repository_id: repository.repository_id,
    repository: `${repository.owner}/${repository.name}`,
    org_id: repository.org_id,
    visibility: repository.visibility,
    allowed_team_ids: [...repository.allowed_team_ids],
    repository_archived: repository.status === 'archived',
  };
}

/**
 * 커밋 하나를 보강한다.
 *
 * @returns 보강했으면 `true`. 그래프가 아직 그 커밋을 모르면 `false` —
 * **오류가 아니다.** 미러 동기화가 아직 안 왔을 뿐이고 스윕이 다시 본다.
 */
export async function enrichCommit(
  deps: CommitEnrichDeps,
  repository: RepositoryRow,
  target: EnrichTarget,
  correlationId = '',
): Promise<boolean> {
  const log = deps.log ?? ((): void => undefined);
  const graph = deps.graphFor(repository);
  const ref = refOf(repository);
  const sha = target.commitSha.toLowerCase();

  const meta = await graph.readCommit(ref, sha);
  if (meta === null) {
    deps.metrics.commitEnrichTotal.inc({ source: graph.kind, result: 'not_found' });
    return false;
  }

  const changed = await graph.changedPaths(ref, sha);
  const patch = await graph.patchId(ref, sha);
  if (patch.patchId === null) {
    deps.metrics.patchIdUnavailableTotal.inc({ reason: patch.unavailable });
  }

  /*
   * ---- 정본이 먼저다 (ADR-004). 색인이 실패해도 재구성 근거는 남는다.
   */
  await commitSnapshotRepo.upsertCommitSnapshot(deps.pool, {
    repositoryId: repository.repository_id,
    commitSha: sha,
    parentShas: meta.parentShas,
    message: meta.message,
    author: meta.author,
    committer: meta.committer,
    authoredAt: new Date(meta.authoredAt),
    committedAt: new Date(meta.committedAt),
    changedPaths: changed.paths,
    changedPathsTruncated: changed.truncated,
    patchId: patch.patchId,
    patchIdUnavailable: patch.patchId === null ? patch.unavailable : null,
    metadataSource: graph.kind === 'mirror' ? 'mirror' : 'api',
  });

  /*
   * ---- 색인. 없는 문서는 **first-parent 커밋일 때만** 만든다 (DEV-206·213).
   *
   * 체인에 있다는 것이 "이 저장소의 대상 브랜치 히스토리에 실제로 있다"는 뜻이고,
   * 그때에만 우리가 역할과 접근 범위를 확신을 갖고 실을 수 있다.
   */
  const role = target.firstParent
    ? target.pullRequestNumber === null
      ? 'direct_push'
      : 'merge_commit'
    : undefined;

  const result = await upsertCommitMetadata(deps.es, {
    repositoryId: repository.repository_id,
    commitSha: sha,
    docId: commitDocId(repository.repository_id, sha),
    fields: {
      parent_shas: meta.parentShas.map((one) => one.toLowerCase()),
      message: meta.message,
      author: meta.author,
      committer: meta.committer,
      authored_at: meta.authoredAt,
      committed_at: meta.committedAt,
      changed_paths: [...changed.paths],
      changed_paths_truncated: changed.truncated,
      ...(patch.patchId === null ? { patch_id_unavailable: patch.unavailable } : { patch_id: patch.patchId }),
      ...(role === undefined ? {} : { role }),
    },
    ...(target.firstParent
      ? {
          createWith: {
            ...scopeFields(repository),
            /*
             * **커밋 시각이 초기 버전이다** (DEV-209). `Date.now()`를 쓰면 그 뒤
             * 도착하는 정상 웹훅 투영이 전부 "오래된 이벤트"로 밀려나, 이 문서가
             * PR 정보를 영영 받지 못한다.
             */
            document_version: Date.parse(meta.committedAt),
            ...(target.pullRequestNumber === null ? {} : { pull_request_numbers: [target.pullRequestNumber] }),
            ...(target.baseBranch === undefined ? {} : { base_branch: target.baseBranch }),
            enrichment_pending: false,
            link_summary: { has_revert: false, is_reverted: false, has_cherry_pick: false },
            indexed_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
          },
        }
      : {}),
  });

  /*
   * ---- 관계 파생에 "이 커밋을 다시 보라"고 알린다 (CR-039, DEV-215).
   *
   * **정본과 색인이 모두 성공한 뒤에 낸다.** 먼저 내면 관계 워커가 아직 메시지가
   * 없는 커밋을 읽어 참조 0건으로 확정하고, 그 뒤 아무도 다시 하지 않는다.
   *
   * **그러나 완결 표식(`projected_at`)보다는 앞이다** (PR #44 리뷰 P1).
   *
   * 표식을 먼저 찍으면 발행 실패가 **영구 유실**이 된다: 스냅숏이 있고 투영도
   * 찍혀 있어 두 스윕이 모두 그 커밋을 건너뛰고, `enrichCommits`는 예외를 잡아
   * `skipped`로 세며 핸들러는 ack한다 — 직접 푸시 커밋의 유일한 방아쇠가
   * 사라지고 그 메시지의 참조는 영영 간선이 되지 않는다. 순서를 뒤집으면
   * 발행 실패가 `projected_at`을 `null`로 남겨 **`listCommitsMissingProjection`
   * 스윕이 다시 본다.**
   *
   * 발행이 한 번 더 나가는 것은 안전하다 — 파생은 정본에서 다시 계산하는
   * 멱등 연산이고 `event_id`도 결정론적이다.
   */
  const ready: CommitMetadataReady = {
    repository_id: repository.repository_id,
    commit_sha: sha,
    entity_id: commitDocId(repository.repository_id, sha),
    metadata_source: graph.kind === 'mirror' ? 'mirror' : 'api',
    correlation_id: correlationId,
  };
  await deps.bus.publish(TOPICS.projected, ingestPartitionKey(repository.repository_id, sha), {
    // 같은 커밋을 같은 경로로 다시 보강하면 같은 ID다.
    event_id: deterministicEventId(
      EVENT_NAMES.commitMetadataReady,
      String(repository.repository_id),
      sha,
      ready.metadata_source,
    ),
    event_name: EVENT_NAMES.commitMetadataReady,
    correlation_id: correlationId,
    occurred_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
    payload: ready,
  });

  /*
   * 투영이 성공했음을 정본에 남긴다 (CR-038 / PR #42 리뷰).
   *
   * 정본을 색인보다 먼저 쓰므로, 색인 쓰기가 실패하면 스냅숏만 남는다. 스윕이
   * "스냅숏이 없는 커밋"만 찾으면 그 커밋은 **영원히 재시도되지 않는다** — 다시
   * 투영할 다른 경로도 없다. 여기까지 왔다는 것이 곧 색인이 그 값을 알고
   * 관계 파생도 깨워졌다는 뜻이다.
   */
  await commitSnapshotRepo.markCommitProjected(
    deps.pool,
    repository.repository_id,
    sha,
    (deps.now ?? ((): Date => new Date()))(),
  );

  deps.metrics.commitEnrichTotal.inc({ source: graph.kind, result: result.result });
  if (result.result === 'created') {
    log({
      level: 'info',
      message: '직접 푸시 커밋 문서를 만들었다',
      repository_id: repository.repository_id,
      commit_sha: sha,
    });
  }
  return true;
}

/** 대상 여럿을 차례로 보강한다. 하나가 실패해도 나머지를 계속한다. */
export async function enrichCommits(
  deps: CommitEnrichDeps,
  repository: RepositoryRow,
  targets: readonly EnrichTarget[],
  correlationId = '',
): Promise<EnrichOutcome> {
  const log = deps.log ?? ((): void => undefined);
  let enriched = 0;
  let skipped = 0;

  for (const target of targets.slice(0, COMMIT_ENRICH_EVENT_BATCH)) {
    try {
      if (await enrichCommit(deps, repository, target, correlationId)) enriched += 1;
      else skipped += 1;
    } catch (error) {
      /*
       * 커밋 하나의 실패로 구간 전체를 되돌리지 않는다 — 그러면 한 개의 나쁜
       * 커밋이 그 구간을 영원히 막는다. 스윕이 남은 것을 다시 본다.
       */
      skipped += 1;
      deps.metrics.commitEnrichTotal.inc({ source: 'unknown', result: 'failed' });
      log({
        level: 'warn',
        message: '커밋 보강 실패 — 스윕이 다시 본다',
        repository_id: repository.repository_id,
        commit_sha: target.commitSha,
        reason: String(error).slice(0, 200),
      });
    }
  }
  return { enriched, skipped };
}

/** `merge_sequence` 구간을 보강 대상으로 바꾼다. 정본이 first-parent 체인을 안다. */
async function targetsForRange(
  deps: CommitEnrichDeps,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromExclusive: number,
  toInclusive: number,
): Promise<readonly EnrichTarget[]> {
  const rows = await mergeSequenceRepo.findRange(
    deps.pool,
    repositoryId,
    baseBranch,
    seqEpoch,
    fromExclusive,
    toInclusive,
  );
  return rows.map((row) => ({
    commitSha: row.commit_sha,
    firstParent: true,
    pullRequestNumber: row.pull_request_number,
    baseBranch,
  }));
}

/** 이벤트 하나를 처리한다. */
export async function handleProjectedEvent(
  deps: CommitEnrichDeps,
  delivered: DeliveredEvent,
): Promise<HandlerDisposition> {
  const log = deps.log ?? ((): void => undefined);
  const name = delivered.event_name;
  const payload = delivered.payload as Record<string, unknown>;
  const repositoryId = typeof payload['repository_id'] === 'number' ? payload['repository_id'] : null;
  if (repositoryId === null) return { kind: 'ack' };

  /*
   * **자기 이벤트다. 되받아 처리하지 않는다** (CR-039, DEV-216).
   *
   * `commit.metadata_ready`는 이 워커가 `prs:projected`로 낸다. 그런데 이 워커가
   * 같은 토픽을 구독하므로 그것이 다시 돌아온다. 처리하면 보강 → 발행 → 보강의
   * 무한 루프이고, 그 루프의 유일한 방어선이 이 한 줄이다.
   *
   * 저장소 조회보다 **앞**에 둔다 — 자기 이벤트에 DB 왕복을 쓸 이유가 없다.
   */
  if (name === EVENT_NAMES.commitMetadataReady) return { kind: 'ack' };

  const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  if (repository === undefined) {
    // 등록되지 않은 저장소의 문서는 애초에 만들지 않는다 (FR-ING-009 AC-4).
    return { kind: 'ack' };
  }

  let targets: readonly EnrichTarget[] = [];

  if (name === EVENT_NAMES.sequenceAssigned) {
    const event = payload as unknown as SequenceAssigned;
    targets = await targetsForRange(
      deps,
      repositoryId,
      event.base_branch,
      event.seq_epoch,
      event.from_seq - 1,
      event.to_seq,
    );
  } else if (name === EVENT_NAMES.sequenceReassigned) {
    const event = payload as unknown as SequenceReassigned;
    /*
     * 재채번은 `diverged_at_seq`부터 값이 달라진다. 그 앞은 복사된 구간이라 이미
     * 보강돼 있다 — 전 구간을 다시 도는 것은 낭비이고 GHE 한도를 태운다.
     */
    const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, event.base_branch);
    targets = await targetsForRange(
      deps,
      repositoryId,
      event.base_branch,
      event.new_epoch,
      event.diverged_at_seq - 1,
      Number(space?.head_seq ?? event.diverged_at_seq),
    );
  } else if (name === EVENT_NAMES.ingestionProjected) {
    const event = payload as unknown as IngestionProjected;
    if (event.entity_kind !== 'commit') return { kind: 'ack' };
    // 문서 ID는 `repositoryId:sha`다. 체인 소속을 모르므로 역할은 건드리지 않는다.
    const sha = event.entity_id.slice(event.entity_id.indexOf(':') + 1);
    if (sha === '') return { kind: 'ack' };
    targets = [{ commitSha: sha, firstParent: false, pullRequestNumber: null }];
  } else {
    return { kind: 'ack' };
  }

  if (targets.length === 0) return { kind: 'ack' };

  const outcome = await enrichCommits(deps, repository, targets, delivered.correlation_id);
  log({
    level: 'info',
    message: '커밋 메타데이터 보강',
    repository_id: repositoryId,
    correlation_id: delivered.correlation_id,
    enriched: outcome.enriched,
    skipped: outcome.skipped,
  });
  return { kind: 'ack' };
}

/**
 * `prs:projected`를 **전용 소비자 그룹**으로 구독한다 (CR-038, DEV-205).
 *
 * 관계 파생(WP-029)과 같은 그룹을 쓰면 이벤트가 둘로 나뉘어 각자 절반씩만 본다 —
 * consumer group은 broadcast가 아니라 work sharing이다.
 */
export async function startCommitEnrichWorker(
  deps: CommitEnrichDeps,
  options: SubscribeOptions = {},
): Promise<Subscription> {
  return deps.bus.subscribe(
    TOPICS.projected,
    consumerGroup(TOPICS.projected, COMMIT_ENRICH_CONSUMER),
    (delivered) => handleProjectedEvent(deps, delivered),
    options,
  );
}

export interface CommitEnrichSweeper {
  stop(): Promise<void>;
}

/**
 * 미보강 잔여분 스윕.
 *
 * **주 전달 수단이 아니다** — 이벤트가 놓친 것과 이 잡이 서기 전에 쌓인 과거
 * 데이터를 메우는 보정이다. 저장소 단위로 묶어 그래프를 저장소마다 한 번씩만
 * 만든다.
 */
export async function runCommitEnrichSweep(
  deps: CommitEnrichDeps,
  limit = COMMIT_ENRICH_SWEEP_BATCH,
): Promise<EnrichOutcome> {
  const log = deps.log ?? ((): void => undefined);
  /*
   * 두 종류를 함께 집는다 (CR-038 / PR #42 리뷰):
   *
   * 1. 정본이 아직 없는 커밋 — 이 잡이 서기 전에 쌓인 과거 데이터와 이벤트를 놓친 것
   * 2. 정본은 있으나 **색인 투영이 밀린** 커밋 — Elasticsearch 장애 중에 보강된 것
   *
   * 2를 빼면 장애가 끝나도 그 커밋들이 색인에 영영 나타나지 않는다. 정본이 이미
   * 있으니 1의 조건에는 걸리지 않기 때문이다.
   */
  const missing = await commitSnapshotRepo.listCommitsMissingSnapshot(deps.pool, limit);
  const unprojected = await commitSnapshotRepo.listCommitsMissingProjection(deps.pool, limit);
  const seen = new Set<string>();
  const pending = [...missing, ...unprojected].filter((row) => {
    const key = `${row.repository_id}:${row.commit_sha}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byRepository = new Map<number, EnrichTarget[]>();
  for (const row of pending) {
    const id = Number(row.repository_id);
    const list = byRepository.get(id) ?? [];
    /*
     * `base_branch`가 비었다는 것은 그 커밋이 **현재 에폭의 체인에 없다**는 뜻이다
     * (재채번으로 밀려났거나 원본 커밋). 그때는 역할을 판정하지 않는다 —
     * first-parent라는 근거가 없기 때문이다 (DEV-207).
     */
    const onChain = row.base_branch !== '';
    list.push({
      commitSha: row.commit_sha,
      firstParent: onChain,
      pullRequestNumber: row.pull_request_number,
      ...(onChain ? { baseBranch: row.base_branch } : {}),
    });
    byRepository.set(id, list);
  }

  let enriched = 0;
  let skipped = 0;
  for (const [repositoryId, targets] of byRepository) {
    const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
    if (repository === undefined) continue;
    const outcome = await enrichCommits(deps, repository, targets);
    enriched += outcome.enriched;
    skipped += outcome.skipped;
  }

  if (enriched > 0 || skipped > 0) {
    log({ level: 'info', message: '커밋 보강 스윕', enriched, skipped });
  }
  return { enriched, skipped };
}

/** 주기 스윕. `startReleaseSweeper`와 같은 형태다 (깨울 수 있는 sleep). */
export function startCommitEnrichSweeper(
  deps: CommitEnrichDeps,
  options: { readonly intervalMs?: number } = {},
): CommitEnrichSweeper {
  const interval = options.intervalMs ?? COMMIT_ENRICH_SWEEP_INTERVAL_MS;
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
        await runCommitEnrichSweep(deps);
      } catch (error) {
        log({ level: 'error', message: '커밋 보강 스윕 실패', reason: String(error).slice(0, 200) });
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
