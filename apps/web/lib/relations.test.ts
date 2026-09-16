/**
 * 관계 화면 판정 (WP-031 / CR-042).
 *
 * 이 파일이 지키는 것은 **구분**이다 — 없는 것 · 모르는 것 · 볼 수 없는 것 ·
 * 해제된 것을 같은 화면으로 그리지 않는다.
 */

import { describe, expect, it } from 'vitest';
import {
  coChangeReasonLabel,
  confidenceLabel,
  directionLabel,
  judgeCoChanges,
  judgeRelations,
  linkTypeLabel,
  summaryBadges,
} from './relations';

function body(items: readonly unknown[], extra: Record<string, unknown> = {}): unknown {
  return { link_type: 'reverts', direction: 'outgoing', items, truncated: false, ...extra };
}

describe('summaryBadges — 요약이 없는 것과 관계가 없는 것 (DEV-264)', () => {
  it('**`null`이면 `null`이다** — 배지 영역 자체를 그리지 않는다', () => {
    expect(summaryBadges(null)).toBeNull();
    expect(summaryBadges(undefined)).toBeNull();
  });

  it('값이 있고 전부 비어 있으면 빈 배열이다 — "확인했고 없다"', () => {
    expect(
      summaryBadges({
        has_revert: false,
        is_reverted: false,
        has_cherry_pick: false,
        reference_count: 0,
      }),
    ).toEqual([]);
  });

  it('참조 수를 배지에 싣는다', () => {
    const badges = summaryBadges({ reference_count: 3 });
    expect(badges).toEqual([{ key: 'references', label: "References: 3" }]);
  });

  it('되돌림 주체와 되돌림 대상을 구분한다', () => {
    const keys = (summaryBadges({ has_revert: true, is_reverted: true }) ?? []).map((b) => b.key);
    expect(keys).toEqual(['has_revert', 'is_reverted']);
  });

  it('`has_stack`이 없어도 다른 배지는 나온다 — 커밋에는 그 개념이 없다', () => {
    const keys = (summaryBadges({ has_cherry_pick: true }) ?? []).map((b) => b.key);
    expect(keys).toEqual(['has_cherry_pick']);
  });
});

describe('judgeRelations — 항목 축 상태', () => {
  it('형식이 어긋나면 `null`이다', () => {
    expect(judgeRelations(null)).toBeNull();
    expect(judgeRelations({ link_type: 'co_changes', direction: 'outgoing', items: [] })).toBeNull();
    expect(judgeRelations({ link_type: 'reverts', direction: 'sideways', items: [] })).toBeNull();
    expect(judgeRelations({ link_type: 'reverts', direction: 'outgoing' })).toBeNull();
  });

  it('**`detached` 키가 없으면 `null`이다** — `false`로 만들지 않는다', () => {
    const view = judgeRelations(
      body([{ link_id: 'a', confidence: 'exact', evidence: 'e', resolved: true, endpoint: {} }]),
    );
    expect(view?.items[0]?.detached).toBeNull();
  });

  it('`detached: false`는 그대로 `false`다 — 스택은 그 값을 실제로 갖는다', () => {
    const view = judgeRelations(
      body([
        { link_id: 'a', confidence: 'derived', evidence: 'e', resolved: true, detached: false, endpoint: {} },
      ]),
    );
    expect(view?.items[0]?.detached).toBe(false);
  });

  it('대상을 볼 수 있으면 링크가 있다', () => {
    const view = judgeRelations(
      body([
        {
          link_id: 'a',
          confidence: 'exact',
          evidence: 'e',
          resolved: true,
          content_available: true,
          endpoint: {
            kind: 'pull_request',
            repository: 'acme/x',
            pr_number: 12,
            title: '제목',
            url: '/pr/acme/x/12',
          },
        },
      ]),
    );
    const item = view?.items[0];
    expect(item?.endpoint.url).toBe('/pr/acme/x/12');
    expect(item?.endpoint.contentAvailable).toBe(true);
    expect(item?.endpoint.label).toContain('제목');
  });

  it('**대상을 볼 수 없으면 원 표현만 남고 링크가 없다** — 사유를 밝히지 않는다', () => {
    const view = judgeRelations(
      body([
        {
          link_id: 'a',
          confidence: 'derived',
          evidence: 'Refs: acme/b#20',
          resolved: true,
          content_available: false,
          endpoint: { kind: 'pull_request', reference_expression: 'acme/b#20' },
        },
      ]),
    );
    const item = view?.items[0];
    expect(item?.endpoint.url).toBeNull();
    expect(item?.endpoint.contentAvailable).toBe(false);
    expect(item?.endpoint.label).toBe('acme/b#20');
    // "권한이 없습니다"류의 문장을 만들지 않는다 — 존재를 밝히는 문장이다.
    expect(item?.endpoint.label).not.toContain('권한');
  });

  it('미해결 참조와 볼 수 없는 대상의 문구가 다르다 — 다른 사실이다', () => {
    const unresolved = judgeRelations(
      body([{ link_id: 'a', confidence: 'heuristic', evidence: 'e', resolved: false, endpoint: {} }]),
    );
    const hidden = judgeRelations(
      body([{ link_id: 'b', confidence: 'heuristic', evidence: 'e', resolved: true, endpoint: {} }]),
    );
    expect(unresolved?.items[0]?.endpoint.label).toContain("indexed");
    expect(hidden?.items[0]?.endpoint.label).toContain("unavailable");
  });

  it('`ambiguous`를 그대로 옮긴다', () => {
    const view = judgeRelations(
      body([
        { link_id: 'a', confidence: 'heuristic', evidence: 'e', resolved: true, ambiguous: true, endpoint: {} },
      ]),
    );
    expect(view?.items[0]?.ambiguous).toBe(true);
  });

  it('`link_id`가 없는 항목은 버린다 — 키 없는 행을 그리지 않는다', () => {
    const view = judgeRelations(body([{ confidence: 'exact', evidence: 'e', endpoint: {} }]));
    expect(view?.items).toEqual([]);
  });

  it('`truncated`를 옮긴다', () => {
    expect(judgeRelations(body([], { truncated: true }))?.truncated).toBe(true);
  });
});

describe('방향과 라벨 — 화살표만으로 말하지 않는다', () => {
  it('되돌림의 두 방향이 서로 다른 문장이다 (QA-W002-11)', () => {
    const out = directionLabel('reverts', 'outgoing');
    const inc = directionLabel('reverts', 'incoming');
    expect(out).not.toBe(inc);
    expect(out).toContain("Reverted by this item");
    expect(inc).toContain("Items that revert this item");
  });

  it('스택의 두 방향이 상위·하위를 말한다', () => {
    expect(directionLabel('stacks_on', 'outgoing')).toContain("Parent");
    expect(directionLabel('stacks_on', 'incoming')).toContain("Child");
  });

  it('신뢰도 셋이 서로 다른 라벨을 갖는다 (QA-W002-12)', () => {
    const labels = new Set([
      confidenceLabel('exact'),
      confidenceLabel('derived'),
      confidenceLabel('heuristic'),
    ]);
    expect(labels.size).toBe(3);
  });

  it('유형 넷이 서로 다른 라벨을 갖는다', () => {
    const labels = new Set([
      linkTypeLabel('references'),
      linkTypeLabel('reverts'),
      linkTypeLabel('cherry_picks'),
      linkTypeLabel('stacks_on'),
    ]);
    expect(labels.size).toBe(4);
  });
});

describe('judgeCoChanges — 계산 불가와 0건 (DEV-254)', () => {
  it('`available: false`는 사유와 함께 온다', () => {
    const view = judgeCoChanges({ available: false, reason: 'not_merged', items: [] });
    expect(view).toEqual({ kind: 'unavailable', reason: 'not_merged' });
  });

  it('모르는 사유는 `null`로 둔다 — 지어내지 않는다', () => {
    expect(judgeCoChanges({ available: false, reason: 'weird' })).toEqual({
      kind: 'unavailable',
      reason: null,
    });
  });

  it('**`available: true` + 0건은 다른 상태다**', () => {
    expect(judgeCoChanges({ available: true, items: [] })).toEqual({ kind: 'ready', items: [] });
  });

  it('사유 셋이 서로 다른 문장을 갖는다', () => {
    const labels = new Set([
      coChangeReasonLabel('not_merged'),
      coChangeReasonLabel('enrichment_pending'),
      coChangeReasonLabel('too_many_changed_files'),
    ]);
    expect(labels.size).toBe(3);
  });

  it('미머지 문구가 **왜** 계산할 수 없는지 말한다 — 90일 창의 기준점이 없다', () => {
    expect(coChangeReasonLabel('not_merged')).toContain("90 days");
  });

  it('항목을 옮긴다', () => {
    const view = judgeCoChanges({
      available: true,
      items: [
        {
          repository: 'acme/x',
          pr_number: 7,
          title: 't',
          author: 'a',
          similarity: 0.5,
          overlapping_paths: ['src/a.ts'],
          url: '/pr/acme/x/7',
        },
      ],
    });
    expect(view).toEqual({
      kind: 'ready',
      items: [
        {
          repository: 'acme/x',
          prNumber: 7,
          title: 't',
          author: 'a',
          similarity: 0.5,
          overlappingPaths: ['src/a.ts'],
          url: '/pr/acme/x/7',
        },
      ],
    });
  });
});
