/**
 * Source API reads without React (CR-132): the browser components and the analysis worker share these.
 *
 * `loadFileText` follows the file windows (`offset` → `next_offset`) to the end of the file, so a file larger than one
 * response is still read completely. Every request carries the caller's signal: closing a dialog, switching the
 * repository or cancelling an analysis stops the remaining windows.
 *
 * CR-138: a rate limit (429, with the server's `Retry-After`) or a temporary upstream failure (502, 503 other than a
 * missing GitHub App permission, a dropped connection) is tried again at the same position a few times before it
 * fails, and a failed read keeps what it already read so that Retry continues from there.
 */
import type { SourceFile } from '@prs/contracts';
import { serviceMessage } from './service-message';

export type SourceOperation = 'tree' | 'history' | 'file' | 'diff' | 'paths';

export function sourceUrl(repository: string, operation: SourceOperation, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `/api/source/${encodeURIComponent(repository)}/${operation}?${params}`;
}

/** A source request the server answered with an error: its status, the service code and, when it said so, how long to wait. */
export class SourceRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly retryAfterMs: number | null;
  constructor(message: string, status: number, code: string | undefined, retryAfterMs: number | null) {
    super(message);
    this.name = 'SourceRequestError';
    this.status = status; this.code = code; this.retryAfterMs = retryAfterMs;
  }
}

function retryAfter(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function fetchSource<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  const body = await response.json() as T & { error?: { message?: string; code?: string } };
  if (!response.ok) {
    const message = response.status === 401 ? 'Your session expired. Sign in again to continue.' : serviceMessage(body.error?.message, response.status === 404 ? 'Source browsing is unavailable for this repository or revision.' : 'Unable to load source. Try again.', body.error?.code);
    throw new SourceRequestError(message, response.status, body.error?.code, retryAfter(response.headers.get('retry-after')));
  }
  return body;
}

/** Whether a failed request may succeed if sent again unchanged: rate limit, temporary upstream failure, lost connection. */
export function isTransient(error: unknown): boolean {
  if (error instanceof SourceRequestError) return error.status === 429 || error.status === 502 || (error.status === 503 && error.code !== 'SOURCE_PERMISSION_REQUIRED');
  return error instanceof TypeError; // fetch rejects with a TypeError when the connection fails
}

export interface RetryPolicy {
  /** Tries of one request, the first included. Default 4. */
  readonly attempts?: number;
  /** Longest single wait. A longer `Retry-After` fails at once instead (the page offers to continue later). Default 60 s. */
  readonly maxWaitMs?: number;
  /** Told before each wait, so a view can say that it is waiting and why. */
  readonly onWait?: (ms: number, error: unknown) => void;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const stop = (): void => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** `fetchSource` that waits and asks again at the same position when the failure is transient (bounded). */
export async function fetchSourceRetrying<T>(url: string, signal: AbortSignal, policy: RetryPolicy = {}): Promise<T> {
  const attempts = policy.attempts ?? 4;
  const maxWaitMs = policy.maxWaitMs ?? 60_000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchSource<T>(url, signal);
    } catch (error) {
      if (signal.aborted || !isTransient(error) || attempt >= attempts) throw error;
      const wait = error instanceof SourceRequestError && error.retryAfterMs !== null ? error.retryAfterMs : 1000 * 2 ** (attempt - 1);
      if (wait > maxWaitMs) throw error;
      policy.onWait?.(wait, error);
      await pause(wait, signal);
    }
  }
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
/** What a read that stopped had already read: the windows before `offset`, pinned to one blob. */
export interface PartialFile { readonly offset: number; readonly parts: readonly string[]; readonly sha: string | null; readonly size: number | null }

/** A file read that failed part way. `partial` continues it (`loadFileText(…, { resume: partial })`). */
export class PartialReadError extends Error {
  readonly partial: PartialFile;
  readonly reason: unknown;
  constructor(reason: unknown, partial: PartialFile) {
    super(reason instanceof Error && reason.message ? reason.message : 'The file could not be read to its end. Try again.');
    // A cancel stays a cancel (callers tell it apart by name); anything else is a failure that can be continued.
    this.name = reason instanceof Error && reason.name === 'AbortError' ? 'AbortError' : 'PartialReadError';
    this.partial = partial; this.reason = reason;
  }
}

/**
 * Reads a file at a pinned revision to its end, one window at a time. A later window that turns out not to be text
 * (for example a NUL byte past the first megabyte) makes the whole file non-text: the partial text is dropped rather
 * than shown as if it were complete. Every window must belong to the same blob; a read that fails part way throws a
 * `PartialReadError` whose `partial` continues from the failed window.
 */
export async function loadFileText(repository: string, path: string, revision: string, options: { readonly signal: AbortSignal; readonly onProgress?: (progress: FileProgress) => void; readonly retry?: RetryPolicy; readonly resume?: PartialFile }): Promise<LoadedFile> {
  const parts: string[] = [...(options.resume?.parts ?? [])];
  let offset = options.resume?.offset ?? 0;
  let pinned = options.resume && options.resume.offset > 0 ? { sha: options.resume.sha, size: options.resume.size } : null;
  for (let windows = 0; ; windows += 1) {
    let window: SourceFile;
    try {
      window = await fetchSourceRetrying<SourceFile>(sourceUrl(repository, 'file', { path, revision, offset }), options.signal, options.retry);
    } catch (error) {
      throw new PartialReadError(error, { offset, parts, sha: pinned?.sha ?? null, size: pinned?.size ?? null });
    }
    if (window.status !== 'text') return { status: window.status, text: null, size: window.size, sha: window.sha, reason: window.reason };
    if (pinned === null) pinned = { sha: window.sha, size: window.size };
    else if (window.sha !== pinned.sha || window.size !== pinned.size) throw new Error('The file changed while it was read. Try again.');
    parts.push(window.text ?? '');
    // A response without the key (a server older than CR-138 answers only complete bodies) ends the file: never loop on it.
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
