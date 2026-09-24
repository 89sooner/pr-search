/**
 * 커밋 메타데이터 쓰기의 결과가 **실제 Elasticsearch 오류**로 갈린다 (CR-119 / FR-ING-008 AC-10).
 *
 * 단위 시험(`src/commit-metadata.test.ts`)은 오류 모양을 흉내 낸다. 여기서 거는 것은 진짜
 * 클러스터가 문서 없음과 인덱스 없음을 **다른 오류로** 돌려주고, 이 경로가 그 차이를 읽는다는
 * 사실이다 — 둘 다 404라서 상태 코드만 보면 구별되지 않는다.
 *
 * 실행: `pnpm test:integration packages/es/integration/commit-metadata` (실제 ES 필요)
 */

import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMappings } from '../src/bootstrap.js';
import { upsertCommitMetadata, type CommitMetadataUpsert } from '../src/commit-metadata.js';
import { SERVING_ONLY, type ShadowWriteFailure, type WriteTargets } from '../src/write-targets.js';
import { createTestClient, waitForCluster } from './helpers.js';

let es: Client;

const REPOSITORY_ID = 7381;
/** 이 시험만 쓰는 대상 인덱스. 버전 이름(`prs-commits-vN`)을 쓰지 않아 재색인 번호 계산에 끼지 않는다. */
const PROBE_INDEX = 'cr118-commit-metadata-probe';
/** 만든 적 없는 인덱스. */
const ABSENT_INDEX = 'cr118-commit-metadata-absent';

function input(sha: string): CommitMetadataUpsert {
  return {
    repositoryId: REPOSITORY_ID,
    commitSha: sha,
    docId: `${String(REPOSITORY_ID)}:${sha}`,
    fields: {
      parent_shas: ['b'.repeat(40)],
      message: `message ${sha.slice(0, 6)}`,
      author: null,
      committer: 'c',
      authored_at: '2026-09-01T00:00:00.000Z',
      committed_at: '2026-09-01T00:00:00.000Z',
      changed_paths: ['a.ts'],
      changed_paths_truncated: false,
    },
  };
}

function targetsFor(index: string): { targets: WriteTargets; failures: ShadowWriteFailure[] } {
  const failures: ShadowWriteFailure[] = [];
  return { targets: { shadows: { 'prs-commits': index }, recordShadowFailure: (one) => failures.push(one) }, failures };
}

beforeAll(async () => {
  es = createTestClient();
  await waitForCluster(es);
  await applyMappings(es);
  await es.indices.delete({ index: PROBE_INDEX, ignore_unavailable: true });
  await es.indices.create({ index: PROBE_INDEX });
});

afterAll(async () => {
  await es.indices.delete({ index: PROBE_INDEX, ignore_unavailable: true });
  await es.indices.delete({ index: ABSENT_INDEX, ignore_unavailable: true });
  await es.deleteByQuery({
    index: 'prs-commits',
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
    ignore_unavailable: true,
  });
  await es.close();
});

describe('실제 클러스터의 404 두 가지', () => {
  it('서비스에 문서가 없으면 `document_missing`이다 — 만들지 않는다', async () => {
    const sha = '1'.repeat(40);
    expect(await upsertCommitMetadata(es, input(sha), SERVING_ONLY)).toEqual({ result: 'document_missing' });
    const exists = await es.exists({ index: 'prs-commits', id: `${String(REPOSITORY_ID)}:${sha}`, routing: String(REPOSITORY_ID) });
    expect(exists).toBe(false);
  });

  it('대상에 문서가 없으면 대상 결과만 `document_missing`이고 실패로 기록하지 않는다', async () => {
    const sha = '2'.repeat(40);
    const { targets, failures } = targetsFor(PROBE_INDEX);
    const outcome = await upsertCommitMetadata(es, input(sha), targets);
    expect(outcome).toEqual({ result: 'document_missing', shadow: 'document_missing' });
    expect(failures).toEqual([]);
  });

  it('**대상 인덱스가 없으면 `update`가 그 이름으로 인덱스를 자동 생성한다** — 그래서 재색인은 이름이 아니라 UUID로 대조한다', async () => {
    /*
     * `action.auto_create_index`의 기본값에서 `update`는 없는 인덱스에 대해
     * `index_not_found_exception`을 내지 않는다. 같은 이름의 인덱스를 **동적 매핑으로** 만든 뒤
     * 문서 없음으로 답한다. 이 경로는 그 결과를 문서 없음으로 읽을 수밖에 없으므로, 대상이
     * 도중에 바뀌었는지는 재색인이 준비 단계에서 남긴 UUID로 판정한다(`targetReplaced`).
     * 이 시험은 그 전제가 클러스터에서 참인지를 고정한다 — 기본값이 바뀌면 여기서 깨진다.
     */
    const sha = '3'.repeat(40);
    await es.indices.delete({ index: ABSENT_INDEX, ignore_unavailable: true });
    const { targets, failures } = targetsFor(ABSENT_INDEX);
    try {
      const outcome = await upsertCommitMetadata(es, input(sha), targets);
      expect(outcome).toEqual({ result: 'document_missing', shadow: 'document_missing' });
      expect(failures).toEqual([]);
      expect(await es.indices.exists({ index: ABSENT_INDEX })).toBe(true);
    } finally {
      await es.indices.delete({ index: ABSENT_INDEX, ignore_unavailable: true });
    }
  });

  it('문서가 생긴 뒤에는 `updated`, 같은 값을 다시 보내면 `already_equal`이다', async () => {
    const sha = '4'.repeat(40);
    await es.index({ index: PROBE_INDEX, id: `${String(REPOSITORY_ID)}:${sha}`, routing: String(REPOSITORY_ID), document: { commit_sha: sha }, refresh: true });
    const { targets } = targetsFor(PROBE_INDEX);

    expect((await upsertCommitMetadata(es, input(sha), targets)).shadow).toBe('updated');
    expect((await upsertCommitMetadata(es, input(sha), targets)).shadow).toBe('already_equal');

    const doc = await es.get<Record<string, unknown>>({ index: PROBE_INDEX, id: `${String(REPOSITORY_ID)}:${sha}`, routing: String(REPOSITORY_ID) });
    expect(doc._source?.['message']).toBe(`message ${sha.slice(0, 6)}`);
    // `null`은 값으로 남는다 — 필드가 사라지지 않는다.
    expect(doc._source !== undefined && 'author' in doc._source).toBe(true);
    expect(doc._source?.['author']).toBeNull();
  });
});
