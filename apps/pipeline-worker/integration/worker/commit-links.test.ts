/**
 * JOB-REL-007 커밋 관계 투영 (WP-101 / CR-116, FR-SRCH-002 AC-6).
 *
 * 실제 PostgreSQL·실제 Elasticsearch를 쓴다. 이 CR이 증명해야 할 것 대부분은
 * **클러스터와 데이터베이스의 동작 그 자체**다 — 세대 가드, 빈 배열과 필드 부재의
 * 차이, 트랜잭션 경계, lease 회수. 목으로 바꾸면 검증하려던 것을 건너뛴다.
 *
 * 검증: `pnpm test:integration worker/commit-links`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { prCommitLinkRepo, rawEventRepo, repositoryRepo, type Pool } from '@prs/db';
import { applyMappings, switchAliasesForTests, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import { RedisStreamsEventBus, type DeliveredEvent, type Redis } from '@prs/bus';
import { EVENT_NAMES, commitDocId, type IngestionEnriched } from '@prs/domain';
import { handleEnrichedEvent, type ProjectDeps } from '../../src/project.js';
import { runCommitLinkOnce } from '../../src/commit-links.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const REPOSITORY_ID = 7116;
const CORRELATION_ID = '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7ea';

/** PR #2355의 옛 base 아래 있던 dev 체인 커밋들. 사내 사례의 축소판이다. */
const SHA_A = 'aaaa111122223333444455556666777788889901';
const SHA_B = 'bbbb111122223333444455556666777788889902';
const SHA_C = 'cccc111122223333444455556666777788889903';
const MERGE_521 = 'dddd111122223333444455556666777788889904';
const MERGE_2355 = 'eeee111122223333444455556666777788889905';

let pool: Pool;
let redis: Redis;
let bus: RedisStreamsEventBus;
let es: Client;

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-08'] });
  redis = createTestRedis();
  bus = new RedisStreamsEventBus(redis);
  es = createEsClient(resolveClientOptions());
  await waitForCluster();
  await dropEntityIndices(es);
  await applyMappings(es);
  await switchAliasesForTests(es);
}, 120_000);

afterAll(async () => {
  await bus.close();
  redis.disconnect();
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  /*
   * **이 파일의 이름 공간만 정리한다.** 전역 DELETE는 다른 통합 파일의 픽스처를
   * 지우고, `(owner, name)` 유일 제약 때문에 저장소 이름도 겹치면 안 된다.
   */
  await pool.query('DELETE FROM commit_link_state WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_commit_link WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_link_observation WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM raw_event WHERE repository_id = $1', [REPOSITORY_ID]);
  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'acme',
    name: 'links',
    org_id: 77,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
});

async function waitForCluster(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Elasticsearch가 준비되지 않았다: ${String(lastError)}`);
}

interface ProjectOptions {
  readonly prNumber: number;
  readonly sourceShas: readonly string[];
  readonly receivedAt: Date;
  readonly merged?: boolean;
  /**
   * `merged_at`을 `merged`와 **따로** 준다 (CR-116).
   *
   * 백필이 쓰는 `GET /pulls` 목록 끝점은 `merged`를 아예 주지 않고 `merged_at`만
   * 준다. 두 값이 함께 움직이는 도우미로는 그 모양을 만들 수 없고, 만들지 못하면
   * "목록으로 읽은 병합 PR"이 어떻게 취급되는지도 시험할 수 없다.
   */
  readonly mergedAt?: string | null;
  readonly mergeSha?: string | null;
  readonly complete?: boolean;
  readonly commitsCount?: number | null;
  readonly errors?: IngestionEnriched['enrichment_errors'];
  readonly deliveryId?: string;
}

/** PR 하나를 투영한다 — 실시간 경로 그대로다. 관계 채택도 이 경로에서 일어난다. */
async function project(options: ProjectOptions): Promise<void> {
  const merged = options.merged ?? true;
  const mergedAt = options.mergedAt === undefined ? (merged ? '2026-08-19T10:00:00.000Z' : null) : options.mergedAt;
  const closed = merged || mergedAt !== null;
  const deliveryId = options.deliveryId ?? `d-${String(options.prNumber)}-${String(options.receivedAt.getTime())}`;
  await rawEventRepo.insertRawEventIfAbsent(pool, {
    delivery_id: deliveryId,
    event_type: 'pull_request',
    action: 'closed',
    repository_id: REPOSITORY_ID,
    received_at: options.receivedAt,
    payload: { number: options.prNumber },
    payload_hash: 'a'.repeat(64),
    correlation_id: CORRELATION_ID,
    queued_at: options.receivedAt,
  });

  const enriched: IngestionEnriched = {
    delivery_id: deliveryId,
    repository_id: REPOSITORY_ID,
    entity_kind: 'pull_request',
    pr_number: options.prNumber,
    pull_request: {
      number: options.prNumber,
      title: `PR ${String(options.prNumber)}`,
      body: null,
      state: closed ? 'closed' : 'open',
      draft: false,
      labels: [],
      merged,
      created_at: '2026-08-19T09:00:00.000Z',
      updated_at: '2026-08-19T10:00:00.000Z',
      closed_at: closed ? '2026-08-19T10:00:00.000Z' : null,
      merged_at: mergedAt,
      merge_commit_sha: options.mergeSha === undefined ? null : options.mergeSha,
      author: 'dev',
      head_ref: `feature/${String(options.prNumber)}`,
      head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e',
      base_ref: 'main',
      base_sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e',
      commits_count: options.commitsCount === undefined ? options.sourceShas.length : options.commitsCount,
    },
    source_commit_shas: options.sourceShas,
    changed_files: [{ filename: 'src/a.ts', additions: 1, deletions: 0, status: 'modified' }],
    reviews: [],
    source_commits_truncated: false,
    source_commits_complete: options.complete ?? true,
    files_truncated: false,
    enrichment_pending: (options.errors ?? []).length > 0,
    enrichment_errors: options.errors ?? [],
    correlation_id: CORRELATION_ID,
  };

  const event: DeliveredEvent = {
    event_id: `evt-${deliveryId}`,
    event_name: EVENT_NAMES.ingestionEnriched,
    correlation_id: CORRELATION_ID,
    occurred_at: options.receivedAt.toISOString(),
    partition_key: String(REPOSITORY_ID),
    partition: 0,
    delivery_count: 1,
    message_id: 'm-1',
    payload: enriched,
  };

  const deps: ProjectDeps = { pool, bus, es, metrics: createWorkerMetrics(), sleep: async (): Promise<void> => undefined };
  const outcome = await handleEnrichedEvent(deps, event);
  expect(outcome.disposition.kind).toBe('ack');
}

/** 관계 투영 러너를 수렴할 때까지 돌린다. */
async function drainLinks(): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (let round = 0; round < 20; round += 1) {
    const cycle = await runCommitLinkOnce({ pool, es, metrics: createWorkerMetrics(), withWrite: (run) => run({ shadows: {} }), repositoryId: REPOSITORY_ID });
    for (const [key, value] of Object.entries(cycle.outcomes)) totals[key] = (totals[key] ?? 0) + value;
    if (cycle.claimed === 0) break;
  }
  await es.indices.refresh({ index: 'prs-commits' });
  return totals;
}

/** 커밋 문서의 `_source`를 그대로 읽는다. **`exists` 질의로 대신하지 않는다.** */
async function linkSource(sha: string): Promise<{ numbers?: readonly number[]; generation?: number; state?: string } | null> {
  try {
    const found = await es.get<{ pull_request_numbers?: readonly number[]; pr_links_generation?: number; pr_links_state?: string }>({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, sha),
      routing: String(REPOSITORY_ID),
    });
    const source = found._source;
    if (source === undefined) return null;
    return {
      ...(source.pull_request_numbers === undefined ? {} : { numbers: source.pull_request_numbers }),
      ...(source.pr_links_generation === undefined ? {} : { generation: source.pr_links_generation }),
      ...(source.pr_links_state === undefined ? {} : { state: source.pr_links_state }),
    };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null;
    throw error;
  }
}

describe('목록 축소 (FR-SRCH-002 AC-6)', () => {
  it('빠진 커밋에서 그 PR만 지우고 다른 PR의 연결은 보존한다', async () => {
    // C는 PR 521과 2355 둘 다에 속한다 — 상류 보고의 그 모양이다.
    await project({ prNumber: 521, sourceShas: [SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await project({ prNumber: 2355, sourceShas: [SHA_A, SHA_B, SHA_C], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T10:01:00Z') });
    await drainLinks();

    expect((await linkSource(SHA_C))?.numbers).toEqual([521, 2355]);

    // PR 2355가 rebase되어 원본 목록이 줄었다. **완전한 관측**이므로 삭제 권한이 있다.
    await project({ prNumber: 2355, sourceShas: [SHA_A], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T11:00:00Z') });
    await drainLinks();

    // C에서는 2355만 빠지고 521은 남는다. 이것이 이 CR의 전부다.
    expect((await linkSource(SHA_C))?.numbers).toEqual([521]);
    // A는 아직 2355의 것이다 — 남은 목록에 있기 때문이다.
    expect((await linkSource(SHA_A))?.numbers).toEqual([2355]);
  });

  it('PR 2400이 같은 커밋을 담으면 [521, 2400]을 유지한다', async () => {
    await project({ prNumber: 521, sourceShas: [SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await project({ prNumber: 2355, sourceShas: [SHA_C], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T10:01:00Z') });
    await project({ prNumber: 2400, sourceShas: [SHA_C], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T10:02:00Z') });
    await drainLinks();
    expect((await linkSource(SHA_C))?.numbers).toEqual([521, 2355, 2400]);

    await project({ prNumber: 2355, sourceShas: [], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T11:00:00Z') });
    await drainLinks();
    expect((await linkSource(SHA_C))?.numbers).toEqual([521, 2400]);
  });

  it('늦게 도착한 옛 이벤트가 지워진 번호를 되살리지 못한다', async () => {
    await project({ prNumber: 2355, sourceShas: [SHA_A, SHA_C], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    await project({ prNumber: 2355, sourceShas: [SHA_A], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T11:00:00Z') });
    await drainLinks();
    expect((await linkSource(SHA_C))?.numbers).toEqual([]);

    /*
     * **여기가 합집합 시절의 결함이 다시 들어오던 자리다.** 옛 목록을 실은
     * 이벤트가 늦게 도착해도 관측 버전이 낮으므로 채택되지 않는다.
     */
    await project({
      prNumber: 2355,
      sourceShas: [SHA_A, SHA_C],
      merged: false,
      mergeSha: null,
      receivedAt: new Date('2026-08-19T10:30:00Z'),
      deliveryId: 'late-replay',
    });
    await drainLinks();
    expect((await linkSource(SHA_C))?.numbers).toEqual([]);
  });
});

describe('삭제 권한 (불완전한 목록으로 지우지 않는다)', () => {
  it('commits 조회가 실패한 관측은 지우지 못한다', async () => {
    await project({ prNumber: 900, sourceShas: [SHA_A, SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    expect((await linkSource(SHA_C))?.numbers).toEqual([900]);

    // 조회 실패로 나온 `[]`는 **빈 목록이 아니라 모름이다.**
    await project({
      prNumber: 900,
      sourceShas: [],
      mergeSha: MERGE_521,
      receivedAt: new Date('2026-08-19T11:00:00Z'),
      complete: false,
      commitsCount: null,
      errors: [{ component: 'commits', kind: 'server_error', message: '502' }],
    });
    await drainLinks();

    expect((await linkSource(SHA_C))?.numbers).toEqual([900]);
    const observation = await prCommitLinkRepo.findLinkObservation(pool, REPOSITORY_ID, 900);
    expect(observation?.verification_state).toBe('pending_refetch');
    expect(observation?.commits_error_kind).toBe('commits:server_error');
  });

  it('리뷰만 실패한 관측은 **지울 수 있다** — 커밋 목록은 온전하다', async () => {
    await project({ prNumber: 901, sourceShas: [SHA_A, SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();

    await project({
      prNumber: 901,
      sourceShas: [SHA_A],
      mergeSha: MERGE_521,
      receivedAt: new Date('2026-08-19T11:00:00Z'),
      errors: [{ component: 'reviews', kind: 'server_error', message: '502' }],
    });
    await drainLinks();

    expect((await linkSource(SHA_C))?.numbers).toEqual([]);
    expect((await prCommitLinkRepo.findLinkObservation(pool, REPOSITORY_ID, 901))?.verification_state).toBe('verified');
  });

  it('원격이 말한 커밋 수와 읽은 수가 다르면 지우지 못한다 (API 자체 상한)', async () => {
    await project({ prNumber: 902, sourceShas: [SHA_A, SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();

    /*
     * 250건을 읽었는데 원격은 400건이라고 말한다. `truncated`는 거짓이다 —
     * GitHub이 250에서 자르면 마지막 페이지가 짧아 `rel="next"`가 없기 때문이다.
     * 보강 워커가 그 불일치를 보고 `source_commits_complete`를 세우지 않는다.
     */
    await project({
      prNumber: 902,
      sourceShas: [SHA_A],
      mergeSha: MERGE_521,
      receivedAt: new Date('2026-08-19T11:00:00Z'),
      complete: false,
      commitsCount: 400,
    });
    await drainLinks();
    expect((await linkSource(SHA_C))?.numbers).toEqual([902]);
  });
});

describe('열린 PR과 실제 병합 근거', () => {
  it('열린 PR의 시험용 merge_commit_sha를 병합으로 취급하지 않는다', async () => {
    await project({ prNumber: 910, sourceShas: [SHA_A], merged: false, mergeSha: MERGE_2355, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    // 그 SHA에는 연결이 생기지 않는다 — 문서 자체가 없다.
    expect(await linkSource(MERGE_2355)).toBeNull();
    // 정상적으로 연결된 열린 PR의 원본 커밋은 그대로 보인다.
    expect((await linkSource(SHA_A))?.numbers).toEqual([910]);
  });

  it('원본에서 빠져도 같은 PR의 실제 병합 근거는 남는다', async () => {
    await project({ prNumber: 911, sourceShas: [SHA_A, MERGE_521], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    expect((await linkSource(MERGE_521))?.numbers).toEqual([911]);

    // 원본 목록에서 머지 커밋이 빠져도 `merge` 근거가 남아 연결이 유지된다.
    await project({ prNumber: 911, sourceShas: [SHA_A], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T11:00:00Z') });
    await drainLinks();
    expect((await linkSource(MERGE_521))?.numbers).toEqual([911]);
  });

  it('백필이 지나가도 병합 근거를 지우지 않는다 — 목록 끝점은 `merged`를 주지 않는다', async () => {
    /*
     * **백필이 스스로 관계를 되돌리던 자리다** (CR-116).
     *
     * `GET /pulls` 목록 끝점의 응답에는 `merged`가 없다. 병합을 말하는 것은
     * `merged_at`뿐이고, 그래서 목록으로 읽은 PR은 `merged === false`로 들어온다.
     * 그 모양을 "병합이 아니다"로 읽으면 `merge` 근거가 `null`이 되는데, 목록은
     * 원격을 직접 읽은 것이라 `pullRequestAuthoritative`가 참이다 — 삭제 권한이
     * 있는 관측이 병합을 부정하는 것이므로, **백필이 한 바퀴 돌 때마다 멀쩡한
     * 병합 근거가 지워진다.** 웹훅은 그 관계를 다시 만들어 주지 않는다. 그 PR에는
     * 더 일어날 일이 없기 때문이다.
     */
    await project({ prNumber: 990, sourceShas: [SHA_A], mergeSha: MERGE_2355, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    expect((await linkSource(MERGE_2355))?.numbers).toEqual([990]);

    // 백필이 목록으로 같은 PR을 다시 읽는다. 모양은 목록 끝점이 주는 그대로다.
    await project({
      prNumber: 990,
      sourceShas: [SHA_A],
      merged: false,
      mergedAt: '2026-08-19T10:00:00.000Z',
      mergeSha: MERGE_2355,
      receivedAt: new Date('2026-08-19T11:00:00Z'),
    });
    await drainLinks();

    // 목록의 모양도 병합으로 읽혔다 — 그 판정 하나가 아래 두 줄을 지킨다.
    expect((await prCommitLinkRepo.findLinkObservation(pool, REPOSITORY_ID, 990))?.pr_state).toBe('merged');
    expect(await prCommitLinkRepo.listLinkedPullRequestNumbers(pool, REPOSITORY_ID, MERGE_2355)).toEqual([990]);
    expect((await linkSource(MERGE_2355))?.numbers).toEqual([990]);
  });
});

describe('빈 배열·미확정·세대', () => {
  it('마지막 연결이 사라지면 `[]`를 _source에 저장하고 필드를 지우지 않는다', async () => {
    await project({ prNumber: 920, sourceShas: [SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    await project({ prNumber: 920, sourceShas: [], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T11:00:00Z') });
    await drainLinks();

    const source = await linkSource(SHA_C);
    // **`exists` 질의로 판별하지 않는다** — `[]`와 필드 부재를 같게 본다.
    expect(source?.numbers).toEqual([]);
    expect(source?.state).toBe('verified');

    // tombstone: 세대가 남아 늦은 옛 쓰기를 거절한다.
    const state = await prCommitLinkRepo.findCommitLinkState(pool, REPOSITORY_ID, SHA_C);
    expect(Number(state?.generation)).toBeGreaterThanOrEqual(2);
    expect(state?.projected_numbers).toEqual([]);
  });

  it('연결이 있는 커밋과 아직 모르는 커밋을 색인이 구분한다', async () => {
    await project({ prNumber: 930, sourceShas: [SHA_A], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    // 투영이 만든 문서에는 관계 필드가 **아직 없다**. 러너가 채운 뒤에야 생긴다.
    expect((await linkSource(SHA_A))?.numbers).toEqual([930]);
    // 이 저장소가 모르는 커밋은 문서 자체가 없다 — `[]`와 다른 사실이다.
    expect(await linkSource(SHA_B)).toBeNull();
  });

  it('같은 세대의 같은 집합은 멱등이고, 다시 돌려도 쓰기가 없다', async () => {
    await project({ prNumber: 940, sourceShas: [SHA_A], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();
    const before = await linkSource(SHA_A);

    // 세대를 되돌려 러너가 같은 집합을 다시 쓰게 만든다.
    await pool.query('UPDATE commit_link_state SET projected_generation = 0, state = $3 WHERE repository_id = $1 AND commit_sha = $2', [REPOSITORY_ID, SHA_A, 'ready']);
    const totals = await drainLinks();
    expect(totals['noop']).toBeGreaterThanOrEqual(1);
    expect((await linkSource(SHA_A))?.generation).toBe(before?.generation);
  });

  it('같은 세대의 다른 집합은 충돌로 기록하고 덮어쓰지 않는다', async () => {
    await project({ prNumber: 950, sourceShas: [SHA_A], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();

    /*
     * 구버전 합집합 writer가 번호를 더한 상황을 그대로 만든다. 세대는 그대로인데
     * 집합이 다르다 — 우리가 쓰지 않은 쓰기가 있었다는 뜻이고, 덮으면 그 증거가
     * 사라진다.
     */
    await es.update({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, SHA_A),
      routing: String(REPOSITORY_ID),
      refresh: true,
      script: { lang: 'painless', source: 'ctx._source.pull_request_numbers = params.n', params: { n: [950, 9999] } },
    });
    await pool.query('UPDATE commit_link_state SET projected_generation = 0, state = $3 WHERE repository_id = $1 AND commit_sha = $2', [REPOSITORY_ID, SHA_A, 'ready']);

    const totals = await drainLinks();
    expect(totals['conflict']).toBe(1);
    expect((await linkSource(SHA_A))?.numbers).toEqual([950, 9999]);
    const state = await prCommitLinkRepo.findCommitLinkState(pool, REPOSITORY_ID, SHA_A);
    expect(state?.state).toBe('parked');
    expect(state?.conflict_at).not.toBeNull();
  });
});

describe('중단과 재개', () => {
  it('PG 커밋 직후 죽어도 할 일이 남아 다음 회차가 수렴한다', async () => {
    await project({ prNumber: 960, sourceShas: [SHA_A, SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await drainLinks();

    // 관계만 바꾸고 러너를 돌리지 않는다 — 프로세스가 ES 쓰기 전에 죽은 모양이다.
    await project({ prNumber: 960, sourceShas: [SHA_A], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T11:00:00Z') });
    expect((await linkSource(SHA_C))?.numbers).toEqual([960]);
    const pending = await prCommitLinkRepo.countPendingCommitLinks(pool, REPOSITORY_ID);
    expect(Object.values(pending).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);

    await drainLinks();
    expect((await linkSource(SHA_C))?.numbers).toEqual([]);
  });

  it('lease가 만료돼도 다른 회차가 회수해 끝낸다', async () => {
    await project({ prNumber: 970, sourceShas: [SHA_A], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });

    // 집어만 두고 놓지 않은 상태를 만든다.
    const claimed = await prCommitLinkRepo.claimDueCommitLinks(pool, { limit: 10, leaseMs: 60_000, repositoryId: REPOSITORY_ID });
    expect(claimed.length).toBeGreaterThan(0);
    await pool.query("UPDATE commit_link_state SET lease_until = now() - interval '1 second' WHERE repository_id = $1", [REPOSITORY_ID]);

    await drainLinks();
    expect((await linkSource(SHA_A))?.numbers).toEqual([970]);
  });
});

describe('여러 PR의 동시 변경', () => {
  it('한 회차에 add와 remove가 섞여도 정상 관계를 잃지 않는다', async () => {
    await project({ prNumber: 980, sourceShas: [SHA_A, SHA_B], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T10:00:00Z') });
    await project({ prNumber: 981, sourceShas: [SHA_B, SHA_C], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T10:01:00Z') });
    await drainLinks();
    expect((await linkSource(SHA_B))?.numbers).toEqual([980, 981]);

    // 980은 B를 잃고 C를 얻는다. 981은 B를 잃고 A를 얻는다. 둘을 한 회차에 흘린다.
    await project({ prNumber: 980, sourceShas: [SHA_A, SHA_C], mergeSha: MERGE_521, receivedAt: new Date('2026-08-19T11:00:00Z') });
    await project({ prNumber: 981, sourceShas: [SHA_A, SHA_C], merged: false, mergeSha: null, receivedAt: new Date('2026-08-19T11:01:00Z') });
    await drainLinks();

    expect((await linkSource(SHA_A))?.numbers).toEqual([980, 981]);
    expect((await linkSource(SHA_B))?.numbers).toEqual([]);
    expect((await linkSource(SHA_C))?.numbers).toEqual([980, 981]);
  });
});
