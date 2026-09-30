/**
 * CR-133 / WP-114: the Files & folders search looks through every file path of the pinned revision, not only the root
 * entries.
 *
 * `fetch` is a fake source API: the root tree and `/paths` pages (optionally held open so that a test can see the
 * listing in progress, cancel it and continue).
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourcePathEntry } from '@prs/contracts';

const { SourceTree } = await import('../components/source/SourceTree');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } });
  return results.violations;
}
const REPO = 'acme/payments';
const HEAD = 'a'.repeat(40); const OTHER = 'b'.repeat(40); const TREE = 'c'.repeat(40);
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const file = (path: string): SourcePathEntry => ({ path, kind: 'file' });
/** In path order, as the server sends them. */
const PATHS: SourcePathEntry[] = [
  file('README.md'), file('deep/l1/l2/l3/leaf.c'), file('src/a/config.h'), file('src/a/main.c'), file('src/b/config.h'),
  { path: 'src/link', kind: 'symlink' }, file('tests/config.h'), file('tests/run.sh'),
];

interface Api { paths?: SourcePathEntry[]; pageSize?: number; incomplete?: boolean; holdAfterFirst?: boolean; failOnce?: string; transientOnce?: string }
/** Directory listings of the fake tree, by path ('' = root). */
const DIRECTORIES: Record<string, readonly (readonly [string, string])[]> = {
  '': [['deep', 'directory'], ['src', 'directory'], ['tests', 'directory'], ['README.md', 'file']],
  src: [['a', 'directory'], ['b', 'directory'], ['link', 'symlink']],
  'src/b': [['config.h', 'file']],
};
/** Records every URL. Tree: `DIRECTORIES` (other folders are empty). `/paths`: `pageSize` paths per page. */
function stubApi(api: Api) {
  const calls: string[] = [];
  const state = { revision: HEAD, held: [] as (() => void)[], aborted: 0, failOnce: api.failOnce, transientOnce: api.transientOnce };
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    calls.push(input);
    const url = new URL(input, 'http://localhost');
    const op = url.pathname.split('/').at(-1);
    const query = url.searchParams;
    if (op === 'tree') {
      const at = query.get('path') ?? '';
      const entries = (DIRECTORIES[at] ?? []).map(([name, kind]) => ({ path: at === '' ? name : `${at}/${name}`, name, sha: TREE, kind, size: kind === 'file' ? 10 : null }));
      return ok({ repository: REPO, ref: 'main', revision: state.revision, path: at, entries, truncated: false, tree_sha: TREE, offset: 0, next_offset: null, total: entries.length });
    }
    if (op === 'paths') {
      const all = api.paths ?? PATHS;
      const size = api.pageSize ?? 1_000_000;
      const after = query.get('after');
      const start = after === null ? 0 : all.findIndex((entry) => entry.path === after) + 1;
      const page = all.slice(start, start + size);
      const body = { repository: REPO, revision: query.get('revision'), paths: page, next_after: start + size < all.length ? page.at(-1)!.path : null, incomplete: api.incomplete ?? false };
      // A failure the page cannot wait out: GitHub asks to come back in an hour (CR-138 — a shorter wait is waited out).
      if (state.failOnce !== undefined && after === state.failOnce) {
        state.failOnce = undefined;
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'SOURCE_RATE_LIMITED', message: 'GitHub is rate limited. Try again later.' } }), { status: 429, headers: { 'retry-after': '3600' } }));
      }
      if (state.transientOnce !== undefined && after === state.transientOnce) {
        state.transientOnce = undefined;
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'SOURCE_UNAVAILABLE', message: 'Source data could not be loaded from GitHub. Please retry.' } }), { status: 502 }));
      }
      if (api.holdAfterFirst && after !== null) {
        return new Promise<Response>((resolve, reject) => {
          state.held.push(() => { resolve(new Response(JSON.stringify(body), { status: 200 })); });
          init?.signal?.addEventListener('abort', () => { state.aborted += 1; reject(new DOMException('aborted', 'AbortError')); });
        });
      }
      return ok(body);
    }
    return ok({});
  });
  return { calls, state, pathCalls: () => calls.filter((call) => call.includes('/paths?')).map((call) => new URL(call, 'http://localhost').searchParams) };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function view(onSelect: (selection: { path: string; kind: 'file' | 'directory'; revision: string }) => void = () => undefined, selectedPath = '') {
  return render(<SourceTree repository={REPO} branch="main" selectedPath={selectedPath} onSelect={onSelect} />);
}
const searchBox = () => screen.getByPlaceholderText('Search files in this revision…');
/** The result buttons (not the "Show more matches" button at the end of the list, CR-138). */
const results = () => within(screen.getByRole('list', { name: 'Matching files' })).queryAllByRole('button').filter((button) => button.classList.contains('source-search-result'));

describe('CR-133 FR-SRC-001 Files & folders searches every path of the pinned revision', () => {
  it('FR-SRC-001 finds deep files and every file with the same name without opening a folder, reading the list once', async () => {
    const { calls, pathCalls } = stubApi({});
    const user = userEvent.setup();
    const { container } = view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config.h');
    expect(await screen.findByText('3 matches')).toBeInTheDocument();
    expect(results().map((button) => button.textContent)).toEqual(['config.hsrc/a', 'config.hsrc/b', 'config.htests']);
    expect(results().map((button) => button.getAttribute('title'))).toEqual(['src/a/config.h', 'src/b/config.h', 'tests/config.h']);
    // The tree is hidden while searching, and no folder was listed to find these.
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.includes('tree_sha='))).toEqual([]);
    await user.clear(searchBox());
    await user.type(searchBox(), 'leaf');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(results()[0]).toHaveAttribute('title', 'deep/l1/l2/l3/leaf.c');
    await user.type(searchBox(), 'x');
    expect(await screen.findByText('No files in this revision match "leafx".')).toBeInTheDocument();
    // Typing filters the list in memory: one /paths read for the whole session, pinned to the tree's revision.
    expect(pathCalls().map((params) => [params.get('revision'), params.get('after')])).toEqual([[HEAD, null]]);
    expect(await violations(container)).toEqual([]);
  });

  it('FR-SRC-001 a result selects that exact file at the pinned revision, by mouse or keyboard', async () => {
    stubApi({});
    const onSelect = vi.fn();
    const user = userEvent.setup();
    view(onSelect);
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config');
    await screen.findByText('3 matches');
    await user.click(results()[1]!);
    expect(onSelect).toHaveBeenLastCalledWith({ path: 'src/b/config.h', kind: 'file', revision: HEAD });
    searchBox().focus();
    await user.keyboard('{ArrowDown}');
    expect(results()[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith({ path: 'tests/config.h', kind: 'file', revision: HEAD });
    await user.keyboard('{Home}');
    expect(results()[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(searchBox()).toHaveFocus();
    await user.clear(searchBox());
    await user.type(searchBox(), 'src/link');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(results()[0]).toHaveTextContent('link');
    await user.click(results()[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ path: 'src/link', kind: 'file', revision: HEAD });
  });

  it('FR-SRC-001 never says "no files match" before the whole list is read; Cancel stops the reading and Continue picks it up', async () => {
    const { state, pathCalls } = stubApi({ pageSize: 3, holdAfterFirst: true });
    const user = userEvent.setup();
    const { container } = view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'zzz');
    expect(await screen.findByText(/Listing files… 3 paths · 0 matches so far/)).toBeInTheDocument();
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/Listing stopped after 3 paths · 0 matches so far, so the results may be incomplete\./)).toBeInTheDocument();
    expect(state.aborted).toBe(1);
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue listing' }));
    // Continue asks for the page after the last path read, not from the start.
    await waitFor(() => { expect(pathCalls().map((params) => params.get('after'))).toEqual([null, 'src/a/config.h', 'src/a/config.h']); });
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    for (let round = 0; round < 5 && !screen.queryByText(/No files in this revision match/); round += 1) {
      state.held.splice(0).forEach((release) => { release(); });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await screen.findByText('No files in this revision match "zzz".')).toBeInTheDocument();
    expect(pathCalls().at(-1)?.get('after')).toBe('src/link');
  });

  it('FR-SRC-001 clearing the search brings the tree back; a new revision discards the list and reads it again', async () => {
    const { state, pathCalls } = stubApi({});
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'readme');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    await user.clear(searchBox());
    expect(await screen.findByRole('tree', { name: 'Files and folders' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Matching files' })).not.toBeInTheDocument();
    await user.type(searchBox(), 'readme');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(pathCalls()).toHaveLength(1);
    state.revision = OTHER;
    await user.click(screen.getByRole('button', { name: 'Refresh file tree' }));
    await waitFor(() => { expect(pathCalls().map((params) => params.get('revision'))).toEqual([HEAD, OTHER]); });
    expect(await screen.findByText('1 match')).toBeInTheDocument();
  });

  it('CR-138 FR-SRC-001 draws 200 results at a time, says how many there are, draws the rest on request (or scroll), and names a partial GitHub listing', async () => {
    stubApi({ paths: Array.from({ length: 250 }, (_, index) => file(`mod/m${String(index).padStart(3, '0')}.ts`)), incomplete: true });
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'mod');
    expect(await screen.findByText('250 matches · showing 200, more as you scroll')).toBeInTheDocument();
    expect(results()).toHaveLength(200);
    await user.click(screen.getByRole('button', { name: 'Show more matches (200 of 250)' }));
    expect(await screen.findByText('250 matches')).toBeInTheDocument();
    expect(results()).toHaveLength(250);
    expect(results().at(-1)).toHaveAttribute('title', 'mod/m249.ts');
    expect(screen.queryByRole('button', { name: /Show more matches/ })).not.toBeInTheDocument();
    expect(screen.getByText('GitHub returned a partial listing for a directory, so some files may be missing.')).toBeInTheDocument();
  });

  it('FR-SRC-001 an error keeps the paths read so far and Retry continues from there', async () => {
    const { pathCalls } = stubApi({ pageSize: 3, failOnce: 'src/a/config.h' });
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('GitHub is rate limited. Try again later.');
    expect(screen.queryByText(/No files in this revision match/)).not.toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('3 matches')).toBeInTheDocument();
    expect(pathCalls().map((params) => params.get('after'))).toEqual([null, 'src/a/config.h', 'src/a/config.h', 'src/link']);
  });

  it('CR-138 FR-SRC-001 a temporary GitHub failure is asked again for the same page by itself — no error, nothing read twice', async () => {
    const { pathCalls } = stubApi({ pageSize: 3, transientOnce: 'src/a/config.h' });
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config');
    expect(await screen.findByText('3 matches', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pathCalls().map((params) => params.get('after'))).toEqual([null, 'src/a/config.h', 'src/a/config.h', 'src/link']);
  });

  it('FR-SRC-001 a new search after a failed listing continues it once instead of showing the old failure', async () => {
    const { pathCalls } = stubApi({ pageSize: 3, failOnce: 'src/a/config.h' });
    const user = userEvent.setup();
    view();
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config');
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub is rate limited. Try again later.');
    await user.clear(searchBox());
    await user.type(searchBox(), 'main');
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(results()[0]).toHaveAttribute('title', 'src/a/main.c');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pathCalls().map((params) => params.get('after'))).toEqual([null, 'src/a/config.h', 'src/a/config.h', 'src/link']);
  });

  it('FR-SRC-001 after a result is chosen, clearing the search shows the tree opened down to that file and selected', async () => {
    stubApi({});
    const user = userEvent.setup();
    // The workspace keeps the selection (URL `path`); here a small parent does the same.
    function Workspace() {
      const [selected, setSelected] = useState('');
      return <SourceTree repository={REPO} branch="main" selectedPath={selected} onSelect={(selection) => { setSelected(selection.path); }} />;
    }
    render(<Workspace />);
    await screen.findByRole('treeitem', { name: 'src' });
    await user.type(searchBox(), 'config.h');
    await screen.findByText('3 matches');
    await user.click(results()[1]!);
    expect(results()[1]).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{Escape}');
    expect(searchBox()).toHaveValue('');
    const item = await screen.findByRole('treeitem', { name: 'config.h', selected: true });
    expect(item).toHaveAttribute('data-path', 'src/b/config.h');
    expect(screen.getByRole('treeitem', { name: 'src' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'b' })).toHaveAttribute('aria-expanded', 'true');
  });
});
