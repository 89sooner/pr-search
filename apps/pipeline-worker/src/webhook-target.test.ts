/**
 * 보강 대상 추출 (WP-007, FR-ING-004).
 *
 * 이 파일이 지키는 것은 하나다 — **모양이 다른 payload를 PR API에 밀어 넣지
 * 않는다.** `undefined`가 URL에 실려 404가 되면 그 404는 "삭제된 PR"로
 * 오해되어 재시도 없이 실패 대기열로 간다. 원인과 증상이 아주 멀어진다.
 */

import { describe, expect, it } from 'vitest';
import { extractTarget, normalizePullRequest, splitFullName } from './webhook-target.js';

const REPOSITORY = { id: 4021, full_name: 'acme/payments' };
const PULL_REQUEST = {
  number: 1234,
  title: 'feat: 결제 재시도',
  state: 'closed',
  merged: true,
  merged_at: '2026-08-19T10:00:00Z',
  merge_commit_sha: 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5',
  user: { login: 'dev' },
  head: { ref: 'feature/retry', sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e' },
  base: { ref: 'main', sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e' },
};

describe('extractTarget (FR-ING-004)', () => {
  it('PR 이벤트에서 저장소와 PR 번호를 꺼낸다', () => {
    const outcome = extractTarget('pull_request', {
      action: 'closed',
      number: 1234,
      repository: REPOSITORY,
      pull_request: PULL_REQUEST,
    });

    expect(outcome.kind).toBe('target');
    if (outcome.kind !== 'target') return;
    expect(outcome.target).toMatchObject({ owner: 'acme', repo: 'payments', repositoryId: 4021, prNumber: 1234 });
    expect(outcome.target.webhookPullRequest).toMatchObject({
      number: 1234,
      merged: true,
      author: 'dev',
      head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e',
      base_ref: 'main',
    });
  });

  it('리뷰 이벤트도 같은 PR을 가리킨다', () => {
    const outcome = extractTarget('pull_request_review', {
      action: 'submitted',
      review: { id: 9, state: 'approved' },
      repository: REPOSITORY,
      pull_request: PULL_REQUEST,
    });
    expect(outcome.kind).toBe('target');
  });

  it('PR 이벤트가 아니면 진행하지 않고 넘긴다 (DEV-016)', () => {
    for (const eventType of ['push', 'release', 'member', 'team', 'repository', 'create', 'delete']) {
      const outcome = extractTarget(eventType, { repository: REPOSITORY });
      expect(outcome.kind).toBe('skip');
    }
  });

  it('PR 번호가 없으면 API를 부르지 않고 잘못된 payload로 판정한다', () => {
    const outcome = extractTarget('pull_request', { action: 'closed', repository: REPOSITORY });
    expect(outcome.kind).toBe('invalid');
  });

  it('PR 번호가 문자열이면 숫자로 믿지 않는다', () => {
    const outcome = extractTarget('pull_request', {
      action: 'closed',
      number: '1234',
      repository: REPOSITORY,
      pull_request: { ...PULL_REQUEST, number: '1234' },
    });
    expect(outcome.kind).toBe('invalid');
  });

  it('repository가 없거나 full_name이 owner/repo가 아니면 거부한다', () => {
    expect(extractTarget('pull_request', { number: 1 }).kind).toBe('invalid');
    expect(
      extractTarget('pull_request', { number: 1, repository: { id: 1, full_name: 'payments' } }).kind,
    ).toBe('invalid');
    expect(
      extractTarget('pull_request', { number: 1, repository: { id: 1, full_name: 'a/b/c' } }).kind,
    ).toBe('invalid');
  });

  it('payload가 객체가 아니면 거부한다', () => {
    expect(extractTarget('pull_request', null).kind).toBe('invalid');
    expect(extractTarget('pull_request', 'string').kind).toBe('invalid');
    expect(extractTarget('pull_request', [1, 2, 3]).kind).toBe('invalid');
  });

  it('pull_request가 빠져도 최상위 number로 대상은 정한다 — 부분 문서는 비어 있다', () => {
    const outcome = extractTarget('pull_request', { number: 77, repository: REPOSITORY });
    expect(outcome.kind).toBe('target');
    if (outcome.kind !== 'target') return;
    expect(outcome.target.prNumber).toBe(77);
    expect(outcome.target.webhookPullRequest).toBeNull();
  });
});

describe('normalizePullRequest', () => {
  it('head·base가 없으면 정규화하지 않는다', () => {
    expect(normalizePullRequest({ number: 1 })).toBeUndefined();
    expect(normalizePullRequest({ number: 1, head: { ref: 'a', sha: 'b' } })).toBeUndefined();
  });

  it('없는 값은 지어내지 않고 null·빈 문자열로 남긴다', () => {
    const pr = normalizePullRequest({
      number: 5,
      head: { ref: 'topic', sha: 'aaa' },
      base: { ref: 'main', sha: 'bbb' },
    });
    expect(pr).toMatchObject({ title: '', state: 'unknown', merged: false, author: null, merged_at: null });
  });
});

describe('splitFullName', () => {
  it('owner/repo만 받는다', () => {
    expect(splitFullName('acme/payments')).toEqual({ owner: 'acme', repo: 'payments' });
    expect(splitFullName('payments')).toBeUndefined();
    expect(splitFullName('acme/')).toBeUndefined();
    expect(splitFullName('/payments')).toBeUndefined();
  });
});
