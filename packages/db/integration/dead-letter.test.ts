/**
 * 실패 대기열 상태 기계 (WP-009, CR-012).
 *
 * FR-ING-007의 "동일 이벤트가 3회 재처리 실패하면 보류"는 **한 행에 누적될
 * 때만** 성립한다. 여기서 보는 것은 그 누적이 실제로 한 행에 쌓이는지,
 * 그리고 어떤 실패가 재처리 실패로 세어지는지다 (DEV-022).
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as deadLetterRepo from '../src/repositories/dead-letter.js';
import { migratedPool, truncate } from './helpers.js';

const DELIVERY = 'dl-delivery-1';

function input(overrides: Partial<deadLetterRepo.DeadLetterInput> = {}): deadLetterRepo.DeadLetterInput {
  return {
    deliveryId: DELIVERY,
    stage: 'project',
    repositoryId: 4021,
    error: 'index_unavailable: connection refused',
    retryCount: 5,
    ...overrides,
  };
}

describe('실패 대기열 (WP-009 DoD, FR-ING-007)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate(pool, 'dead_letter');
  });

  it('DEV-027: BIGSERIAL 식별자를 숫자로 준다', async () => {
    // 타입 파서가 int8을 숫자로 바꾼다. 선언이 `string`이면 타입만 문자열이고
    // 런타임 값은 숫자인 상태가 되어 `===` 비교와 JSON 직렬화가 어긋난다.
    const row = await deadLetterRepo.recordDeadLetter(pool, input());
    expect(typeof row.dead_letter_id).toBe('number');
    expect(row.repository_id).toBe(4021);
  });

  it('DEV-022: 같은 (전달, 단계)를 두 번 기록해도 행은 하나다', async () => {
    const first = await deadLetterRepo.recordDeadLetter(pool, input());
    const second = await deadLetterRepo.recordDeadLetter(pool, input({ error: '다른 오류' }));

    expect(second.dead_letter_id).toBe(first.dead_letter_id);
    expect(second.error).toBe('다른 오류');
    expect(await deadLetterRepo.countDeadLetters(pool)).toBe(1);
  });

  it('단계가 다르면 별개의 행이다', async () => {
    await deadLetterRepo.recordDeadLetter(pool, input({ stage: 'enrich' }));
    await deadLetterRepo.recordDeadLetter(pool, input({ stage: 'project' }));
    expect(await deadLetterRepo.countDeadLetters(pool)).toBe(2);
  });

  it('재처리를 거치지 않은 실패는 재처리 횟수를 올리지 않는다', async () => {
    await deadLetterRepo.recordDeadLetter(pool, input());
    const again = await deadLetterRepo.recordDeadLetter(pool, input());
    // 표준 재시도가 다시 소진된 것이지 재처리가 실패한 것이 아니다.
    expect(again.reprocess_count).toBe(0);
    expect(again.state).toBe('pending');
  });

  it('DoD: 3회 재처리 실패 이벤트가 held로 전환된다', async () => {
    const created = await deadLetterRepo.recordDeadLetter(pool, input());

    const states: deadLetterRepo.DeadLetterState[] = [];
    const counts: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await deadLetterRepo.markReprocessing(pool, [created.dead_letter_id]);
      const failed = await deadLetterRepo.recordDeadLetter(pool, input());
      states.push(failed.state);
      counts.push(failed.reprocess_count);
    }

    expect(counts).toEqual([1, 2, 3]);
    expect(states).toEqual(['pending', 'pending', 'held']);
    // 세 번을 거치고도 행은 여전히 하나다. 이것이 성립해야 누적이 뜻을 갖는다.
    expect(await deadLetterRepo.countDeadLetters(pool)).toBe(1);
  });

  it('held는 다시 실패해도 held로 남고 누적이 오르지 않는다', async () => {
    const created = await deadLetterRepo.recordDeadLetter(pool, input());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await deadLetterRepo.markReprocessing(pool, [created.dead_letter_id]);
      await deadLetterRepo.recordDeadLetter(pool, input());
    }

    const again = await deadLetterRepo.recordDeadLetter(pool, input());
    expect(again.state).toBe('held');
    expect(again.reprocess_count).toBe(3);
  });

  it('resolved에서 새로 실패하면 이전 주기의 누적을 물려받지 않는다', async () => {
    const created = await deadLetterRepo.recordDeadLetter(pool, input());
    await deadLetterRepo.markReprocessing(pool, [created.dead_letter_id]);
    await deadLetterRepo.recordDeadLetter(pool, input()); // reprocess_count = 1
    await deadLetterRepo.resolveByDelivery(pool, DELIVERY);

    const fresh = await deadLetterRepo.recordDeadLetter(pool, input());
    expect(fresh.state).toBe('pending');
    expect(fresh.reprocess_count).toBe(0);
  });

  it('DEV-023: 끝까지 처리되면 그 전달의 열린 행이 모두 닫힌다', async () => {
    await deadLetterRepo.recordDeadLetter(pool, input({ stage: 'enrich' }));
    const project = await deadLetterRepo.recordDeadLetter(pool, input({ stage: 'project' }));
    // 보류된 것도 닫는다 — 실제로 통과했으면 보류가 더는 사실이 아니다.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await deadLetterRepo.markReprocessing(pool, [project.dead_letter_id]);
      await deadLetterRepo.recordDeadLetter(pool, input({ stage: 'project' }));
    }

    const closed = await deadLetterRepo.resolveByDelivery(pool, DELIVERY);
    expect(closed).toBe(2);

    const counts = await deadLetterRepo.countsByState(pool);
    expect(counts).toEqual({ pending: 0, reprocessing: 0, held: 0, resolved: 2 });
  });

  it('닫을 것이 없으면 아무 행도 건드리지 않는다', async () => {
    expect(await deadLetterRepo.resolveByDelivery(pool, '처음 보는 전달')).toBe(0);
  });

  it('단계·상태·저장소로 좁힌다', async () => {
    await deadLetterRepo.recordDeadLetter(pool, input({ deliveryId: 'a', stage: 'enrich', repositoryId: 1 }));
    await deadLetterRepo.recordDeadLetter(pool, input({ deliveryId: 'b', stage: 'project', repositoryId: 1 }));
    await deadLetterRepo.recordDeadLetter(pool, input({ deliveryId: 'c', stage: 'project', repositoryId: 2 }));
    await deadLetterRepo.resolveByDelivery(pool, 'c');

    expect(await deadLetterRepo.listDeadLetters(pool, { stage: 'project' })).toHaveLength(2);
    expect(await deadLetterRepo.listDeadLetters(pool, { repositoryId: 1 })).toHaveLength(2);
    expect(await deadLetterRepo.listDeadLetters(pool, { states: deadLetterRepo.OPEN_STATES })).toHaveLength(2);
    expect(
      await deadLetterRepo.listDeadLetters(pool, { stage: 'project', states: deadLetterRepo.OPEN_STATES }),
    ).toHaveLength(1);
  });

  it('식별자로 되찾는다', async () => {
    const a = await deadLetterRepo.recordDeadLetter(pool, input({ deliveryId: 'a' }));
    await deadLetterRepo.recordDeadLetter(pool, input({ deliveryId: 'b' }));

    const found = await deadLetterRepo.findByIds(pool, [a.dead_letter_id]);
    expect(found.map((row) => row.delivery_id)).toEqual(['a']);
    expect(await deadLetterRepo.findByIds(pool, [])).toEqual([]);
  });

  it('저장소를 모르는 이벤트도 기록된다', async () => {
    // 조직 단위 `team` 이벤트에는 저장소가 없다. 기록할 자리가 없다고
    // 실패를 버리면 그 이벤트는 흔적 없이 사라진다.
    const row = await deadLetterRepo.recordDeadLetter(pool, input({ repositoryId: null }));
    expect(row.repository_id).toBeNull();
  });

  it('저장소를 아는 실패가 뒤에 오면 비어 있던 값을 채운다', async () => {
    await deadLetterRepo.recordDeadLetter(pool, input({ repositoryId: null }));
    const filled = await deadLetterRepo.recordDeadLetter(pool, input({ repositoryId: 4021 }));
    expect(filled.repository_id).toBe(4021);

    // 반대로 뒤늦게 null이 와도 알던 값을 지우지 않는다.
    const kept = await deadLetterRepo.recordDeadLetter(pool, input({ repositoryId: null }));
    expect(kept.repository_id).toBe(4021);
  });
});
