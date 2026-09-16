import { describe, expect, it } from 'vitest';
import { compareLines, lines, traceLines, wordChanges } from './source-analysis';

describe('FR-SRC-003/004 source comparison and inferred lineage', () => {
  it('aligns insertion, removal, and replacement without losing source text', () => {
    const rows = compareLines('alpha\nbeta\ngamma\n', 'alpha\nBETA\ngamma\ndelta\n')!;
    expect(rows.filter(row => row.kind === 'change')).toHaveLength(2);
    expect(rows.map(row => row.before?.text).filter(value => value !== undefined)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows.map(row => row.after?.text).filter(value => value !== undefined)).toEqual(['alpha', 'BETA', 'gamma', 'delta']);
    expect(compareLines('a\nb\n', '')!.every(row => row.after === null)).toBe(true);
    expect(compareLines('', '')).toEqual([]);
  });
  it('preserves blank lines and distinguishes a final newline', () => {
    expect(lines('a\r\n\r\nb\r\n')).toEqual(['a', '', 'b']);
    expect(compareLines('a', 'a\n')!.some(row => row.kind === 'change')).toBe(true);
  });
  it('word highlights preserve the actual old/new source', () => {
    expect(wordChanges('return 2;', 'return 3;', 'before').map(part => part.text).join('')).toBe('return 2;');
    expect(wordChanges('return 2;', 'return 3;', 'after').filter(part => part.changed).map(part => part.text).join('')).toBe('3');
  });
  it('follows shifted unchanged lines and records replacements across revisions', () => {
    const traced = traceLines([{ sha: 'a', text: 'header\nreturn 1;\n' }, { sha: 'b', text: '// note\nheader\nreturn 1;\n' }, { sha: 'c', text: '// note\nheader\nreturn 2;\n' }])!;
    expect(traced.get('c')?.[1]?.events.map(event => event.sha)).toEqual(['a']);
    expect(traced.get('c')?.[2]?.events.map(event => [event.sha, event.kind, event.text])).toEqual([['a', 'baseline', 'return 1;'], ['c', 'edited', 'return 2;']]);
    expect(traced.get('b')?.[0]?.events[0]?.kind).toBe('added');
  });
  it('does not attach deleted line lineage to a later re-addition', () => {
    const traced = traceLines([{ sha: 'a', text: 'old\n' }, { sha: 'b', text: '' }, { sha: 'c', text: 'new\n' }])!;
    expect(traced.get('c')?.[0]?.events).toEqual([{ sha: 'c', line: 1, text: 'new', kind: 'added' }]);
  });
});
