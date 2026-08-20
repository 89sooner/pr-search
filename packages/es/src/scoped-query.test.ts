import type { Client } from '@elastic/elasticsearch';
import { describe, expect, it } from 'vitest';
import {
  AccessScopeUnavailableError,
  EXPLICIT_SCOPE_LIMIT,
  applyMandatoryScopeFilter,
  shouldUseOrgTeamScope,
} from './scoped-query.js';
import type { AccessScope } from './scoped-query.js';
import { search } from './search.js';

describe('필수 접근 범위 필터 (ADR-008, FR-AUTH-002)', () => {
  const explicit: AccessScope = { kind: 'explicit', repositoryIds: [1001, 1002] };

  it('명시적 범위를 repository_id terms 필터로 결합한다', () => {
    const scoped = applyMandatoryScopeFilter({ match_all: {} }, explicit);
    expect(scoped.bool?.filter).toEqual([{ terms: { repository_id: [1001, 1002] } }]);
  });

  it('사용자 질의를 must에, 접근 범위를 filter에 둔다', () => {
    const scoped = applyMandatoryScopeFilter({ term: { state: 'merged' } }, explicit);
    // 접근 범위가 점수에 영향을 주면 안 되고, filter 절은 캐시된다.
    expect(scoped.bool?.must).toEqual([{ term: { state: 'merged' } }]);
  });

  it('org_team 범위는 조직 조건 + (가시성 또는 팀) 조건으로 결합한다', () => {
    const scoped = applyMandatoryScopeFilter(
      { match_all: {} },
      { kind: 'org_team', orgIds: [1], teamIds: [77], visibilities: ['public', 'internal'] },
    );
    const filter = scoped.bool?.filter;
    expect(Array.isArray(filter) ? filter[0] : filter).toMatchObject({
      bool: { minimum_should_match: 1 },
    });
  });

  it('FR-AUTH-002 AC-3: 접근 가능한 저장소가 없으면 빈 결과가 아니라 오류다', () => {
    // 빈 목록으로 조회하면 0건이 나오는데, 그것은 "권한 없음"과 "결과 없음"을
    // 구분하지 못하게 만든다. 기본 거부는 명시적 실패여야 한다.
    expect(() => applyMandatoryScopeFilter({ match_all: {} }, { kind: 'explicit', repositoryIds: [] })).toThrow(
      AccessScopeUnavailableError,
    );
  });

  it('접근 가능한 조직이 없어도 오류다', () => {
    expect(() =>
      applyMandatoryScopeFilter({ match_all: {} }, { kind: 'org_team', orgIds: [], teamIds: [], visibilities: [] }),
    ).toThrow(AccessScopeUnavailableError);
  });

  it('ADR-008 AC-6: 저장소 500개를 넘으면 org_team 범위로 치환한다', () => {
    expect(EXPLICIT_SCOPE_LIMIT).toBe(500);
    expect(shouldUseOrgTeamScope(500)).toBe(false);
    expect(shouldUseOrgTeamScope(501)).toBe(true);
  });
});

describe('WP-003 DoD 4: search()는 ScopedQuery가 아닌 인자를 받으면 컴파일 실패한다', () => {
  /**
   * 이 함수는 **실행되지 않는다.** 존재 자체가 검증이다.
   *
   * `@ts-expect-error`는 그 아래 줄에 타입 오류가 있어야 통과한다. 만약 누군가
   * `search`의 시그니처를 완화해 평범한 질의도 받게 만들면, 오류가 사라지면서
   * `@ts-expect-error`가 "쓰이지 않은 억제"가 되고 `pnpm typecheck`가 실패한다.
   *
   * 즉 접근 범위 필터 우회가 런타임 버그가 아니라 빌드 실패가 된다 (ADR-008).
   */
  const compileTimeGuard = async (client: Client): Promise<void> => {
    // @ts-expect-error 접근 범위 필터를 거치지 않은 질의는 search()에 넘길 수 없다.
    await search(client, 'prs-commits', { match_all: {} });
  };

  it('가드 함수가 타입 검사 대상으로 존재한다', () => {
    expect(typeof compileTimeGuard).toBe('function');
  });
});
