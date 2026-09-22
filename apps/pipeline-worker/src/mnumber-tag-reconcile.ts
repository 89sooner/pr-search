/**
 * 정본 ↔ 원격 `M-*` 태그 대조 (JOB-SEQ-007 / WP-100, FR-SEQ-012 AC-10).
 *
 * ## 무엇을 하고 무엇을 하지 않는가
 *
 * 한 시퀀스 공간의 **현재 에폭** 번호 행 전부와 원격의 `refs/tags/M-<코드>-*` 목록을 대조한다.
 *
 * | 정본 | 원격 | 판정 | 하는 일 |
 * | --- | --- | --- | --- |
 * | 번호 있음 | 없음 | `missing` | durable `tag` work를 (다시) 요청한다 — 생성은 그 경로 하나다 |
 * | 번호 있음 | 같은 SHA·lightweight | `ok` | 정본에 `done`이 없으면 `done(reconciled)`로 적는다 |
 * | 번호 있음 | 다른 SHA 또는 annotated | `conflict` | 정본에 `conflict`를 적고 **보고만** 한다 |
 * | 번호 없음 | 있음 | `unexpected` | 보고만 한다 — 옛 에폭의 태그이거나 사람이 만든 것이다 |
 *
 * 태그를 옮기거나 지우는 일은 어떤 판정에서도 하지 않는다(AC-3·AC-8). dry-run은 원격을
 * **읽기만** 하고 정본·작업 큐·감사에 아무것도 쓰지 않는다.
 */

import { repositoryCodeOf } from '@prs/domain';
import { jobRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, sequenceWorkRepo, type JobRow, type Pool, type RepositoryRow } from '@prs/db';
import { parseSequenceSpaceLabel } from '@prs/domain';
import { safeMessage } from '@prs/github';
import { mergeNumberOfTagName, type RemoteTagRef, type TagClient } from '@prs/github-tag';

export const TAG_RECONCILE_JOB = 'mnumber_tag_reconcile' as const;
export const TAG_RECONCILE_POLL_INTERVAL_MS = 5_000;
const PAGE = 500;
const MAX_EXAMPLES = 20;

export interface TagReconcileLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface TagReconcileDeps {
  readonly pool: Pool;
  readonly client: TagClient;
  readonly log?: (fields: TagReconcileLogFields) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface TagReconcileSummary {
  readonly repository: string;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly code: string;
  readonly dry_run: boolean;
  readonly db_numbered: number;
  readonly remote_refs: number;
  /** 원격 목록이 상한에서 잘렸다 — `unexpected`는 부분 집계다. */
  readonly remote_truncated: boolean;
  readonly ok: number;
  readonly missing: number;
  /** dry-run이 아니면 `missing`과 같다. */
  readonly enqueued: number;
  /** `conflict`였는데 원격에 없어 다시 연 행 수 — 사람이 지운 태그의 재생성 경로. dry-run이면 0. */
  readonly reopened: number;
  /** 이 실행이 저장소의 권한 차단을 풀었는가 (운영자의 명시적 재개). dry-run이면 false. */
  readonly unblocked: boolean;
  readonly conflict: number;
  readonly unexpected: number;
  readonly examples: {
    readonly missing: readonly string[];
    readonly conflict: readonly { readonly tag: string; readonly expected: string; readonly found: string; readonly type: string }[];
    readonly unexpected: readonly string[];
  };
}

export type TagReconcileOutcome =
  | { readonly kind: 'summary'; readonly summary: TagReconcileSummary }
  | { readonly kind: 'error'; readonly reason: string };

/**
 * 한 공간을 대조한다. 던지지 않는다.
 *
 * @param options.dryRun 정본·작업 큐에 아무것도 쓰지 않는다.
 */
export async function reconcileTags(
  deps: TagReconcileDeps,
  target: { readonly repository: RepositoryRow; readonly baseBranch: string },
  options: { readonly dryRun: boolean; readonly triggerKind?: string; readonly jobId?: number },
): Promise<TagReconcileOutcome> {
  const { repository, baseBranch } = target;
  const label = `${repository.owner}/${repository.name}`;
  const code = repositoryCodeOf(repository.name);
  if (code.kind !== 'code') return { kind: 'error', reason: `repository_code_unavailable: ${code.reason}` };
  if (repository.sequence_branches.length !== 1) {
    return { kind: 'error', reason: 'multiple_sequence_branches: 태그 이름에 브랜치가 없어 브랜치가 둘 이상인 저장소는 대조하지 않는다 (OD-015)' };
  }
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
  if (space === undefined) return { kind: 'error', reason: 'sequence_space_missing' };
  if (space.state === 'reassigning') return { kind: 'error', reason: 'space_reassigning' };

  let remote: { readonly refs: readonly RemoteTagRef[]; readonly truncated: boolean };
  try {
    remote = await deps.client.listTagRefs({ owner: repository.owner, repo: repository.name }, `M-${code.code}-`);
  } catch (error) {
    return { kind: 'error', reason: `remote_list_failed: ${safeMessage(error).slice(0, 200)}` };
  }
  const remoteByNumber = new Map<number, RemoteTagRef>();
  for (const ref of remote.refs) {
    const number = mergeNumberOfTagName(code.code, ref.name);
    if (number !== null) remoteByNumber.set(number, ref);
  }

  let dbNumbered = 0;
  let ok = 0;
  let conflict = 0;
  const missing: { readonly prNumber: number; readonly mergeSeq: number; readonly mergeNumber: number; readonly sha: string; readonly name: string; readonly tagState: string | null }[] = [];
  const conflicts: TagReconcileSummary['examples']['conflict'][number][] = [];
  const seenNumbers = new Set<number>();
  let cursor = 0;
  for (;;) {
    const page = await mergeSequenceRepo.listNumberedRowsPage(deps.pool, { repositoryId: repository.repository_id, baseBranch, seqEpoch: space.seq_epoch }, cursor, PAGE);
    if (page.length === 0) break;
    for (const row of page) {
      dbNumbered += 1;
      const mergeNumber = row.merge_number as number;
      seenNumbers.add(mergeNumber);
      const name = `M-${code.code}-${String(mergeNumber)}`;
      const found = remoteByNumber.get(mergeNumber);
      const key = { repositoryId: repository.repository_id, baseBranch, seqEpoch: space.seq_epoch, mergeSeq: Number(row.merge_seq) };
      if (found === undefined) {
        if (row.pull_request_number !== null) {
          missing.push({ prNumber: row.pull_request_number, mergeSeq: Number(row.merge_seq), mergeNumber, sha: row.commit_sha, name, tagState: row.tag_state });
        }
        continue;
      }
      if (found.objectType === 'commit' && found.sha.toLowerCase() === row.commit_sha.toLowerCase()) {
        ok += 1;
        if (!options.dryRun && row.tag_state !== 'done') {
          await mergeSequenceRepo.markTagState(deps.pool, key, 'done', { reason: 'reconciled' });
        }
        continue;
      }
      conflict += 1;
      if (conflicts.length < MAX_EXAMPLES) conflicts.push({ tag: name, expected: row.commit_sha.toLowerCase(), found: found.sha, type: found.objectType });
      if (!options.dryRun && row.tag_state !== 'conflict') {
        await mergeSequenceRepo.markTagState(deps.pool, key, 'conflict', { reason: found.objectType === 'tag' ? 'annotated_tag' : 'different_sha', foundSha: found.sha });
      }
    }
    cursor = Number(page[page.length - 1]?.merge_seq ?? cursor);
    if (page.length < PAGE) break;
  }

  const unexpected: string[] = [];
  for (const [number, ref] of remoteByNumber) {
    if (!seenNumbers.has(number)) unexpected.push(ref.name);
  }
  unexpected.sort((a, b) => (mergeNumberOfTagName(code.code, a) ?? 0) - (mergeNumberOfTagName(code.code, b) ?? 0));

  let enqueued = 0;
  let reopened = 0;
  let unblocked = false;
  if (!options.dryRun) {
    /*
     * 대조는 원격을 직접 봤으므로 정본의 종결 상태를 풀 자격이 있다 (FR-SEQ-012 AC-10 「정본에 있고
     * 원격에 없으면 재생성」).
     *
     * `conflict` 행은 실행자가 원격을 읽지 않고 건너뛴다 — 손대지 않기로 한 태그에 요청을 반복하지
     * 않기 위해서다. 그래서 work를 다시 요청하는 것만으로는 영영 만들지 않는다. 사람이 GHE에서
     * 잘못된 태그를 지운 뒤 다시 만드는 경로(RUNBOOK 7.F)가 이것이므로, **원격에 없음을 방금 확인한
     * 행만** 상태를 지운다.
     *
     * 권한 차단도 여기서 푼다. 조회 성공은 쓰기 권한의 증거가 아니지만(CR-085), 대조는 운영자가
     * 명시적으로 실행하는 것이라 표기의 `annotate_resume`과 같은 「명시적 재개」다. 권한이 여전히
     * 없으면 첫 POST가 다시 차단한다.
     */
    for (const one of missing) {
      if (one.tagState !== 'conflict') continue;
      await mergeSequenceRepo.clearTagState(deps.pool, { repositoryId: repository.repository_id, baseBranch, seqEpoch: space.seq_epoch, mergeSeq: one.mergeSeq }, 'reconcile_missing');
      reopened += 1;
    }
    if (repository.tag_blocked_at !== null) {
      await repositoryRepo.clearTagBlock(deps.pool, repository.repository_id);
      unblocked = true;
    }
  }
  if (!options.dryRun && missing.length > 0) {
    // 생성은 durable work 경로 하나다 — 대조가 두 번째 생성 구현을 갖지 않는다.
    for (let start = 0; start < missing.length; start += PAGE) {
      const slice = missing.slice(start, start + PAGE);
      enqueued += await sequenceWorkRepo.requestWorkBatch(
        deps.pool,
        slice.map((one) => ({
          kind: 'tag' as const,
          repositoryId: repository.repository_id,
          baseBranch,
          seqEpoch: space.seq_epoch,
          keyExtra: [one.prNumber],
          payload: {
            pr_number: one.prNumber,
            merge_number: one.mergeNumber,
            merge_seq: one.mergeSeq,
            commit_sha: one.sha,
            trigger_kind: options.triggerKind ?? 'reconcile',
            ...(options.jobId === undefined ? {} : { job_id: options.jobId }),
          },
        })),
      );
    }
  }

  return {
    kind: 'summary',
    summary: {
      repository: label,
      base_branch: baseBranch,
      seq_epoch: space.seq_epoch,
      code: code.code,
      dry_run: options.dryRun,
      db_numbered: dbNumbered,
      remote_refs: remoteByNumber.size,
      remote_truncated: remote.truncated,
      ok,
      missing: missing.length,
      enqueued,
      reopened,
      unblocked,
      conflict,
      unexpected: unexpected.length,
      examples: {
        missing: missing.slice(0, MAX_EXAMPLES).map((one) => one.name),
        conflict: conflicts,
        unexpected: unexpected.slice(0, MAX_EXAMPLES),
      },
    },
  };
}

/* ------------------------------------------------------------------ 잡 러너 */

/** 잡 하나를 처리한다. 던지지 않는다 — 실패는 잡 행에 남기고 다음 잡으로 간다. */
export async function runTagReconcileJob(deps: TagReconcileDeps, job: JobRow): Promise<'completed' | 'failed' | 'rejected'> {
  const log = deps.log ?? ((): void => undefined);
  const finish = async (state: 'completed' | 'failed', error?: string): Promise<void> => {
    const moved = await jobRepo.finishJobIfRunning(deps.pool, job.job_id, state, error ?? null);
    if (moved) return;
    const current = await jobRepo.findJobState(deps.pool, job.job_id);
    log({ level: 'warn', message: '실행 중 잡의 상태가 이미 바뀌어 있어 종료 상태를 덮지 않았다', job_id: job.job_id, target: job.target, outcome: state, reason: current ?? 'missing' });
  };

  const parsed = parseSequenceSpaceLabel(job.target);
  if (parsed === null) {
    await finish('failed', `target 형식이 아니다: ${job.target}`);
    return 'rejected';
  }
  const repository = await repositoryRepo.findRepositoryBySlug(deps.pool, parsed.owner, parsed.name);
  if (repository === undefined) {
    await finish('failed', '등록되지 않은 저장소다');
    return 'rejected';
  }
  try {
    const outcome = await reconcileTags(deps, { repository, baseBranch: parsed.baseBranch }, { dryRun: false, triggerKind: 'reconcile_job', jobId: job.job_id });
    if (outcome.kind === 'error') {
      await deps.pool.query('UPDATE job SET progress = progress || $2::jsonb WHERE job_id = $1', [job.job_id, JSON.stringify({ reason: outcome.reason })]);
      await finish('failed', outcome.reason);
      return 'failed';
    }
    await deps.pool.query('UPDATE job SET progress = progress || $2::jsonb WHERE job_id = $1', [job.job_id, JSON.stringify(outcome.summary)]);
    /*
     * 충돌은 잡의 실패가 아니라 **보고**다 — 잡이 할 일(대조·재요청)은 끝났고, 태그를 옮기는
     * 것은 사람의 결정이다. 다만 `error` 없이 `completed`로만 두면 운영자가 진행률 표에서 충돌을
     * 놓치므로 요약에 그대로 남긴다(RUNBOOK 7.F가 `conflict`를 읽으라고 안내한다).
     */
    await finish('completed');
    log({ level: 'info', message: 'M 번호 태그 대조 완료', job_id: job.job_id, target: job.target, ...outcome.summary, examples: undefined });
    return 'completed';
  } catch (error) {
    await finish('failed', safeMessage(error).slice(0, 500));
    log({ level: 'error', message: 'M 번호 태그 대조 실패', job_id: job.job_id, target: job.target, reason: safeMessage(error).slice(0, 200) });
    return 'failed';
  }
}

export interface TagReconcileRunner {
  stop(): Promise<void>;
}

/** 큐를 지켜보며 `mnumber_tag_reconcile` 잡을 실행한다. 구조는 `startSequenceReprojectRunner`와 같다. */
export function startTagReconcileRunner(
  deps: TagReconcileDeps,
  options: { readonly intervalMs?: number; readonly maxConcurrent?: number } = {},
): TagReconcileRunner {
  const interval = options.intervalMs ?? TAG_RECONCILE_POLL_INTERVAL_MS;
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
        for (;;) {
          if (stopped) break;
          const job = await jobRepo.claimNextJob(deps.pool, TAG_RECONCILE_JOB, options.maxConcurrent);
          if (job === undefined) break;
          await runTagReconcileJob(deps, job);
        }
      } catch (error) {
        log({ level: 'error', message: '태그 대조 러너 회차 실패', reason: safeMessage(error).slice(0, 200) });
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
