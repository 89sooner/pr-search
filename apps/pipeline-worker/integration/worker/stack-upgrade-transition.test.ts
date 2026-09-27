/**
 * 업그레이드 직후 스택 표시의 자동 복구 (WP-107 / CR-126, DEV-773, FR-REL-006 AC-3·AC-6, OD-017).
 *
 * CR-121 전 판(`0.1.0-pilot.18`까지)은 스택의 성립·해제를 Elasticsearch 간선에만 두었다. 새 판으로
 * 올린 뒤 운영자가 `prsctl links import-stacks`를 돌리기 전에는 그 관계가 PostgreSQL 정본
 * (`pull_request_stack`)에 없다. 그 사이 상위 PR이 병합·종료·head 변경되거나 하위 PR이 retarget되면,
 * 파생이 정본만 보므로 옛 간선이 해제로 다시 쓰이지 않고 `detached: false`·`has_stack: true`로 굳는다.
 *
 * **실제 PostgreSQL · 실제 Elasticsearch를 쓴다.** 옛 상태는 간선 문서를 서비스 인덱스에 직접 쓰고 정본
 * 행은 두지 않아 만든다 — CR-121 전 판이 남긴 모양 그대로다(끝점으로 만든 `link_id`, DEV-238). 옛 간선의
 * 근거·시각은 지금 스냅숏과 다른 값으로 두어, 해제된 관계가 **옛 값을 지키는지** 가를 수 있게 한다.
 *
 * 검증: `pnpm run test:integration worker/stack-upgrade-transition`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { pullRequestDocId } from '@prs/domain';
import {
  prSnapshotRepo,
  repositoryRepo,
  type Pool,
  type RepositoryRow,
  type StackRow,
} from '@prs/db';
import {
  SERVING_ONLY,
  applyMappings,
  createEsClient,
  resolveClientOptions,
  switchAliasesForTests,
  writeDerivedLinks,
} from '@prs/es';
import type { LinkDeps } from '../../src/link.js';
import { handleRelationsReady, stackDocsFromRows } from '../../src/relations.js';
import { importServingStacks } from '../../src/stack-import.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 4931;
const OWNER = 'acme';
const NAME = 'stack-dev773';
const TEAM = 7331;

/** 옛 판이 남긴 간선의 근거·시각 — 지금 스냅숏(`2026-08-01…`)과 일부러 다르다. */
const LEGACY_AT = '2026-07-15T09:30:00.000Z';
const SNAPSHOT_AT = '2026-08-01T00:00:00.000Z';

let pool: Pool;
let es: Client;
let repository: RepositoryRow;

const prSource = (n: number) => ({ kind: 'pull_request' as const, id: String(n) });

function baseDeps(overrides: Partial<LinkDeps> = {}): LinkDeps {
  return {
    pool,
    es,
    bus: { publish: () => Promise.resolve() } as unknown as EventBus,
    metrics: createWorkerMetrics(),
    gheHost: null,
    log: () => undefined,
    refresh: true,
    ...overrides,
  };
}

/** 이벤트 소비자의 deps — 운영(`index.ts`)은 이벤트 핸들러에만 전환기 보완을 켠다 (CR-126). */
function eventDeps(overrides: Partial<LinkDeps> = {}): LinkDeps {
  return baseDeps({ servingStackImport: true, ...overrides });
}

async function seedPullRequest(input: {
  readonly number: number;
  readonly state?: string;
  readonly base?: string;
  readonly head?: string;
}): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    prNumber: input.number,
    documentVersion: Date.now(),
    source: 'webhook',
    document: {
      pr_number: input.number,
      title: `PR ${String(input.number)}`,
      body: '',
      state: input.state ?? 'open',
      base_branch: input.base ?? 'main',
      head_branch: input.head ?? `feature-${String(input.number)}`,
      updated_at: SNAPSHOT_AT,
    },
  });
}

/** PR 색인 문서. 옛 판의 요약(`has_stack`)을 그대로 싣는다 — 새 판이 다시 계산해야 할 값이다. */
async function indexPullRequest(prNumber: number, hasStack: boolean): Promise<void> {
  await es.index({
    index: 'prs-pull-requests',
    id: pullRequestDocId(REPOSITORY_ID, prNumber),
    routing: String(REPOSITORY_ID),
    refresh: true,
    document: {
      document_version: 1,
      repository_id: REPOSITORY_ID,
      repository: `${OWNER}/${NAME}`,
      org_id: 1,
      visibility: 'private',
      allowed_team_ids: [TEAM],
      pr_number: prNumber,
      links_pending: false,
      link_summary: { reference_count: 0, has_stack: hasStack },
    },
  });
}

/**
 * CR-121 전 판이 남긴 스택 간선 — **서비스 인덱스에만** 있고 정본 행은 없다.
 *
 * 문서는 새 판과 같은 함수(`stackDocsFromRows`)로 만든다. `link_id`는 끝점에서 나오므로(DEV-238) 옛 판의
 * 문서와 같은 ID다 — 그 호환은 격리 compose에서 실제 옛 판 간선으로 따로 확인한다(원장 6.117장).
 */
async function legacyStackEdge(input: {
  readonly child: number;
  readonly parent: number;
  readonly detached: boolean;
}): Promise<void> {
  const row: StackRow = {
    repository_id: REPOSITORY_ID,
    child_pr_number: input.child,
    parent_pr_number: input.parent,
    evidence: `legacy base = head of #${String(input.parent)}`,
    edge_created_at: LEGACY_AT,
    detached: input.detached,
    origin: 'imported',
  };
  const write = await writeDerivedLinks(es, stackDocsFromRows(repository, [row]), SERVING_ONLY, { refresh: true });
  expect(write.failures).toEqual([]);
  expect(await stackRows(input.child)).toEqual([]);
}

async function stackEdges(child: number): Promise<readonly Record<string, unknown>[]> {
  await es.indices.refresh({ index: 'prs-links' });
  const response = await es.search<Record<string, unknown>>({
    index: 'prs-links',
    size: 50,
    sort: [{ link_id: 'asc' }],
    query: {
      bool: {
        filter: [
          { term: { repository_id: REPOSITORY_ID } },
          { term: { link_type: 'stacks_on' } },
          { term: { from_id: pullRequestDocId(REPOSITORY_ID, child) } },
        ],
      },
    },
  });
  return response.hits.hits.map((hit) => ({ _id: hit._id, ...hit._source }));
}

interface RowView {
  readonly parent: number;
  readonly detached: boolean;
  readonly origin: string;
  readonly evidence: string;
  readonly at: string;
}

async function stackRows(child: number): Promise<readonly RowView[]> {
  const result = await pool.query<{
    parent_pr_number: number;
    detached: boolean;
    origin: string;
    evidence: string;
    edge_created_at: string;
  }>(
    `SELECT parent_pr_number, detached, origin, evidence, edge_created_at FROM pull_request_stack
      WHERE repository_id = $1 AND child_pr_number = $2 ORDER BY parent_pr_number`,
    [REPOSITORY_ID, child],
  );
  return result.rows.map((row) => ({
    parent: Number(row.parent_pr_number),
    detached: row.detached,
    origin: row.origin,
    evidence: row.evidence,
    at: row.edge_created_at,
  }));
}

async function hasStack(prNumber: number): Promise<unknown> {
  await es.indices.refresh({ index: 'prs-pull-requests' });
  const response = await es.get<Record<string, unknown>>({
    index: 'prs-pull-requests',
    id: pullRequestDocId(REPOSITORY_ID, prNumber),
    routing: String(REPOSITORY_ID),
  });
  return (response._source?.['link_summary'] as Record<string, unknown> | undefined)?.['has_stack'];
}

/** 하위 51 ← 52 스택을 옛 판 상태로 둔다: 둘 다 열려 있고, 간선은 색인에만 있다. */
async function legacyPair(): Promise<void> {
  await seedPullRequest({ number: 51, head: 'feature-p', base: 'main' });
  await seedPullRequest({ number: 52, head: 'feature-c', base: 'feature-p' });
  await indexPullRequest(51, false);
  await indexPullRequest(52, true);
  await legacyStackEdge({ child: 52, parent: 51, detached: false });
}

/** 서비스 인덱스의 스택 조회 가운데 **한 PR로 좁힌 것**인가 — 끝점 term이 있다. */
function isScopedStackRead(request: unknown): boolean {
  const filter = ((request as { query?: { bool?: { filter?: unknown } } } | undefined)?.query?.bool?.filter ?? []) as unknown[];
  const terms = filter.map((one) => (one as { term?: Record<string, unknown> }).term ?? {});
  const isStack = terms.some((term) => term['link_type'] === 'stacks_on');
  const scoped = terms.some((term) => 'from_id' in term || 'to_id' in term);
  return isStack && scoped;
}

/** 좁힌 스택 조회만 실패시키거나 일부만 읽힌 응답으로 바꾼다. 나머지 조회는 그대로다. */
function withStackReadFault(inner: Client, mode: 'throw' | 'timed_out' | 'shard_failure'): Client {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'search') {
        return async (request: unknown, options?: unknown) => {
          if (isScopedStackRead(request)) {
            if (mode === 'throw') throw new Error('시험: 서비스 인덱스 조회 실패');
            const response = (await target.search(request as never, options as never)) as unknown as Record<string, unknown>;
            if (mode === 'timed_out') return { ...response, timed_out: true };
            const shards = response['_shards'] as Record<string, unknown>;
            return { ...response, _shards: { ...shards, failed: 1 } };
          }
          return target.search(request as never, options as never);
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** 스택 조회 요청을 모두 기록한다(범위 확인). */
function recordingStackReads(inner: Client, seen: unknown[]): Client {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'search') {
        return (request: unknown, options?: unknown) => {
          const filter = ((request as { query?: { bool?: { filter?: unknown } } } | undefined)?.query?.bool?.filter ?? []) as unknown[];
          if (filter.some((one) => (one as { term?: Record<string, unknown> }).term?.['link_type'] === 'stacks_on')) {
            seen.push(request);
          }
          return target.search(request as never, options as never);
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * 하위 PR `child`의 해제 판정(`reconcileStacks`의 해제 UPDATE)만 한 번 실패시킨다 — 옮긴 뒤, 판정을 확정하기
 * 전에 워커가 끊긴 모양이다. 옮기기는 풀의 자동 커밋 질의라 이미 남고, 판정 트랜잭션은 되돌려진다.
 */
function failDetachOnce(inner: Pool, child: number): Pool {
  let tripped = false;
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'connect') {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(c, p, r) {
              if (p === 'query') {
                return (text: unknown, params?: unknown) => {
                  if (
                    !tripped &&
                    typeof text === 'string' &&
                    text.includes('SET detached = true') &&
                    Array.isArray(params) &&
                    params[1] === child
                  ) {
                    tripped = true;
                    return Promise.reject(new Error('시험: 해제 판정 직전 끊김'));
                  }
                  return (c.query as (...args: unknown[]) => unknown).call(c, text, params);
                };
              }
              const value = Reflect.get(c, p, r) as unknown;
              return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(c) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe('업그레이드 직후 PostgreSQL에 없는 스택 관계 (DEV-773 / CR-126)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    es = createEsClient(resolveClientOptions());
    await es.cluster.health({ wait_for_status: 'yellow', timeout: '60s' });
    await applyMappings(es);
    await switchAliasesForTests(es);
  }, 180_000);

  /**
   * **끝날 때 자기 저장소를 치운다.** 이 파일은 일부러 정본 행 없는 스택 간선을 남기는 사례로 끝난다 — 그대로 두면
   * 저장소 전체를 재색인하는 다른 시험(`links-reindex-completeness`)이 그것을 「옮기지 않은 간선」으로 세어
   * 전환을 막는다(순서에 따라 그 시험이 실패한다).
   */
  async function clearRepository(): Promise<void> {
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM pull_request_stack WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
    for (const index of ['prs-links', 'prs-pull-requests']) {
      await es.indices.refresh({ index });
      await es.deleteByQuery({ index, refresh: true, conflicts: 'proceed', query: { term: { repository_id: REPOSITORY_ID } } });
    }
  }

  afterAll(async () => {
    if (pool !== undefined && es !== undefined) await clearRepository();
    await es?.close();
    await pool?.end();
  }, 60_000);

  beforeEach(async () => {
    await clearRepository();
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: 1,
      visibility: 'private',
      sequence_branches: ['main'],
      mirror_enabled: false,
      status: 'active',
    });
    await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM]);
    repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;
  }, 60_000);

  /* --------------------------------------------------------------------- */
  /* 상위 PR 경로 — 상위 PR의 변화로 하위 PR을 찾는다                            */
  /* --------------------------------------------------------------------- */

  it.each(['merged', 'closed'])(
    '가져오기 전에 상위 PR이 %s되면 하위 PR 이벤트 없이 옛 간선이 해제되고, 옛 근거·시각이 정본과 간선에 남는다 (AC-3·AC-6)',
    async (state) => {
      await legacyPair();
      const before = await stackEdges(52);

      await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state });
      await handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY);

      const after = await stackEdges(52);
      // 같은 문서가 해제로 다시 쓰인다 — 새 문서가 생기거나 옛 문서가 남지 않는다.
      expect(after.map((one) => one['_id'])).toEqual(before.map((one) => one['_id']));
      expect(after[0]).toMatchObject({ detached: true, created_at: LEGACY_AT, evidence: 'legacy base = head of #51' });
      expect(await stackRows(52)).toEqual([
        { parent: 51, detached: true, origin: 'imported', evidence: 'legacy base = head of #51', at: LEGACY_AT },
      ]);
      expect(await hasStack(52)).toBe(false);
    },
  );

  it('상위 PR의 head가 바뀌어 **지금 분기로는 하위 PR을 찾지 못해도**, 옛 간선으로 찾아 해제한다', async () => {
    await legacyPair();

    // 상위 PR의 head가 바뀐다. 하위 PR의 base는 옛 head 그대로다 — `base = head` 조회로는 닿지 않는다.
    await seedPullRequest({ number: 51, head: 'feature-p-v2', base: 'main' });
    await handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY);

    const after = await stackEdges(52);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ detached: true, created_at: LEGACY_AT });
    expect(await stackRows(52)).toEqual([
      { parent: 51, detached: true, origin: 'imported', evidence: 'legacy base = head of #51', at: LEGACY_AT },
    ]);
    expect(await hasStack(52)).toBe(false);
  });

  /* --------------------------------------------------------------------- */
  /* 하위 PR 경로 — 하위 PR 자체를 다시 처리한다                                */
  /* --------------------------------------------------------------------- */

  it('하위 PR이 다른 상위로 retarget하면 옛 관계는 옛 근거·시각으로 해제되고 새 관계가 성립한다', async () => {
    await legacyPair();
    await seedPullRequest({ number: 53, head: 'feature-q', base: 'main' });
    await indexPullRequest(53, false);

    await seedPullRequest({ number: 52, head: 'feature-c', base: 'feature-q' });
    await handleRelationsReady(eventDeps(), repository, prSource(52), SERVING_ONLY);

    const after = await stackEdges(52);
    expect(after).toHaveLength(2);
    const byParent = new Map(after.map((one) => [one['to_id'], one]));
    expect(byParent.get(pullRequestDocId(REPOSITORY_ID, 51))).toMatchObject({ detached: true, created_at: LEGACY_AT });
    expect(byParent.get(pullRequestDocId(REPOSITORY_ID, 53))).toMatchObject({ detached: false, created_at: SNAPSHOT_AT });
    expect(await stackRows(52)).toEqual([
      { parent: 51, detached: true, origin: 'imported', evidence: 'legacy base = head of #51', at: LEGACY_AT },
      { parent: 53, detached: false, origin: 'derived', evidence: 'base feature-q = head of #53', at: SNAPSHOT_AT },
    ]);
    expect(await hasStack(52)).toBe(true);
  });

  it('이미 해제된 과거 이력은 지워지지 않고 정본으로 옮겨져 해제 상태 그대로 남는다', async () => {
    await seedPullRequest({ number: 61, head: 'feature-old', base: 'main', state: 'merged' });
    await seedPullRequest({ number: 62, head: 'feature-c2', base: 'main' });
    await indexPullRequest(61, false);
    await indexPullRequest(62, false);
    await legacyStackEdge({ child: 62, parent: 61, detached: true });

    await handleRelationsReady(eventDeps(), repository, prSource(62), SERVING_ONLY);

    const after = await stackEdges(62);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ detached: true, created_at: LEGACY_AT, evidence: 'legacy base = head of #61' });
    expect(await stackRows(62)).toEqual([
      { parent: 61, detached: true, origin: 'imported', evidence: 'legacy base = head of #61', at: LEGACY_AT },
    ]);
  });

  it('옮긴 관계가 **아직 성립하면** CR-121 규칙 3대로 지금 근거·시각의 파생 행이 된다 — 옛 값은 해제된 관계에만 남는다', async () => {
    await legacyPair();

    await handleRelationsReady(eventDeps(), repository, prSource(52), SERVING_ONLY);

    const after = await stackEdges(52);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ detached: false, created_at: SNAPSHOT_AT, evidence: 'base feature-p = head of #51' });
    expect(await stackRows(52)).toEqual([
      { parent: 51, detached: false, origin: 'derived', evidence: 'base feature-p = head of #51', at: SNAPSHOT_AT },
    ]);
    expect(await hasStack(52)).toBe(true);
  });

  /* --------------------------------------------------------------------- */
  /* 안전 조건                                                                */
  /* --------------------------------------------------------------------- */

  it('정본에 이미 있는 관계는 옛 간선 값으로 덮지 않는다 (일부만 가져온 상태)', async () => {
    await legacyPair();
    // 정본은 이미 해제를 안다(예: 앞선 파생의 간선 쓰기만 실패했다). 색인에는 옛 판의 성립 간선이 남아 있다.
    await pool.query(
      `INSERT INTO pull_request_stack (repository_id, child_pr_number, parent_pr_number, evidence, edge_created_at, detached, origin)
       VALUES ($1, 52, 51, 'base feature-p = head of #51', $2, true, 'derived')`,
      [REPOSITORY_ID, SNAPSHOT_AT],
    );
    await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });

    await handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY);

    expect(await stackRows(52)).toEqual([
      { parent: 51, detached: true, origin: 'derived', evidence: 'base feature-p = head of #51', at: SNAPSHOT_AT },
    ]);
    expect((await stackEdges(52))[0]).toMatchObject({ detached: true, created_at: SNAPSHOT_AT, evidence: 'base feature-p = head of #51' });
  });

  it('`import-stacks`와 이벤트가 동시에 돌아도 결과가 같다 — 둘 다 이미 있는 행을 덮지 않는다', async () => {
    for (let round = 0; round < 3; round += 1) {
      await pool.query('DELETE FROM pull_request_stack WHERE repository_id = $1', [REPOSITORY_ID]);
      await legacyPair();
      await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });

      await Promise.all([
        importServingStacks({ pool, es }, repository, { dryRun: false }),
        handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY),
      ]);
      // 가져오기가 이벤트의 판정보다 늦게 끝났으면 그 행은 이미 있어 덮이지 않는다. 판정보다 먼저 옮겼으면
      // 판정이 그 행을 해제한다. 어느 순서든 같다.
      expect(await stackRows(52)).toEqual([
        { parent: 51, detached: true, origin: 'imported', evidence: 'legacy base = head of #51', at: LEGACY_AT },
      ]);
      expect((await stackEdges(52))[0]).toMatchObject({ detached: true });
    }
  });

  it('같은 이벤트를 다시 처리해도 정본과 간선이 그대로다 (멱등)', async () => {
    await legacyPair();
    await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });
    await handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY);
    const rowsOnce = await pool.query(
      'SELECT * FROM pull_request_stack WHERE repository_id = $1 ORDER BY child_pr_number, parent_pr_number',
      [REPOSITORY_ID],
    );
    const edgesOnce = await stackEdges(52);

    await handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY);

    const rowsTwice = await pool.query(
      'SELECT * FROM pull_request_stack WHERE repository_id = $1 ORDER BY child_pr_number, parent_pr_number',
      [REPOSITORY_ID],
    );
    expect(rowsTwice.rows).toEqual(rowsOnce.rows);
    expect(await stackEdges(52)).toEqual(edgesOnce);
    expect(edgesOnce[0]).toMatchObject({ detached: true });
  });

  it('옮긴 뒤 해제를 확정하기 전에 끊겨도, 다시 처리하면(재전달) 해제된다', async () => {
    await legacyPair();
    await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });

    await expect(
      handleRelationsReady(eventDeps({ pool: failDetachOnce(pool, 52) }), repository, prSource(51), SERVING_ONLY),
    ).rejects.toThrow(/해제 판정 직전 끊김/);
    // 옮기기는 남았고(옛 판의 성립 상태 그대로), 판정은 되돌려졌다.
    expect(await stackRows(52)).toEqual([
      { parent: 51, detached: false, origin: 'imported', evidence: 'legacy base = head of #51', at: LEGACY_AT },
    ]);

    await handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY);

    expect(await stackRows(52)).toEqual([
      { parent: 51, detached: true, origin: 'imported', evidence: 'legacy base = head of #51', at: LEGACY_AT },
    ]);
    expect((await stackEdges(52))[0]).toMatchObject({ detached: true, created_at: LEGACY_AT });
  });

  it.each(['throw', 'timed_out', 'shard_failure'] as const)(
    '서비스 인덱스 조회가 %s이면 「관계 없음」으로 넘어가지 않고 던진다 — 정본과 간선은 그대로이고, 회복 뒤 다시 처리하면 해제된다',
    async (mode) => {
      await legacyPair();
      await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });

      await expect(
        handleRelationsReady(eventDeps({ es: withStackReadFault(es, mode) }), repository, prSource(51), SERVING_ONLY),
      ).rejects.toThrow();
      expect(await stackRows(52)).toEqual([]);
      expect((await stackEdges(52))[0]).toMatchObject({ detached: false, created_at: LEGACY_AT });

      await handleRelationsReady(eventDeps(), repository, prSource(51), SERVING_ONLY);
      expect((await stackEdges(52))[0]).toMatchObject({ detached: true, created_at: LEGACY_AT });
    },
  );

  it('서비스 인덱스 조회는 관련 저장소·PR로 좁힌다 — 저장소의 스택 간선 전체를 훑지 않는다', async () => {
    await legacyPair();
    await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });
    const seen: unknown[] = [];

    await handleRelationsReady(eventDeps({ es: recordingStackReads(es, seen) }), repository, prSource(51), SERVING_ONLY);

    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(request).toMatchObject({ routing: String(REPOSITORY_ID) });
      expect(isScopedStackRead(request)).toBe(true);
      const filter = (request as { query: { bool: { filter: Record<string, Record<string, unknown>>[] } } }).query.bool.filter;
      expect(filter).toContainEqual({ term: { repository_id: REPOSITORY_ID } });
    }
    expect((await stackEdges(52))[0]).toMatchObject({ detached: true });
  });

  it('이벤트 소비자가 아닌 파생(JOB-REL-006 재파생·재색인)은 옮기지 않는다 — 전체 이전은 `import-stacks`의 일이다', async () => {
    await legacyPair();
    await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });

    await handleRelationsReady(baseDeps(), repository, prSource(51), SERVING_ONLY);

    expect(await stackRows(52)).toEqual([]);
    expect((await stackEdges(52))[0]).toMatchObject({ detached: false, created_at: LEGACY_AT });
  });
});
