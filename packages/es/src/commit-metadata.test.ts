/**
 * 커밋 메타데이터 쓰기의 결과 분류 (CR-119 / FR-ING-008 AC-10).
 *
 * 전에는 「값이 이미 같음」과 「문서가 없어 반영하지 못함」이 모두 `noop`이었고, 서비스와
 * 재색인 대상의 결과가 섞여 재색인이 새 인덱스에 무엇이 들어갔는지 알 수 없었다. 여기서는
 * 클러스터 없이 정할 수 있는 분류만 본다. 실제 Elasticsearch의 오류 모양은
 * `packages/es/integration/commit-metadata.test.ts`가 본다.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { restoreChainCommitRole, upsertCommitMetadata, type CommitMetadataUpsert } from './commit-metadata.js';
import { SERVING_ONLY, type ShadowWriteFailure, type WriteTargets } from './write-targets.js';

const INPUT: CommitMetadataUpsert = {
  repositoryId: 4021,
  commitSha: 'a'.repeat(40),
  docId: `4021:${'a'.repeat(40)}`,
  fields: {
    parent_shas: [],
    message: 'm',
    author: null,
    committer: 'c',
    authored_at: '2026-09-01T00:00:00.000Z',
    committed_at: '2026-09-01T00:00:00.000Z',
    changed_paths: [],
    changed_paths_truncated: false,
  },
};

/** Elasticsearch 클라이언트가 던지는 `ResponseError`와 같은 모양. */
function esError(statusCode: number, type?: string): Error {
  const error = new Error(type ?? 'Response Error') as Error & { meta: unknown; statusCode: number };
  error.meta = { statusCode, body: type === undefined ? undefined : { error: { type }, status: statusCode } };
  error.statusCode = statusCode;
  return error;
}

type Reply = { readonly result?: string } | Error;

function fakeClient(byIndex: Readonly<Record<string, Reply>>): { client: Client; update: ReturnType<typeof vi.fn> } {
  const update = vi.fn(async (params: { index: string }) => {
    const reply = byIndex[params.index];
    if (reply === undefined) throw new Error(`시험이 준비하지 않은 인덱스: ${params.index}`);
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { client: { update } as unknown as Client, update };
}

function shadowTargets(): { targets: WriteTargets; failures: ShadowWriteFailure[] } {
  const failures: ShadowWriteFailure[] = [];
  return {
    targets: { shadows: { 'prs-commits': 'prs-commits-v9' }, recordShadowFailure: (failure) => failures.push(failure) },
    failures,
  };
}

describe('서비스 결과 분류', () => {
  it('값이 같아 바뀌지 않은 쓰기는 `already_equal`이다 — 문서 없음과 다르다', async () => {
    const { client } = fakeClient({ 'prs-commits': { result: 'noop' } });
    expect(await upsertCommitMetadata(client, INPUT, SERVING_ONLY)).toEqual({ result: 'already_equal' });
  });

  it('`createWith`가 없고 **문서가** 없으면 `document_missing`이다', async () => {
    const { client } = fakeClient({ 'prs-commits': esError(404, 'document_missing_exception') });
    expect(await upsertCommitMetadata(client, INPUT, SERVING_ONLY)).toEqual({ result: 'document_missing' });
  });

  it('**인덱스가** 없는 404는 문서 없음이 아니다 — 던진다', async () => {
    const { client } = fakeClient({ 'prs-commits': esError(404, 'index_not_found_exception') });
    await expect(upsertCommitMetadata(client, INPUT, SERVING_ONLY)).rejects.toThrow(/index_not_found_exception/);
  });

  it('무엇이 없는지 모르는 404(본문 없음)도 문서 없음으로 읽지 않는다', async () => {
    const { client } = fakeClient({ 'prs-commits': esError(404) });
    await expect(upsertCommitMetadata(client, INPUT, SERVING_ONLY)).rejects.toThrow();
  });

  it('응답에 결과가 없으면 반영했다고 세지 않는다 — 던진다', async () => {
    const { client } = fakeClient({ 'prs-commits': {} });
    await expect(upsertCommitMetadata(client, INPUT, SERVING_ONLY)).rejects.toThrow(/commit_metadata_unexpected_result/);
  });

  it('`createWith`가 있는데 문서 없음이 오면 삼키지 않는다', async () => {
    const { client } = fakeClient({ 'prs-commits': esError(404, 'document_missing_exception') });
    const withCreate: CommitMetadataUpsert = { ...INPUT, createWith: { document_version: 1 } };
    await expect(upsertCommitMetadata(client, withCreate, SERVING_ONLY)).rejects.toThrow(/document_missing_exception/);
  });
});

describe('재색인 대상 결과는 서비스 결과와 따로 돌려준다', () => {
  it('서비스는 갱신됐고 대상에는 문서가 없으면 둘을 각각 말한다', async () => {
    const { client } = fakeClient({
      'prs-commits': { result: 'updated' },
      'prs-commits-v9': esError(404, 'document_missing_exception'),
    });
    const { targets, failures } = shadowTargets();

    expect(await upsertCommitMetadata(client, INPUT, targets)).toEqual({ result: 'updated', shadow: 'document_missing' });
    // 문서 없음은 shadow **실패**가 아니다 — 잡을 실패로 만들지 않는다. 판정은 호출자의 몫이다.
    expect(failures).toEqual([]);
  });

  it('대상 쓰기가 던지면 실패를 기록하고 `failed`를 돌려준다 — 서비스 결과는 그대로다', async () => {
    const { client } = fakeClient({ 'prs-commits': { result: 'noop' }, 'prs-commits-v9': esError(503, 'unavailable_shards_exception') });
    const { targets, failures } = shadowTargets();

    expect(await upsertCommitMetadata(client, INPUT, targets)).toEqual({ result: 'already_equal', shadow: 'failed' });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ alias: 'prs-commits', index: 'prs-commits-v9', operation: 'update' });
  });

  it('대상 인덱스가 사라졌으면 실패다 — 문서 없음으로 삼키지 않는다', async () => {
    const { client } = fakeClient({ 'prs-commits': { result: 'updated' }, 'prs-commits-v9': esError(404, 'index_not_found_exception') });
    const { targets, failures } = shadowTargets();

    expect(await upsertCommitMetadata(client, INPUT, targets)).toEqual({ result: 'updated', shadow: 'failed' });
    expect(failures).toHaveLength(1);
  });

  it('대상이 없으면 `shadow`도 없다', async () => {
    const { client, update } = fakeClient({ 'prs-commits': { result: 'created' } });
    expect(await upsertCommitMetadata(client, { ...INPUT, createWith: { document_version: 1 } }, SERVING_ONLY)).toEqual({ result: 'created' });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('체인 역할 되돌리기도 같은 404 규칙을 쓴다', () => {
  const RESTORE = { repositoryId: 4021, docId: `4021:${'a'.repeat(40)}`, role: 'merge_commit' as const };

  it('문서가 없으면 `missing`이다', async () => {
    const { client } = fakeClient({ 'prs-commits': esError(404, 'document_missing_exception') });
    expect(await restoreChainCommitRole(client, RESTORE, SERVING_ONLY)).toBe('missing');
  });

  it('인덱스가 없으면 던진다', async () => {
    const { client } = fakeClient({ 'prs-commits': esError(404, 'index_not_found_exception') });
    await expect(restoreChainCommitRole(client, RESTORE, SERVING_ONLY)).rejects.toThrow();
  });
});
