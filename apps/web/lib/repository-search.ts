export type RepositoryWorkspaceTab = 'search' | 'history' | 'open' | 'merged';
const quote = (value: string): string => JSON.stringify(value);

export function buildRepositoryQuery(input: { serialized: string; repository: string; tab: RepositoryWorkspaceTab; login: string }): string {
  const values = new URLSearchParams(input.serialized);
  const filters = [`kind:${input.tab === 'history' ? 'commit' : 'pull_request'}`, `repo:${quote(input.repository)}`];
  for (const key of ['base', 'author', 'label', 'path', 'state']) {
    const value = values.get(key);
    if (!value || (key === 'state' && (input.tab === 'open' || input.tab === 'merged')) || (key === 'author' && (input.tab === 'open' || input.tab === 'merged'))) continue;
    filters.push(key === 'state' ? `is:${value}` : `${key}:${quote(value)}`);
  }
  if (input.tab === 'open' || input.tab === 'merged') filters.push(`author:${quote(input.login)}`, `is:${input.tab}`);
  const from = values.get('from'); const to = values.get('to');
  if (from && to) filters.push(`merged:${from}..${to}`);
  const text = values.get('q')?.trim(); if (text) filters.push(text);
  return filters.join(' ');
}

export function repositorySort(tab: RepositoryWorkspaceTab, supplied: string | null): string {
  return supplied ?? (tab === 'history' ? 'merge_seq' : 'pr_number');
}

export function repositoryLabelOptions(current: string, facets: readonly { value: string }[]): { value: string; label: string }[] {
  const values = [current, ...facets.map(item => item.value)].filter(Boolean);
  return [{ value: '', label: 'All labels' }, ...[...new Set(values)].map(value => ({ value, label: value }))];
}
