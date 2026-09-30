'use client';
/**
 * CR-132 source dialog state: whole files read window by window, line diffs and Time-lapse lineage computed off the
 * main thread, and the visible slice of very long tables. Every piece of work is tied to an AbortController: a new
 * target, closing the dialog or pressing Cancel stops the reads and the computation that belong to the old one.
 *
 * CR-138: nothing here stops at a total. Lists read their next page by themselves (the changed files of a comparison to
 * the end, other lists when the reader scrolls to their end); a read or an analysis that stops keeps what it has and
 * continues from there; a temporary GitHub failure waits and tries again at the same position.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SourceChange, SourceComparison } from '@prs/contracts';
import { PartialReadError, fetchSourceRetrying, loadFileText, sourceUrl, type FileProgress, type LoadedFile, type PartialFile } from '../../lib/source-client';
import { EMPTY_CHANGED_FILES, addComparedFiles, addListedFiles, type ChangedFileList } from '../../lib/source-changes';
import { computeDiff, computeTrace, isAbortError } from '../../lib/source-compute-client';
import { TraceStoppedError, type DiffJobResult, type TraceJobInput, type TraceJobResult, type TracePartial, type TraceProgress } from '../../lib/source-jobs';

const message = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

export interface FileTextState {
  readonly file: LoadedFile | null;
  readonly loading: boolean;
  readonly progress: FileProgress | null;
  readonly error: string;
  readonly cancelled: boolean;
  /** While GitHub asks to wait before the next window: how long (ms). */
  readonly waitingMs: number | null;
}
const IDLE_FILE: FileTextState = { file: null, loading: false, progress: null, error: '', cancelled: false, waitingMs: null };

/**
 * The complete text of `path` at a pinned `revision` (all windows). `null` path or revision means "nothing to load".
 * A read that fails or is cancelled part way keeps its windows: `reload` continues from the first missing window.
 */
export function useFileText(repository: string, path: string | null, revision: string | null, delay = 0) {
  const key = path && revision ? `${repository}\n${revision}\n${path}` : null;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<FileTextState & { readonly key: string | null }>({ key: null, ...IDLE_FILE });
  const controller = useRef<AbortController | null>(null);
  const partial = useRef<{ key: string; file: PartialFile } | null>(null);
  useEffect(() => {
    if (key === null || !path || !revision) return;
    const abort = new AbortController();
    controller.current = abort;
    const resume = partial.current?.key === key ? partial.current.file : undefined;
    setState({ key, file: null, loading: true, progress: resume && resume.size !== null ? { loaded: resume.offset, total: resume.size } : null, error: '', cancelled: false, waitingMs: null });
    const update = (change: Partial<FileTextState>): void => { if (!abort.signal.aborted) setState((current) => (current.key === key ? { ...current, ...change } : current)); };
    const timer = setTimeout(() => {
      loadFileText(repository, path, revision, { signal: abort.signal, ...(resume ? { resume } : {}), onProgress: (progress) => { update({ progress, waitingMs: null }); }, retry: { onWait: (ms) => { update({ waitingMs: ms }); } } })
        .then((file) => { partial.current = null; if (!abort.signal.aborted) setState({ key, file, loading: false, progress: null, error: '', cancelled: false, waitingMs: null }); })
        .catch((error: unknown) => {
          if (error instanceof PartialReadError) partial.current = { key, file: error.partial };
          if (!abort.signal.aborted) setState({ key, file: null, loading: false, progress: null, error: message(error, 'Unable to load source.'), cancelled: false, waitingMs: null });
        });
    }, delay);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [key, nonce, delay, repository, path, revision]);
  const current: FileTextState = state.key === key ? state : { ...IDLE_FILE, loading: key !== null };
  const cancel = useCallback(() => {
    controller.current?.abort();
    setState((value) => (value.key === key && value.loading ? { ...value, loading: false, progress: null, cancelled: true, waitingMs: null } : value));
  }, [key]);
  const reload = useCallback(() => { setNonce((value) => value + 1); }, []);
  return { ...current, cancel, reload };
}

export interface LineDiffState {
  readonly result: DiffJobResult | null;
  readonly computing: boolean;
  readonly error: string;
  readonly cancelled: boolean;
}
/** The line diff of two texts (worker when available). `null` on either side means "not ready". */
export function useLineDiff(before: string | null, after: string | null) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<LineDiffState & { readonly before: string | null; readonly after: string | null; readonly nonce: number }>({ before: null, after: null, nonce: 0, result: null, computing: false, error: '', cancelled: false });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (before === null || after === null) return;
    const abort = new AbortController();
    controller.current = abort;
    setState({ before, after, nonce, result: null, computing: true, error: '', cancelled: false });
    computeDiff(before, after, abort.signal)
      .then((result) => { if (!abort.signal.aborted) setState({ before, after, nonce, result, computing: false, error: '', cancelled: false }); })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setState({ before, after, nonce, result: null, computing: false, error: isAbortError(error) ? '' : message(error, 'The comparison failed.'), cancelled: isAbortError(error) });
      });
    return () => { abort.abort(); };
  }, [before, after, nonce]);
  const current: LineDiffState = state.before === before && state.after === after && state.nonce === nonce
    ? state
    : { result: null, computing: before !== null && after !== null, error: '', cancelled: false };
  const cancel = useCallback(() => {
    controller.current?.abort();
    setState((value) => (value.computing ? { ...value, computing: false, cancelled: true } : value));
  }, []);
  const retry = useCallback(() => { setNonce((value) => value + 1); }, []);
  return { ...current, cancel, retry };
}

export interface TraceState {
  readonly running: boolean;
  readonly progress: TraceProgress | null;
  /** The last finished analysis and the range it covered. A cancelled or failed run keeps the previous result. */
  readonly result: (TraceJobResult & { readonly input: TraceJobInput }) | null;
  readonly error: string;
  readonly cancelled: boolean;
  /** CR-138: an analysis that stopped before its end — `resume` continues it from the next revision. */
  readonly stopped: { readonly input: TraceJobInput; readonly partial: TracePartial } | null;
}
export function useTrace() {
  const [state, setState] = useState<TraceState>({ running: false, progress: null, result: null, error: '', cancelled: false, stopped: null });
  const controller = useRef<AbortController | null>(null);
  const stopped = useRef<TraceState['stopped']>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const run = useCallback((input: TraceJobInput) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    stopped.current = null;
    const range = { repository: input.repository, path: input.path, revisions: input.revisions };
    const done = input.resume?.next ?? 0;
    setState((value) => ({ ...value, running: true, progress: { done, total: input.revisions.length, skipped: input.resume?.skipped.length ?? 0, loaded: done, waitingMs: null }, error: '', cancelled: false, stopped: null }));
    // A newer run replaces this one: its answers no longer apply.
    const current = (): boolean => controller.current === abort;
    computeTrace(input, abort.signal, (progress) => { if (current()) setState((value) => (value.running ? { ...value, progress } : value)); })
      .then((result) => { if (current()) setState((value) => ({ ...value, running: false, progress: null, result: { ...result, input: range }, error: '', cancelled: false, stopped: null })); })
      .catch((error: unknown) => {
        if (!current()) return;
        const partial = error instanceof TraceStoppedError ? error.partial : null;
        stopped.current = partial ? { input: range, partial } : null;
        setState((value) => ({ ...value, running: false, progress: null, error: isAbortError(error) ? '' : message(error, 'Line analysis failed.'), cancelled: isAbortError(error), stopped: stopped.current }));
      });
  }, []);
  const resume = useCallback(() => {
    const last = stopped.current;
    if (last !== null) run({ ...last.input, resume: last.partial });
  }, [run]);
  const cancel = useCallback(() => {
    // The job answers with what it analyzed so far (worker: within a short grace period); the state follows its answer.
    controller.current?.abort();
    setState((value) => (value.running ? { ...value, progress: value.progress ? { ...value.progress, waitingMs: null } : null } : value));
  }, []);
  return { ...state, run, resume, cancel };
}

export interface ChangedFilesState {
  /** The first page of GitHub's list: the compared revisions, the commit and related pull requests. */
  readonly comparison: SourceComparison | null;
  readonly files: readonly SourceChange[];
  /** `rest` while GitHub's pages are read, `tree` while the tree comparison continues it, `done` at the end. */
  readonly phase: 'rest' | 'tree' | 'done';
  readonly loading: boolean;
  readonly error: string;
  readonly cancelled: boolean;
  /** The pull request moved while its files were read: the list is abandoned, not mixed. */
  readonly changed: boolean;
  /** Some files came from the tree comparison (no line counts or renames). */
  readonly compared: boolean;
  /** GitHub truncated a directory listing during the tree comparison — files may still be missing. */
  readonly incomplete: boolean;
  readonly waitingMs: number | null;
}
type ChangesCursor = { readonly phase: 'rest'; readonly page: number } | { readonly phase: 'tree'; readonly after: string | null } | { readonly phase: 'done' };

/**
 * CR-138: every changed file of a pull request or commit, read to the end without buttons. GitHub's own pages come first;
 * when the last one says GitHub stopped at its 3,000-file limit (`truncated`), the two pinned trees are compared for the
 * rest (see lib/source-changes.ts). Every page must belong to the same base and head. Cancel keeps the files read so far
 * and `resume` continues from the next page; `reload` starts over.
 */
export function useChangedFiles(repository: string, target: { readonly pr?: number; readonly commit?: string } | null) {
  const key = target === null ? null : `${repository}\n${target.pr ?? ''}\n${target.commit ?? ''}`;
  const [nonce, setNonce] = useState(0);
  const [resumeNonce, setResumeNonce] = useState(0);
  const blank = (): ChangedFilesState => ({ comparison: null, files: [], phase: 'rest', loading: key !== null, error: '', cancelled: false, changed: false, compared: false, incomplete: false, waitingMs: null });
  const [state, setState] = useState<ChangedFilesState & { readonly key: string | null; readonly nonce: number }>({ key, nonce, ...blank() });
  /** The loader's own record of where it is — the rendered state is a copy of it. Reset when the target or `reload` changes. */
  const progress = useRef<{ key: string | null; nonce: number; cursor: ChangesCursor; list: ChangedFileList; comparison: SourceComparison | null; compared: boolean; incomplete: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (key === null || target === null) return;
    if (progress.current === null || progress.current.key !== key || progress.current.nonce !== nonce) {
      progress.current = { key, nonce, cursor: { phase: 'rest', page: 1 }, list: EMPTY_CHANGED_FILES, comparison: null, compared: false, incomplete: false };
    }
    const own = progress.current;
    if (own.cursor.phase === 'done') return;
    const abort = new AbortController();
    controller.current = abort;
    const publish = (change: Partial<ChangedFilesState> = {}): void => {
      if (abort.signal.aborted) return;
      setState({ key, nonce, comparison: own.comparison, files: own.list.files, phase: own.cursor.phase, compared: own.compared, incomplete: own.incomplete, loading: true, error: '', cancelled: false, changed: false, waitingMs: null, ...change });
    };
    const retry = { onWait: (ms: number) => { publish({ waitingMs: ms }); } };
    publish();
    void (async () => {
      try {
        while (own.cursor.phase !== 'done') {
          if (own.cursor.phase === 'rest') {
            const page: SourceComparison = await fetchSourceRetrying<SourceComparison>(sourceUrl(repository, 'diff', { pr: target.pr, commit: target.commit, page: own.cursor.page, related: target.commit ? 'all' : undefined }), abort.signal, retry);
            if (abort.signal.aborted) return;
            if (own.comparison !== null && (page.base !== own.comparison.base || page.head !== own.comparison.head)) { publish({ loading: false, changed: true, error: 'This pull request changed while its files were loading. Close and reopen the comparison.' }); return; }
            own.comparison ??= page;
            own.list = addListedFiles(own.list, page.files);
            own.cursor = page.next_page !== null ? { phase: 'rest', page: page.next_page } : page.truncated ? { phase: 'tree', after: null } : { phase: 'done' };
          } else {
            const pinned = own.comparison!;
            const page: SourceComparison = await fetchSourceRetrying<SourceComparison>(sourceUrl(repository, 'diff', { listing: 'tree', head: pinned.head, base: pinned.base ?? undefined, after: own.cursor.after ?? undefined }), abort.signal, retry);
            if (abort.signal.aborted) return;
            if (page.head !== pinned.head || page.base !== pinned.base) { publish({ loading: false, changed: true, error: 'The compared revisions changed. Close and reopen the comparison.' }); return; }
            own.list = addComparedFiles(own.list, page.files);
            own.compared = true;
            own.incomplete ||= page.truncated;
            own.cursor = page.next_after ? { phase: 'tree', after: page.next_after } : { phase: 'done' };
          }
          publish({ loading: own.cursor.phase !== 'done' });
        }
      } catch (error) {
        if (!abort.signal.aborted) publish({ loading: false, error: message(error, 'Unable to load the changed files.') });
      }
    })();
    return () => { abort.abort(); };
    // `target` is read through `key`, which names it.
  }, [key, nonce, resumeNonce, repository]);
  const current: ChangedFilesState = state.key === key && state.nonce === nonce ? state : blank();
  const cancel = useCallback(() => { controller.current?.abort(); setState((value) => (value.loading ? { ...value, loading: false, cancelled: true, waitingMs: null } : value)); }, []);
  const resume = useCallback(() => { setResumeNonce((value) => value + 1); }, []);
  const reload = useCallback(() => { setNonce((value) => value + 1); }, []);
  return { ...current, cancel, resume, reload };
}

/**
 * Calls `onVisible` when `target` scrolls into view while `enabled` (CR-138 — the next page of a list loads when the
 * reader reaches its end). Without IntersectionObserver (old browsers, tests) nothing happens and the list keeps its
 * button.
 */
export function useAutoLoad(target: RefObject<HTMLElement | null>, enabled: boolean, onVisible: () => void): void {
  const callback = useRef(onVisible); callback.current = onVisible;
  useEffect(() => {
    const element = target.current;
    if (!enabled || element === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) callback.current(); }, { rootMargin: '200px' });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [target, enabled]);
}

/** Tables below this many rows render every row (the DOM stays as before CR-132); above it only the visible slice. */
export const VIRTUAL_THRESHOLD = 2000;
/** Height of one code line (12px × 1.75); virtualized rows are pinned to multiples of it by CSS. */
export const LINE_HEIGHT = 21;

/** Prefix sums of row heights: `offsets[i]` is the top of row i, `offsets[count]` the total height. */
export function useOffsets(count: number, heightOf: (index: number) => number): Float64Array {
  return useMemo(() => {
    const offsets = new Float64Array(count + 1);
    for (let index = 0; index < count; index += 1) offsets[index + 1] = offsets[index]! + heightOf(index);
    return offsets;
  }, [count, heightOf]);
}

/** Largest index i with offsets[i] <= y. */
function rowAt(offsets: Float64Array, y: number): number {
  let low = 0; let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (offsets[middle]! <= y) low = middle; else high = middle - 1;
  }
  return low;
}

export interface VirtualWindow { readonly start: number; readonly end: number; readonly padTop: number; readonly padBottom: number; readonly virtual: boolean }
/**
 * The rows of a long list that are inside (or near) the scroller's viewport. `axis` is the scroll direction — `x` for a
 * list laid out in a row (CR-138, the revision list on narrow screens); `padTop`/`padBottom` are then left/right.
 * `start` marks where the rows begin inside the scroller when something (a heading, a filter) comes before them (CR-138):
 * the visible range is then measured from it, not from the scroller's top.
 */
export function useVirtualWindow(scroller: RefObject<HTMLElement | null>, offsets: Float64Array, axis: 'x' | 'y' = 'y', start?: RefObject<HTMLElement | null>): VirtualWindow {
  const count = offsets.length - 1;
  const virtual = count > VIRTUAL_THRESHOLD;
  const [view, setView] = useState({ top: 0, height: 800 });
  useEffect(() => {
    const element = scroller.current;
    if (!virtual || element === null) return;
    const update = (): void => {
      const size = (axis === 'x' ? element.clientWidth : element.clientHeight) || 800;
      const origin = start?.current;
      if (origin) {
        // How far the rows' start has scrolled past the scroller's edge (negative while the rows start below it).
        const outer = element.getBoundingClientRect(); const inner = origin.getBoundingClientRect();
        setView({ top: axis === 'x' ? outer.left - inner.left : outer.top - inner.top, height: size });
      } else setView({ top: axis === 'x' ? element.scrollLeft : element.scrollTop, height: size });
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => { element.removeEventListener('scroll', update); observer?.disconnect(); };
  }, [scroller, virtual, axis, start]);
  if (!virtual) return { start: 0, end: count, padTop: 0, padBottom: 0, virtual };
  const overscan = LINE_HEIGHT * 40;
  const first = rowAt(offsets, Math.max(0, view.top - overscan));
  const end = Math.min(count, rowAt(offsets, Math.max(0, view.top + view.height + overscan)) + 1);
  return { start: first, end, padTop: offsets[first]!, padBottom: offsets[count]! - offsets[end]!, virtual };
}

/** Scrolls so that row `index` sits in the middle of the scroller (works whether or not the row is rendered). */
export function scrollToRow(scroller: HTMLElement | null, offsets: Float64Array, index: number, axis: 'x' | 'y' = 'y'): void {
  if (scroller === null || index < 0 || index >= offsets.length - 1) return;
  if (axis === 'x') scroller.scrollLeft = Math.max(0, offsets[index]! - scroller.clientWidth / 2);
  else scroller.scrollTop = Math.max(0, offsets[index]! - scroller.clientHeight / 2);
}

/** Whether the viewport is at most `width` px wide (the source dialogs switch layouts at 650px). */
export function useNarrow(width = 650): boolean {
  const query = `(max-width: ${String(width)}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = (): void => { setNarrow(list.matches); };
    update();
    list.addEventListener('change', update);
    return () => { list.removeEventListener('change', update); };
  }, [query]);
  return narrow;
}
