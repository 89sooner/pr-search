/**
 * 색인 부분 실패 재시도 사다리 (WP-008·WP-019 공용, CR-022 DEV-106).
 *
 * 이 계층만 실제 클러스터 없이 판정할 수 있다. 무엇을 다시 보내고 무엇을
 * 포기하는가가 여기 있고, 그 판단이 틀리면 실시간과 백필 **양쪽**이 같이
 * 틀린다.
 *
 * 검증: `npx vitest run apps/pipeline-worker/src/index-retry.test.ts`
 */

import { describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { BulkItemOutcome, UpsertRequest } from '@prs/es';
import { describeFailedItems, MAX_ITEM_RETRIES, retryFailedItems } from './index-retry.js';

function request(id: string): UpsertRequest {
  return {
    alias: 'prs-pull-requests',
    id,
    routing: '1',
    doc: { document_version: 1 },
  };
}

const ok = (id: string): BulkItemOutcome => ({ kind: 'ok', request: request(id), result: 'updated' });
const retryable = (id: string): BulkItemOutcome => ({
  kind: 'retryable',
  request: request(id),
  status: 429,
  reason: '429 es_rejected_execution_exception: 쓰기 대기열 포화',
});
const rejected = (id: string): BulkItemOutcome => ({
  kind: 'rejected',
  request: request(id),
  status: 400,
  reason: '400 strict_dynamic_mapping_exception: source_patch',
});

/** `upsertOne`이 부르는 것은 `client.update` 하나다. 그것만 흉내 낸다. */
function fakeEs(results: readonly ('ok' | 'fail')[]): { client: Client; ids: string[] } {
  const ids: string[] = [];
  let call = 0;
  const client = {
    async update(params: { id: string }): Promise<{ result: string }> {
      ids.push(params.id);
      const verdict = results[call] ?? 'ok';
      call += 1;
      if (verdict === 'fail') {
        throw Object.assign(new Error('여전히 포화'), {
          statusCode: 429,
          body: { error: { type: 'es_rejected_execution_exception', reason: '포화' } },
        });
      }
      return { result: 'updated' };
    },
  } as unknown as Client;
  return { client, ids };
}

const noSleep = async (): Promise<void> => undefined;

describe('retryFailedItems', () => {
  it('전부 성공이면 클러스터를 다시 부르지 않는다', async () => {
    const { client, ids } = fakeEs([]);
    const outcomes = [ok('a'), ok('b')];

    expect(await retryFailedItems(client, outcomes, noSleep)).toEqual(outcomes);
    expect(ids).toEqual([]);
  });

  it('**실패한 항목만 다시 보낸다** — 성공한 것은 건드리지 않는다', async () => {
    const { client, ids } = fakeEs(['ok']);
    const settled = await retryFailedItems(client, [ok('a'), retryable('b')], noSleep);

    // 벌크 전체를 되돌리면 `a`도 다시 갔을 것이다.
    expect(ids).toEqual(['b']);
    expect(settled.map((outcome) => outcome.kind)).toEqual(['ok', 'ok']);
  });

  it('**`rejected`는 다시 보내지 않는다** — 다시 보내도 같다는 것이 그 분류의 뜻이다', async () => {
    const { client, ids } = fakeEs([]);
    const settled = await retryFailedItems(client, [rejected('a')], noSleep);

    expect(ids).toEqual([]);
    expect(settled[0]?.kind).toBe('rejected');
  });

  it('**같은 벌크에 둘이 섞여 있어도 `rejected`는 그대로 둔다**', async () => {
    /*
     * 위 시험만으로는 부족하다. `retryable`이 하나도 없으면 지름길이 먼저
     * 돌아가 재시도 루프에 **들어가지도 않기** 때문에, 루프가 `rejected`를
     * 다시 보내도 드러나지 않는다 (변이 시험 M2에서 실제로 살아남았다).
     */
    const { client, ids } = fakeEs(['ok']);
    const settled = await retryFailedItems(client, [rejected('a'), retryable('b')], noSleep);

    expect(ids).toEqual(['b']);
    expect(settled.map((outcome) => outcome.kind)).toEqual(['rejected', 'ok']);
  });

  it('예산을 넘기면 포기하고 실패로 남긴다 — 영원히 붙들지 않는다', async () => {
    const { client, ids } = fakeEs(['fail', 'fail', 'fail', 'fail']);
    const settled = await retryFailedItems(client, [retryable('a')], noSleep);

    /*
     * 상수와 견주지 않고 **횟수를 적는다.** 상수와 견주면 예산을 0으로 줄여도
     * 기대값이 따라 줄어 시험이 통과한다 — 예산은 고른 값이지 파생값이 아니다.
     */
    expect(ids).toEqual(['a', 'a']);
    expect(MAX_ITEM_RETRIES).toBe(2);
    // **여기서 `ok`로 만들면 호출 측이 색인되지 않은 문서를 색인됐다고 센다.**
    expect(settled[0]?.kind).toBe('retryable');
  });

  it('재시도 사이에 기다린다 — 즉시 다시 때리면 아픈 클러스터를 더 아프게 한다', async () => {
    const { client } = fakeEs(['fail', 'fail']);
    const waits: number[] = [];
    await retryFailedItems(client, [retryable('a')], async (ms) => {
      waits.push(ms);
    });

    expect(waits).toHaveLength(2);
    expect(waits.every((ms) => ms > 0)).toBe(true);
  });
});

describe('describeFailedItems', () => {
  it('전부 성공이면 빈 문자열이다 — 호출 측이 그것으로 성패를 가른다', () => {
    expect(describeFailedItems([ok('a'), ok('b')])).toBe('');
  });

  it('`noop`도 성공이다 — 버전이 낮아 아무것도 바뀌지 않은 것은 실패가 아니다', () => {
    const noop: BulkItemOutcome = { kind: 'ok', request: request('a'), result: 'noop' };
    expect(describeFailedItems([noop])).toBe('');
  });

  it('실패한 항목의 별칭·ID·사유를 모두 남긴다', () => {
    const detail = describeFailedItems([ok('a'), rejected('b'), retryable('c')]);

    expect(detail).toContain('prs-pull-requests/b');
    expect(detail).toContain('strict_dynamic_mapping_exception');
    expect(detail).toContain('prs-pull-requests/c');
    // 성공한 항목은 사유에 섞이지 않는다.
    expect(detail).not.toContain('prs-pull-requests/a');
  });
});
