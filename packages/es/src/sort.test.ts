/**
 * 정렬 (WP-013 DoD 4, DoD 5 / FR-SRCH-007).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT_KEY,
  DEFAULT_SORT_ORDER,
  PartialSearchError,
  SORT_KEYS,
  assertNoShardFailures,
  buildSort,
  isSortKey,
  TIEBREAK_FIELD,
} from './sort.js';

/** 정렬 절 하나에서 필드 이름을 꺼낸다. */
function fieldsOf(sort: readonly unknown[]): string[] {
  return sort.map((one) => Object.keys(one as Record<string, unknown>)[0] ?? '');
}

function specOf(sort: readonly unknown[], index: number): Record<string, unknown> {
  const entry = sort[index] as Record<string, Record<string, unknown>>;
  const key = Object.keys(entry)[0] ?? '';
  return entry[key] ?? {};
}

describe('DoD 4: 정렬 키 아홉 (AC-1)', () => {
  it('SRS가 열거한 아홉 그대로다', () => {
    expect([...SORT_KEYS]).toEqual([
      'pr_number',
      'merge_seq',
      'merged_at',
      'created_at',
      'updated_at',
      'changed_files_count',
      'additions',
      'lead_time_seconds',
      'relevance',
    ]);
  });

  it('아홉 모두 정렬 절을 만든다', () => {
    for (const key of SORT_KEYS) {
      expect(buildSort(key, 'desc').length, key).toBeGreaterThan(0);
    }
  });

  it('목록 밖은 정렬 키가 아니다 (AC-3의 400 판정)', () => {
    expect(isSortKey('merge_seq')).toBe(true);
    expect(isSortKey('deletions')).toBe(false);
    expect(isSortKey('title')).toBe(false);
    expect(isSortKey('')).toBe(false);
  });
});

describe('AC-2: 기본 정렬은 두 단이다', () => {
  it('기본은 `merge_seq` 내림차순이다', () => {
    expect(DEFAULT_SORT_KEY).toBe('merge_seq');
    expect(DEFAULT_SORT_ORDER).toBe('desc');
  });

  it('시퀀스 없는 문서를 `merged_at` 내림차순으로 뒤에 놓는다', () => {
    const sort = buildSort('merge_seq', 'desc');

    expect(fieldsOf(sort)).toEqual(['merge_seq', 'merged_at', TIEBREAK_FIELD]);
    /*
     * 누락 센티널이 "뒤에"를 만든다.
     *
     * 예전에는 `'_last'`였다. 그 문자열은 커서로 되먹일 수 없어 명시적 값으로
     * 바뀌었고(DEV-329), 여기서 확인하는 것은 **뜻**이다 — 내림차순에서
     * 누락은 어떤 실제 서수보다 작아야 뒤로 간다.
     */
    expect(specOf(sort, 0)['missing']).toBeLessThan(0);
    // 두 번째 키가 그 무리 안의 순서를 만든다.
    expect(specOf(sort, 1)['order']).toBe('desc');
  });

  it('두 번째 단이 없으면 시퀀스 없는 무리가 문서 ID 순으로 선다', () => {
    // 그것은 "최근 머지가 먼저"가 아니다. 그래서 기본 정렬에만 두 번째 단이 있다.
    expect(fieldsOf(buildSort('created_at', 'desc'))).toEqual(['created_at', TIEBREAK_FIELD]);
  });

  it('기본 키를 오름차순으로 쓸 때도 두 단이다', () => {
    expect(fieldsOf(buildSort('merge_seq', 'asc'))).toEqual(['merge_seq', 'merged_at', TIEBREAK_FIELD]);
  });
});

describe('DoD 5 / AC-4: 결정론', () => {
  it('모든 정렬이 문서 ID로 끝난다', () => {
    for (const key of SORT_KEYS) {
      expect(fieldsOf(buildSort(key, 'desc')).at(-1), key).toBe(TIEBREAK_FIELD);
    }
  });

  it('동점 처리 키는 `_id`가 아니라 `doc_id`다 (DEV-059)', () => {
    // Elasticsearch 8은 `_id` 정렬을 금지한다 — fielddata를 켜야 하는데 그것은
    // 클러스터 전역 설정이고 모든 문서 ID를 힙에 올린다.
    expect(TIEBREAK_FIELD).toBe('doc_id');
    for (const key of SORT_KEYS) {
      expect(fieldsOf(buildSort(key, 'asc')), key).not.toContain('_id');
    }
  });

  it('`_doc`도 쓰지 않는다', () => {
    // 세그먼트 내부 순서라 머지나 재색인이 일어나면 값이 달라진다.
    for (const key of SORT_KEYS) {
      expect(fieldsOf(buildSort(key, 'asc'))).not.toContain('_doc');
    }
  });

  it('같은 입력이 같은 절을 만든다', () => {
    expect(buildSort('additions', 'asc')).toEqual(buildSort('additions', 'asc'));
  });
});

describe('DEV-054: 여러 인덱스를 함께 도는 정렬', () => {
  it('모든 필드 정렬에 `unmapped_type`이 붙는다', () => {
    for (const key of SORT_KEYS) {
      const sort = buildSort(key, 'desc');
      for (const [index, field] of fieldsOf(sort).entries()) {
        // `_id`와 `_score`는 메타 필드라 매핑이 필요 없다.
        if (field.startsWith('_')) continue;
        expect(specOf(sort, index)['unmapped_type'], `${key} → ${field}`).toBeDefined();
      }
    }
  });

  it('`unmapped_type`이 필드 타입과 맞다', () => {
    expect(specOf(buildSort('merged_at', 'desc'), 0)['unmapped_type']).toBe('date');
    expect(specOf(buildSort('merge_seq', 'desc'), 0)['unmapped_type']).toBe('long');
    expect(specOf(buildSort('additions', 'desc'), 0)['unmapped_type']).toBe('integer');
  });

  /*
   * **`_last`가 아니라 명시적 값이다** (WP-032 / DEV-329).
   *
   * 예전 형태는 `missing`이 `'_last'`인지를 물었다. 그 문자열은 Elasticsearch가
   * 내부적으로 `Long.MIN_VALUE`/`MAX_VALUE`를 쓰게 만드는데, 그 값은 커서로
   * **되먹일 수 없다** — 날짜 축에서 `parse_exception`이 나고, `Number`의 안전
   * 정수 범위를 넘어 JSON 왕복에서 정밀도까지 잃는다. 실제 Elasticsearch 8로
   * 셋(`format` 없음 / `strict_date_optional_time` / `epoch_millis`)을 다 재고
   * 확인했다.
   *
   * 그래서 지금 확인하는 것은 **뜻**이다: 값이 방향에 따라 갈리고, 표현
   * 가능하며, JSON이 정확히 나른다.
   */
  it('없는 필드의 문서를 마지막에 놓는다 — 표현 가능한 값으로 (예외 처리, DEV-329)', () => {
    for (const key of SORT_KEYS) {
      for (const order of ['asc', 'desc'] as const) {
        const sort = buildSort(key, order);
        for (const [index, field] of fieldsOf(sort).entries()) {
          if (field.startsWith('_')) continue;
          // 동률 키(keyword)는 `_last`가 그대로 옳다 — `null`이 되먹여진다.
          if (field === TIEBREAK_FIELD) continue;
          const missing = specOf(sort, index)['missing'];
          expect(typeof missing, `${key}/${order} → ${field}`).toBe('number');
          // **JSON 왕복이 값을 바꾸지 않는다.** 이것이 `_last`가 실패한 자리다.
          expect(Number.isSafeInteger(missing), `${key}/${order} → ${field}`).toBe(true);
        }
      }
    }
  });

  it('방향마다 반대쪽 끝이다 — 어느 쪽이든 누락이 뒤로 간다', () => {
    for (const key of SORT_KEYS) {
      if (key === 'relevance') continue;
      const desc = specOf(buildSort(key, 'desc'), 0)['missing'] as number;
      const asc = specOf(buildSort(key, 'asc'), 0)['missing'] as number;
      expect(desc, key).toBeLessThan(asc);
    }
  });

  it('`integer` 축의 센티널이 32비트 범위 안이다 — 매핑이 거절하지 않는다', () => {
    for (const key of ['changed_files_count', 'additions'] as const) {
      const asc = specOf(buildSort(key, 'asc'), 0)['missing'] as number;
      expect(asc, key).toBeLessThanOrEqual(2_147_483_647);
    }
  });
});

describe('DEV-056: `relevance`', () => {
  it('점수를 앞에 두고 문서 ID로 끝난다', () => {
    expect(fieldsOf(buildSort('relevance', 'desc'))).toEqual(['_score', TIEBREAK_FIELD]);
  });

  /*
   * **이 시험은 뒤집혔다** (WP-032 / CR-043 DEV-275).
   *
   * 예전 형태는 "order를 무시한다 — 점수는 늘 내림차순이 뜻이 있다"를 단언하며
   * **틀린 계약을 굳히고 있었다.** 그 판단이 성립했던 것은 WP-013에 점수를 내는
   * 절이 없어 모든 문서의 점수가 같았기 때문이고(DEV-056), 그때는 방향이 아무
   * 차이도 만들지 않았다.
   *
   * FR-SRCH-007 AC-1은 키와 방향을 **함께** 승인했다. 지원하지 않기로 정하려면
   * 그것은 SRS 변경이지 편의로 고정할 일이 아니다.
   */
  it('요청한 방향을 존중한다 (FR-SRCH-007 AC-1, DEV-275)', () => {
    expect(specOf(buildSort('relevance', 'asc'), 0)['order']).toBe('asc');
    expect(specOf(buildSort('relevance', 'desc'), 0)['order']).toBe('desc');
    expect(buildSort('relevance', 'asc')).not.toEqual(buildSort('relevance', 'desc'));
  });

  it('방향과 무관하게 동점은 늘 같은 키로 가른다 — 결정론이 방향에 딸리지 않는다', () => {
    for (const order of ['asc', 'desc'] as const) {
      expect(fieldsOf(buildSort('relevance', order)).at(-1)).toBe(TIEBREAK_FIELD);
    }
  });

  it('결정론이 성립한다 — 점수가 모두 같아도 ID가 순서를 만든다', () => {
    expect(fieldsOf(buildSort('relevance', 'desc')).at(-1)).toBe(TIEBREAK_FIELD);
  });
});

describe('DEV-054: 샤드 부분 실패를 부분 결과로 내보내지 않는다', () => {
  it('실패한 샤드가 없으면 통과한다', () => {
    expect(() => assertNoShardFailures({ _shards: { failed: 0, total: 18 } })).not.toThrow();
  });

  it('하나라도 실패하면 던진다', () => {
    // Elasticsearch는 이때도 HTTP 200과 나머지 결과를 준다. 그대로 내보내면
    // 한 인덱스가 통째로 빠진 결과가 정상처럼 보인다.
    expect(() => assertNoShardFailures({ _shards: { failed: 12, total: 18 } })).toThrow(PartialSearchError);
  });

  it('오류가 몇 개가 실패했는지 담는다', () => {
    const error = ((): PartialSearchError => {
      try {
        assertNoShardFailures({ _shards: { failed: 12, total: 18 } });
      } catch (thrown) {
        return thrown as PartialSearchError;
      }
      throw new Error('던지지 않았다');
    })();

    expect(error.failedShards).toBe(12);
    expect(error.totalShards).toBe(18);
    expect(error.message).toContain('12/18');
  });
});
