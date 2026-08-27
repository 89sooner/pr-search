/**
 * 조건부 업서트의 요청 모양과 실패 분류 (WP-008, FR-ING-005).
 *
 * 실제 Elasticsearch 동작은 통합 테스트가 본다. 여기서는 **클러스터 없이 정할 수
 * 있는 것**만 본다 — 벌크 요청의 모양과, 어떤 실패를 다시 보낼지의 판단이다.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { CONDITIONAL_UPSERT_SCRIPT, bulkUpsert, classifyFailure, type UpsertRequest } from './upsert.js';
import { SERVING_ONLY } from './write-targets.js';

const REQUEST: UpsertRequest = {
  alias: 'prs-pull-requests',
  id: '4021:1234',
  routing: '4021',
  doc: { document_version: 100, pr_number: 1234 },
  createOnly: { links_pending: true },
};

const COMMIT: UpsertRequest = {
  alias: 'prs-commits',
  id: '4021:abcd',
  routing: '4021',
  doc: { document_version: 100, commit_sha: 'abcd' },
  union: { pull_request_numbers: [1234] },
};

function fakeClient(response: unknown): { client: Client; bulk: ReturnType<typeof vi.fn> } {
  const bulk = vi.fn().mockResolvedValue(response);
  return { client: { bulk } as unknown as Client, bulk };
}

describe('벌크 요청 모양 (AC-2)', () => {
  it('여러 인덱스를 한 번의 벌크 호출로 보낸다', async () => {
    const { client, bulk } = fakeClient({ items: [{ update: { status: 200, result: 'updated' } }, { update: { status: 201, result: 'created' } }] });
    await bulkUpsert(client, [REQUEST, COMMIT], SERVING_ONLY);

    expect(bulk).toHaveBeenCalledTimes(1);
    const operations = bulk.mock.calls[0]?.[0]?.operations as unknown[];
    // 액션 줄과 본문 줄이 번갈아 나온다.
    expect(operations).toHaveLength(4);
    expect(operations[0]).toMatchObject({ update: { _index: 'prs-pull-requests', _id: '4021:1234', routing: '4021' } });
    expect(operations[2]).toMatchObject({ update: { _index: 'prs-commits', _id: '4021:abcd' } });
  });

  it('상태 필드는 `doc`, 누적 필드는 `union`으로 나눠 보낸다 (CR-011)', async () => {
    const { client, bulk } = fakeClient({ items: [{ update: { status: 200, result: 'updated' } }] });
    await bulkUpsert(client, [COMMIT], SERVING_ONLY);

    const body = (bulk.mock.calls[0]?.[0]?.operations as { script: { params: Record<string, unknown> } }[])[1];
    expect(body?.script.params['doc']).toMatchObject({ document_version: 100 });
    expect(body?.script.params['union']).toEqual({ pull_request_numbers: [1234] });
    expect(body?.script).toMatchObject({ source: CONDITIONAL_UPSERT_SCRIPT, lang: 'painless' });
  });

  it('생성 시 본문에는 누적 필드와 생성 전용 필드가 함께 들어간다', async () => {
    const { client, bulk } = fakeClient({ items: [{ update: { status: 201, result: 'created' } }] });
    await bulkUpsert(client, [{ ...COMMIT, createOnly: { link_summary: { has_revert: false } } }], SERVING_ONLY);

    const body = (bulk.mock.calls[0]?.[0]?.operations as { upsert: Record<string, unknown> }[])[1];
    // 스크립트는 생성 때 돌지 않는다. `upsert` 본문이 전량이어야 한다.
    expect(body?.upsert).toMatchObject({
      document_version: 100,
      commit_sha: 'abcd',
      pull_request_numbers: [1234],
      link_summary: { has_revert: false },
    });
  });

  it('보낼 것이 없으면 호출하지 않는다', async () => {
    const { client, bulk } = fakeClient({ items: [] });
    const result = await bulkUpsert(client, [], SERVING_ONLY);
    expect(bulk).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([]);
  });
});

describe('DEV-059: `doc_id`를 업서트가 자동으로 채운다', () => {
  /*
   * Elasticsearch 8은 `_id` 정렬을 금지한다. FR-SRCH-007 AC-4의 "문서 ID를
   * 마지막 정렬 키로"가 성립하려면 같은 값이 정렬 가능한 필드로 문서 안에
   * 있어야 한다. 투영 자리마다 손으로 넣게 하면 언젠가 한 곳이 빠지고, 그
   * 인덱스만 정렬에서 조용히 뒤로 밀린다 — 그래서 여기서 넣는다.
   */
  it('생성 본문에 `_id`와 같은 값이 들어간다', async () => {
    const { client, bulk } = fakeClient({ items: [{ update: { status: 201, result: 'created' } }] });
    await bulkUpsert(client, [REQUEST], SERVING_ONLY);

    const body = (bulk.mock.calls[0]?.[0]?.operations as { upsert: Record<string, unknown> }[])[1];
    expect(body?.upsert['doc_id']).toBe(REQUEST.id);
  });

  it('스크립트 `params.doc`에도 들어간다 — 이미 색인된 문서가 다음 이벤트에서 채워진다', async () => {
    const { client, bulk } = fakeClient({ items: [{ update: { status: 200, result: 'updated' } }] });
    await bulkUpsert(client, [COMMIT], SERVING_ONLY);

    const body = (bulk.mock.calls[0]?.[0]?.operations as { script: { params: Record<string, Record<string, unknown>> } }[])[1];
    expect(body?.script.params['doc']?.['doc_id']).toBe(COMMIT.id);
  });

  it('요청마다 자기 ID를 갖는다', async () => {
    const { client, bulk } = fakeClient({
      items: [{ update: { status: 200, result: 'updated' } }, { update: { status: 200, result: 'updated' } }],
    });
    await bulkUpsert(client, [REQUEST, COMMIT], SERVING_ONLY);

    const operations = bulk.mock.calls[0]?.[0]?.operations as { upsert: Record<string, unknown> }[];
    expect(operations[1]?.upsert['doc_id']).toBe(REQUEST.id);
    expect(operations[3]?.upsert['doc_id']).toBe(COMMIT.id);
  });
});

describe('벌크 응답 해석 (AC-3)', () => {
  it('성공·거절·재시도 가능을 항목별로 가른다', async () => {
    const { client } = fakeClient({
      items: [
        { update: { status: 200, result: 'noop' } },
        { update: { status: 400, error: { type: 'strict_dynamic_mapping_exception', reason: '매핑에 없는 필드' } } },
      ],
    });
    const result = await bulkUpsert(client, [REQUEST, COMMIT], SERVING_ONLY);

    expect(result.hasFailures).toBe(true);
    expect(result.outcomes[0]).toMatchObject({ kind: 'ok', result: 'noop' });
    expect(result.outcomes[1]).toMatchObject({ kind: 'rejected', status: 400 });
    // 어느 요청이 실패했는지 붙어 있어야 개별 재시도가 가능하다.
    expect(result.outcomes[1]?.request.id).toBe('4021:abcd');
  });

  it('응답 항목이 모자라면 추측하지 않고 재시도로 둔다', async () => {
    const { client } = fakeClient({ items: [{ update: { status: 200, result: 'updated' } }] });
    const result = await bulkUpsert(client, [REQUEST, COMMIT], SERVING_ONLY);
    expect(result.outcomes[1]).toMatchObject({ kind: 'retryable' });
  });
});

describe('실패 분류', () => {
  it.each([
    ['strict_dynamic_mapping_exception', 400, 'rejected'],
    ['document_parsing_exception', 400, 'rejected'],
    ['script_exception', 400, 'rejected'],
    ['es_rejected_execution_exception', 429, 'retryable'],
    ['circuit_breaking_exception', 429, 'retryable'],
    ['version_conflict_engine_exception', 409, 'retryable'],
  ] as const)('`%s`는 %i에서 %s다', (type, status, expected) => {
    expect(classifyFailure(status, { type })).toBe(expected);
  });

  it('오류 유형을 모르면 상태 코드로 가른다', () => {
    expect(classifyFailure(503, undefined)).toBe('retryable');
    expect(classifyFailure(429, undefined)).toBe('retryable');
    expect(classifyFailure(400, undefined)).toBe('rejected');
  });

  it('매핑 거부는 상태 코드가 5xx여도 재시도하지 않는다', () => {
    // 다시 보내도 같은 매핑이 같은 이유로 거부한다. 재시도하면 파티션만 막힌다.
    expect(classifyFailure(500, { type: 'strict_dynamic_mapping_exception' })).toBe('rejected');
  });
});

describe('조건부 스크립트', () => {
  it('버전 비교와 합집합을 모두 담는다', () => {
    expect(CONDITIONAL_UPSERT_SCRIPT).toContain('ctx._source.document_version < params.doc.document_version');
    expect(CONDITIONAL_UPSERT_SCRIPT).toContain('params.union.entrySet()');
    expect(CONDITIONAL_UPSERT_SCRIPT).toContain("ctx.op = 'noop'");
  });

  it('합집합은 버전 비교 블록 바깥에 있다 (CR-011, DEV-019)', () => {
    // 안쪽에 있으면 늦게 도착한 이벤트가 자기 소속을 등록하지 못한다.
    const freshBlock = CONDITIONAL_UPSERT_SCRIPT.indexOf('if (fresh) {');
    const unionLoop = CONDITIONAL_UPSERT_SCRIPT.indexOf('for (e in params.union');
    expect(freshBlock).toBeGreaterThanOrEqual(0);
    expect(unionLoop).toBeGreaterThan(freshBlock);
    const between = CONDITIONAL_UPSERT_SCRIPT.slice(freshBlock, unionLoop);
    // `fresh` 블록이 한 줄로 닫혀 있어야 합집합이 그 바깥이다.
    expect(between).toContain('}');
  });
});
