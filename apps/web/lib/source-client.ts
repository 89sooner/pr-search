/**
 * Source API reads without React (CR-132): the browser components and the analysis worker share these.
 *
 * `loadFileText` follows the file windows (`offset` → `next_offset`) to the end of the file, so a file larger than one
 * response is still read completely. Every request carries the caller's signal: closing a dialog, switching the
 * repository or cancelling an analysis stops the remaining windows.
 */
import type { SourceFile } from '@prs/contracts';
import { serviceMessage } from './service-message';

export type SourceOperation = 'tree' | 'history' | 'file' | 'diff';

export function sourceUrl(repository: string, operation: SourceOperation, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `/api/source/${encodeURIComponent(repository)}/${operation}?${params}`;
}

export async function fetchSource<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  const body = await response.json() as T & { error?: { message?: string; code?: string } };
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again to continue.' : serviceMessage(body.error?.message, response.status === 404 ? 'Source browsing is unavailable for this repository or revision.' : 'Unable to load source. Try again.', body.error?.code));
  return body;
}

export interface FileProgress { readonly loaded: number; readonly total: number | null }
/** A whole file: its status, and for text files the complete text joined from every window. */
export interface LoadedFile {
  readonly status: SourceFile['status'];
  readonly text: string | null;
  readonly size: number | null;
  readonly sha: string | null;
  readonly reason: string | null;
}

/**
 * Reads a file at a pinned revision to its end, one window at a time. A later window that turns out not to be text
 * (for example a NUL byte past the first megabyte) makes the whole file non-text: the partial text is dropped rather
 * than shown as if it were complete.
 */
export async function loadFileText(repository: string, path: string, revision: string, options: { readonly signal: AbortSignal; readonly onProgress?: (progress: FileProgress) => void }): Promise<LoadedFile> {
  const parts: string[] = [];
  let offset = 0;
  for (let windows = 0; ; windows += 1) {
    const window = await fetchSource<SourceFile>(sourceUrl(repository, 'file', { path, revision, offset }), options.signal);
    if (window.status !== 'text') return { status: window.status, text: null, size: window.size, sha: window.sha, reason: window.reason };
    parts.push(window.text ?? '');
    const next = window.next_offset ?? null;
    options.onProgress?.({ loaded: next ?? window.size ?? 0, total: window.size });
    if (next === null) return { status: 'text', text: parts.join(''), size: window.size, sha: window.sha, reason: null };
    // The server always moves forward; a window that does not is a protocol error, not a reason to loop.
    if (next <= offset || windows > 100_000) throw new Error('The file could not be read to its end. Try again.');
    offset = next;
  }
}

/** "3.1 MB" style sizes for progress captions. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
