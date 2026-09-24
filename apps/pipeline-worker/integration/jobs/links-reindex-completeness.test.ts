/**
 * prs-links 재색인의 부분 갱신 경합과 전환 전 완전성 (CR-121 / WP-104, FR-ING-008 AC-11).
 *
 * ## 이 시험이 막는 것
 *
 * 사내 `0.1.0-pilot.18`에서 prs-links 재색인이 `shadow_write_failed`(`document_missing_exception`)로
 * 실패했다. 간선의 **부분 갱신**(해결 상태·스택 해제)은 후보를 서비스 별칭에서 찾아 서비스와 shadow에
 * 함께 보내는데, 그 간선의 주인 source가 재구축에서 아직 처리되지 않았으면 shadow에 문서가 없다.
 * 그 실패를 조용히 무시하면 안 되고(누락이 숨는다), 부분 문서를 만들어도 안 된다(근거·권한 필드
 * 없는 간선이 생긴다). 주인 source를 PostgreSQL에서 다시 파생해 회수하고, 전환 전에 기대 간선과
 * 대조해야 한다.
 *
 * 검증: `pnpm test:integration jobs/links-reindex-completeness`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { pullRequestDocId } from '@prs/domain';
import {
  jobRepo,
  prSnapshotRepo,
  reindexRepo,
  repositoryRepo,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import {
  LINKS_ALIAS,
  applyMappings,
  concreteIndexName,
  createEsClient,
  listIndexVersions,
  resolveServingIndex,
  switchAlias,
} from '@prs/es';
import { runReindexJob, type LinkRebuildPort, type ReindexDeps } from '../../src/reindex.js';
import { deriveReferenceLinks, handleSourceReady, runReferenceRebuild, type LinkDeps, type RebuildCursor } from '../../src/link.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 9381;
const OWNER = 'acme';
const NAME = 'links-reindex-completeness';
const HOST = 'ghe.acme.example';
const TEAM = 7381;

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

/** `index.ts`의 운영 배선과 같은 모양 — 저장소 하나를 커서가 끝날 때까지 돈다. */
function productionLikePort(deps: LinkDeps): LinkRebuildPort {
  return {
    async rebuildRepository(one) {
      let cursor: RebuildCursor | undefined;
      let processed = 0;
      for (;;) {
        const result = await runReferenceRebuild(deps, one, cursor);
        processed += result.processed;
        cursor = result.cursor;
        if (result.done) break;
      }
      return processed;
    },
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
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query("DELETE FROM job WHERE type = 'reindex'");
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query("DELETE FROM job WHERE type = 'reindex'");
  for (const alias of [LINKS_ALIAS, 'prs-pull-requests', 'prs-commits']) {
    await es.deleteByQuery({
      index: `${alias}*`,
      query: { term: { repository_id: REPOSITORY_ID } },
      refresh: true,
      conflicts: 'proceed',
      ignore_unavailable: true,
    });
  }
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 1,
    visibility: 'private',
    sequence_branches: ['main'],
    allowed_team_ids: [TEAM],
  });
  // `upsertRepository`는 팀을 쓰지 않는다 — 간선의 범위 필드가 실제 값이 되도록 따로 넣는다.
  await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM]);
  const found = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (found === undefined) throw new Error('시험 저장소를 만들지 못했다');
  repository = found;
});

async function seedPullRequest(prNumber: number, body: string): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    prNumber,
    documentVersion: 1,
    source: 'webhook',
    document: { pr_number: prNumber, title: `PR ${String(prNumber)}`, body, updated_at: '2026-08-01T00:00:00.000Z' },
  });
}

/** 서비스 PR 인덱스의 문서 — 참조 대상이 색인되었는지의 판정 재료다. */
async function indexPullRequest(prNumber: number): Promise<void> {
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
      link_summary: { has_revert: false, is_reverted: false, has_cherry_pick: false, has_stack: false, reference_count: 0 },
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

async function run(enqueued: Enqueued, overrides: Partial<ReindexDeps> = {}): Promise<{ readonly state: string; readonly error: string | null }> {
  const row = await jobRepo.findJobById(pool, enqueued.jobId);
  if (row === undefined) throw new Error('잡을 찾지 못했다');
  await runReindexJob({ pool, es, links: productionLikePort(linkDeps()), ...overrides }, row);
  await es.indices.refresh({ index: enqueued.targetIndex });
  const after = await jobRepo.findJobById(pool, enqueued.jobId);
  return { state: after?.state ?? 'missing', error: after?.error ?? null };
}

type Source = Record<string, unknown>;

async function edgesIn(index: string): Promise<readonly Source[]> {
  await es.indices.refresh({ index });
  const found = await es.search<Source>({
    index,
    size: 100,
    query: { term: { repository_id: REPOSITORY_ID } },
    sort: [{ link_id: 'asc' }],
  });
  return found.hits.hits.map((hit) => hit._source as Source);
}

describe('부분 갱신의 대상 간선이 shadow에 아직 없다 (CR-121, FR-ING-008 AC-11)', () => {
  it('**간선 주인이 대상보다 뒤에 처리돼도 재색인이 전환하고 간선이 해결된 채 복원된다**', async () => {
    // PR 30이 #20을 참조한다. 서비스에는 그 간선이 미해결로 있다 — 파생 당시 PR 20이 색인되지 않았다.
    await seedPullRequest(20, 'target');
    await seedPullRequest(30, 'Refs: #20');
    await deriveReferenceLinks(linkDeps(), repository, { kind: 'pull_request', id: '30' });
    // 이제 PR 20이 색인되었다. 재구축은 PR 번호 순서라 20을 먼저 처리하며, 그때 해결 부분 갱신이
    // 서비스의 미해결 간선을 찾아 shadow에도 보내는데 shadow에는 PR 30의 간선이 아직 없다.
    await indexPullRequest(20);

    const enqueued = await enqueue();
    const outcome = await run(enqueued);

    expect(outcome.error).toBeNull();
    expect(outcome.state).toBe('completed');
    expect(await resolveServingIndex(es, LINKS_ALIAS)).toBe(enqueued.targetIndex);
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
  }, 120_000);
});

async function seedStackPullRequest(
  prNumber: number,
  fields: { readonly head: string; readonly base: string; readonly state: 'open' | 'merged' },
): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    prNumber,
    documentVersion: 1,
    source: 'webhook',
    document: {
      pr_number: prNumber,
      title: `PR ${String(prNumber)}`,
      body: '',
      head_branch: fields.head,
      base_branch: fields.base,
      state: fields.state,
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  });
}

describe('해제된 스택 간선 (FR-REL-006 AC-3, DEV-238)', () => {
  it('**상위 PR이 병합돼 해제된 스택 간선이 재색인 뒤에도 해제 상태로 남는다**', async () => {
    // PR 11이 PR 10 위에 쌓였다 — 11의 base가 10의 head다.
    await seedStackPullRequest(10, { head: 'feature-a', base: 'main', state: 'open' });
    await seedStackPullRequest(11, { head: 'feature-b', base: 'feature-a', state: 'open' });
    await handleSourceReady(linkDeps(), repository, { kind: 'pull_request', id: '11' });
    // 상위 PR이 병합됐다. 하위 PR을 다시 파생하면 간선은 지워지지 않고 해제로 표시된다.
    await seedStackPullRequest(10, { head: 'feature-a', base: 'main', state: 'merged' });
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
});
