/**
 * PR 문서 `state` 파생 (CR-101 / DEV-718).
 */

import { describe, expect, it } from 'vitest';
import { PULL_REQUEST_STATES, derivePullRequestState } from './pull-request-state.js';

describe('derivePullRequestState', () => {
  it('**GitHub의 closed + merged는 merged다** — 병합된 PR이 closed로 남지 않는다', () => {
    expect(derivePullRequestState({ state: 'closed', merged: true, merged_at: '2026-08-02T10:30:00.000Z' })).toBe('merged');
    expect(derivePullRequestState({ state: 'closed', merged: true, merged_at: null })).toBe('merged');
    expect(derivePullRequestState({ state: 'closed', merged: false, merged_at: '2026-08-02T10:30:00.000Z' })).toBe('merged');
  });

  it('병합 신호가 없으면 원시 값 그대로다 — open·closed·unknown을 지어내지 않는다', () => {
    expect(derivePullRequestState({ state: 'open', merged: false, merged_at: null })).toBe('open');
    expect(derivePullRequestState({ state: 'closed', merged: false, merged_at: null })).toBe('closed');
    expect(derivePullRequestState({ state: 'unknown' })).toBe('unknown');
    expect(derivePullRequestState({ state: 'closed', merged: null, merged_at: '' })).toBe('closed');
  });

  it('세 상태의 어휘는 open·closed·merged다', () => {
    expect([...PULL_REQUEST_STATES]).toEqual(['open', 'closed', 'merged']);
  });
});
