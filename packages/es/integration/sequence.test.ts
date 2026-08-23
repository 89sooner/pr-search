/**
 * 채번 결과가 실제 Elasticsearch 문서에 반영된다 (WP-021 / FR-SEQ-001).
 *
 * 단위 계층은 시퀀스 값이 맞는지를 PostgreSQL과 git으로 판정한다. 여기서는
 * 그 값이 **조회 가능한 문서에 실제로 실리는지**를 확인한다 — painless
 * 스크립트나 `_routing`이 어긋나면 시퀀스가 PostgreSQL에만 있고 화면에는
 * 영원히 `not_computed`로 남는데, 그때 아무 오류도 나지 않는다.
 */

import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySequenceToDocuments } from '../src/sequence.js';
import { applyMappings } from '../src/bootstrap.js';
import { createTestClient, waitForCluster } from './helpers.js';

let es: Client;

const REPOSITORY_ID = 7101;
const OTHER_REPOSITORY_ID = 7102;
const BRANCH = 'main';
const SPACE = 'acme/payments@main';

const MERGE_SHA = 'a'.repeat(40);
const DIRECT_SHA = 'b'.repeat(40);
const UNRELATED_SHA = 'c'.repeat(40);
const OPEN_PR_SHA = 'd'.repeat(40);

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
      // 다른 저장소의 같은 SHA — 저장소 경계를 넘지 않는지 본다.
      { index: { _index: 'prs-commits', _id: `${String(OTHER_REPOSITORY_ID)}:${MERGE_SHA}`, routing: String(OTHER_REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(OTHER_REPOSITORY_ID)}:${MERGE_SHA}`, repository_id: OTHER_REPOSITORY_ID, commit_sha: MERGE_SHA },

      // 머지된 PR — `merge_commit_sha`로 서수를 받는다.
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:1`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:1`, repository_id: REPOSITORY_ID, pr_number: 1, merge_commit_sha: MERGE_SHA },
      // 열린 PR — `merge_commit_sha`가 **없다**. 스크립트가 여기서 깨지면 안 된다.
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:2`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:2`, repository_id: REPOSITORY_ID, pr_number: 2 },
      // 아직 머지되지 않았지만 head SHA가 있는 PR — 서수를 받으면 안 된다.
      { index: { _index: 'prs-pull-requests', _id: `${String(REPOSITORY_ID)}:3`, routing: String(REPOSITORY_ID) } },
      { document_version: 1, doc_id: `${String(REPOSITORY_ID)}:3`, repository_id: REPOSITORY_ID, pr_number: 3, head_sha: OPEN_PR_SHA },
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

function apply(assignments: { commitSha: string; mergeSeq: number }[]): Promise<unknown> {
  return applySequenceToDocuments(es, {
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    seqEpoch: 1,
    sequenceSpace: SPACE,
    assignments,
  });
}

beforeAll(async () => {
  es = createTestClient();
  await waitForCluster(es);
  await applyMappings(es);
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

describe('채번 결과 반영', () => {
  it('**커밋 문서가 서수·에폭·공간·브랜치를 받는다**', async () => {
    await apply([
      { commitSha: MERGE_SHA, mergeSeq: 3 },
      { commitSha: DIRECT_SHA, mergeSeq: 4 },
    ]);

    const merge = await commitDoc(REPOSITORY_ID, MERGE_SHA);
    expect(merge['merge_seq']).toBe(3);
    expect(merge['seq_epoch']).toBe(1);
    expect(merge['sequence_space']).toBe(SPACE);
    expect(merge['base_branch']).toBe(BRANCH);

    expect((await commitDoc(REPOSITORY_ID, DIRECT_SHA))['merge_seq']).toBe(4);
  });

  it('**표에 없는 커밋은 건드리지 않는다**', async () => {
    await apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }]);

    const unrelated = await commitDoc(REPOSITORY_ID, UNRELATED_SHA);
    expect(unrelated['merge_seq']).toBeUndefined();
    expect(unrelated['sequence_space']).toBeUndefined();
  });

  it('**다른 저장소의 같은 SHA는 건드리지 않는다** — 저장소 경계를 넘지 않는다', async () => {
    await apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }]);

    const other = await commitDoc(OTHER_REPOSITORY_ID, MERGE_SHA);
    expect(other['merge_seq']).toBeUndefined();
  });

  it('**PR 문서는 머지 커밋의 SHA로 서수를 받는다**', async () => {
    await apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }]);

    const merged = await prDoc(1);
    expect(merged['merge_seq']).toBe(3);
    expect(merged['sequence_space']).toBe(SPACE);
  });

  it('**`merge_commit_sha`가 없는 열린 PR에서 깨지지 않는다**', async () => {
    /*
     * 스크립트가 없는 필드에 `.toLowerCase()`를 부르면 갱신 전체가 실패한다.
     * 그러면 그 회차의 **모든** 문서가 서수를 놓친다 — 열린 PR 하나 때문에.
     */
    await expect(apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }])).resolves.toBeDefined();

    const open = await prDoc(2);
    expect(open['merge_seq']).toBeUndefined();
    const unmerged = await prDoc(3);
    expect(unmerged['merge_seq']).toBeUndefined();
  });

  it('대문자 SHA로 넘겨도 소문자 문서를 찾는다', async () => {
    await apply([{ commitSha: MERGE_SHA.toUpperCase(), mergeSeq: 7 }]);
    expect((await commitDoc(REPOSITORY_ID, MERGE_SHA))['merge_seq']).toBe(7);
  });

  it('멱등이다 — 두 번 반영해도 같은 값이다', async () => {
    await apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }]);
    const first = await commitDoc(REPOSITORY_ID, MERGE_SHA);
    await apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }]);
    const second = await commitDoc(REPOSITORY_ID, MERGE_SHA);

    expect(second).toEqual(first);
  });

  it('**`document_version`을 올리지 않는다** — 올리면 뒤늦게 온 정상 웹훅이 밀려 사라진다', async () => {
    await apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }]);
    expect((await commitDoc(REPOSITORY_ID, MERGE_SHA))['document_version']).toBe(1);
  });

  it('빈 목록은 아무것도 갱신하지 않는다', async () => {
    const result = (await apply([])) as { total: number };
    expect(result.total).toBe(0);
  });

  it('갱신 건수를 별칭별로 보고한다', async () => {
    const result = (await apply([{ commitSha: MERGE_SHA, mergeSeq: 3 }])) as {
      updated: Record<string, number>;
      total: number;
    };
    expect(result.updated['prs-commits']).toBe(1);
    expect(result.updated['prs-pull-requests']).toBe(1);
    expect(result.total).toBe(2);
  });
});
