/**
 * W-005 판정 시험 (WP-026 / FR-SEQ-004).
 *
 * 이 파일이 지키는 것은 넷이다: **선택은 URL에 담기지 않는다**, **서수 없는
 * 릴리스는 앵커가 될 수 없다**, **공간이 다르면 이동 전에 막는다**, **방향은
 * 고른 순서가 아니라 서수가 정한다**.
 */

import { describe, expect, it } from 'vitest';
import {
  compareHref,
  formatReleaseQuery,
  hasStartAnchor,
  isSelectable,
  judgeComparisonRange,
  judgeReleases,
  judgeSelection,
  parseReleaseParams,
  previousLabel,
  unreleasedHref,
  type ReleaseRowView,
} from './release';

function row(overrides: Partial<ReleaseRowView> & { tagName: string }): ReleaseRowView {
  return {
    commitSha: 'a'.repeat(40),
    releasedAt: '2026-08-14T09:00:00Z',
    baseBranch: 'main',
    sequenceSpace: 'acme/payments@main',
    seqEpoch: 3,
    mergeSeq: 10,
    previousTagName: null,
    pullRequestCountSincePrevious: null,
    ...overrides,
  };
}

describe('judgeReleases', () => {
  it('모양이 어긋난 항목은 지어내지 않고 건너뛴다', () => {
    const view = judgeReleases({
      releases: [{ tag_name: 'v1.0', merge_seq: 2 }, { commit_sha: 'x' }, null],
      reason: null,
      truncated: false,
    });
    expect(view.releases.map((r) => r.tagName)).toEqual(['v1.0']);
  });

  it('서수가 없으면 null로 남긴다 — 0으로 채우지 않는다', () => {
    const view = judgeReleases({ releases: [{ tag_name: 'off', merge_seq: null }] });
    expect(view.releases[0]?.mergeSeq).toBeNull();
    expect(view.releases[0]?.pullRequestCountSincePrevious).toBeNull();
  });

  it('사유와 절삭 표기를 그대로 옮긴다', () => {
    const view = judgeReleases({ releases: [], reason: 'release_not_indexed', truncated: true });
    expect(view.reason).toBe('release_not_indexed');
    expect(view.truncated).toBe(true);
  });

  it('응답이 아예 아니어도 빈 목록을 낸다', () => {
    expect(judgeReleases(null).releases).toEqual([]);
    expect(judgeReleases({}).reason).toBeNull();
  });
});

describe('딥링크 파라미터 — 공간만 나른다 (DEV-157)', () => {
  it('저장소 형식이 아니면 받지 않는다', () => {
    expect(parseReleaseParams(new URLSearchParams('repo=notaslug')).repo).toBeNull();
    expect(parseReleaseParams(new URLSearchParams('repo=acme/payments')).repo).toBe('acme/payments');
  });

  it('브랜치는 선택이다 — 없으면 저장소 전체다', () => {
    expect(parseReleaseParams(new URLSearchParams('repo=acme/payments')).branch).toBeNull();
    expect(parseReleaseParams(new URLSearchParams('repo=acme/payments&branch=main')).branch).toBe('main');
  });

  it('브랜치가 없으면 쿼리에 싣지 않는다', () => {
    expect(formatReleaseQuery({ repo: 'acme/payments' })).toBe('repo=acme%2Fpayments');
    expect(formatReleaseQuery({ repo: 'acme/payments', branch: 'main' })).toBe(
      'repo=acme%2Fpayments&branch=main',
    );
  });

  it('선택한 태그는 URL에 담지 않는다', () => {
    expect(formatReleaseQuery({ repo: 'acme/payments', branch: 'main' })).not.toContain('select');
  });
});

describe('선택 판정', () => {
  it('서수 없는 릴리스는 앵커가 될 수 없다 (DEV-158)', () => {
    expect(isSelectable(row({ tagName: 'v1.0' }))).toBe(true);
    expect(isSelectable(row({ tagName: 'off', mergeSeq: null, baseBranch: null }))).toBe(false);
    // 브랜치는 있는데 현재 에폭으로 재해석되지 않은 릴리스도 마찬가지다.
    expect(isSelectable(row({ tagName: 'stale', mergeSeq: null }))).toBe(false);
  });

  it('두 건이 아니면 남은 수를 말한다', () => {
    const releases = [row({ tagName: 'v1.0' })];
    expect(judgeSelection(releases, [])).toEqual({ kind: 'incomplete', remaining: 2 });
    expect(judgeSelection(releases, ['v1.0'])).toEqual({ kind: 'incomplete', remaining: 1 });
  });

  it('방향은 고른 순서가 아니라 서수가 정한다 (AC-4)', () => {
    const releases = [
      row({ tagName: 'v1.1', mergeSeq: 20 }),
      row({ tagName: 'v1.0', mergeSeq: 10 }),
    ];
    const forward = judgeSelection(releases, ['v1.0', 'v1.1']);
    const reversed = judgeSelection(releases, ['v1.1', 'v1.0']);
    expect(forward.kind).toBe('ready');
    expect(reversed).toEqual(forward);
    if (forward.kind !== 'ready') throw new Error('ready여야 한다');
    expect(forward.from.tagName).toBe('v1.0');
    expect(forward.to.tagName).toBe('v1.1');
  });

  it('공간이 다르면 이동 전에 막는다 (AC-3)', () => {
    const releases = [
      row({ tagName: 'v1.0', mergeSeq: 10 }),
      row({ tagName: 'r2.4.0', mergeSeq: 2, baseBranch: 'release/2.4', sequenceSpace: 'acme/payments@release/2.4' }),
    ];
    const verdict = judgeSelection(releases, ['v1.0', 'r2.4.0']);
    expect(verdict.kind).toBe('space_mismatch');
    if (verdict.kind !== 'space_mismatch') throw new Error('space_mismatch여야 한다');
    expect(verdict.spaces).toEqual(['main', 'release/2.4']);
  });

  it('앵커가 될 수 없는 선택은 이유와 함께 막는다', () => {
    const releases = [row({ tagName: 'v1.0' }), row({ tagName: 'off', mergeSeq: null, baseBranch: null })];
    const verdict = judgeSelection(releases, ['v1.0', 'off']);
    expect(verdict.kind).toBe('not_anchorable');
    if (verdict.kind !== 'not_anchorable') throw new Error('not_anchorable이어야 한다');
    expect(verdict.tagNames).toEqual(['off']);
  });

  it('목록에 없는 태그는 조용히 무시하지 않고 막는다', () => {
    const verdict = judgeSelection([row({ tagName: 'v1.0' })], ['v1.0', 'ghost']);
    expect(verdict.kind).toBe('not_anchorable');
  });
});

describe('W-004로 넘기는 링크 (FLOW-003)', () => {
  it('태그 두 건과 에폭을 싣는다', () => {
    const href = compareHref(
      'acme/payments',
      row({ tagName: 'v1.0', mergeSeq: 10 }),
      row({ tagName: 'v1.1', mergeSeq: 20, seqEpoch: 3 }),
    );
    expect(href).toBe('/ranges?repo=acme%2Fpayments&branch=main&from=v1.0&to=v1.1&epoch=3');
  });

  it('에폭이 없으면 싣지 않는다 — 없는 인용을 지어내지 않는다', () => {
    const href = compareHref(
      'acme/payments',
      row({ tagName: 'v1.0' }),
      row({ tagName: 'v1.1', seqEpoch: null }),
    );
    expect(href).not.toContain('epoch');
  });

  it('미배포는 서수 앵커로 넘긴다 — head 앵커 유형을 만들지 않는다', () => {
    const href = unreleasedHref('acme/payments', 'main', { fromSeq: 6, toSeq: 7 }, 3);
    expect(href).toBe('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A6&to=seq%3A7&epoch=3');
  });

  it('**맨 숫자로 넘기지 않는다** — `classifyAnchor`가 모호로 판정해 조회가 잠긴다', () => {
    const href = unreleasedHref('acme/payments', 'main', { fromSeq: 6, toSeq: 7 }, 3);
    // `from=6`이면 PR #6인지 서수 6인지 시스템이 고르지 않는다 (의도된 설계).
    expect(href).not.toMatch(/from=6(&|$)/);
    expect(href).not.toMatch(/to=7(&|$)/);
    expect(href).toContain('seq%3A');
  });

  it('미배포 구간이 비어 있어도 링크는 같은 규칙이다', () => {
    const href = unreleasedHref('acme/payments', 'main', { fromSeq: 7, toSeq: 7 }, 3);
    expect(href).toContain('from=seq%3A7&to=seq%3A7');
  });

  it('시작 서수 0은 앵커로 표현할 수 없으므로 싣지 않는다', () => {
    // 채번된 릴리스가 없는 공간의 미배포 구간은 `(0, N]`이고, 앵커 문법은 1 이상만 받는다.
    const href = unreleasedHref('acme/payments', 'main', { fromSeq: 0, toSeq: 7 }, 3);
    expect(href).not.toContain('from=');
    expect(href).toContain('to=seq%3A7');
    // 시작을 1로 올려 첫 커밋을 조용히 빼지 않는다.
    expect(href).not.toContain('seq%3A1&');
  });

  it('hasStartAnchor가 그 사실을 화면에 알린다', () => {
    expect(hasStartAnchor({ fromSeq: 0 })).toBe(false);
    expect(hasStartAnchor({ fromSeq: 1 })).toBe(true);
  });
});

describe('judgeComparisonRange', () => {
  it('구간과 방향을 읽는다', () => {
    const view = judgeComparisonRange({
      range: { from_seq: 6, to_seq: 7, boundary: '(from, to]' },
      normalized_direction: 'from=v1.1(seq 6) → to=main head(seq 7)',
      seq_epoch: 3,
    });
    expect(view).toEqual({
      fromSeq: 6,
      toSeq: 7,
      normalizedDirection: 'from=v1.1(seq 6) → to=main head(seq 7)',
      seqEpoch: 3,
    });
  });

  it('구간이 없으면 null이다 — 에폭 무효 응답에는 구간이 없다', () => {
    expect(judgeComparisonRange({ epoch_stale: true, seq_epoch: 4 })).toBeNull();
    expect(judgeComparisonRange(null)).toBeNull();
  });
});

describe('previousLabel', () => {
  it('무엇과 비교한 수인지 말한다 (DEV-155)', () => {
    expect(
      previousLabel(row({ tagName: 'v1.1', previousTagName: 'v1.0', pullRequestCountSincePrevious: 2 })),
    ).toBe('v1.0 대비 PR 2건');
  });

  it('비교 대상이 없으면 0이 아니라 없음이다', () => {
    expect(previousLabel(row({ tagName: 'v1.0' }))).toBe('직전 릴리스 없음');
    expect(previousLabel(row({ tagName: 'v1.0' }))).not.toContain('0건');
  });

  it('0건은 없음과 다르다 — 세었고 없는 것이다', () => {
    expect(
      previousLabel(row({ tagName: 'v1.1', previousTagName: 'v1.0', pullRequestCountSincePrevious: 0 })),
    ).toBe('v1.0 대비 PR 0건');
  });
});
