import { describe, expect, it } from 'vitest';
import {
  COMPUTED_LINK_TYPES,
  LINK_CONFIDENCES,
  LINK_TYPES,
  STORED_LINK_TYPES,
  isComputedLinkType,
  isStoredLinkType,
} from './links.js';

describe('관계 간선 어휘 (ADR-009, 데이터 모델 4.3)', () => {
  it('간선 유형 어휘는 7종이다', () => {
    expect([...LINK_TYPES]).toEqual([
      'contains',
      'precedes',
      'references',
      'reverts',
      'cherry_picks',
      'stacks_on',
      'co_changes',
    ]);
  });

  it('실제 저장하는 간선은 5종이다', () => {
    expect(STORED_LINK_TYPES).toHaveLength(5);
    expect([...STORED_LINK_TYPES]).not.toContain('precedes');
    expect([...STORED_LINK_TYPES]).not.toContain('co_changes');
  });

  it('저장 간선과 계산 간선이 어휘 전체를 겹침 없이 덮는다', () => {
    const union = new Set([...STORED_LINK_TYPES, ...COMPUTED_LINK_TYPES]);
    expect(union).toEqual(new Set(LINK_TYPES));
    expect(union.size).toBe(LINK_TYPES.length);
  });

  it('유형 판별 함수가 저장/계산을 배타적으로 나눈다', () => {
    for (const type of LINK_TYPES) {
      expect(isStoredLinkType(type)).toBe(!isComputedLinkType(type));
    }
  });

  it('신뢰도는 exact / derived / heuristic 3단계다', () => {
    expect([...LINK_CONFIDENCES]).toEqual(['exact', 'derived', 'heuristic']);
  });
});
