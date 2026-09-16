/**
 * W-003 판정 (WP-018 / CR-021, FR-SRCH-002).
 *
 * 이 파일이 거는 것은 셋으로 모인다.
 *
 * 1. **커밋에 대해 아는 것을 PR에서 빌려오지 않는가** (DEV-090)
 * 2. **"아직 못 이었다"와 "거치지 않았다"를 가르는가** (DEV-093)
 * 3. **"체인 밖"과 "미채번"을 가르는가** (DEV-092)
 *
 * 셋 다 틀리면 화면이 **없는 사실을 주장한다.**
 */

import { describe, expect, it } from 'vitest';
import {
  changedPathModel,
  commitTitle,
  gheCommitUrl,
  hasCommitMetadata,
  landedAsCommitSha,
  linkedPrState,
  pathCountLabel,
  roleLabel,
  sequencePositionState,
  type ChangedPathModel,
  type CommitDetailSource,
} from './commit-detail';

const MERGE_SHA = 'a'.repeat(40);
const SOURCE_SHA = 'b'.repeat(40);

/** 머지 커밋. PR 하나에 대응한다 (QA-W003-01). */
const MERGE: CommitDetailSource = {
  repository: 'acme/payments',
  commit_sha: MERGE_SHA,
  short_sha: MERGE_SHA.slice(0, 12),
  role: 'merge_commit',
  base_branch: 'main',
  merge_seq: null,
  seq_epoch: null,
  sequence_space: null,
  pull_requests: [
    {
      pr_number: 1234,
      title: 'feat: 결제 재시도',
      author: 'kim',
      reviewers: ['lee', 'park'],
      approved_by: ['lee'],
      state: 'merged',
      merged_at: '2026-08-19T05:02:11Z',
      merge_commit_sha: MERGE_SHA,
      url: '/pr/acme/payments/1234',
    },
  ],
};

/** 원본 커밋 (QA-W003-02). 체인 밖이다. */
const SOURCE: CommitDetailSource = { ...MERGE, commit_sha: SOURCE_SHA, role: 'source_commit' };

describe('역할 배지 (QA-W003-01·02·03)', () => {
  it('세 값을 모두 다룬다 — `direct_push`도 문구가 있다', () => {
    expect(roleLabel('merge_commit')).toEqual({ text: "Merge commit", known: true });
    expect(roleLabel('source_commit')).toEqual({ text: "Original commit", known: true });
    /*
     * WP-021 전까지 도달하지 않지만(DEV-061) 매핑에는 둔다. 빼 두면 값이
     * 오는 날 `undefined`가 화면에 뜬다.
     */
    expect(roleLabel('direct_push')).toEqual({ text: "Direct push", known: true });
  });

  it('**모르는 역할을 `merge_commit`으로 기본값 두지 않는다**', () => {
    // 기본값을 두면 원본 커밋이 "브랜치에 착지했다"로 읽힌다.
    for (const unknown of [undefined, '', 'rebase_commit']) {
      const label = roleLabel(unknown);
      expect(label.known).toBe(false);
      expect(label.text).toBe("Unknown role");
    }
  });
});

describe('시퀀스 위치 (DEV-092)', () => {
  it('**원본 커밋은 체인 밖이다** — 시퀀스가 `null`이어도', () => {
    /*
     * squash merge에서 원본 커밋은 브랜치에 직접 착지하지 않는다. 시퀀스
     * 없이도 지금 말할 수 있는 사실이다.
     */
    expect(sequencePositionState(SOURCE)).toBe('off_chain');
  });

  it('**머지 커밋은 미채번이다** — 체인 밖이 아니다', () => {
    // 값만 보고 판정하면 여기가 `off_chain`이 되는데, 그것은 거짓이다.
    expect(sequencePositionState(MERGE)).toBe('not_computed');
  });

  it('채번되면 `assigned`다', () => {
    expect(sequencePositionState({ ...MERGE, merge_seq: 1342 })).toBe('assigned');
    // 원본 커밋에 값이 붙는 일은 없어야 하지만, 붙으면 값이 이긴다.
    expect(sequencePositionState({ ...SOURCE, merge_seq: 7 })).toBe('assigned');
  });

  it('시퀀스 키가 아예 없어도 역할로 판정한다', () => {
    const bare: CommitDetailSource = { role: 'source_commit' };
    expect(sequencePositionState(bare)).toBe('off_chain');
    expect(sequencePositionState({ role: 'merge_commit' })).toBe('not_computed');
  });
});

describe('착지한 머지 커밋 (DEV-091)', () => {
  it('소속 PR의 `merge_commit_sha`를 쓴다', () => {
    expect(landedAsCommitSha(SOURCE)).toBe(MERGE_SHA);
  });

  it('**미머지 PR만 있으면 `null`이다** — 없는 커밋으로 링크하지 않는다', () => {
    const open: CommitDetailSource = {
      ...SOURCE,
      pull_requests: [{ pr_number: 1236, title: '미머지', state: 'open', url: '/pr/acme/payments/1236' }],
    };
    expect(landedAsCommitSha(open)).toBeNull();
  });

  it('PR이 여럿이면 머지된 첫 PR의 것을 쓴다', () => {
    const many: CommitDetailSource = {
      ...SOURCE,
      pull_requests: [
        { pr_number: 1236, state: 'open' },
        { pr_number: 1234, state: 'merged', merge_commit_sha: MERGE_SHA },
      ],
    };
    expect(landedAsCommitSha(many)).toBe(MERGE_SHA);
  });

  it('PR이 없으면 `null`이다', () => {
    expect(landedAsCommitSha({ role: 'source_commit' })).toBeNull();
  });
});

describe('소속 PR 상태 (DEV-093)', () => {
  it('PR이 있으면 `linked`다', () => {
    expect(linkedPrState(MERGE)).toBe('linked');
  });

  it('**`direct_push`는 역할이 그렇게 말할 때만이다**', () => {
    expect(linkedPrState({ role: 'direct_push', pull_requests: [] })).toBe('direct_push');
  });

  it('**`reason_code`만으로는 직접 푸시가 아니다** — 아직 못 이은 것이다', () => {
    /*
     * 이것이 이 모듈의 핵심이다. 서버의 `reason_code: 'no_pull_request'`는
     * "투영이 아직 PR 번호를 잇지 못했다"이고, 그것을 "직접 푸시"라고 쓰면
     * **PR 리뷰를 거치지 않고 들어간 커밋**이라는 거짓을 말하게 된다.
     */
    const notYet: CommitDetailSource = {
      role: 'merge_commit',
      pull_requests: [],
      reason_code: 'no_pull_request',
    };
    expect(linkedPrState(notYet)).toBe('not_linked_yet');
  });

  it('역할을 모르고 PR도 없으면 `not_linked_yet`이다 — 직접 푸시로 넘겨짚지 않는다', () => {
    expect(linkedPrState({ pull_requests: [] })).toBe('not_linked_yet');
    expect(linkedPrState({})).toBe('not_linked_yet');
  });

  it('PR이 둘 이상이어도 `linked`다 — `multi_pr`은 길이로 판단한다 (AC-5)', () => {
    const shared: CommitDetailSource = {
      ...SOURCE,
      pull_requests: [{ pr_number: 1234 }, { pr_number: 1235 }],
    };
    expect(linkedPrState(shared)).toBe('linked');
    expect(shared.pull_requests).toHaveLength(2);
  });
});

describe('변경 경로 (DEV-094, QA-W003-08)', () => {
  it('**키가 없으면 "수집 전"이다** — `0`이 아니다', () => {
    const model = changedPathModel(MERGE);
    expect(model.notCollected).toBe(true);
    expect(model.totalCount).toBeNull();
    expect(model.paths).toEqual([]);
  });

  it('빈 배열은 "수집했는데 바꾼 파일이 없다"다 — 수집 전과 다르다', () => {
    const model = changedPathModel({ ...MERGE, changed_paths: [], changed_files_count: 0 });
    expect(model.notCollected).toBe(false);
    expect(model.totalCount).toBe(0);
  });

  it('총계가 목록보다 크면 절삭이다', () => {
    const model = changedPathModel({
      ...MERGE,
      changed_paths: [{ path: 'a.ts' }, { path: 'b.ts' }],
      changed_files_count: 40,
    });
    expect(model.truncated).toBe(true);
    expect(model.totalCount).toBe(40);
  });

  it('**총계 키가 없으면 `null`이다** — 목록 길이를 총계로 쓰지 않는다', () => {
    const model = changedPathModel({ ...MERGE, changed_paths: [{ path: 'a.ts' }] });
    expect(model.totalCount).toBeNull();
    expect(model.truncated).toBe(false);
  });
});

describe('변경 경로 문구 (DEV-094)', () => {
  const model = (over: Partial<ChangedPathModel>): ChangedPathModel => ({
    paths: [{ path: 'a.ts' }, { path: 'b.ts' }],
    totalCount: 2,
    truncated: false,
    notCollected: false,
    ...over,
  });

  it('**수집 전이면 "0개"라고 쓰지 않는다**', () => {
    /*
     * "파일 0개"는 *파일을 하나도 바꾸지 않은 커밋*을 뜻한다. 아직 세지
     * 않은 것을 그렇게 쓰면 화면이 없는 사실을 주장한다.
     */
    const label = pathCountLabel(model({ paths: [], totalCount: null, notCollected: true }));
    expect(label).toContain("have not been collected yet");
    expect(label).not.toContain("Files: 0");
  });

  it('세었으면 확정 건수를 말한다', () => {
    expect(pathCountLabel(model({ totalCount: 2 }))).toBe("Files: 2");
  });

  it('바꾼 파일이 정말 없으면 `0개`다 — 수집 전과 다른 문구다', () => {
    expect(pathCountLabel(model({ paths: [], totalCount: 0 }))).toBe("Files: 0");
  });

  it('**절삭이면 상위 N건임을 밝힌다** — 전부인 것처럼 쓰지 않는다', () => {
    const label = pathCountLabel(model({ totalCount: 40, truncated: true }));
    expect(label).toContain('40');
    expect(label).toContain("Top 2");
  });

  it('**총계를 모르면 모른다고 쓴다** — 목록 길이를 총계로 내세우지 않는다', () => {
    const label = pathCountLabel(model({ totalCount: null }));
    expect(label).toContain("total file count is not collected");
    expect(label).not.toBe("Files: 2");
  });
});

describe('헤더 표시명 (DEV-090)', () => {
  it('**소속 PR의 제목을 쓰지 않는다** — 축약 SHA다', () => {
    /*
     * 빌려오면 한 PR의 원본 커밋 N건이 전부 같은 제목으로 보이고,
     * 체리픽·되돌림 조사가 정확히 반대의 결론에 이른다.
     */
    expect(commitTitle(MERGE)).toBe(MERGE_SHA.slice(0, 12));
    expect(commitTitle(MERGE)).not.toContain('결제');
  });

  it('커밋 메시지가 오면 첫 줄을 쓴다 (WP-020 뒤)', () => {
    expect(commitTitle({ ...MERGE, message: 'fix: 재시도 한도\n\n본문' })).toBe('fix: 재시도 한도');
  });

  it('`short_sha`가 없으면 전체 SHA를 잘라 쓴다', () => {
    expect(commitTitle({ commit_sha: MERGE_SHA })).toBe(MERGE_SHA.slice(0, 12));
  });

  it('메타데이터를 하나라도 알면 참이다', () => {
    expect(hasCommitMetadata(MERGE)).toBe(false);
    expect(hasCommitMetadata({ ...MERGE, author: 'kim' })).toBe(true);
    expect(hasCommitMetadata({ ...MERGE, message: 'x' })).toBe(true);
    expect(hasCommitMetadata({ ...MERGE, authored_at: '2026-08-19T00:00:00Z' })).toBe(true);
  });
});

describe('GHE 커밋 링크', () => {
  it('판별기가 파싱하는 것과 같은 형식이다', () => {
    expect(gheCommitUrl('https://ghe.acme.example', 'acme/payments', MERGE_SHA)).toBe(
      `https://ghe.acme.example/acme/payments/commit/${MERGE_SHA}`,
    );
  });

  it('꼬리 슬래시를 정리한다', () => {
    expect(gheCommitUrl('https://ghe.acme.example//', 'acme/a', MERGE_SHA)).toBe(
      `https://ghe.acme.example/acme/a/commit/${MERGE_SHA}`,
    );
  });

  it('**미구성이면 `null`이다** — 죽은 링크를 만들지 않는다', () => {
    expect(gheCommitUrl(undefined, 'acme/a', MERGE_SHA)).toBeNull();
    expect(gheCommitUrl('   ', 'acme/a', MERGE_SHA)).toBeNull();
  });

  it('저장소나 SHA를 모르면 `null`이다', () => {
    expect(gheCommitUrl('https://ghe.example', null, MERGE_SHA)).toBeNull();
    expect(gheCommitUrl('https://ghe.example', 'acme/a', null)).toBeNull();
    expect(gheCommitUrl('https://ghe.example', 'acme/a', '')).toBeNull();
  });
});
