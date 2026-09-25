/**
 * 간선 bulk 결과 판정 (CR-121 / FR-ING-008 AC-11).
 *
 * 재색인 중 간선의 **부분 갱신**이 새 인덱스에서 간선을 찾지 못하는 것은 정상 경로다 — 소유 source가
 * 재구축에서 아직 처리되지 않았다. 그것만 미처리로 넘기고, 나머지 shadow 오류는 전부 실패로 남긴다.
 * 서비스 쪽 항목이 없으면 성공으로 세지 않는다(전에는 셌다). 클러스터 없이 정할 수 있는 분류만 본다 —
 * 실제 재색인 경로는 `apps/pipeline-worker/integration/jobs/links-reindex-completeness.test.ts`가 본다.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { findReferenceTargets, resolveReferenceLinks, writeReferenceLinks, type ReferenceLinkDoc } from './links.js';
import type { ShadowPendingWork, ShadowWriteFailure, WriteTargets } from './write-targets.js';

const REPO = 7001;
const SHADOW = 'prs-links-v7';

function doc(linkId: string): ReferenceLinkDoc {
  return {
    link_id: linkId,
    reference_key: 'pr:2',
    scope: { repository_id: REPO, org_id: 1, visibility: 'private', allowed_team_ids: [3] },
    from_type: 'pull_request',
    from_id: `${String(REPO)}:1`,
    confidence: 'heuristic',
    evidence: '#2',
    created_at: '2026-09-01T00:00:00.000Z',
    resolution: null,
  };
}

function update(linkId: string, ownerDocId = `${String(REPO)}:1`) {
  return {
    link_id: linkId,
    repository_id: REPO,
    owner: { sourceKind: 'pull_request' as const, docId: ownerDocId },
    resolution: { to_type: 'pull_request' as const, to_id: `${String(REPO)}:2`, to_repository_id: REPO },
  };
}

function fakeBulk(items: readonly unknown[]): { client: Client; bulk: ReturnType<typeof vi.fn> } {
  const bulk = vi.fn(async () => ({ errors: true, items }));
  return { client: { bulk } as unknown as Client, bulk };
}

function targets(options: { readonly pending?: boolean } = {}): {
  targets: WriteTargets;
  failures: ShadowWriteFailure[];
  pendings: ShadowPendingWork[];
} {
  const failures: ShadowWriteFailure[] = [];
  const pendings: ShadowPendingWork[] = [];
  return {
    targets: {
      shadows: { 'prs-links': SHADOW },
      recordShadowFailure: (failure) => failures.push(failure),
      ...(options.pending === false ? {} : { recordShadowPending: (pending: ShadowPendingWork) => pendings.push(pending) }),
    },
    failures,
    pendings,
  };
}

const ok = (kind: 'index' | 'update', id: string, index = 'prs-links') => ({ [kind]: { _index: index, _id: id, status: 200, result: 'updated' } });
const fail = (kind: 'index' | 'update', id: string, status: number, type: string, index = SHADOW) => ({
  [kind]: { _index: index, _id: id, status, error: { type, reason: type } },
});

describe('서비스 항목', () => {
  it('**응답에 항목이 없으면 실패로 센다** — 쓰지 않은 간선을 쓴 것으로 보고하지 않는다', async () => {
    const { client } = fakeBulk([ok('index', 'a')]);
    const result = await writeReferenceLinks(client, [doc('a'), doc('b')], { shadows: {} });
    expect(result.written).toBe(1);
    expect(result.failures).toEqual([{ link_id: 'b', status: 0, reason: 'bulk_response_item_missing' }]);
  });

  it('응답 항목의 연산 종류가 요청과 다르면 없는 것과 같다', async () => {
    const { client } = fakeBulk([ok('update', 'a')]);
    const result = await writeReferenceLinks(client, [doc('a')], { shadows: {} });
    expect(result.failures).toEqual([{ link_id: 'a', status: 0, reason: 'bulk_response_item_missing' }]);
  });
});

describe('shadow 항목', () => {
  it('**부분 갱신이 shadow에서 문서를 찾지 못하면 미처리다** — 소유 source를 싣고, 실패로 세지 않는다', async () => {
    const { client } = fakeBulk([ok('update', 'a'), fail('update', 'a', 404, 'document_missing_exception')]);
    const { targets: to, failures, pendings } = targets();
    const result = await resolveReferenceLinks(client, [update('a')], to);
    expect(result.failures).toEqual([]);
    expect(failures).toEqual([]);
    expect(pendings).toEqual([
      { alias: 'prs-links', index: SHADOW, repositoryId: REPO, sourceKind: 'pull_request', sourceId: '1', linkId: 'a' },
    ]);
  });

  it('인덱스가 없는 404(`index_not_found_exception`)는 미처리가 아니라 실패다', async () => {
    const { client } = fakeBulk([ok('update', 'a'), fail('update', 'a', 404, 'index_not_found_exception')]);
    const { targets: to, failures, pendings } = targets();
    await resolveReferenceLinks(client, [update('a')], to);
    expect(pendings).toEqual([]);
    expect(failures.map((one) => one.reason)).toEqual(['index_not_found_exception']);
  });

  it('응답의 인덱스가 그 shadow가 아니면 문서 없음이라도 실패다', async () => {
    const { client } = fakeBulk([ok('update', 'a'), fail('update', 'a', 404, 'document_missing_exception', 'prs-links-v6')]);
    const { targets: to, failures, pendings } = targets();
    await resolveReferenceLinks(client, [update('a')], to);
    expect(pendings).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('응답의 문서 ID가 요청한 간선이 아니면 실패다', async () => {
    const { client } = fakeBulk([ok('update', 'a'), fail('update', 'z', 404, 'document_missing_exception')]);
    const { targets: to, failures, pendings } = targets();
    await resolveReferenceLinks(client, [update('a')], to);
    expect(pendings).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('상태가 404가 아닌 `document_missing_exception`은 미처리가 아니라 실패다 — 조건이 모두 맞아야 미처리다', async () => {
    const { client } = fakeBulk([ok('update', 'a'), fail('update', 'a', 409, 'document_missing_exception')]);
    const { targets: to, failures, pendings } = targets();
    await resolveReferenceLinks(client, [update('a')], to);
    expect(pendings).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('429·5xx·스크립트 오류는 실패다 — 약하게 만들지 않는다', async () => {
    for (const [status, type] of [[429, 'es_rejected_execution_exception'], [500, 'internal'], [400, 'script_exception']] as const) {
      const { client } = fakeBulk([ok('update', 'a'), fail('update', 'a', status, type)]);
      const { targets: to, failures, pendings } = targets();
      await resolveReferenceLinks(client, [update('a')], to);
      expect(pendings).toEqual([]);
      expect(failures.map((one) => one.reason)).toEqual([type]);
    }
  });

  it('**전체 쓰기(`index`)의 오류는 무엇이든 실패다**', async () => {
    const { client } = fakeBulk([ok('index', 'a'), fail('index', 'a', 404, 'document_missing_exception')]);
    const { targets: to, failures, pendings } = targets();
    await writeReferenceLinks(client, [doc('a')], to);
    expect(pendings).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('shadow 항목이 없으면 실패다', async () => {
    const { client } = fakeBulk([ok('update', 'a')]);
    const { targets: to, failures, pendings } = targets();
    await resolveReferenceLinks(client, [update('a')], to);
    expect(pendings).toEqual([]);
    expect(failures.map((one) => one.reason)).toEqual(['벌크 응답에 대응 항목이 없다']);
  });

  it('**미처리를 받을 기록자가 없으면 실패로 올린다** — 누가 회수할지 모르는 미처리는 조용히 사라진다', async () => {
    const { client } = fakeBulk([ok('update', 'a'), fail('update', 'a', 404, 'document_missing_exception')]);
    const { targets: to, failures, pendings } = targets({ pending: false });
    await resolveReferenceLinks(client, [update('a')], to);
    expect(pendings).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toContain('미처리를 받을 기록자가 없다');
  });
});

describe('보내기 전', () => {
  it('**소유 source의 문서 ID가 routing 저장소와 다르면 보내지 않는다** — 다른 샤드의 간선을 건드린다', async () => {
    const { client, bulk } = fakeBulk([]);
    await expect(resolveReferenceLinks(client, [update('a', '9999:1')], targets().targets)).rejects.toThrow(
      /link_update_routing_mismatch/,
    );
    expect(bulk).not.toHaveBeenCalled();
  });

  it('shadow 연산은 서비스 연산 뒤에 같은 순서로 실린다 — 응답 항목의 짝이 그 순서다', async () => {
    const { client, bulk } = fakeBulk([ok('update', 'a'), ok('update', 'b'), ok('update', 'a', SHADOW), ok('update', 'b', SHADOW)]);
    await resolveReferenceLinks(client, [update('a'), update('b')], targets().targets);
    const operations = (bulk.mock.calls[0]?.[0] as { operations: Record<string, { _index: string; _id: string }>[] }).operations;
    const heads = operations.filter((_one, index) => index % 2 === 0).map((one) => `${one['update']?._index}/${one['update']?._id}`);
    expect(heads).toEqual(['prs-links/a', 'prs-links/b', `${SHADOW}/a`, `${SHADOW}/b`]);
  });
});

describe('대상 해석', () => {
  it('**msearch 항목 오류를 「대상 없음」으로 읽지 않는다** — 미해결로 굳히지 않고 던진다', async () => {
    const msearch = vi.fn(async () => ({ responses: [{ error: { type: 'search_phase_execution_exception' }, status: 503 }] }));
    const client = { msearch } as unknown as Client;
    await expect(
      findReferenceTargets(client, [{ key: 'pr:2', kind: 'pull_request', repositoryId: REPO, prNumber: 2 }]),
    ).rejects.toThrow(/reference_target_lookup_failed: search_phase_execution_exception/);
  });
});
