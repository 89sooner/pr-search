/**
 * 정합성 점검 잡 (JOB-SEQ-003 / WP-028, FR-ADMIN-003, CR-033).
 *
 * 핵심 주장 하나: **점검은 시퀀스 공간 상태를 바꾸지 않는다** (DEV-171).
 * 이 파일은 그 사실을 "쓰기 질의가 아예 없다"로 확인한다 — 상태를 바꾸는 변이는
 * 여기서 죽는다.
 */

import { describe, expect, it } from 'vitest';
import { CommitGraphError } from '@prs/github';
import { checkSpace, runIntegritySweep, INTEGRITY_SWEEP_INTERVAL_MS } from './integrity.js';
import type { IntegrityDeps } from './integrity.js';

const sha = (n: number): string => `${String(n).padStart(4, '0')}${'d'.repeat(36)}`;

const REPOSITORY = {
  repository_id: 1,
  owner: 'acme',
  name: 'payments',
  org_id: 1,
  visibility: 'internal',
  sequence_branches: ['main'],
  status: 'active',
} as unknown as Parameters<typeof checkSpace>[1];

interface Harness {
  readonly deps: IntegrityDeps;
  readonly writes: string[];
  readonly counters: { mismatch: number; failed: number };
}

function harness(options: {
  readonly stored: readonly { mergeSeq: number; commitSha: string }[];
  readonly chain: readonly string[] | Error;
  readonly head?: string | null;
  readonly headSeq?: number;
}): Harness {
  const writes: string[] = [];
  const counters = { mismatch: 0, failed: 0 };

  const pool = {
    query: (text: string) => {
      const sql = String(text);
      // 쓰기 질의가 도는지 감시한다 — 점검은 읽기여야 한다.
      if (/\b(UPDATE|INSERT|DELETE)\b/i.test(sql)) writes.push(sql);
      if (/FROM sequence_space/i.test(sql)) {
        return Promise.resolve({
          rows: [
            {
              repository_id: 1,
              base_branch: 'main',
              seq_epoch: 1,
              head_sha: options.head ?? null,
              head_seq: String(options.headSeq ?? options.stored.length),
              state: 'ok',
              last_assigned_at: null,
              last_error: null,
            },
          ],
        });
      }
      if (/FROM merge_sequence/i.test(sql)) {
        return Promise.resolve({
          rows: options.stored.map((entry) => ({
            merge_seq: String(entry.mergeSeq),
            commit_sha: entry.commitSha,
          })),
        });
      }
      if (/FROM repository/i.test(sql)) return Promise.resolve({ rows: [REPOSITORY] });
      return Promise.resolve({ rows: [] });
    },
  } as unknown as IntegrityDeps['pool'];

  const graph = {
    kind: 'api',
    resolveHead: () =>
      Promise.resolve(options.head === undefined ? (Array.isArray(options.chain) ? options.chain.at(-1) ?? null : sha(1)) : options.head),
    firstParentRevList: () =>
      options.chain instanceof Error ? Promise.reject(options.chain) : Promise.resolve([...options.chain]),
  } as unknown as ReturnType<IntegrityDeps['graphFor']>;

  const metrics = {
    sequenceIntegrityMismatch: { inc: (): void => { counters.mismatch += 1; } },
    sequenceIntegrityCheckFailed: { inc: (): void => { counters.failed += 1; } },
  } as unknown as IntegrityDeps['metrics'];

  return { deps: { pool, metrics, graphFor: () => graph }, writes, counters };
}

describe('checkSpace', () => {
  it('저장분과 체인이 같으면 consistent다', async () => {
    const { deps } = harness({
      stored: [1, 2, 3].map((n) => ({ mergeSeq: n, commitSha: sha(n) })),
      chain: [sha(1), sha(2), sha(3)],
    });
    const outcome = await checkSpace(deps, REPOSITORY, 'main');
    expect(outcome).toEqual({ kind: 'consistent', checked: 3 });
  });

  it('최초 불일치를 낸다', async () => {
    const { deps } = harness({
      stored: [1, 2, 3].map((n) => ({ mergeSeq: n, commitSha: sha(n) })),
      chain: [sha(1), sha(91), sha(92)],
    });
    const outcome = await checkSpace(deps, REPOSITORY, 'main');
    expect(outcome.kind).toBe('mismatch');
    if (outcome.kind === 'mismatch') expect(outcome.mismatch.mergeSeq).toBe(2);
  });

  it('그래프 실패는 failed다', async () => {
    const { deps } = harness({
      stored: [{ mergeSeq: 1, commitSha: sha(1) }],
      chain: new CommitGraphError('api', 'down'),
    });
    expect(await checkSpace(deps, REPOSITORY, 'main')).toEqual({
      kind: 'failed',
      reason: 'commit_graph_unavailable',
    });
  });

  it('브랜치 head가 없으면 failed다', async () => {
    const { deps } = harness({ stored: [{ mergeSeq: 1, commitSha: sha(1) }], chain: [], head: null });
    expect(await checkSpace(deps, REPOSITORY, 'main')).toEqual({ kind: 'failed', reason: 'branch_head_missing' });
  });
});

describe('**점검은 상태를 바꾸지 않는다** (CR-033, DEV-171)', () => {
  it('일치해도 쓰기 질의가 없다', async () => {
    const h = harness({
      stored: [{ mergeSeq: 1, commitSha: sha(1) }],
      chain: [sha(1)],
    });
    await runIntegritySweep(h.deps);
    expect(h.writes).toEqual([]);
  });

  it('**불일치해도 쓰기 질의가 없다**', async () => {
    const h = harness({
      stored: [{ mergeSeq: 1, commitSha: sha(1) }],
      chain: [sha(99)],
    });
    await runIntegritySweep(h.deps);
    expect(h.writes).toEqual([]);
    expect(h.counters.mismatch).toBe(1);
  });

  it('**그래프가 죽어도 쓰기 질의가 없다** — `unknown`으로 덮어쓰지 않는다', async () => {
    const h = harness({
      stored: [{ mergeSeq: 1, commitSha: sha(1) }],
      chain: new CommitGraphError('api', 'down'),
    });
    const result = await runIntegritySweep(h.deps);
    expect(h.writes).toEqual([]);
    // 실패가 조용히 지나가지 않는다 — 지표로 보인다.
    expect(h.counters.failed).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe('스케줄', () => {
  it('일 1회다 (비동기 문서 9장)', () => {
    expect(INTEGRITY_SWEEP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
