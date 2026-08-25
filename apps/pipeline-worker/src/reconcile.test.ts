/**
 * 조정 스캔 (JOB-ING-005 / WP-028, FR-ING-011, CR-033).
 *
 * 핵심 주장 셋: **`updated desc` + 24시간 컷오프로 읽는다**(DEV-175),
 * **누락은 백필과 같은 경로로 되돌린다**, **head에 서수가 없으면 채번을
 * 예약한다**(AC-5), **한도 소진은 미룸이지 실패가 아니다**.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubApiError } from '@prs/github';
import {
  RECONCILE_ALERT_CYCLES,
  RECONCILE_INTERVAL_MS,
  RECONCILE_WINDOW_MS,
  reconcileRepository,
  resetReconcileCycles,
} from './reconcile.js';
import type { ReconcileDeps } from './reconcile.js';

const NOW = new Date('2026-08-25T12:00:00Z');
const REPOSITORY = {
  repository_id: 1,
  owner: 'acme',
  name: 'payments',
  sequence_branches: ['main'],
} as unknown as Parameters<typeof reconcileRepository>[1];

interface Options {
  readonly prs: readonly { number: number; updated_at: string }[];
  readonly indexed: readonly number[];
  readonly rateLimited?: boolean;
  readonly headSeq?: number | null;
  readonly activeAssign?: boolean;
}

function harness(options: Options): {
  readonly deps: ReconcileDeps;
  readonly listCalls: { page: number; direction: string | undefined }[];
  readonly projected: number[];
  readonly enqueued: { type: string; target: string }[];
} {
  const listCalls: { page: number; direction: string | undefined }[] = [];
  const projected: number[] = [];
  const enqueued: { type: string; target: string }[] = [];

  const pool = {
    query: (text: string, values?: readonly unknown[]) => {
      const sql = String(text);
      if (/INSERT INTO job/i.test(sql)) {
        enqueued.push({ type: String(values?.[0]), target: String(values?.[1]) });
        return Promise.resolve({ rows: [{ job_id: 1 }] });
      }
      if (/FROM job/i.test(sql)) {
        return Promise.resolve({ rows: options.activeAssign === true ? [{ job_id: 9, type: 'sequence_assign' }] : [] });
      }
      if (/FROM sequence_space/i.test(sql)) {
        return Promise.resolve({ rows: [{ repository_id: 1, base_branch: 'main', seq_epoch: 1, head_seq: '5', state: 'ok' }] });
      }
      if (/SELECT merge_seq FROM merge_sequence/i.test(sql)) {
        return Promise.resolve({
          rows: options.headSeq === null || options.headSeq === undefined ? [] : [{ merge_seq: String(options.headSeq) }],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as ReconcileDeps['pool'];

  const es = {
    search: (request: { query?: unknown }) => {
      const body = JSON.stringify(request.query ?? {});
      const match = /"pr_number":(\d+)/.exec(body);
      const number = match === null ? -1 : Number(match[1]);
      const found = options.indexed.includes(number);
      return Promise.resolve({
        hits: { total: { value: found ? 1 : 0, relation: 'eq' }, hits: found ? [{ _source: { pr_number: number } }] : [] },
      });
    },
  } as unknown as ReconcileDeps['es'];

  const client = {
    listPullRequestsPage: (_ref: unknown, page: number, opts: { direction?: string }) => {
      listCalls.push({ page, direction: opts.direction });
      if (options.rateLimited === true) {
        return Promise.reject(new GitHubApiError('rate_limited', '한도 소진'));
      }
      return Promise.resolve({ items: page === 1 ? options.prs : [], hasMore: false });
    },
  } as unknown as ReconcileDeps['client'];

  const graph = {
    resolveHead: () => Promise.resolve('head-sha'),
  } as unknown as ReturnType<ReconcileDeps['graphFor']>;

  const metrics = {
    reconcileMissing: { inc: (): void => undefined },
    reconcileIncompleteCycles: { set: (): void => undefined },
  } as unknown as ReconcileDeps['metrics'];

  const backfill = {} as unknown as ReconcileDeps['backfill'];

  return {
    deps: {
      pool,
      es,
      client,
      metrics,
      graphFor: () => graph,
      backfill,
      now: () => NOW,
      // 되돌리기는 세기만 한다 — 기본값(백필 경로)은 통합 계층이 본다.
      reproject: (_deps, _repository, summary) => {
        projected.push((summary as { number: number }).number);
        return Promise.resolve(true);
      },
    },
    listCalls,
    projected,
    enqueued,
  };
}

beforeEach(() => {
  resetReconcileCycles();
});

describe('창과 방향 (AC-2 / CR-033 DEV-175)', () => {
  it('**`updated desc`로 읽는다** — `since`가 없어서 그렇다', async () => {
    const h = harness({ prs: [], indexed: [] });
    await reconcileRepository(h.deps, REPOSITORY);
    expect(h.listCalls[0]?.direction).toBe('desc');
  });

  it('24시간 창이다', () => {
    expect(RECONCILE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('컷오프보다 오래된 PR에서 멈춘다', async () => {
    const h = harness({
      prs: [
        { number: 10, updated_at: '2026-08-25T11:00:00Z' }, // 창 안
        { number: 11, updated_at: '2026-08-20T00:00:00Z' }, // 창 밖 — 여기서 멈춘다
        { number: 12, updated_at: '2026-08-19T00:00:00Z' },
      ],
      indexed: [10],
    });
    const result = await reconcileRepository(h.deps, REPOSITORY);
    expect(result.scanned).toBe(1);
  });
});

describe('누락 탐지 (AC-3)', () => {
  it('색인에 없는 PR을 누락으로 센다', async () => {
    const h = harness({
      prs: [
        { number: 10, updated_at: '2026-08-25T11:00:00Z' },
        { number: 11, updated_at: '2026-08-25T10:00:00Z' },
      ],
      indexed: [10],
    });
    const result = await reconcileRepository(h.deps, REPOSITORY);
    expect(result.scanned).toBe(2);
    expect(result.missing).toBe(1);
  });

  it('전부 색인돼 있으면 누락이 0이다', async () => {
    const h = harness({ prs: [{ number: 10, updated_at: '2026-08-25T11:00:00Z' }], indexed: [10] });
    expect((await reconcileRepository(h.deps, REPOSITORY)).missing).toBe(0);
  });
});

describe('head 시퀀스 예약 (AC-5)', () => {
  it('**head에 서수가 없으면 채번을 예약한다** — 원장 §7의 빈칸이다', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: null });
    const result = await reconcileRepository(h.deps, REPOSITORY);
    expect(result.sequenceScheduled).toBe(true);
    expect(h.enqueued).toEqual([{ type: 'sequence_assign', target: 'acme/payments@main' }]);
  });

  it('서수가 이미 있으면 예약하지 않는다', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: 42 });
    expect((await reconcileRepository(h.deps, REPOSITORY)).sequenceScheduled).toBe(false);
    expect(h.enqueued).toEqual([]);
  });

  it('**이미 줄 서 있으면 또 넣지 않는다**', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: null, activeAssign: true });
    expect((await reconcileRepository(h.deps, REPOSITORY)).sequenceScheduled).toBe(false);
    expect(h.enqueued).toEqual([]);
  });

  it('**같은 기능을 두 번째 방식으로 구현하지 않는다** — 기존 채번 잡을 예약할 뿐이다', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: null });
    await reconcileRepository(h.deps, REPOSITORY);
    // 서수를 직접 쓰지 않는다.
    expect(h.enqueued.every((job) => job.type === 'sequence_assign')).toBe(true);
  });
});

describe('한도 소진 (예외 처리)', () => {
  it('**미룸이지 실패가 아니다** — 던지지 않는다', async () => {
    const h = harness({ prs: [], indexed: [], rateLimited: true });
    const result = await reconcileRepository(h.deps, REPOSITORY);
    expect(result.deferred).toBe(true);
  });

  it('3주기 연속이 경보 임계다', () => {
    expect(RECONCILE_ALERT_CYCLES).toBe(3);
  });
});

describe('스케줄 (AC-1)', () => {
  it('기본 1시간이다', () => {
    expect(RECONCILE_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});

describe('되돌리기 경로 (DEV-176)', () => {
  it('**기본값이 백필의 projectOne이다** — 간이 색인 경로를 만들지 않는다', async () => {
    const h = harness({ prs: [{ number: 10, updated_at: '2026-08-25T11:00:00Z' }], indexed: [] });
    // 주입을 걷어 내면 기본 경로가 쓰인다. 백필 의존이 비어 있어 그 호출이 실패하는 것으로
    // "기본값이 백필 경로"임을 확인한다 — 다른 경로였다면 조용히 성공했을 것이다.
    const withoutSeam = { ...h.deps };
    delete (withoutSeam as { reproject?: unknown }).reproject;
    await expect(reconcileRepository(withoutSeam, REPOSITORY)).rejects.toThrow();
  });

  it('탐지한 누락을 되돌리기에 넘긴다', async () => {
    const h = harness({
      prs: [
        { number: 10, updated_at: '2026-08-25T11:00:00Z' },
        { number: 11, updated_at: '2026-08-25T10:00:00Z' },
      ],
      indexed: [10],
    });
    const result = await reconcileRepository(h.deps, REPOSITORY);
    expect(h.projected).toEqual([11]);
    expect(result.reprojected).toBe(1);
  });
});
