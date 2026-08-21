/**
 * C-012 레일 상태 (WP-016 / CR-019 DEV-076).
 *
 * 핵심은 **세 경우를 가르는 것**이다. "아직 안 셌다"와 "이번엔 못 셌다"는
 * 사용자가 할 수 있는 일이 다르다.
 */

import { describe, expect, it } from 'vitest';
import { FACET_FIELDS, facetNotice, facetRailState } from './facets';

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
    expect(notice).toContain('아직');
  });

  it('생략했으면 **다른 문구**로 말하고 사용자가 할 일을 준다', () => {
    const notice = facetNotice(facetRailState({ facets_omitted: true }));
    expect(notice).not.toBeNull();
    expect(notice).toContain('좁히면');
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

describe('레일이 다루는 필드 (FR-SRCH-006 AC-1)', () => {
  it('FR-SRCH-009 AC-1이 정한 패싯 6종과 같다', () => {
    expect(FACET_FIELDS.map((f) => f.key)).toEqual(['repo', 'author', 'team', 'label', 'base', 'state']);
  });

  it('전부 질의 키다 — 레일 조작이 질의 문자열을 갱신한다', () => {
    // 레일이 자기 상태를 따로 가지면 URL과 두 진실이 생긴다.
    for (const field of FACET_FIELDS) {
      expect(field.key).toMatch(/^[a-z]+$/);
      expect(field.label.length).toBeGreaterThan(0);
    }
  });
});
