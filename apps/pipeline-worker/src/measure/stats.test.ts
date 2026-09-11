/**
 * WP-074 FR-SEQ-008 AC-14 — 표본 분류와 percentile (측정 가이드 3·5·8절).
 *
 * 기대값은 **독립 상수**다: `[100,200,300,400]`의 `percentile_disc`는
 * p50=200 · p95=400 · p99=400 · max=400이다 (가이드 8절이 지정한 검증).
 */

import { describe, expect, it } from 'vitest';
import { percentileDisc, spaceLabel, summarizeStage, type SampleTimes } from './stats.js';

const at = (ms: number): Date => new Date(1_000_000 + ms);

function sample(partial: Partial<SampleTimes> = {}): SampleTimes {
  return {
    outcome: 'visible',
    reason: null,
    receivedAt: at(0),
    mirrorCompletedAt: at(50),
    sequenceAssignedAt: at(100),
    mnumberAssignedAt: at(200),
    searchObservedAt: at(300),
    ...partial,
  };
}

describe('percentileDisc — 보간하지 않고 실제 값 하나를 고른다', () => {
  it('**[100,200,300,400] → p50=200 · p95=400 · p99=400** (가이드 8절 독립 상수)', () => {
    const sorted = [100, 200, 300, 400];
    expect(percentileDisc(sorted, 0.5)).toBe(200);
    expect(percentileDisc(sorted, 0.95)).toBe(400);
    expect(percentileDisc(sorted, 0.99)).toBe(400);
  });

  it('빈 표본은 null이다 — 0이 아니다', () => {
    expect(percentileDisc([], 0.5)).toBeNull();
  });

  it('표본 하나면 모든 분위가 그 값이다', () => {
    expect(percentileDisc([7], 0.5)).toBe(7);
    expect(percentileDisc([7], 0.99)).toBe(7);
  });
});

describe('summarizeStage — 분류는 서로 배타적이고 합이 요청 수다', () => {
  it('정상 표본만 percentile 분모에 들어간다', () => {
    const stats = summarizeStage('received_to_mnumber', [
      sample({ mnumberAssignedAt: at(100) }),
      sample({ mnumberAssignedAt: at(200) }),
      sample({ mnumberAssignedAt: at(300) }),
      sample({ mnumberAssignedAt: at(400) }),
    ]);
    expect(stats).toMatchObject({ requests: 4, valid_samples: 4, p50: 200, p95: 400, p99: 400, max: 400 });
    expect(stats.missing + stats.failed + stats.pending + stats.clock_anomaly_count).toBe(0);
  });

  it('**음수는 0으로 접지 않고 따로 센다** — 시계 이상이 빠른 것으로 읽히면 안 된다', () => {
    const stats = summarizeStage('received_to_mnumber', [
      sample({ mnumberAssignedAt: at(100) }),
      sample({ receivedAt: at(500), mnumberAssignedAt: at(465) }),
    ]);
    expect(stats.valid_samples).toBe(1);
    expect(stats.clock_anomaly_count).toBe(1);
    expect(stats.clock_anomaly_min_ms).toBe(-35);
    expect(stats.p50).toBe(100);
  });

  it('끝나지 않은 것과 잴 수 없는 것을 가른다', () => {
    const stats = summarizeStage('received_to_mnumber', [
      sample({ outcome: 'pending', mnumberAssignedAt: null }),
      sample({ outcome: 'failed', mnumberAssignedAt: null }),
      // 수신 시각을 증명하지 못한 표본 — 시작이 없으면 잴 수 없다.
      sample({ outcome: 'visible', receivedAt: null }),
    ]);
    expect(stats).toMatchObject({ requests: 3, valid_samples: 0, pending: 1, failed: 1, missing: 1 });
    expect(stats.p50).toBeNull();
    expect(stats.max).toBeNull();
  });

  it('모든 분류의 합이 요청 수와 같다', () => {
    const samples = [
      sample(),
      sample({ outcome: 'pending', searchObservedAt: null }),
      sample({ outcome: 'failed', searchObservedAt: null }),
      sample({ receivedAt: at(900) }),
      sample({ receivedAt: null }),
    ];
    const stats = summarizeStage('received_to_search_observed', samples);
    expect(stats.valid_samples + stats.missing + stats.failed + stats.pending + stats.clock_anomaly_count).toBe(stats.requests);
    expect(stats.requests).toBe(samples.length);
  });

  it('mnumber_to_search_observed는 M 부여 시각을 시작으로 쓴다', () => {
    const stats = summarizeStage('mnumber_to_search_observed', [sample({ mnumberAssignedAt: at(200), searchObservedAt: at(275) })]);
    expect(stats.p50).toBe(75);
  });
});

describe('spaceLabel — 외부 보고에 내부 식별자를 싣지 않는다', () => {
  it('해시 앞자리로 만든 라벨이며 저장소 이름을 담지 않는다', () => {
    const label = spaceLabel('6e91abcd');
    expect(label).toBe('space-6e91');
    expect(label).not.toContain('acme');
  });
});
