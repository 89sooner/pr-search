/**
 * 색인 부분 실패의 재시도 (WP-008에서 나와 WP-019가 함께 쓴다).
 *
 * 벌크는 **항목 단위로** 실패한다. 요청 전체가 200이어도 그 안의 한 문서가
 * 거부될 수 있고, 그 사실은 응답 본문에만 있다. 실패한 항목만 다시 보내는
 * 것이 "부분 실패 항목이 개별 재시도된다"의 뜻이고, 벌크 전체를 되돌리는
 * 것과 다른 점이다.
 *
 * **실시간과 백필이 같은 사다리를 쓴다** (CR-022, DEV-106). 각자 두면 같은
 * 오류에 한쪽은 재시도하고 다른 쪽은 버리게 되는데, 그 차이는 실제로
 * Elasticsearch가 아픈 날에만 드러난다.
 */

import { retryDelayMs } from '@prs/bus';
import { upsertOne, type BulkItemOutcome, type WriteTargets } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';

/**
 * 벌크 부분 실패를 항목별로 다시 보내는 횟수 (FR-ING-005 AC-3).
 *
 * 짧게 잡는다. 여기서 오래 붙들면 파티션이 막히고, 정말 Elasticsearch가 아픈
 * 상황이라면 즉시 재시도가 부하를 더한다. 이 예산을 넘기면 호출 측이
 * 자기 사다리(버스의 표준 백오프, 또는 백필의 실패 목록)에 넘긴다 —
 * 재시도 엔진을 두 개 만들지 않는다.
 */
export const MAX_ITEM_RETRIES = 2;

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 가능한 항목만 하나씩 다시 보낸다.
 *
 * 성공한 항목은 건드리지 않는다. `rejected`도 건드리지 않는다 — 다시 보내도
 * 같은 결과라는 것이 그 분류의 뜻이다.
 */
export async function retryFailedItems(
  es: Client,
  outcomes: readonly BulkItemOutcome[],
  targets: WriteTargets,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<readonly BulkItemOutcome[]> {
  if (!outcomes.some((outcome) => outcome.kind === 'retryable')) return outcomes;

  const current = [...outcomes];

  for (let attempt = 1; attempt <= MAX_ITEM_RETRIES; attempt += 1) {
    const pending = current
      .map((outcome, index) => ({ outcome, index }))
      .filter((entry) => entry.outcome.kind === 'retryable');
    if (pending.length === 0) break;

    await sleep(retryDelayMs(attempt));
    for (const entry of pending) {
      current[entry.index] = await upsertOne(es, entry.outcome.request, targets);
    }
  }

  return current;
}

/** 성공하지 못한 항목을 사람이 읽을 한 줄로 만든다. 빈 문자열이면 전부 성공이다. */
export function describeFailedItems(outcomes: readonly BulkItemOutcome[]): string {
  return outcomes
    .filter((outcome) => outcome.kind !== 'ok')
    .map((outcome) => `${outcome.request.alias}/${outcome.request.id}: ${outcome.reason}`)
    .join('; ');
}
