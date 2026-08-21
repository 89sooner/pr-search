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

describe('DoD 4: 정렬 키 여덟 (AC-1)', () => {
  it('SRS가 열거한 여덟 그대로다', () => {
    expect([...SORT_KEYS]).toEqual([
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

  it('여덟 모두 정렬 절을 만든다', () => {
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
    // `missing: _last`가 "뒤에"를 만든다.
    expect(specOf(sort, 0)['missing']).toBe('_last');
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

  it('없는 필드의 문서를 마지막에 놓는다 (예외 처리)', () => {
    for (const key of SORT_KEYS) {
      const sort = buildSort(key, 'desc');
      for (const [index, field] of fieldsOf(sort).entries()) {
        if (field.startsWith('_')) continue;
        expect(specOf(sort, index)['missing'], `${key} → ${field}`).toBe('_last');
      }
    }
  });
});

describe('DEV-056: `relevance`', () => {
  it('점수를 앞에 두고 문서 ID로 끝난다', () => {
    expect(fieldsOf(buildSort('relevance', 'desc'))).toEqual(['_score', TIEBREAK_FIELD]);
  });

  it('order를 무시한다 — 점수는 늘 내림차순이 뜻이 있다', () => {
    expect(buildSort('relevance', 'asc')).toEqual(buildSort('relevance', 'desc'));
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
