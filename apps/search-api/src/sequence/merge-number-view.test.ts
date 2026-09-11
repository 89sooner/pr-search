/**
 * M 번호 DTO 판정 (WP-074 / FR-SEQ-008 AC-3 · AC-12 · AC-13, 설계 9절).
 *
 * 이 파일은 **순수 함수만** 건다. 정본을 어떻게 읽어 오는가는 통합 시험이 보고,
 * 여기서는 "같은 입력에 같은 답을 내는가"와 "계약이 정한 순서를 지키는가"를 본다.
 */

import { describe, expect, it } from 'vitest';
import { indexCanonical, mergeNumberFieldsOf, repositoryNameOf, type MergeNumberSubject } from './merge-number-view.js';

const REPO = 7431;
const BRANCH = 'main';

const space = {
  repository_id: REPO,
  base_branch: BRANCH,
  seq_epoch: 1,
  state: 'ok',
  mnumber_head_seq: 9,
  mnumber_blocked_seq: null,
  mnumber_blocked_reason: null,
};

function row(mergeSeq: number, mergeNumber: number | null, prNumber = 21): Parameters<typeof indexCanonical>[0]['rows'][number] {
  return {
    repository_id: REPO,
    base_branch: BRANCH,
    pull_request_number: prNumber,
    merge_seq: mergeSeq,
    commit_sha: String(mergeSeq).padStart(40, '0'),
    merge_number: mergeNumber,
    seq_epoch: 1,
  };
}

const subject: MergeNumberSubject = {
  repositoryId: REPO,
  baseBranch: BRANCH,
  prNumber: 21,
  repositoryName: 'smp1900',
  state: 'merged',
};

describe('한 PR에 정본 행이 둘일 때 (DEV-601)', () => {
  /*
   * 같은 PR의 **이중 squash SHA**다 (설계 3절). `merge_sequence_numbered_pr_uk`가
   * `WHERE merge_number IS NOT NULL` 부분 인덱스라 미채번 행의 중복을 막지 않고,
   * 그 상태는 planner가 `mapping_conflict`로 멈추는 바로 그 상태이므로 두 행이
   * 정본에 영구히 함께 남는다.
   */
  const numbered = row(5, 42);
  const unnumbered = row(9, null);

  it('**배열 순서가 답을 바꾸지 않는다** — 같은 입력에 같은 답이다', () => {
    const forward = mergeNumberFieldsOf(subject, { canonical: { spaces: [space], rows: [numbered, unnumbered] } });
    const backward = mergeNumberFieldsOf(subject, { canonical: { spaces: [space], rows: [unnumbered, numbered] } });
    expect(backward).toEqual(forward);
  });

  it('**부여된 번호가 이긴다** (AC-3: 부여된 번호는 옮겨 가지 않는다)', () => {
    for (const rows of [[numbered, unnumbered], [unnumbered, numbered]]) {
      const fields = mergeNumberFieldsOf(subject, { canonical: { spaces: [space], rows } });
      expect(fields).toMatchObject({ merge_number: 'M-1900-42', merge_number_state: 'assigned' });
    }
  });

  it('둘 다 번호가 없으면 작은 서수를 고른다 — 고르는 규칙이 있다', () => {
    const index = indexCanonical({ spaces: [space], rows: [row(9, null), row(5, null)] });
    expect(index.rowOf(REPO, BRANCH, 21)?.merge_seq).toBe(5);
  });
});

describe('blocker 사유는 고정 enum만 나간다 (DEV-602)', () => {
  it('**내부 예외 메시지를 사유로 싣지 않는다** (설계 9절)', () => {
    const leaky = { ...space, mnumber_blocked_seq: 5, mnumber_blocked_reason: 'connect ECONNREFUSED 10.0.0.4:5432' };
    const fields = mergeNumberFieldsOf(subject, { canonical: { spaces: [leaky], rows: [row(5, null)] } });
    expect(fields.merge_number_reason).toBe('pr_evidence_pending');
    expect(JSON.stringify(fields)).not.toContain('10.0.0.4');
  });

  it('아는 사유는 그대로 전한다 — 위 방어가 정상 사유를 지우지 않는다', () => {
    const blocked = { ...space, mnumber_blocked_seq: 5, mnumber_blocked_reason: 'negative_evidence_unavailable' };
    const fields = mergeNumberFieldsOf(subject, { canonical: { spaces: [blocked], rows: [row(5, null)] } });
    expect(fields.merge_number_reason).toBe('negative_evidence_unavailable');
  });
});

describe('결정 순서 (설계 9절 마지막 문단)', () => {
  it('미머지가 가장 먼저다 — 정본을 읽기 전에 답한다', () => {
    const fields = mergeNumberFieldsOf({ ...subject, state: 'open' }, { canonical: null });
    expect(fields).toMatchObject({ merge_number_state: 'not_applicable', merge_number_reason: 'not_merged' });
  });

  it('비대상 브랜치는 대기가 아니라 대상 아님이다', () => {
    const fields = mergeNumberFieldsOf(subject, {
      canonical: { spaces: [space], rows: [row(5, 42)] },
      trackedBranches: new Map([[REPO, ['release']]]),
    });
    expect(fields).toMatchObject({ merge_number_state: 'not_applicable', merge_number_reason: 'branch_not_tracked' });
  });

  it('정본을 읽지 못하면 확인 불가다 — 대기로 위장하지 않는다', () => {
    const fields = mergeNumberFieldsOf(subject, { canonical: null });
    expect(fields).toMatchObject({ merge_number_state: 'unavailable', merge_number_reason: 'mnumber_read_failed' });
  });

  it('이름에서 코드를 정할 수 없으면 번호가 있어도 표기하지 않는다', () => {
    const fields = mergeNumberFieldsOf(
      { ...subject, repositoryName: 'pay19svc20' },
      { canonical: { spaces: [space], rows: [row(5, 42)] } },
    );
    expect(fields).toMatchObject({ merge_number: null, merge_number_state: 'unavailable', merge_number_reason: 'repository_code_unavailable' });
  });
});

describe('repositoryNameOf', () => {
  it('`owner/name`에서 이름만 쓴다 — 소유자의 숫자는 코드가 아니다', () => {
    expect(repositoryNameOf('acme1/smp1900')).toBe('smp1900');
    expect(repositoryNameOf(null)).toBeNull();
  });
});
