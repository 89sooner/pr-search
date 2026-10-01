/**
 * CR-138 / WP-119 (DEV-804): a virtualized list taller than the browser allows is drawn compressed, so its end stays
 * reachable. Browsers cap an element's size (Chromium 2^25 px, Firefox near 17.9 million): before CR-138 a 1,955,858-line
 * file could not be scrolled past line 1,597,830.
 *
 * `windowAt` is the pure part of useVirtualWindow; `scrollToRow` (Find, change navigation, line jumps) must land where
 * `windowAt` draws the row.
 */
import { describe, expect, it } from 'vitest';

const { LINE_HEIGHT, MAX_SCROLL_EXTENT, listTopAt, scrollToRow, windowAt } = await import('../components/source/hooks');

function offsetsOf(rows: number, height = LINE_HEIGHT): Float64Array {
  const offsets = new Float64Array(rows + 1);
  for (let index = 0; index < rows; index += 1) offsets[index + 1] = offsets[index]! + height;
  return offsets;
}
const VIEWPORT = 800;
/** Where the viewport's top falls in the whole list for a scroll position (the mapping windowAt draws by). */
const logicalTop = (offsets: Float64Array, scrolled: number): number => listTopAt(scrolled, offsets[offsets.length - 1]!, VIEWPORT);

describe('CR-138 FR-SRC-003 compressed virtual scrolling past the browser size limit (DEV-804)', () => {
  const rows = 1_955_858;
  const offsets = offsetsOf(rows);
  const total = offsets[rows]!;

  it('CR-138 FR-SRC-003 the drawn extent never exceeds the cap, the spacers are never negative, and they fill it exactly', () => {
    expect(total).toBeGreaterThan(2 ** 25);
    for (const scrolled of [0, 1, 20, 21, 799, 800, 801, 12_345, 1_000_000, 7_500_000, MAX_SCROLL_EXTENT - 2 * VIEWPORT - 1, MAX_SCROLL_EXTENT - 2 * VIEWPORT, MAX_SCROLL_EXTENT - VIEWPORT - 900, MAX_SCROLL_EXTENT - VIEWPORT - 1, MAX_SCROLL_EXTENT - VIEWPORT]) {
      const window = windowAt(offsets, scrolled, VIEWPORT);
      expect(window.padTop).toBeGreaterThanOrEqual(0);
      expect(window.padBottom).toBeGreaterThanOrEqual(0);
      expect(window.padTop + (offsets[window.end]! - offsets[window.start]!) + window.padBottom).toBeCloseTo(MAX_SCROLL_EXTENT, 3);
      expect(window.end - window.start).toBeLessThan(200);
      // Every row inside the viewport is drawn, right up to either end of the list ...
      const top = logicalTop(offsets, scrolled);
      expect(window.start).toBeLessThanOrEqual(Math.floor(top / LINE_HEIGHT));
      expect(window.end).toBeGreaterThan(Math.min(rows - 1, Math.floor((top + VIEWPORT - 1) / LINE_HEIGHT)));
      // ... and drawn where the viewport shows it: the row at the viewport's top sits at the scroll position.
      const row = Math.floor(top / LINE_HEIGHT);
      expect(window.padTop + offsets[row]! - offsets[window.start]!).toBeCloseTo(scrolled - (top - offsets[row]!), 3);
    }
  });

  it('CR-138 FR-SRC-003 scrolled to the end, the last line is drawn at the bottom — the whole file is reachable', () => {
    const end = windowAt(offsets, MAX_SCROLL_EXTENT - VIEWPORT, VIEWPORT);
    expect(end.end).toBe(rows);
    expect(end.padBottom).toBeCloseTo(0, 3);
    expect(end.padTop + offsets[rows]! - offsets[end.start]!).toBeCloseTo(MAX_SCROLL_EXTENT, 3);
  });

  it('CR-138 FR-SRC-003 scrollToRow lands where windowAt draws the row — Find and line jumps reach the end of the file', () => {
    for (const index of [0, 1_000, 714_000, 1_000_000, 1_597_830, 1_597_831, rows - 1]) {
      const scroller = { clientHeight: VIEWPORT, clientWidth: 0, scrollTop: 0, scrollLeft: 0 } as unknown as HTMLElement;
      scrollToRow(scroller, offsets, index);
      // A browser clamps the scroll position to the scrollable range.
      const scrolled = Math.min(scroller.scrollTop, MAX_SCROLL_EXTENT - VIEWPORT);
      expect(scrolled).toBeLessThanOrEqual(MAX_SCROLL_EXTENT - VIEWPORT);
      const window = windowAt(offsets, scrolled, VIEWPORT);
      expect(window.start).toBeLessThanOrEqual(index);
      expect(window.end).toBeGreaterThan(index);
      const top = logicalTop(offsets, scrolled);
      expect(offsets[index]!).toBeGreaterThanOrEqual(top - 1e-6);
      expect(offsets[index + 1]!).toBeLessThanOrEqual(top + VIEWPORT + 1e-6);
    }
  });

  it('CR-138 FR-SRC-003 a list within the cap is drawn as before: spacers are the heights of the rows left out', () => {
    const small = offsetsOf(200_000);
    const height = small[200_000]!;
    for (const scrolled of [-500, 0, 21, 100_000, height - VIEWPORT, height + 300]) {
      const window = windowAt(small, scrolled, VIEWPORT);
      expect(window.padTop).toBe(small[window.start]);
      expect(window.padBottom).toBe(height - small[window.end]!);
    }
  });

  it('CR-138 FR-SRC-003 the same holds across a row laid out sideways (the narrow revision list) and for taller rows', () => {
    const wide = offsetsOf(100_000, 186);
    expect(wide[100_000]).toBeGreaterThan(MAX_SCROLL_EXTENT);
    const end = windowAt(wide, MAX_SCROLL_EXTENT - VIEWPORT, VIEWPORT);
    expect(end.end).toBe(100_000);
    const scroller = { clientHeight: 0, clientWidth: VIEWPORT, scrollTop: 0, scrollLeft: 0 } as unknown as HTMLElement;
    scrollToRow(scroller, wide, 99_999, 'x');
    expect(scroller.scrollTop).toBe(0);
    expect(windowAt(wide, Math.min(scroller.scrollLeft, MAX_SCROLL_EXTENT - VIEWPORT), VIEWPORT).end).toBe(100_000);
  });
});
