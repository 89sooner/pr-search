/** WP-074 FR-SEQ-008 AC-14 — 측정 CLI 인자 계약 (측정 가이드 4절). */

import { describe, expect, it } from 'vitest';
import { ArgumentError, MAX_WINDOW_MS, parseArgs, parseRepository, parseSeconds, parseWindow } from './args.js';

describe('parseWindow', () => {
  it('양의 정수와 h·d만 받는다', () => {
    expect(parseWindow('24h')).toBe(24 * 60 * 60 * 1_000);
    expect(parseWindow('7d')).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(parseWindow('30d')).toBe(MAX_WINDOW_MS);
  });

  it.each(['0d', '-1d', '1.5d', '24', '24m', '24H', ' 24h', '01d', '31d'])('그 밖은 거절한다: %s', (raw) => {
    expect(() => parseWindow(raw)).toThrow(ArgumentError);
  });
});

describe('parseSeconds', () => {
  it('경계값을 포함해 받는다', () => {
    expect(parseSeconds('1s', '--timeout', 1, 600)).toBe(1_000);
    expect(parseSeconds('600s', '--timeout', 1, 600)).toBe(600_000);
    expect(parseSeconds('30s', '--poll', 1, 30)).toBe(30_000);
  });

  it.each([
    ['601s', '--timeout', 1, 600],
    ['0s', '--timeout', 1, 600],
    ['31s', '--poll', 1, 30],
    ['2', '--poll', 1, 30],
    ['2m', '--poll', 1, 30],
  ] as const)('범위·형식 밖은 거절한다: %s', (raw, flag, min, max) => {
    expect(() => parseSeconds(raw, flag, min, max)).toThrow(ArgumentError);
  });
});

describe('parseRepository', () => {
  it('owner/name만 받는다 — URL·사내 주소를 받지 않는다', () => {
    expect(parseRepository('acme/smp1900')).toBe('acme/smp1900');
    for (const raw of ['acme', 'acme/', '/name', 'https://ghe.example.com/acme/smp1900', 'acme/smp 1900']) {
      expect(() => parseRepository(raw), raw).toThrow(ArgumentError);
    }
  });
});

describe('parseArgs', () => {
  it('baseline 기본은 7d·table이다', () => {
    expect(parseArgs(['baseline'])).toEqual({ mode: 'baseline', windowMs: parseWindow('7d'), format: 'table', detailed: false });
  });

  it('report 기본은 24h·new_squash다', () => {
    expect(parseArgs(['report'])).toMatchObject({ mode: 'report', windowMs: parseWindow('24h'), cohort: 'new_squash' });
  });

  it('cohort는 고정 목록만 받는다', () => {
    expect(parseArgs(['report', '--cohort', 'all'])).toMatchObject({ cohort: 'all' });
    expect(() => parseArgs(['report', '--cohort', 'everything'])).toThrow(ArgumentError);
  });

  it('watch는 세 인자를 요구하고 PR 번호 범위를 검사한다', () => {
    const args = parseArgs(['watch', '--repository', 'acme/smp1900', '--base-branch', 'main', '--pr-number', '21', '--format', 'json']);
    expect(args).toMatchObject({ mode: 'watch', repository: 'acme/smp1900', baseBranch: 'main', prNumber: 21, format: 'json' });
    expect(() => parseArgs(['watch', '--repository', 'acme/smp1900', '--base-branch', 'main'])).toThrow(ArgumentError);
    for (const bad of ['0', '-1', '1.5', '2147483648', ' 21']) {
      expect(() => parseArgs(['watch', '--repository', 'acme/smp1900', '--base-branch', 'main', '--pr-number', bad]), bad).toThrow(ArgumentError);
    }
  });

  it('알 수 없는 모드와 빠진 값, 중복 플래그를 거절한다', () => {
    expect(() => parseArgs([])).toThrow(ArgumentError);
    expect(() => parseArgs(['measure'])).toThrow(ArgumentError);
    expect(() => parseArgs(['report', '--window'])).toThrow(ArgumentError);
    expect(() => parseArgs(['report', '--window', '24h', '--window', '7d'])).toThrow(ArgumentError);
  });

  it('--format은 table·json만 받는다', () => {
    expect(() => parseArgs(['report', '--format', 'yaml'])).toThrow(ArgumentError);
  });
});
