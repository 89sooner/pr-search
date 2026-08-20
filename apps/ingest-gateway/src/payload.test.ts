/** payload 정규화와 대체 멱등 키 (FR-ING-002 AC-4). */

import { describe, expect, it } from 'vitest';
import {
  canonicalHash,
  canonicalize,
  extractAction,
  extractRepositoryId,
  resolveDeliveryId,
} from './payload.js';

describe('FR-ING-002 AC-4: payload 정규화 해시', () => {
  it('키 순서가 달라도 같은 해시를 낸다', () => {
    expect(canonicalHash({ b: 1, a: 2 })).toBe(canonicalHash({ a: 2, b: 1 }));
  });

  it('중첩 객체의 키 순서도 정규화한다', () => {
    expect(canonicalHash({ x: { q: 1, p: 2 } })).toBe(canonicalHash({ x: { p: 2, q: 1 } }));
  });

  it('배열 순서는 의미가 있으므로 보존한다', () => {
    expect(canonicalHash({ commits: [1, 2] })).not.toBe(canonicalHash({ commits: [2, 1] }));
  });

  it('값이 다르면 다른 해시를 낸다', () => {
    expect(canonicalHash({ number: 1234 })).not.toBe(canonicalHash({ number: 1235 }));
  });

  it('원시값과 null을 다룬다', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(7)).toBe('7');
    expect(canonicalize('a')).toBe('"a"');
  });
});

describe('FR-ING-002 AC-4: 멱등 키 산출', () => {
  it('전달 식별자 헤더가 있으면 그대로 쓴다', () => {
    expect(resolveDeliveryId('72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5', 'abcd')).toBe(
      '72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5',
    );
  });

  it('헤더가 없으면 정규화 해시를 접두사와 함께 대체 키로 쓴다', () => {
    expect(resolveDeliveryId(undefined, 'abcd')).toBe('sha256:abcd');
    expect(resolveDeliveryId('', 'abcd')).toBe('sha256:abcd');
  });
});

describe('payload 필드 추출', () => {
  it('action과 repository.id를 읽는다', () => {
    const payload = { action: 'opened', repository: { id: 4021 } };
    expect(extractAction(payload)).toBe('opened');
    expect(extractRepositoryId(payload)).toBe(4021);
  });

  it('없는 필드는 null이다 — 저장은 그대로 진행한다', () => {
    expect(extractAction({ ref: 'refs/heads/main' })).toBeNull();
    expect(extractRepositoryId({ ref: 'refs/heads/main' })).toBeNull();
    expect(extractRepositoryId({ repository: { id: 'not-a-number' } })).toBeNull();
    expect(extractAction([])).toBeNull();
    expect(extractRepositoryId(null)).toBeNull();
  });
});
