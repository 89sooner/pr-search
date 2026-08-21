/**
 * 해석 질의의 **모양** (WP-014 / ADR-012, 데이터 모델 6장).
 *
 * 결과가 같아도 모양이 다르면 비용이 다르다. 40자 SHA를 `prefix`로 물어도
 * 답은 같지만 — 40자 전체가 접두면 일치하는 term이 하나뿐이므로 — 데이터 모델
 * 6장이 그 조회에 잡은 예산은 `term`의 p95 100ms다. 실측 시험이 없는 지금
 * 그 결정을 지키는 것은 이 모양 시험뿐이다.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_PREFIX_CANDIDATES,
  PR_SHA_FIELDS,
  commitDetailQuery,
  commitExactQuery,
  commitPrefixQuery,
  pullRequestDetailQuery,
  pullRequestQuery,
  pullRequestsByNumbersQuery,
  shaFallbackQuery,
} from './resolve-query.js';

const SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';

describe('40자와 접두는 다른 질의다 (ADR-012)', () => {
  it('40자는 `term`이다 — `prefix`가 아니다', () => {
    expect(commitExactQuery(SHA)).toEqual({ term: { commit_sha: SHA } });
    expect(Object.keys(commitExactQuery(SHA))).toEqual(['term']);
  });

  it('7~39자는 `prefix`다', () => {
    expect(commitPrefixQuery('a3f9c21')).toEqual({ prefix: { commit_sha: 'a3f9c21' } });
    expect(Object.keys(commitPrefixQuery('a3f9c21'))).toEqual(['prefix']);
  });

  it('접두 상한이 FR-SRCH-004 AC-3의 50이다', () => {
    expect(MAX_PREFIX_CANDIDATES).toBe(50);
  });
});

describe('저장소 조건은 빠지면 안 된다', () => {
  it('PR 조회에 저장소가 있으면 조건이 둘이다', () => {
    expect(pullRequestQuery(1234, 'acme/payments')).toEqual({
      bool: { filter: [{ term: { pr_number: 1234 } }, { term: { repository: 'acme/payments' } }] },
    });
  });

  it('저장소가 없으면 번호만 본다 — 접근 범위 안에서 후보를 찾는다', () => {
    expect(pullRequestQuery(1234, null)).toEqual({
      bool: { filter: [{ term: { pr_number: 1234 } }] },
    });
  });

  it('커밋 상세는 저장소와 SHA를 함께 본다', () => {
    // 저장소를 빼면 다른 저장소의 같은 SHA가 나온다.
    const filter = (commitDetailQuery('acme/payments', SHA) as { bool: { filter: unknown[] } }).bool.filter;
    expect(filter).toContainEqual({ term: { repository: 'acme/payments' } });
    expect(filter).toContainEqual({ term: { commit_sha: SHA } });
  });

  it('PR 상세도 저장소와 번호를 함께 본다', () => {
    const filter = (pullRequestDetailQuery('acme/payments', 1234) as { bool: { filter: unknown[] } }).bool.filter;
    expect(filter).toContainEqual({ term: { repository: 'acme/payments' } });
    expect(filter).toContainEqual({ term: { pr_number: 1234 } });
  });

  it('번호 여럿 조회도 저장소로 좁힌다', () => {
    const filter = (pullRequestsByNumbersQuery('acme/payments', [1, 2]) as { bool: { filter: unknown[] } }).bool.filter;
    expect(filter).toContainEqual({ term: { repository: 'acme/payments' } });
    expect(filter).toContainEqual({ terms: { pr_number: [1, 2] } });
  });
});

describe('40자 hex 폴백 (백엔드 아키텍처 4.5)', () => {
  it('PR 문서의 SHA 필드 셋을 모두 본다', () => {
    expect([...PR_SHA_FIELDS]).toEqual(['merge_commit_sha', 'head_sha', 'base_sha']);
  });

  it('셋을 OR로 묶는다', () => {
    const clause = shaFallbackQuery(SHA) as { bool: { should: unknown[]; minimum_should_match: number } };
    expect(clause.bool.minimum_should_match).toBe(1);
    expect(clause.bool.should).toHaveLength(3);
    for (const field of PR_SHA_FIELDS) {
      expect(clause.bool.should).toContainEqual({ term: { [field]: SHA } });
    }
  });

  it('폴백은 `term`이다 — 접두 폴백을 열면 왕복이 인덱스 둘로 늘어난다', () => {
    const clause = shaFallbackQuery(SHA) as { bool: { should: Record<string, unknown>[] } };
    for (const one of clause.bool.should) {
      expect(Object.keys(one)).toEqual(['term']);
    }
  });
});
