/**
 * 백필 판정 (WP-019 / CR-022, FR-ING-006).
 *
 * 이 파일이 거는 것은 셋으로 모인다.
 *
 * 1. **백필이 실시간을 덮어쓰지 않는가** (AC-5, DEV-099)
 * 2. **재개가 처리하지 않은 PR을 건너뛰지 않는가** (AC-4)
 * 3. **실패 대기열에 같은 실패가 쌓이지 않는가** (DEV-100)
 *
 * 셋 다 조용히 틀린다 — 틀려도 잡은 성공으로 끝난다.
 */

import { describe, expect, it } from 'vitest';
import {
  advanceCursor,
  backfillDeliveryId,
  backfillDocumentVersion,
  buildProgress,
  isBackfillDelivery,
  MAX_SLEEP_MS,
  rateLimitRetryAt,
  readCursor,
  sleepMsUntil,
} from './backfill-plan.js';

describe('합성 델리버리 ID (DEV-100)', () => {
  it('저장소와 PR 번호로 결정된다 — 같은 PR은 언제나 같은 키다', () => {
    expect(backfillDeliveryId(4021, 1234)).toBe('backfill:4021:1234');
    expect(backfillDeliveryId(4021, 1234)).toBe(backfillDeliveryId(4021, 1234));
  });

  it('**잡을 다시 실행해도 같다** — `job_id`가 들어가지 않는다', () => {
    /*
     * 들어가면 재실행마다 새 키가 되고, 실패 대기열이 `(delivery_id, stage)`
     * 유니크라 같은 PR의 같은 실패가 행마다 쌓인다. 운영자는 500건의
     * 대기열에서 실제로는 하나인 문제를 500개로 본다.
     */
    expect(backfillDeliveryId(4021, 1234)).not.toMatch(/job/);
  });

  it('저장소가 다르면 다르다 — 같은 PR 번호가 저장소마다 있다', () => {
    expect(backfillDeliveryId(4021, 1234)).not.toBe(backfillDeliveryId(4022, 1234));
  });

  it('**웹훅 델리버리와 구별된다** — 대기열에서 출처가 보인다', () => {
    expect(isBackfillDelivery(backfillDeliveryId(1, 1))).toBe(true);
    // 실제 웹훅 델리버리는 UUID다.
    expect(isBackfillDelivery('0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8')).toBe(false);
  });
});

describe('문서 버전 (DEV-099 / AC-5)', () => {
  it('**엔티티의 `updated_at`이다** — 지금 시각이 아니다', () => {
    const updated = '2026-08-19T05:02:11Z';
    expect(backfillDocumentVersion(updated)).toBe(Date.parse(updated));
  });

  it('**웹훅 수신 시각보다 작다** — 같은 사실에 대해 실시간이 이긴다', () => {
    /*
     * 이것이 AC-5의 전부다. 웹훅은 언제나 그 엔티티가 갱신된 뒤에 도착하므로,
     * `updated_at`을 쓰면 조건부 업서트가 백필을 저절로 거절한다.
     */
    const updatedAt = '2026-08-19T05:02:11Z';
    const webhookReceivedAt = new Date(Date.parse(updatedAt) + 1_500).getTime();
    expect(backfillDocumentVersion(updatedAt)).toBeLessThan(webhookReceivedAt);
  });

  it('**파싱할 수 없으면 `null`이다** — 0으로도 지금 시각으로도 때우지 않는다', () => {
    /*
     * 0이면 어떤 갱신에도 져서 문서가 영영 생기지 않고, 지금 시각이면
     * 전부 이겨서 실시간을 덮어쓴다. 둘 다 조용히 틀린다.
     */
    for (const bad of [undefined, null, '', 'not-a-date']) {
      expect(backfillDocumentVersion(bad)).toBeNull();
    }
  });
});

describe('커서 (AC-4)', () => {
  it('없으면 처음부터다', () => {
    expect(readCursor(null)).toEqual({ page: 1, done: 0 });
    expect(readCursor(undefined)).toEqual({ page: 1, done: 0 });
  });

  it('저장된 지점을 그대로 읽는다', () => {
    expect(readCursor({ page: 7, done: 612 })).toEqual({ page: 7, done: 612 });
  });

  it('**모양이 틀리면 처음부터다** — 중간을 추측하지 않는다', () => {
    /*
     * 추측한 지점이 실제보다 뒤면 그 사이 PR이 영영 색인되지 않는다.
     * 백필은 다시 하면 되는 작업이라 처음부터가 안전하다.
     */
    const broken = [
      { page: 0, done: 0 },
      { page: -1, done: 5 },
      { page: 1.5, done: 0 },
      { page: 3, done: -1 },
      { page: '3', done: 0 },
      { done: 5 },
      {},
    ];
    for (const raw of broken) {
      expect(readCursor(raw as Record<string, unknown>)).toEqual({ page: 1, done: 0 });
    }
  });

  it('페이지를 **다 처리한 뒤에만** 전진한다', () => {
    expect(advanceCursor({ page: 3, done: 200 }, 100)).toEqual({ page: 4, done: 300 });
  });

  it('빈 페이지를 처리해도 페이지는 전진한다 — 무한 루프를 막는다', () => {
    expect(advanceCursor({ page: 9, done: 812 }, 0)).toEqual({ page: 10, done: 812 });
  });
});

describe('진행률 (AC-2)', () => {
  it('처리 수와 단위를 싣는다', () => {
    expect(buildProgress({ page: 4, done: 300 }, 1200)).toEqual({
      done: 300,
      total: 1200,
      unit: 'pull_request',
    });
  });

  it('**전체를 모르면 `null`이다** — `done`을 총계로 쓰지 않는다', () => {
    // 쓰면 언제나 100%로 보이고, 운영자가 끝난 줄 안다.
    const progress = buildProgress({ page: 4, done: 300 }, null);
    expect(progress.total).toBeNull();
    expect(progress.done).toBe(300);
  });

  it('한도 대기는 **진행률에** 실린다 — 상태를 바꾸지 않는다 (DEV-104)', () => {
    const until = new Date('2026-08-22T10:00:00Z');
    const progress = buildProgress({ page: 4, done: 300 }, 1200, until);
    expect(progress.waiting_until).toBe('2026-08-22T10:00:00.000Z');
  });

  it('기다리지 않으면 키가 없다 — "만들지 않았다"와 "비었다"를 가른다', () => {
    expect(buildProgress({ page: 1, done: 0 }, null)).not.toHaveProperty('waiting_until');
  });
});

describe('한도 대기 (DoD 예외 처리)', () => {
  it('주 한도와 부 한도 모두 회복 시각을 낸다', () => {
    const retryAt = new Date('2026-08-22T10:00:00Z');
    expect(rateLimitRetryAt({ kind: 'rate_limited', retryAt })).toEqual(retryAt);
    expect(rateLimitRetryAt({ kind: 'secondary_rate_limited', retryAt })).toEqual(retryAt);
  });

  it('**다른 오류는 기다리지 않는다** — 404를 기다리면 영영 안 끝난다', () => {
    const retryAt = new Date();
    expect(rateLimitRetryAt({ kind: 'not_found', retryAt })).toBeNull();
    expect(rateLimitRetryAt({ kind: 'server_error' })).toBeNull();
    expect(rateLimitRetryAt(new Error('boom'))).toBeNull();
    expect(rateLimitRetryAt(null)).toBeNull();
  });

  it('회복 시각이 없으면 기다리지 않는다 — 얼마나인지 모른다', () => {
    expect(rateLimitRetryAt({ kind: 'rate_limited' })).toBeNull();
    expect(rateLimitRetryAt({ kind: 'rate_limited', retryAt: '2026-08-22' })).toBeNull();
  });

  it('이미 지난 시각이면 0이다 — 음수로 자지 않는다', () => {
    const now = new Date('2026-08-22T10:00:00Z');
    expect(sleepMsUntil(new Date('2026-08-22T09:00:00Z'), now)).toBe(0);
  });

  it('**한 번에 최대 1분만 잔다** — 중단 지시를 볼 기회를 남긴다', () => {
    /*
     * 잘못된 `retryAt`(먼 미래)이 오면 워커가 영영 잠들고, 그 사이 운영자가
     * 누른 중단도 보지 못한다.
     */
    const now = new Date('2026-08-22T10:00:00Z');
    const farFuture = new Date('2027-01-01T00:00:00Z');
    expect(sleepMsUntil(farFuture, now)).toBe(MAX_SLEEP_MS);
  });

  it('1분 안이면 그만큼만 잔다', () => {
    const now = new Date('2026-08-22T10:00:00Z');
    expect(sleepMsUntil(new Date('2026-08-22T10:00:20Z'), now)).toBe(20_000);
  });
});
