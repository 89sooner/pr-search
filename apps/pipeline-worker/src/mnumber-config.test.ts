/** WP-074 FR-SEQ-008 — 배포 설정은 잘못된 값으로 조용히 돌지 않는다. */

import { describe, expect, it } from 'vitest';
import { resolveMergeNumberConfig, resolveSequenceGraphMode } from './mnumber-config.js';

describe('resolveSequenceGraphMode', () => {
  it('기본은 mirror이고 api를 받는다', () => {
    expect(resolveSequenceGraphMode({})).toBe('mirror');
    expect(resolveSequenceGraphMode({ SEQUENCE_GRAPH_MODE: 'api' })).toBe('api');
    expect(resolveSequenceGraphMode({ SEQUENCE_GRAPH_MODE: ' mirror ' })).toBe('mirror');
  });

  it('그 밖의 값은 기동을 거부한다 — 조용히 API로 바꾸지 않는다', () => {
    expect(() => resolveSequenceGraphMode({ SEQUENCE_GRAPH_MODE: 'auto' })).toThrow(/SEQUENCE_GRAPH_MODE/);
  });
});

describe('resolveMergeNumberConfig', () => {
  it('기본값: 꺼짐, batch 100, poll 1초, retry 60초, squash_only', () => {
    expect(resolveMergeNumberConfig({})).toEqual({
      enabled: false,
      batchSize: 100,
      pollMs: 1_000,
      retryMaxMs: 60_000,
      profile: 'squash_only',
    });
  });

  it('true만 켠다', () => {
    expect(resolveMergeNumberConfig({ MNUMBER_ENABLED: 'true' }).enabled).toBe(true);
    expect(() => resolveMergeNumberConfig({ MNUMBER_ENABLED: '1' })).toThrow(/MNUMBER_ENABLED/);
  });

  it.each([
    ['MNUMBER_BATCH_SIZE', '0'],
    ['MNUMBER_BATCH_SIZE', '1001'],
    ['MNUMBER_POLL_MS', '50'],
    ['MNUMBER_POLL_MS', '1.5'],
    ['MNUMBER_RETRY_MAX_MS', 'x'],
  ])('%s=%s는 거부한다', (key, value) => {
    expect(() => resolveMergeNumberConfig({ [key]: value })).toThrow(new RegExp(key));
  });

  it('프로파일은 squash_only만 받는다 (AC-9)', () => {
    expect(() => resolveMergeNumberConfig({ MNUMBER_PROFILE: 'merge_commit' })).toThrow(/MNUMBER_PROFILE/);
  });
});
