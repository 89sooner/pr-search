/**
 * The complete changed-file list of a pull request or commit (CR-138), built page by page.
 *
 * GitHub lists at most 3,000 changed files (100 per page, 30 pages). Its pages come first — they carry line counts and
 * renames. When the last page says the list may be cut (`truncated`), the rest comes from comparing the two pinned trees
 * (`listing=tree`), which knows paths and statuses only. A tree-comparison path already in GitHub's list — as a path, or
 * as the previous path of a rename — is not added again; the others are added with unknown (`null`) line counts. Nothing
 * is guessed: a rename seen only by the tree comparison stays a removal and an addition.
 */
import type { SourceChange } from '@prs/contracts';

export interface ChangedFileList {
  readonly files: readonly SourceChange[];
  /** Paths from GitHub's list (a later page never repeats one). */
  readonly listed: ReadonlySet<string>;
  /** Paths a tree comparison must not add again: GitHub's paths and the previous paths of its renames. */
  readonly covered: ReadonlySet<string>;
}

export const EMPTY_CHANGED_FILES: ChangedFileList = { files: [], listed: new Set(), covered: new Set() };

/** Adds one page of GitHub's own list. */
export function addListedFiles(list: ChangedFileList, page: readonly SourceChange[]): ChangedFileList {
  const listed = new Set(list.listed); const covered = new Set(list.covered); const added: SourceChange[] = [];
  for (const file of page) {
    if (listed.has(file.path)) continue;
    listed.add(file.path); covered.add(file.path);
    if (file.previous_path) covered.add(file.previous_path);
    added.push(file);
  }
  return added.length === 0 ? list : { files: [...list.files, ...added], listed, covered };
}

/** Adds one page of the tree comparison: only the paths GitHub's list did not cover. */
export function addComparedFiles(list: ChangedFileList, page: readonly SourceChange[]): ChangedFileList {
  const covered = new Set(list.covered); const added: SourceChange[] = [];
  for (const file of page) {
    if (covered.has(file.path)) continue;
    covered.add(file.path);
    added.push({ ...file, previous_path: null, additions: null, deletions: null });
  }
  return added.length === 0 ? list : { files: [...list.files, ...added], listed: list.listed, covered };
}
