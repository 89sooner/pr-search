/**
 * C-020 판정 (WP-024 / FR-REL-002, QA-W002-08·09).
 *
 * 이 파일의 핵심은 **네 가지 "빈 목록"이 서로 다른 상태로 갈리는가**다.
 * 뭉치면 화면이 거짓을 말한다 — 미수집 저장소의 PR에 `미배포` 배지를 붙이면
 * "판정했다"는 거짓이 된다 (CR-028, DEV-146).
 */

import { describe, expect, it } from 'vitest';
import { judgeContainment } from './containment';

describe('judgeContainment — 상태 갈래 (DEV-146)', () => {
  it('포함 릴리스가 있으면 `ready`다', () => {
    const state = judgeContainment({
      merge_seq: 1342,
      releases: [
        { tag_name: 'v1.0', released_at: '2026-08-19T09:00:00Z', base_branch: 'main', merge_seq: 1350, source: 'git_tag' },
      ],
      unreleased: false,
    });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') expect(state.releases[0]?.tagName).toBe('v1.0');
  });

  it('**빈 목록 + unreleased:true만 미배포다** (QA-W002-09)', () => {
    const state = judgeContainment({ merge_seq: 1372, releases: [], unreleased: true, pending_pull_request_count: 14 });
    expect(state).toEqual({ kind: 'unreleased', pendingPrCount: 14 });
  });

  it('**릴리스 미수집은 미배포가 아니다** — 판정 자체가 성립하지 않았다', () => {
    const state = judgeContainment({ merge_seq: 1372, releases: [], unreleased: false, reason: 'release_not_indexed' });
    expect(state.kind).toBe('release_not_indexed');
  });

  it('**서수 없는 대상은 미배포가 아니다** — 비교 기준이 없다', () => {
    const state = judgeContainment({ merge_seq: null, releases: [], unreleased: false, reason: 'target_not_sequenced' });
    expect(state.kind).toBe('not_sequenced');
  });

  it('merge_seq 키 자체가 없어도 `not_sequenced`다 — 모르는 것을 아는 척하지 않는다', () => {
    expect(judgeContainment({ releases: [], unreleased: false }).kind).toBe('not_sequenced');
  });

  it('빈 목록인데 unreleased 플래그도 없으면 미배포로 그리지 않는다', () => {
    // 서버가 판정을 못 준 응답이다. 없는 판정을 있는 것처럼 그리면 거짓이 된다.
    expect(judgeContainment({ merge_seq: 10, releases: [] }).kind).toBe('not_sequenced');
  });

  it('**`unreleased: false`는 미배포가 아니다** — 값이 아니라 키의 존재로 판정하면 거짓이 된다', () => {
    // 빈 목록 + false + 사유 없음은 서버가 낼 수 없는 모순 응답이다. 그래도
    // "false를 미배포로 그리는" 구현과 "true만 미배포로 그리는" 구현은 여기서 갈린다.
    expect(judgeContainment({ merge_seq: 10, releases: [], unreleased: false }).kind).toBe('not_sequenced');
  });

  it('대기 수가 없으면 0으로 그린다 — 숫자를 지어내지 않는다', () => {
    const state = judgeContainment({ merge_seq: 1, releases: [], unreleased: true });
    expect(state).toEqual({ kind: 'unreleased', pendingPrCount: 0 });
  });
});

describe('judgeContainment — 목록 정제', () => {
  it('**순서를 바꾸지 않는다** (QA-W002-08) — 서버의 시각 오름차순을 그대로 신뢰한다', () => {
    const state = judgeContainment({
      merge_seq: 1,
      releases: [
        { tag_name: 'a-2026-01', released_at: '2026-01-01T00:00:00Z' },
        { tag_name: 'b-2026-02', released_at: '2026-02-01T00:00:00Z' },
        { tag_name: 'c-2026-03', released_at: '2026-03-01T00:00:00Z' },
      ],
    });
    if (state.kind !== 'ready') throw new Error(state.kind);
    expect(state.releases.map((release) => release.tagName)).toEqual(['a-2026-01', 'b-2026-02', 'c-2026-03']);
  });

  it('태그명이나 시각이 빠진 항목은 채워 넣지 않고 건너뛴다', () => {
    const state = judgeContainment({
      merge_seq: 1,
      releases: [
        { tag_name: 'v1.0', released_at: '2026-01-01T00:00:00Z' },
        { released_at: '2026-02-01T00:00:00Z' },
        { tag_name: 'v3.0' },
      ],
    });
    if (state.kind !== 'ready') throw new Error(state.kind);
    expect(state.releases).toHaveLength(1);
  });

  it('릴리스 서수가 없으면 `null`로 남긴다 — 0으로 지어내지 않는다', () => {
    const state = judgeContainment({
      merge_seq: 1,
      releases: [{ tag_name: 'off-chain', released_at: '2026-01-01T00:00:00Z' }],
    });
    if (state.kind !== 'ready') throw new Error(state.kind);
    expect(state.releases[0]?.mergeSeq).toBeNull();
  });
});
