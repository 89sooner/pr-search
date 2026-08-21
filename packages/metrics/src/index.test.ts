/**
 * 노출 형식 (WP-010).
 *
 * 세 앱이 손으로 복제해 두었던 구현을 한 곳으로 모았으므로, 여기서 형식이
 * 깨지면 세 앱이 함께 깨진다. Prometheus 텍스트 규약의 어긋나기 쉬운 지점을
 * 고정한다 — 라벨 정렬, 빈 시계열, 누적 버킷.
 */

import { describe, expect, it } from 'vitest';
import { Counter, Gauge, Histogram, renderMetrics } from './index.js';

describe('Counter', () => {
  it('관측이 없어도 시계열을 낸다', () => {
    // 없는 것과 0인 것을 구분하지 못하면 "수집이 멈췄다" 경보가 스크레이프
    // 시작 전까지 뜨지 않는다.
    expect(new Counter('a_total', 'help').render()).toContain('\na_total 0');
  });

  it('라벨을 이름순으로 정렬해 낸다', () => {
    const counter = new Counter('a_total', 'help');
    counter.inc({ zeta: '1', alpha: '2' });
    expect(counter.render()).toContain('a_total{alpha="2",zeta="1"} 1');
  });

  it('같은 라벨 조합을 누적한다', () => {
    const counter = new Counter('a_total', 'help');
    counter.inc({ stage: 'enrich' });
    counter.inc({ stage: 'enrich' }, 4);
    counter.inc({ stage: 'project' });
    expect(counter.get({ stage: 'enrich' })).toBe(5);
    expect(counter.get({ stage: 'project' })).toBe(1);
    expect(counter.get({ stage: '없음' })).toBe(0);
  });
});

describe('Histogram', () => {
  it('버킷이 누적이다 — 작은 값은 큰 상한에도 들어간다', () => {
    const histogram = new Histogram('h_seconds', 'help', [1, 10]);
    histogram.observe(0.5);
    expect(histogram.countAtOrBelow(1)).toBe(1);
    expect(histogram.countAtOrBelow(10)).toBe(1);
  });

  it('상한을 넘은 관측은 어느 버킷에도 없지만 총계에는 있다', () => {
    const histogram = new Histogram('h_seconds', 'help', [1]);
    histogram.observe(99);
    expect(histogram.countAtOrBelow(1)).toBe(0);
    expect(histogram.count()).toBe(1);

    const text = histogram.render();
    expect(text).toContain('h_seconds_bucket{le="1"} 0');
    expect(text).toContain('h_seconds_bucket{le="+Inf"} 1');
    expect(text).toContain('h_seconds_sum 99');
    expect(text).toContain('h_seconds_count 1');
  });

  it('관측이 없어도 시계열을 낸다', () => {
    const text = new Histogram('h_seconds', 'help', [1]).render();
    expect(text).toContain('h_seconds_bucket{le="+Inf"} 0');
    expect(text).toContain('h_seconds_count 0');
  });

  it('라벨별로 따로 센다', () => {
    const histogram = new Histogram('h_seconds', 'help', [10]);
    histogram.observe(1, { stage: 'enrich' });
    histogram.observe(2, { stage: 'project' });
    expect(histogram.count({ stage: 'enrich' })).toBe(1);
    expect(histogram.render()).toContain('h_seconds_bucket{stage="enrich",le="10"} 1');
  });
});

describe('Gauge', () => {
  it('누적하지 않고 덮어쓴다', () => {
    const gauge = new Gauge('g', 'help');
    gauge.set(5, { state: 'pending' });
    gauge.set(2, { state: 'pending' });
    expect(gauge.get({ state: 'pending' })).toBe(2);
  });

  it('replace는 사라진 라벨을 남기지 않는다', () => {
    // 상태가 비면 그 시계열이 마지막 값에 얼어붙는다. 실패 대기열이 비었는데
    // `held 3`이 계속 보이면 경보가 영영 풀리지 않는다.
    const gauge = new Gauge('g', 'help');
    gauge.replace([
      { labels: { state: 'pending' }, value: 3 },
      { labels: { state: 'held' }, value: 1 },
    ]);
    gauge.replace([{ labels: { state: 'pending' }, value: 0 }]);

    const text = gauge.render();
    expect(text).toContain('g{state="pending"} 0');
    expect(text).not.toContain('held');
  });
});

describe('renderMetrics', () => {
  it('지표를 개행으로 잇고 끝에 개행 하나를 붙인다', () => {
    const counter = new Counter('a_total', 'help');
    const gauge = new Gauge('b', 'help');
    const text = renderMetrics([counter, gauge]);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('# TYPE a_total counter');
    expect(text).toContain('# TYPE b gauge');
  });
});
