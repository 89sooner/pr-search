import { describe, expect, it } from 'vitest';
import { parseQuery } from '@prs/query';
import { buildRepositoryQuery, buildShaRangeFilter, repositoryLabelOptions, repositorySort, type SeqRangeCandidate } from './repository-search';

describe('repository workspace search contract', () => {
  it('uses canonical merged state and preserves selectable filters', () => {
    const query = buildRepositoryQuery({ serialized: 'base=main&label=bug&state=merged', repository: 'acme/payments', tab: 'search', login: 'kim' });
    expect(query).toBe('kind:pull_request repo:"acme/payments" base:"main" label:"bug" is:merged');
    expect(() => parseQuery(query)).not.toThrow();
  });

  it('merged tab uses the signed-in author and canonical state', () => {
    expect(buildRepositoryQuery({ serialized: '', repository: 'acme/payments', tab: 'merged', login: 'kim' }))
      .toBe('kind:pull_request repo:"acme/payments" author:"kim" is:merged');
  });

  it('requires both dates before adding a range', () => {
    expect(buildRepositoryQuery({ serialized: 'from=2026-09-01', repository: 'acme/payments', tab: 'search', login: '' })).not.toContain('merged:');
    expect(buildRepositoryQuery({ serialized: 'from=2026-09-01&to=2026-09-17', repository: 'acme/payments', tab: 'search', login: '' })).toContain('merged:2026-09-01..2026-09-17');
  });

  it('requires both PR-number bounds before adding a range, and interops with the shared parser', () => {
    const both = buildRepositoryQuery({ serialized: 'pr_from=100&pr_to=200', repository: 'acme/payments', tab: 'search', login: '' });
    expect(both).toContain('pr_number:100..200');
    expect(() => parseQuery(both)).not.toThrow();
    expect(buildRepositoryQuery({ serialized: 'pr_from=100', repository: 'acme/payments', tab: 'search', login: '' })).not.toContain('pr_number:');
    expect(buildRepositoryQuery({ serialized: 'pr_to=200', repository: 'acme/payments', tab: 'search', login: '' })).not.toContain('pr_number:');
  });

  it('rejects a reversed PR-number range through the shared parser (no client-side reimplementation needed)', () => {
    const reversed = buildRepositoryQuery({ serialized: 'pr_from=200&pr_to=100', repository: 'acme/payments', tab: 'search', login: '' });
    expect(reversed).toContain('pr_number:200..100');
    expect(() => parseQuery(reversed)).toThrow(/reversed/);
  });

  it('requires both M-number bounds before adding a range, and interops with the shared parser', () => {
    const both = buildRepositoryQuery({ serialized: 'base=main&mnum_from=42&mnum_to=980', repository: 'acme/payments', tab: 'search', login: '' });
    expect(both).toContain('mnum:42..980');
    expect(() => parseQuery(both)).not.toThrow();
    expect(buildRepositoryQuery({ serialized: 'base=main&mnum_from=42', repository: 'acme/payments', tab: 'search', login: '' })).not.toContain('mnum:');
    expect(buildRepositoryQuery({ serialized: 'base=main&mnum_to=980', repository: 'acme/payments', tab: 'search', login: '' })).not.toContain('mnum:');
  });

  it('adds the resolved SHA-range seq: filter only while its space matches the selected repo/base', () => {
    const matching = buildRepositoryQuery({ serialized: 'base=main', repository: 'acme/payments', tab: 'search', login: '', seqRange: { space: 'acme/payments@main', range: '120..980' } });
    expect(matching).toContain('seq:120..980');
    expect(() => parseQuery(matching)).not.toThrow();
    // Stale after switching base branch without re-resolving.
    expect(buildRepositoryQuery({ serialized: 'base=release/2.4', repository: 'acme/payments', tab: 'search', login: '', seqRange: { space: 'acme/payments@main', range: '120..980' } })).not.toContain('seq:');
    // Stale after switching repository without re-resolving.
    expect(buildRepositoryQuery({ serialized: 'base=main', repository: 'acme/other', tab: 'search', login: '', seqRange: { space: 'acme/payments@main', range: '120..980' } })).not.toContain('seq:');
  });

  it('defaults pull requests to PR number descending and commits to sequence', () => {
    expect(repositorySort('search', null)).toBe('pr_number');
    expect(repositorySort('history', null)).toBe('merge_seq');
    expect(repositorySort('search', 'merged_at')).toBe('merged_at');
  });

  it('keeps the selected label when the narrowed facet omits it', () => {
    expect(repositoryLabelOptions('bug', [{ value: 'feature' }, { value: 'bug' }])).toEqual([
      { value: '', label: 'All labels' }, { value: 'bug', label: 'bug' }, { value: 'feature', label: 'feature' },
    ]);
  });
});

describe('merge-order range from two resolved commits (CR-106)', () => {
  const SPACE = 'acme/payments@main';
  const commit = (merge_seq: number | null, sequence_space: string | null): SeqRangeCandidate => ({ kind: 'commit', merge_seq, sequence_space });
  const pr = (merge_seq: number | null, sequence_space: string | null): SeqRangeCandidate => ({ kind: 'pull_request', merge_seq, sequence_space });

  it('builds seq:min..max when both commits share the selected space and are already in order', () => {
    expect(buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [commit(120, SPACE)], toCandidates: [commit(980, SPACE)] }))
      .toEqual({ kind: 'ok', space: SPACE, range: '120..980' });
  });

  it('allows the same commit on both ends as a single-point range', () => {
    expect(buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [commit(120, SPACE)], toCandidates: [commit(120, SPACE)] }))
      .toEqual({ kind: 'ok', space: SPACE, range: '120..120' });
  });

  it('ignores pull_request candidates mixed into the resolve response and reads only the commit candidate', () => {
    expect(buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [pr(1, SPACE), commit(120, SPACE)], toCandidates: [commit(980, SPACE)] }))
      .toEqual({ kind: 'ok', space: SPACE, range: '120..980' });
  });

  it('errors when a SHA resolves to zero or more than one commit', () => {
    expect(buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [], toCandidates: [commit(980, SPACE)] }).kind).toBe('error');
    expect(buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [commit(1, SPACE), commit(2, SPACE)], toCandidates: [commit(980, SPACE)] }).kind).toBe('error');
  });

  it('errors when a resolved commit has no merge sequence number yet', () => {
    expect(buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [commit(null, SPACE)], toCandidates: [commit(980, SPACE)] }).kind).toBe('error');
  });

  it('errors when the two commits are in different sequence spaces from each other', () => {
    expect(buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [commit(120, SPACE)], toCandidates: [commit(980, 'acme/payments@release')] }).kind).toBe('error');
  });

  it('errors when the commits agree with each other but not with the currently selected repository/base', () => {
    expect(buildShaRangeFilter({ repository: 'acme/other', base: 'main', fromCandidates: [commit(120, SPACE)], toCandidates: [commit(980, SPACE)] }).kind).toBe('error');
  });

  it('errors on a reversed pair instead of silently swapping the bounds', () => {
    const outcome = buildShaRangeFilter({ repository: 'acme/payments', base: 'main', fromCandidates: [commit(980, SPACE)], toCandidates: [commit(120, SPACE)] });
    if (outcome.kind !== 'error') throw new Error('expected a reversed-order error');
    expect(outcome.message).toMatch(/order/i);
  });
});
