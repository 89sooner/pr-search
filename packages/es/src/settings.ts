/**
 * 엔티티 인덱스 공통 설정 (데이터 모델 4장).
 *
 * `index.sort`는 시퀀스 범위 질의와 기본 정렬에서 조기 종료를 얻기 위한 것이다
 * (ADR-003). `refresh_interval: 1s`는 수집 반영 SLO(NFR-002 p95 10초)와 색인
 * 처리량의 절충값이다.
 */

import type { estypes } from '@elastic/elasticsearch';

/**
 * 전문 검색 분석기 이름.
 *
 * OD-005 결정에 따라 내부 토크나이저를 `nori_tokenizer`로 교체할 수 있다.
 * **이름은 바꾸지 않는다** — 매핑이 이 이름을 참조하므로 이름이 바뀌면
 * 매핑 4종을 모두 고쳐야 한다 (FR-SRCH-011 AC-4).
 */
export const TEXT_ANALYZER = 'text_ko_en' as const;

/** 경로 계층 분석기. `src/a/b.ts`를 `src`, `src/a`, `src/a/b.ts`로 분해한다. */
export const PATH_ANALYZER = 'path_analyzer' as const;

/** 대소문자 무관 keyword 매칭용 정규화기. 축약 SHA 검색이 이것에 의존한다 (FR-SRCH-004 AC-4). */
export const LOWERCASE_NORMALIZER = 'lowercase_normalizer' as const;

/** 분석 구성. 정렬 유무와 무관하게 모든 엔티티 인덱스가 공유한다. */
export const ENTITY_ANALYSIS: estypes.IndicesIndexSettingsAnalysis = {
  normalizer: {
    [LOWERCASE_NORMALIZER]: { type: 'custom', filter: ['lowercase'] },
  },
  analyzer: {
    [TEXT_ANALYZER]: {
      type: 'custom',
      tokenizer: 'standard',
      filter: ['lowercase', 'asciifolding'],
    },
    [PATH_ANALYZER]: { type: 'custom', tokenizer: 'path_hierarchy' },
  },
};

export const ENTITY_INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_replicas: 1,
  refresh_interval: '1s',
  sort: {
    field: ['repository_id', 'merge_seq'],
    order: ['asc', 'desc'],
    missing: ['_last', '_last'],
  },
  analysis: ENTITY_ANALYSIS,
};

/**
 * `index.sort` 없는 변형. `prs-links` 전용이다.
 *
 * DEV-007: 데이터 모델 4장은 공통 설정을 "모든 엔티티 인덱스"에 적용한다고 적었으나,
 * 그 설정의 `index.sort.field`에 `merge_seq`가 들어 있고 `prs-links` 매핑에는
 * `merge_seq`가 없다. Elasticsearch는 매핑에 없는 필드로 `index.sort`를 걸면
 * 인덱스 생성을 거부하므로 문서 그대로는 실행되지 않는다.
 *
 * 간선은 시퀀스 축으로 정렬할 이유도 없다 — 조회는 `from_id`/`to_id` 기준이다.
 */
export const UNSORTED_INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_replicas: 1,
  refresh_interval: '1s',
  analysis: ENTITY_ANALYSIS,
};
