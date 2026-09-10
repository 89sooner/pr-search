/**
 * W-005 판정 (WP-026 / QA-W005-01·02·04, CR-030 DEV-156·158).
 *
 * 이 파일이 지키는 경계 셋: **낯선 태그가 비교로 복원되지 않는 자리**(DEV-158),
 * **선택 순서가 방향을 정하지 않는 자리**(QA-W005-02), **없는 수를 0으로
 * 그리지 않는 자리**(PR 수·되돌림 수).
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_COMPARE_SELECTION,
  compareHref,
  formatReleasesQuery,
  judgeComparison,
  judgeSelection,
  judgeTimeline,
  parseReleasesParams,
  planCompare,
  planDetail,
  toggleSelection,
  unreleasedHref,
  type ReleaseView,
} from './releases';

function release(tag: string, seq: number, previous: string | null = null): ReleaseView {
  return {
    tagName: tag,
    releasedAt: '2026-08-15T09:00:00Z',
    commitSha: 'a'.repeat(40),
    mergeSeq: seq,
    source: 'git_tag',
    previousTagName: previous,
    pullRequestCount: 3,
  };
}

describe('딥링크 파라미터 (CR-030, DEV-158)', () => {
  it('select는 콤마 구분 최대 2개다 — 셋째부터는 버린다', () => {
    const params = parseReleasesParams(new URLSearchParams('branch=main&select=v1.0,v1.1,v1.2'));
    expect(params.branch).toBe('main');
    expect(params.select).toEqual(['v1.0', 'v1.1']);
  });

  it('중복·빈 조각은 태그가 아니다', () => {
    expect(parseReleasesParams(new URLSearchParams('select=v1.0,,v1.0')).select).toEqual(['v1.0']);
    expect(parseReleasesParams(new URLSearchParams('branch=')).branch).toBeNull();
  });

  it('URL 왕복이 선택을 보존한다 — 딥링크가 곧 화면 상태다', () => {
    const query = formatReleasesQuery({ branch: 'main', select: ['v1.0', 'v1.1'] });
    const back = parseReleasesParams(new URLSearchParams(query));
    expect(back).toEqual({ branch: 'main', select: ['v1.0', 'v1.1'] });
  });
});

describe('타임라인 판정 (API-REL-005)', () => {
  it('태그·서수 없는 행은 건너뛰고, PR 수 없는 행은 0으로 지어내지 않는다', () => {
    const view = judgeTimeline({
      releases: [
        { tag_name: 'v1.1', merge_seq: 5, previous_tag_name: 'v1.0', pull_request_count: 2 },
        { tag_name: 'v0.9', merge_seq: 1 },
        { merge_seq: 3 },
      ],
    });
    expect(view.releases).toHaveLength(2);
    expect(view.releases[1]?.pullRequestCount).toBeNull();
  });

  it('**순서를 바꾸지 않는다** — 서버의 서수 내림차순을 그대로 신뢰한다 (DEV-159)', () => {
    const view = judgeTimeline({
      releases: [
        { tag_name: 'v1.0', merge_seq: 2 },
        { tag_name: 'v2.0', merge_seq: 9 },
      ],
    });
    expect(view.releases.map((entry) => entry.tagName)).toEqual(['v1.0', 'v2.0']);
  });

  it('미수집 사유와 개요 경로를 옮긴다 (DEV-146) — 사유가 없으면 지어내지 않는다', () => {
    const notIndexed = judgeTimeline({
      releases: [],
      reason: 'release_not_indexed',
      registration_status_path: '/repositories',
    });
    expect(notIndexed.notIndexed).toBe(true);
    expect(notIndexed.registrationStatusPath).toBe('/repositories');
    expect(judgeTimeline({ releases: [] }).notIndexed).toBe(false);
  });

  it('unreleased 블록은 키가 있고 모양이 맞을 때만 선다', () => {
    const view = judgeTimeline({
      releases: [{ tag_name: 'v1.0', merge_seq: 2 }],
      unreleased: { last_release_tag: 'v1.0', head_seq: 6, head_commit_sha: 'b'.repeat(40), pending_pull_request_count: 4 },
    });
    expect(view.unreleased?.pendingPullRequestCount).toBe(4);
    expect(judgeTimeline({ releases: [] }).unreleased).toBeNull();
  });
});

describe('비교 선택 (QA-W005-01, C-032 상한)', () => {
  it('상한 2를 넘는 선택은 무시된다 — 해제는 언제나 가능하다', () => {
    let selection: readonly string[] = [];
    selection = toggleSelection(selection, 'a');
    selection = toggleSelection(selection, 'b');
    expect(toggleSelection(selection, 'c')).toEqual(['a', 'b']);
    expect(toggleSelection(selection, 'a')).toEqual(['b']);
    expect(MAX_COMPARE_SELECTION).toBe(2);
  });

  it('**타임라인에 없는 태그는 복원하지 않는다** (DEV-158) — 다른 브랜치 릴리스가 이 갈래다', () => {
    const judged = judgeSelection(['v1.0', 'v-dev'], [release('v1.0', 2)]);
    expect(judged.selected.map((entry) => entry.tagName)).toEqual(['v1.0']);
    expect(judged.unknown).toEqual(['v-dev']);
  });
});

describe('비교 정규화 (QA-W005-02)', () => {
  it('**선택 순서와 무관하게 시퀀스가 작은 쪽이 시작이다** — 방향이 문구로 명시된다', () => {
    const plan = planCompare(release('v1.1', 5), release('v1.0', 2));
    expect(plan.from.tagName).toBe('v1.0');
    expect(plan.to.tagName).toBe('v1.1');
    expect(plan.direction).toBe('from=v1.0(seq 2) → to=v1.1(seq 5)');
  });

  it('같은 서수는 뒤집지 않는다 — 빈 반개구간은 유효하다', () => {
    const plan = planCompare(release('v1.1', 5), release('v1.1-hotfix', 5));
    expect(plan.from.tagName).toBe('v1.1');
    expect(plan.to.tagName).toBe('v1.1-hotfix');
  });

  it('W-004 인용 URL에 태그 앵커와 에폭이 실린다 (ADR-007)', () => {
    const plan = planCompare(release('v1.0', 2), release('v1.1', 5));
    expect(compareHref('acme/payments', 'main', plan, 3)).toBe(
      '/ranges?repo=acme%2Fpayments&branch=main&from=v1.0&to=v1.1&epoch=3',
    );
  });
});

describe('미배포 구간 (QA-W005-04)', () => {
  it('끝 앵커는 브랜치 head의 서수다 — 태그가 아니라 seq 인용으로 건다', () => {
    const href = unreleasedHref(
      'acme/payments',
      'main',
      { lastReleaseTag: 'v1.1', headSeq: 6, headCommitSha: null, pendingPullRequestCount: 4 },
      3,
    );
    expect(href).toBe('/ranges?repo=acme%2Fpayments&branch=main&from=v1.1&to=seq%3A6&epoch=3');
  });
});

describe('상세 판정 (DEV-156·158)', () => {
  it('**직전 릴리스가 없으면 비교를 계획하지 않는다** — 첫 릴리스는 다른 화면 상태다', () => {
    expect(planDetail(release('v1.0', 2)).kind).toBe('first_release');
    const plan = planDetail(release('v1.1', 5, 'v1.0'));
    expect(plan).toEqual({ kind: 'compare', fromTag: 'v1.0', release: release('v1.1', 5, 'v1.0') });
  });

  it('**되돌림 수는 키가 없으면 pending이다** (DEV-156) — 비교 요약도 같은 판정을 쓴다', () => {
    const view = judgeComparison({
      normalized_direction: 'from=v1.0(seq 2) → to=v1.1(seq 5)',
      summary: {
        pull_request_count: 3,
        commit_count: 3,
        distinct_author_count: 2,
        changed_files_total: 10,
        additions_total: 100,
        deletions_total: 20,
        files_truncated_pull_request_count: 0,
        top_changed_paths: [],
      },
    });
    expect(view.direction).toBe('from=v1.0(seq 2) → to=v1.1(seq 5)');
    expect(view.summary?.reverted).toEqual({ kind: 'pending', owner: 'WP-030' });
  });
});
