/**
 * 채번 결과가 실제 Elasticsearch 문서에 반영된다 (WP-021 / FR-SEQ-001, CR-113).
 *
 * 단위 계층은 시퀀스 값이 맞는지를 PostgreSQL과 git으로 판정한다. 여기서는
 * 그 값이 **조회 가능한 문서에 실제로 실리는지**를 확인한다 — painless
 * 스크립트나 `_routing`이 어긋나면 시퀀스가 PostgreSQL에만 있고 화면에는
 * 영원히 `not_computed`로 남는데, 그때 아무 오류도 나지 않는다.
 *
 * CR-113부터 쓰기는 문서 단위 투영기(`projectSequenceToDocuments`)다. 이 파일은 그
 * 투영기의 **문서별 판정**(updated·noop·document_missing·guard_rejected·stale_epoch)과
 * 가드(저장소·SHA·브랜치·에폭)를 실제 클러스터에서 확인한다. 정본 해석(어느 문서에 몇
 * 번인가)은 애플리케이션 계층의 몫이라 여기서는 항목을 손으로 만든다.
 */

import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyEpochBump } from '../src/sequence.js';
import {
  projectSequenceToDocuments,
  readSequenceOrder,
  readSequenceProjection,
  type SequenceProjectionItem,
  type SequenceProjectionResult,
} from '../src/sequence-projection.js';
import { SERVING_ONLY, type ShadowWriteFailure } from '../src/write-targets.js';
import { applyMappings, switchAliasesForTests } from '../src/bootstrap.js';
import { createTestClient, waitForCluster } from './helpers.js';

let es: Client;

const REPOSITORY_ID = 7101;
const OTHER_REPOSITORY_ID = 7102;
const BRANCH = 'main';
const OTHER_BRANCH = 'release/1.x';
const SPACE = 'acme/payments@main';

const MERGE_SHA = 'a'.repeat(40);
const DIRECT_SHA = 'b'.repeat(40);
const UNRELATED_SHA = 'c'.repeat(40);
const OPEN_PR_SHA = 'd'.repeat(40);
const FOREIGN_SHA = 'e'.repeat(40);

/**
 * `_routing`을 반드시 넘긴다.
 *
 * `prs-commits`는 12샤드, `prs-pull-requests`는 6샤드다. 라우팅 없이 심으면
 * `_id` 해시로 흩어져, 라우팅을 넘기는 갱신이 그 문서를 만나지 못한다 —
 * 그러면 **갱신이 아무것도 안 했는데 시험은 통과한다**(WP-019에서 겪었다).
 */
async function seed(): Promise<void> {
  await es.bulk({
    refresh: true,
    operations: [
      { index: { _index: 'prs-commits', _id: `${String(REPOSITORY_ID)}:${MERGE_SHA}`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:${MERGE_SHA}`, repository_id: REPOSITORY_ID, commit_sha: MERGE_SHA },
      { index: { _index: 'prs-commits', _id: `${String(REPOSITORY_ID)}:${DIRECT_SHA}`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:${DIRECT_SHA}`, repository_id: REPOSITORY_ID, commit_sha: DIRECT_SHA },
      { index: { _index: 'prs-commits', _id: `${String(REPOSITORY_ID)}:${UNRELATED_SHA}`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:${UNRELATED_SHA}`, repository_id: REPOSITORY_ID, commit_sha: UNRELATED_SHA },
      // 다른 브랜치(공간)의 서수를 이미 단 커밋 문서 — 같은 SHA를 두 공간이 다툰다.
      { index: { _index: 'prs-commits', _id: `${String(REPOSITORY_ID)}:${FOREIGN_SHA}`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:${FOREIGN_SHA}`, repository_id: REPOSITORY_ID, commit_sha: FOREIGN_SHA, base_branch: OTHER_BRANCH, merge_seq: 9, seq_epoch: 1, sequence_space: `acme/payments@${OTHER_BRANCH}` },
      // 다른 저장소의 같은 SHA — 저장소 경계를 넘지 않는지 본다.
      { index: { _index: 'prs-commits', _id: `${String(OTHER_REPOSITORY_ID)}:${MERGE_SHA}`, routing: String(OTHER_REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(OTHER_REPOSITORY_ID)}:${MERGE_SHA}`, repository_id: OTHER_REPOSITORY_ID, commit_sha: MERGE_SHA },

      // 머지된 PR — `merge_commit_sha`로 서수를 받는다.
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:1`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:1`, repository_id: REPOSITORY_ID, pr_number: 1, base_branch: BRANCH, merge_commit_sha: MERGE_SHA },
      // 열린 PR — `merge_commit_sha`가 **없다**. 스크립트가 여기서 깨지면 안 된다.
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:2`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:2`, repository_id: REPOSITORY_ID, pr_number: 2, base_branch: BRANCH },
      // 아직 머지되지 않았지만 head SHA가 있는 PR — 서수를 받으면 안 된다.
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:3`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:3`, repository_id: REPOSITORY_ID, pr_number: 3, base_branch: BRANCH, head_sha: OPEN_PR_SHA },
      // 다른 base 브랜치로 머지된 PR — 같은 SHA여도 이 공간의 PR이 아니다.
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:4`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:4`, repository_id: REPOSITORY_ID, pr_number: 4, base_branch: OTHER_BRANCH, merge_commit_sha: DIRECT_SHA },
    ],
  });
}

async function commitDoc(repositoryId: number, sha: string): Promise<Record<string, unknown>> {
  const response = await es.get<Record<string, unknown>>({
    index: 'prs-commits',
    id: `${String(repositoryId)}:${sha}`,
    routing: String(repositoryId),
  });
  return response._source ?? {};
}

async function prDoc(number: number): Promise<Record<string, unknown>> {
  const response = await es.get<Record<string, unknown>>({
    index: 'prs-pull-requests',
    id: `${String(REPOSITORY_ID)}:${String(number)}`,
    routing: String(REPOSITORY_ID),
  });
  return response._source ?? {};
}

function commitItem(sha: string, mergeSeq: number, over: Partial<SequenceProjectionItem> = {}): SequenceProjectionItem {
  return {
    kind: 'commit',
    docId: `${String(REPOSITORY_ID)}:${sha.toLowerCase()}`,
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    seqEpoch: 1,
    sequenceSpace: SPACE,
    expectedSha: sha.toLowerCase(),
    mergeSeq,
    ...over,
  };
}

function prItem(prNumber: number, sha: string, mergeSeq: number, over: Partial<SequenceProjectionItem> = {}): SequenceProjectionItem {
  return {
    kind: 'pull_request',
    docId: `${String(REPOSITORY_ID)}:${String(prNumber)}`,
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    seqEpoch: 1,
    sequenceSpace: SPACE,
    expectedSha: sha.toLowerCase(),
    mergeSeq,
    ...over,
  };
}

function project(items: readonly SequenceProjectionItem[], dryRun = false): Promise<SequenceProjectionResult> {
  return projectSequenceToDocuments(es, items, SERVING_ONLY, dryRun ? { dryRun: true } : {});
}

function outcomeOf(result: SequenceProjectionResult, alias: string, docId: string): { kind: string; reason?: string } {
  const found = result.served[alias]?.outcomes.find((one) => one.docId === docId);
  if (found === undefined) throw new Error(`결과에 ${docId}가 없다`);
  return found.reason === undefined ? { kind: found.kind } : { kind: found.kind, reason: found.reason };
}

beforeAll(async () => {
  es = createTestClient();
  await waitForCluster(es);
  // 고정 별칭의 문서를 지우고 별칭을 옮기는 파괴적 시험이다 — 격리 표식이 없는 클러스터에서는 시작하지 않는다 (CR-113, DEV-737).
  const info = await es.info();
  if (!/isolated|test|ci/i.test(String(info.cluster_name)) && process.env['CI'] !== 'true') {
    throw new Error(`격리되지 않은 Elasticsearch(${String(info.cluster_name)})에서는 이 시험을 돌리지 않는다`);
  }
  await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);
}, 120_000);

afterAll(async () => {
  await es.close();
});

beforeEach(async () => {
  /*
   * **먼저 refresh하고 지운다.** `delete_by_query`는 검색이므로, 직전
   * 시험이 심은 문서가 `refresh_interval`(1초) 안이면 보이지 않아 지워지지
   * 않는다 — WP-019에서 그 때문에 건수가 어긋났다.
   */
  await es.indices.refresh({ index: 'prs-commits,prs-pull-requests' });
  await es.deleteByQuery({
    index: 'prs-commits,prs-pull-requests',
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });
  await seed();
});

describe('문서 단위 투영 (CR-113)', () => {
  it('**커밋 문서가 서수·에폭·공간·브랜치를 받는다** — 결과는 `updated`다', async () => {
    const result = await project([commitItem(MERGE_SHA, 3), commitItem(DIRECT_SHA, 4)]);
    expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toEqual({ kind: 'updated' });

    const merge = await commitDoc(REPOSITORY_ID, MERGE_SHA);
    expect(merge['merge_seq']).toBe(3);
    expect(merge['seq_epoch']).toBe(1);
    expect(merge['sequence_space']).toBe(SPACE);
    expect(merge['base_branch']).toBe(BRANCH);
    expect((await commitDoc(REPOSITORY_ID, DIRECT_SHA))['merge_seq']).toBe(4);
    expect(result.served['prs-commits']?.counts).toMatchObject({ updated: 2, noop: 0, document_missing: 0 });
  });

  it('**항목에 없는 문서는 건드리지 않는다**', async () => {
    await project([commitItem(MERGE_SHA, 3)]);
    const unrelated = await commitDoc(REPOSITORY_ID, UNRELATED_SHA);
    expect(unrelated['merge_seq']).toBeUndefined();
    expect(unrelated['sequence_space']).toBeUndefined();
    expect((await commitDoc(OTHER_REPOSITORY_ID, MERGE_SHA))['merge_seq']).toBeUndefined();
  });

  it('**PR 문서는 머지 커밋의 SHA로 서수를 받는다**', async () => {
    const result = await project([prItem(1, MERGE_SHA, 3)]);
    expect(outcomeOf(result, 'prs-pull-requests', `${String(REPOSITORY_ID)}:1`)).toEqual({ kind: 'updated' });
    const merged = await prDoc(1);
    expect(merged['merge_seq']).toBe(3);
    expect(merged['sequence_space']).toBe(SPACE);
    expect(merged['base_branch']).toBe(BRANCH);
  });

  it('**`merge_commit_sha`가 없거나 다른 PR은 `guard_rejected:sha`다** — 스크립트가 깨지지 않고 문서도 바뀌지 않는다', async () => {
    const result = await project([prItem(2, MERGE_SHA, 3), prItem(3, OPEN_PR_SHA, 3)]);
    expect(outcomeOf(result, 'prs-pull-requests', `${String(REPOSITORY_ID)}:2`)).toEqual({ kind: 'guard_rejected', reason: 'sha' });
    expect(outcomeOf(result, 'prs-pull-requests', `${String(REPOSITORY_ID)}:3`)).toEqual({ kind: 'guard_rejected', reason: 'sha' });
    expect((await prDoc(2))['merge_seq']).toBeUndefined();
    expect((await prDoc(3))['merge_seq']).toBeUndefined();
  });

  it('**PR의 base 브랜치가 다르면 쓰지 않는다** — 복구가 PR의 `base_branch`를 바꾸지 않는다', async () => {
    const result = await project([prItem(4, DIRECT_SHA, 4)]);
    expect(outcomeOf(result, 'prs-pull-requests', `${String(REPOSITORY_ID)}:4`)).toEqual({ kind: 'guard_rejected', reason: 'branch' });
    const doc = await prDoc(4);
    expect(doc['merge_seq']).toBeUndefined();
    expect(doc['base_branch']).toBe(OTHER_BRANCH);
  });

  it('**없는 문서는 `document_missing`이다** — 만들지 않는다', async () => {
    const result = await project([prItem(99, MERGE_SHA, 3), commitItem('f'.repeat(40), 5)]);
    expect(outcomeOf(result, 'prs-pull-requests', `${String(REPOSITORY_ID)}:99`)).toEqual({ kind: 'document_missing' });
    expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${'f'.repeat(40)}`)).toEqual({ kind: 'document_missing' });
    await expect(es.exists({ index: 'prs-pull-requests', id: `${String(REPOSITORY_ID)}:99`, routing: String(REPOSITORY_ID) })).resolves.toBe(false);
  });

  it('**다른 저장소의 문서 ID를 넘겨도 저장소 가드가 막는다**', async () => {
    const result = await project([commitItem(MERGE_SHA, 3, { docId: `${String(OTHER_REPOSITORY_ID)}:${MERGE_SHA}`, repositoryId: REPOSITORY_ID })]);
    // 라우팅이 이 저장소라 문서를 못 찾거나(missing), 찾아도 저장소가 달라 거부된다 — 어느 쪽이든 쓰지 않는다.
    const outcome = outcomeOf(result, 'prs-commits', `${String(OTHER_REPOSITORY_ID)}:${MERGE_SHA}`);
    expect(['document_missing', 'guard_rejected']).toContain(outcome.kind);
    expect((await commitDoc(OTHER_REPOSITORY_ID, MERGE_SHA))['merge_seq']).toBeUndefined();
  });

  it('**다른 공간의 서수를 단 커밋 문서는 덮지 않는다** — `reclaim`이 있을 때만 가져간다', async () => {
    const kept = await project([commitItem(FOREIGN_SHA, 2)]);
    expect(outcomeOf(kept, 'prs-commits', `${String(REPOSITORY_ID)}:${FOREIGN_SHA}`)).toEqual({ kind: 'guard_rejected', reason: 'branch' });
    let doc = await commitDoc(REPOSITORY_ID, FOREIGN_SHA);
    expect(doc).toMatchObject({ merge_seq: 9, base_branch: OTHER_BRANCH });

    const taken = await project([commitItem(FOREIGN_SHA, 2, { reclaim: true })]);
    expect(outcomeOf(taken, 'prs-commits', `${String(REPOSITORY_ID)}:${FOREIGN_SHA}`)).toEqual({ kind: 'updated' });
    doc = await commitDoc(REPOSITORY_ID, FOREIGN_SHA);
    expect(doc).toMatchObject({ merge_seq: 2, seq_epoch: 1, base_branch: BRANCH, sequence_space: SPACE });
  });

  it('**구 에폭 작업은 새 에폭을 덮지 못한다** — `stale_epoch`', async () => {
    await project([commitItem(MERGE_SHA, 3, { seqEpoch: 2, sequenceSpace: SPACE })]);
    const result = await project([commitItem(MERGE_SHA, 5, { seqEpoch: 1 })]);
    expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toEqual({ kind: 'stale_epoch' });
    expect(await commitDoc(REPOSITORY_ID, MERGE_SHA)).toMatchObject({ merge_seq: 3, seq_epoch: 2 });
  });

  it('**새 에폭은 옛 에폭 문서를 덮는다** — 재채번 뒤 값이 앞으로 간다', async () => {
    await project([commitItem(MERGE_SHA, 3, { seqEpoch: 1 })]);
    const result = await project([commitItem(MERGE_SHA, 4, { seqEpoch: 2 })]);
    expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toEqual({ kind: 'updated' });
    expect(await commitDoc(REPOSITORY_ID, MERGE_SHA)).toMatchObject({ merge_seq: 4, seq_epoch: 2 });
  });

  it('대문자 SHA로 넘겨도 소문자 문서를 찾는다', async () => {
    const result = await project([commitItem(MERGE_SHA, 7, { expectedSha: MERGE_SHA.toUpperCase() })]);
    expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toEqual({ kind: 'updated' });
    expect((await commitDoc(REPOSITORY_ID, MERGE_SHA))['merge_seq']).toBe(7);
  });

  it('**멱등이다** — 두 번째는 `noop`이고 문서가 바이트 단위로 같다', async () => {
    await project([commitItem(MERGE_SHA, 3)]);
    const first = await commitDoc(REPOSITORY_ID, MERGE_SHA);
    const again = await project([commitItem(MERGE_SHA, 3)]);
    expect(outcomeOf(again, 'prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toEqual({ kind: 'noop' });
    expect(await commitDoc(REPOSITORY_ID, MERGE_SHA)).toEqual(first);
  });

  it('**`document_version`을 올리지 않는다** — 올리면 뒤늦게 온 정상 웹훅이 밀려 사라진다', async () => {
    await project([commitItem(MERGE_SHA, 3), prItem(1, MERGE_SHA, 3)]);
    expect((await commitDoc(REPOSITORY_ID, MERGE_SHA))['document_version']).toBe(1);
    expect((await prDoc(1))['document_version']).toBe(1);
  });

  it('**dry-run은 아무것도 쓰지 않고 `would_update`로 말한다**', async () => {
    const result = await project([commitItem(MERGE_SHA, 3), commitItem(UNRELATED_SHA, 8, { expectedSha: MERGE_SHA })], true);
    expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toEqual({ kind: 'would_update' });
    expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${UNRELATED_SHA}`)).toEqual({ kind: 'guard_rejected', reason: 'sha' });
    expect((await commitDoc(REPOSITORY_ID, MERGE_SHA))['merge_seq']).toBeUndefined();
  });

  it('빈 목록은 아무것도 갱신하지 않는다', async () => {
    const result = await project([]);
    expect(result).toEqual({ served: {}, shadows: {} });
  });

  it('**shadow 결과는 서비스 결과와 따로 온다** — active 성공이 shadow 누락을 덮지 않는다', async () => {
    const shadowIndex = 'prs-commits-cr113-shadow';
    if (await es.indices.exists({ index: shadowIndex })) await es.indices.delete({ index: shadowIndex });
    await es.indices.create({ index: shadowIndex });
    try {
      const failures: ShadowWriteFailure[] = [];
      const result = await projectSequenceToDocuments(es, [commitItem(MERGE_SHA, 3)], {
        shadows: { 'prs-commits': shadowIndex },
        recordShadowFailure: (failure) => failures.push(failure),
      });
      expect(outcomeOf(result, 'prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toEqual({ kind: 'updated' });
      // shadow에는 문서가 없다 — 서비스가 성공했어도 shadow 결과는 `document_missing`이다.
      expect(result.shadows['prs-commits']?.outcomes[0]).toMatchObject({ kind: 'document_missing' });
      expect(failures).toEqual([]);
    } finally {
      await es.indices.delete({ index: shadowIndex });
    }
  });

  it('**사전 읽기와 정렬 조회가 같은 값을 본다**', async () => {
    await project([commitItem(MERGE_SHA, 3), commitItem(DIRECT_SHA, 4)]);
    const observed = await readSequenceProjection(es, 'prs-commits', [commitItem(MERGE_SHA, 3), commitItem(UNRELATED_SHA, 0)]);
    expect(observed.get(`${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toMatchObject({ merge_seq: 3, seq_epoch: 1, sequence_space: SPACE, sha: MERGE_SHA });
    expect(observed.get(`${String(REPOSITORY_ID)}:${UNRELATED_SHA}`)).toMatchObject({ merge_seq: null });

    const order = await readSequenceOrder(es, 'prs-commits', { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: 1 }, { fromInclusive: 1, toInclusive: 10 });
    expect(order.map((one) => one.mergeSeq)).toEqual([3, 4]);
  });
});

describe('에폭 전환 반영 (WP-022 / CR-026, DEV-129)', () => {
  const NEW_SPACE = 'acme/payments@main';

  it('**서수를 가진 문서만 새 에폭을 받는다** — 서수 없는 문서에 반쪽 상태를 만들지 않는다', async () => {
    await project([commitItem(MERGE_SHA, 3)]);

    const result = await applyEpochBump(es, {
      repositoryId: REPOSITORY_ID,
      baseBranch: BRANCH,
      newEpoch: 2,
      sequenceSpace: NEW_SPACE,
    }, SERVING_ONLY);
    expect(result.total).toBeGreaterThan(0);
    // CR-113: `updated`만이 아니라 충돌·실패·시간 초과까지 판정 재료로 준다.
    expect(result.complete).toBe(true);
    expect(result.tallies['prs-commits']).toMatchObject({ updated: 1, version_conflicts: 0, failures: 0, timed_out: false });

    const merge = await commitDoc(REPOSITORY_ID, MERGE_SHA);
    expect(merge['seq_epoch']).toBe(2);
    expect(merge['merge_seq']).toBe(3); // 서수는 그대로다 — 에폭만 바뀐다.

    // 서수를 받은 적 없는 커밋은 에폭도 받지 않는다.
    const unrelated = await commitDoc(REPOSITORY_ID, UNRELATED_SHA);
    expect(unrelated['seq_epoch']).toBeUndefined();
  });

  it('다른 저장소·다른 브랜치는 건드리지 않는다', async () => {
    await project([commitItem(MERGE_SHA, 3)]);
    await applyEpochBump(es, {
      repositoryId: REPOSITORY_ID,
      baseBranch: BRANCH,
      newEpoch: 2,
      sequenceSpace: NEW_SPACE,
    }, SERVING_ONLY);

    expect((await commitDoc(OTHER_REPOSITORY_ID, MERGE_SHA))['seq_epoch']).toBeUndefined();
    expect(await commitDoc(REPOSITORY_ID, FOREIGN_SHA)).toMatchObject({ seq_epoch: 1, base_branch: OTHER_BRANCH });
  });

  it('`document_version`을 올리지 않고, 재실행은 0건 갱신이다 (멱등)', async () => {
    await project([commitItem(MERGE_SHA, 3)]);
    await applyEpochBump(es, {
      repositoryId: REPOSITORY_ID,
      baseBranch: BRANCH,
      newEpoch: 2,
      sequenceSpace: NEW_SPACE,
    }, SERVING_ONLY);

    const merge = await commitDoc(REPOSITORY_ID, MERGE_SHA);
    expect(merge['document_version']).toBe(1);

    const again = await applyEpochBump(es, {
      repositoryId: REPOSITORY_ID,
      baseBranch: BRANCH,
      newEpoch: 2,
      sequenceSpace: NEW_SPACE,
    }, SERVING_ONLY);
    expect(again.total).toBe(0);
    expect(again.complete).toBe(true);
  });
});
