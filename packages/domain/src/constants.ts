/**
 * 도메인 상수.
 *
 * 값의 출처는 각 항목에 표기한다. 여기 없는 수치를 코드에 직접 쓰지 않는다.
 */

/** 축약 SHA 접두 검색 최소 길이 (ADR-012, FR-SRCH-002). */
export const MIN_SHA_PREFIX_LENGTH = 7;

/** 전체 커밋 SHA 길이. */
export const FULL_SHA_LENGTH = 40;

/** 전문 검색 최소 질의 길이 (오류 코드 `QUERY_TOO_SHORT`). */
export const MIN_QUERY_LENGTH = 2;

/** 시퀀스 범위 조회 최대 건수 (오류 코드 `RANGE_TOO_LARGE`). */
export const MAX_RANGE_SIZE = 50_000;

/** 시계열 집계 최대 버킷 수 (오류 코드 `TOO_MANY_BUCKETS`). */
export const MAX_TIME_BUCKETS = 400;

/** 내보내기 최대 건수 (오류 코드 `EXPORT_LIMIT_EXCEEDED`). */
export const MAX_EXPORT_ROWS = 100_000;

/** 저장된 검색 최대 보유 수 (오류 코드 `SAVED_SEARCH_LIMIT`). */
export const MAX_SAVED_SEARCHES = 100;

/** 시퀀스 채번 대상 브랜치 최대 수 (오류 코드 `BRANCH_LIMIT_EXCEEDED`). */
export const MAX_SEQUENCE_BRANCHES = 10;

/** 관계 그래프 최대 탐색 깊이 (ADR-009, FR-REL-008). */
export const MAX_GRAPH_DEPTH = 3;

/** 관계 그래프 최대 노드 수 (ADR-009, FR-REL-008). */
export const MAX_GRAPH_NODES = 300;

/** PR당 저장하는 원본 커밋 최대 수. 초과분은 절삭한다 (FR-SRCH-003 AC-4). */
export const MAX_STORED_COMMITS_PER_PR = 250;

/** PR당 저장하는 변경 파일 경로 최대 수. 초과분은 절삭한다 (FR-ING-004 AC-4). */
export const MAX_STORED_CHANGED_PATHS = 3_000;

/** 웹훅 payload 최대 크기 (오류 코드 `PAYLOAD_TOO_LARGE`). */
export const MAX_WEBHOOK_PAYLOAD_BYTES = 25 * 1024 * 1024;

/** 접근 범위 캐시 TTL (FR-AUTH-003 AC-1). */
export const ACCESS_SCOPE_CACHE_TTL_SECONDS = 300;

/** 시퀀스 서수의 시작값. `git rev-list --first-parent --reverse`의 첫 커밋이 1이다 (ADR-007). */
export const FIRST_MERGE_SEQ = 1;
