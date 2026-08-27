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

/**
 * 부분 일치 **색인** 분석기 (WP-032 / FR-SRCH-011, OD-005 결정 경로).
 *
 * `nori` 없이 한글·영문 혼용 질의가 성립하게 하는 수단이다 (CR-040). `standard`
 * 토크나이저는 한글을 공백·문장부호로만 끊으므로 "결제재시도"를 한 토큰으로
 * 두는데, 사용자는 "결제"로 찾는다. 토큰의 **앞에서부터 자른 조각**을 함께
 * 색인해 두면 그 질의가 닿는다.
 *
 * **색인 시에만 자른다.** 질의는 `TEXT_ANALYZER`로 분석한다(`search_analyzer`) —
 * 질의까지 잘라 넣으면 "결제"가 "결"로도 매치되어 관련 없는 문서가 딸려 온다.
 *
 * `min_gram: 2`인 것은 한 코드 포인트 질의가 이미 `QUERY_TOO_SHORT`로 거절되기
 * 때문이다 (API 계약 「전문 검색 계약」). 1자 조각을 색인해도 그것을 찾을 질의가
 * 존재하지 않고, 색인만 그만큼 부푼다.
 */
export const TEXT_PARTIAL_ANALYZER = 'text_partial_index' as const;

/** 부분 일치 조각 필터. 이름이 경계를 그대로 적는다 — 값이 바뀌면 이름도 바뀐다. */
export const PARTIAL_NGRAM_FILTER = 'edge_ngram_2_20' as const;

/** 부분 일치 조각의 경계. 제품 요구사항이 아니라 유계 구현 값이다. */
export const PARTIAL_MIN_GRAM = 2;
export const PARTIAL_MAX_GRAM = 20;

/** 경로 계층 분석기. `src/a/b.ts`를 `src`, `src/a`, `src/a/b.ts`로 분해한다. */
export const PATH_ANALYZER = 'path_analyzer' as const;

/** 대소문자 무관 keyword 매칭용 정규화기. 축약 SHA 검색이 이것에 의존한다 (FR-SRCH-004 AC-4). */
export const LOWERCASE_NORMALIZER = 'lowercase_normalizer' as const;

/** 분석 구성. 정렬 유무와 무관하게 모든 엔티티 인덱스가 공유한다. */
export const ENTITY_ANALYSIS: estypes.IndicesIndexSettingsAnalysis = {
  normalizer: {
    [LOWERCASE_NORMALIZER]: { type: 'custom', filter: ['lowercase'] },
  },
  filter: {
    [PARTIAL_NGRAM_FILTER]: {
      type: 'edge_ngram',
      min_gram: PARTIAL_MIN_GRAM,
      max_gram: PARTIAL_MAX_GRAM,
    },
  },
  analyzer: {
    [TEXT_ANALYZER]: {
      type: 'custom',
      tokenizer: 'standard',
      filter: ['lowercase', 'asciifolding'],
    },
    /*
     * `TEXT_ANALYZER`와 토크나이저·정규화가 같고 조각 필터만 더한다.
     *
     * 같아야 하는 이유는 `search_analyzer`가 `TEXT_ANALYZER`이기 때문이다 —
     * 색인과 질의의 토큰 경계가 다르면 조각이 질의 토큰과 만나지 못한다.
     */
    [TEXT_PARTIAL_ANALYZER]: {
      type: 'custom',
      tokenizer: 'standard',
      filter: ['lowercase', 'asciifolding', PARTIAL_NGRAM_FILTER],
    },
    [PATH_ANALYZER]: { type: 'custom', tokenizer: 'path_hierarchy' },
  },
};

/**
 * 부분 일치 서브필드의 매핑 (WP-032).
 *
 * 네 자리(PR 제목·대상/소스 브랜치, 커밋 메시지·대상 브랜치)가 같은 값을 써야
 * 하므로 한 곳에 둔다. 하나만 다르게 쓰면 그 축만 조용히 다르게 답한다.
 */
export const PARTIAL_TEXT_FIELD: estypes.MappingProperty = {
  type: 'text',
  analyzer: TEXT_PARTIAL_ANALYZER,
  search_analyzer: TEXT_ANALYZER,
};

/**
 * `keyword` 본체에 붙이는 전문 검색용 서브필드 (WP-032).
 *
 * 브랜치명은 `keyword`가 정본이다 — `base:main` 같은 구조화 필터가 정확 일치를
 * 요구하므로 타입을 바꾸지 않는다. 전문 검색은 서브필드를 본다.
 */
export const SEARCHABLE_KEYWORD_FIELDS: Readonly<Record<string, estypes.MappingProperty>> = {
  text: { type: 'text', analyzer: TEXT_ANALYZER },
  partial: PARTIAL_TEXT_FIELD,
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
