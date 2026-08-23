/**
 * JOB-SEQ-001 시퀀스 증분 채번 (WP-021, FR-SEQ-001, ADR-007).
 *
 * **이 제품의 핵심 주장이 여기서 실재한다.** Perforce Changelist가 주던 것은
 * "번호 순서 = 반영 순서"였고, 그 신뢰의 본질은 번호가 **git 히스토리로 증명
 * 가능하다**는 데 있다. 그래서 이 워커가 하는 일은 한 문장이다 —
 * `git rev-list --first-parent --reverse`가 낸 순서를 그대로 1, 2, 3…으로
 * 옮긴다. 그 이상을 하면 증명 가능성이 깨진다.
 *
 * 지켜야 할 것 여섯:
 *
 * 1. **advisory lock은 트랜잭션 범위다** (AC-6). 트랜잭션이 끝나면 자동
 *    해제되므로 워커가 죽어도 락이 남지 않는다.
 * 2. **락을 얻지 못하면 기다리지 않는다.** 기다리면 워커 슬롯이 묶여 다른
 *    저장소 처리가 밀린다. `defer`로 나중에 다시 온다 (CR-025, DEV-117).
 * 3. **push가 실어 보낸 `head_sha`를 믿지 않는다.** 웹훅이 밀려 도착했으면 그
 *    값은 이미 옛 head이고, 그것으로 채번하면 그 사이 커밋이 통째로 빠진다.
 *    head는 언제나 그래프에서 다시 읽는다.
 * 4. **저장된 head에서만 이어 붙인다** (AC-5). 전체 재순회는 백필의 일이다.
 * 5. **PostgreSQL이 먼저, Elasticsearch가 나중이다.** 색인 반영이 실패해도
 *    시퀀스 값은 살아 있고 다음 회차가 다시 비춘다 (ADR-004).
 * 6. **히스토리 재작성을 여기서 고치지 않는다.** 감지해서 공간을 `stale`로
 *    두고 소리 낸다 — 재채번은 WP-022다. 조용히 다시 번호를 매기면 과거에
 *    인용된 범위가 말없이 다른 것을 가리키게 되는데, 그것이 조사 도구가 할 수
 *    있는 가장 나쁜 실패다 (ADR-007).
 */

import {
  EVENT_NAMES,
  deterministicEventId,
  sequencePartitionKey,
  sequenceSpaceLabel,
  type SequenceAssigned,
  type SequenceReassigned,
  type SequenceRequested,
} from '@prs/domain';
import {
  TOPICS,
  consumerGroup,
  deferUntil,
  type DeliveredEvent,
  type EventBus,
  type EventHandler,
  type HandlerDisposition,
  type SubscribeOptions,
  type Subscription,
} from '@prs/bus';
import {
  auditRepo,
  mergeSequenceRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  trySequenceSpaceLock,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import { applyEpochBump, applySequenceToDocuments, findPullRequestByMergeCommit } from '@prs/es';
import { CommitGraphError, type CommitGraph, type RepoRef } from '@prs/github';
import { randomUUID } from 'node:crypto';
import type { Client } from '@elastic/elasticsearch';
import { isSequenceBranch, numberCommits, type AssignOutcome } from './sequence-plan.js';
import type { WorkerMetrics } from './metrics.js';

export const SEQUENCE_STAGE = 'sequence' as const;

/**
 * 락을 얻지 못했을 때 다시 오기까지 (CR-025, DEV-117).
 *
 * 같은 시퀀스 공간을 다른 워커가 쥐고 있다는 뜻이고, 그 채번은 보통 초 단위로
 * 끝난다. 너무 짧으면 두 워커가 서로를 밀어내며 도는 소리만 내고, 너무 길면
 * 새 커밋의 서수가 늦는다.
 */
export const SEQUENCE_LOCK_RETRY_MS = 5_000;

export interface SequenceLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface SequenceDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly bus: EventBus;
  readonly metrics: WorkerMetrics;
  /** 저장소별로 미러/API 중 무엇을 쓸지 고른 그래프 (ADR-005, `selectCommitGraph`). */
  readonly graphFor: (repository: RepositoryRow) => CommitGraph;
  readonly log?: (fields: SequenceLogFields) => void;
  readonly now?: () => Date;
}

function refOf(repository: RepositoryRow): RepoRef {
  return { owner: repository.owner, repo: repository.name };
}

/**
 * 한 시퀀스 공간을 채번한다.
 *
 * 트랜잭션 하나 안에서 락 → 읽기 → 채번 → head 갱신까지 끝낸다. Elasticsearch
 * 반영과 이벤트 발행은 **커밋 뒤에** 한다 — 트랜잭션 안에서 외부 호출을 하면
 * 그 호출이 느린 동안 락이 잡혀 있고, 롤백되어도 외부 반영은 되돌아오지 않는다.
 */
export async function assignSequence(
  deps: SequenceDeps,
  repositoryId: number,
  baseBranch: string,
  correlationId = '',
): Promise<AssignOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);

  if (repository === undefined) {
    return { kind: 'skipped', reason: 'repository_unregistered' };
  }
  if (repository.status !== 'active') {
    return { kind: 'skipped', reason: 'repository_archived' };
  }
  if (!isSequenceBranch(repository.sequence_branches, baseBranch)) {
    // 채번 대상이 아닌 브랜치의 push다. 실패가 아니다 (FR-ING-009 AC-2).
    return { kind: 'skipped', reason: 'not_sequence_branch' };
  }

  const graph = deps.graphFor(repository);
  const client = await deps.pool.connect();
  let committed: { readonly outcome: AssignOutcome; readonly applied: readonly NumberedEntry[] } | null = null;

  try {
    await client.query('BEGIN');
    const locked = await trySequenceSpaceLock(client, repositoryId, baseBranch);
    if (!locked) {
      await client.query('ROLLBACK');
      return { kind: 'locked' };
    }

    await sequenceSpaceRepo.ensureSequenceSpace(client, repositoryId, baseBranch);
    const space = await sequenceSpaceRepo.findSequenceSpace(client, repositoryId, baseBranch);
    if (space === undefined) {
      await client.query('ROLLBACK');
      return { kind: 'stale', reason: 'sequence_space_missing' };
    }

    const headSeq = Number(space.head_seq);
    let newHead: string | null;
    try {
      newHead = await graph.resolveHead(refOf(repository), baseBranch);
    } catch (error) {
      await client.query('ROLLBACK');
      return await markStale(deps, repositoryId, baseBranch, graphReason(error));
    }

    if (newHead === null) {
      await client.query('ROLLBACK');
      // 대상 브랜치가 아직 없다. 오류가 아니라 "채번할 것이 없음"이다.
      return { kind: 'no_branch' };
    }

    /*
     * 재작성 감지 (ADR-007 규칙 3). 저장된 head가 새 head의 조상이 아니면
     * first-parent 체인이 다시 쓰였다는 뜻이다. **여기서 고치지 않는다** —
     * 재채번은 WP-022이고, 그 전까지는 기존 값을 그대로 두고 소리를 낸다.
     */
    if (space.head_sha !== null && space.head_sha !== newHead) {
      let ancestor: boolean;
      try {
        ancestor = await graph.isAncestor(refOf(repository), space.head_sha, newHead);
      } catch (error) {
        await client.query('ROLLBACK');
        return await markStale(deps, repositoryId, baseBranch, graphReason(error));
      }
      if (!ancestor) {
        /*
         * 재작성이다 (FR-SEQ-005 AC-1). 이 트랜잭션과 락을 **먼저 내려놓고**
         * 재채번으로 넘어간다 — 재채번은 자기 트랜잭션에서 락을 새로 잡고,
         * 그 사이 다른 워커가 끼어들었으면 저장된 head 재검증이 멱등을
         * 보장한다.
         */
        await client.query('ROLLBACK');
        deps.metrics.sequenceRewriteDetected.inc({ repository: String(repositoryId) });
        log({
          level: 'warn',
          message: '히스토리 재작성을 감지했다 — 에폭을 올려 재채번한다 (FR-SEQ-005)',
          repository_id: repositoryId,
          base_branch: baseBranch,
          stored_head: space.head_sha,
          new_head: newHead,
        });
        return await reassignSequence(deps, repository, baseBranch, space.head_sha, newHead, correlationId);
      }
    }

    let commits: readonly { readonly sha: string; readonly committedAt: string }[];
    try {
      commits = await graph.firstParentCommits(refOf(repository), { from: space.head_sha, to: newHead });
    } catch (error) {
      await client.query('ROLLBACK');
      return await markStale(deps, repositoryId, baseBranch, graphReason(error));
    }

    const numbered = numberCommits(headSeq, commits);
    const applied: NumberedEntry[] = [];
    for (const entry of numbered) {
      const prNumber = await findPullRequestNumber(deps, repositoryId, entry.sha);
      await mergeSequenceRepo.upsertMergeSequence(client, {
        repository_id: repositoryId,
        base_branch: baseBranch,
        seq_epoch: space.seq_epoch,
        merge_seq: entry.mergeSeq,
        commit_sha: entry.sha,
        pull_request_number: prNumber,
        committed_at: new Date(entry.committedAt),
      });
      applied.push({ mergeSeq: entry.mergeSeq, sha: entry.sha });
    }

    const toSeq = headSeq + numbered.length;
    await sequenceSpaceRepo.advanceHead(client, repositoryId, baseBranch, newHead, toSeq);
    await client.query('COMMIT');

    committed = {
      outcome: { kind: 'assigned', fromSeq: headSeq, toSeq, headSha: newHead },
      applied,
    };
    // 게이지 갱신은 커밋 뒤에 한다 — 트랜잭션 안에서 세면 자기 변경만 보인다.
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // ---- 커밋 뒤: 색인 반영과 이벤트. 실패해도 시퀀스 값은 이미 살아 있다.
  const { outcome, applied } = committed;
  if (outcome.kind !== 'assigned') return outcome;

  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, baseBranch);
  const epoch = space?.seq_epoch ?? 1;

  if (applied.length > 0) {
    try {
      await applySequenceToDocuments(deps.es, {
        repositoryId,
        baseBranch,
        seqEpoch: epoch,
        sequenceSpace: sequenceSpaceLabel(`${repository.owner}/${repository.name}`, baseBranch),
        assignments: applied.map((entry) => ({ commitSha: entry.sha, mergeSeq: entry.mergeSeq })),
      });
    } catch (error) {
      /*
       * **던지지 않는다.** 시퀀스는 PostgreSQL에 이미 커밋됐고 그것이 정본이다.
       * 여기서 던지면 이벤트가 재전달되어 같은 채번을 다시 돌리는데, 채번은
       * 멱등이라 결과가 같고 색인만 다시 시도된다 — 그럴 바에는 소리를 내고
       * 다음 회차에 맡긴다. 색인은 다음 push나 재색인이 메운다.
       */
      log({
        level: 'error',
        message: '시퀀스를 색인에 반영하지 못했다 — PostgreSQL 값은 살아 있다',
        repository_id: repositoryId,
        base_branch: baseBranch,
        reason: 'sequence_index_failed',
        detail: String(error instanceof Error ? error.message : error).slice(0, 200),
      });
      deps.metrics.sequenceIndexFailed.inc({ repository: String(repositoryId) });
    }
  }

  const payload: SequenceAssigned = {
    repository_id: repositoryId,
    base_branch: baseBranch,
    seq_epoch: epoch,
    from_seq: outcome.fromSeq,
    to_seq: outcome.toSeq,
    head_sha: outcome.headSha,
  };
  /*
   * **`prs:projected`에 싣는다 (CR-025, DEV-121).** 이벤트 카탈로그는
   * EVT-SEQ-001의 소비자를 "project, ops"라 적지만 **어느 스트림이 그것을
   * 나르는지는 어디에도 없다.** `project`가 읽는 `prs:enriched`에 실으면
   * 투영 핸들러가 모양이 다른 payload를 받고, `prs:sequence`에 실으면 채번이
   * 자기 이벤트를 다시 소비한다. 남는 것은 하류 스트림이고, 그것이
   * `prs:projected`다 — EVT-ING-003이 이미 그리로 간다.
   */
  await deps.bus.publish(TOPICS.projected, sequencePartitionKey(repositoryId, baseBranch), {
    event_id: deterministicEventId(
      EVENT_NAMES.sequenceAssigned,
      String(repositoryId),
      baseBranch,
      String(epoch),
      String(outcome.toSeq),
    ),
    event_name: EVENT_NAMES.sequenceAssigned,
    correlation_id: correlationId,
    occurred_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
    payload,
  });

  deps.metrics.sequenceAssigned.inc({ repository: String(repositoryId) }, applied.length);
  await refreshSequenceSpaceStates(deps);
  return outcome;
}

/**
 * JOB-SEQ-002 시퀀스 재채번 (WP-022, FR-SEQ-005, ADR-007).
 *
 * **조용히 다시 번호를 매기는 것과의 차이가 에폭이다.** 재작성 뒤 그냥
 * 덮어쓰면 과거에 인용된 범위가 말없이 다른 커밋을 가리키게 된다 — 조사
 * 도구가 할 수 있는 가장 나쁜 실패다. 에폭을 올리면 이전 인용은 전부
 * "다른 에폭의 값"이 되어, 조회가 `epoch_stale`로 표시할 수 있다 (AC-4).
 * 표식·세션·인용 쪽에는 **아무것도 쓰지 않는다** — 그들이 저장한 에폭과
 * 현재 에폭의 비교가 곧 무효 판정이다 (CR-026, DEV-126).
 *
 * 순서가 곧 안전이다:
 *
 * 1. `reassigning` 표시를 **먼저 따로 커밋**한다. 본 작업은 트랜잭션
 *    하나라 그 안의 상태 변경은 커밋 전까지 아무도 못 본다 — 예외 처리
 *    ("재채번 중 조회는 마지막 확정 값 + `reassigning`")가 성립하려면
 *    표시가 밖에 있어야 한다.
 * 2. 본 작업은 트랜잭션 하나다. 실패하면 통째로 롤백되므로 **부분 채번
 *    상태가 남지 않는다** (DoD). 이전 에폭 행은 지우지 않는다 — 남아
 *    있어야 이전 인용을 해석할 수 있고, 지울 이유도 없다.
 * 3. merge-base까지는 **복사**한다 (DEV-124). 값이 같을 뿐 아니라
 *    `pull_request_number`처럼 나중에 채워진 값을 잃지 않는다.
 * 4. merge-base가 체인 밖이면 **처음부터 전부** 다시 건다 (DEV-125).
 *    first-parent walk가 결정론이라 히스토리가 같은 구간은 같은 서수가
 *    재현된다 — 복사는 최적화지 정확성의 조건이 아니다.
 */
export async function reassignSequence(
  deps: SequenceDeps,
  repository: RepositoryRow,
  baseBranch: string,
  storedHead: string,
  newHead: string,
  correlationId = '',
): Promise<AssignOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const repositoryId = repository.repository_id;
  const graph = deps.graphFor(repository);

  // 1단계: 밖에서 보이는 상태. 본 트랜잭션과 별개로 커밋된다.
  await sequenceSpaceRepo.markReassigning(deps.pool, repositoryId, baseBranch);

  const client = await deps.pool.connect();
  let committed: {
    readonly outcome: Extract<AssignOutcome, { kind: 'reassigned' }>;
    readonly applied: readonly NumberedEntry[];
    readonly label: string;
  };

  try {
    await client.query('BEGIN');
    const locked = await trySequenceSpaceLock(client, repositoryId, baseBranch);
    if (!locked) {
      await client.query('ROLLBACK');
      // 다른 워커가 쥐고 있다. 감지 사실은 남기고 다음 회차가 잇는다.
      return { kind: 'rewritten', storedHead, newHead };
    }

    const space = await sequenceSpaceRepo.findSequenceSpace(client, repositoryId, baseBranch);
    if (space === undefined) {
      await client.query('ROLLBACK');
      return await markStale(deps, repositoryId, baseBranch, 'sequence_space_missing');
    }
    if (space.head_sha !== storedHead) {
      /*
       * 락을 다시 잡는 사이 다른 워커가 이미 처리했다. 지금의 재작성 판정은
       * 옛 head 기준이므로 여기서 이어 가면 안 된다 — 다음 push가 현재
       * 상태로 다시 판정한다.
       */
      await client.query('ROLLBACK');
      return { kind: 'skipped', reason: 'head_moved' };
    }

    const oldEpoch = space.seq_epoch;

    // merge-base와 그 서수. 체인 밖이거나 공통 조상이 없으면 전체 재채번이다.
    let baseSeq = 0;
    let baseSha: string | null = null;
    try {
      baseSha = await graph.mergeBase(refOf(repository), storedHead, newHead);
    } catch (error) {
      await client.query('ROLLBACK');
      return await markStale(deps, repositoryId, baseBranch, graphReason(error));
    }
    if (baseSha !== null) {
      const found = await mergeSequenceRepo.findSeqByCommit(client, repositoryId, baseBranch, oldEpoch, baseSha);
      if (found === null) {
        // DEV-125: merge-base가 first-parent 체인 밖이다. 소리 내고 전체로 간다.
        log({
          level: 'warn',
          message: 'merge-base가 first-parent 체인에 없다 — 처음부터 전체 재채번한다',
          repository_id: repositoryId,
          base_branch: baseBranch,
          merge_base: baseSha,
          reason: 'merge_base_off_chain',
        });
        baseSha = null;
      } else {
        baseSeq = found;
      }
    }

    const affectedCount = await mergeSequenceRepo.countAbove(client, repositoryId, baseBranch, oldEpoch, baseSeq);
    const newEpoch = await sequenceSpaceRepo.bumpEpoch(client, repositoryId, baseBranch);

    if (baseSeq > 0) {
      await mergeSequenceRepo.copySequencesUpTo(client, repositoryId, baseBranch, oldEpoch, newEpoch, baseSeq);
    }

    let commits: readonly { readonly sha: string; readonly committedAt: string }[];
    try {
      commits = await graph.firstParentCommits(refOf(repository), { from: baseSha, to: newHead });
    } catch (error) {
      await client.query('ROLLBACK');
      return await markStale(deps, repositoryId, baseBranch, graphReason(error));
    }

    const numbered = numberCommits(baseSeq, commits);
    const applied: NumberedEntry[] = [];
    for (const entry of numbered) {
      const prNumber = await findPullRequestNumber(deps, repositoryId, entry.sha);
      await mergeSequenceRepo.upsertMergeSequence(client, {
        repository_id: repositoryId,
        base_branch: baseBranch,
        seq_epoch: newEpoch,
        merge_seq: entry.mergeSeq,
        commit_sha: entry.sha,
        pull_request_number: prNumber,
        committed_at: new Date(entry.committedAt),
      });
      applied.push({ mergeSeq: entry.mergeSeq, sha: entry.sha });
    }

    const toSeq = baseSeq + numbered.length;
    await sequenceSpaceRepo.advanceHead(client, repositoryId, baseBranch, newHead, toSeq);
    await client.query('COMMIT');

    committed = {
      outcome: {
        kind: 'reassigned',
        oldEpoch,
        newEpoch,
        divergedAtSeq: baseSeq + 1,
        toSeq,
        headSha: newHead,
        affectedCount,
      },
      applied,
      label: sequenceSpaceLabel(`${repository.owner}/${repository.name}`, baseBranch),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    /*
     * 트랜잭션이 통째로 롤백됐다 — 부분 채번 상태는 없다 (DoD). JOB-SEQ-002는
     * **재시도하지 않는다** (잡 카탈로그: "없음 (실패 시 stale)") — 던져서 버스
     * 재전달을 부르는 대신 `stale`로 소리 내고 끝낸다. 다음 push가 다시 재작성을
     * 감지하면 그때 다시 시도된다.
     */
    return await markStale(deps, repositoryId, baseBranch, graphReason(error));
  } finally {
    client.release();
  }

  /*
   * ---- 커밋 뒤: 색인·이벤트·감사. **트랜잭션 try 밖이다** — 여기서 무엇이
   * 실패해도 재채번 자체는 이미 성공했고 PostgreSQL 값이 정본이다 (ADR-004).
   * 이 실패로 공간을 `stale`로 표시하면 성공한 재채번이 실패로 읽힌다.
   */
  const { outcome, applied, label } = committed;

  log({
    level: 'warn',
    message: '재채번을 마쳤다 — 이전 에폭 인용은 조회 시 epoch_stale로 표시된다',
    repository_id: repositoryId,
    base_branch: baseBranch,
    old_epoch: outcome.oldEpoch,
    new_epoch: outcome.newEpoch,
    diverged_at_seq: outcome.divergedAtSeq,
    affected_count: outcome.affectedCount,
  });

  try {
    await applyEpochBump(deps.es, {
      repositoryId,
      baseBranch,
      newEpoch: outcome.newEpoch,
      sequenceSpace: label,
    });
    await applySequenceToDocuments(deps.es, {
      repositoryId,
      baseBranch,
      seqEpoch: outcome.newEpoch,
      sequenceSpace: label,
      assignments: applied.map((entry) => ({ commitSha: entry.sha, mergeSeq: entry.mergeSeq })),
    });
  } catch (error) {
    log({
      level: 'error',
      message: '재채번 결과를 색인에 반영하지 못했다 — PostgreSQL 값은 살아 있다',
      repository_id: repositoryId,
      base_branch: baseBranch,
      reason: 'sequence_index_failed',
      detail: String(error instanceof Error ? error.message : error).slice(0, 200),
    });
    deps.metrics.sequenceIndexFailed.inc({ repository: String(repositoryId) });
  }

  try {
    const payload: SequenceReassigned = {
      repository_id: repositoryId,
      base_branch: baseBranch,
      old_epoch: outcome.oldEpoch,
      new_epoch: outcome.newEpoch,
      diverged_at_seq: outcome.divergedAtSeq,
      affected_count: outcome.affectedCount,
    };
    await deps.bus.publish(TOPICS.projected, sequencePartitionKey(repositoryId, baseBranch), {
      event_id: deterministicEventId(
        EVENT_NAMES.sequenceReassigned,
        String(repositoryId),
        baseBranch,
        String(outcome.oldEpoch),
        String(outcome.newEpoch),
      ),
      event_name: EVENT_NAMES.sequenceReassigned,
      correlation_id: correlationId,
      occurred_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
      payload,
    });
  } catch {
    log({
      level: 'error',
      message: 'EVT-SEQ-002 발행 실패 — 알림·투영 소비자가 이 재채번을 놓친다',
      repository_id: repositoryId,
      reason: 'event_publish_failed',
    });
  }

  /*
   * 감사 기록 (AC-5). 자동 감지 경로라 사람이 없다 — 신원을 지어내지 않고
   * `system:sequence`로 "시스템이 했다"는 사실 자체를 남긴다 (CR-026,
   * DEV-127). 저장 실패가 재채번을 되돌리지는 않는다 (FR-AUTH-004 예외).
   */
  try {
    /*
     * `audit_record.correlation_id`는 **uuid 타입**이다. push 경로의
     * correlation은 게이트웨이가 만든 uuid라 그대로 쓰지만, 직접 호출처럼
     * correlation이 없는 경로에서 빈 문자열을 넣으면 INSERT가 던지고 —
     * catch가 삼켜 — **감사 기록이 조용히 사라진다** (시험이 잡은 결함이다).
     * 열쇠가 없을 때 새 uuid는 아무것도 잇지 않으므로 "연결 없음"과 같다 —
     * NOT NULL uuid 제약 아래 가장 정직한 표현이다.
     */
    const auditCorrelation = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlationId)
      ? correlationId
      : randomUUID();
    await auditRepo.recordAudit(deps.pool, {
      userId: 'system:sequence',
      action: 'sequence.reassign',
      target: `${repository.owner}/${repository.name}@${baseBranch}`,
      resultCode: 'ok',
      correlationId: auditCorrelation,
    });
  } catch {
    log({
      level: 'error',
      message: '재채번 감사 기록 저장 실패',
      repository_id: repositoryId,
      reason: 'audit_write_failed',
    });
  }

  deps.metrics.sequenceReassignTotal.inc({ repository: String(repositoryId) });
  await refreshSequenceSpaceStates(deps);
  return outcome;
}

interface NumberedEntry {
  readonly mergeSeq: number;
  readonly sha: string;
}

/**
 * 이 커밋이 어느 PR의 머지 커밋인가 (CR-025, DEV-118).
 *
 * PR↔머지 커밋 대응은 PostgreSQL에 없다 — PR 테이블 자체가 없고 색인 문서의
 * `merge_commit_sha`만 있다. 찾지 못하면 `null`이고, 그것은 **직접 푸시이거나
 * 아직 그 PR이 투영되지 않았다**는 뜻이다. 둘을 여기서 가르지 않는다: 어느
 * 쪽이든 지금은 모르는 것이고, 나중에 알게 되면 `COALESCE` upsert가 채운다
 * (FR-SEQ-001 AC-3).
 */
async function findPullRequestNumber(
  deps: SequenceDeps,
  repositoryId: number,
  sha: string,
): Promise<number | null> {
  try {
    return await findPullRequestByMergeCommit(deps.es, repositoryId, sha);
  } catch {
    /*
     * 조회가 실패해도 채번은 멈추지 않는다. 서수가 이 제품의 핵심이고 PR 연결은
     * 그 위의 편의값이다 — 조회 실패로 서수를 미루면 핵심이 부수적인 것에
     * 인질로 잡힌다. `null`로 두면 다음 회차가 `COALESCE`로 채운다.
     */
    return null;
  }
}

function graphReason(error: unknown): string {
  if (error instanceof CommitGraphError) return `graph_${error.kind}:${error.message}`.slice(0, 200);
  return String(error instanceof Error ? error.message : error).slice(0, 200);
}

/**
 * 시퀀스 공간을 `stale`로 둔다 (FR-SEQ-001 예외 처리).
 *
 * **기존 시퀀스 값은 건드리지 않는다.** 읽지 못했다는 것과 값이 틀렸다는 것은
 * 다르고, 지우면 그 사이 모든 범위 인용이 죽는다.
 */
async function markStale(
  deps: SequenceDeps,
  repositoryId: number,
  baseBranch: string,
  reason: string,
): Promise<AssignOutcome> {
  await sequenceSpaceRepo.markStale(deps.pool, repositoryId, baseBranch, reason);
  await refreshSequenceSpaceStates(deps);
  (deps.log ?? ((): void => undefined))({
    level: 'warn',
    message: '시퀀스 공간을 stale로 표시했다 — 기존 값은 보존한다',
    repository_id: repositoryId,
    base_branch: baseBranch,
    reason,
  });
  return { kind: 'stale', reason };
}

/** `prs:sequence` 한 건 처리. */
export async function handleSequenceEvent(
  deps: SequenceDeps,
  event: DeliveredEvent,
): Promise<HandlerDisposition> {
  const payload = event.payload as Partial<SequenceRequested> | undefined;
  const repositoryId = payload?.repository_id;
  const baseBranch = payload?.base_branch;

  if (typeof repositoryId !== 'number' || typeof baseBranch !== 'string' || baseBranch === '') {
    // 모양이 틀린 이벤트는 재시도해도 같다. 소리를 내고 버린다.
    (deps.log ?? ((): void => undefined))({
      level: 'error',
      message: '채번 이벤트의 모양이 틀렸다',
      reason: 'malformed_sequence_event',
    });
    return { kind: 'ack' };
  }

  const outcome = await assignSequence(deps, repositoryId, baseBranch, event.correlation_id);
  if (outcome.kind === 'locked') {
    const now = (deps.now ?? ((): Date => new Date()))();
    return deferUntil(new Date(now.getTime() + SEQUENCE_LOCK_RETRY_MS), 'sequence_space_locked');
  }
  return { kind: 'ack' };
}

export interface StartSequenceOptions {
  readonly subscribe?: SubscribeOptions;
}

/** `prs:sequence` 소비를 시작한다. */
export async function startSequenceWorker(
  deps: SequenceDeps,
  options: StartSequenceOptions = {},
): Promise<Subscription> {
  const handler: EventHandler = async (event) => handleSequenceEvent(deps, event);
  return deps.bus.subscribe(
    TOPICS.sequence,
    consumerGroup(TOPICS.sequence),
    handler,
    options.subscribe ?? {},
  );
}

/**
 * 상태별 공간 수를 세어 게이지를 통째로 바꾼다 (관측 문서 RB-10).
 *
 * **`set(1)`로 올리지 않는다.** 그러면 한 번 `stale`이 된 공간이 복구된 뒤에도
 * 그 라벨이 1로 남아 P2 경보가 영원히 울리고, 아무도 그 경보를 믿지 않게 된다.
 * 매번 세는 비용은 `GROUP BY` 한 번이며 공간 수는 저장소 수 규모다.
 */
export async function refreshSequenceSpaceStates(deps: SequenceDeps): Promise<void> {
  try {
    const counts = await sequenceSpaceRepo.countByState(deps.pool);
    deps.metrics.sequenceSpaceState.replace(
      Object.entries(counts).map(([state, value]) => ({ labels: { state }, value })),
    );
  } catch {
    // 지표 갱신 실패로 채번을 실패시키지 않는다. 다음 회차가 다시 센다.
  }
}
