import { describe, expect, it } from 'vitest';
import type { SourceChange } from '@prs/contracts';
import { EMPTY_CHANGED_FILES, addComparedFiles, addListedFiles } from './source-changes';

const listed = (path: string, extra: Partial<SourceChange> = {}): SourceChange => ({ path, previous_path: null, status: 'modified', additions: 1, deletions: 1, ...extra });
const compared = (path: string, status = 'added'): SourceChange => ({ path, previous_path: null, status, additions: null, deletions: null });

describe('CR-138 FR-SRC-003 the complete changed-file list: GitHub pages first, then the tree comparison for the rest', () => {
  it('CR-138 FR-SRC-003 GitHub pages keep their counts and renames; a path repeated on a later page is not listed twice', () => {
    let list = addListedFiles(EMPTY_CHANGED_FILES, [listed('a.c'), listed('new.c', { previous_path: 'old.c', status: 'renamed' })]);
    list = addListedFiles(list, [listed('a.c'), listed('b.c')]);
    expect(list.files.map((file) => file.path)).toEqual(['a.c', 'new.c', 'b.c']);
    expect(list.files[1]).toMatchObject({ previous_path: 'old.c', additions: 1 });
  });

  it('CR-138 FR-SRC-003 the tree comparison adds only what GitHub did not list — never a rename source again — with unknown line counts', () => {
    let list = addListedFiles(EMPTY_CHANGED_FILES, [listed('a.c'), listed('new.c', { previous_path: 'old.c', status: 'renamed' })]);
    // The tree comparison sees the rename as a removal and an addition, and knows the files GitHub stopped listing.
    list = addComparedFiles(list, [compared('a.c', 'modified'), compared('new.c'), compared('old.c', 'removed'), compared('z1.c')]);
    list = addComparedFiles(list, [compared('z1.c'), compared('z2.c', 'removed')]);
    expect(list.files.map((file) => [file.path, file.status, file.additions])).toEqual([
      ['a.c', 'modified', 1], ['new.c', 'renamed', 1], ['z1.c', 'added', null], ['z2.c', 'removed', null],
    ]);
  });

  it('CR-138 FR-SRC-003 a path reused after a rename is listed on its own when GitHub lists it', () => {
    let list = addListedFiles(EMPTY_CHANGED_FILES, [listed('new.c', { previous_path: 'old.c', status: 'renamed' })]);
    list = addListedFiles(list, [listed('old.c', { status: 'added' })]);
    expect(list.files.map((file) => file.path)).toEqual(['new.c', 'old.c']);
    list = addComparedFiles(list, [compared('old.c')]);
    expect(list.files).toHaveLength(2);
  });

  it('CR-138 FR-SRC-003 3,000 listed files and 2,200 more from the tree comparison make 5,200 distinct paths', () => {
    const all = Array.from({ length: 5200 }, (_, i) => `pkg/f${String(i).padStart(4, '0')}.c`);
    let list = EMPTY_CHANGED_FILES;
    for (let page = 0; page < 30; page++) list = addListedFiles(list, all.slice(page * 100, page * 100 + 100).map((path) => listed(path)));
    for (let page = 0; page * 1000 < all.length; page++) list = addComparedFiles(list, all.slice(page * 1000, page * 1000 + 1000).map((path) => compared(path)));
    expect(list.files).toHaveLength(5200);
    expect(new Set(list.files.map((file) => file.path)).size).toBe(5200);
    expect(list.files.filter((file) => file.additions === null)).toHaveLength(2200);
  });
});
