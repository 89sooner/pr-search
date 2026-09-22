/**
 * 머지 커밋 문서의 M 값 투영 (WP-100 / CR-115, FR-SEQ-012 AC-7) — 실제 Elasticsearch로 건다.
 *
 * `applyMergeNumberToCommitDocument`가 (1) `role: merge_commit`인 문서에만 쓰고, (2) 저장소·브랜치·
 * SHA 가드를 지키며, (3) 구 에폭 쓰기를 거절하고 같은 값은 `noop`이며, (4) `clearMergeNumbersBelowEpoch`가
 * PR 문서와 함께 커밋 문서의 옛 세대 값도 지우는지를 본다. **격리된 ES에서만 돈다** — CR-113의
 * 시퀀스 시험과 같은 가드다.
 */

import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMappings, switchAliasesForTests } from '../src/bootstrap.js';
import { applyMergeNumberToCommitDocument, clearMergeNumbersBelowEpoch } from '../src/merge-number.js';
import { SERVING_ONLY } from '../src/write-targets.js';
import { createTestClient, waitForCluster } from './helpers.js';

let es: Client;

const REPOSITORY_ID = 7201;
const BRANCH = 'main';
const MERGE_SHA = 'a'.repeat(40);
const DIRECT_SHA = 'b'.repeat(40);
const OTHER_BRANCH_SHA = 'c'.repeat(40);

async function seed(): Promise<void> {
  await es.deleteByQuery({ index: ['prs-commits', 'prs-pull-requests'], query: { term: { repository_id: REPOSITORY_ID } }, refresh: true, conflicts: 'proceed' });
  await es.bulk({
    refresh: true,
    operations: [
      { index: { _index: 'prs-commits', _id: `${String(REPOSITORY_ID)}:${MERGE_SHA}`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:${MERGE_SHA}`, repository_id: REPOSITORY_ID, commit_sha: MERGE_SHA, role: 'merge_commit', base_branch: BRANCH, pull_request_numbers: [77] },
      { index: { _index: 'prs-commits', _id: `${String(REPOSITORY_ID)}:${DIRECT_SHA}`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:${DIRECT_SHA}`, repository_id: REPOSITORY_ID, commit_sha: DIRECT_SHA, role: 'direct_push', base_branch: BRANCH, pull_request_numbers: [] },
      { index: { _index: 'prs-commits', _id: `${String(REPOSITORY_ID)}:${OTHER_BRANCH_SHA}`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:${OTHER_BRANCH_SHA}`, repository_id: REPOSITORY_ID, commit_sha: OTHER_BRANCH_SHA, role: 'merge_commit', base_branch: 'release', pull_request_numbers: [78] },
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:77`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:77`, repository_id: REPOSITORY_ID, pr_number: 77, base_branch: BRANCH, merge_commit_sha: MERGE_SHA, merge_number: 5, merge_number_epoch: 1, merge_number_state: 'assigned' },
    ],
  });
}

async function commitDoc(sha: string): Promise<Record<string, unknown>> {
  const response = await es.get<Record<string, unknown>>({ index: 'prs-commits', id: `${String(REPOSITORY_ID)}:${sha}`, routing: String(REPOSITORY_ID) });
  return response._source ?? {};
}

beforeAll(async () => {
  es = createTestClient();
  await waitForCluster(es);
  const health = await es.cluster.health();
  const isolated = /isolated|test|ci/i.test(health.cluster_name) || process.env['CI'] !== undefined;
  if (!isolated) {
    throw new Error(`이 시험은 격리된 Elasticsearch에서만 돈다 — cluster.name=${health.cluster_name} (DEV-737)`);
  }
  await applyMappings(es);
  await switchAliasesForTests(es);
}, 120_000);

beforeEach(async () => {
  await seed();
});

afterAll(async () => {
  await es?.deleteByQuery({ index: ['prs-commits', 'prs-pull-requests'], query: { term: { repository_id: REPOSITORY_ID } }, refresh: true, conflicts: 'proceed' });
  await es?.close();
});

const update = { repositoryId: REPOSITORY_ID, commitSha: MERGE_SHA, baseBranch: BRANCH, mergeNumber: 5, mergeNumberEpoch: 1, state: 'assigned' as const };

describe('머지 커밋 문서에만 M 값을 쓴다 (AC-7)', () => {
  it('role이 merge_commit이면 세 필드를 쓴다 — `merge_number_reason`은 커밋에 없다', async () => {
    expect(await applyMergeNumberToCommitDocument(es, update, SERVING_ONLY)).toBe('updated');
    const doc = await commitDoc(MERGE_SHA);
    expect(doc).toMatchObject({ merge_number: 5, merge_number_epoch: 1, merge_number_state: 'assigned' });
    expect(doc).not.toHaveProperty('merge_number_reason');
    // 다시 쓰면 noop — 갱신 없음이 갱신으로 보이면 안 된다.
    expect(await applyMergeNumberToCommitDocument(es, update, SERVING_ONLY)).toBe('noop');
    expect((await commitDoc(MERGE_SHA))['document_version']).toBe(1);
  });

  it('직접 푸시 문서에는 쓰지 않는다 — 역할 가드', async () => {
    expect(await applyMergeNumberToCommitDocument(es, { ...update, commitSha: DIRECT_SHA }, SERVING_ONLY)).toBe('guard_rejected');
    expect(await commitDoc(DIRECT_SHA)).not.toHaveProperty('merge_number');
  });

  it('다른 브랜치의 문서에는 쓰지 않는다 — 브랜치 가드', async () => {
    expect(await applyMergeNumberToCommitDocument(es, { ...update, commitSha: OTHER_BRANCH_SHA }, SERVING_ONLY)).toBe('guard_rejected');
  });

  it('없는 문서는 `document_missing`이다 — 보강이 만든 뒤 다시 온다', async () => {
    expect(await applyMergeNumberToCommitDocument(es, { ...update, commitSha: 'f'.repeat(40) }, SERVING_ONLY)).toBe('document_missing');
  });

  it('구 에폭의 쓰기는 새 에폭 값을 되돌리지 못한다 (ADR-007 규칙 5)', async () => {
    expect(await applyMergeNumberToCommitDocument(es, { ...update, mergeNumberEpoch: 2, mergeNumber: 3 }, SERVING_ONLY)).toBe('updated');
    expect(await applyMergeNumberToCommitDocument(es, { ...update, mergeNumberEpoch: 1, mergeNumber: 5 }, SERVING_ONLY)).toBe('noop');
    expect(await commitDoc(MERGE_SHA)).toMatchObject({ merge_number: 3, merge_number_epoch: 2 });
  });

  it('pending은 번호를 지우고 상태만 남긴다', async () => {
    await applyMergeNumberToCommitDocument(es, update, SERVING_ONLY);
    expect(await applyMergeNumberToCommitDocument(es, { ...update, state: 'pending' }, SERVING_ONLY)).toBe('updated');
    const doc = await commitDoc(MERGE_SHA);
    expect(doc).not.toHaveProperty('merge_number');
    expect(doc).toMatchObject({ merge_number_state: 'pending', merge_number_epoch: 1 });
  });
});

describe('에폭 상향 정리가 커밋 문서도 덮는다', () => {
  it('`clearMergeNumbersBelowEpoch`가 PR·커밋 문서의 옛 세대 값을 함께 지운다', async () => {
    await applyMergeNumberToCommitDocument(es, update, SERVING_ONLY);
    const cleared = await clearMergeNumbersBelowEpoch(es, { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, newEpoch: 2 }, SERVING_ONLY);
    expect(cleared).toBe(2);
    const commit = await commitDoc(MERGE_SHA);
    expect(commit).not.toHaveProperty('merge_number');
    expect(commit).toMatchObject({ merge_number_state: 'pending', merge_number_epoch: 2 });
    expect(commit).not.toHaveProperty('merge_number_reason');
    const pr = (await es.get<Record<string, unknown>>({ index: 'prs-pull-requests', id: `${String(REPOSITORY_ID)}:77`, routing: String(REPOSITORY_ID) }))._source ?? {};
    expect(pr).toMatchObject({ merge_number_state: 'pending', merge_number_reason: 'not_sequenced', merge_number_epoch: 2 });
    // 다른 브랜치의 문서는 건드리지 않는다.
    expect(await commitDoc(OTHER_BRANCH_SHA)).not.toHaveProperty('merge_number_epoch');
  });
});
