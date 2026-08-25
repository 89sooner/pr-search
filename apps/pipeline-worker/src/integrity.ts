/**
 * 시퀀스 정합성 점검 잡 (JOB-SEQ-003 / WP-028, FR-ADMIN-003, CR-033).
 *
 * 하루 한 번 등록된 저장소의 시퀀스 공간을 표본으로 대조한다. 운영자가 부르는
 * `GET /admin/sequence-integrity`와 **같은 비교 규칙**을 쓴다 — 비교는
 * `@prs/domain`의 `firstSequenceMismatch` 하나다. 둘이 각자 규칙을 갖고 있으면
 * "점검은 통과인데 잡은 불일치"라는 답이 나온다.
 *
 * ## 점검은 상태를 바꾸지 않는다
 *
 * 그래프를 읽지 못하면 실패로 세고 넘어간다 — `sequence_space.state`는 건드리지
 * 않는다 (CR-033, DEV-171 / SRS v2.5). `unknown`은 이미 "채번된 적 없는 브랜치"를
 * 뜻하고 화면들이 그 뜻으로 표시하므로, 일시적 그래프 오류로 그 값을 쓰면 이미
 * 선 화면이 거짓을 말한다. 실패는 `sequence_integrity_check_failed_total`로만
 * 보이며, **조용히 지나가지 않는 것**이 그 지표의 목적이다.
 */

import { integrityRepo, repositoryRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import { firstSequenceMismatch, sampleFromSeq, type SequenceMismatch } from '@prs/domain';
import { CommitGraphError, type CommitGraph } from '@prs/github';
import type { WorkerMetrics } from './metrics.js';

/** 스케줄: 일 1회 (비동기 문서 9장). */
export const INTEGRITY_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface IntegrityLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository?: string;
  readonly baseBranch?: string;
  readonly reason?: string;
}

export interface IntegrityDeps {
  readonly pool: Pool;
  readonly metrics: WorkerMetrics;
  readonly graphFor: (repository: RepositoryRow) => CommitGraph;
  readonly log?: (fields: IntegrityLogFields) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type SpaceCheckOutcome =
  | { readonly kind: 'consistent'; readonly checked: number }
  | { readonly kind: 'mismatch'; readonly checked: number; readonly mismatch: SequenceMismatch }
  | { readonly kind: 'failed'; readonly reason: 'commit_graph_unavailable' | 'branch_head_missing' };

/**
 * 한 시퀀스 공간을 표본 대조한다.
 *
 * 체인은 처음부터 걷고 표본은 **뒤쪽 1000개**를 본다. 중간부터 걸으면 시작점이
 * 저장분에서 온 값이라, 그 앞에서 히스토리가 바뀌었을 때 그 사실이 대조에서
 * 사라진다 — 검증의 기준을 검증 대상에서 가져오는 셈이다.
 */
export async function checkSpace(
  deps: IntegrityDeps,
  repository: RepositoryRow,
  baseBranch: string,
): Promise<SpaceCheckOutcome> {
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
  if (space === undefined) return { kind: 'consistent', checked: 0 };

  const stored = await integrityRepo.listStoredSequence(
    deps.pool,
    repository.repository_id,
    baseBranch,
    space.seq_epoch,
    sampleFromSeq(Number(space.head_seq)),
  );

  const graph = deps.graphFor(repository);
  const ref = { owner: repository.owner, repo: repository.name };
  let actual: readonly string[];
  try {
    const head = await graph.resolveHead(ref, baseBranch);
    if (head === null) return { kind: 'failed', reason: 'branch_head_missing' };
    actual = await graph.firstParentRevList(ref, { from: null, to: head });
  } catch (error) {
    if (!(error instanceof CommitGraphError)) throw error;
    return { kind: 'failed', reason: 'commit_graph_unavailable' };
  }

  const mismatch = firstSequenceMismatch(stored, actual);
  return mismatch === null
    ? { kind: 'consistent', checked: stored.length }
    : { kind: 'mismatch', checked: stored.length, mismatch };
}

/** 등록된 저장소의 모든 시퀀스 브랜치를 한 바퀴 점검한다. */
export async function runIntegritySweep(deps: IntegrityDeps): Promise<{
  readonly checked: number;
  readonly mismatched: number;
  readonly failed: number;
}> {
  const log = deps.log ?? ((): void => undefined);
  const repositories = await repositoryRepo.listRepositories(deps.pool, { status: 'active' });
  let checked = 0;
  let mismatched = 0;
  let failed = 0;

  for (const repository of repositories) {
    const slug = `${repository.owner}/${repository.name}`;
    for (const baseBranch of repository.sequence_branches) {
      checked += 1;
      const outcome = await checkSpace(deps, repository, baseBranch);
      if (outcome.kind === 'failed') {
        failed += 1;
        deps.metrics.sequenceIntegrityCheckFailed.inc({ reason: outcome.reason });
        // 공간 상태는 바꾸지 않는다 (DEV-171). 실패는 지표와 로그로만 보인다.
        log({ level: 'warn', message: '정합성 점검 실패', repository: slug, baseBranch, reason: outcome.reason });
        continue;
      }
      if (outcome.kind === 'mismatch') {
        mismatched += 1;
        deps.metrics.sequenceIntegrityMismatch.inc({ repository: slug, base_branch: baseBranch });
        log({
          level: 'error',
          message: `시퀀스 불일치 — 최초 서수 ${String(outcome.mismatch.mergeSeq)}`,
          repository: slug,
          baseBranch,
        });
      }
    }
  }

  return { checked, mismatched, failed };
}

export interface IntegritySweeper {
  stop(): Promise<void>;
}

/**
 * 주기 점검을 시작한다.
 *
 * `startReleaseSweeper`와 같은 형태다 — **깨울 수 있는 sleep**이라 SIGTERM이 오면
 * 24시간짜리 타이머를 기다리지 않는다. 새 스케줄링 틀을 만들지 않는다.
 */
export function startIntegritySweeper(
  deps: IntegrityDeps,
  options: { readonly intervalMs?: number } = {},
): IntegritySweeper {
  const interval = options.intervalMs ?? INTEGRITY_SWEEP_INTERVAL_MS;
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
        const result = await runIntegritySweep(deps);
        log({
          level: result.mismatched > 0 ? 'error' : 'info',
          message: `정합성 점검 완료 — 공간 ${String(result.checked)}개, 불일치 ${String(result.mismatched)}, 실패 ${String(result.failed)}`,
        });
      } catch (error) {
        log({ level: 'error', message: '정합성 점검 스윕 실패', reason: String(error).slice(0, 200) });
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
