/**
 * 조정 스캔 (JOB-ING-005 / WP-028, FR-ING-011, CR-033).
 *
 * 핵심 주장 셋: **`updated desc` + 24시간 컷오프로 읽는다**(DEV-175),
 * **누락은 백필과 같은 경로로 되돌린다**, **head에 서수가 없으면 채번을
 * 예약한다**(AC-5), **한도 소진은 미룸이지 실패가 아니다**.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubApiError } from '@prs/github';
import { TOPICS } from '@prs/bus';
import { sequencePartitionKey } from '@prs/domain';
import {
  RECONCILE_ALERT_CYCLES,
  RECONCILE_INTERVAL_MS,
  RECONCILE_WINDOW_MS,
  reconcileRepository,
  resetReconcileCycles,
  runReconcileSweep,
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
  /** 페이지별 응답. 주면 `prs`를 대신한다 — 페이지 경계 취소를 재는 데 쓴다. */
  readonly pages?: readonly (readonly { number: number; updated_at: string }[])[];
  /** 스윕이 돌 저장소 목록. `runReconcileSweep`를 부르는 시험만 쓴다. */
  readonly repositories?: readonly unknown[];
}

function harness(options: Options): {
  readonly deps: ReconcileDeps;
  readonly listCalls: { page: number; direction: string | undefined }[];
  readonly projected: number[];
  readonly enqueued: { type: string; target: string }[];
  readonly published: { topic: string; partitionKey: string; eventName: string; payload: unknown }[];
  readonly syncedTeams: string[];
  readonly completedWrites: number[];
  readonly incompleteSets: { value: number; repository: string }[];
} {
  const listCalls: { page: number; direction: string | undefined }[] = [];
  const projected: number[] = [];
  const enqueued: { type: string; target: string }[] = [];
  const published: { topic: string; partitionKey: string; eventName: string; payload: unknown }[] = [];
  const syncedTeams: string[] = [];
  const completedWrites: number[] = [];
  const incompleteSets: { value: number; repository: string }[] = [];

  const pool = {
    query: (text: string, values?: readonly unknown[]) => {
      const sql = String(text);
      if (/INSERT INTO job/i.test(sql)) {
        // 이 경로가 다시 살아나면(DEV-180 회귀) 시험이 본다.
        enqueued.push({ type: String(values?.[0]), target: String(values?.[1]) });
        return Promise.resolve({ rows: [{ job_id: 1 }] });
      }
      if (/^\s*UPDATE repository/i.test(sql)) {
        // 완주 기록 (FR-ING-011 AC-6). 취소된 회차는 여기에 닿으면 안 된다.
        completedWrites.push(Number(values?.[0]));
        return Promise.resolve({ rows: [] });
      }
      if (/FROM repository/i.test(sql)) {
        return Promise.resolve({ rows: options.repositories ?? [] });
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
      if (options.pages !== undefined) {
        const items = options.pages[page - 1] ?? [];
        return Promise.resolve({ items, hasMore: items.length >= 100 });
      }
      return Promise.resolve({ items: page === 1 ? options.prs : [], hasMore: false });
    },
  } as unknown as ReconcileDeps['client'];

  const graph = {
    resolveHead: () => Promise.resolve('head-sha'),
  } as unknown as ReturnType<ReconcileDeps['graphFor']>;

  const metrics = {
    reconcileMissing: { inc: (): void => undefined },
    reconcileIncompleteCycles: {
      set: (value: number, labels: { repository: string }): void => {
        incompleteSets.push({ value, repository: labels.repository });
      },
    },
  } as unknown as ReconcileDeps['metrics'];

  const backfill = {} as unknown as ReconcileDeps['backfill'];

  const bus = {
    publish: (topic: string, partitionKey: string, envelope: { event_name: string; payload: unknown }) => {
      published.push({ topic, partitionKey, eventName: envelope.event_name, payload: envelope.payload });
      return Promise.resolve();
    },
  } as unknown as ReconcileDeps['bus'];

  return {
    deps: {
      pool,
      es,
      client,
      bus,
      metrics,
      graphFor: () => graph,
      backfill,
      now: () => NOW,
      // 되돌리기는 세기만 한다 — 기본값(백필 경로)은 통합 계층이 본다.
      reproject: (_deps, _repository, summary) => {
        projected.push((summary as { number: number }).number);
        return Promise.resolve(true);
      },
      syncTeams: (repository) => {
        syncedTeams.push(`${repository.owner}/${repository.name}`);
        return Promise.resolve();
      },
    },
    listCalls,
    projected,
    enqueued,
    published,
    syncedTeams,
    completedWrites,
    incompleteSets,
  };
}

/**
 * `n`번째 확인까지는 계속하고 그 뒤로는 멈추라고 답한다.
 *
 * 확인 지점을 **호출 횟수로** 지목하므로, 어느 경계에서 끊었는지가 시험 본문에
 * 드러난다.
 */
function cancelAfter(n: number): () => Promise<boolean> {
  let calls = 0;
  return (): Promise<boolean> => {
    calls += 1;
    return Promise.resolve(calls > n);
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

describe('head 시퀀스 복구 (AC-5 / CR-034 DEV-180)', () => {
  it('**head에 서수가 없으면 살아 있는 채번 경로로 요청한다**', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: null });
    const result = await reconcileRepository(h.deps, REPOSITORY);
    expect(result.sequenceScheduled).toBe(true);
    expect(h.published).toHaveLength(1);
    expect(h.published[0]?.topic).toBe(TOPICS.sequence);
    expect(h.published[0]?.eventName).toBe('sequence.requested');
    expect(h.published[0]?.payload).toEqual({
      repository_id: 1,
      base_branch: 'main',
      head_sha: 'head-sha',
      correlation_id: 'reconcile:1:main',
    });
  });

  it('**죽은 sequence_assign 잡 행을 만들지 않는다** — 집는 러너가 없다', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: null });
    await reconcileRepository(h.deps, REPOSITORY);
    expect(h.enqueued).toEqual([]);
  });

  it('파티션 키가 게이트웨이와 같은 규칙이다 — 공간별 직렬이 유지된다', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: null });
    await reconcileRepository(h.deps, REPOSITORY);
    expect(h.published[0]?.partitionKey).toBe(sequencePartitionKey(1, 'main'));
  });

  it('서수가 이미 있으면 요청하지 않는다', async () => {
    const h = harness({ prs: [], indexed: [], headSeq: 42 });
    expect((await reconcileRepository(h.deps, REPOSITORY)).sequenceScheduled).toBe(false);
    expect(h.published).toEqual([]);
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

describe('**취소가 저장소 안에서도 멈춘다** (DEV-443, PR #91 리뷰 P1)', () => {
  /*
   * 저장소 **사이**에서만 보면 활성 저장소가 하나뿐이거나 그 저장소의 창이
   * 넓을 때 취소가 사실상 무시된다. 잡 행이 `cancelled`로 남는 것은 라벨이고,
   * 여기서 재는 것은 **일이 실제로 멈추는가**다.
   */
  const IN_WINDOW = '2026-08-25T11:00:00Z';

  it('다음 페이지를 요청하지 않는다', async () => {
    // 첫 페이지가 꽉 차야 루프가 두 번째 페이지로 넘어간다.
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, updated_at: IN_WINDOW }));
    const h = harness({
      prs: [],
      indexed: full.map((pr) => pr.number),
      pages: [full, [{ number: 500, updated_at: IN_WINDOW }]],
    });

    // 확인 1 = 페이지 1 앞, 확인 2 = 페이지 2 앞.
    const result = await reconcileRepository(h.deps, REPOSITORY, cancelAfter(1));

    expect(h.listCalls.map((call) => call.page)).toEqual([1]);
    expect(result.stopped).toBe(true);
  });

  it('한 페이지 안에서도 남은 PR을 되돌리지 않는다', async () => {
    const h = harness({
      prs: [
        { number: 10, updated_at: IN_WINDOW },
        { number: 11, updated_at: IN_WINDOW },
        { number: 12, updated_at: IN_WINDOW },
      ],
      indexed: [],
    });

    // 확인 1 = 페이지 앞, 확인 2 = PR 10 되돌리기 앞, 확인 3 = PR 11 되돌리기 앞.
    const result = await reconcileRepository(h.deps, REPOSITORY, cancelAfter(2));

    expect(h.projected).toEqual([10]);
    expect(result.stopped).toBe(true);
  });

  it('후속 단계를 실행하지 않는다 — 채번 예약·팀 동기화·완주 기록', async () => {
    const h = harness({
      prs: [
        { number: 10, updated_at: IN_WINDOW },
        { number: 11, updated_at: IN_WINDOW },
      ],
      indexed: [],
      // 채번이 필요한 상태를 만든다 — 취소가 없었다면 예약이 나갔을 자리다.
      headSeq: null,
    });

    const result = await reconcileRepository(h.deps, REPOSITORY, cancelAfter(2));

    expect(result.stopped).toBe(true);
    expect(result.sequenceScheduled).toBe(false);
    expect(h.published).toEqual([]);
    expect(h.syncedTeams).toEqual([]);
    /*
     * 창을 끝까지 읽지 못한 회차의 `missing`은 부분값이다 — 미룸과 같은 이유로
     * "최근 결과"가 될 수 없다.
     */
    expect(h.completedWrites).toEqual([]);
  });

  it('취소가 없으면 후속 단계가 모두 실행된다 — 대칭', async () => {
    const h = harness({
      prs: [{ number: 10, updated_at: IN_WINDOW }],
      indexed: [],
      headSeq: null,
    });

    const result = await reconcileRepository(h.deps, REPOSITORY);

    expect(result.stopped).toBe(false);
    expect(result.sequenceScheduled).toBe(true);
    expect(h.syncedTeams).toEqual(['acme/payments']);
    expect(h.completedWrites).toEqual([1]);
  });

  it('신호를 주지 않으면 아무것도 달라지지 않는다', async () => {
    const h = harness({ prs: [{ number: 10, updated_at: IN_WINDOW }], indexed: [] });
    const result = await reconcileRepository(h.deps, REPOSITORY);
    expect(result.stopped).toBe(false);
    expect(h.projected).toEqual([10]);
  });
});

describe('스윕이 내부 중단을 존중한다 (DEV-443)', () => {
  const IN_WINDOW = '2026-08-25T11:00:00Z';
  const TWO_REPOSITORIES = [
    { repository_id: 1, owner: 'acme', name: 'payments', sequence_branches: ['main'] },
    { repository_id: 2, owner: 'acme', name: 'billing', sequence_branches: ['main'] },
  ];

  it('첫 저장소 안에서 멈추면 남은 저장소를 돌지 않는다', async () => {
    const h = harness({
      prs: [{ number: 10, updated_at: IN_WINDOW }],
      indexed: [],
      repositories: TWO_REPOSITORIES,
    });

    // 확인 1 = 저장소 1 앞, 확인 2 = 페이지 앞, 확인 3 = PR 10 되돌리기 앞.
    const result = await runReconcileSweep(h.deps, cancelAfter(2));

    expect(result.stopped).toBe(true);
    // 페이지를 요청한 저장소가 하나다 — 멈추지 않았다면 둘이었다.
    expect(h.listCalls).toHaveLength(1);
    expect(h.projected).toEqual([]);
  });

  it('**취소를 연속 미완주로 세지 않는다** — 미룸과 다른 상태다', async () => {
    const h = harness({
      prs: [{ number: 10, updated_at: IN_WINDOW }],
      indexed: [],
      repositories: TWO_REPOSITORIES,
    });

    await runReconcileSweep(h.deps, cancelAfter(2));

    /*
     * 취소는 그 저장소의 건강 문제가 아니라 운영자의 지시다. 미룸으로 세면
     * 세 번 취소할 때마다 경보가 울리고, 0으로 되돌리면 실제 미완주 이력이
     * 취소로 지워진다 — 어느 쪽도 하지 않는다.
     */
    expect(h.incompleteSets).toEqual([]);
  });

  it('취소가 없으면 저장소를 모두 돈다 — 대칭', async () => {
    const h = harness({
      prs: [],
      indexed: [],
      repositories: TWO_REPOSITORIES,
    });

    const result = await runReconcileSweep(h.deps);

    expect(result.stopped).toBe(false);
    expect(result.repositories).toBe(2);
    expect(h.listCalls).toHaveLength(2);
  });
});

describe('**마지막 단위 뒤에도 취소를 다시 본다** (PR #94 리뷰 P1, DEV-448)', () => {
  /*
   * 루프 안의 확인만으로는 부족하다. 마지막 페이지의 마지막 단위를 처리하는
   * 동안 취소가 들어오면 그 뒤로 확인 지점이 없고, 루프는 `items.length <
   * PAGE_SIZE`로 **정상 종료**한다 — `stopped`가 거짓인 채 후속 GHE 작업과
   * 완주 기록이 그대로 실행된다.
   */
  const IN_WINDOW = '2026-08-25T11:00:00Z';

  it('진행 중이던 단위는 끝내되 후속 단계는 실행하지 않는다', async () => {
    const h = harness({
      prs: [{ number: 10, updated_at: IN_WINDOW }],
      indexed: [],
      headSeq: null,
    });

    // 확인 1 = 페이지 앞, 확인 2 = PR 10 되돌리기 앞, 확인 3 = 후속 단계 앞.
    const result = await reconcileRepository(h.deps, REPOSITORY, cancelAfter(2));

    // 협조적 중단이 감수하는 것은 진행 중이던 단위 하나까지다.
    expect(h.projected).toEqual([10]);
    expect(result.stopped).toBe(true);
    expect(result.sequenceScheduled).toBe(false);
    expect(h.published).toEqual([]);
    expect(h.syncedTeams).toEqual([]);
    expect(h.completedWrites).toEqual([]);
  });

  it('되돌릴 것이 없는 회차에서도 마지막에 다시 본다', async () => {
    // 전부 색인돼 있어 루프 안의 두 번째 확인 지점에 닿지 않는다.
    const h = harness({
      prs: [{ number: 10, updated_at: IN_WINDOW }],
      indexed: [10],
      headSeq: null,
    });

    // 확인 1 = 페이지 앞, 확인 2 = 후속 단계 앞.
    const result = await reconcileRepository(h.deps, REPOSITORY, cancelAfter(1));

    expect(result.stopped).toBe(true);
    expect(h.completedWrites).toEqual([]);
  });
});
