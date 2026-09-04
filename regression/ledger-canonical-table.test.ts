/**
 * 원장의 정본 표가 온전하다 (DEV-545 / PR #146 머지 후 리뷰 P1).
 *
 * `CLAUDE.md`는 3장 「WP 진행 상태」를 **진행 상태의 유일한 정본**으로 정한다. 그 표에
 * 다른 스키마의 행이 섞이면 상태를 읽는 사람과 도구가 없는 작업 패키지를 보게 된다.
 *
 * 실제로 그렇게 됐다. 5장 DEV 표에 행을 넣으려고 **표 구분선을 앵커로** 썼는데,
 * 8칸 구분선 `| --- |` × 8의 오프셋 6부터가 7칸 패턴과 **정확히 일치**한다. 그래서
 * 치환이 3장 구분선 중간을 갈라 DEV 행을 끼워 넣었다. 마크다운 표에서 구분선은
 * 앵커가 될 수 없다 — 칸 수가 달라도 부분 일치한다.
 *
 * Refs: DEV-545 DEV-399
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LEDGER = readFileSync(
  join(resolve(__dirname, '..'), 'docs/40_delivery/pr_search_implementation_traceability.md'),
  'utf8',
);

/** 표의 칸 수. 앞뒤 파이프를 뺀 실제 칸 개수다. */
const columns = (row: string): number => row.split('|').length - 2;

describe('원장의 정본 표가 온전하다 (DEV-545)', () => {
  it('3장 WP 진행 상태 표의 모든 행이 헤더와 같은 칸 수다', () => {
    const lines = LEDGER.split(/\r?\n/);
    const start = lines.findIndex((l) => l.startsWith('| WP ID'));
    expect(start).toBeGreaterThan(-1);

    const width = columns(lines[start]);
    expect(width).toBe(8);

    const offenders: string[] = [];
    for (let i = start; i < lines.length && lines[i].startsWith('|'); i += 1) {
      if (columns(lines[i]) !== width) offenders.push(`${i + 1}행(${columns(lines[i])}칸): ${lines[i].slice(0, 60)}`);
    }
    // 정본 표에 다른 스키마의 행이 섞이면 없는 WP가 상태 표에 나타난다.
    expect(offenders).toEqual([]);
  });

  it('3장 표에는 DEV 행이 없다 — DEV는 5장의 것이다', () => {
    const lines = LEDGER.split(/\r?\n/);
    const start = lines.findIndex((l) => l.startsWith('| WP ID'));
    const wpRows: string[] = [];
    for (let i = start; i < lines.length && lines[i].startsWith('|'); i += 1) wpRows.push(lines[i]);
    expect(wpRows.filter((r) => r.startsWith('| DEV-'))).toEqual([]);
  });
});
