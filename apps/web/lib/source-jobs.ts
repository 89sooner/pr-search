/**
 * The two heavy source computations (CR-132), shared by the analysis worker and by the main-thread fallback (tests and
 * browsers without module workers).
 *
 * - `runDiffJob`: the line diff of two texts. Lines are compared with their '\r' kept, so a line-ending change is a
 *   change; the view strips '\r' for display.
 * - `runTraceJob`: the Time-lapse line lineage over a chosen range of revisions. The job reads each revision itself,
 *   window by window, and keeps only the previous revision's lines — it never holds every text of the range at once.
 *   A revision that is not text (binary, LFS pointer, a path that is a submodule) is skipped and reported; a revision
 *   where the path is absent counts as an empty file (the line disappears and may be re-added later).
 *
 * CR-138: no limit on how many revisions one analysis covers. The lineage keeps what changed (checkpoints and runs, see
 * source-compute.ts), transient read failures wait and retry, and an analysis that stops (cancelled, or a read that
 * still fails) hands back what it analyzed so far so that it can continue from the next revision.
 */
import { LineageBuilder, diffLineArrays, type Lineage } from './source-compute';
import { loadFileText, type LoadedFile, type RetryPolicy } from './source-client';

/** Lines as compared: split on '\n', drop the empty element after a final '\n', keep '\r'. */
export function rawLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
export function displayLine(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export interface DiffJobResult { readonly rows: Int32Array; readonly approximate: boolean }
export function runDiffJob(before: string, after: string): DiffJobResult {
  const diff = diffLineArrays(rawLines(before), rawLines(after));
  return { rows: diff.rows, approximate: diff.approximate };
}

export interface TraceProgress {
  /** Revisions analyzed or skipped so far (of `total`). */
  readonly done: number;
  readonly total: number;
  readonly skipped: number;
  /** Revisions whose file has been read to its end (reads run a little ahead of the analysis). */
  readonly loaded: number;
  /** While GitHub asks to wait (rate limit or a temporary failure): how long. `null` otherwise. */
  readonly waitingMs: number | null;
}
export interface TraceSkip { readonly sha: string; readonly reason: string }
export interface TraceJobResult { readonly lineage: Lineage; readonly skipped: readonly TraceSkip[] }
/** An analysis that stopped before the end: continue it at `next` (an index into the same revision list). */
export interface TracePartial { readonly lineage: Lineage; readonly skipped: readonly TraceSkip[]; readonly next: number; readonly key: string }
export interface TraceJobInput {
  readonly repository: string;
  readonly path: string;
  readonly revisions: readonly string[];
  /** Continue a stopped analysis of the same revision list. */
  readonly resume?: TracePartial;
}

/** A stop that keeps the work done so far. `name` is `AbortError` when the user cancelled. */
export class TraceStoppedError extends Error {
  readonly partial: TracePartial | null;
  constructor(reason: unknown, partial: TracePartial | null) {
    super(reason instanceof Error && reason.message ? reason.message : 'Line analysis stopped.');
    this.name = reason instanceof Error && reason.name === 'AbortError' ? 'AbortError' : 'TraceStoppedError';
    this.partial = partial;
  }
}

/**
 * Memory the lineage may keep in the browser (CR-138): its nodes, their texts, checkpoints and runs. This protects the
 * tab from running out of memory; it is not a limit on revisions — a lineage grows with the lines that changed, so a
 * typical file's full history stays far below it. Past it the analysis stops with an honest message instead of crashing.
 */
export const TRACE_MEMORY_BUDGET_BYTES = 1.5 * 1024 * 1024 * 1024;
/** Revisions read ahead while the current pair is compared. */
const READ_AHEAD = 3;

/** Buffers of a lineage, once each: checkpoint revisions share one empty run array, and a duplicate would fail the transfer. */
export function lineageBuffers(lineage: Lineage): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const array of [lineage.lineCounts, lineage.nodeParent, lineage.nodeRevision, lineage.nodeLine, lineage.nodeKind, lineage.nodeDepth, ...lineage.checkpoints, ...lineage.runs]) {
    if (array.byteLength > 0) buffers.add(array.buffer as ArrayBuffer);
  }
  return [...buffers];
}

/** Identifies a revision list, so that a partial result only continues the list it came from. */
export function traceKey(revisions: readonly string[]): string {
  return `${String(revisions.length)}:${revisions[0] ?? ''}:${revisions.at(-1) ?? ''}`;
}

export async function runTraceJob(input: TraceJobInput, options: { readonly signal: AbortSignal; readonly onProgress?: (progress: TraceProgress) => void; readonly memoryBudgetBytes?: number; readonly retry?: RetryPolicy }): Promise<TraceJobResult> {
  const { repository, path, revisions } = input;
  const { signal } = options;
  const key = traceKey(revisions);
  if (input.resume !== undefined && input.resume.key !== key) throw new Error('The revision list changed. Analyze again from the start.');
  const skipped: TraceSkip[] = [...(input.resume?.skipped ?? [])];
  const first = input.resume?.next ?? 0;
  let waitingMs: number | null = null;
  let loaded = first;
  let done = first;
  const report = (): void => { options.onProgress?.({ done, total: revisions.length, skipped: skipped.length, loaded, waitingMs }); };
  const retry: RetryPolicy = { ...options.retry, onWait: (ms, error) => { waitingMs = ms; report(); options.retry?.onWait?.(ms, error); } };
  const read = (sha: string): Promise<LoadedFile> => loadFileText(repository, path, sha, { signal, retry });

  let builder = new LineageBuilder();
  if (input.resume !== undefined && input.resume.lineage.revisions.length > 0) {
    // The lineage continues from its last analyzed revision; its text is read again rather than carried across the pause.
    const last = await read(input.resume.lineage.revisions.at(-1)!);
    if (last.status !== 'text' && last.status !== 'missing') throw new Error('The last analyzed revision can no longer be read as text. Analyze again from the start.');
    builder = LineageBuilder.restore(input.resume.lineage, rawLines(last.text ?? ''));
  }
  const partial = (next: number): TracePartial => ({ lineage: builder.result(), skipped: skipped.slice(), next, key });

  const pending = new Map<number, Promise<LoadedFile>>();
  const start = (index: number): void => {
    if (index >= revisions.length || pending.has(index)) return;
    const load = read(revisions[index]!).then((file) => { loaded += 1; waitingMs = null; report(); return file; });
    // The rejection is observed when this revision's turn comes; do not let it surface as unhandled before that.
    load.catch(() => undefined);
    pending.set(index, load);
  };
  report();
  for (let index = first; index < revisions.length; index += 1) {
    let file: LoadedFile;
    try {
      for (let ahead = index; ahead < index + READ_AHEAD; ahead += 1) start(ahead);
      file = await pending.get(index)!;
      pending.delete(index);
      signal.throwIfAborted();
    } catch (error) {
      throw new TraceStoppedError(signal.aborted ? signal.reason : error, partial(index));
    }
    const sha = revisions[index]!;
    if (file.status === 'text' || file.status === 'missing') {
      builder.addRevision(sha, rawLines(file.text ?? ''));
      if (builder.storedBytes > (options.memoryBudgetBytes ?? TRACE_MEMORY_BUDGET_BYTES)) {
        throw new TraceStoppedError(new Error(`These revisions changed too many lines to analyze in the browser (about ${String(Math.round(builder.storedBytes / (1024 * 1024)))} MB of line versions by revision ${String(index + 1)}). Analyze a shorter range.`), null);
      }
    } else {
      skipped.push({ sha, reason: file.reason ?? `This revision is ${file.status}.` });
    }
    done = index + 1;
    report();
    // Let a cancel message (worker) or rendering (main thread) run between revisions.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { lineage: builder.result(), skipped };
}
