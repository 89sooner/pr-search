import { describe, expect, it } from 'vitest';
import { planWorkspaceHint, resultCount, type WorkspaceHintContext, type WorkspaceHintPlan } from './workspace-relaxation';

const REPO = 'acme/payments';

function ctx(params: Record<string, string>, overrides: Partial<WorkspaceHintContext> = {}): WorkspaceHintContext {
  return {
    serialized: new URLSearchParams({ repository: REPO, ...params }).toString(),
    repository: REPO,
    tab: 'search',
    login: 'kim',
    ...overrides,
  };
}

function action(plan: WorkspaceHintPlan): Extract<WorkspaceHintPlan, { kind: 'action' }> {
  if (plan.kind !== 'action') throw new Error(`expected an action, got ${plan.kind}:${plan.reason}`);
  return plan;
}

describe('planWorkspaceHint — a suggestion becomes a button only when this screen can remove exactly that node (CR-131)', () => {
  it('author control', () => {
    const plan = action(planWorkspaceHint({ remove: 'author:lee', would_yield: 12 }, ctx({ author: 'lee' })));
    expect(plan.label).toBe('Remove author: lee');
    expect(plan.changes).toEqual({ author: '' });
    expect(plan.clearSeqRange).toBe(false);
  });

  it('path clears the file tree selection too', () => {
    const plan = action(planWorkspaceHint({ remove: 'path:src/pay', would_yield: 5 }, ctx({ path: 'src/pay', path_kind: 'directory', source_ref: 'abc1234' })));
    expect(plan.label).toBe('Remove path: src/pay');
    expect(plan.changes).toEqual({ path: '', path_kind: '', source_ref: '' });
  });

  it('label, status, base branch controls', () => {
    expect(action(planWorkspaceHint({ remove: 'label:backend', would_yield: 3 }, ctx({ label: 'backend' }))).changes).toEqual({ label: '' });
    expect(action(planWorkspaceHint({ remove: 'is:merged', would_yield: 3 }, ctx({ state: 'merged' }))).changes).toEqual({ state: '' });
    expect(action(planWorkspaceHint({ remove: 'base:main', would_yield: 3 }, ctx({ base: 'main' }))).changes).toEqual({ base: '' });
  });

  it('merged date range drops tz with the dates and names the calendar', () => {
    const plan = action(planWorkspaceHint(
      { remove: 'merged:2026-09-01..2026-09-30@Asia/Seoul', would_yield: 7 },
      ctx({ from: '2026-09-01', to: '2026-09-30', tz: 'Asia/Seoul' }),
    ));
    expect(plan.changes).toEqual({ from: '', to: '', tz: '' });
    expect(plan.label).toBe('Remove merged date: 2026-09-01–2026-09-30 KST');
  });

  it('a merged date range in another calendar is a different node', () => {
    const plan = planWorkspaceHint({ remove: 'merged:2026-09-01..2026-09-30', would_yield: 7 }, ctx({ from: '2026-09-01', to: '2026-09-30', tz: 'Asia/Seoul' }));
    expect(plan).toMatchObject({ kind: 'fixed', reason: 'unmatched' });
  });

  it('PR number and M number ranges', () => {
    expect(action(planWorkspaceHint({ remove: 'pr_number:10..20', would_yield: 2 }, ctx({ pr_from: '10', pr_to: '20' }))).changes).toEqual({ pr_from: '', pr_to: '' });
    const mnum = action(planWorkspaceHint({ remove: 'mnum:1..5', would_yield: 2 }, ctx({ base: 'main', mnum_from: '1', mnum_to: '5' })));
    expect(mnum.changes).toEqual({ mnum_from: '', mnum_to: '' });
    expect(mnum.label).toBe('Remove M numbers: 1–5');
  });

  it('the merge-order range lives in component state', () => {
    const plan = action(planWorkspaceHint(
      { remove: 'seq:2..3', would_yield: 4 },
      ctx({ base: 'main' }, { seqRange: { space: `${REPO}@main`, range: '2..3' } }),
    ));
    expect(plan.clearSeqRange).toBe(true);
    expect(plan.changes).toEqual({});
  });

  it('a filter typed into the free-text box is removed from that box only, keeping the keywords', () => {
    const plan = action(planWorkspaceHint({ remove: 'label:backend', would_yield: 9 }, ctx({ q: 'label:backend retry' })));
    expect(plan.changes).toEqual({ q: 'retry' });
    const whole = action(planWorkspaceHint({ remove: 'label:backend', would_yield: 9 }, ctx({ q: 'label:backend' })));
    expect(whole.changes).toEqual({ q: '' });
  });

  it('values from two places in one node are both removed — control and typed text', () => {
    const plan = action(planWorkspaceHint({ remove: 'author:kim author:lee', would_yield: 21 }, ctx({ author: 'kim', q: 'author:lee retry' })));
    expect(plan.changes).toEqual({ author: '', q: 'retry' });
    expect(plan.label).toBe('Remove author: kim, lee');
  });

  it('a similar condition with another operator survives — no whole-string replacement', () => {
    const plan = action(planWorkspaceHint({ remove: 'author:kim', would_yield: 8 }, ctx({ author: 'kim', q: '-author:bot' })));
    expect(plan.changes).toEqual({ author: '' });
    const negated = action(planWorkspaceHint({ remove: '-author:bot', would_yield: 30 }, ctx({ author: 'kim', q: '-author:bot' })));
    expect(negated.changes).toEqual({ q: '' });
    expect(negated.label).toBe('Remove excluded author: bot');
  });

  it('conditions the workspace sets itself are never buttons', () => {
    expect(planWorkspaceHint({ remove: 'kind:pull_request', would_yield: 40 }, ctx({ author: 'lee' }))).toMatchObject({ kind: 'fixed', reason: 'view' });
    expect(planWorkspaceHint({ remove: `repo:${REPO}`, would_yield: 40 }, ctx({ author: 'lee' }))).toMatchObject({ kind: 'fixed', reason: 'view' });
  });

  it('My PRs tabs: the login author and the tab state belong to the tab', () => {
    const open = ctx({}, { tab: 'open' });
    expect(planWorkspaceHint({ remove: 'author:kim', would_yield: 3 }, open)).toMatchObject({ kind: 'fixed', reason: 'tab' });
    expect(planWorkspaceHint({ remove: 'is:open', would_yield: 3 }, open)).toMatchObject({ kind: 'fixed', reason: 'tab' });
    // Other filters on those tabs are still removable.
    expect(action(planWorkspaceHint({ remove: 'label:backend', would_yield: 1 }, ctx({ label: 'backend' }, { tab: 'open' }))).changes).toEqual({ label: '' });
  });

  it('a suggestion that is not in the current query, or not one node, is not a button', () => {
    expect(planWorkspaceHint({ remove: 'author:nobody', would_yield: 1 }, ctx({ author: 'lee' }))).toMatchObject({ kind: 'fixed', reason: 'unmatched' });
    expect(planWorkspaceHint({ remove: 'author:lee label:backend', would_yield: 1 }, ctx({ author: 'lee', label: 'backend' }))).toMatchObject({ kind: 'fixed', reason: 'unmatched' });
    expect(planWorkspaceHint({ remove: 'nokey:', would_yield: 1 }, ctx({ author: 'lee' }))).toMatchObject({ kind: 'fixed', reason: 'unmatched' });
    expect(planWorkspaceHint({ remove: 'retry', would_yield: 1 }, ctx({ q: 'retry' }))).toMatchObject({ kind: 'fixed', reason: 'unmatched' });
  });

  it('removing base while an M number range needs it would be a 400, so it is not a button', () => {
    expect(planWorkspaceHint({ remove: 'base:main', would_yield: 3 }, ctx({ base: 'main', mnum_from: '1', mnum_to: '5' }))).toMatchObject({ kind: 'fixed', reason: 'unsafe' });
  });

  it('removing base drops the merge-order range too, so it is not a button', () => {
    const plan = planWorkspaceHint({ remove: 'base:main', would_yield: 3 }, ctx({ base: 'main' }, { seqRange: { space: `${REPO}@main`, range: '2..3' } }));
    expect(plan).toMatchObject({ kind: 'fixed', reason: 'unsafe' });
  });

  it('a removal that leaves only an identifier in the free-text box would switch to identifier lookup, so it is not a button (independent review)', () => {
    for (const q of ['label:backend 12345', 'label:backend abc1234f', 'label:backend #123', 'is:merged M-1900-1450']) {
      const remove = q.split(' ')[0]!;
      expect(planWorkspaceHint({ remove, would_yield: 7 }, ctx({ q }))).toMatchObject({ kind: 'fixed', reason: 'unsafe' });
    }
    // Keywords that are not identifiers still work.
    expect(action(planWorkspaceHint({ remove: 'label:backend', would_yield: 7 }, ctx({ q: 'label:backend retry' }))).changes).toEqual({ q: 'retry' });
  });

  it('on My PRs tabs only the tab\'s own author and state are fixed — a typed negated author is removable (independent review)', () => {
    const plan = action(planWorkspaceHint({ remove: '-author:bot', would_yield: 4 }, ctx({ q: '-author:bot' }, { tab: 'open' })));
    expect(plan.changes).toEqual({ q: '' });
  });

  it('never throws on odd input', () => {
    expect(() => planWorkspaceHint({ remove: '"', would_yield: 1 }, ctx({}))).not.toThrow();
    expect(() => planWorkspaceHint({ remove: 'author:lee', would_yield: 1 }, { ...ctx({}), serialized: 'q=%22' })).not.toThrow();
  });
});

describe('resultCount', () => {
  it('singular and plural with thousands separators', () => {
    expect(resultCount(1)).toBe('1 result');
    expect(resultCount(1234)).toBe('1,234 results');
  });
});
