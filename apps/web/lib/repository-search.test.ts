import { describe, expect, it } from 'vitest';
import { parseQuery } from '@prs/query';
import { buildRepositoryQuery, repositoryLabelOptions, repositorySort } from './repository-search';

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
