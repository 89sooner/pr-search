/**
 * M 번호 공유 판정 (WP-074 FR-SEQ-008 AC-5 · AC-12, API-SEQ-007).
 */

import { describe, expect, it } from 'vitest';
import {
  MERGE_NUMBER_MAX,
  formatMergeNumber,
  isMergeNumberBlockReason,
  parseMergeNumber,
  repositoryCodeOf,
} from './mnumber.js';

describe('repositoryCodeOf (OD-009: 저장소 이름의 유일한 숫자 run)', () => {
  it('유일한 숫자 run이 코드다', () => {
    expect(repositoryCodeOf('smp1900')).toEqual({ kind: 'code', code: '1900' });
    expect(repositoryCodeOf('1900-core')).toEqual({ kind: 'code', code: '1900' });
  });

  it('선행 0을 보존한다 — 문자 그대로 일치가 계약이다', () => {
    expect(repositoryCodeOf('app007')).toEqual({ kind: 'code', code: '007' });
  });

  it('숫자가 없으면 코드를 지어내지 않는다', () => {
    expect(repositoryCodeOf('payments')).toEqual({ kind: 'unavailable', reason: 'no_digits' });
  });

  it('숫자 run이 둘 이상이면 임의로 고르지 않는다', () => {
    expect(repositoryCodeOf('svc12-v3')).toEqual({ kind: 'unavailable', reason: 'multiple_digit_runs' });
  });
});

describe('formatMergeNumber / parseMergeNumber', () => {
  it('왕복한다', () => {
    const text = formatMergeNumber('1900', 42);
    expect(text).toBe('M-1900-42');
    expect(parseMergeNumber(text)).toEqual({ code: '1900', number: 42 });
  });

  it('상한 값은 통과하고 그 위는 실패한다 (C4 safe-integer 경계)', () => {
    expect(parseMergeNumber(`M-1-${String(MERGE_NUMBER_MAX)}`)).toEqual({ code: '1', number: MERGE_NUMBER_MAX });
    expect(parseMergeNumber('M-1-9007199254740992')).toBeNull();
    expect(parseMergeNumber('M-1-99999999999999999999')).toBeNull();
  });

  it.each(['M-1-0', 'M-1-01', 'M-1--1', 'M-1-1.5', 'M-1-1e3', ' M-1-1', 'M-1-1 ', 'M--1', 'm-1-1', 'M-1-1x'])(
    '형식 밖은 null이다: %s',
    (text) => {
      expect(parseMergeNumber(text)).toBeNull();
    },
  );

  it('format은 범위 밖 번호를 던진다 — 반올림한 값을 내보내지 않는다', () => {
    expect(() => formatMergeNumber('1', 0)).toThrow(RangeError);
    expect(() => formatMergeNumber('1', 1.5)).toThrow(RangeError);
    expect(() => formatMergeNumber('1', MERGE_NUMBER_MAX + 2)).toThrow(RangeError);
  });
});

describe('isMergeNumberBlockReason', () => {
  it('고정 enum만 참이다', () => {
    expect(isMergeNumberBlockReason('pr_evidence_pending')).toBe(true);
    expect(isMergeNumberBlockReason('mapping_conflict')).toBe(true);
    expect(isMergeNumberBlockReason('some exception text')).toBe(false);
  });
});
