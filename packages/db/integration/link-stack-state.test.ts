/**
 * 스택 관계의 정본과 prs-links 재색인의 미처리 대기열 (CR-121 / WP-104, FR-REL-006 AC-6, FR-ING-008 AC-11).
 *
 * - 스택: 성립한 적 있는 관계만 행이 되고, 해제돼도 지우지 않으며, 성립해 있는 동안만 시각을 갱신한다.
 *   전환 전 검증이 쓰는 순수 병합(`mergeStackRows`)은 SQL(`reconcileStacks`)과 같은 결과여야 한다.
 * - 미처리: 같은 source가 다시 오면 세대가 오르고, 회수는 읽은 세대만 지운다.
 * - 울타리: 실행 중인 prs-links 재색인의 **바로 그** 대상에서 난 것만 미처리이고, 아니면 실패다.
 *
 * 검증: `pnpm test:integration link-stack-state` (실제 PostgreSQL 필요)
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobRepo, prStackRepo, reindexRepo, withReindexWrite, type StackDesired } from '../src/index.js';
import { migratedPool } from './helpers.js';

const REPO = 9391;
let pool: Pool;

beforeAll(async () => {
  pool = await migratedPool();
});

afterAll(async () => {
  await pool.query('DELETE FROM pull_request_stack WHERE repository_id = $1', [REPO]);
  await pool.query("DELETE FROM job WHERE type = 'reindex' AND requested_by = 'link-stack-state'");
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM pull_request_stack WHERE repository_id = $1', [REPO]);
  await pool.query("DELETE FROM reindex_link_pending WHERE job_id IN (SELECT job_id FROM job WHERE requested_by = 'link-stack-state')");
  await pool.query("DELETE FROM job WHERE type = 'reindex' AND requested_by = 'link-stack-state'");
});

const want = (parent: number, at: string): StackDesired => ({
  parentPrNumber: parent,
  evidence: `base b${String(parent)} = head of #${String(parent)}`,
  edgeCreatedAt: at,
});

describe('스택 정본 (pull_request_stack)', () => {
  it('**성립한 관계가 행이 되고, 성립하지 않게 되면 지우지 않고 해제한다** — 근거·시각은 그대로다', async () => {
    const first = await prStackRepo.reconcileStacks(pool, REPO, 11, [want(10, 't1')]);
    expect(first.detachedNow).toBe(0);
    expect(first.rows).toEqual([
      { repository_id: REPO, child_pr_number: 11, parent_pr_number: 10, evidence: 'base b10 = head of #10', edge_created_at: 't1', detached: false, origin: 'derived' },
    ]);

    const detached = await prStackRepo.reconcileStacks(pool, REPO, 11, []);
    expect(detached.detachedNow).toBe(1);
    expect(detached.rows).toEqual([{ ...first.rows[0], detached: true }]);

    // 이미 해제된 행은 다시 해제로 세지 않는다.
    expect((await prStackRepo.reconcileStacks(pool, REPO, 11, [])).detachedNow).toBe(0);
  });

  it('**다시 성립하면 같은 행이 돌아오고, 성립해 있는 동안은 시각을 지금 값으로 쓴다**', async () => {
    await prStackRepo.reconcileStacks(pool, REPO, 21, [want(20, 't1')]);
    await prStackRepo.reconcileStacks(pool, REPO, 21, []);
    const again = await prStackRepo.reconcileStacks(pool, REPO, 21, [want(20, 't3')]);
    expect(again.rows).toEqual([expect.objectContaining({ parent_pr_number: 20, detached: false, edge_created_at: 't3' })]);
    const updated = await prStackRepo.reconcileStacks(pool, REPO, 21, [want(20, 't4')]);
    expect(updated.rows[0]?.edge_created_at).toBe('t4');
  });

  it('**순수 병합이 SQL과 같은 행을 낸다** — 전환 전 검증이 재구축과 다른 것을 기대하지 않는다', async () => {
    await prStackRepo.reconcileStacks(pool, REPO, 31, [want(30, 't1'), want(29, 't1')]);
    await prStackRepo.reconcileStacks(pool, REPO, 31, [want(30, 't2')]);
    const existing = (await prStackRepo.listStacksOfChildren(pool, REPO, [31])).get(31) ?? [];
    const desired = [want(28, 't5'), want(30, 't5')];
    const merged = prStackRepo.mergeStackRows(REPO, 31, existing, desired);
    const reconciled = await prStackRepo.reconcileStacks(pool, REPO, 31, desired);
    expect(merged).toEqual(reconciled.rows);
  });

  it('**가져오기는 파생 행을 덮지 않고, 두 번 돌려도 같은 표다**', async () => {
    await prStackRepo.reconcileStacks(pool, REPO, 41, [want(40, 'derived-at')]);
    const rows = [
      { repositoryId: REPO, childPrNumber: 41, parentPrNumber: 40, evidence: 'old', edgeCreatedAt: 'old-at', detached: true },
      { repositoryId: REPO, childPrNumber: 43, parentPrNumber: 42, evidence: 'base x = head of #42', edgeCreatedAt: 'e', detached: true },
    ];
    expect(await prStackRepo.importStacks(pool, rows)).toEqual({ inserted: 1, existing: 1 });
    expect(await prStackRepo.importStacks(pool, rows)).toEqual({ inserted: 0, existing: 2 });
    const byChild = await prStackRepo.listStacksOfChildren(pool, REPO, [41, 43]);
    expect(byChild.get(41)).toEqual([expect.objectContaining({ evidence: 'base b40 = head of #40', detached: false, origin: 'derived' })]);
    expect(byChild.get(43)).toEqual([expect.objectContaining({ detached: true, origin: 'imported', edge_created_at: 'e' })]);
    // 가져온 관계가 다시 성립하면 파생 행이 된다.
    const reestablished = await prStackRepo.reconcileStacks(pool, REPO, 43, [want(42, 't9')]);
    expect(reestablished.rows).toEqual([expect.objectContaining({ detached: false, origin: 'derived', edge_created_at: 't9' })]);
  });

  it('역방향 조회와 쌍 확인은 해제된 행도 본다', async () => {
    await prStackRepo.reconcileStacks(pool, REPO, 51, [want(50, 't')]);
    await prStackRepo.reconcileStacks(pool, REPO, 52, [want(50, 't')]);
    await prStackRepo.reconcileStacks(pool, REPO, 52, []);
    expect(await prStackRepo.listChildrenOf(pool, REPO, 50, 10)).toEqual([51, 52]);
    const found = await prStackRepo.findExistingPairs(pool, REPO, [
      { child: 51, parent: 50 },
      { child: 52, parent: 50 },
      { child: 53, parent: 50 },
    ]);
    expect([...found].sort()).toEqual(['51:50', '52:50']);
  });
});

async function runningLinksJob(targetIndex: string): Promise<number> {
  const outcome = await reindexRepo.enqueueReindex(
    pool,
    {
      resolveServingIndex: async () => 'prs-links-v1',
      nextTargetIndex: async () => targetIndex,
      isAlias: (value) => value === 'prs-links',
    },
    'prs-links',
    'link-stack-state',
  );
  if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
  await pool.query("UPDATE job SET state = 'running', started_at = now() WHERE job_id = $1", [outcome.jobId]);
  await reindexRepo.patchReindexProgress(pool, outcome.jobId, { phase: 'backfill' });
  return outcome.jobId;
}

describe('미처리 대기열 (reindex_link_pending)', () => {
  it('**같은 source가 다시 오면 세대가 오르고, 회수는 읽은 세대만 지운다**', async () => {
    const jobId = await runningLinksJob('prs-links-v91');
    const item = { repositoryId: REPO, sourceKind: 'pull_request' as const, sourceId: '7', reason: 'partial_update_document_missing' as const, sampleLinkId: 'l1' };
    await reindexRepo.recordLinkPending(pool, jobId, [item]);
    const [read] = await reindexRepo.listLinkPending(pool, jobId, 10);
    expect(read).toMatchObject({ source_id: '7', generation: 1, sample_link_id: 'l1' });
    // 회수하는 동안 같은 source의 미처리가 다시 기록됐다.
    await reindexRepo.recordLinkPending(pool, jobId, [{ ...item, sampleLinkId: 'l2' }]);
    expect(await reindexRepo.deleteLinkPending(pool, jobId, read!)).toBe(false);
    const [again] = await reindexRepo.listLinkPending(pool, jobId, 10);
    expect(again).toMatchObject({ generation: 2, sample_link_id: 'l2' });
    expect(await reindexRepo.deleteLinkPending(pool, jobId, again!)).toBe(true);
    expect(await reindexRepo.countLinkPending(pool, jobId)).toBe(0);
  });

  it('키 순서로 끝까지 넘기고, 잡이 끝나면 비운다', async () => {
    const jobId = await runningLinksJob('prs-links-v92');
    const items = ['3', '1', '2'].map((id) => ({ repositoryId: REPO, sourceKind: 'commit' as const, sourceId: id.repeat(40), reason: 'derive_incomplete' as const }));
    await reindexRepo.recordLinkPending(pool, jobId, items);
    const first = await reindexRepo.listLinkPending(pool, jobId, 2);
    const rest = await reindexRepo.listLinkPending(pool, jobId, 2, first[first.length - 1]);
    expect([...first, ...rest].map((row) => row.source_id[0])).toEqual(['1', '2', '3']);
    expect(await reindexRepo.clearLinkPending(pool, jobId)).toBe(3);
  });
});

describe('울타리의 미처리 분류 (withReindexWrite)', () => {
  const pending = (index: string) => ({
    alias: 'prs-links',
    index,
    repositoryId: REPO,
    sourceKind: 'pull_request' as const,
    sourceId: '5',
    linkId: 'lnk',
  });

  it('**실행 중인 prs-links 재색인의 바로 그 대상이면 대기열에 남기고, 잡은 실패시키지 않는다**', async () => {
    const jobId = await runningLinksJob('prs-links-v93');
    await withReindexWrite(pool, async (targets) => {
      targets.recordShadowPending?.(pending('prs-links-v93'));
    });
    expect(await reindexRepo.countLinkPending(pool, jobId)).toBe(1);
    expect(await jobRepo.findJobState(pool, jobId)).toBe('running');
  });

  it('**대상이 다른 인덱스면 미처리가 아니라 실패다** — 회수할 잡이 그것을 모른다', async () => {
    const jobId = await runningLinksJob('prs-links-v94');
    await withReindexWrite(pool, async (targets) => {
      targets.recordShadowPending?.(pending('prs-links-v93'));
    });
    expect(await reindexRepo.countLinkPending(pool, jobId)).toBe(0);
    expect(await jobRepo.findJobState(pool, jobId)).toBe('failed');
    const job = await reindexRepo.findReindexJob(pool, jobId);
    expect(job?.progress.failure_samples?.[0]).toContain('회수할 잡이 없다');
  });

  it('**쓰는 사이 잡이 멈췄으면 대기열에 남기지 않는다** — 재개하면 prepare부터 다시 파생한다', async () => {
    const jobId = await runningLinksJob('prs-links-v95');
    await withReindexWrite(pool, async (targets) => {
      // 일시정지는 재색인 울타리 밖의 잡 제어다 — 공유 울타리를 쥔 쓰기 도중에도 들어온다.
      await pool.query("UPDATE job SET state = 'paused' WHERE job_id = $1", [jobId]);
      targets.recordShadowPending?.(pending('prs-links-v95'));
    });
    expect(await reindexRepo.countLinkPending(pool, jobId)).toBe(0);
    expect(await jobRepo.findJobState(pool, jobId)).toBe('paused');
  });
});
