/**
 * C-012 레일 상태 (WP-016 / CR-019 DEV-076).
 *
 * 핵심은 **세 경우를 가르는 것**이다. "아직 안 셌다"와 "이번엔 못 셌다"는
 * 사용자가 할 수 있는 일이 다르다.
 */

import { describe, expect, it } from 'vitest';
import {
  FACET_FIELDS,
  RANGE_FACET_FIELDS,
  SEARCH_FACET_FIELDS,
  facetNotice,
  facetRailState,
} from './facets';

describe('세 경우를 가른다 (DEV-076)', () => {
  it('두 키가 **없으면** 아직 세지 않은 것이다', () => {
    // WP-032 전까지 `/search`가 두 키를 넣지 않는다 (CR-016 DEV-057).
    expect(facetRailState({}).kind).toBe('not_computed');
  });

  it('`facets_omitted: true`면 예산 초과 생략이다', () => {
    expect(facetRailState({ facets_omitted: true }).kind).toBe('omitted');
  });

  it('`facets_omitted: false`면 세었다', () => {
    const state = facetRailState({ facets_omitted: false, facets: { author: [{ value: 'kim', count: 3 }] } });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') expect(state.facets['author']?.[0]?.count).toBe(3);
  });

  it('**`false`와 키 부재를 섞지 않는다** — 키 존재가 "세려고 했다"를 뜻한다', () => {
    expect(facetRailState({ facets_omitted: false }).kind).toBe('ready');
    expect(facetRailState({}).kind).toBe('not_computed');
  });

  it('세었는데 분포가 비면 `ready`에 빈 묶음이다 — 못 센 것과 다르다', () => {
    const state = facetRailState({ facets_omitted: false, facets: {} });
    expect(state.kind).toBe('ready');
  });

  it('`facets`만 있고 플래그가 없으면 못 센 것으로 본다 — 계약이 둘을 함께 낸다', () => {
    // 한쪽만 오는 것은 계약 위반이다. 안전한 쪽(표시하지 않음)으로 떨어진다.
    expect(facetRailState({ facets: { author: [] } }).kind).toBe('not_computed');
  });
});

describe('사유 문구 — 조용히 비우지 않는다 (C-012 사용 규칙)', () => {
  it('세지 않았으면 그렇게 말한다', () => {
    const notice = facetNotice(facetRailState({}));
    expect(notice).not.toBeNull();
    expect(notice).toContain("yet");
  });

  it('생략했으면 **다른 문구**로 말하고 사용자가 할 일을 준다', () => {
    const notice = facetNotice(facetRailState({ facets_omitted: true }));
    expect(notice).not.toBeNull();
    expect(notice).toContain("Narrow");
  });

  it('두 문구가 다르다 — 뭉치면 마지막 경우의 복구 경로를 잃는다', () => {
    expect(facetNotice(facetRailState({}))).not.toBe(
      facetNotice(facetRailState({ facets_omitted: true })),
    );
  });

  it('정상이면 사유를 표시하지 않는다', () => {
    expect(facetNotice(facetRailState({ facets_omitted: false, facets: {} }))).toBeNull();
  });
});

describe('레일이 다루는 필드 (FR-SRCH-006 AC-1, FR-SRCH-009 AC-1)', () => {
  /*
   * **키가 둘로 갈렸다** (WP-032).
   *
   * WP-016 시절에는 패싯 데이터가 오지 않아 `key`가 곧 질의 키였다. 이제 응답이
   * 실제로 오고 그 키는 **ES 필드 이름**이다 — `repository`, `base_branch`,
   * 그리고 `allowed_team_ids`를 센 `team`. 레일이 만드는 것은 여전히 질의
   * 토큰이므로(`repo:`, `base:`) 둘을 같다고 두면 **패싯을 눌렀을 때 성립하지
   * 않는 질의**가 만들어진다.
   */
  it('응답 키는 FR-SRCH-009 AC-1이 정한 여섯 축의 ES 필드다', () => {
    expect(SEARCH_FACET_FIELDS.map((f) => f.key)).toEqual([
      'repository',
      'author',
      'team',
      'label',
      'base_branch',
      'state',
    ]);
  });

  it('질의 키는 FR-SRCH-006 AC-1의 지원 키다 — 레일 조작이 질의 문자열을 갱신한다', () => {
    // 레일이 자기 상태를 따로 가지면 URL과 두 진실이 생긴다.
    expect(SEARCH_FACET_FIELDS.map((f) => f.queryKey)).toEqual([
      'repo',
      'author',
      'team',
      'label',
      'base',
      'state',
    ]);
    for (const field of SEARCH_FACET_FIELDS) {
      expect(field.queryKey, field.key).toMatch(/^[a-z]+$/);
      expect(field.label.length).toBeGreaterThan(0);
    }
  });

  it('W-004는 넷이다 — 공간이 고정한 축을 다시 묻지 않는다 (FR-SEQ-002 AC-8)', () => {
    expect(RANGE_FACET_FIELDS.map((f) => f.key)).toEqual(['author', 'team', 'label', 'path']);
    // 저장소·브랜치는 시퀀스 공간이 정하고, 상태는 W-004의 승인 범위가 아니다.
    expect(RANGE_FACET_FIELDS.map((f) => f.key)).not.toContain('repository');
    expect(RANGE_FACET_FIELDS.map((f) => f.key)).not.toContain('base_branch');
    expect(RANGE_FACET_FIELDS.map((f) => f.key)).not.toContain('state');
  });

  it('예전 이름은 W-001 축의 별칭이다 — 참조가 한 곳으로 모인다', () => {
    expect(FACET_FIELDS).toBe(SEARCH_FACET_FIELDS);
  });
});

describe('생략과 실패를 가른다 (CR-043, DEV-277)', () => {
  it('`facets_status: failed`는 실패다 — 생략과 다른 상태다', () => {
    const state = facetRailState({ facets_omitted: true, facets_status: 'failed' });
    expect(state.kind).toBe('failed');
  });

  it('`budget_omitted`는 생략이다', () => {
    expect(facetRailState({ facets_omitted: true, facets_status: 'budget_omitted' }).kind).toBe('omitted');
  });

  /*
   * 상태를 모르면 **생략으로 읽는다.**
   *
   * WP-032 전의 응답이 그것을 뜻했고, 실패라고 단정하면 없는 고장을 알린다.
   */
  it('상태가 없으면 생략이다 — 없는 고장을 알리지 않는다', () => {
    expect(facetRailState({ facets_omitted: true }).kind).toBe('omitted');
  });

  it('셋이 서로 다른 문구다 — 사용자가 할 수 있는 일이 각각 다르다', () => {
    const notices = [
      facetNotice(facetRailState({})),
      facetNotice(facetRailState({ facets_omitted: true, facets_status: 'budget_omitted' })),
      facetNotice(facetRailState({ facets_omitted: true, facets_status: 'failed' })),
    ];
    expect(new Set(notices).size).toBe(3);
    for (const notice of notices) expect(notice).not.toBeNull();
  });
});
