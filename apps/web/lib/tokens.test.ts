/**
 * C-011 토큰 칩과 AST 편집 (WP-016 / FR-SRCH-005).
 *
 * **왕복이 이 모듈의 전부다.** 칩을 지우거나 패싯을 고르면 AST가 바뀌고,
 * 그것이 직렬화되어 URL이 되고, 다시 파싱되어 화면이 된다. 그 고리 어디서든
 * 모양이 달라지면 사용자가 친 질의가 조용히 다른 것이 된다.
 */

import { describe, expect, it } from 'vitest';
import { parseQuery, serializeQuery } from '@prs/query';
import { addEquality, hasEquality, removeChip, removeEquality, toChips } from './tokens';

const ast = (q: string) => parseQuery(q);

describe('AST를 칩으로', () => {
  it('등장 순서를 지킨다 — 정렬하면 질의를 고칠 때마다 칩이 뛴다', () => {
    const chips = toChips(ast('repo:acme/a author:kim label:bug'));
    expect(chips.map((c) => c.key)).toEqual(['repo', 'author', 'label']);
  });

  it('다중 값은 한 칩에 모인다 (AC-5: 같은 키는 OR)', () => {
    const chips = toChips(ast('author:kim author:lee'));
    expect(chips).toHaveLength(1);
    expect(chips[0]?.value).toBe('kim, lee');
  });

  it('범위는 `from..to`로 읽힌다 (AC-2)', () => {
    const chips = toChips(ast('seq:1200..1350'));
    expect(chips[0]?.value).toBe('1200..1350');
  });

  it('시각 범위도 사용자가 친 문자열 그대로다 (AC-3)', () => {
    const chips = toChips(ast('merged:2026-08-10..2026-08-19'));
    expect(chips[0]?.value).toBe('2026-08-10..2026-08-19');
  });

  it('부정 조건을 표시한다 (AC-6)', () => {
    const chips = toChips(ast('-author:kim'));
    expect(chips[0]?.negated).toBe(true);
  });

  it('**제거 버튼 이름이 부정을 말로 밝힌다** — `-`는 읽히지 않는다', () => {
    const chips = toChips(ast('-author:kim'));
    expect(chips[0]?.removeLabel).toBe('제외 조건 author:kim 필터 제거');
  });

  it('일반 조건의 이름은 명세 그대로다 (C-011 접근성 규칙)', () => {
    const chips = toChips(ast('author:kim'));
    expect(chips[0]?.removeLabel).toBe('author:kim 필터 제거');
  });

  it('전문 검색어는 칩이 아니다 — 지울 대상이 아니라 질의 본문이다', () => {
    expect(toChips(ast('결제 재시도'))).toHaveLength(0);
  });

  it('`null` AST는 빈 목록이다 — 파싱 실패 중에도 렌더링된다', () => {
    expect(toChips(null)).toEqual([]);
  });
});

describe('칩 제거', () => {
  it('지목한 것만 뺀다', () => {
    const next = removeChip(ast('repo:acme/a author:kim'), 0);
    expect(serializeQuery(next)).toBe('author:kim');
  });

  it('전문 검색어는 남는다 — 칩을 지운 것이지 질의를 지운 게 아니다', () => {
    const next = removeChip(ast('author:kim 결제'), 0);
    expect(serializeQuery(next)).toBe('결제');
  });

  it('**범위 밖 index는 원본 그대로** — 늦게 도착한 클릭에 죽지 않는다', () => {
    const original = ast('author:kim');
    expect(removeChip(original, 5)).toEqual(original);
    expect(removeChip(original, -1)).toEqual(original);
  });
});

describe('패싯 선택 — AST를 고쳐 왕복시킨다', () => {
  it('없던 키를 더한다', () => {
    expect(serializeQuery(addEquality(ast(''), 'author', 'kim'))).toBe('author:kim');
  });

  it('**같은 키는 한 노드에 모은다** — 새 노드를 만들면 왕복이 깨진다', () => {
    const next = addEquality(ast('author:kim'), 'author', 'lee');
    expect(next.filters).toHaveLength(1);
    expect(serializeQuery(next)).toBe('author:kim author:lee');
  });

  it('직렬화한 것을 다시 파싱하면 같은 AST다 (왕복)', () => {
    const next = addEquality(addEquality(ast(''), 'author', 'kim'), 'author', 'lee');
    expect(parseQuery(serializeQuery(next))).toEqual(next);
  });

  it('이미 있는 값은 다시 넣지 않는다 — 결과는 같고 URL만 길어진다', () => {
    const once = addEquality(ast(''), 'author', 'kim');
    expect(addEquality(once, 'author', 'kim')).toEqual(once);
  });

  it('부정 조건과 섞이지 않는다 — `-author:kim`이 있어도 별개 노드다', () => {
    const next = addEquality(ast('-author:kim'), 'author', 'lee');
    expect(next.filters).toHaveLength(2);
    expect(serializeQuery(next)).toBe('-author:kim author:lee');
  });

  it('전문 검색어를 건드리지 않는다', () => {
    expect(serializeQuery(addEquality(ast('결제'), 'author', 'kim'))).toBe('author:kim 결제');
  });
});

describe('패싯 해제', () => {
  it('값 하나만 뺀다', () => {
    const next = removeEquality(ast('author:kim author:lee'), 'author', 'kim');
    expect(serializeQuery(next)).toBe('author:lee');
  });

  it('**마지막 값이면 노드째 뺀다** — 빈 노드는 직렬화가 이상해진다', () => {
    const next = removeEquality(ast('author:kim repo:acme/a'), 'author', 'kim');
    expect(next.filters).toHaveLength(1);
    expect(serializeQuery(next)).toBe('repo:acme/a');
  });

  it('없는 값을 빼려 하면 원본 그대로다', () => {
    const original = ast('author:kim');
    expect(removeEquality(original, 'author', 'nobody')).toEqual(original);
    expect(removeEquality(original, 'label', 'kim')).toEqual(original);
  });

  it('더하고 빼면 원래로 돌아온다', () => {
    const start = ast('repo:acme/a');
    const round = removeEquality(addEquality(start, 'author', 'kim'), 'author', 'kim');
    expect(serializeQuery(round)).toBe(serializeQuery(start));
  });
});

describe('선택 상태 판정 — 레일의 체크가 이것으로 정해진다', () => {
  it('있으면 참', () => {
    expect(hasEquality(ast('author:kim'), 'author', 'kim')).toBe(true);
  });

  it('다중 값 안의 하나도 참', () => {
    expect(hasEquality(ast('author:kim author:lee'), 'author', 'lee')).toBe(true);
  });

  it('**부정 조건은 선택이 아니다** — 제외한 것을 체크된 것으로 보이면 안 된다', () => {
    expect(hasEquality(ast('-author:kim'), 'author', 'kim')).toBe(false);
  });

  it('다른 키의 같은 값은 참이 아니다', () => {
    expect(hasEquality(ast('label:kim'), 'author', 'kim')).toBe(false);
  });

  it('`null` AST는 아무것도 선택되지 않은 것이다', () => {
    expect(hasEquality(null, 'author', 'kim')).toBe(false);
  });
});
