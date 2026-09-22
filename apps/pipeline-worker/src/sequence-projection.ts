/**
 * 머지 시퀀스의 정본 해석과 재투영 서비스 (CR-113 / WP-098, FR-SEQ-001 AC-7·AC-8, JOB-SEQ-006).
 *
 * ## 한 해석, 한 쓰기
 *
 * 채번 직후·재채번·수동 복구·늦은 PR 스냅숏·커밋 문서 생성·재색인 replay·운영자 재투영이
 * **전부 이 파일을 지난다.** 정본(PostgreSQL)에서 "어느 문서에 몇 번을 쓰는가"를 푸는 곳이
 * 하나여야 경로마다 다른 답을 내지 않는다. 쓰기는 `@prs/es`의 문서 단위 투영기
 * (`projectSequenceToDocuments`)뿐이다.
 *
 * ## 재투영은 재채번이 아니다
 *
 * 이 파일은 PostgreSQL에 **쓰지 않는다** — `merge_sequence`·`sequence_space`는 읽기만 한다.
 * 유일한 쓰기는 `sequence_work`의 문서 단위 의도(`requestWorkBatch`)이며 그것도 러너가
 * 정본을 다시 읽어 처리한다. dry-run은 그것마저 하지 않는다.
 *
 * ## 대상은 정본이 정한다
 *
 * - PR 문서: `pull_request_snapshot`의 `merge_commit_sha`가 이 서수의 SHA이고 `base_branch`가
 *   이 공간의 브랜치인 PR. `merge_sequence.pull_request_number`는 보지 않는다 — 채번 시점에
 *   몰랐던 PR이 그 열 때문에 영원히 빠지지 않게 한다. 후보가 둘 이상이면 매핑 충돌이라 쓰지 않는다.
 * - 커밋 문서: 보강이 실제로 만든 문서(`commit_snapshot.projected_at`) 또는 PR 투영이 머지
 *   커밋으로 만든 문서. 스냅숏만 있고 아직 만들어지지 않은 문서는 **생성 대기**이지 누락이
 *   아니다 — 보강이 문서를 만들 때 이 서비스를 인라인으로 불러 채운다.
 * - 둘 다 없는 서수(직접 푸시인데 아직 보강 전, 미수집 PR)는 대상이 없는 것이다. 없는 PR
 *   문서를 만들거나 무의미하게 재시도하지 않는다.
 *
 * ## 같은 SHA, 다른 공간
 *
 * 커밋 문서는 SHA당 하나다. 문서가 다른 `base_branch`를 달고 있으면 정본에 "그 브랜치의
 * 현재 에폭에 이 SHA가 있는가"를 묻고, 있으면 그 공간의 값을 지킨다(`other_space`). 없으면
 * (재작성으로 체인에서 빠졌거나 채번 대상에서 빠진 브랜치) 이 공간이 가져간다(`reclaim`).
 */

import type { Client } from '@elastic/elasticsearch';
import { commitDocId, pullRequestDocId, sequenceSpaceLabel } from '@prs/domain';
import {
  repositoryRepo,
  sequenceProjectionRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  withReindexWrite,
  type Pool,
  type PoolClient,
  type ProjectionTargetRow,
  type RepositoryRow,
  type SequenceWorkRow,
} from '@prs/db';
import {
  aliasOf,
  classifySequenceTarget,
  isSettledOutcome,
  projectSequenceToDocuments,
  readSequenceOrder,
  readSequenceProjection,
  type ObservedSequenceFields,
  type SequenceDocKind,
  type SequenceDocOutcome,
  type SequenceProjectionIndexResult,
  type SequenceProjectionItem,
  type SequenceProjectionResult,
} from '@prs/es';
import type { WriteTargets } from '@prs/es';

export interface ProjectionLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface ProjectionDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly log?: (fields: ProjectionLogFields) => void;
  readonly now?: () => Date;
}

/** 한 시퀀스 공간과 그 표시 라벨. */
export interface ProjectionSpace {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly sequenceSpace: string;
}

/**
 * 어느 문서를 "있어야 한다"고 볼 것인가.
 *
 * - `live`: 보강이 실제로 만든 커밋 문서만. 스냅숏만 있는 커밋은 생성 대기다.
 * - `reindex`: 재구축이 `commit_snapshot` 행마다 문서를 만들므로 스냅숏이 있으면 있어야 한다.
 */
export type TargetPolicy = 'live' | 'reindex';

export type SkipReason = 'awaiting_creation' | 'no_target' | 'mapping_conflict' | 'other_space';

export interface SkippedTarget {
  readonly kind: SequenceDocKind;
  readonly docId: string;
  readonly mergeSeq: number;
  readonly reason: SkipReason;
}

export interface ResolvedTargets {
  readonly items: readonly SequenceProjectionItem[];
  readonly skipped: readonly SkippedTarget[];
}

/** 한 페이지의 항목 수. 정본 읽기·`mget`·bulk가 모두 이 단위다. */
export const PROJECTION_PAGE = 500;
/** 공간 단위 work가 lease 하나에서 처리하는 페이지 수. 넘으면 `continue`로 돌려준다. */
export const PROJECTION_PAGES_PER_CLAIM = 20;

function logOf(deps: ProjectionDeps): (fields: ProjectionLogFields) => void {
  return deps.log ?? ((): void => undefined);
}

export function spaceOf(repository: RepositoryRow, baseBranch: string, seqEpoch: number): ProjectionSpace {
  return {
    repositoryId: repository.repository_id,
    baseBranch,
    seqEpoch,
    sequenceSpace: sequenceSpaceLabel(`${repository.owner}/${repository.name}`, baseBranch),
  };
}

/** 정본 행들을 투영 항목으로 옮긴다. PostgreSQL만 본다. */
export function resolveTargets(
  space: ProjectionSpace,
  rows: readonly ProjectionTargetRow[],
  policy: TargetPolicy,
  kinds: readonly SequenceDocKind[] = ['commit', 'pull_request'],
): ResolvedTargets {
  const items: SequenceProjectionItem[] = [];
  const skipped: SkippedTarget[] = [];
  const wantCommit = kinds.includes('commit');
  const wantPr = kinds.includes('pull_request');

  for (const row of rows) {
    const sha = row.commit_sha.toLowerCase();
    const base = {
      repositoryId: space.repositoryId,
      baseBranch: space.baseBranch,
      seqEpoch: space.seqEpoch,
      sequenceSpace: space.sequenceSpace,
      expectedSha: sha,
      mergeSeq: row.merge_seq,
    };

    if (wantPr) {
      if (row.pr_numbers.length === 1) {
        const prNumber = row.pr_numbers[0] as number;
        items.push({ kind: 'pull_request', docId: pullRequestDocId(space.repositoryId, prNumber), ...base });
      } else if (row.pr_numbers.length > 1) {
        for (const prNumber of row.pr_numbers) {
          skipped.push({ kind: 'pull_request', docId: pullRequestDocId(space.repositoryId, prNumber), mergeSeq: row.merge_seq, reason: 'mapping_conflict' });
        }
      } else {
        // 직접 푸시이거나 아직 수집·연결되지 않은 PR이다. 둘을 여기서 가르지 않는다 — 어느 쪽이든 지금은 대상이 없다.
        skipped.push({ kind: 'pull_request', docId: `${String(space.repositoryId)}:seq:${String(row.merge_seq)}`, mergeSeq: row.merge_seq, reason: 'no_target' });
      }
    }

    if (wantCommit) {
      const docId = commitDocId(space.repositoryId, sha);
      const hasPrDoc = row.pr_numbers.length > 0;
      const expected = policy === 'reindex' ? row.commit_snapshot_exists || hasPrDoc : row.commit_projected || hasPrDoc;
      if (expected) {
        items.push({ kind: 'commit', docId, ...base });
      } else if (row.commit_snapshot_exists) {
        skipped.push({ kind: 'commit', docId, mergeSeq: row.merge_seq, reason: 'awaiting_creation' });
      } else {
        skipped.push({ kind: 'commit', docId, mergeSeq: row.merge_seq, reason: 'no_target' });
      }
    }
  }
  return { items, skipped };
}

export interface PageOutcome {
  /** 서비스 인덱스에서 끝난 항목(`updated`·`noop`). */
  readonly settled: readonly SequenceDocOutcome[];
  /** 아직 끝나지 않은 항목 — 문서가 없거나 색인이 정본을 따라오지 못했거나 일시 실패. 문서 단위 work의 재료다. */
  readonly pending: readonly { readonly item: SequenceProjectionItem; readonly outcome: SequenceDocOutcome }[];
  /** 옛 에폭 작업이었다 — 호출 측은 즉시 멈춘다. */
  readonly staleEpoch: readonly SequenceDocOutcome[];
  /** 정본이 대상이 아니라고 한 것. 완료다. */
  readonly skipped: readonly SkippedTarget[];
  /** dry-run에서 썼을 항목. */
  readonly wouldUpdate: readonly SequenceDocOutcome[];
  /** 원시 결과. shadow 판정(재색인 replay)이 쓴다. */
  readonly raw: SequenceProjectionResult;
}

/**
 * 항목들을 한 번 비춘다 — 서비스 결과로 판정하고, 커밋 문서의 브랜치 충돌은 정본으로 다시
 * 물어 `reclaim`하거나 `other_space`로 접는다. `targets`를 넘기면 그 울타리 안에서(재색인
 * replay), 없으면 스스로 울타리를 잡는다.
 */
export async function projectItems(
  deps: ProjectionDeps,
  space: ProjectionSpace,
  resolved: ResolvedTargets,
  options: { readonly dryRun?: boolean; readonly targets?: WriteTargets } = {},
): Promise<PageOutcome> {
  const write = async (items: readonly SequenceProjectionItem[]): Promise<SequenceProjectionResult> => {
    if (items.length === 0) return { served: {}, shadows: {} };
    const dry = options.dryRun === true ? { dryRun: true } : {};
    if (options.targets !== undefined) return projectSequenceToDocuments(deps.es, items, options.targets, dry);
    return withReindexWrite(deps.pool, (targets) => projectSequenceToDocuments(deps.es, items, targets, dry));
  };

  const first = await write(resolved.items);
  const byId = new Map(resolved.items.map((item) => [item.docId, item]));
  const servedOutcomes = (result: SequenceProjectionResult): SequenceDocOutcome[] =>
    Object.values(result.served).flatMap((one) => one.outcomes);

  const settled: SequenceDocOutcome[] = [];
  const pending: { item: SequenceProjectionItem; outcome: SequenceDocOutcome }[] = [];
  const staleEpoch: SequenceDocOutcome[] = [];
  const wouldUpdate: SequenceDocOutcome[] = [];
  const skipped: SkippedTarget[] = [...resolved.skipped];
  const branchConflicts: { item: SequenceProjectionItem; observed: ObservedSequenceFields }[] = [];

  const absorb = (outcome: SequenceDocOutcome, allowConflictProbe: boolean): void => {
    const item = byId.get(outcome.docId);
    if (item === undefined) return;
    if (isSettledOutcome(outcome.kind)) {
      settled.push(outcome);
    } else if (outcome.kind === 'would_update') {
      wouldUpdate.push(outcome);
    } else if (outcome.kind === 'stale_epoch') {
      staleEpoch.push(outcome);
    } else if (
      allowConflictProbe &&
      item.kind === 'commit' &&
      outcome.kind === 'guard_rejected' &&
      outcome.reason === 'branch' &&
      outcome.observed !== undefined &&
      outcome.observed.base_branch !== null
    ) {
      branchConflicts.push({ item, observed: outcome.observed });
    } else {
      pending.push({ item, outcome });
    }
  };
  for (const outcome of servedOutcomes(first)) absorb(outcome, true);

  /*
   * 커밋 문서가 다른 브랜치를 달고 있다. 그 브랜치의 현재 에폭 체인에 이 SHA가 있으면 그
   * 공간의 서수를 지키고(`other_space`), 없으면 이 공간이 가져간다.
   */
  let second: SequenceProjectionResult = { served: {}, shadows: {} };
  if (branchConflicts.length > 0) {
    const holders = await sequenceProjectionRepo.listSpacesHoldingCommits(
      deps.pool,
      space.repositoryId,
      branchConflicts.map((one) => ({ baseBranch: one.observed.base_branch as string, commitSha: one.item.expectedSha })),
    );
    const reclaim: SequenceProjectionItem[] = [];
    for (const one of branchConflicts) {
      const key = sequenceProjectionRepo.spaceCommitKey(one.observed.base_branch as string, one.item.expectedSha);
      if (holders.has(key)) {
        skipped.push({ kind: 'commit', docId: one.item.docId, mergeSeq: one.item.mergeSeq, reason: 'other_space' });
      } else {
        reclaim.push({ ...one.item, reclaim: true });
      }
    }
    if (reclaim.length > 0) {
      second = await write(reclaim);
      for (const outcome of servedOutcomes(second)) absorb(outcome, false);
    }
  }

  const raw: SequenceProjectionResult = mergeResults(first, second);
  return { settled, pending, staleEpoch, skipped, wouldUpdate, raw };
}

function mergeResults(a: SequenceProjectionResult, b: SequenceProjectionResult): SequenceProjectionResult {
  const merge = (
    x: Readonly<Record<string, SequenceProjectionIndexResult>>,
    y: Readonly<Record<string, SequenceProjectionIndexResult>>,
  ): Record<string, SequenceProjectionIndexResult> => {
    const out: Record<string, SequenceProjectionIndexResult> = { ...x };
    for (const [alias, result] of Object.entries(y)) {
      const prior = out[alias];
      if (prior === undefined) {
        out[alias] = result;
        continue;
      }
      // 두 번째 쓰기(reclaim)가 같은 문서를 다시 판정했다 — 뒤의 결과가 앞의 것을 대신한다.
      const replaced = new Map(prior.outcomes.map((one) => [one.docId, one]));
      for (const one of result.outcomes) replaced.set(one.docId, one);
      const outcomes = [...replaced.values()];
      const counts = { updated: 0, noop: 0, would_update: 0, document_missing: 0, guard_rejected: 0, stale_epoch: 0, transient: 0 };
      for (const one of outcomes) counts[one.kind] += 1;
      out[alias] = { index: prior.index, outcomes, counts };
    }
    return out;
  };
  return { served: merge(a.served, b.served), shadows: merge(a.shadows, b.shadows) };
}

/** 문서 단위 work를 남긴다. `pending`은 문서마다 한 행이고 같은 키가 있으면 generation만 오른다. */
export async function requestDocWork(
  db: Pool | PoolClient,
  space: ProjectionSpace,
  pending: readonly { readonly item: SequenceProjectionItem }[],
  trigger: string,
): Promise<number> {
  if (pending.length === 0) return 0;
  return sequenceWorkRepo.requestWorkBatch(
    db,
    pending.map(({ item }) => docWorkRequest(space, item.kind, item.kind === 'commit' ? item.expectedSha : Number(item.docId.slice(item.docId.indexOf(':') + 1)), trigger)),
  );
}

/** 문서 단위 work 하나의 요청 형태. 늦은 스냅숏·보강 훅도 이것을 쓴다. */
export function docWorkRequest(
  space: Pick<ProjectionSpace, 'repositoryId' | 'baseBranch' | 'seqEpoch'>,
  kind: SequenceDocKind,
  target: number | string,
  trigger: string,
): Parameters<typeof sequenceWorkRepo.requestWorkBatch>[1][number] {
  return kind === 'commit'
    ? {
        kind: 'project',
        repositoryId: space.repositoryId,
        baseBranch: space.baseBranch,
        seqEpoch: space.seqEpoch,
        keyExtra: ['commit', String(target).toLowerCase()],
        payload: { scope: 'doc', kind: 'commit', commit_sha: String(target).toLowerCase(), trigger_kind: trigger },
      }
    : {
        kind: 'project',
        repositoryId: space.repositoryId,
        baseBranch: space.baseBranch,
        seqEpoch: space.seqEpoch,
        keyExtra: ['pr', Number(target)],
        payload: { scope: 'doc', kind: 'pull_request', pr_number: Number(target), trigger_kind: trigger },
      };
}

/** 공간 단위 work의 요청 형태 — `tail`(채번 뒤 증분) 또는 `full`(전체 sweep). */
export function spaceWorkRequest(
  space: Pick<ProjectionSpace, 'repositoryId' | 'baseBranch' | 'seqEpoch'>,
  scope: 'tail' | 'full',
  payload: Readonly<Record<string, unknown>>,
): Parameters<typeof sequenceWorkRepo.requestWork>[1] {
  return {
    kind: 'project',
    repositoryId: space.repositoryId,
    baseBranch: space.baseBranch,
    seqEpoch: space.seqEpoch,
    ...(scope === 'full' ? { keyExtra: ['full'] } : {}),
    payload: { scope, ...payload },
  };
}

async function loadSpace(deps: ProjectionDeps, repositoryId: number, baseBranch: string): Promise<{ repository: RepositoryRow; space: ProjectionSpace } | undefined> {
  const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  if (repository === undefined) return undefined;
  const row = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, baseBranch);
  if (row === undefined) return undefined;
  return { repository, space: spaceOf(repository, baseBranch, row.seq_epoch) };
}

/* ------------------------------------------------------------------------- */
/* 인라인 경로 — 채번 직후·커밋 문서 생성 직후                                    */
/* ------------------------------------------------------------------------- */

export interface RangeProjectionSummary {
  readonly settled: number;
  readonly pending: number;
  readonly skipped: number;
  readonly staleEpoch: number;
}

/**
 * 채번 직후 새 구간 `(from, to]`를 비춘다. 실패는 던지지 않고 요약만 돌려준다 — 같은
 * 트랜잭션이 남긴 `tail` work가 durable 재시도를 맡는다.
 */
export async function projectSequenceRange(
  deps: ProjectionDeps,
  repository: RepositoryRow,
  input: { readonly baseBranch: string; readonly seqEpoch: number; readonly fromExclusive: number; readonly toInclusive: number },
): Promise<RangeProjectionSummary> {
  const space = spaceOf(repository, input.baseBranch, input.seqEpoch);
  const rows = await sequenceProjectionRepo.listProjectionTargetsInRange(deps.pool, {
    repositoryId: space.repositoryId,
    baseBranch: space.baseBranch,
    seqEpoch: space.seqEpoch,
    fromExclusive: input.fromExclusive,
    toInclusive: input.toInclusive,
  });
  const page = await projectItems(deps, space, resolveTargets(space, rows, 'live'));
  return { settled: page.settled.length, pending: page.pending.length, skipped: page.skipped.length, staleEpoch: page.staleEpoch.length };
}

export type SingleTargetOutcome =
  | { readonly kind: 'settled' }
  | { readonly kind: 'pending'; readonly reason: string }
  | { readonly kind: 'no_target' }
  | { readonly kind: 'other_space' }
  | { readonly kind: 'stale_epoch' };

/**
 * 커밋 문서 하나를 비춘다 — 보강이 문서를 만든 직후 부른다. 이 SHA가 현재 에폭 체인에
 * 없으면 `no_target`이다(체인 밖 커밋·아직 채번 전).
 */
export async function projectSingleCommit(
  deps: ProjectionDeps,
  repository: RepositoryRow,
  baseBranch: string,
  commitSha: string,
  options: { readonly targets?: WriteTargets } = {},
): Promise<SingleTargetOutcome> {
  const row = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
  if (row === undefined) return { kind: 'no_target' };
  const space = spaceOf(repository, baseBranch, row.seq_epoch);
  const target = await sequenceProjectionRepo.findProjectionTargetBySha(deps.pool, {
    repositoryId: space.repositoryId,
    baseBranch: space.baseBranch,
    seqEpoch: space.seqEpoch,
    commitSha,
  });
  if (target === undefined) return { kind: 'no_target' };
  // 방금 만든 문서다 — 정본의 `projected_at`이 아직 찍히지 않았어도 있어야 한다고 본다.
  const resolved = resolveTargets(space, [{ ...target, commit_projected: true }], 'live', ['commit']);
  return judgeSingle(await projectItems(deps, space, resolved, options));
}

/** PR 문서 하나를 비춘다 — 문서 단위 work가 부른다. 스냅숏이 지금 무엇을 말하는지 다시 읽는다. */
export async function projectSinglePullRequest(
  deps: ProjectionDeps,
  repository: RepositoryRow,
  baseBranch: string,
  prNumber: number,
  options: { readonly targets?: WriteTargets } = {},
): Promise<SingleTargetOutcome> {
  const row = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
  if (row === undefined) return { kind: 'no_target' };
  const space = spaceOf(repository, baseBranch, row.seq_epoch);
  const facts = await sequenceProjectionRepo.findPullRequestMergeFacts(deps.pool, space.repositoryId, prNumber);
  if (facts === undefined || facts.mergeCommitSha === null || facts.baseBranch !== baseBranch) return { kind: 'no_target' };
  const target = await sequenceProjectionRepo.findProjectionTargetBySha(deps.pool, {
    repositoryId: space.repositoryId,
    baseBranch: space.baseBranch,
    seqEpoch: space.seqEpoch,
    commitSha: facts.mergeCommitSha,
  });
  if (target === undefined) return { kind: 'no_target' };
  const resolved = resolveTargets(space, [target], 'live', ['pull_request']);
  // 이 PR이 그 SHA의 유일한 후보가 아니면 매핑 충돌이다 — 쓰지 않는다.
  if (!resolved.items.some((item) => item.docId === pullRequestDocId(space.repositoryId, prNumber))) return { kind: 'no_target' };
  return judgeSingle(await projectItems(deps, space, { items: resolved.items.filter((item) => item.docId === pullRequestDocId(space.repositoryId, prNumber)), skipped: [] }, options));
}

function judgeSingle(page: PageOutcome): SingleTargetOutcome {
  if (page.staleEpoch.length > 0) return { kind: 'stale_epoch' };
  if (page.settled.length > 0) return { kind: 'settled' };
  if (page.skipped.some((one) => one.reason === 'other_space')) return { kind: 'other_space' };
  const pending = page.pending[0];
  if (pending !== undefined) return { kind: 'pending', reason: `${pending.outcome.kind}${pending.outcome.reason === undefined ? '' : `:${pending.outcome.reason}`}` };
  return { kind: 'no_target' };
}

/* ------------------------------------------------------------------------- */
/* durable work — 공간 단위(tail·full)와 문서 단위(doc)                          */
/* ------------------------------------------------------------------------- */

export interface SpaceWorkProgress {
  /** 이 진행이 속한 요청 세대. 다르면 처음부터 다시 훑는다 (`full`). */
  readonly generation?: number;
  readonly seq_epoch?: number;
  /**
   * 이 세대가 비추는 문서 종류. 진행 중(완료되지 않은) 세대에 좁은 별칭 요청이 덮여 와도
   * 재시작은 **합집합**으로 돈다 — 재요청이 넓은 sweep을 자른 채 완료로 닫히지 않게 한다.
   */
  readonly kinds?: readonly SequenceDocKind[];
  /** 마지막으로 처리한 서수. 다음 claim은 그 뒤부터다. */
  readonly cursor_seq?: number;
  readonly pages?: number;
  readonly counts?: Readonly<Record<string, number>>;
  /** 완료 요약. `completed_generation`과 함께 "이 세대의 sweep이 끝났다"의 근거다. */
  readonly completed?: {
    readonly generation: number;
    readonly seq_epoch: number;
    readonly head_seq: number;
    readonly counts: Readonly<Record<string, number>>;
    readonly completed_at: string;
  };
}

export type SpaceWorkOutcome =
  | { readonly kind: 'done'; readonly progress: SpaceWorkProgress }
  | { readonly kind: 'continue'; readonly progress: SpaceWorkProgress }
  | { readonly kind: 'obsolete'; readonly reason: string }
  | { readonly kind: 'skipped'; readonly reason: string };

function addCounts(into: Record<string, number>, from: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value;
}

/**
 * 공간 단위 work 한 회차. 정본을 서수 순으로 훑어 비추고, 문서가 없거나 색인이 따라오지
 * 못한 항목은 문서 단위 work로 넘긴 뒤 커서를 전진시킨다. 페이지마다 진행을 저장하므로
 * 러너가 죽어도 다음 lease가 그 자리에서 잇는다.
 *
 * **다른 공간의 값·정본의 값은 건드리지 않는다.** `mget`·bulk 자체가 던지면 그대로 던진다 —
 * 러너가 lease를 놓고 백오프로 다시 온다(커서는 마지막으로 저장한 페이지다).
 */
export async function runSpaceProjectionWork(
  deps: ProjectionDeps,
  row: SequenceWorkRow,
  lease: { readonly workKey: string; readonly leaseToken: string },
  options: { readonly pagesPerClaim?: number; readonly pageSize?: number } = {},
): Promise<SpaceWorkOutcome> {
  const log = logOf(deps);
  const scope = (row.payload as { scope?: unknown }).scope === 'full' ? 'full' : 'tail';
  const loaded = await loadSpace(deps, row.repository_id, row.base_branch);
  if (loaded === undefined) return { kind: 'skipped', reason: 'space_missing' };
  const { space } = loaded;
  if (row.seq_epoch !== space.seqEpoch) return { kind: 'obsolete', reason: 'epoch_moved' };
  const spaceRow = await sequenceSpaceRepo.findSequenceSpace(deps.pool, row.repository_id, row.base_branch);
  const headSeq = Number(spaceRow?.head_seq ?? 0);

  const prior = row.progress as SpaceWorkProgress;
  const restart = scope === 'full' && prior.generation !== row.requested_generation;
  /*
   * `requestWork`는 같은 키의 재요청에 payload를 덮어쓴다. 진행 중이던 세대가 아직 끝나지 않았으면
   * 그 세대의 별칭을 잃지 않는다 — 운영자의 두 별칭 sweep이 재색인 전환의 한 별칭 요청에, 또는 복구의
   * 두 별칭 sweep이 운영자의 한 별칭 요청에 잘리면, 나머지 별칭의 페이지가 처리되지 않은 채 잡이
   * 완료로 닫힌다. 끝난 세대 뒤의 새 요청만 요청한 별칭 그대로 돈다.
   */
  const requestedKinds = allowedKinds(row.payload);
  const priorFinished = prior.completed?.generation === prior.generation;
  const kinds: readonly SequenceDocKind[] = restart && priorFinished ? requestedKinds : unionKinds(prior.kinds, requestedKinds);
  let cursor = restart ? 0 : Number(prior.cursor_seq ?? 0);
  let pages = restart ? 0 : Number(prior.pages ?? 0);
  const counts: Record<string, number> = restart ? {} : { ...(prior.counts ?? {}) };
  const pageSize = options.pageSize ?? PROJECTION_PAGE;
  const budget = options.pagesPerClaim ?? PROJECTION_PAGES_PER_CLAIM;

  const save = async (patch: Partial<SpaceWorkProgress> = {}): Promise<SpaceWorkProgress> => {
    const progress: SpaceWorkProgress = {
      generation: row.requested_generation,
      seq_epoch: space.seqEpoch,
      kinds,
      cursor_seq: cursor,
      pages,
      counts: { ...counts },
      ...(prior.completed === undefined || restart ? {} : { completed: prior.completed }),
      ...patch,
    };
    await sequenceWorkRepo.updateWorkProgress(deps.pool, lease, progress as unknown as Record<string, unknown>);
    return progress;
  };

  for (let used = 0; used < budget; used += 1) {
    const rows = await sequenceProjectionRepo.listProjectionTargetsAfter(deps.pool, {
      repositoryId: space.repositoryId,
      baseBranch: space.baseBranch,
      seqEpoch: space.seqEpoch,
      afterSeq: cursor,
      limit: pageSize,
    });
    if (rows.length === 0) break;

    // 쓰기 직전에 에폭을 다시 본다 — 그 사이 재채번이 있었으면 이 회차는 옛 에폭의 것이다.
    const current = await sequenceSpaceRepo.findSequenceSpace(deps.pool, row.repository_id, row.base_branch);
    if (current === undefined || current.seq_epoch !== space.seqEpoch) return { kind: 'obsolete', reason: 'epoch_moved' };

    const page = await projectItems(deps, space, resolveTargets(space, rows, 'live', kinds));
    if (page.staleEpoch.length > 0) return { kind: 'obsolete', reason: 'stale_epoch_in_index' };

    const delegated = await requestDocWork(deps.pool, space, page.pending, `${scope}_sweep`);
    addCounts(counts, {
      settled: page.settled.length,
      pending: page.pending.length,
      delegated,
      skipped: page.skipped.length,
      ...countSkips(page.skipped),
    });
    cursor = rows[rows.length - 1]?.merge_seq ?? cursor;
    pages += 1;
    await save();

    if (rows.length < pageSize) break;
  }

  const exhausted = await sequenceProjectionRepo.listProjectionTargetsAfter(deps.pool, {
    repositoryId: space.repositoryId,
    baseBranch: space.baseBranch,
    seqEpoch: space.seqEpoch,
    afterSeq: cursor,
    limit: 1,
  });
  if (exhausted.length > 0) {
    // 예산을 다 썼다. lease를 놓고 다음 claim이 커서에서 잇는다 — 한 공간이 러너를 독점하지 않는다.
    return { kind: 'continue', progress: await save() };
  }

  const progress = await save({
    completed: {
      generation: row.requested_generation,
      seq_epoch: space.seqEpoch,
      head_seq: headSeq,
      counts: { ...counts },
      completed_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
    },
  });
  log({
    level: 'info',
    message: `시퀀스 ${scope} 투영을 마쳤다`,
    work_key: row.work_key,
    repository_id: row.repository_id,
    base_branch: row.base_branch,
    seq_epoch: space.seqEpoch,
    counts,
  });
  return { kind: 'done', progress };
}

function countSkips(skipped: readonly SkippedTarget[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const one of skipped) out[`skip_${one.reason}`] = (out[`skip_${one.reason}`] ?? 0) + 1;
  return out;
}

function unionKinds(prior: readonly SequenceDocKind[] | undefined, requested: readonly SequenceDocKind[]): readonly SequenceDocKind[] {
  const set = new Set<SequenceDocKind>([...(prior ?? []), ...requested]);
  return (['commit', 'pull_request'] as const).filter((kind) => set.has(kind));
}

function allowedKinds(payload: Record<string, unknown>): SequenceDocKind[] {
  const aliases = payload['aliases'];
  if (!Array.isArray(aliases) || aliases.length === 0) return ['commit', 'pull_request'];
  const kinds: SequenceDocKind[] = [];
  if (aliases.includes('prs-commits')) kinds.push('commit');
  if (aliases.includes('prs-pull-requests')) kinds.push('pull_request');
  return kinds.length === 0 ? ['commit', 'pull_request'] : kinds;
}

export type DocWorkOutcome = 'done' | 'no_target' | 'other_space' | 'obsolete' | 'document_missing' | 'retry';

/** 문서 단위 work 한 회차. 정본을 다시 읽으므로 payload의 옛 값에 매달리지 않는다. */
export async function runDocProjectionWork(deps: ProjectionDeps, row: SequenceWorkRow): Promise<{ readonly outcome: DocWorkOutcome; readonly reason?: string }> {
  const payload = row.payload as { kind?: unknown; pr_number?: unknown; commit_sha?: unknown };
  const loaded = await loadSpace(deps, row.repository_id, row.base_branch);
  if (loaded === undefined) return { outcome: 'no_target', reason: 'space_missing' };
  if (row.seq_epoch !== loaded.space.seqEpoch) return { outcome: 'obsolete', reason: 'epoch_moved' };

  let single: SingleTargetOutcome;
  if (payload.kind === 'commit' && typeof payload.commit_sha === 'string') {
    single = await projectSingleCommit(deps, loaded.repository, row.base_branch, payload.commit_sha);
  } else if (payload.kind === 'pull_request' && Number.isInteger(payload.pr_number)) {
    single = await projectSinglePullRequest(deps, loaded.repository, row.base_branch, Number(payload.pr_number));
  } else {
    return { outcome: 'no_target', reason: 'malformed_payload' };
  }
  switch (single.kind) {
    case 'settled':
      return { outcome: 'done' };
    case 'no_target':
      return { outcome: 'no_target' };
    case 'other_space':
      return { outcome: 'other_space' };
    case 'stale_epoch':
      return { outcome: 'obsolete', reason: 'stale_epoch_in_index' };
    default:
      return { outcome: single.reason.startsWith('document_missing') ? 'document_missing' : 'retry', reason: single.reason };
  }
}

/* ------------------------------------------------------------------------- */
/* 재색인 replay·검증                                                            */
/* ------------------------------------------------------------------------- */

export interface ReplaySpaceRecord {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly head_seq: number;
  readonly pages: number;
  /** target 인덱스에서 끝난(`updated`·`noop`) 항목 수. */
  readonly settled: number;
  /** target 인덱스에 없거나 실패한 항목 수. 0이 아니면 검증이 잡는다. */
  readonly unsettled: number;
  readonly skipped: number;
}

/**
 * 재구축 직후 저장소 하나의 모든 시퀀스 공간을 현재 정본으로 다시 비춘다 (재색인 replay).
 *
 * 울타리 안에서 쓰므로 서비스 별칭과 shadow(target)에 함께 닿고, 판정은 **target 결과**로
 * 한다 — 옛 active 인덱스에 대한 완료는 새 인덱스의 완료가 아니다. 페이지마다 `onPage`로
 * 진행을 넘겨 호출 측(재색인 잡)이 `job.progress`에 남긴다.
 */
export async function replaySequenceForRepository(
  deps: ProjectionDeps,
  repository: RepositoryRow,
  kind: SequenceDocKind,
  onSpace?: (record: ReplaySpaceRecord) => Promise<void>,
): Promise<readonly ReplaySpaceRecord[]> {
  const alias = aliasOf(kind);
  const records: ReplaySpaceRecord[] = [];
  for (const baseBranch of repository.sequence_branches) {
    const spaceRow = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
    if (spaceRow === undefined) continue;
    const space = spaceOf(repository, baseBranch, spaceRow.seq_epoch);
    let cursor = 0;
    let pages = 0;
    let settled = 0;
    let unsettled = 0;
    let skipped = 0;
    for (;;) {
      const rows = await sequenceProjectionRepo.listProjectionTargetsAfter(deps.pool, {
        repositoryId: space.repositoryId,
        baseBranch: space.baseBranch,
        seqEpoch: space.seqEpoch,
        afterSeq: cursor,
        limit: PROJECTION_PAGE,
      });
      if (rows.length === 0) break;
      const resolved = resolveTargets(space, rows, 'reindex', [kind]);
      const { page, shadowExpected } = await withReindexWrite(deps.pool, async (targets) => ({
        page: await projectItems(deps, space, resolved, { targets }),
        shadowExpected: targets.shadows[alias] !== undefined,
      }));
      const otherSpace = new Set(page.skipped.filter((one) => one.reason === 'other_space').map((one) => one.docId));
      /*
       * **판정은 target(shadow) 결과다.** shadow 쓰기가 던지면 투영기는 그 별칭의 shadow 결과를 남기지
       * 않고 `recordShadowFailure`만 부른다(울타리가 잡을 `failed`로 만든다). 그때 서비스 결과로
       * 물러서면 target에 한 번도 쓰지 못한 문서가 `settled`로 세어져 진행 기록이 거짓이 된다 — 독립
       * 리뷰 지적. 그래서 "target에서 끝났다고 확인된 항목"만 settled로 세고 **나머지 전부**를
       * unsettled로 센다. reclaim 두 번째 쓰기만 shadow에 닿은 부분 결과도 같은 규칙으로 정직하다.
       */
      const judgedItems = resolved.items.filter((item) => !otherSpace.has(item.docId));
      const outcomes = shadowExpected ? (page.raw.shadows[alias]?.outcomes ?? []) : (page.raw.served[alias]?.outcomes ?? []);
      const settledIds = new Set(outcomes.filter((one) => isSettledOutcome(one.kind)).map((one) => one.docId));
      const pageSettled = judgedItems.filter((item) => settledIds.has(item.docId)).length;
      settled += pageSettled;
      unsettled += judgedItems.length - pageSettled;
      skipped += page.skipped.length;
      pages += 1;
      cursor = rows[rows.length - 1]?.merge_seq ?? cursor;
      if (rows.length < PROJECTION_PAGE) break;
    }
    const record: ReplaySpaceRecord = {
      repository_id: space.repositoryId,
      base_branch: baseBranch,
      seq_epoch: space.seqEpoch,
      head_seq: Number(spaceRow.head_seq),
      pages,
      settled,
      unsettled,
      skipped,
    };
    records.push(record);
    if (onSpace !== undefined) await onSpace(record);
  }
  return records;
}

export interface SequenceVerifyOutcome {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  /** 검사한 공간 수·항목 수. */
  readonly spaces: number;
  readonly items: number;
  readonly repaired: number;
}

/**
 * 전환 전 검증 — target 인덱스의 서수 필드를 정본과 문서마다 대조하고, 공간마다 대표 범위의
 * 실제 정렬 순서를 정본 순서와 비교한다 (FR-ING-008 AC-8).
 *
 * 대상 집합은 PostgreSQL의 현재 시퀀스와 스냅숏으로 계산한다. 전체 PR 수나 `merge_sequence`
 * 행 수가 같아야 한다고 검사하지 않는다 — 미병합·직접 푸시·미수집·연결 미확정은 대상이
 * 아니다. 불일치가 있으면 **한 번** 인라인으로 다시 비추고 다시 읽는다 — 검증 직전에
 * 들어온 채번이 shadow에 아직 닿지 않았을 수 있다. 그래도 남으면 전환하지 않는다.
 */
export async function verifySequenceProjection(
  deps: ProjectionDeps,
  kind: SequenceDocKind,
  targetIndex: string,
  options: { readonly orderSample?: number } = {},
): Promise<SequenceVerifyOutcome> {
  const reasons: string[] = [];
  const orderSample = options.orderSample ?? 1_000;
  let spaces = 0;
  let items = 0;
  let repaired = 0;
  const repositories = await allRepositories(deps.pool);

  for (const repository of repositories) {
    for (const baseBranch of repository.sequence_branches) {
      const spaceRow = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
      if (spaceRow === undefined) continue;
      const space = spaceOf(repository, baseBranch, spaceRow.seq_epoch);
      spaces += 1;
      let cursor = 0;
      const expectedOrder: { docId: string; mergeSeq: number }[] = [];
      for (;;) {
        const rows = await sequenceProjectionRepo.listProjectionTargetsAfter(deps.pool, {
          repositoryId: space.repositoryId,
          baseBranch: space.baseBranch,
          seqEpoch: space.seqEpoch,
          afterSeq: cursor,
          limit: PROJECTION_PAGE,
        });
        if (rows.length === 0) break;
        const resolved = resolveTargets(space, rows, 'reindex', [kind]);
        items += resolved.items.length;
        const first = await findMismatches(deps, space, targetIndex, resolved.items);
        let remaining = first.mismatches;
        const otherSpace = new Set(first.otherSpace);
        if (first.mismatches.length > 0) {
          // 한 번 더 비춘다 — 검증 직전 채번이 아직 닿지 않았을 수 있다. 그 뒤에도 남으면 실패다.
          await withReindexWrite(deps.pool, (targets) => projectItems(deps, space, { items: first.mismatches.map((one) => one.item), skipped: [] }, { targets }));
          const second = await findMismatches(deps, space, targetIndex, first.mismatches.map((one) => one.item));
          remaining = second.mismatches;
          for (const id of second.otherSpace) otherSpace.add(id);
          repaired += first.mismatches.length - remaining.length;
        }
        for (const one of remaining.slice(0, 5)) {
          reasons.push(`시퀀스 투영 불일치 ${one.item.docId} seq=${String(one.item.mergeSeq)}: ${one.reason}`);
        }
        if (remaining.length > 5) reasons.push(`시퀀스 투영 불일치 ${String(remaining.length - 5)}건 더 (${space.sequenceSpace})`);
        /*
         * 대표 범위의 기대 순서에는 **이 공간이 실제로 라벨링한 문서만** 넣는다. 다른 시퀀스 브랜치가
         * 현재 에폭에 갖고 있는 공유 커밋(`other_space`)은 그 브랜치의 서수를 달고 있어 이 공간의
         * `base_branch` 필터로 읽는 실제 정렬에 나오지 않는다 — 넣으면 길이가 어긋나 다중 브랜치
         * 저장소의 `prs-commits` 재색인이 전환에 영영 닿지 못한다(독립 리뷰 지적).
         */
        for (const item of resolved.items) {
          if (!otherSpace.has(item.docId)) expectedOrder.push({ docId: item.docId, mergeSeq: item.mergeSeq });
        }
        cursor = rows[rows.length - 1]?.merge_seq ?? cursor;
        if (rows.length < PROJECTION_PAGE) break;
      }

      // 대표 범위 — 마지막 `orderSample`개 서수의 실제 정렬이 정본 순서와 같은가.
      if (expectedOrder.length > 0) {
        const tail = expectedOrder.slice(-orderSample);
        const from = tail[0]?.mergeSeq ?? 1;
        const to = tail[tail.length - 1]?.mergeSeq ?? from;
        const actual = await readSequenceOrder(deps.es, targetIndex, space, { fromInclusive: from, toInclusive: to });
        const expectedSeqs = tail.map((one) => one.mergeSeq);
        const actualSeqs = actual.map((one) => one.mergeSeq);
        if (expectedSeqs.length !== actualSeqs.length || expectedSeqs.some((seq, index) => seq !== actualSeqs[index])) {
          reasons.push(
            `대표 범위 정렬 불일치 ${space.sequenceSpace} [${String(from)}, ${String(to)}]: 정본 ${String(expectedSeqs.length)}건 / 색인 ${String(actualSeqs.length)}건` +
              (actualSeqs.length > 0 ? ` (첫 차이 ${String(firstDifference(expectedSeqs, actualSeqs))})` : ''),
          );
        }
      }
    }
  }
  return { ok: reasons.length === 0, reasons, spaces, items, repaired };
}

function firstDifference(a: readonly number[], b: readonly number[]): number | string {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return `${String(a[index] ?? '∅')}≠${String(b[index] ?? '∅')}`;
  }
  return '-';
}

/**
 * target 인덱스에서 정본과 다른 항목. `otherSpace`는 다른 시퀀스 브랜치가 현재 에폭에 갖고 있어
 * 이 공간이 쓰지 않는 공유 커밋 문서 — 불일치가 아니며 대표 범위 정렬의 기대치에서도 뺀다.
 */
async function findMismatches(
  deps: ProjectionDeps,
  space: ProjectionSpace,
  targetIndex: string,
  items: readonly SequenceProjectionItem[],
): Promise<{ mismatches: { item: SequenceProjectionItem; reason: string }[]; otherSpace: Set<string> }> {
  const otherSpace = new Set<string>();
  if (items.length === 0) return { mismatches: [], otherSpace };
  const observed = await readSequenceProjection(deps.es, targetIndex, items);
  const out: { item: SequenceProjectionItem; reason: string }[] = [];
  const conflicts: { item: SequenceProjectionItem; branch: string }[] = [];
  for (const item of items) {
    const verdict = classifySequenceTarget(item, observed.get(item.docId) ?? null);
    if (verdict.kind === 'noop') continue;
    if (verdict.kind === 'guard_rejected' && verdict.reason === 'branch' && item.kind === 'commit') {
      const branch = observed.get(item.docId)?.base_branch;
      if (typeof branch === 'string') {
        conflicts.push({ item, branch });
        continue;
      }
    }
    out.push({ item, reason: verdict.kind === 'guard_rejected' ? `guard_rejected:${verdict.reason}` : verdict.kind === 'write' ? 'value_differs' : verdict.kind });
  }
  if (conflicts.length > 0) {
    const holders = await sequenceProjectionRepo.listSpacesHoldingCommits(
      deps.pool,
      space.repositoryId,
      conflicts.map((one) => ({ baseBranch: one.branch, commitSha: one.item.expectedSha })),
    );
    for (const one of conflicts) {
      // 다른 공간이 정본에서 이 SHA를 갖고 있으면 그 문서는 그 공간의 것이다 — 불일치가 아니다.
      if (holders.has(sequenceProjectionRepo.spaceCommitKey(one.branch, one.item.expectedSha))) {
        otherSpace.add(one.item.docId);
      } else {
        out.push({ item: one.item, reason: 'guard_rejected:branch' });
      }
    }
  }
  return { mismatches: out, otherSpace };
}

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
 * 채번된 적 있는 모든 시퀀스 공간 — replay·검증·전환 뒤 sweep이 **같은 집합**을 본다. 등록 해제된
 * 저장소도 포함한다(문서가 남아 있다). 공간 행이 없는 브랜치는 비출 정본이 없으므로 뺀다.
 */
export async function listProjectionSpaces(pool: Pool): Promise<readonly Pick<ProjectionSpace, 'repositoryId' | 'baseBranch' | 'seqEpoch'>[]> {
  const out: Pick<ProjectionSpace, 'repositoryId' | 'baseBranch' | 'seqEpoch'>[] = [];
  for (const repository of await allRepositories(pool)) {
    for (const baseBranch of repository.sequence_branches) {
      const spaceRow = await sequenceSpaceRepo.findSequenceSpace(pool, repository.repository_id, baseBranch);
      if (spaceRow === undefined) continue;
      out.push({ repositoryId: repository.repository_id, baseBranch, seqEpoch: spaceRow.seq_epoch });
    }
  }
  return out;
}

/** 모든 시퀀스 공간에 durable full sweep을 남긴다 — 재색인 전환 직후가 부른다. */
export async function requestFullSweepForAllSpaces(pool: Pool, payload: Readonly<Record<string, unknown>>): Promise<number> {
  const spaces = await listProjectionSpaces(pool);
  for (const space of spaces) {
    await sequenceWorkRepo.requestWork(pool, spaceWorkRequest(space, 'full', payload));
  }
  return spaces.length;
}
