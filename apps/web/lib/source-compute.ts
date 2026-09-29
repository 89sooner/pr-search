import { diffArrays } from 'diff';

// FR-SRC-003/004: line diff and line lineage that never fail on large inputs. The exact pass runs within a budget;
// past it an approximate but always valid alignment is used. Results are typed arrays because files reach
// 200,000+ lines and analyses 1,000+ revisions.

/** Same semantics as source-analysis.ts `lines()`: '' → []; split on '\n'; drop one trailing empty element after a final '\n'; strip one trailing '\r' per line. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const result = text.split('\n');
  if (result.at(-1) === '') result.pop();
  for (let i = 0; i < result.length; i++) {
    const line = result[i]!;
    if (line.endsWith('\r')) result[i] = line.slice(0, -1);
  }
  return result;
}

export const ROW_EQUAL = 0;
export const ROW_CHANGE = 1;
export interface LineDiff {
  /** 3 ints per row: kind (ROW_EQUAL|ROW_CHANGE), before line index (0-based, -1 = none), after line index (0-based, -1 = none). */
  readonly rows: Int32Array;
  /** True when the exact diff exceeded its budget somewhere and an approximate alignment was used. */
  readonly approximate: boolean;
}
export interface DiffBudget { readonly timeoutMs?: number; readonly maxEditLength?: number }
/** Default budget for the exact pass: timeoutMs 2000, maxEditLength 50_000 (edit length counted in lines). */
export const EXACT_BUDGET: Required<DiffBudget> = Object.freeze({ timeoutMs: 2000, maxEditLength: 50_000 });

/** Budget of one anchorless gap inside the fallback. */
const GAP_BUDGET = { timeoutMs: 50, maxEditLength: 2000 } as const;
/** Wall-clock cap shared by all gap diffs of one fallback run; later anchorless gaps stay whole change blocks. */
const GAP_TOTAL_MS = 500;
/** The anchor search visits at most this multiple of the middle's line count, so nested inputs cannot go quadratic. */
const ANCHOR_WORK_FACTOR = 32;

export function diffLineArrays(before: readonly string[], after: readonly string[], budget: DiffBudget = EXACT_BUDGET): LineDiff {
  const n = before.length; const m = after.length;
  let prefix = 0;
  while (prefix < n && prefix < m && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && before[n - 1 - suffix] === after[m - 1 - suffix]) suffix++;
  // matchB[b] is the after index paired with before line b, or -1. Every stage only records matches; rows are built once.
  const matchB = new Int32Array(n).fill(-1);
  for (let i = 0; i < prefix; i++) matchB[i] = i;
  for (let i = 1; i <= suffix; i++) matchB[n - i] = m - i;
  // A middle that is empty on one side is a pure insertion or deletion: exact without any diff.
  let approximate = false;
  if (n - prefix - suffix > 0 && m - prefix - suffix > 0) approximate = !alignMiddle(before, after, prefix, n - suffix, m - suffix, matchB, budget);
  return { rows: buildRows(matchB, m), approximate };
}

export function rowCount(diff: LineDiff): number { return diff.rows.length / 3; }

/** Aligns before[start, beforeEnd) with after[start, afterEnd). Returns false when the exact pass gave up and the fallback ran. */
function alignMiddle(before: readonly string[], after: readonly string[], start: number, beforeEnd: number, afterEnd: number, matchB: Int32Array, budget: DiffBudget): boolean {
  // Lines become integers: diffArrays compares them with ===, and the fallback indexes count tables by them.
  const ids = new Map<string, number>();
  const intern = (lines: readonly string[], end: number): Int32Array => {
    const out = new Int32Array(end - start);
    for (let i = start; i < end; i++) {
      const line = lines[i]!;
      let id = ids.get(line);
      if (id === undefined) { id = ids.size; ids.set(line, id); }
      out[i - start] = id;
    }
    return out;
  };
  const b = intern(before, beforeEnd); const a = intern(after, afterEnd);
  const maxEditLength = budget.maxEditLength ?? EXACT_BUDGET.maxEditLength;
  const timeout = budget.timeoutMs ?? EXACT_BUDGET.timeoutMs;
  // Every surplus copy of a line must be removed or added, so the multiset difference is a lower bound of the edit
  // length. Above maxEditLength jsdiff can only give up, so skip it (two unrelated files fall back at once).
  if (multisetDistance(b, a, ids.size) <= maxEditLength) {
    const changes = diffArrays(Array.from(b), Array.from(a), { timeout, maxEditLength });
    if (changes) { recordChanges(changes, start, start, matchB); return true; }
  }
  anchorAlign(b, a, ids.size, start, matchB);
  return false;
}

function multisetDistance(b: Int32Array, a: Int32Array, idCount: number): number {
  const balance = new Int32Array(idCount);
  for (let i = 0; i < b.length; i++) { const id = b[i]!; balance[id] = balance[id]! + 1; }
  for (let j = 0; j < a.length; j++) { const id = a[j]!; balance[id] = balance[id]! - 1; }
  let total = 0;
  for (let id = 0; id < idCount; id++) total += Math.abs(balance[id]!);
  return total;
}

/** Records the equal runs of a jsdiff result whose first tokens sit at beforeStart/afterStart. */
function recordChanges(changes: readonly { count: number; added: boolean; removed: boolean }[], beforeStart: number, afterStart: number, matchB: Int32Array): void {
  let b = beforeStart; let a = afterStart;
  for (const change of changes) {
    if (change.added) a += change.count;
    else if (change.removed) b += change.count;
    else { for (let k = 0; k < change.count; k++) matchB[b + k] = a + k; b += change.count; a += change.count; }
  }
}

/**
 * Patience-style fallback. In each range, lines that occur exactly once on both sides are candidate anchors; the
 * longest increasing run of their positions is kept, and every gap between anchors is trimmed and aligned the same
 * way. A gap without anchors gets a small exact diff, else stays one change block. An explicit stack keeps 200k-line
 * inputs off the call stack; ranges are disjoint, so the processing order does not matter.
 */
function anchorAlign(b: Int32Array, a: Int32Array, idCount: number, offset: number, matchB: Int32Array): void {
  const countB = new Int32Array(idCount); const countA = new Int32Array(idCount); const positionA = new Int32Array(idCount);
  // A range never has more unique pairs than lines on its smaller side.
  const size = Math.min(b.length, a.length);
  const pairB = new Int32Array(size); const pairA = new Int32Array(size);
  const tails = new Int32Array(size); const links = new Int32Array(size); const chain = new Int32Array(size);
  const workCap = ANCHOR_WORK_FACTOR * (b.length + a.length); let work = 0;
  const gapDeadline = Date.now() + GAP_TOTAL_MS;
  const stack: number[] = [0, b.length, 0, a.length];
  while (stack.length > 0) {
    let a1 = stack.pop()!; let a0 = stack.pop()!; let b1 = stack.pop()!; let b0 = stack.pop()!;
    while (b0 < b1 && a0 < a1 && b[b0] === a[a0]) { matchB[offset + b0] = offset + a0; b0++; a0++; }
    while (b0 < b1 && a0 < a1 && b[b1 - 1] === a[a1 - 1]) { b1--; a1--; matchB[offset + b1] = offset + a1; }
    if (b0 === b1 || a0 === a1) continue;
    work += b1 - b0 + a1 - a0;
    if (work > workCap) continue;
    for (let i = b0; i < b1; i++) { const id = b[i]!; countB[id] = countB[id]! + 1; }
    for (let j = a0; j < a1; j++) { const id = a[j]!; countA[id] = countA[id]! + 1; positionA[id] = j; }
    let pairs = 0; let common = false;
    for (let i = b0; i < b1; i++) {
      const id = b[i]!;
      if (countA[id]! > 0) common = true;
      if (countB[id] === 1 && countA[id] === 1) { pairB[pairs] = i; pairA[pairs] = positionA[id]!; pairs++; }
    }
    for (let i = b0; i < b1; i++) countB[b[i]!] = 0;
    for (let j = a0; j < a1; j++) countA[a[j]!] = 0;
    if (pairs === 0) {
      // Without a shared line the whole gap is one change block, and that is already exact.
      const remaining = gapDeadline - Date.now();
      if (!common || remaining <= 0) continue;
      const changes = diffArrays(Array.from(b.subarray(b0, b1)), Array.from(a.subarray(a0, a1)), { timeout: Math.min(GAP_BUDGET.timeoutMs, remaining), maxEditLength: GAP_BUDGET.maxEditLength });
      if (changes) recordChanges(changes, offset + b0, offset + a0, matchB);
      continue;
    }
    const anchors = longestIncreasing(pairA, pairs, tails, links, chain);
    let previousB = b0; let previousA = a0;
    for (let t = 0; t < anchors; t++) {
      const pair = chain[t]!; const anchorB = pairB[pair]!; const anchorA = pairA[pair]!;
      matchB[offset + anchorB] = offset + anchorA;
      if (anchorB > previousB && anchorA > previousA) stack.push(previousB, anchorB, previousA, anchorA);
      previousB = anchorB + 1; previousA = anchorA + 1;
    }
    if (b1 > previousB && a1 > previousA) stack.push(previousB, b1, previousA, a1);
  }
}

/** Longest strictly increasing subsequence of values[0, count) in O(count log count). Writes its indices to chain and returns its length. */
function longestIncreasing(values: Int32Array, count: number, tails: Int32Array, links: Int32Array, chain: Int32Array): number {
  let length = 0;
  for (let i = 0; i < count; i++) {
    const value = values[i]!;
    let low = 0; let high = length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[tails[middle]!]! < value) low = middle + 1; else high = middle;
    }
    links[i] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = i;
    if (low === length) length++;
  }
  let index = tails[length - 1]!;
  for (let t = length - 1; t >= 0; t--) { chain[t] = index; index = links[index]!; }
  return length;
}

/** Turns before→after matches into rows. Between two equal rows, removed and added lines are paired positionally. */
function buildRows(matchB: Int32Array, afterLength: number): Int32Array {
  const n = matchB.length;
  let total = 0;
  for (let i = 0, b = 0, a = 0; i <= n; i++) {
    const match = i < n ? matchB[i]! : afterLength;
    if (match < 0) continue;
    total += Math.max(i - b, match - a) + (i < n ? 1 : 0);
    b = i + 1; a = match + 1;
  }
  const rows = new Int32Array(total * 3);
  let r = 0;
  for (let i = 0, b = 0, a = 0; i <= n; i++) {
    const match = i < n ? matchB[i]! : afterLength;
    if (match < 0) continue;
    const removed = i - b; const added = match - a;
    for (let j = 0; j < removed || j < added; j++) {
      rows[r++] = ROW_CHANGE; rows[r++] = j < removed ? b + j : -1; rows[r++] = j < added ? a + j : -1;
    }
    if (i < n) { rows[r++] = ROW_EQUAL; rows[r++] = i; rows[r++] = match; }
    b = i + 1; a = match + 1;
  }
  return rows;
}

export type LineageKind = 'baseline' | 'added' | 'edited';
export interface LineEvent { sha: string; line: number; text: string; kind: LineageKind }
export interface Lineage {
  /** Analyzed revisions, oldest first (only the ones added with addRevision). */
  readonly revisions: readonly string[];
  /** Per analyzed revision (same index as `revisions`): the lineage node of each line (0-based line index). */
  readonly lineNodes: readonly Int32Array[];
  readonly nodeParent: Int32Array;   // -1 = none
  readonly nodeRevision: Int32Array; // index into `revisions`
  readonly nodeLine: Int32Array;     // 1-based line number at that revision
  readonly nodeKind: Uint8Array;     // 0 baseline, 1 added, 2 edited
  readonly nodeDepth: Int32Array;    // number of events in the chain ending at this node (>= 1)
  readonly nodeText: readonly string[];
  /** Adjacent pairs whose alignment was approximate. */
  readonly approximatePairs: number;
}

const KIND_BASELINE = 0; const KIND_ADDED = 1; const KIND_EDITED = 2;
const KIND_NAMES: readonly LineageKind[] = ['baseline', 'added', 'edited'];
const INITIAL_NODES = 1024;

/** A line split from a revision text is a slice that keeps the whole text alive in V8; a JSON round trip stores an exact, independent copy. */
function detach(text: string): string { return JSON.parse(JSON.stringify(text)) as string; }

/** Adjacent replacement rows are aligned candidates, not authoritative Git blame (same model as source-analysis.ts traceLines). */
export class LineageBuilder {
  private readonly budget: DiffBudget;
  private readonly revisions: string[] = [];
  private readonly lineNodes: Int32Array[] = [];
  private readonly texts: string[] = [];
  private parent = new Int32Array(INITIAL_NODES);
  private revision = new Int32Array(INITIAL_NODES);
  private line = new Int32Array(INITIAL_NODES);
  private depth = new Int32Array(INITIAL_NODES);
  private kind = new Uint8Array(INITIAL_NODES);
  private count = 0;
  /** Only the previous revision's lines are kept; older texts live on solely in the node texts. */
  private previous: readonly string[] = [];
  private approximatePairs = 0;

  constructor(budget: DiffBudget = EXACT_BUDGET) { this.budget = budget; }

  /** Adds the next text revision (oldest to newest). Returns whether this pair's alignment was approximate (false for the first revision). */
  addRevision(sha: string, lines: readonly string[]): { approximate: boolean } {
    const revision = this.revisions.length;
    const nodes = new Int32Array(lines.length);
    let approximate = false;
    if (revision === 0) {
      // Baseline nodes store every line of this revision anyway, so the caller's strings are kept as they are.
      for (let i = 0; i < lines.length; i++) nodes[i] = this.addNode(-1, 0, i, KIND_BASELINE, lines[i]!);
    } else {
      const diff = diffLineArrays(this.previous, lines, this.budget);
      const previousNodes = this.lineNodes[revision - 1]!;
      const rows = diff.rows;
      for (let r = 0; r < rows.length; r += 3) {
        const after = rows[r + 2]!;
        if (after < 0) continue;
        const before = rows[r + 1]!;
        if (rows[r] === ROW_EQUAL) nodes[after] = previousNodes[before]!;
        else if (before >= 0) nodes[after] = this.addNode(previousNodes[before]!, revision, after, KIND_EDITED, detach(lines[after]!));
        else nodes[after] = this.addNode(-1, revision, after, KIND_ADDED, detach(lines[after]!));
      }
      approximate = diff.approximate;
      if (approximate) this.approximatePairs++;
    }
    this.revisions.push(sha); this.lineNodes.push(nodes); this.previous = lines.slice();
    return { approximate };
  }

  /** Number of analyzed revisions so far. */
  get size(): number { return this.revisions.length; }

  /** Snapshot; typed arrays are copied to their used size, so later addRevision calls do not change it. */
  result(): Lineage {
    const count = this.count;
    return {
      revisions: this.revisions.slice(), lineNodes: this.lineNodes.slice(),
      nodeParent: this.parent.slice(0, count), nodeRevision: this.revision.slice(0, count), nodeLine: this.line.slice(0, count),
      nodeKind: this.kind.slice(0, count), nodeDepth: this.depth.slice(0, count), nodeText: this.texts.slice(0, count),
      approximatePairs: this.approximatePairs,
    };
  }

  private addNode(parent: number, revision: number, index: number, kind: number, text: string): number {
    const node = this.count;
    if (node === this.parent.length) this.grow();
    this.parent[node] = parent; this.revision[node] = revision; this.line[node] = index + 1; this.kind[node] = kind;
    this.depth[node] = parent < 0 ? 1 : this.depth[parent]! + 1;
    this.texts.push(text);
    this.count = node + 1;
    return node;
  }

  /** Doubles every node array. */
  private grow(): void {
    const capacity = this.parent.length * 2;
    const widen = (old: Int32Array): Int32Array<ArrayBuffer> => { const next = new Int32Array(capacity); next.set(old); return next; };
    this.parent = widen(this.parent); this.revision = widen(this.revision); this.line = widen(this.line); this.depth = widen(this.depth);
    const kind = new Uint8Array(capacity); kind.set(this.kind); this.kind = kind;
  }
}

/** Events of the line at (revision index, 0-based line), oldest first. Empty array if out of range. */
export function lineEvents(lineage: Lineage, revision: number, line: number): LineEvent[] {
  let node = lineage.lineNodes[revision]?.[line];
  if (node === undefined) return [];
  const events: LineEvent[] = [];
  while (node >= 0) {
    events.push({ sha: lineage.revisions[lineage.nodeRevision[node]!]!, line: lineage.nodeLine[node]!, text: lineage.nodeText[node]!, kind: KIND_NAMES[lineage.nodeKind[node]!]! });
    node = lineage.nodeParent[node]!;
  }
  return events.reverse();
}
