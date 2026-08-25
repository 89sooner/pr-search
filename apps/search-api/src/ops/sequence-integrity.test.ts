/**
 * 영향 추정과 확인 문자열 (WP-028 / API-ADM-007, CR-033 DEV-173).
 *
 * 이 파일이 지키는 주장: **파서로 판정한다**(문자열 검색이 아니다),
 * **좁히지 않은 검색은 보수적으로 센다**, **`seq`가 없으면 영향이 없다**.
 */

import { describe, expect, it } from 'vitest';
import { parseQuery } from '@prs/query';
import {
  confirmationMatches,
  countAffectedSavedSearches,
  isAffectedByReassign,
  parseIntegrityMode,
} from './sequence-integrity.js';

const REPO = 'acme/payments';
const BRANCH = 'main';
const judge = (query: string): boolean => isAffectedByReassign(parseQuery(query), REPO, BRANCH);

describe('재채번 영향 판정 (DEV-173)', () => {
  it('repo·base가 정확히 일치하면 영향받는다', () => {
    expect(judge('repo:acme/payments base:main seq:100..200')).toBe(true);
  });

  it('**repo가 없으면 보수적으로 센다** — 대상 저장소를 포함할 수 있다', () => {
    expect(judge('seq:100..200')).toBe(true);
    expect(judge('base:main seq:100..200')).toBe(true);
  });

  it('**base가 없어도 보수적으로 센다**', () => {
    expect(judge('repo:acme/payments seq:100..200')).toBe(true);
  });

  it('다른 저장소로 좁힌 검색은 제외한다', () => {
    expect(judge('repo:acme/risk seq:100..200')).toBe(false);
  });

  it('다른 브랜치로 좁힌 검색은 제외한다', () => {
    expect(judge('repo:acme/payments base:release/2026.08 seq:100..200')).toBe(false);
  });

  it('**seq 술어가 없으면 영향이 없다** — 재채번이 뜻을 바꾸지 않는다', () => {
    expect(judge('repo:acme/payments base:main author:kim')).toBe(false);
    expect(judge('repo:acme/payments')).toBe(false);
  });

  it('명시적으로 제외한 검색은 영향받지 않는다', () => {
    expect(judge('-repo:acme/payments seq:100..200')).toBe(false);
    expect(judge('-base:main seq:100..200')).toBe(false);
  });

  it('**인용 안의 `seq:`는 술어가 아니다** — 문자열 검색이었다면 오답이다', () => {
    // 본문에 seq: 가 들어 있을 뿐 seq 필터가 아니다.
    expect(judge('"fix seq: off-by-one"')).toBe(false);
  });
});

describe('countAffectedSavedSearches', () => {
  it('영향받는 것만 센다', () => {
    const queries = [
      'repo:acme/payments seq:100..200', // 후보
      'seq:1..5', // 후보 (좁히지 않음)
      'repo:acme/risk seq:1..5', // 다른 저장소
      'repo:acme/payments author:kim', // seq 없음
    ];
    expect(countAffectedSavedSearches(queries, REPO, BRANCH)).toBe(2);
  });

  it('**파싱 실패 질의는 세지 않는다** — 영향 수를 부풀리지 않는다', () => {
    // 이미 실행 불가능한 저장 검색이다.
    expect(countAffectedSavedSearches(['seq:'], REPO, BRANCH)).toBe(0);
  });

  it('저장 검색이 없으면 0이다 — 세어 보니 없는 것이다', () => {
    expect(countAffectedSavedSearches([], REPO, BRANCH)).toBe(0);
  });

  it('**문자열에 `seq:`가 있어도 술어가 아니면 세지 않는다** (DEV-173)', () => {
    // `includes('seq:')`로 구현하면 넷 다 오답이 된다.
    const queries = [
      '"fix seq: off-by-one"', // 인용 안의 본문
      '-repo:acme/payments seq:1..5', // 명시적으로 제외한 검색
      'repo:acme/risk seq:1..5', // 다른 저장소
      'repo:acme/payments base:release/2026.08 seq:1..5', // 다른 브랜치
    ];
    expect(countAffectedSavedSearches(queries, REPO, BRANCH)).toBe(0);
  });
});

describe('확인 문자열 (FLOW-008)', () => {
  it('정확히 같아야 한다', () => {
    expect(confirmationMatches('acme/payments', REPO)).toBe(true);
  });

  it('**다듬거나 대소문자를 무시하지 않는다** — 한 번 더 읽게 하는 것이 목적이다', () => {
    expect(confirmationMatches(' acme/payments ', REPO)).toBe(false);
    expect(confirmationMatches('ACME/payments', REPO)).toBe(false);
    expect(confirmationMatches('', REPO)).toBe(false);
    expect(confirmationMatches(undefined, REPO)).toBe(false);
    expect(confirmationMatches(123, REPO)).toBe(false);
  });
});

describe('mode 파싱', () => {
  it('기본은 sample이다 (FR-ADMIN-003 AC-1)', () => {
    expect(parseIntegrityMode(undefined)).toBe('sample');
    expect(parseIntegrityMode('')).toBe('sample');
  });

  it('full을 받는다', () => {
    expect(parseIntegrityMode('full')).toBe('full');
  });

  it('모르는 값은 조용히 기본값으로 넘기지 않는다', () => {
    expect(parseIntegrityMode('everything')).toBeNull();
  });
});
