/**
 * M 채번 힌트 구독 (WP-074 / CR-079, 상세 설계 5.2).
 *
 * `prs:projected`를 **전용 논리 소비자** `mnumber`(그룹 `link:mnumber`)로 읽는다.
 * `link`·`commit-enrich`와 나눠 먹지 않는다 — 같은 그룹이면 이벤트가 셋으로 갈려
 * 각자 일부만 본다 (DEV-205의 규율).
 *
 * ## 힌트이지 복구 근거가 아니다
 *
 * `sequence.assigned`·`sequence.reassigned`를 받으면 그 공간의 `reconcile` work가
 * 있는지 확인하고(없으면 만들고) 러너를 깨운다. 발행 전 crash는 이 구독이 아니라
 * 채번 트랜잭션이 남긴 DB work가 복구한다. `mnumber.assigned`는 **무시한다** —
 * 자기 발행을 되받아 루프를 만들지 않는다. `ingestion.projected`의 PR 신호는
 * 스냅숏 트랜잭션이 이미 work를 남기므로 여기서는 깨우기만 한다.
 */

import { EVENT_NAMES, type IngestionProjected, type SequenceAssigned, type SequenceReassigned } from '@prs/domain';
import { TOPICS, consumerGroup, type DeliveredEvent, type EventBus, type EventHandler, type HandlerDisposition, type SubscribeOptions, type Subscription } from '@prs/bus';
import { sequenceSpaceRepo, sequenceWorkRepo, type Pool } from '@prs/db';

export interface HintDeps {
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly wake: () => void;
  readonly log?: (fields: { readonly level: 'info' | 'warn' | 'error'; readonly message: string; readonly [key: string]: unknown }) => void;
}

export async function handleMergeNumberHint(deps: HintDeps, event: DeliveredEvent): Promise<HandlerDisposition> {
  switch (event.event_name) {
    case EVENT_NAMES.sequenceAssigned:
    case EVENT_NAMES.sequenceReassigned: {
      const payload = event.payload as Partial<SequenceAssigned & SequenceReassigned> | undefined;
      const repositoryId = payload?.repository_id;
      const baseBranch = payload?.base_branch;
      if (typeof repositoryId !== 'number' || typeof baseBranch !== 'string' || baseBranch === '') return { kind: 'ack' };
      const epoch = event.event_name === EVENT_NAMES.sequenceReassigned ? payload?.new_epoch : payload?.seq_epoch;
      if (typeof epoch !== 'number') return { kind: 'ack' };
      /*
       * 채번 트랜잭션이 이미 work를 남겼으므로 대개 멱등 no-op(generation+1)이다. 늦게
       * 도착한 이전 에폭 이벤트는 현재 공간의 에폭으로만 요청한다 — 옛 에폭의 work를
       * 되살리지 않는다.
       */
      const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, baseBranch);
      if (space === undefined || space.seq_epoch !== epoch) return { kind: 'ack' };
      await sequenceWorkRepo.requestWork(deps.pool, {
        kind: 'reconcile',
        repositoryId,
        baseBranch,
        seqEpoch: epoch,
        payload: { trigger_kind: event.event_name === EVENT_NAMES.sequenceReassigned ? 'sequence_reassigned' : 'sequence_assigned' },
      });
      deps.wake();
      return { kind: 'ack' };
    }
    case EVENT_NAMES.ingestionProjected: {
      const payload = event.payload as Partial<IngestionProjected> | undefined;
      if (payload?.entity_kind === 'pull_request') deps.wake();
      return { kind: 'ack' };
    }
    default:
      // `mnumber.assigned`를 포함해 나머지는 이 소비자의 일이 아니다.
      return { kind: 'ack' };
  }
}

export async function startMergeNumberHintWorker(deps: HintDeps, options: SubscribeOptions = {}): Promise<Subscription> {
  const handler: EventHandler = async (event) => handleMergeNumberHint(deps, event);
  return deps.bus.subscribe(TOPICS.projected, consumerGroup(TOPICS.projected, 'mnumber'), handler, options);
}
