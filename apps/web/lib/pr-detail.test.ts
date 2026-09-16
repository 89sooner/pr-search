/**
 * W-002 판정 (WP-017 / CR-020, FR-SRCH-003).
 *
 * 이 파일이 거는 것은 하나로 모인다 — **화면이 모르는 것을 아는 척하지
 * 않는가.** 없는 값을 0이나 "없음"으로 그리면 조사 도구가 거짓을 말한다.
 */

import { describe, expect, it } from 'vitest';
import {
  commitListModel,
  gheePullRequestUrl,
  reviewerStates,
  searchBackHref,
  timelineSteps,
  type PrDetailSource,
} from './pr-detail';

/**
 * 키 하나를 뺀 사본.
 *
 * **서버가 그 키를 넣지 않는 경우**를 만든다 — 이 제품의 응답 계약이
 * "키 없음 = 만들지 않았다"를 쓰므로(CR-016 DEV-057) 그 상황을 시험이
 * 재현할 수 있어야 한다.
 */
function omit(source: PrDetailSource, key: keyof PrDetailSource): PrDetailSource {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

const MERGED: PrDetailSource = {
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  state: 'merged',
  author: 'kim',
  created_at: '2026-08-18T09:00:00Z',
  first_review_at: '2026-08-18T11:30:00Z',
  merged_at: '2026-08-19T05:02:11Z',
  merge_commit_sha: 'a'.repeat(40),
  source_commits: [{ commit_sha: 'b'.repeat(40) }],
  source_commits_truncated: false,
  source_commits_total: 1,
};

describe('커밋 목록 (FR-SRCH-003, DEV-083)', () => {
  it('머지 커밋과 원본 커밋을 나눠 담는다 (AC-1)', () => {
    const model = commitListModel(MERGED);
    expect(model.mergeCommitSha).toBe('a'.repeat(40));
    expect(model.sourceCommits).toHaveLength(1);
  });

  it('미머지 PR은 머지 커밋이 `null`이다 (AC-2, QA-W002-02)', () => {
    const model = commitListModel({ ...MERGED, merge_commit_sha: null });
    expect(model.mergeCommitSha).toBeNull();
    expect(model.sourceCommits).toHaveLength(1);
  });

  it('키가 아예 없어도 `null`이다 — 화면이 같은 것을 그린다', () => {
    expect(commitListModel(omit(MERGED, 'merge_commit_sha')).mergeCommitSha).toBeNull();
  });

  it('절삭되지 않으면 총계를 안다', () => {
    expect(commitListModel(MERGED).totalCount).toBe(1);
  });

  it('총계 키가 없어도 절삭 전이면 배열 길이가 곧 총계다 — 전부 받았다', () => {
    expect(commitListModel(omit(MERGED, 'source_commits_total')).totalCount).toBe(1);
  });

  it('**절삭되면 총계를 모른다** — `null`이다 (DEV-082, DEV-083)', () => {
    /*
     * 서버가 그때만 키를 뺀다 (CR-017 DEV-063). 배열 길이(250)를 총계로
     * 쓰면 "정확히 250건"이라는 거짓이 된다.
     */
    const model = commitListModel({ ...omit(MERGED, 'source_commits_total'), source_commits_truncated: true });
    expect(model.truncated).toBe(true);
    expect(model.totalCount).toBeNull();
  });

  it('절삭됐는데 서버가 총계를 주면 그것을 쓴다 — 나중에 채워질 수 있다', () => {
    const model = commitListModel({ ...MERGED, source_commits_truncated: true, source_commits_total: 812 });
    expect(model.totalCount).toBe(812);
  });

  it('보강 미완료를 별도로 나른다 (QA-W002-15)', () => {
    const model = commitListModel({ ...MERGED, source_commits: [], enrichment_pending: true });
    expect(model.enrichmentPending).toBe(true);
    // 머지 커밋은 그대로 표시된다 — 보강과 무관하다.
    expect(model.mergeCommitSha).toBe('a'.repeat(40));
  });
});

describe('타임라인 (DEV-084)', () => {
  it('다섯 단계를 순서대로 낸다', () => {
    expect(timelineSteps(MERGED).map((s) => s.key)).toEqual([
      'created', 'first_review', 'approved', 'merged', 'released',
    ]);
  });

  it('시각이 있는 단계는 `done`이다', () => {
    const steps = timelineSteps(MERGED);
    expect(steps[0]?.status).toBe('done');
    expect(steps[0]?.at).toBe('2026-08-18T09:00:00Z');
  });

  it('시각이 없는 단계는 `pending`이다', () => {
    const merged = timelineSteps(omit(MERGED, 'merged_at')).find((s) => s.key === 'merged');
    expect(merged?.status).toBe('pending');
    expect(merged?.at).toBeNull();
  });

  it('**승인자가 있으면 `done_at_unknown`이다** — `pending`이 아니다', () => {
    /*
     * 이것이 이 모듈의 핵심이다. `approved_at`이 매핑에 없어 시각을
     * 모를 뿐, 승인은 **일어났다.** `pending`으로 그리면 승인된 PR을
     * "승인 대기"로 표시하게 된다.
     */
    const approved = timelineSteps({ ...MERGED, approved_by: ['lee'] }).find((s) => s.key === 'approved');
    expect(approved?.status).toBe('done_at_unknown');
    expect(approved?.at).toBeNull();
    // 왜 시각이 없는지 화면이 말할 수 있어야 한다.
    expect(approved?.note).toContain('lee');
    expect(approved?.note).toContain("Approval timestamps are not collected");
  });

  it('승인자가 없으면 `pending`이다 — 그때는 정말 안 일어났다', () => {
    const approved = timelineSteps(MERGED).find((s) => s.key === 'approved');
    expect(approved?.status).toBe('pending');
    expect(approved?.note).toBeNull();
  });

  it('승인자 여럿을 모두 밝힌다', () => {
    const approved = timelineSteps({ ...MERGED, approved_by: ['lee', 'park'] }).find((s) => s.key === 'approved');
    expect(approved?.note).toContain('lee, park');
  });

  it('**릴리스 포함은 `out_of_scope`다** — `pending`이 아니다', () => {
    // `pending`으로 그리면 "아직 릴리스에 안 들어갔다"는 거짓이 된다.
    const released = timelineSteps(MERGED).find((s) => s.key === 'released');
    expect(released?.status).toBe('out_of_scope');
    expect(released?.note).not.toBeNull();
  });

  it('**시각을 지어내지 않는다** — `done`이 아닌 단계의 `at`은 전부 `null`이다', () => {
    for (const step of timelineSteps({ ...MERGED, approved_by: ['lee'] })) {
      if (step.status !== 'done') expect(step.at).toBeNull();
    }
  });
});

describe('리뷰 상태 (DEV-085)', () => {
  it('승인한 리뷰어와 아직 안 한 리뷰어를 가른다', () => {
    const states = reviewerStates({ ...MERGED, reviewers: ['lee', 'park'], approved_by: ['lee'] });
    expect(states).toEqual([
      { login: 'lee', status: 'approved' },
      { login: 'park', status: 'not_yet' },
    ]);
  });

  it('**지정되지 않았는데 승인한 사람도 넣는다** — 빠뜨리면 수가 안 맞는다', () => {
    const states = reviewerStates({ ...MERGED, reviewers: ['lee'], approved_by: ['lee', 'guest'] });
    expect(states.map((s) => s.login)).toEqual(['lee', 'guest']);
    expect(states.every((s) => s.status === 'approved')).toBe(true);
  });

  it('리뷰어가 없으면 빈 목록이다', () => {
    expect(reviewerStates(MERGED)).toEqual([]);
  });

  it('상태는 **둘뿐이다** — "변경 요청"을 만들지 않는다', () => {
    const states = reviewerStates({ ...MERGED, reviewers: ['a', 'b'], approved_by: ['a'] });
    for (const s of states) expect(['approved', 'not_yet']).toContain(s.status);
  });
});

describe('GHE 링크 (DEV-086)', () => {
  it('FR-SRCH-001 AC-3이 정한 형식으로 만든다', () => {
    expect(gheePullRequestUrl('https://ghe.acme.example', 'acme/payments', 1234)).toBe(
      'https://ghe.acme.example/acme/payments/pull/1234',
    );
  });

  it('꼬리 슬래시를 정리한다', () => {
    expect(gheePullRequestUrl('https://ghe.acme.example/', 'acme/a', 1)).toBe(
      'https://ghe.acme.example/acme/a/pull/1',
    );
  });

  it('**미구성이면 `null`이다** — 죽은 링크를 만들지 않는다', () => {
    expect(gheePullRequestUrl(undefined, 'acme/a', 1)).toBeNull();
    expect(gheePullRequestUrl('', 'acme/a', 1)).toBeNull();
    expect(gheePullRequestUrl('   ', 'acme/a', 1)).toBeNull();
  });

  it('저장소나 번호를 모르면 `null`이다', () => {
    expect(gheePullRequestUrl('https://ghe.example', null, 1)).toBeNull();
    expect(gheePullRequestUrl('https://ghe.example', 'acme/a', null)).toBeNull();
  });
});

describe('되돌아가기 링크 (DEV-078)', () => {
  it('질의가 있으면 그 질의로 돌아간다', () => {
    expect(searchBackHref('repo:acme/payments merged:>2026-01-01')).toBe(
      '/search?q=repo%3Aacme%2Fpayments%20merged%3A%3E2026-01-01',
    );
  });

  it('없으면 빈 검색으로 돌아간다', () => {
    expect(searchBackHref(undefined)).toBe('/search');
  });

  it('**공백뿐이면 빈 검색이다** — `?q=%20%20`으로 보내지 않는다', () => {
    expect(searchBackHref('   ')).toBe('/search');
    expect(searchBackHref('')).toBe('/search');
  });

  it('질의를 인코딩한다 — 되살아난 질의가 원본과 같아야 한다', () => {
    // `&`를 날것으로 두면 뒤가 잘린 질의가 복원된다.
    const raw = 'title:"a&b" OR author:kim';
    const href = searchBackHref(raw);
    expect(new URL(href, 'https://x.example').searchParams.get('q')).toBe(raw);
  });
});
