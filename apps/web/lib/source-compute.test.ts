import { diffArrays } from 'diff';
import { describe, expect, it } from 'vitest';
import { compareLines, lines, traceLines } from './source-analysis';
import {
  EXACT_BUDGET, LineageBuilder, ROW_CHANGE, ROW_EQUAL, diffLineArrays, lineEvents, rowCount, splitLines, type DiffBudget, type LineDiff,
} from './source-compute';

/** mulberry32: every random input is reproducible from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (random: () => number, n: number): number => Math.floor(random() * n);
// jsdiff checks `Date.now() <= start + timeout`, so timeout 0 can still finish; maxEditLength 0 fails every non-identical middle.
const FORCE_FALLBACK: DiffBudget = { maxEditLength: 0 };

/** First violation of the row contract (complete, ordered, equal rows join equal lines, positional pairing per block), or null. */
function violation(before: readonly string[], after: readonly string[], diff: LineDiff): string | null {
  const rows = diff.rows;
  if (rows.length % 3 !== 0) return 'rows length is not a multiple of 3';
  let nextBefore = 0; let nextAfter = 0; let beforeEnded = false; let afterEnded = false;
  for (let r = 0; r < rows.length; r += 3) {
    const kind = rows[r]; const b = rows[r + 1]!; const a = rows[r + 2]!; const at = `row ${r / 3}`;
    if (b !== -1) { if (b !== nextBefore) return `${at}: before ${b}, expected ${nextBefore}`; nextBefore++; }
    if (a !== -1) { if (a !== nextAfter) return `${at}: after ${a}, expected ${nextAfter}`; nextAfter++; }
    if (kind === ROW_EQUAL) {
      if (b === -1 || a === -1) return `${at}: equal row without both sides`;
      if (before[b] !== after[a]) return `${at}: equal row joins different lines`;
      beforeEnded = false; afterEnded = false;
    } else if (kind === ROW_CHANGE) {
      if (b === -1 && a === -1) return `${at}: empty change row`;
      // Positional pairing: once a side runs out inside a block, it stays out until the next equal row.
      if (b === -1) beforeEnded = true; else if (beforeEnded) return `${at}: removed line after the block's removed lines ended`;
      if (a === -1) afterEnded = true; else if (afterEnded) return `${at}: added line after the block's added lines ended`;
    } else return `${at}: unknown kind ${kind}`;
  }
  if (nextBefore !== before.length) return `covers ${nextBefore} of ${before.length} before lines`;
  if (nextAfter !== after.length) return `covers ${nextAfter} of ${after.length} after lines`;
  return null;
}
function changedLines(diff: LineDiff): number {
  let total = 0;
  for (let r = 0; r < diff.rows.length; r += 3) if (diff.rows[r] === ROW_CHANGE) total += Number(diff.rows[r + 1]! >= 0) + Number(diff.rows[r + 2]! >= 0);
  return total;
}
/** Removed plus added lines of an unbounded jsdiff run on the untrimmed arrays. */
function jsdiffChangedLines(before: readonly string[], after: readonly string[]): number {
  return diffArrays([...before], [...after]).reduce((total, change) => total + (change.added || change.removed ? change.count : 0), 0);
}
/** Whether both sides keep lines after trimming the common prefix and suffix — the only case that needs a diff. */
function nonTrivialMiddle(before: readonly string[], after: readonly string[]): boolean {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return before.length - prefix - suffix > 0 && after.length - prefix - suffix > 0;
}
function triples(diff: LineDiff): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < diff.rows.length; r += 3) out.push([diff.rows[r]!, diff.rows[r + 1]!, diff.rows[r + 2]!]);
  return out;
}
const toText = (items: readonly string[]): string => (items.length ? `${items.join('\n')}\n` : '');

/** Inserts, deletes, replaces, moves and duplicates a few lines. */
function edited(random: () => number, source: readonly string[], line: () => string): string[] {
  const out = source.slice();
  for (let edits = 1 + pick(random, 8); edits > 0; edits--) {
    const at = pick(random, out.length + 1);
    switch (pick(random, 5)) {
      case 0: out.splice(at, 0, line()); break;
      case 1: out.splice(at, 1); break;
      case 2: if (at < out.length) out[at] = line(); break;
      case 3: { const block = out.splice(at, 1 + pick(random, 5)); out.splice(pick(random, out.length + 1), 0, ...block); break; }
      default: out.splice(at, 0, ...out.slice(at, at + 1 + pick(random, 3)));
    }
  }
  return out;
}
/** Empty sides, identical, all different, unrelated or edited pairs; lines mix unique text with a small repeated alphabet. */
function randomPair(random: () => number): [string[], string[]] {
  const alphabet = 1 + pick(random, 8); const uniqueShare = random(); let serial = 0;
  const line = (): string => (random() < uniqueShare ? `unique ${serial++}` : `repeat ${pick(random, alphabet)}`);
  const base = Array.from({ length: pick(random, 80) }, line);
  switch (pick(random, 8)) {
    case 0: return [[], base];
    case 1: return [base, []];
    case 2: return [base, base.slice()];
    case 3: return [base, base.map(text => `other ${text}`)];
    case 4: return [base, Array.from({ length: pick(random, 80) }, line)];
    default: return [base, edited(random, base, line)];
  }
}
/** 3–8 revisions of 0–40 lines. `unique` keeps each line unique within its revision; lines still recur across revisions. */
function randomHistory(random: () => number, unique: boolean): { sha: string; text: string }[] {
  const alphabet = unique ? 60 : 2 + pick(random, 6);
  const fresh = (current: readonly string[]): string => {
    for (;;) { const text = `line ${pick(random, alphabet)}`; if (!unique || !current.includes(text)) return text; }
  };
  const versions: { sha: string; text: string }[] = []; let current: string[] = [];
  for (let v = 0, count = 3 + pick(random, 6); v < count; v++) {
    if (v === 0 || random() < 0.15) {
      current = [];
      for (let length = pick(random, 41); current.length < length;) current.push(fresh(current));
    } else {
      for (let edits = 1 + pick(random, 4); edits > 0; edits--) {
        const at = pick(random, current.length + 1); const op = pick(random, 4);
        if (op === 0 && current.length < 40) current.splice(at, 0, fresh(current));
        else if (op === 1) current.splice(at, 1);
        else if (op === 2 && at < current.length) current[at] = fresh(current);
        else if (op === 3) { const block = current.splice(at, 1 + pick(random, 3)); current.splice(pick(random, current.length + 1), 0, ...block); }
      }
    }
    // Texts end with '\n' and carry no '\r', so today's newline-bearing diffLines tokens compare like split lines.
    versions.push({ sha: `r${v}`, text: toText(current) });
  }
  return versions;
}
/** Code-like text: mostly unique statements with repeated blank and brace lines. */
function codeLine(random: () => number, index: number, tag = 'a'): string {
  const roll = pick(random, 10);
  return roll < 2 ? '' : roll < 3 ? '  }' : `  const v${index}_${tag} = compute(${pick(random, 1_000_000)});`;
}
/** Replaces, deletes or inserts after about `rate` of the lines. */
function scatter(random: () => number, source: readonly string[], rate: number): { after: string[]; edits: number } {
  const after: string[] = []; let edits = 0;
  source.forEach((text, index) => {
    if (random() >= rate) { after.push(text); return; }
    edits++;
    const op = pick(random, 3);
    if (op === 0) after.push(`edited ${index} ${pick(random, 1e9)}`);
    else if (op === 1) after.push(text, `inserted ${index}`);
  });
  return { after, edits };
}

describe('FR-SRC-003 line diff within a budget, approximate but valid beyond it', () => {
  it('FR-SRC-003 splitLines matches source-analysis lines() on edge cases', () => {
    for (const text of ['', 'a', 'a\n', 'a\r\nb\r\n', '\n\n', 'a\nb', '\n', '\r', '\r\n', 'a\r\r\n', 'x\n\ny\n', ' \t\n\n  ', 'tail\r']) {
      expect(splitLines(text), JSON.stringify(text)).toEqual(lines(text));
    }
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(splitLines('\n\n')).toEqual(['', '']);
    const random = prng(3);
    for (let i = 0; i < 500; i++) {
      const text = Array.from({ length: pick(random, 12) }, () => ['a', '\n', '\r', ' ', 'b'][pick(random, 5)]).join('');
      expect(splitLines(text), JSON.stringify(text)).toEqual(lines(text));
    }
  });

  it('FR-SRC-003 aligns insertion, removal and replacement and pairs a change block positionally', () => {
    expect(triples(diffLineArrays(['alpha', 'beta', 'gamma'], ['alpha', 'BETA', 'gamma', 'delta'])))
      .toEqual([[ROW_EQUAL, 0, 0], [ROW_CHANGE, 1, 1], [ROW_EQUAL, 2, 2], [ROW_CHANGE, -1, 3]]);
    expect(triples(diffLineArrays(['a', 'x1', 'x2', 'x3', 'b'], ['a', 'y1', 'b'])))
      .toEqual([[ROW_EQUAL, 0, 0], [ROW_CHANGE, 1, 1], [ROW_CHANGE, 2, -1], [ROW_CHANGE, 3, -1], [ROW_EQUAL, 4, 2]]);
    expect(triples(diffLineArrays(['a', 'b'], []))).toEqual([[ROW_CHANGE, 0, -1], [ROW_CHANGE, 1, -1]]);
    expect(triples(diffLineArrays([], ['a']))).toEqual([[ROW_CHANGE, -1, 0]]);
    const empty = diffLineArrays([], []);
    expect(rowCount(empty)).toBe(0);
    expect(empty.approximate).toBe(false);
    expect(rowCount(diffLineArrays(['a', 'b'], ['a', 'c', 'd']))).toBe(3);
    // Only line content is compared: a CRLF-only or final-newline-only change is invisible here, unlike compareLines.
    expect(compareLines('a', 'a\n')!.some(row => row.kind === 'change')).toBe(true);
    expect(triples(diffLineArrays(splitLines('a'), splitLines('a\n')))).toEqual([[ROW_EQUAL, 0, 0]]);
    expect(triples(diffLineArrays(splitLines('a\r\n'), splitLines('a\n')))).toEqual([[ROW_EQUAL, 0, 0]]);
    expect(EXACT_BUDGET).toEqual({ timeoutMs: 2000, maxEditLength: 50_000 });
    expect(Object.isFrozen(EXACT_BUDGET)).toBe(true);
  });

  it('FR-SRC-003 rows form a complete, positionally paired alignment on random pairs', () => {
    for (let seed = 1; seed <= 600; seed++) {
      const [before, after] = randomPair(prng(seed));
      const diff = diffLineArrays(before, after);
      expect(violation(before, after, diff), `seed ${seed}`).toBeNull();
      expect(diff.approximate, `seed ${seed}`).toBe(false);
      if (before.length === after.length && before.every((text, i) => text === after[i])) expect(changedLines(diff)).toBe(0);
    }
  });

  it('FR-SRC-003 the exact path is minimal: changed lines equal an unbounded jsdiff run', () => {
    for (let seed = 1; seed <= 600; seed++) {
      const [before, after] = randomPair(prng(seed * 31 + 7));
      const diff = diffLineArrays(before, after);
      // A precondition, not a filter: these inputs are far inside the budget.
      expect(diff.approximate, `seed ${seed}`).toBe(false);
      expect(changedLines(diff), `seed ${seed}`).toBe(jsdiffChangedLines(before, after));
    }
    // A partial budget keeps the other default.
    expect(diffLineArrays(['a', 'b', 'c'], ['a', 'x', 'c'], { timeoutMs: 1000 }).approximate).toBe(false);
  });

  it('FR-SRC-003 the forced fallback stays valid and is approximate exactly when the trimmed middle needs a diff', () => {
    let approximate = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const [before, after] = randomPair(prng(seed * 17 + 3));
      const diff = diffLineArrays(before, after, FORCE_FALLBACK);
      expect(violation(before, after, diff), `seed ${seed}`).toBeNull();
      expect(diff.approximate, `seed ${seed}`).toBe(nonTrivialMiddle(before, after));
      if (diff.approximate) approximate++;
    }
    expect(approximate).toBeGreaterThan(300);
  });

  it('FR-SRC-003 the fallback anchors on unique lines and recovers the exact alignment of scattered edits', () => {
    const before = Array.from({ length: 300 }, (_, i) => (i % 10 === 0 ? '' : `unique ${i}`));
    const after = before.slice();
    after[55] = 'changed 55'; after.splice(123, 0, 'inserted'); after.splice(201, 2); after[277] = 'changed 277';
    const exact = diffLineArrays(before, after);
    const fallback = diffLineArrays(before, after, FORCE_FALLBACK);
    expect([exact.approximate, fallback.approximate]).toEqual([false, true]);
    expect(triples(fallback)).toEqual(triples(exact));
    // A moved block: the longest increasing run of anchors leaves it out, so the cost stays minimal.
    const moved = before.slice(); moved.splice(240, 0, ...moved.splice(30, 4));
    const movedFallback = diffLineArrays(before, moved, FORCE_FALLBACK);
    expect(violation(before, moved, movedFallback)).toBeNull();
    expect(changedLines(movedFallback)).toBe(jsdiffChangedLines(before, moved));
  });

  it('FR-SRC-003 an anchorless gap gets a small exact diff, and stays one change block when that gives up', () => {
    // Only repeated lines are shared, so no anchor exists; the gap's small diff still finds the minimal alignment.
    const small = [['x', 'a', 'a', 'b', 'b', 'y'], ['X', 'b', 'b', 'a', 'a', 'Y']] as const;
    const smallFallback = diffLineArrays(small[0], small[1], FORCE_FALLBACK);
    expect(smallFallback.approximate).toBe(true);
    expect(violation(small[0], small[1], smallFallback)).toBeNull();
    expect(changedLines(smallFallback)).toBe(jsdiffChangedLines(small[0], small[1]));
    expect(changedLines(smallFallback)).toBeLessThan(small[0].length + small[1].length);
    // Four lines repeated 5,000 times: none is unique, and the minimal edit (about 3,500 lines) exceeds the
    // fallback's per-gap maxEditLength of 2,000, so the whole middle stays one change block.
    const random = prng(4);
    const before = ['start', ...Array.from({ length: 5000 }, () => `repeat ${pick(random, 4)}`), 'end'];
    const after = ['START', ...Array.from({ length: 5000 }, () => `repeat ${pick(random, 4)}`), 'END'];
    const fallback = diffLineArrays(before, after, FORCE_FALLBACK);
    expect(fallback.approximate).toBe(true);
    expect(violation(before, after, fallback)).toBeNull();
    expect(triples(fallback).filter(([kind]) => kind === ROW_EQUAL)).toHaveLength(0);
    const exact = diffLineArrays(before, after);
    expect(exact.approximate).toBe(false);
    expect(changedLines(exact)).toBe(jsdiffChangedLines(before, after));
    expect(changedLines(exact)).toBeGreaterThan(2000);
    expect(changedLines(exact)).toBeLessThan(changedLines(fallback));
  }, 30_000);

  it('FR-SRC-003 matches today\'s compareLines rows when lines are unique within each side', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const versions = randomHistory(prng(seed + 5000), true);
      for (let i = 1; i < versions.length; i++) {
        const today = compareLines(versions[i - 1]!.text, versions[i]!.text)!
          .map(row => [row.kind === 'equal' ? ROW_EQUAL : ROW_CHANGE, row.before ? row.before.number - 1 : -1, row.after ? row.after.number - 1 : -1]);
        expect(triples(diffLineArrays(splitLines(versions[i - 1]!.text), splitLines(versions[i]!.text))), `seed ${seed} pair ${i}`).toEqual(today);
      }
    }
  });
});

describe('FR-SRC-004 inferred line lineage over many revisions', () => {
  it('FR-SRC-004 matches today\'s traceLines event for event when lines are unique within each revision', () => {
    // Why unique lines: with repeated lines, trimming the common suffix before Myers can choose another alignment of
    // the same cost (next test). While writing this test, untrimmed jsdiff output with removed and added lines paired
    // positionally per change block reproduced compareLines on 20,000 random pairs, so trimming is the only source of
    // difference; with lines unique within a revision, 3,000 random histories showed no difference at all.
    for (let seed = 1; seed <= 400; seed++) {
      const versions = randomHistory(prng(seed), true);
      const traced = traceLines(versions)!;
      const builder = new LineageBuilder();
      for (const version of versions) builder.addRevision(version.sha, splitLines(version.text));
      const lineage = builder.result();
      versions.forEach((version, revision) => {
        const today = traced.get(version.sha)!;
        expect(lineage.lineNodes[revision]!.length).toBe(today.length);
        today.forEach((line, index) => expect(lineEvents(lineage, revision, index), `seed ${seed} ${version.sha}:${index + 1}`).toEqual(line.events));
      });
    }
  });

  it('FR-SRC-004 with repeated lines only the choice between equal-cost alignments may differ from today', () => {
    // [x, a] → [a, a]: today removes x, keeps the first a and adds the second; trimming the common suffix first turns
    // x into a and keeps the last a. Both change two lines.
    expect(compareLines('x\na\n', 'a\na\n')!.map(row => [row.kind, row.before?.number ?? 0, row.after?.number ?? 0]))
      .toEqual([['change', 1, 0], ['equal', 2, 1], ['change', 0, 2]]);
    expect(triples(diffLineArrays(['x', 'a'], ['a', 'a']))).toEqual([[ROW_CHANGE, 0, 0], [ROW_EQUAL, 1, 1]]);
    for (let seed = 1; seed <= 300; seed++) {
      const versions = randomHistory(prng(seed + 9000), false);
      for (let i = 1; i < versions.length; i++) {
        const today = compareLines(versions[i - 1]!.text, versions[i]!.text)!
          .reduce((total, row) => total + (row.kind === 'change' ? Number(row.before !== null) + Number(row.after !== null) : 0), 0);
        expect(changedLines(diffLineArrays(splitLines(versions[i - 1]!.text), splitLines(versions[i]!.text))), `seed ${seed} pair ${i}`).toBe(today);
      }
    }
  });

  it('FR-SRC-004 follows shifted lines, grows the edited chain and starts added lines at depth 1', () => {
    const builder = new LineageBuilder();
    expect(builder.addRevision('a', ['header', 'return 1;'])).toEqual({ approximate: false });
    builder.addRevision('b', ['// note', 'header', 'return 1;']);
    builder.addRevision('c', ['// note', 'header', 'return 2;']);
    builder.addRevision('d', ['// note', 'header', 'return 3;']);
    expect(builder.size).toBe(4);
    const lineage = builder.result();
    expect(lineEvents(lineage, 2, 1)).toEqual([{ sha: 'a', line: 1, text: 'header', kind: 'baseline' }]);
    expect(lineEvents(lineage, 3, 2)).toEqual([
      { sha: 'a', line: 2, text: 'return 1;', kind: 'baseline' },
      { sha: 'c', line: 3, text: 'return 2;', kind: 'edited' },
      { sha: 'd', line: 3, text: 'return 3;', kind: 'edited' },
    ]);
    expect(lineEvents(lineage, 1, 0)).toEqual([{ sha: 'b', line: 1, text: '// note', kind: 'added' }]);
    const depth = (revision: number, line: number): number => lineage.nodeDepth[lineage.lineNodes[revision]![line]!]!;
    expect([depth(0, 1), depth(1, 2), depth(2, 2), depth(3, 2), depth(1, 0), depth(3, 0)]).toEqual([1, 1, 2, 3, 1, 1]);
    // Unchanged lines keep their node; only changed lines create nodes.
    expect(lineage.lineNodes[3]![1]).toBe(lineage.lineNodes[0]![0]);
    expect(Array.from(lineage.nodeKind)).toEqual([0, 0, 1, 2, 2]);
    expect(Array.from(lineage.nodeParent)).toEqual([-1, -1, -1, 1, 3]);
    expect(Array.from(lineage.nodeRevision)).toEqual([0, 0, 1, 2, 3]);
    expect(Array.from(lineage.nodeLine)).toEqual([1, 2, 1, 3, 3]);
    expect(lineage.nodeText).toEqual(['header', 'return 1;', '// note', 'return 2;', 'return 3;']);
  });

  it('FR-SRC-004 a line deleted and later re-added starts a new lineage', () => {
    const builder = new LineageBuilder();
    builder.addRevision('a', ['old']); builder.addRevision('b', []); builder.addRevision('c', ['new']);
    expect(lineEvents(builder.result(), 2, 0)).toEqual([{ sha: 'c', line: 1, text: 'new', kind: 'added' }]);
  });

  it('FR-SRC-004 nodeDepth equals the event count for every line of every revision, exact or approximate', () => {
    for (const budget of [EXACT_BUDGET, FORCE_FALLBACK]) {
      for (let seed = 1; seed <= 200; seed++) {
        const versions = randomHistory(prng(seed + 20_000), seed % 2 === 0);
        const texts = versions.map(version => splitLines(version.text));
        const builder = new LineageBuilder(budget);
        const flags = versions.map((version, revision) => builder.addRevision(version.sha, texts[revision]!).approximate);
        const lineage = builder.result();
        expect(flags).toEqual(texts.map((text, revision) => budget === FORCE_FALLBACK && revision > 0 && nonTrivialMiddle(texts[revision - 1]!, text)));
        expect(lineage.approximatePairs).toBe(flags.filter(Boolean).length);
        expect(lineage.revisions).toEqual(versions.map(version => version.sha));
        texts.forEach((text, revision) => {
          expect(lineage.lineNodes[revision]!.length).toBe(text.length);
          text.forEach((line, index) => {
            const events = lineEvents(lineage, revision, index); const context = `seed ${seed} r${revision}:${index + 1}`;
            expect(events.length, context).toBe(lineage.nodeDepth[lineage.lineNodes[revision]![index]!]);
            expect(events.at(-1)!.text, context).toBe(line);
            expect(events[0]!.kind, context).not.toBe('edited');
            expect(events.slice(1).every(event => event.kind === 'edited'), context).toBe(true);
            const order = events.map(event => lineage.revisions.indexOf(event.sha));
            expect(order.every((value, i) => i === 0 || value > order[i - 1]!) && order.at(-1)! <= revision, context).toBe(true);
          });
        });
      }
    }
  }, 30_000);

  it('FR-SRC-004 result() is a snapshot and lineEvents returns [] out of range', () => {
    const builder = new LineageBuilder();
    builder.addRevision('a', ['one', 'two']);
    const first = builder.result();
    builder.addRevision('b', ['one', 'TWO', 'three']);
    expect(first.revisions).toEqual(['a']);
    expect(first.lineNodes).toHaveLength(1);
    expect(first.nodeParent).toHaveLength(2);
    expect(first.nodeText).toEqual(['one', 'two']);
    const second = builder.result();
    expect(second.nodeText).toEqual(['one', 'two', 'TWO', 'three']);
    expect(lineEvents(second, 1, 1).map(event => event.kind)).toEqual(['baseline', 'edited']);
    expect(lineEvents(second, 1, 2).map(event => event.kind)).toEqual(['added']);
    for (const [revision, line] of [[-1, 0], [2, 0], [0, -1], [0, 2], [0, 0.5], [Number.NaN, 0]] as const) {
      expect(lineEvents(second, revision, line)).toEqual([]);
    }
  });
});

describe('FR-SRC-003/004 large inputs', () => {
  it('FR-SRC-003 200,000 lines with ~2% scattered edits finish well under 10 s, exact or approximate', () => {
    const random = prng(2026);
    const before = Array.from({ length: 200_000 }, (_, i) => codeLine(random, i));
    const { after, edits } = scatter(random, before, 0.02);
    for (const budget of [EXACT_BUDGET, FORCE_FALLBACK]) {
      const started = performance.now();
      const diff = diffLineArrays(before, after, budget);
      expect(performance.now() - started).toBeLessThan(10_000);
      expect(violation(before, after, diff)).toBeNull();
      // Either pass: each edit changes at most two lines, so a sane alignment stays within twice the edit count.
      expect(changedLines(diff)).toBeLessThanOrEqual(2 * edits);
      if (budget === FORCE_FALLBACK) expect(diff.approximate).toBe(true);
    }
  }, 60_000);

  it('FR-SRC-003 two unrelated 50,000-line files skip the doomed exact pass and finish well under 10 s', () => {
    const random = prng(7);
    const before = Array.from({ length: 50_000 }, (_, i) => codeLine(random, i, 'left'));
    const after = Array.from({ length: 50_000 }, (_, i) => codeLine(random, i, 'right'));
    const started = performance.now();
    const diff = diffLineArrays(before, after);
    // The multiset lower bound (80% distinct statements on each side) exceeds maxEditLength, so the doomed exact pass
    // is skipped instead of burning its 2 s timeout.
    expect(performance.now() - started).toBeLessThan(1500);
    expect(diff.approximate).toBe(true);
    expect(violation(before, after, diff)).toBeNull();
  }, 60_000);

  it('FR-SRC-003 a shuffled 50,000-line file gives up at the time budget and falls back', () => {
    const random = prng(11);
    const before = Array.from({ length: 50_000 }, (_, i) => `unique line ${i}`);
    const after = before.slice();
    for (let i = after.length - 1; i > 0; i--) { const j = pick(random, i + 1); [after[i], after[j]] = [after[j]!, after[i]!]; }
    const started = performance.now();
    // Same multiset, so the lower bound lets the exact pass start; the 100 ms timeout must end it.
    const diff = diffLineArrays(before, after, { timeoutMs: 100 });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(diff.approximate).toBe(true);
    expect(violation(before, after, diff)).toBeNull();
  }, 60_000);

  it('FR-SRC-004 1,000 revisions of a 2,000-line file build quickly and create nodes only for changed lines', () => {
    const random = prng(1000); let serial = 0;
    const line = (): string => (random() < 0.8 ? `statement ${serial++}` : ['', '}', '  }', 'return;'][pick(random, 4)]!);
    let current = Array.from({ length: 2000 }, line);
    const builder = new LineageBuilder(); let insertedOrReplaced = 0;
    const started = performance.now();
    for (let v = 0; v < 1000; v++) {
      if (v > 0) {
        current = current.slice();
        for (let e = 1 + pick(random, 5); e > 0; e--) {
          const at = pick(random, current.length); const op = pick(random, 3);
          if (op === 0) { current.splice(at, 0, line()); insertedOrReplaced++; } else if (op === 1) current.splice(at, 1); else { current[at] = line(); insertedOrReplaced++; }
        }
      }
      builder.addRevision(`r${v}`, current);
    }
    const lineage = builder.result();
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(builder.size).toBe(1000);
    expect(lineage.approximatePairs).toBe(0);
    // A minimal diff adds at most the inserted or replaced lines, so nodes stay near the file size, not revisions × lines.
    expect(lineage.nodeParent.length).toBeLessThanOrEqual(2000 + insertedOrReplaced);
    for (const array of [lineage.nodeRevision, lineage.nodeLine, lineage.nodeKind, lineage.nodeDepth]) expect(array.length).toBe(lineage.nodeParent.length);
    expect(lineage.nodeText).toHaveLength(lineage.nodeParent.length);
    const last = lineage.lineNodes[999]!;
    expect(last.length).toBe(current.length);
    let deepest = 0;
    for (let i = 0; i < last.length; i++) {
      const events = lineEvents(lineage, 999, i);
      expect(events.length).toBe(lineage.nodeDepth[last[i]!]);
      expect(events.at(-1)!.text).toBe(current[i]);
      deepest = Math.max(deepest, events.length);
    }
    expect(deepest).toBeGreaterThan(1);
  }, 60_000);
});
