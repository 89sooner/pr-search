/**
 * Files & folders search over one pinned revision (CR-133).
 *
 * The file list (every file path at the revision, from API-SRC-005) is read once and filtered in memory: a
 * case-insensitive substring of the whole root-relative path, so both a file name ("config.h") and a path
 * ("src/a/config") match. Every path is its own result — two files with the same name or the same content are never
 * merged. Nothing is stored beyond the page's memory.
 */
import type { SourcePathEntry, SourcePaths } from '@prs/contracts';
import { fetchSourceRetrying, sourceUrl } from './source-client';

export interface PathMatch {
  readonly entry: SourcePathEntry;
  /** The last path segment. */
  readonly name: string;
  /** Everything before the last '/', or '' for a root file. */
  readonly parent: string;
}

export interface PathMatches {
  /** Matches to render, file-name matches first, then path matches; each group keeps the list order. */
  readonly matches: readonly PathMatch[];
  /** All matches, including those beyond `limit`. */
  readonly total: number;
}

/** The paths read so far, with lower-cased copies so that each search only compares. */
export interface PathList {
  readonly entries: readonly SourcePathEntry[];
  readonly lower: readonly string[];
}

export const EMPTY_PATH_LIST: PathList = { entries: [], lower: [] };

export function appendPaths(list: PathList, page: readonly SourcePathEntry[]): PathList {
  if (page.length === 0) return list;
  return { entries: [...list.entries, ...page], lower: [...list.lower, ...page.map((entry) => entry.path.toLowerCase())] };
}

export function splitPath(path: string): { name: string; parent: string } {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? { name: path, parent: '' } : { name: path.slice(slash + 1), parent: path.slice(0, slash) };
}

/**
 * Matches of `query` in `list`, at most `limit` of them; `total` counts all. Leading and trailing spaces are ignored and a
 * blank query matches nothing (the tree is shown instead).
 */
export function matchPaths(list: PathList, query: string, limit: number): PathMatches {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { matches: [], total: 0 };
  const byName: PathMatch[] = [];
  const byPath: PathMatch[] = [];
  let total = 0;
  for (let index = 0; index < list.entries.length; index += 1) {
    const lower = list.lower[index]!;
    if (!lower.includes(needle)) continue;
    total += 1;
    if (byName.length >= limit && byPath.length >= limit) continue;
    // Lower-casing never adds or removes '/', so the last segment of `lower` is the lower-cased file name.
    const inName = lower.indexOf(needle, lower.lastIndexOf('/') + 1) >= 0;
    const group = inName ? byName : byPath;
    if (group.length >= limit) continue;
    const entry = list.entries[index]!;
    group.push({ entry, ...splitPath(entry.path) });
  }
  return { matches: [...byName, ...byPath].slice(0, limit), total };
}

/**
 * Reads the file paths of a pinned revision page by page, from `after` (`null` = from the start) until the server
 * reports no more (`next_after: null`). A page can be small or even empty while `next_after` moves on — the server ends a
 * walking page after a number of directories — so only `next_after` decides the end. Each page goes to `onPage` as it
 * arrives, and the caller's signal stops the remaining pages.
 */
export async function loadPaths(repository: string, revision: string, options: { readonly signal: AbortSignal; readonly after?: string | null; readonly onPage: (page: SourcePaths) => void }): Promise<void> {
  let after = options.after ?? null;
  for (let pages = 0; ; pages += 1) {
    // CR-138: a rate limit or a temporary upstream failure waits and asks again for the same page.
    const page = await fetchSourceRetrying<SourcePaths>(sourceUrl(repository, 'paths', { revision, after: after ?? undefined }), options.signal);
    if (page.revision !== revision) throw new Error('The file list belongs to another revision. Try again.');
    // The server always moves forward; a cursor that does not is a protocol error, not a reason to loop.
    if (page.next_after !== null && (page.next_after === after || pages > 100_000)) throw new Error('The file list could not be read to its end. Try again.');
    options.onPage(page);
    if (page.next_after === null) return;
    after = page.next_after;
  }
}
