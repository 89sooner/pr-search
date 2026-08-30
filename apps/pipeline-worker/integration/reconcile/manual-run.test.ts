/**
 * 수동 조정 스캔이 실제로 실행된다 (JOB-ING-005 / FR-ING-011 AC-7, WP-040 / CR-055).
 *
 * 실제 PostgreSQL의 `job` 표를 쓴다. GitHub·Elasticsearch는 목이다 — 이 파일이
 * 묻는 것은 **스캔이 무엇을 찾았는가가 아니라 잡이 러너에 닿아 종료 상태에
 * 도달하는가**이며, 그 사슬은 잡 표와 러너 루프로 이루어져 있다.
 *
 * ## 이 파일이 반증하는 결함
 *
 * 1. **유령 잡** — `API-ADM-002`가 행을 만들지만 아무도 집지 않으면 운영자는
 *    누른 뒤 영원히 `queued`를 본다. DEV-429가 정확히 그 상태였다.
 * 2. **겹치는 스윕** — 주기 실행과 수동 실행이 각자 루프를 가지면 한 프로세스
 *    안에서도 겹친다. **단일 복제본 배치는 그것을 막지 못한다** (PR #88 리뷰 P2):
 *    주기 스윕이 GHE 응답을 기다리는 `await` 지점에서 잡 러너가 깨어나면 같은
 *    전량 스캔이 둘 돈다. 배포 경계는 실행 경계가 아니다.
 * 3. **주기만큼 기다리는 "즉시" 실행** — 순회 간격이 주기 간격과 같으면 수동
 *    요청이 최대 한 시간 늦고, 그것은 즉시 실행이 아니다.
 * 4. **덮이는 취소** — 스캔이 도는 동안 운영자가 취소했는데 완료가 그것을
 *    덮으면 화면이 되돌려진 취소를 성공으로 보인다 (DEV-196의 자리).
 *
 * 실행: `pnpm run test:integration reconcile/manual-run`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobRepo, repositoryRepo, type Pool } from '@prs/db';
import {
  RECONCILE_JOB_TYPE,
  startReconcileSweeper,
  type ReconcileDeps,
  type ReconcileSweeper,
} from '../../src/reconcile.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 904110;
const OWNER = 'wp040mr';
const NAME = 'reconcile';
const ACTOR = 'sub-wp040-manual-operator';

let pool: Pool;
let sweeper: ReconcileSweeper | undefined;

/** 스캔 진입·이탈을 세는 계기. 겹침은 동시 진입 수의 최댓값으로 드러난다. */
interface ScanProbe {
  /** 스캔 진입 횟수. */
  entries: number;
  /** 동시에 스캔 안에 있던 최대 수. 2 이상이면 겹쳤다. */
  peak: number;
  /** 현재 스캔 안에 있는 수. */
  active: number;
  /** 스캔 하나가 GHE를 기다리는 시간. 겹칠 창을 넓힌다. */
  delayMs: number;
  /** 스캔에 들어올 때마다 불린다. 취소를 그 안에서 밀어 넣을 때 쓴다. */
  onEnter?: () => Promise<void>;
}

let probe: ScanProbe;

function deps(): ReconcileDeps {
  return {
    pool,
    es: { search: () => Promise.resolve({ hits: { hits: [] } }) } as unknown as ReconcileDeps['es'],
    bus: { publish: () => Promise.resolve() } as unknown as ReconcileDeps['bus'],
    client: {
      listPullRequestsPage: async () => {
        probe.entries += 1;
        probe.active += 1;
        probe.peak = Math.max(probe.peak, probe.active);
        try {
          if (probe.onEnter !== undefined) await probe.onEnter();
          await new Promise((resolve) => setTimeout(resolve, probe.delayMs));
          return { items: [], hasMore: false };
        } finally {
          probe.active -= 1;
        }
      },
    } as unknown as ReconcileDeps['client'],
    metrics: {
      reconcileMissing: { inc: () => undefined },
      reconcileIncompleteCycles: { set: () => undefined },
    } as unknown as ReconcileDeps['metrics'],
    backfill: {} as unknown as ReconcileDeps['backfill'],
    graphFor: () => ({ resolveHead: () => Promise.resolve(null) }) as unknown as ReturnType<ReconcileDeps['graphFor']>,
    reproject: () => Promise.resolve(true),
  } as unknown as ReconcileDeps;
}

/** 조건이 참이 될 때까지 기다린다. 고정 `sleep`으로 대신하지 않는다. */
async function until(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('조건이 시간 안에 성립하지 않았다');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const stateOf = (jobId: number): Promise<jobRepo.JobState | undefined> => jobRepo.findJobState(pool, jobId);

/**
 * 수동 실행 잡 하나. `target`이 `all`인 것은 서버가 정한 값이며
 * (`RECONCILE_TARGET`) 저장소 식별자가 언제나 `/`를 포함하므로 충돌하지 않는다.
 */
const enqueueManual = (): Promise<number> => jobRepo.enqueueJob(pool, RECONCILE_JOB_TYPE, 'all', ACTOR);

/**
 * 러너가 이 잡을 집었는가.
 *
 * **스캔 횟수로 재지 않는다** — 주기 스윕은 첫 순회에 곧바로 돌기 때문에
 * (`lastScheduledAt`이 `null`인 갈래) 스캔이 있었다는 사실은 수동 잡이 집혔다는
 * 증거가 되지 못한다. `claimNextJob`이 채우는 `started_at`이 그 잡 하나에 대한
 * 계기다.
 */
async function claimed(jobId: number): Promise<boolean> {
  const job = await jobRepo.findJobById(pool, jobId);
  return job?.started_at != null;
}

const reachedTerminal = (jobId: number) => async (): Promise<boolean> => {
  const state = await stateOf(jobId);
  return state === 'completed' || state === 'failed' || state === 'cancelled';
};

beforeAll(async () => {
  pool = await migratedPool();
  await pool.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 9041,
    visibility: 'internal',
    sequence_branches: [],
    status: 'active',
  });
}, 90_000);

beforeEach(async () => {
  await pool.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
  probe = { entries: 0, peak: 0, active: 0, delayMs: 0 };
});

afterEach(async () => {
  await sweeper?.stop();
  sweeper = undefined;
});

afterAll(async () => {
  await pool?.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.end();
});

describe('수동 잡이 러너에 닿는다 (FR-ADMIN-002 AC-6)', () => {
  it('`queued` 잡을 집어 스캔을 돌리고 `completed`로 끝낸다', async () => {
    const jobId = await enqueueManual();
    expect(await stateOf(jobId)).toBe('queued');

    // 주기 간격을 아주 길게 두어 **주기가 아니라 수동이 돌았음**을 가른다.
    sweeper = startReconcileSweeper(deps(), { intervalMs: 60 * 60 * 1000, pollMs: 10 });
    await until(reachedTerminal(jobId));

    expect(await stateOf(jobId)).toBe('completed');
    expect(await claimed(jobId)).toBe(true);

    const finished = await jobRepo.findJobById(pool, jobId);
    expect(finished?.finished_at).not.toBeNull();
  });

  it('유령 잡이 남지 않는다 — `queued`에 머무는 행이 없다', async () => {
    const first = await enqueueManual();
    sweeper = startReconcileSweeper(deps(), { intervalMs: 60 * 60 * 1000, pollMs: 10 });
    await until(reachedTerminal(first));

    const remaining = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM job
        WHERE requested_by = $1 AND state = ANY($2::text[])`,
      [ACTOR, ['queued', 'running', 'paused']],
    );
    expect(remaining.rows[0]?.count).toBe(0);
  });

  it('주기 간격만큼 기다리지 않는다 — 순회가 주기보다 촘촘하다', async () => {
    const jobId = await enqueueManual();

    const startedAt = Date.now();
    sweeper = startReconcileSweeper(deps(), { intervalMs: 10 * 60 * 1000, pollMs: 10 });
    await until(reachedTerminal(jobId));

    // 주기가 10분인데 수동 실행이 그 안에 끝났다 — 주기를 기다렸다면 불가능하다.
    expect(Date.now() - startedAt).toBeLessThan(10 * 60 * 1000);
    expect(await stateOf(jobId)).toBe('completed');
  });
});

describe('주기와 수동이 겹치지 않는다 (FR-ING-011 AC-7)', () => {
  it('두 방아쇠를 함께 걸어도 스윕이 겹쳐 실행되지 않는다', async () => {
    /*
     * **배포로 막지 않고 구조로 막는다.** 스캔 하나가 GHE를 기다리는 동안
     * 다른 스윕이 시작될 수 있으면 동시 진입 수가 2가 된다. `intervalMs: 0`은
     * 주기 스윕이 매 순회에 걸리게 하고, 그 사이 수동 잡을 계속 넣는다.
     */
    probe.delayMs = 40;
    sweeper = startReconcileSweeper(deps(), { intervalMs: 0, pollMs: 1 });

    const jobs: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const jobId = await enqueueManual();
      jobs.push(jobId);
      await until(reachedTerminal(jobId));
    }

    expect(await Promise.all(jobs.map(stateOf))).toEqual(['completed', 'completed', 'completed', 'completed']);
    // 주기 스윕도 실제로 돌았다 — 잡 수보다 많은 스캔이 있었다.
    expect(probe.entries).toBeGreaterThan(jobs.length);
    expect(probe.peak).toBe(1);
  });
});

describe('**취소가 스캔을 실제로 멈춘다** (PR #89 리뷰 P1)', () => {
  /*
   * 상태를 보존하는 것만으로는 중단이 아니다. 종료 상태가 `cancelled`로 남아도
   * 전량 스윕이 저장소를 계속 돌면 **화면은 "취소됨"을 보이는데 비싼 GHE 스캔이
   * 진행 중이다.** `FR-ADMIN-002`의 중단 계약은 일을 멈추라는 뜻이다.
   */
  it('저장소 여럿 중 첫 번째에서 취소하면 나머지를 돌지 않는다', async () => {
    // 저장소를 넷으로 늘린다 — 하나면 "멈췄다"와 "원래 하나였다"를 가르지 못한다.
    const extra = [904111, 904112, 904113];
    for (const id of extra) {
      await repositoryRepo.upsertRepository(pool, {
        repository_id: id,
        owner: OWNER,
        name: `extra-${String(id)}`,
        org_id: 9041,
        visibility: 'internal',
        sequence_branches: [],
        status: 'active',
      });
    }

    try {
      const jobId = await enqueueManual();
      // 첫 저장소를 스캔하는 순간 취소한다.
      probe.onEnter = async () => {
        if (probe.entries === 1) await jobRepo.transitionJob(pool, jobId, 'cancel');
      };
      sweeper = startReconcileSweeper(deps(), { intervalMs: 60 * 60 * 1000, pollMs: 10 });
      await until(reachedTerminal(jobId));

      expect(await stateOf(jobId)).toBe('cancelled');
      /*
       * **남은 저장소를 돌지 않았다.** 이 저장소들은 이 시험이 만든 것이고
       * 활성 저장소가 넷이므로, 멈추지 않았다면 진입이 넷이 된다.
       */
      expect(probe.entries).toBeLessThan(4);
    } finally {
      await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::int[])', [extra]);
    }
  });
});

describe('취소가 완료로 덮이지 않는다 (DEV-196의 자리)', () => {
  it('스캔이 도는 중에 취소하면 종료 상태가 `cancelled`로 남는다', async () => {
    const jobId = await enqueueManual();

    // 스캔이 시작된 그 순간에 취소를 밀어 넣는다 — 완료 기록보다 먼저다.
    probe.onEnter = async () => {
      await jobRepo.transitionJob(pool, jobId, 'cancel');
    };
    sweeper = startReconcileSweeper(deps(), { intervalMs: 60 * 60 * 1000, pollMs: 10 });

    await until(reachedTerminal(jobId));
    expect(await stateOf(jobId)).toBe('cancelled');
  });

  it('취소된 잡을 러너가 다시 집지 않는다', async () => {
    const jobId = await enqueueManual();
    await jobRepo.transitionJob(pool, jobId, 'cancel');

    sweeper = startReconcileSweeper(deps(), { intervalMs: 60 * 60 * 1000, pollMs: 5 });
    // 주기 스윕이 첫 순회를 도는 동안 러너가 이 잡을 집을 창이 지나간다.
    await until(async () => probe.entries > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await stateOf(jobId)).toBe('cancelled');
    expect(await claimed(jobId)).toBe(false);
  });
});

describe('상태 전이가 표를 따른다', () => {
  it('`resume`이 `running`이 아니라 `queued`로 되돌려 claim을 다시 거친다', async () => {
    const jobId = await enqueueManual();
    await jobRepo.transitionJob(pool, jobId, 'pause');
    expect(await stateOf(jobId)).toBe('paused');

    const resumed = await jobRepo.transitionJob(pool, jobId, 'resume');
    expect(resumed?.state).toBe('queued');

    sweeper = startReconcileSweeper(deps(), { intervalMs: 60 * 60 * 1000, pollMs: 10 });
    await until(reachedTerminal(jobId));
    expect(await stateOf(jobId)).toBe('completed');
  });

  it('`paused` 잡은 러너가 집지 않는다', async () => {
    const jobId = await enqueueManual();
    await jobRepo.transitionJob(pool, jobId, 'pause');

    sweeper = startReconcileSweeper(deps(), { intervalMs: 60 * 60 * 1000, pollMs: 5 });
    await until(async () => probe.entries > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await stateOf(jobId)).toBe('paused');
    expect(await claimed(jobId)).toBe(false);
  });
});
