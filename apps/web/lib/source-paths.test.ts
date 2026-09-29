import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourcePathEntry, SourcePaths } from '@prs/contracts';
import { EMPTY_PATH_LIST, appendPaths, loadPaths, matchPaths, splitPath } from './source-paths';

const REVISION = 'a'.repeat(40);
const list = (...paths: string[]) => appendPaths(EMPTY_PATH_LIST, paths.map((path): SourcePathEntry => ({ path, kind: 'file' })));

describe('CR-133 FR-SRC-001 matchPaths — search over the whole path of one revision', () => {
  it('FR-SRC-001 finds a file name in every folder as a separate result, with its parent path beside the name', () => {
    const found = matchPaths(list('src/a/config.h', 'src/b/config.h', 'tests/config.h', 'README.md'), 'config.h', 200);
    expect(found.total).toBe(3);
    expect(found.matches.map((match) => [match.name, match.parent])).toEqual([['config.h', 'src/a'], ['config.h', 'src/b'], ['config.h', 'tests']]);
  });

  it('FR-SRC-001 is a case-insensitive substring of the whole path, so a typed path matches too', () => {
    const paths = list('Src/App/Config.H', 'docs/src-notes.md', 'lib/app.ts');
    expect(matchPaths(paths, 'app/config', 200).matches.map((match) => match.entry.path)).toEqual(['Src/App/Config.H']);
    expect(matchPaths(paths, 'SRC', 200).total).toBe(2);
  });

  it('FR-SRC-001 lists file-name matches before path-only matches, each group in list order', () => {
    const found = matchPaths(list('lib/src/a.c', 'lib/src.c', 'src/b.c', 'z/src.h'), 'src', 200);
    expect(found.matches.map((match) => match.entry.path)).toEqual(['lib/src.c', 'z/src.h', 'lib/src/a.c', 'src/b.c']);
  });

  it('FR-SRC-001 counts every match but returns at most the limit', () => {
    const paths = list(...Array.from({ length: 500 }, (_, index) => `dir/f${String(index)}.txt`));
    const found = matchPaths(paths, 'f', 200);
    expect(found.total).toBe(500);
    expect(found.matches).toHaveLength(200);
    expect(found.matches[0]!.entry.path).toBe('dir/f0.txt');
  });

  it('FR-SRC-001 matches nothing for a blank query and ignores spaces around the query', () => {
    const paths = list('src/a/config.h');
    expect(matchPaths(paths, '', 200)).toEqual({ matches: [], total: 0 });
    expect(matchPaths(paths, '   ', 200)).toEqual({ matches: [], total: 0 });
    expect(matchPaths(paths, '  config.h ', 200).total).toBe(1);
  });

  it('splits a root file and a nested file into name and parent', () => {
    expect(splitPath('README.md')).toEqual({ name: 'README.md', parent: '' });
    expect(splitPath('a/b/c.txt')).toEqual({ name: 'c.txt', parent: 'a/b' });
  });
});

describe('CR-133 FR-SRC-001 loadPaths — pages until next_after is null', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  /** A fake /paths route: `pages` maps the requested cursor ('' = none) to the answer. */
  function stub(pages: Record<string, Partial<SourcePaths>>) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      calls.push(input);
      const after = new URL(input, 'http://localhost').searchParams.get('after') ?? '';
      const page = pages[after];
      if (page === undefined) return new Response(JSON.stringify({ error: { message: 'unexpected' } }), { status: 500 });
      return new Response(JSON.stringify({ repository: 'acme/app', revision: REVISION, paths: [], next_after: null, incomplete: false, ...page }), { status: 200 });
    });
    return calls;
  }
  const file = (path: string): SourcePathEntry => ({ path, kind: 'file' });

  it('FR-SRC-001 follows next_after through small and empty pages to the end', async () => {
    const calls = stub({ '': { paths: [file('a'), file('b')], next_after: 'b' }, b: { paths: [], next_after: 'c/x' }, 'c/x': { paths: [file('d')], next_after: null, incomplete: true } });
    const pages: SourcePaths[] = [];
    await loadPaths('acme/app', REVISION, { signal: new AbortController().signal, onPage: (page) => { pages.push(page); } });
    expect(pages.flatMap((page) => page.paths.map((entry) => entry.path))).toEqual(['a', 'b', 'd']);
    expect(pages.at(-1)?.incomplete).toBe(true);
    expect(calls.map((call) => new URL(call, 'http://localhost').searchParams.get('after'))).toEqual([null, 'b', 'c/x']);
    expect(calls.every((call) => call.startsWith('/api/source/acme%2Fapp/paths?') && new URL(call, 'http://localhost').searchParams.get('revision') === REVISION)).toBe(true);
  });

  it('FR-SRC-001 continues from a given cursor after a cancel', async () => {
    const calls = stub({ b: { paths: [file('d')], next_after: null } });
    const seen: string[] = [];
    await loadPaths('acme/app', REVISION, { signal: new AbortController().signal, after: 'b', onPage: (page) => { seen.push(...page.paths.map((entry) => entry.path)); } });
    expect(seen).toEqual(['d']);
    expect(new URL(calls[0]!, 'http://localhost').searchParams.get('after')).toBe('b');
  });

  it('FR-SRC-001 stops reading when the caller aborts', async () => {
    const calls = stub({ '': { paths: [file('a')], next_after: 'a' }, a: { paths: [file('b')], next_after: null } });
    const controller = new AbortController();
    await expect(loadPaths('acme/app', REVISION, { signal: controller.signal, onPage: () => { controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(1);
  });

  it('FR-SRC-001 refuses a cursor that does not move forward and a page of another revision', async () => {
    stub({ '': { paths: [file('a')], next_after: 'a' }, a: { paths: [], next_after: 'a' } });
    const pages: SourcePaths[] = [];
    await expect(loadPaths('acme/app', REVISION, { signal: new AbortController().signal, onPage: (page) => { pages.push(page); } })).rejects.toThrow('could not be read to its end');
    expect(pages).toHaveLength(1);
    stub({ '': { revision: 'b'.repeat(40), paths: [file('a')] } });
    await expect(loadPaths('acme/app', REVISION, { signal: new AbortController().signal, onPage: () => undefined })).rejects.toThrow('another revision');
  });
});
