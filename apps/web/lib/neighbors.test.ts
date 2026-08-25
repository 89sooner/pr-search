/**
 * 선행·후행 판정 시험 (WP-027 / FR-REL-001, CR-031).
 *
 * 지키는 것 넷: **직접 푸시 행을 지우지 않는다**, **사유를 모르면 단정하지 않는다**,
 * **범위 확장은 지금 보는 창이고 서수에 접두를 붙인다**, **에폭은 비교이지 쓰기가
 * 아니다**.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEIGHBOR_COUNT,
  MAX_NEIGHBOR_COUNT,
  clampNeighborCount,
  judgeNeighborEpoch,
  judgeNeighbors,
  judgeNoSequence,
  neighborRangeHref,
  type NeighborRowView,
} from './neighbors';

function row(overrides: Partial<NeighborRowView> & { mergeSeq: number }): NeighborRowView {
  return {
    kind: 'pull_request',
    commitSha: 'a'.repeat(40),
    prNumber: 100,
    title: 'feat: x',
    author: 'kim',
    mergedAt: '2026-08-12T00:00:00Z',
    isAnchor: false,
    indexed: true,
    url: '/pr/acme/payments/100',
    ...overrides,
  };
}

const RESPONSE = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  anchor: { merge_seq: 4, kind: 'pull_request', pr_number: 604, commit_sha: 'b'.repeat(40) },
  items: [
    { merge_seq: 3, kind: 'commit', commit_sha: 'c'.repeat(40), pr_number: null, title: null, author: null, merged_at: '2026-08-03T00:00:00Z', is_anchor: false, indexed: false, url: '/commit/acme/payments/ccc' },
    { merge_seq: 4, kind: 'pull_request', commit_sha: 'b'.repeat(40), pr_number: 604, title: 'feat: 결제', author: 'kim', merged_at: '2026-08-04T00:00:00Z', is_anchor: true, indexed: true, url: '/pr/acme/payments/604' },
    { merge_seq: 5, kind: 'pull_request', commit_sha: 'd'.repeat(40), pr_number: 605, title: null, author: null, merged_at: '2026-08-05T00:00:00Z', is_anchor: false, indexed: false, url: '/pr/acme/payments/605' },
  ],
  boundary: { at_start: false, at_end: true },
};

describe('judgeNeighbors', () => {
  it('**직접 푸시 행을 지우지 않는다** — 서수가 건너뛰면 누락으로 읽힌다', () => {
    const view = judgeNeighbors(RESPONSE);
    expect(view?.items.map((item) => item.mergeSeq)).toEqual([3, 4, 5]);
    const direct = view?.items[0];
    expect(direct?.kind).toBe('commit');
    expect(direct?.prNumber).toBeNull();
    // 제목·작성자를 지어내지 않는다 (DEV-090).
    expect(direct?.title).toBeNull();
    expect(direct?.author).toBeNull();
  });

  it('색인 미반영 행도 남기고 그 사실을 표시한다 (DEV-166 / DEV-130)', () => {
    const view = judgeNeighbors(RESPONSE);
    const unindexed = view?.items.find((item) => item.mergeSeq === 5);
    expect(unindexed?.indexed).toBe(false);
    expect(unindexed?.title).toBeNull();
    expect(unindexed?.commitSha).toBe('d'.repeat(40));
  });

  it('기준 개체를 표시한다 (AC-3)', () => {
    const view = judgeNeighbors(RESPONSE);
    expect(view?.anchorSeq).toBe(4);
    expect(view?.items.filter((item) => item.isAnchor).map((i) => i.mergeSeq)).toEqual([4]);
  });

  it('경계를 그대로 옮긴다 (AC-4)', () => {
    expect(judgeNeighbors(RESPONSE)?.boundary).toEqual({ atStart: false, atEnd: true });
  });

  it('모양이 어긋난 항목은 지어내지 않고 건너뛴다', () => {
    const view = judgeNeighbors({
      anchor: { merge_seq: 1 },
      items: [null, { merge_seq: 1 }, { commit_sha: 'x' }, { merge_seq: 2, commit_sha: 'e'.repeat(40) }],
    });
    expect(view?.items.map((item) => item.mergeSeq)).toEqual([2]);
  });

  it('앵커가 없으면 목록 자체를 만들지 않는다', () => {
    expect(judgeNeighbors({ items: [] })).toBeNull();
    expect(judgeNeighbors(null)).toBeNull();
  });
});

describe('judgeNoSequence', () => {
  it('사유를 읽는다', () => {
    expect(judgeNoSequence({ error: { detail: { reason: 'not_merged' } } })).toBe('not_merged');
    expect(judgeNoSequence({ error: { detail: { reason: 'not_sequenced' } } })).toBe('not_sequenced');
  });

  it('**모르면 단정하지 않는다** — 근거 없이 "머지되지 않았다"고 말하지 않는다', () => {
    expect(judgeNoSequence({ error: { detail: {} } })).toBeNull();
    expect(judgeNoSequence({ error: {} })).toBeNull();
    expect(judgeNoSequence({})).toBeNull();
    expect(judgeNoSequence({ error: { detail: { reason: '아무거나' } } })).toBeNull();
  });
});

describe('neighborRangeHref (DEV-167)', () => {
  it('첫 항목이 시작(제외), 마지막이 끝(포함)이다', () => {
    const href = neighborRangeHref('acme/payments', 'main', [row({ mergeSeq: 3 }), row({ mergeSeq: 4 }), row({ mergeSeq: 5 })], 3);
    expect(href).toBe('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A3&to=seq%3A5&epoch=3');
  });

  it('**맨 숫자로 넘기지 않는다** — 모호로 판정돼 조회가 잠긴다 (WP-026의 교훈)', () => {
    const href = neighborRangeHref('acme/payments', 'main', [row({ mergeSeq: 3 }), row({ mergeSeq: 5 })], null);
    expect(href).toContain('seq%3A');
    expect(href).not.toMatch(/from=3(&|$)/);
  });

  it('항목이 둘 미만이거나 구간이 성립하지 않으면 링크를 만들지 않는다', () => {
    expect(neighborRangeHref('acme/payments', 'main', [], 3)).toBeNull();
    expect(neighborRangeHref('acme/payments', 'main', [row({ mergeSeq: 3 })], 3)).toBeNull();
  });

  it('에폭이 없으면 싣지 않는다', () => {
    const href = neighborRangeHref('acme/payments', 'main', [row({ mergeSeq: 3 }), row({ mergeSeq: 5 })], null);
    expect(href).not.toContain('epoch');
  });
});

describe('judgeNeighborEpoch (QA-W002-16)', () => {
  it('같으면 match, 다르면 stale이다', () => {
    expect(judgeNeighborEpoch(3, 3)).toBe('match');
    expect(judgeNeighborEpoch(2, 3)).toBe('stale');
  });

  it('**비교할 값이 없으면 unknown이다** — 없는 근거로 괜찮다고 말하지 않는다', () => {
    expect(judgeNeighborEpoch(null, 3)).toBe('unknown');
    expect(judgeNeighborEpoch(3, null)).toBe('unknown');
  });
});

describe('clampNeighborCount (AC-1)', () => {
  it('기본은 10, 상한은 50이다', () => {
    expect(clampNeighborCount(9999)).toBe(MAX_NEIGHBOR_COUNT);
    expect(clampNeighborCount(0)).toBe(DEFAULT_NEIGHBOR_COUNT);
    expect(clampNeighborCount(-1)).toBe(DEFAULT_NEIGHBOR_COUNT);
    expect(clampNeighborCount(25)).toBe(25);
  });
});
