/**
 * prs-links 재색인의 부분 갱신 경합과 전환 전 완전성 (CR-121 / WP-104, FR-ING-008 AC-11, FR-REL-006 AC-6).
 *
 * ## 이 시험이 막는 것
 *
 * 사내 `0.1.0-pilot.18`에서 prs-links 재색인이 `shadow_write_failed`(`document_missing_exception`)로
 * 실패했다. 간선의 **부분 갱신**(해결 상태)은 후보를 서비스 별칭에서 찾아 서비스와 shadow에 함께 보내는데,
 * 그 간선의 주인 source가 재구축에서 아직 처리되지 않았으면 shadow에 문서가 없다. 그 실패를 조용히
 * 무시하면 안 되고(누락이 숨는다), 부분 문서를 만들어도 안 된다(근거·권한 필드 없는 간선이 생긴다).
 * 주인 source를 PostgreSQL에서 다시 파생해 회수하고, 전환 전에 기대 간선과 대조해야 한다.
 *
 * 같은 경로에 두 번째 결함이 있었다: 해제된 스택 간선은 색인에만 있어 재색인이 `completed`로 끝나도 새
 * 인덱스에서 사라졌다. 이제 스택의 정본은 `pull_request_stack`이고(OD-017), 배포 전 간선은 일회성
 * 가져오기(`prsctl links import-stacks`)로 옮기며, 옮기지 않은 채로는 전환하지 않는다.
 *
 * 재구축 포트는 **운영 배선과 같은 팩토리**(`createLinkRebuildPort`)다 — 항상 성공하는 가짜가 아니다.
 *
 * 검증: `pnpm test:integration jobs/links-reindex-completeness`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { commitDocId, derivedLinkId, pullRequestDocId } from '@prs/domain';
import {
  commitSnapshotRepo,
  jobRepo,
  prSnapshotRepo,
  prStackRepo,
  reindexRepo,
  repositoryRepo,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import {
  LINKS_ALIAS,
  SERVING_ONLY,
  applyMappings,
  concreteIndexName,
  createEsClient,
  listIndexVersions,
  resolveServingIndex,
  switchAlias,
  writeDerivedLinks,
} from '@prs/es';
import { runReindexJob, type LinkRebuildPort, type ReindexDeps, type ReindexLogFields } from '../../src/reindex.js';
import { createLinkRebuildPort, deriveReferenceLinks, handleSourceReady, resolveReferencesTo, type LinkDeps } from '../../src/link.js';
import { runLinkRepairCommand } from '../../src/link-repair-command.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 9381;
const OTHER_REPOSITORY_ID = 9382;
const OWNER = 'acme';
const NAME = 'links-reindex-completeness';
const OTHER_NAME = 'links-reindex-other';
const HOST = 'ghe.acme.example';
const TEAM = 7381;
const OTHER_TEAM = 8382;

let pool: Pool;
let es: Client;
let repository: RepositoryRow;
let originalIndex: string;
const created = new Set<string>();

function linkDeps(client: Client = es): LinkDeps {
  return {
    pool,
    es: client,
    bus: { publish: () => Promise.resolve() } as unknown as EventBus,
    metrics: createWorkerMetrics(),
    gheHost: `https://${HOST}`,
    log: () => undefined,
    refresh: true,
  };
}

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient();
  await applyMappings(es);
  originalIndex = await resolveServingIndex(es, LINKS_ALIAS);
}, 120_000);

afterAll(async () => {
  const serving = await resolveServingIndex(es, LINKS_ALIAS).catch(() => originalIndex);
  if (serving !== originalIndex) await switchAlias(es, LINKS_ALIAS, serving, originalIndex).catch(() => undefined);
  for (const index of created) {
    if (index === originalIndex) continue;
    await es.indices.delete({ index, ignore_unavailable: true }).catch(() => undefined);
  }
  for (const id of [REPOSITORY_ID, OTHER_REPOSITORY_ID]) {
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [id]);
    await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [id]);
    await pool.query('DELETE FROM pull_request_stack WHERE repository_id = $1', [id]);
    await pool.query('DELETE FROM repository WHERE repository_id = $1', [id]);
  }
  await pool.query("DELETE FROM job WHERE type = 'reindex'");
  await pool.query('DELETE FROM reindex_link_pending');
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  for (const id of [REPOSITORY_ID, OTHER_REPOSITORY_ID]) {
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [id]);
    await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [id]);
    await pool.query('DELETE FROM pull_request_stack WHERE repository_id = $1', [id]);
  }
  await pool.query("DELETE FROM job WHERE type = 'reindex'");
  await pool.query("DELETE FROM job WHERE type = 'pr_link_repair' AND target LIKE $1", [`${OWNER}/links-reindex-%`]);
  await pool.query('DELETE FROM reindex_link_pending');
  for (const alias of [LINKS_ALIAS, 'prs-pull-requests', 'prs-commits']) {
    await es.deleteByQuery({
      index: `${alias}*`,
      query: { terms: { repository_id: [REPOSITORY_ID, OTHER_REPOSITORY_ID] } },
      refresh: true,
      conflicts: 'proceed',
      ignore_unavailable: true,
    });
  }
  repository = await registerRepository(REPOSITORY_ID, NAME, TEAM);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [OTHER_REPOSITORY_ID]);
});

async function registerRepository(id: number, name: string, team: number): Promise<RepositoryRow> {
  await repositoryRepo.upsertRepository(pool, {
    repository_id: id,
    owner: OWNER,
    name,
    org_id: 1,
    visibility: 'private',
    sequence_branches: ['main'],
  });
  // `upsertRepository`는 팀을 쓰지 않는다 — 간선의 범위 필드가 실제 값이 되도록 따로 넣는다.
  await repositoryRepo.setAllowedTeams(pool, id, [team]);
  const found = await repositoryRepo.findRepositoryById(pool, id);
  if (found === undefined) throw new Error('시험 저장소를 만들지 못했다');
  return found;
}

async function seedPullRequest(
  prNumber: number,
  fields: { readonly body?: string; readonly head?: string; readonly base?: string; readonly state?: string } = {},
): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    prNumber,
    documentVersion: 1,
    source: 'webhook',
    document: {
      pr_number: prNumber,
      title: `PR ${String(prNumber)}`,
      body: fields.body ?? '',
      ...(fields.head === undefined ? {} : { head_branch: fields.head }),
      ...(fields.base === undefined ? {} : { base_branch: fields.base }),
      state: fields.state ?? 'open',
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  });
}

async function seedCommit(sha: string, message: string): Promise<void> {
  const at = new Date('2026-08-01T00:00:00.000Z');
  await commitSnapshotRepo.upsertCommitSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    commitSha: sha,
    parentShas: [],
    message,
    author: 'dev',
    committer: 'dev',
    authoredAt: at,
    committedAt: at,
    changedPaths: [],
    changedPathsTruncated: false,
    patchId: null,
    patchIdUnavailable: 'no_mirror',
    metadataSource: 'mirror',
  });
}

/** 서비스 PR 인덱스의 문서 — 참조 대상이 색인되었는지의 판정 재료다. */
async function indexPullRequest(prNumber: number, repositoryId = REPOSITORY_ID, team = TEAM, name = NAME): Promise<void> {
  await es.index({
    index: 'prs-pull-requests',
    id: pullRequestDocId(repositoryId, prNumber),
    routing: String(repositoryId),
    refresh: true,
    document: {
      document_version: 1,
      repository_id: repositoryId,
      repository: `${OWNER}/${name}`,
      org_id: 1,
      visibility: 'private',
      allowed_team_ids: [team],
      pr_number: prNumber,
      links_pending: false,
      link_summary: { has_revert: false, is_reverted: false, has_cherry_pick: false, has_stack: false, reference_count: 0 },
    },
  });
}

/** 서비스 커밋 인덱스의 문서 — 접두 참조의 유일성 판정 재료다. */
async function indexCommit(sha: string): Promise<void> {
  await es.index({
    index: 'prs-commits',
    id: commitDocId(REPOSITORY_ID, sha),
    routing: String(REPOSITORY_ID),
    refresh: true,
    document: {
      document_version: 1,
      repository_id: REPOSITORY_ID,
      repository: `${OWNER}/${NAME}`,
      org_id: 1,
      visibility: 'private',
      allowed_team_ids: [TEAM],
      commit_sha: sha,
      role: 'direct_push',
    },
  });
}

interface Enqueued {
  readonly jobId: number;
  readonly targetIndex: string;
}

async function enqueue(): Promise<Enqueued> {
  const outcome = await reindexRepo.enqueueReindex(
    pool,
    {
      resolveServingIndex: (alias) => resolveServingIndex(es, alias),
      async nextTargetIndex(alias) {
        const versions = await listIndexVersions(es, alias);
        const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
        return concreteIndexName(alias, highest + 1);
      },
      isAlias: (value) => value === LINKS_ALIAS,
    },
    LINKS_ALIAS,
    'test',
  );
  if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
  created.add(outcome.targetIndex);
  await pool.query("UPDATE job SET state = 'running', started_at = now() WHERE job_id = $1", [outcome.jobId]);
  return { jobId: outcome.jobId, targetIndex: outcome.targetIndex };
}

interface Outcome {
  readonly state: string;
  readonly error: string | null;
  readonly logs: readonly ReindexLogFields[];
  /** 이 저장소에서 회수가 다시 파생한 source — 재색인은 DB의 저장소 전부를 돌므로 전역 수로 판정하지 않는다. */
  readonly rederived: readonly string[];
}

async function run(enqueued: Enqueued, client: Client = es): Promise<Outcome> {
  const row = await jobRepo.findJobById(pool, enqueued.jobId);
  if (row === undefined) throw new Error('잡을 찾지 못했다');
  const logs: ReindexLogFields[] = [];
  const rederived: string[] = [];
  // 운영 배선(`index.ts`)과 같은 팩토리다 — 항상 성공하는 가짜 포트가 아니다. 회수 호출만 **관찰**하고 그대로 넘긴다.
  const production = createLinkRebuildPort(linkDeps(client));
  const port: LinkRebuildPort = {
    ...production,
    async rederiveSource(one, source) {
      if (Number(one.repository_id) === REPOSITORY_ID) rederived.push(`${source.kind}:${source.id}`);
      return production.rederiveSource(one, source);
    },
  };
  const deps: ReindexDeps = { pool, es: client, links: port, log: (fields) => logs.push(fields) };
  await runReindexJob(deps, row);
  await es.indices.refresh({ index: enqueued.targetIndex, ignore_unavailable: true });
  const after = await jobRepo.findJobById(pool, enqueued.jobId);
  return { state: after?.state ?? 'missing', error: after?.error ?? null, logs, rederived };
}

function logDetail(outcome: Outcome, message: string): string {
  return outcome.logs.find((one) => one.message === message)?.detail ?? '';
}

type Source = Record<string, unknown>;

async function edgesIn(index: string, repositoryId = REPOSITORY_ID): Promise<readonly Source[]> {
  await es.indices.refresh({ index });
  const found = await es.search<Source>({
    index,
    size: 100,
    query: { term: { repository_id: repositoryId } },
    sort: [{ link_id: 'asc' }],
  });
  return found.hits.hits.map((hit) => hit._source as Source);
}

/** 한 메서드만 가로채는 클라이언트. 나머지는 그대로 통과한다. */
function intercept(
  method: 'bulk' | 'search',
  wrap: (inner: (params: never) => Promise<unknown>, params: never) => Promise<unknown>,
): Client {
  return new Proxy(es, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property === method) {
        const inner = (value as (params: never) => Promise<unknown>).bind(target);
        return (params: never) => wrap(inner, params);
      }
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** `indices`의 한 메서드를 가로채는 클라이언트 (예: 검증의 `indices.exists`). */
function interceptIndices(
  method: 'exists' | 'refresh',
  wrap: (inner: (params: never) => Promise<unknown>, params: never) => Promise<unknown>,
): Client {
  const indices = new Proxy(es.indices, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property === method) {
        const inner = (value as (params: never) => Promise<unknown>).bind(target);
        return (params: never) => wrap(inner, params);
      }
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new Proxy(es, {
    get(target, property, receiver) {
      if (property === 'indices') return indices;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** 검증이 대상의 간선을 처음 읽기 직전에 한 번 `mutate`를 부른다 — 재구축·회수는 끝났다. */
function beforeFirstEdgeRead(enqueued: Enqueued, mutate: () => Promise<void>): { client: Client; fired: () => boolean } {
  let fired = false;
  const client = intercept('search', async (inner, params) => {
    const shape = params as { index?: string; query?: unknown };
    if (!fired && shape.index === enqueued.targetIndex && JSON.stringify(shape.query ?? {}).includes('from_id')) {
      fired = true;
      await mutate();
    }
    return inner(params);
  });
  return { client, fired: () => fired };
}

type BulkItems = { items: Record<string, { _index?: string; _id?: string; error?: unknown; status?: number } | undefined>[] };

describe('부분 갱신의 대상 간선이 shadow에 아직 없다 (CR-121, FR-ING-008 AC-11)', () => {
  it('**간선 주인이 대상보다 뒤에 처리돼도 재색인이 전환하고 간선이 해결된 채 복원된다**', async () => {
    // PR 30이 #20을 참조한다. 서비스에는 그 간선이 미해결로 있다 — 파생 당시 PR 20이 색인되지 않았다.
    await seedPullRequest(20, { body: 'target' });
    await seedPullRequest(30, { body: 'Refs: #20' });
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'pull_request', id: '30' });
    // 이제 PR 20이 색인되었다. 재구축은 PR 번호 순서라 20을 먼저 처리하며, 그때 해결 부분 갱신이
    // 서비스의 미해결 간선을 찾아 shadow에도 보내는데 shadow에는 PR 30의 간선이 아직 없다.
    await indexPullRequest(20);

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect(outcome.error).toBeNull();
    expect(outcome.state).toBe('completed');
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(enqueued.targetIndex);
    // 부분 갱신의 문서 없음은 미처리로 남았고, 전환 전에 PR 30을 다시 파생해 회수했다.
    expect(outcome.rederived).toEqual(['pull_request:30']);
    expect(await reindexRepo.countLinkPending(pool, enqueued.jobId)).toBe(0);
    const edges = await edgesIn(enqueued.targetIndex);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from_type: 'pull_request',
      from_id: pullRequestDocId(REPOSITORY_ID, 30),
      link_type: 'references',
      reference_key: 'pr:20',
      resolved: true,
      to_type: 'pull_request',
      to_id: pullRequestDocId(REPOSITORY_ID, 20),
      repository_id: REPOSITORY_ID,
      allowed_team_ids: [TEAM],
    });
    // 실제 별칭으로도 같은 간선이 보인다 — 전환한 인덱스가 서비스된다.
    expect(await edgesIn(LINKS_ALIAS)).toEqual(edges);
  }, 120_000);

  it('**반대 순서(주인이 먼저)여도 같은 최종 결과다** — 미처리가 생기지 않는다', async () => {
    await seedPullRequest(10, { body: 'Refs: #20' });
    await seedPullRequest(20, { body: 'target' });
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'pull_request', id: '10' });
    await indexPullRequest(20);

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect(outcome.rederived).toEqual([]);
    expect(await edgesIn(enqueued.targetIndex)).toEqual([
      expect.objectContaining({ from_id: pullRequestDocId(REPOSITORY_ID, 10), resolved: true, to_id: pullRequestDocId(REPOSITORY_ID, 20) }),
    ]);
  }, 120_000);

  it('**source별 간선 0개·여러 개가 그대로 복원된다** — 처리 source 수는 기대가 아니다', async () => {
    await seedPullRequest(60, { body: 'no references here' });
    await seedPullRequest(61, { body: 'Refs: #60, #62, #63' });
    await indexPullRequest(60);

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect(logDetail(outcome, '전환 전 간선 검증')).toMatch(/missing=0 extra=0 mismatched=0/);
    const edges = await edgesIn(enqueued.targetIndex);
    expect(edges.map((edge) => edge['from_id'])).toEqual(Array(3).fill(pullRequestDocId(REPOSITORY_ID, 61)));
    // 대상이 없는 참조는 미해결이 정상이다 — 실패로 세지 않았다.
    expect(edges.filter((edge) => edge['resolved'] === true).map((edge) => edge['to_id'])).toEqual([pullRequestDocId(REPOSITORY_ID, 60)]);
  }, 120_000);

  it('**정본에서 사라진 참조의 옛 간선을 되살리지 않는다**', async () => {
    await seedPullRequest(70, { body: 'Refs: #71, #72' });
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'pull_request', id: '70' });
    expect(await edgesIn(LINKS_ALIAS)).toHaveLength(2);
    // 본문이 바뀌었다. 서비스는 아직 다시 파생하지 않아 #72 간선이 남아 있다.
    await seedPullRequest(70, { body: 'Refs: #71' });

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect((await edgesIn(enqueued.targetIndex)).map((edge) => edge['reference_key'])).toEqual(['pr:71']);
  }, 120_000);

  it('**유일했던 접두 SHA가 모호해지면 새 인덱스의 간선은 미해결이다** — 옛 해결을 옮기지 않는다', async () => {
    const referrer = 'c'.repeat(40);
    const first = `abcdef1${'0'.repeat(33)}`;
    const second = `abcdef1${'1'.repeat(33)}`;
    await seedCommit(referrer, 'fix the thing, see abcdef1');
    await indexCommit(first);
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'commit', id: referrer });
    expect((await edgesIn(LINKS_ALIAS))[0]).toMatchObject({ resolved: true, to_id: commitDocId(REPOSITORY_ID, first) });
    // 같은 접두의 커밋이 하나 더 생겼다.
    await indexCommit(second);

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    const [edge] = await edgesIn(enqueued.targetIndex);
    expect(edge).toMatchObject({ resolved: false });
    expect(String(edge?.['reference_key'])).toContain('abcdef1');
    expect(edge).not.toHaveProperty('to_id');
  }, 120_000);

  it('**다른 저장소를 가리키는 간선의 범위와 routing은 소유 저장소의 것이다**', async () => {
    await registerRepository(OTHER_REPOSITORY_ID, OTHER_NAME, OTHER_TEAM);
    await indexPullRequest(5, OTHER_REPOSITORY_ID, OTHER_TEAM, OTHER_NAME);
    await seedPullRequest(80, { body: `Refs: ${OWNER}/${OTHER_NAME}#5` });

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect(await edgesIn(enqueued.targetIndex)).toEqual([
      expect.objectContaining({
        repository_id: REPOSITORY_ID,
        allowed_team_ids: [TEAM],
        resolved: true,
        to_repository_id: OTHER_REPOSITORY_ID,
        to_id: pullRequestDocId(OTHER_REPOSITORY_ID, 5),
      }),
    ]);
    // 대상 저장소의 routing에는 없다 — 조회도 소유 저장소 routing으로 읽는다.
    expect(await edgesIn(enqueued.targetIndex, OTHER_REPOSITORY_ID)).toEqual([]);
  }, 120_000);
});

describe('실패는 실패로 남는다 (CR-121)', () => {
  it('**shadow의 전체 쓰기 실패는 미처리가 아니라 잡 실패다** — 별칭은 그대로다', async () => {
    await seedPullRequest(40, { body: 'Refs: #41' });
    const serving = await resolveServingIndex(es, LINKS_ALIAS);
    const enqueued = await enqueue();
    const client = intercept('bulk', async (inner, params) => {
      const response = (await inner(params)) as BulkItems;
      for (const item of response.items) {
        const outcome = item['index'];
        if (outcome?._index === enqueued.targetIndex) {
          outcome.error = { type: 'mapper_parsing_exception', reason: 'boom' };
          outcome.status = 400;
        }
      }
      return response;
    });

    const outcome = await run(enqueued, client);

    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('shadow_write_failed');
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(serving);
  }, 120_000);

  it('**파생이 불완전했던 source를 완결로 승격하지 않고 회수한다**', async () => {
    await seedPullRequest(50, { body: 'Refs: #51' });
    const enqueued = await enqueue();
    let failedOnce = false;
    // 재구축이 **이 저장소의** 간선을 서비스에 쓰는 첫 항목 하나만 실패로 돌려준다 — 파생이 불완전해진다.
    const client = intercept('bulk', async (inner, params) => {
      const response = (await inner(params)) as BulkItems;
      if (!failedOnce) {
        const operations = (params as { operations?: readonly unknown[] }).operations ?? [];
        // 연산 머리(짝수 자리)만 본다 — 응답 항목은 머리와 같은 순서다.
        const heads = operations.filter((_one, index) => index % 2 === 0) as Record<string, { _index?: string; routing?: string } | undefined>[];
        const at = heads.findIndex((head) => head['index']?._index === LINKS_ALIAS && head['index'].routing === String(REPOSITORY_ID));
        const outcome = at < 0 ? undefined : response.items[at]?.['index'];
        if (outcome !== undefined) {
          failedOnce = true;
          outcome.error = { type: 'es_rejected_execution_exception', reason: 'busy' };
          outcome.status = 429;
        }
      }
      return response;
    });

    const outcome = await run(enqueued, client);

    expect(failedOnce).toBe(true);
    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect(outcome.rederived.length).toBeGreaterThan(0);
    expect(await edgesIn(enqueued.targetIndex)).toEqual([expect.objectContaining({ from_id: pullRequestDocId(REPOSITORY_ID, 50) })]);
  }, 120_000);

  it('**검증 직전에 대상의 간선이 사라지면 검증이 막는다** — 검증은 고치지 않는다', async () => {
    await seedPullRequest(90, { body: 'Refs: #91' });
    const serving = await resolveServingIndex(es, LINKS_ALIAS);
    const enqueued = await enqueue();
    let removed = false;
    const client = intercept('search', async (inner, params) => {
      const shape = params as { index?: string; query?: unknown };
      if (!removed && shape.index === enqueued.targetIndex && JSON.stringify(shape.query ?? {}).includes('from_id')) {
        removed = true;
        const [edge] = await edgesIn(enqueued.targetIndex);
        await es.delete({ index: enqueued.targetIndex, id: String(edge?.['link_id']), routing: String(REPOSITORY_ID), refresh: true });
      }
      return inner(params);
    });

    const outcome = await run(enqueued, client);

    expect(removed).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('간선 누락 1건');
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(serving);
  }, 120_000);

  it('**정본의 source가 만들지 않는 간선이 대상에 있으면 막는다** — 사라진 참조를 되살리지 않는다', async () => {
    await seedPullRequest(92, { body: 'Refs: #93' });
    const enqueued = await enqueue();
    const probe = beforeFirstEdgeRead(enqueued, async () => {
      const [edge] = await edgesIn(enqueued.targetIndex);
      await es.index({
        index: enqueued.targetIndex,
        id: 'stale-reference',
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: { ...edge, link_id: 'stale-reference', reference_key: 'pr:94' },
      });
    });

    const outcome = await run(enqueued, probe.client);

    expect(probe.fired()).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('정본에 없는 간선 1건');
  }, 120_000);

  it('**소유 source가 정본에 없는 간선이 대상에 있으면 막는다**', async () => {
    await seedPullRequest(97, { body: 'Refs: #98' });
    const enqueued = await enqueue();
    const probe = beforeFirstEdgeRead(enqueued, async () => {
      const [edge] = await edgesIn(enqueued.targetIndex);
      await es.index({
        index: enqueued.targetIndex,
        id: 'orphan',
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: { ...edge, link_id: 'orphan', from_id: pullRequestDocId(REPOSITORY_ID, 4242) },
      });
    });

    const outcome = await run(enqueued, probe.client);

    expect(probe.fired()).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('소유 source가 없는 간선 1건');
  }, 120_000);

  it('**등록되지 않은 저장소가 소유한 간선이 대상에 있으면 막는다** — 저장소마다 세는 대조 밖의 간선이다', async () => {
    await seedPullRequest(101, { body: 'Refs: #102' });
    const enqueued = await enqueue();
    const probe = beforeFirstEdgeRead(enqueued, async () => {
      const [edge] = await edgesIn(enqueued.targetIndex);
      // `beforeEach`가 두 번째 저장소의 등록을 지운다 — 그 저장소의 간선은 애초에 만들지 않는다(FR-ING-009 AC-4).
      await es.index({
        index: enqueued.targetIndex,
        id: 'unregistered',
        routing: String(OTHER_REPOSITORY_ID),
        refresh: true,
        document: { ...edge, link_id: 'unregistered', repository_id: OTHER_REPOSITORY_ID, from_id: pullRequestDocId(OTHER_REPOSITORY_ID, 1) },
      });
    });

    const outcome = await run(enqueued, probe.client);

    expect(probe.fired()).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('소유 source가 없는 간선 1건');
    expect(outcome.error ?? '').toContain('등록되지 않은 저장소의 간선 1건');
  }, 120_000);

  it('**간선의 내용이 정본과 다르면 막는다** — 범위·근거·해결 상태까지 본다', async () => {
    await seedPullRequest(99, { body: 'Refs: #100' });
    const enqueued = await enqueue();
    const probe = beforeFirstEdgeRead(enqueued, async () => {
      const [edge] = await edgesIn(enqueued.targetIndex);
      await es.index({
        index: enqueued.targetIndex,
        id: String(edge?.['link_id']),
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: { ...edge, allowed_team_ids: [1] },
      });
    });

    const outcome = await run(enqueued, probe.client);

    expect(probe.fired()).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('간선 불일치 1건');
    expect(outcome.error ?? '').toContain('allowed_team_ids');
  }, 120_000);

  it('**회수가 수렴하지 않으면 잡이 실패하고, 남은 source가 사유에 실리며, 대기열은 비워진다**', async () => {
    await seedPullRequest(150, { body: 'Refs: #151' });
    const serving = await resolveServingIndex(es, LINKS_ALIAS);
    const enqueued = await enqueue();
    // 이 저장소의 서비스 간선 쓰기가 **늘** 실패한다 — 파생이 매번 불완전하다.
    const client = intercept('bulk', async (inner, params) => {
      const response = (await inner(params)) as BulkItems;
      const operations = (params as { operations?: readonly unknown[] }).operations ?? [];
      const heads = operations.filter((_one, index) => index % 2 === 0) as Record<string, { _index?: string; routing?: string } | undefined>[];
      heads.forEach((head, at) => {
        const outcome = response.items[at]?.['index'];
        if (head['index']?._index === LINKS_ALIAS && head['index'].routing === String(REPOSITORY_ID) && outcome !== undefined) {
          outcome.error = { type: 'es_rejected_execution_exception', reason: 'busy' };
          outcome.status = 429;
        }
      });
      return response;
    });

    const outcome = await run(enqueued, client);

    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('link_pending_unrecovered');
    expect(outcome.error ?? '').toContain('pull_request:150');
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(serving);
    // 끝난 잡의 대기열은 뜻이 없다.
    expect(await reindexRepo.countLinkPending(pool, enqueued.jobId)).toBe(0);
  }, 180_000);

  it('**서비스 간선의 소유 source가 간선 ID와 맞지 않으면 부분 갱신하지 않고 던진다** — 엉뚱한 source를 회수하지 않는다', async () => {
    await seedPullRequest(30, { body: 'Refs: #20' });
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'pull_request', id: '30' });
    const [edge] = await edgesIn(LINKS_ALIAS);
    // 색인이 손상돼 소유 source 필드가 간선 ID의 재료(`references:pull_request:<from_id>:<reference_key>`)와 다르다.
    await es.index({
      index: LINKS_ALIAS,
      id: String(edge?.['link_id']),
      routing: String(REPOSITORY_ID),
      refresh: true,
      document: { ...edge, from_id: pullRequestDocId(REPOSITORY_ID, 31) },
    });
    await seedPullRequest(20, { body: 'target' });
    await indexPullRequest(20);

    await expect(resolveReferencesTo(linkDeps(), repository, { kind: 'pull_request', id: '20' })).rejects.toThrow(
      'reference_link_owner_mismatch',
    );
  }, 120_000);
});

describe('재개와 전환 경쟁 (CR-121)', () => {
  it('**잡에 남은 미처리는 다시 도는 잡이 회수한다** — 메모리가 아니라 대기열에 있다', async () => {
    await seedPullRequest(95, { body: 'Refs: #96' });
    const enqueued = await enqueue();
    // 멈췄다 재개된 잡의 모양: 앞선 실행이 남긴 미처리 둘. 하나는 정본에 없는 source다.
    await reindexRepo.recordLinkPending(pool, enqueued.jobId, [
      { repositoryId: REPOSITORY_ID, sourceKind: 'pull_request', sourceId: '95', reason: 'partial_update_document_missing' },
      { repositoryId: REPOSITORY_ID, sourceKind: 'pull_request', sourceId: '999', reason: 'partial_update_document_missing' },
    ]);

    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    // 정본에 있는 95는 다시 파생했고, 없는 999는 만들 간선이 없어 끝난 일로 지웠다.
    expect(outcome.rederived).toEqual(['pull_request:95', 'pull_request:999']);
    expect(logDetail(outcome, '간선 미처리 회수')).toMatch(/absent=[1-9]/);
    expect(await reindexRepo.countLinkPending(pool, enqueued.jobId)).toBe(0);
  }, 120_000);

  it('**검증이 시작될 때 미처리가 남아 있으면 전환하지 않는다**', async () => {
    await seedPullRequest(130, { body: 'Refs: #131' });
    const serving = await resolveServingIndex(es, LINKS_ALIAS);
    const enqueued = await enqueue();
    let injected = false;
    // 회수가 끝난 뒤, 검증의 첫 확인(대상 인덱스 존재) 직전에 미처리가 새로 생긴 모양이다.
    const client = interceptIndices('exists', async (inner, params) => {
      const shape = params as { index?: string };
      const job = await reindexRepo.findReindexJob(pool, enqueued.jobId);
      if (!injected && shape.index === enqueued.targetIndex && job?.progress.phase === 'verify') {
        injected = true;
        await reindexRepo.recordLinkPending(pool, enqueued.jobId, [
          { repositoryId: REPOSITORY_ID, sourceKind: 'pull_request', sourceId: '130', reason: 'partial_update_document_missing' },
        ]);
      }
      return inner(params);
    });

    const outcome = await run(enqueued, client);

    expect(injected).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('회수되지 않은 간선 미처리 1건');
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(serving);
  }, 120_000);

  it('**검증과 전환 사이의 새 미처리는 울타리가 막고, 회수·재검증 뒤 전환한다**', async () => {
    await seedPullRequest(30, { body: 'Refs: #20' });
    await seedPullRequest(20, { body: 'target' });
    const enqueued = await enqueue();
    let injected = false;
    // 검증의 대표 질의 — 간선 대조가 끝난 뒤다. 그때 울타리 밖의 부분 갱신이 문서를 못 찾은 것처럼 남긴다.
    const client = intercept('search', async (inner, params) => {
      const shape = params as { index?: string; size?: number; track_total_hits?: boolean };
      if (!injected && shape.index === enqueued.targetIndex && shape.size === 0 && shape.track_total_hits === true) {
        injected = true;
        await reindexRepo.recordLinkPending(pool, enqueued.jobId, [
          { repositoryId: REPOSITORY_ID, sourceKind: 'pull_request', sourceId: '30', reason: 'partial_update_document_missing' },
        ]);
      }
      return inner(params);
    });

    const outcome = await run(enqueued, client);

    expect(injected).toBe(true);
    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect(outcome.logs.some((one) => one.message === '전환 직전에 간선 미처리를 만났다 — 회수한 뒤 다시 검증한다')).toBe(true);
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(enqueued.targetIndex);
    expect(await reindexRepo.countLinkPending(pool, enqueued.jobId)).toBe(0);
  }, 120_000);
});

describe('해제된 스택 간선 (FR-REL-006 AC-3·AC-6, DEV-238, OD-017)', () => {
  it('**상위 PR이 병합돼 해제된 스택 간선이 재색인 뒤에도 해제 상태로 남는다**', async () => {
    // PR 11이 PR 10 위에 쌓였다 — 11의 base가 10의 head다.
    await seedPullRequest(10, { head: 'feature-a', base: 'main' });
    await seedPullRequest(11, { head: 'feature-b', base: 'feature-a' });
    await handleSourceReady(linkDeps(), repository, { kind: 'pull_request', id: '11' });
    // 상위 PR이 병합됐다. 하위 PR을 다시 파생하면 간선은 지워지지 않고 해제로 표시된다.
    await seedPullRequest(10, { head: 'feature-a', base: 'main', state: 'merged' });
    await handleSourceReady(linkDeps(), repository, { kind: 'pull_request', id: '11' });
    const served = (await edgesIn(LINKS_ALIAS)).filter((edge) => edge['link_type'] === 'stacks_on');
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ detached: true, from_id: pullRequestDocId(REPOSITORY_ID, 11) });

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    const rebuilt = (await edgesIn(enqueued.targetIndex)).filter((edge) => edge['link_type'] === 'stacks_on');
    expect(rebuilt).toEqual(served);
  }, 120_000);

  it('**상위 PR의 retarget으로 해제된 간선도 남는다** — 옛 base는 정본 행이 기억한다', async () => {
    await seedPullRequest(111, { head: 'old-head', base: 'main' });
    await seedPullRequest(112, { head: 'child', base: 'old-head' });
    await handleSourceReady(linkDeps(), repository, { kind: 'pull_request', id: '112' });
    // 상위가 head를 바꾼다. 하위에는 이벤트가 없고, 역방향 재평가가 정본 행에서 하위를 찾는다.
    await seedPullRequest(111, { head: 'new-head', base: 'main' });
    await handleSourceReady(linkDeps(), repository, { kind: 'pull_request', id: '111' });
    const served = (await edgesIn(LINKS_ALIAS)).filter((edge) => edge['link_type'] === 'stacks_on');
    expect(served).toEqual([expect.objectContaining({ detached: true, from_id: pullRequestDocId(REPOSITORY_ID, 112) })]);

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect((await edgesIn(enqueued.targetIndex)).filter((edge) => edge['link_type'] === 'stacks_on')).toEqual(served);
  }, 120_000);

  it('**배포 전 서비스에만 있던 스택 간선은 가져오기 전에는 전환을 막고, 가져온 뒤에는 그대로 복원된다**', async () => {
    await seedPullRequest(120, { head: 'up', base: 'main', state: 'merged' });
    await seedPullRequest(121, { head: 'down', base: 'up' });
    // 배포 전의 모양: 해제된 간선이 색인에만 있고 스택 정본에는 없다.
    const fromId = pullRequestDocId(REPOSITORY_ID, 121);
    const toId = pullRequestDocId(REPOSITORY_ID, 120);
    await writeDerivedLinks(
      es,
      [
        {
          link_id: derivedLinkId('stacks_on', 'pull_request', fromId, 'pull_request', toId),
          link_type: 'stacks_on',
          scope: { repository_id: REPOSITORY_ID, org_id: 1, visibility: 'private', allowed_team_ids: [TEAM] },
          from_type: 'pull_request',
          from_id: fromId,
          to_type: 'pull_request',
          to_id: toId,
          to_repository_id: REPOSITORY_ID,
          confidence: 'derived',
          evidence: 'base up = head of #120',
          detached: true,
          created_at: '2026-07-01T00:00:00.000Z',
          resolved: true,
        },
      ],
      SERVING_ONLY,
      { refresh: true },
    );
    const legacy = (await edgesIn(LINKS_ALIAS)).filter((edge) => edge['link_type'] === 'stacks_on');
    const serving = await resolveServingIndex(es, LINKS_ALIAS);

    const blocked = await run(await enqueue());
    expect(blocked.state).toBe('failed');
    expect(blocked.error ?? '').toContain('스택 정본에 없는 서비스 stacks_on 간선 1건');
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(serving);

    const out: string[] = [];
    const command = (extra: readonly string[]): ReturnType<typeof runLinkRepairCommand> =>
      runLinkRepairCommand(['import-stacks', '--repository', `${OWNER}/${NAME}`, ...extra], {
        pool,
        es,
        actor: 'tester',
        out: (line) => out.push(line),
        err: (line) => out.push(line),
      });
    expect(await command(['--dry-run'])).toBe(0);
    expect(out.join('\n')).toContain('넣을 행: 1');
    expect((await prStackRepo.listStacksOfChildren(pool, REPOSITORY_ID, [121])).get(121)).toBeUndefined();
    expect(await command([])).toBe(0);
    expect(out.join('\n')).toContain('넣은 행: 1');
    expect(await command([])).toBe(0);
    expect(out.join('\n')).toContain('넣은 행: 0 · 이미 있음: 1');

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect((await edgesIn(enqueued.targetIndex)).filter((edge) => edge['link_type'] === 'stacks_on')).toEqual(legacy);
  }, 180_000);
});

describe('prsctl이 넘기는 행위 주체 인자 (CR-122 / DEV-774)', () => {
  /*
   * `prsctl links`는 호스트 사용자 이름을 인자 끝의 `--actor`로 넘긴다. 처음 판은 그 값을 파싱만 하고 버려
   * 번들의 apply·refetch·import-stacks가 늘 「--actor가 필요하다」로 거절됐다 — 격리 업그레이드 리허설에서
   * 드러났다. 위의 시험들은 `deps.actor`를 직접 넣어 그 틈을 지나쳤으므로, 여기서는 인자로만 넘긴다.
   */
  const slug = `${OWNER}/${NAME}`;
  const collect = (out: string[]): { readonly pool: Pool; readonly es: Client; readonly out: (line: string) => void; readonly err: (line: string) => void } => ({
    pool,
    es,
    out: (line) => out.push(line),
    err: (line) => out.push(line),
  });

  it('**`deps.actor` 없이 인자 `--actor`만으로 import-stacks·apply가 실행되고 그 주체가 잡과 감사에 남는다**', async () => {
    const actor = `cr122-${String(Date.now())}`;
    const out: string[] = [];
    expect(await runLinkRepairCommand(['import-stacks', '--repository', slug, '--actor', actor], collect(out))).toBe(0);
    expect(await runLinkRepairCommand(['apply', '--repository', slug, '--actor', actor], collect(out))).toBe(0);
    expect(out.join('\n')).not.toContain('--actor가 필요하다');

    const jobs = await pool.query<{ requested_by: string; state: string }>(
      "SELECT requested_by, state FROM job WHERE type = 'pr_link_repair' AND target = $1 ORDER BY job_id",
      [slug],
    );
    expect(jobs.rows).toEqual([
      { requested_by: `prsctl:${actor}`, state: 'completed' },
      { requested_by: `prsctl:${actor}`, state: 'completed' },
    ]);
    const audits = await pool.query<{ result_code: string }>(
      "SELECT result_code FROM audit_record WHERE action = 'job.run' AND user_id = $1 AND target = $2 ORDER BY audit_id",
      [`prsctl:${actor}`, `pr_link_repair:${slug}`],
    );
    expect(audits.rows.map((row) => row.result_code)).toEqual(['created', 'created']);
  }, 120_000);

  it('**refetch도 인자의 주체로 자격 검사까지 간다** — 거절 사유가 행위 주체가 아니다', async () => {
    const out: string[] = [];
    expect(await runLinkRepairCommand(['refetch', '--repository', slug, '--actor', 'cr122-operator'], collect(out))).toBe(1);
    expect(out.join('\n')).toContain('refetch에는 GHE 자격이 필요하다');
    expect(out.join('\n')).not.toContain('--actor가 필요하다');
  });

  it('**인자도 주입도 없으면 여전히 거절하고 잡을 만들지 않는다**', async () => {
    const out: string[] = [];
    expect(await runLinkRepairCommand(['apply', '--repository', slug], collect(out))).toBe(2);
    expect(out.join('\n')).toContain('--actor가 필요하다');
    const jobs = await pool.query("SELECT 1 FROM job WHERE type = 'pr_link_repair' AND target = $1", [slug]);
    expect(jobs.rowCount).toBe(0);
  });
});

describe('서비스 색인에 없는 대상을 가리키는 정확한 참조 (CR-123 / DEV-775, FR-REL-003 AC-3)', () => {
  /*
   * 해결은 「대상이 색인되었는가」다. 파생·전환 전 검증은 그 기준으로 계획하는데 해결 갱신은 불린 대상이 곧
   * 있다고 여겨, 재구축이 정본 스냅숏에서 읽은 커밋 — 문서를 만들 근거가 없는 커밋(DEV-759)이나 손으로 전환한
   * 인덱스에 빠진 커밋 — 을 가리키는 전체 SHA 참조를 해결로 바꿨다. 새 인덱스와 검증의 계획이 갈려 전환이
   * 매번 막혔고, 이중 쓰기로 서비스 인덱스에도 없는 문서를 가리키는 해결 간선이 섰다(격리 업그레이드 리허설).
   */
  const ORPHAN = '5e1f0a2b3c4d5e6f708192a3b4c5d6e7f8091a2b';
  const LATE = '6f2e1b3c4d5e6f708192a3b4c5d6e7f8091a2b3c';

  it('**문서가 사라진 커밋을 전체 SHA로 참조해도 재구축과 검증이 같은 판정을 내고 전환한다** — 새 인덱스의 간선은 미해결이다', async () => {
    // rebase로 PR에서 빠진 옛 커밋이다. 정본에는 남고(`commit_snapshot`), 커밋 재구축(CR-119)은 문서를 만들 근거가 없다.
    await seedCommit(ORPHAN, 'Draft audit model');
    await seedPullRequest(140, { body: `Refs: ${ORPHAN}` });
    await indexPullRequest(140);
    // 업그레이드 전에는 그 커밋의 문서가 있어 서비스 간선이 해결돼 있었다.
    await indexCommit(ORPHAN);
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'pull_request', id: '140' });
    expect((await edgesIn(LINKS_ALIAS))[0]).toMatchObject({ reference_key: `commit:${ORPHAN}`, resolved: true });
    // 커밋 재색인이 끝난 서비스 인덱스에는 그 문서가 없다.
    await es.delete({ index: 'prs-commits', id: commitDocId(REPOSITORY_ID, ORPHAN), routing: String(REPOSITORY_ID), refresh: true });

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect({ state: outcome.state, error: outcome.error }).toEqual({ state: 'completed', error: null });
    expect(logDetail(outcome, '전환 전 간선 검증')).toContain('mismatched=0');
    const edges = await edgesIn(enqueued.targetIndex);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from_id: pullRequestDocId(REPOSITORY_ID, 140), reference_key: `commit:${ORPHAN}`, resolved: false });
    expect(edges[0]).not.toHaveProperty('to_id');
  }, 120_000);

  it('**평시 해결 갱신도 서비스 색인에 없는 대상에는 붙이지 않고, 색인된 뒤에는 붙인다**', async () => {
    await seedCommit(LATE, 'Add pricing docs');
    await seedPullRequest(150, { body: `Refs: ${LATE}` });
    await indexPullRequest(150);
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'pull_request', id: '150' });
    expect((await edgesIn(LINKS_ALIAS))[0]).toMatchObject({ reference_key: `commit:${LATE}`, resolved: false });

    // 정본에는 있지만 문서가 아직 없다.
    expect(await resolveReferencesTo(linkDeps(), repository, { kind: 'commit', id: LATE })).toBe(0);
    expect((await edgesIn(LINKS_ALIAS))[0]).toMatchObject({ resolved: false });
    expect((await edgesIn(LINKS_ALIAS))[0]).not.toHaveProperty('to_id');

    await indexCommit(LATE);
    expect(await resolveReferencesTo(linkDeps(), repository, { kind: 'commit', id: LATE })).toBe(1);
    expect((await edgesIn(LINKS_ALIAS))[0]).toMatchObject({
      resolved: true,
      to_type: 'commit',
      to_id: commitDocId(REPOSITORY_ID, LATE),
      to_repository_id: REPOSITORY_ID,
    });
  }, 60_000);
});
