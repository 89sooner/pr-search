/**
 * 저장된 검색 서비스의 순수 부분 (WP-033 / API-SRCH-005).
 *
 * 자원 표현과 질의 판정은 데이터베이스 없이 확인할 수 있고, 그래서 여기 있다.
 * 목록·실행처럼 정본을 읽는 것은 통합 시험이 실제 PostgreSQL로 건다.
 */

import { describe, expect, it } from 'vitest';
import type { SavedSearchRow } from '@prs/db';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampPageSize,
  judgeQuery,
  navigationUrlFor,
  toResource,
} from './service.js';

function row(overrides: Partial<SavedSearchRow> = {}): SavedSearchRow {
  return {
    saved_search_id: 7,
    owner_user_id: 'sub-alice',
    owner_login: 'alice',
    name: '결제 리뷰',
    query: 'repo:acme/payments',
    seq_epoch: null,
    visibility: 'private',
    team_id: null,
    team_slug: null,
    team_org_id: null,
    created_at: '2026-08-27T09:00:00.123456Z',
    last_run_at: null,
    ...overrides,
  };
}

describe('자원 표현', () => {
  it('private에는 대상 팀이 없다', () => {
    expect(toResource(row(), 'sub-alice').target_team).toBeUndefined();
  });

  it('team이면 `team_id`·`org_id`·`slug`이 함께 실린다', () => {
    const resource = toResource(
      row({ visibility: 'team', team_id: 101, team_slug: 'payments', team_org_id: 7 }),
      'sub-alice',
    );
    expect(resource.target_team).toEqual({ team_id: 101, org_id: 7, slug: 'payments' });
  });

  it('**`is_owner`는 요청한 사람 기준이다**', () => {
    expect(toResource(row(), 'sub-alice').is_owner).toBe(true);
    expect(toResource(row(), 'sub-bob').is_owner).toBe(false);
  });

  it('**저장자의 접근 범위를 담지 않는다** (AC-3)', () => {
    const serialized = JSON.stringify(toResource(row(), 'sub-alice'));
    for (const forbidden of ['access_scope', 'repository_ids', 'scope_kind']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('**시각을 그대로 옮긴다** — 재포맷하면서 정밀도를 잃지 않는다', () => {
    expect(toResource(row(), 'sub-alice').created_at).toBe('2026-08-27T09:00:00.123456Z');
  });

  it('유효한 질의는 `valid`이고 오류를 싣지 않는다', () => {
    const resource = toResource(row(), 'sub-alice');
    expect(resource.query_status).toBe('valid');
    expect(resource.query_error).toBeUndefined();
  });

  it('**무효한 질의는 `invalid`이고 오류 위치를 함께 준다** (AC-6)', () => {
    const resource = toResource(row({ query: 'nosuchkey:value' }), 'sub-alice');
    expect(resource.query_status).toBe('invalid');
    expect(resource.query_error?.code).toBe('QUERY_SYNTAX_ERROR');
    expect(resource.query_error?.detail.offset_start).toBeTypeOf('number');
    expect(resource.query_error?.detail.supported_keys).toContain('repo');
  });

  it('**질의를 자동으로 고치지 않는다** — 무효한 값이 그대로 남는다', () => {
    expect(toResource(row({ query: 'nosuchkey:value' }), 'sub-alice').query).toBe('nosuchkey:value');
  });
});

describe('질의 판정', () => {
  it('빈 질의는 유효하다 — 조건 없는 목록도 저장할 수 있다', () => {
    expect(judgeQuery('')).toBeNull();
  });

  it('구조화 질의를 판정한다', () => {
    expect(judgeQuery('repo:acme/payments author:kim')).toBeNull();
  });

  it('지원하지 않는 키는 지원 키 목록과 함께 거절한다', () => {
    const error = judgeQuery('nosuchkey:value');
    expect(error?.code).toBe('QUERY_SYNTAX_ERROR');
    expect(error?.detail.supported_keys).toBeDefined();
  });
});

describe('페이지 크기', () => {
  it('없으면 기본값이다', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize('')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('상한을 넘으면 자른다 — 거절할 만큼 무거운 사실이 아니다', () => {
    expect(clampPageSize('1000')).toBe(MAX_PAGE_SIZE);
  });

  it('숫자가 아니거나 1 미만이면 기본값이다', () => {
    expect(clampPageSize('abc')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize('0')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize('-5')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('소수는 내림한다', () => {
    expect(clampPageSize('10.9')).toBe(10);
  });
});

describe('이동 대상', () => {
  it('질의를 URL로 부호화한다', () => {
    expect(navigationUrlFor('repo:acme/payments', null)).toBe('/search?q=repo%3Aacme%2Fpayments');
  });

  it('**공백과 한글도 안전하게 실린다**', () => {
    expect(navigationUrlFor('repo:acme/a 결제 재시도', null)).toBe(
      `/search?q=${encodeURIComponent('repo:acme/a 결제 재시도')}`,
    );
  });

  it('**에폭이 없으면 파라미터를 지어내지 않는다**', () => {
    const url = navigationUrlFor('repo:acme/a', null);
    expect(url.split('?')[1]?.split('&')).toHaveLength(1);
  });

  it('**저장된 에폭을 그대로 싣는다** — 현재 값으로 바꾸지 않는다 (CR-051)', () => {
    /*
     * 낡은 에폭이어도 그대로 간다. 무효를 판정하고 보이는 것은 W-001의
     * 일이며, 여기서 현재 값을 붙이면 사용자가 그 사실을 볼 기회 없이
     * 다른 세대의 결과에 도착한다.
     */
    expect(navigationUrlFor('repo:acme/a base:main seq:1..5', 3)).toBe(
      `/search?q=${encodeURIComponent('repo:acme/a base:main seq:1..5')}&seq_epoch=3`,
    );
  });
});
