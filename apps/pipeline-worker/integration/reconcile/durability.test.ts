/**
 * 최근 **완료된** 조정 결과의 보존 (JOB-ING-005 / FR-ING-011 AC-6, WP-034 CR-050 DEV-352).
 *
 * ## 이 파일이 반증하는 결함
 *
 * 미룬 회차(`deferred`)의 부분 집계가 최근 결과를 덮으면, W-009가 보여 주는
 * 누락 건수는 **언제나 실제보다 작다.** 사용자는 그것을 "거의 다 수집됐다"로
 * 읽고, 이 화면의 목적이 정확히 그 오독을 막는 것이다.
 *
 * 예외로 끝난 회차도 마찬가지다 — 스캔이 죽었는데 마지막 성공 기록이 지워지면
 * 사용자는 "확인된 적이 없다"를 보게 되고, 그것도 사실이 아니다.
 *
 * **Prometheus counter를 대체하지 않는다.** 누적 추세와 시점 스냅숏은 답하는
 * 물음이 다르고, 지표 저장소가 없는 배치에서는 조회 서비스가 counter를 읽을
 * 방법 자체가 없다.
 *
 * 실행: `pnpm test:integration reconcile/durability`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GitHubApiError } from '@prs/github';
import { repositoryRepo, type Pool, type RepositoryRow } from '@prs/db';
import { reconcileRepository, type ReconcileDeps } from '../../src/reconcile.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 90730;
const ORG = 9073;
const NOW = new Date('2026-08-28T05:00:00Z');

let pool: Pool;
let repository: RepositoryRow;

interface Options {
  /** 색인에 없어 누락으로 셀 PR 번호. */
  readonly missing: readonly number[];
  /** 한도 소진으로 미룬다. */
  readonly rateLimited?: boolean;
  /** 스캔 도중 던진다. */
  readonly explode?: boolean;
  readonly now?: Date;
}

/** 실제 PostgreSQL만 쓰고 GitHub·ES는 목이다 — 이 파일이 묻는 것은 보존이다. */
function deps(options: Options): ReconcileDeps {
  const items = options.missing.map((number) => ({
    number,
    updated_at: '2026-08-28T04:00:00Z',
  }));

  return {
    pool,
    /*
     * 색인 조회가 전부 "없다"로 답해 스캔한 PR이 누락으로 세어진다.
     * `isIndexed`는 모듈 내부 함수라 주입할 수 없고, 그것이 부르는 것이
     * `deps.es`이므로 여기가 유일한 이음매다.
     */
    es: { search: () => Promise.resolve({ hits: { hits: [] } }) } as unknown as ReconcileDeps['es'],
    bus: { publish: () => Promise.resolve() } as unknown as ReconcileDeps['bus'],
    client: {
      listPullRequestsPage: () => {
        if (options.rateLimited === true) {
          throw new GitHubApiError('rate_limited', '한도 소진');
        }
        if (options.explode === true) throw new Error('스캔이 죽었다');
        return Promise.resolve({ items, hasMore: false });
      },
    } as unknown as ReconcileDeps['client'],
    metrics: {
      reconcileMissing: { inc: () => undefined },
      reconcileIncompleteCycles: { set: () => undefined },
    } as unknown as ReconcileDeps['metrics'],
    backfill: {} as unknown as ReconcileDeps['backfill'],
    // `sequence_branches`가 비어 있어 그래프를 쓰지 않지만 조립에는 필요하다.
    graphFor: () => ({ resolveHead: () => Promise.resolve(null) }) as unknown as ReturnType<
      ReconcileDeps['graphFor']
    >,
    reproject: () => Promise.resolve(true),
    now: () => options.now ?? NOW,
  } as unknown as ReconcileDeps;
}

async function reload(): Promise<RepositoryRow> {
  const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (row === undefined) throw new Error('픽스처 저장소가 사라졌다');
  return row;
}

beforeAll(async () => {
  pool = await migratedPool();
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'wp034r',
    name: 'durability',
    org_id: ORG,
    visibility: 'internal',
    sequence_branches: [],
  });
  repository = await reload();
}, 180_000);

beforeEach(async () => {
  await pool.query(
    'UPDATE repository SET last_reconciled_at = NULL, last_reconcile_missing_count = NULL WHERE repository_id = $1',
    [REPOSITORY_ID],
  );
});

afterAll(async () => {
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.end();
});

describe('완주한 회차만 기록한다 (AC-6)', () => {
  it('**완주하면 누락 건수와 시각을 남긴다**', async () => {
    const result = await reconcileRepository(deps({ missing: [1, 2, 3] }), repository);
    expect(result.deferred).toBe(false);
    expect(result.missing).toBe(3);

    const row = await reload();
    expect(row.last_reconcile_missing_count).toBe(3);
    expect(row.last_reconciled_at).not.toBeNull();
  });

  it('**미룬 회차가 앞선 완료 결과를 덮지 않는다** — 부분 집계는 언제나 실제보다 작다', async () => {
    await reconcileRepository(deps({ missing: [1, 2, 3] }), repository);
    const after = await reload();
    expect(after.last_reconcile_missing_count).toBe(3);

    const deferred = await reconcileRepository(deps({ missing: [], rateLimited: true }), repository);
    expect(deferred.deferred).toBe(true);

    const kept = await reload();
    expect(kept.last_reconcile_missing_count, 'DEV-352: 미룬 회차가 최근 결과를 덮었다').toBe(3);
    expect(kept.last_reconciled_at?.toISOString()).toBe(after.last_reconciled_at?.toISOString());
  });

  it('**예외로 끝난 회차도 덮지 않는다**', async () => {
    await reconcileRepository(deps({ missing: [1, 2] }), repository);
    const before = await reload();

    await expect(reconcileRepository(deps({ missing: [], explode: true }), repository)).rejects.toThrow();

    const kept = await reload();
    expect(kept.last_reconcile_missing_count).toBe(2);
    expect(kept.last_reconciled_at?.toISOString()).toBe(before.last_reconciled_at?.toISOString());
  });

  it('**다음 완주가 값을 갱신한다** — 0으로도 내려간다', async () => {
    await reconcileRepository(deps({ missing: [1, 2, 3] }), repository);
    expect((await reload()).last_reconcile_missing_count).toBe(3);

    const later = new Date('2026-08-28T06:00:00Z');
    await reconcileRepository(deps({ missing: [], now: later }), repository);

    const row = await reload();
    expect(row.last_reconcile_missing_count).toBe(0);
    expect(row.last_reconciled_at?.toISOString()).toBe(later.toISOString());
  });

  it('**0과 null이 다르다** — 확인된 영과 기록 없음은 다른 사실이다', async () => {
    const fresh = await reload();
    expect(fresh.last_reconcile_missing_count).toBeNull();
    expect(fresh.last_reconciled_at).toBeNull();

    await reconcileRepository(deps({ missing: [] }), repository);
    const scanned = await reload();
    expect(scanned.last_reconcile_missing_count).toBe(0);
    expect(scanned.last_reconciled_at).not.toBeNull();
  });
});

describe('지표를 대체하지 않는다', () => {
  it('**`reconcile_missing_total` counter가 그대로 증가한다**', async () => {
    const increments: unknown[] = [];
    const base = deps({ missing: [1, 2] });
    const withSpy = {
      ...base,
      metrics: {
        ...base.metrics,
        reconcileMissing: {
          inc: (labels: unknown) => {
            increments.push(labels);
          },
        },
      },
    } as unknown as ReconcileDeps;

    await reconcileRepository(withSpy, repository);
    expect(increments, 'PG 기록이 지표를 대체하면 운영 추세를 잃는다').toHaveLength(2);
    expect((await reload()).last_reconcile_missing_count).toBe(2);
  });
});

describe('음수 불변식', () => {
  it('음수 누락 건수는 스키마가 거절한다', async () => {
    await expect(
      pool.query('UPDATE repository SET last_reconcile_missing_count = -1 WHERE repository_id = $1', [
        REPOSITORY_ID,
      ]),
    ).rejects.toThrow(/repository_reconcile_missing_chk/);
  });
});
