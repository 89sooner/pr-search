/**
 * W-004 판정 (WP-025 / QA-W004-07·08·11·21, CR-029 DEV-150·153·154).
 *
 * 이 파일이 지키는 경계 셋: **사전 판정이 조회를 막는 자리**(역전·5만 초과),
 * **에폭 비교가 자동 재조회로 새지 않는 자리**, **없는 수를 0으로 그리지 않는
 * 자리**(되돌림 수).
 */

import { describe, expect, it } from 'vitest';
import {
  RANGE_CLIENT_LIMIT,
  formatRangeQuery,
  judgeAnchorFailure,
  judgeEpoch,
  judgeItems,
  judgeResolvedAnchors,
  judgeSpaces,
  judgeSummary,
  parseRangeParams,
  preflightRange,
  type ResolvedAnchorView,
} from './range';

function anchor(position: 'from' | 'to', mergeSeq: number): ResolvedAnchorView {
  return {
    position,
    expression: `seq:${String(mergeSeq)}`,
    kind: 'sequence',
    mergeSeq,
    commitSha: 'a'.repeat(40),
    boundary: position === 'from' ? 'exclusive' : 'inclusive',
    occurredAt: null,
  };
}

describe('딥링크 파라미터 (CR-029, DEV-153)', () => {
  it('repo·branch·from·to·epoch를 읽는다 — `space` 문자열은 파라미터가 아니다', () => {
    const params = parseRangeParams(
      new URLSearchParams('repo=acme%2Fpayments&branch=main&from=%23100&to=v1.2&epoch=3'),
    );
    // `q`는 WP-032가 더한 축이다 — 없으면 `null`이지 키가 빠지지 않는다.
    expect(params).toEqual({
      repo: 'acme/payments',
      branch: 'main',
      from: '#100',
      to: 'v1.2',
      epoch: 3,
      q: null,
    });
  });

  it('owner/name 모양이 아니면 repo를 버린다 — 검증 없이 API로 흘리지 않는다', () => {
    expect(parseRangeParams(new URLSearchParams('repo=payments&branch=main')).repo).toBeNull();
    expect(parseRangeParams(new URLSearchParams('repo=a%2Fb%2Fc&branch=main')).repo).toBeNull();
  });

  it('에폭은 1 이상의 정수만 받는다 — `0`·`abc`는 인용이 아니다', () => {
    expect(parseRangeParams(new URLSearchParams('epoch=0')).epoch).toBeNull();
    expect(parseRangeParams(new URLSearchParams('epoch=abc')).epoch).toBeNull();
    expect(parseRangeParams(new URLSearchParams('epoch=12')).epoch).toBe(12);
  });

  it('URL 왕복이 값을 보존한다 — 딥링크가 곧 조사 상태다', () => {
    const query = formatRangeQuery({ repo: 'acme/payments', branch: 'main', from: 'seq:1', to: '#42', epoch: 2 });
    const back = parseRangeParams(new URLSearchParams(query));
    expect(back).toEqual({
      repo: 'acme/payments',
      branch: 'main',
      from: 'seq:1',
      to: '#42',
      epoch: 2,
      q: null,
    });
  });

  /*
   * **`q`는 URL에 있고 커서는 없다** (WP-032).
   *
   * 조건은 공유할 수 있다 — 같은 구간에 같은 필터를 건 화면이 열린다. 반면
   * 커서는 발급자의 접근 범위와 색인 스냅숏으로 봉인돼 있어(ADR-010 Amendment)
   * 남에게 붙여넣어 봤자 `CURSOR_QUERY_MISMATCH`다.
   */
  it('패싯이 만든 `q`가 딥링크에 실린다 — 조건은 공유된다', () => {
    const query = formatRangeQuery({
      repo: 'acme/payments',
      branch: 'main',
      from: 'seq:1',
      to: '#42',
      epoch: 2,
      q: 'author:kim label:backend',
    });
    expect(parseRangeParams(new URLSearchParams(query)).q).toBe('author:kim label:backend');
    // 커서는 조사 상태가 아니다 — 이 세션의 위치다.
    expect(query).not.toContain('cursor');
  });

  it('빈 앵커는 URL에 싣지 않는다', () => {
    expect(formatRangeQuery({ repo: 'a/b', branch: 'main' })).toBe('repo=a%2Fb&branch=main');
  });
});

describe('조회 전 사전 판정 (QA-W004-07·08)', () => {
  it('두 앵커가 다 서기 전에는 판정하지 않는다', () => {
    expect(preflightRange(null, anchor('to', 5)).kind).toBe('not_ready');
    expect(preflightRange(anchor('from', 1), null).kind).toBe('not_ready');
  });

  it('**from > to는 조회 전에 역전으로 판정한다** — 교환 제안의 근거를 싣는다', () => {
    const outcome = preflightRange(anchor('from', 10), anchor('to', 3));
    expect(outcome).toEqual({ kind: 'inverted', fromSeq: 10, toSeq: 3 });
  });

  it('같은 서수는 역전이 아니다 — 빈 반개구간은 유효하다', () => {
    expect(preflightRange(anchor('from', 5), anchor('to', 5))).toEqual({ kind: 'ok', expected: 0 });
  });

  it('**5만 건 초과는 조회 전에 안다** — 서수 차가 곧 커밋 수다', () => {
    const outcome = preflightRange(anchor('from', 0), anchor('to', RANGE_CLIENT_LIMIT + 1));
    expect(outcome).toEqual({ kind: 'too_large', expected: RANGE_CLIENT_LIMIT + 1 });
  });

  it('정확히 5만 건은 통과다 — 경계는 서버 한도와 같다', () => {
    expect(preflightRange(anchor('from', 0), anchor('to', RANGE_CLIENT_LIMIT))).toEqual({
      kind: 'ok',
      expected: RANGE_CLIENT_LIMIT,
    });
  });
});

describe('에폭 판정 (QA-W004-21)', () => {
  it('URL에 에폭이 없으면 경고가 아니다 — 지금 시작한 조사다', () => {
    expect(judgeEpoch(null, 3)).toBe('unpinned');
  });

  it('**불일치는 stale이다** — 화면은 경고만 내고 자동 재조회하지 않는다', () => {
    expect(judgeEpoch(2, 3)).toBe('stale');
    expect(judgeEpoch(3, 3)).toBe('match');
  });
});

describe('요약 판정 (QA-W004-10, CR-029 DEV-150)', () => {
  const RAW = {
    summary: {
      pull_request_count: 62,
      commit_count: 62,
      distinct_author_count: 18,
      changed_files_total: 412,
      additions_total: 9000,
      deletions_total: 1200,
      files_truncated_pull_request_count: 1,
      top_changed_paths: [{ path: 'src/pay', count: 12 }, { path: 7, count: 1 }],
    },
  };

  it('넷과 변경 규모·경로 상위가 그대로 옮겨진다', () => {
    const view = judgeSummary(RAW);
    expect(view?.pullRequestCount).toBe(62);
    expect(view?.distinctAuthorCount).toBe(18);
    // 모양이 어긋난 경로 항목은 건너뛴다.
    expect(view?.topChangedPaths).toEqual([{ path: 'src/pay', count: 12 }]);
  });

  it('**되돌림 수는 키가 없으면 `pending`이다** — 0으로 지어내지 않는다', () => {
    expect(judgeSummary(RAW)?.reverted).toEqual({ kind: 'pending', owner: 'WP-030' });
  });

  it('키가 실려 오는 날(WP-030) 화면 수정 없이 값이 선다', () => {
    const withCount = { summary: { ...RAW.summary, reverted_pull_request_count: 2 } };
    expect(judgeSummary(withCount)?.reverted).toEqual({ kind: 'count', count: 2 });
  });
});

describe('결과 행 판정 (QA-W004-11, DEV-130·154)', () => {
  it('**순서를 바꾸지 않는다** — 서버의 서수 오름차순을 그대로 신뢰한다', () => {
    const view = judgeItems({
      items: [
        { merge_seq: 3, kind: 'pull_request', commit_sha: 'c'.repeat(40), indexed: true },
        { merge_seq: 1, kind: 'commit', commit_sha: 'a'.repeat(40), indexed: true },
        { merge_seq: 2, kind: 'pull_request', commit_sha: 'b'.repeat(40), indexed: true },
      ],
    });
    expect(view.map((item) => item.mergeSeq)).toEqual([3, 1, 2]);
  });

  it('`indexed` 키가 없으면 색인 확인 안 됨으로 읽는다 — 있다고 지어내지 않는다', () => {
    const view = judgeItems({ items: [{ merge_seq: 1, commit_sha: 'a'.repeat(40) }] });
    expect(view[0]?.indexed).toBe(false);
  });

  it('서수나 SHA가 빠진 항목은 건너뛴다', () => {
    const view = judgeItems({ items: [{ merge_seq: 1, commit_sha: 'a'.repeat(40), indexed: true }, { kind: 'commit' }] });
    expect(view).toHaveLength(1);
  });
});

describe('앵커 실패 판정 (QA-W004-05·06·09)', () => {
  it('체인 밖 커밋은 머지 커밋 제안을 싣는다', () => {
    const view = judgeAnchorFailure({
      error: {
        code: 'ANCHOR_NOT_ON_BRANCH',
        detail: { suggested_anchor: { commit_sha: 'f'.repeat(40) } },
      },
    });
    expect(view).toEqual({ kind: 'not_on_branch', suggestedSha: 'f'.repeat(40) });
  });

  it('제안이 없으면 없는 채로 낸다 — 틀린 제안보다 없는 편이 낫다', () => {
    expect(judgeAnchorFailure({ error: { code: 'ANCHOR_NOT_ON_BRANCH' } })).toEqual({
      kind: 'not_on_branch',
      suggestedSha: null,
    });
  });

  it('**미머지와 공간 불일치를 가른다** — 사용자가 할 일이 다르다', () => {
    expect(judgeAnchorFailure({ error: { code: 'ANCHOR_NOT_MERGED' } })?.kind).toBe('not_merged');
    expect(
      judgeAnchorFailure({
        error: { code: 'SEQUENCE_SPACE_MISMATCH', detail: { release_base_branch: 'develop' } },
      }),
    ).toEqual({ kind: 'space_mismatch', releaseBranch: 'develop' });
  });

  it('해석 불가는 사유·모호 표식을 싣는다 (ADR-012)', () => {
    expect(
      judgeAnchorFailure({ error: { code: 'ANCHOR_UNRESOLVABLE', detail: { ambiguous: true } } }),
    ).toEqual({ kind: 'unresolvable', reason: null, ambiguous: true });
  });

  it('앵커 실패가 아닌 코드는 null이다 — 화면 공통 판정으로 넘긴다', () => {
    expect(judgeAnchorFailure({ error: { code: 'NOT_FOUND' } })).toBeNull();
  });
});

describe('정규화 응답 판정 (API-SEQ-002)', () => {
  it('모양이 어긋난 앵커는 건너뛰고 경계 기본은 포함이다', () => {
    const anchors = judgeResolvedAnchors({
      resolved: [
        { position: 'from', expression: 'seq:2', kind: 'sequence', merge_seq: 2, commit_sha: 'a'.repeat(40), boundary: 'exclusive' },
        { position: 'to', merge_seq: '아님', commit_sha: 'b'.repeat(40) },
        { position: '어디', merge_seq: 3, commit_sha: 'c'.repeat(40) },
      ],
    });
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.boundary).toBe('exclusive');
  });
});

describe('공간 목록 판정 (API-SEQ-006)', () => {
  it('모양이 맞는 항목만 옮기고 알 수 없는 상태는 unknown으로 좁힌다', () => {
    const spaces = judgeSpaces({
      spaces: [
        { repository: 'a/b', base_branch: 'main', sequence_space: 'a/b@main', seq_epoch: 2, sequence_state: 'ok' },
        { repository: 'a/b', base_branch: 'dev', sequence_state: '???' },
        { base_branch: 'main' },
      ],
    });
    expect(spaces).toHaveLength(2);
    expect(spaces[1]).toEqual({
      repository: 'a/b',
      base_branch: 'dev',
      sequence_space: 'a/b@dev',
      seq_epoch: null,
      sequence_state: 'unknown',
    });
  });
});
