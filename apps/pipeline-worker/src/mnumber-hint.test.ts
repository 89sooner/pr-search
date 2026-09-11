/**
 * M 채번 힌트 구독 (WP-074 / FR-SEQ-008 AC-11, 상세 설계 5.2).
 *
 * 여기서 거는 것은 둘이다.
 *
 *   1. **소비자 그룹이 `link`·`commit-enrich`와 나뉘어 있다.** 같은 그룹이면 한
 *      이벤트가 셋 중 하나에게만 가서 나머지 둘은 그 이벤트를 영영 못 본다
 *      (DEV-205가 잡았던 바로 그 결함).
 *   2. 힌트 처리가 **자기 발행을 되받지 않는다.**
 *
 * 에폭 대조와 work 요청은 정본을 읽어야 판정할 수 있으므로
 * `integration/sequence/mnumber.test.ts`가 실제 DB로 건다 — 여기서 대역으로
 * 흉내 내면 "우리 대역이 우리 기대대로 답한다"만 확인하게 된다.
 */

import { describe, expect, it, vi } from 'vitest';
import { EVENT_NAMES } from '@prs/domain';
import { TOPICS, consumerGroup, type DeliveredEvent } from '@prs/bus';
import { handleMergeNumberHint, startMergeNumberHintWorker, type HintDeps } from './mnumber-hint.js';

function deps(overrides: Partial<HintDeps> = {}): HintDeps & { readonly wake: ReturnType<typeof vi.fn> } {
  const wake = vi.fn();
  return { pool: {} as HintDeps['pool'], bus: {} as HintDeps['bus'], wake, ...overrides } as HintDeps & {
    readonly wake: ReturnType<typeof vi.fn>;
  };
}

function event(name: string, payload: Record<string, unknown>): DeliveredEvent {
  return {
    event_id: 'e-1',
    event_name: name,
    occurred_at: '2026-09-01T00:00:00.000Z',
    partition_key: 'p',
    payload,
  } as unknown as DeliveredEvent;
}

describe('소비자 그룹 — 논리 소비자를 나눈다', () => {
  it('**`link`·`commit-enrich`와 다른 그룹으로 구독한다**', async () => {
    const seen: { topic: string; group: string }[] = [];
    const bus = {
      subscribe: (topic: string, group: string) => {
        seen.push({ topic, group });
        return Promise.resolve({ stop: () => Promise.resolve() });
      },
    } as unknown as HintDeps['bus'];

    await startMergeNumberHintWorker(deps({ bus }));

    expect(seen).toHaveLength(1);
    const { topic, group } = seen[0] as { topic: string; group: string };
    expect(topic).toBe(TOPICS.projected);
    expect(group).toBe(consumerGroup(TOPICS.projected, 'mnumber'));
    // 같은 그룹이면 한 이벤트가 셋 중 하나에게만 간다 — 나머지 둘은 영영 못 본다.
    expect(group).not.toBe(consumerGroup(TOPICS.projected));
    expect(group).not.toBe(consumerGroup(TOPICS.projected, 'commit-enrich'));
  });
});

describe('힌트 처리', () => {
  it('**`mnumber.assigned`는 무시한다** — 자기 발행을 되받아 루프를 만들지 않는다', async () => {
    const one = deps();
    const disposition = await handleMergeNumberHint(
      one,
      event(EVENT_NAMES.mergeNumberAssigned, { repository_id: 7, base_branch: 'main', seq_epoch: 4 }),
    );
    expect(disposition).toEqual({ kind: 'ack' });
    expect(one.wake).not.toHaveBeenCalled();
  });

  it('PR 투영 신호는 깨우기만 한다 — work는 스냅숏 트랜잭션이 남긴다', async () => {
    const one = deps();
    await handleMergeNumberHint(one, event(EVENT_NAMES.ingestionProjected, { entity_kind: 'pull_request' }));
    expect(one.wake).toHaveBeenCalledTimes(1);

    const two = deps();
    await handleMergeNumberHint(two, event(EVENT_NAMES.ingestionProjected, { entity_kind: 'commit' }));
    expect(two.wake).not.toHaveBeenCalled();
  });
});
