'use client';
/**
 * CR-132 source dialog state: whole files read window by window, line diffs and Time-lapse lineage computed off the
 * main thread, and the visible slice of very long tables. Every piece of work is tied to an AbortController: a new
 * target, closing the dialog or pressing Cancel stops the reads and the computation that belong to the old one.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { loadFileText, type FileProgress, type LoadedFile } from '../../lib/source-client';
import { computeDiff, computeTrace, isAbortError } from '../../lib/source-compute-client';
import type { DiffJobResult, TraceJobInput, TraceJobResult, TraceProgress } from '../../lib/source-jobs';

const message = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

export interface FileTextState {
  readonly file: LoadedFile | null;
  readonly loading: boolean;
  readonly progress: FileProgress | null;
  readonly error: string;
  readonly cancelled: boolean;
}
const IDLE_FILE: FileTextState = { file: null, loading: false, progress: null, error: '', cancelled: false };

/** The complete text of `path` at a pinned `revision` (all windows). `null` path or revision means "nothing to load". */
export function useFileText(repository: string, path: string | null, revision: string | null, delay = 0) {
  const key = path && revision ? `${repository}\n${revision}\n${path}` : null;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<FileTextState & { readonly key: string | null }>({ key: null, ...IDLE_FILE });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (key === null || !path || !revision) return;
    const abort = new AbortController();
    controller.current = abort;
    setState({ key, file: null, loading: true, progress: null, error: '', cancelled: false });
    const timer = setTimeout(() => {
      loadFileText(repository, path, revision, { signal: abort.signal, onProgress: (progress) => { if (!abort.signal.aborted) setState((current) => (current.key === key ? { ...current, progress } : current)); } })
        .then((file) => { if (!abort.signal.aborted) setState({ key, file, loading: false, progress: null, error: '', cancelled: false }); })
        .catch((error: unknown) => { if (!abort.signal.aborted) setState({ key, file: null, loading: false, progress: null, error: message(error, 'Unable to load source.'), cancelled: false }); });
    }, delay);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [key, nonce, delay, repository, path, revision]);
  const current: FileTextState = state.key === key ? state : { ...IDLE_FILE, loading: key !== null };
  const cancel = useCallback(() => {
    controller.current?.abort();
    setState((value) => (value.key === key && value.loading ? { ...value, loading: false, progress: null, cancelled: true } : value));
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
  /** The last finished analysis and the range it covered. A cancelled run keeps the previous result. */
  readonly result: (TraceJobResult & { readonly input: TraceJobInput }) | null;
  readonly error: string;
  readonly cancelled: boolean;
}
export function useTrace() {
  const [state, setState] = useState<TraceState>({ running: false, progress: null, result: null, error: '', cancelled: false });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const run = useCallback((input: TraceJobInput) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState((value) => ({ ...value, running: true, progress: { done: 0, total: input.revisions.length, skipped: 0 }, error: '', cancelled: false }));
    computeTrace(input, abort.signal, (progress) => { if (!abort.signal.aborted) setState((value) => ({ ...value, progress })); })
      .then((result) => { if (!abort.signal.aborted) setState({ running: false, progress: null, result: { ...result, input }, error: '', cancelled: false }); })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setState((value) => ({ ...value, running: false, progress: null, error: isAbortError(error) ? '' : message(error, 'Line analysis failed.'), cancelled: isAbortError(error) }));
      });
  }, []);
  const cancel = useCallback(() => {
    controller.current?.abort();
    setState((value) => (value.running ? { ...value, running: false, progress: null, cancelled: true } : value));
  }, []);
  return { ...state, run, cancel };
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
/** The rows of a long table that are inside (or near) the scroller's viewport. */
export function useVirtualWindow(scroller: RefObject<HTMLElement | null>, offsets: Float64Array): VirtualWindow {
  const count = offsets.length - 1;
  const virtual = count > VIRTUAL_THRESHOLD;
  const [view, setView] = useState({ top: 0, height: 800 });
  useEffect(() => {
    const element = scroller.current;
    if (!virtual || element === null) return;
    const update = (): void => { setView({ top: element.scrollTop, height: element.clientHeight || 800 }); };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => { element.removeEventListener('scroll', update); observer?.disconnect(); };
  }, [scroller, virtual]);
  if (!virtual) return { start: 0, end: count, padTop: 0, padBottom: 0, virtual };
  const overscan = LINE_HEIGHT * 40;
  const start = rowAt(offsets, Math.max(0, view.top - overscan));
  const end = Math.min(count, rowAt(offsets, view.top + view.height + overscan) + 1);
  return { start, end, padTop: offsets[start]!, padBottom: offsets[count]! - offsets[end]!, virtual };
}

/** Scrolls so that row `index` sits in the middle of the scroller (works whether or not the row is rendered). */
export function scrollToRow(scroller: HTMLElement | null, offsets: Float64Array, index: number): void {
  if (scroller === null || index < 0 || index >= offsets.length - 1) return;
  scroller.scrollTop = Math.max(0, offsets[index]! - scroller.clientHeight / 2);
}
