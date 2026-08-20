import { describe, expect, it } from 'vitest';
import {
  FIRST_MERGE_SEQ,
  FULL_SHA_LENGTH,
  MAX_GRAPH_DEPTH,
  MAX_GRAPH_NODES,
  MAX_RANGE_SIZE,
  MAX_TIME_BUCKETS,
  MIN_QUERY_LENGTH,
  MIN_SHA_PREFIX_LENGTH,
} from './constants.js';

describe('도메인 상수', () => {
  it('축약 SHA 접두 검색은 최소 7자다 (ADR-012)', () => {
    expect(MIN_SHA_PREFIX_LENGTH).toBe(7);
    expect(MIN_SHA_PREFIX_LENGTH).toBeLessThan(FULL_SHA_LENGTH);
  });

  it('시퀀스 서수는 1부터 시작한다 (ADR-007)', () => {
    expect(FIRST_MERGE_SEQ).toBe(1);
  });

  it('조회 상한이 오류 코드 표와 일치한다 (API 계약 6장)', () => {
    expect(MAX_RANGE_SIZE).toBe(50_000);
    expect(MAX_TIME_BUCKETS).toBe(400);
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it('그래프 탐색 상한이 ADR-009와 일치한다', () => {
    expect(MAX_GRAPH_DEPTH).toBe(3);
    expect(MAX_GRAPH_NODES).toBe(300);
  });
});
