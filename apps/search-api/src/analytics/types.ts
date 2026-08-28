/**
 * 집계 API의 타입과 상수 (WP-037 / FR-STAT-001~006, CR-053).
 *
 * ## 무엇을 세는가
 *
 * **Pull Request 문서 단독이다** (FR-STAT-001 AC-6). 목록 조회는 PR과 커밋을
 * 함께 보이지만 집계는 PR만 센다 — 그룹 키 일곱 중 팀·라벨·PR 상태와 지표 넷
 * 중 변경 파일 수·리드타임이 **커밋 매핑에 없어서**, 커밋을 넣으면 그 다섯이
 * 조용히 0이나 `unknown`이 된다 (CR-053, DEV-381).
 *
 * 그래서 두 총계가 다를 수 있고 그것은 오류가 아니라 **다른 것을 세는 것**이다.
 */

import type { EntityAlias } from '@prs/es';

/** 집계 모집단. 목록(`SEARCH_TARGET`)과 다르다 — 여기에 커밋이 없다. */
export const ANALYTICS_TARGET: readonly EntityAlias[] = ['prs-pull-requests'];

/**
 * 집계 예산 (FR-STAT-001 예외/실패 처리: "집계 시간이 5초를 넘으면").
 *
 * 패싯 예산(1.5초)과 다른 값이다. 패싯은 목록과 같은 화면에서 함께 기다리지만
 * 집계는 자기 패널의 지연만 만든다 (FR-STAT-006 AC-4).
 */
export const ANALYTICS_BUDGET_MS = 5_000;

/** 근사로 넘어가는 문턱 (FR-STAT-006 AC-3). */
export const APPROXIMATE_THRESHOLD = 1_000_000;

/** 그룹 수 상한 (FR-STAT-001 AC-3). */
export const MAX_GROUPS = 500;

/** 시계열 버킷 수 상한 (FR-STAT-002 AC-3). */
export const MAX_BUCKETS = 400;

/** 시계열 계열 수 상한 (FR-STAT-002 AC-5). */
export const MAX_SERIES = 20;

/** 백분위 표본 하한 (FR-STAT-003 예외/실패 처리). 19는 `low_sample`, 20은 아니다. */
export const LOW_SAMPLE_THRESHOLD = 20;

/** 기간 미지정 시 기본 구간 (FR-STAT-002 예외/실패 처리). */
export const DEFAULT_RANGE_DAYS = 30;

/** 기본 시간대 (FR-STAT-002 AC-2). */
export const DEFAULT_TIMEZONE = 'Asia/Seoul';

/**
 * 그룹 키와 ES 필드의 대응 (FR-STAT-001 AC-1, CR-053 DEV-382).
 *
 * **`team`은 `author_team_ids`다.** 검색의 `team:` 필터가 보는
 * `allowed_team_ids`는 **저장소 접근 권한**이고, 통계가 묻는 "팀별 머지 PR"은
 * 작성자의 소속이다. 둘을 섞으면 권한을 성과로 읽게 된다.
 */
export const GROUP_FIELDS = {
  repository: 'repository',
  org: 'org_id',
  team: 'author_team_ids',
  author: 'author',
  label: 'labels',
  base_branch: 'base_branch',
  state: 'state',
} as const satisfies Readonly<Record<string, string>>;

export type GroupKey = keyof typeof GROUP_FIELDS;

export const GROUP_KEYS = Object.keys(GROUP_FIELDS) as readonly GroupKey[];

export function isGroupKey(value: string): value is GroupKey {
  return Object.hasOwn(GROUP_FIELDS, value);
}

/**
 * 한 PR이 여러 버킷에 들어갈 수 있는 그룹 키 (FR-STAT-001 AC-7, DEV-385).
 *
 * 그래서 **`sum(groups[].count)`가 `total`을 넘을 수 있다.** `total`은 언제나
 * 고유 PR 수이며, 두 수가 같기를 기대하는 시험을 쓰지 않는다.
 */
export const MULTI_VALUE_GROUPS: ReadonlySet<GroupKey> = new Set<GroupKey>(['team', 'label']);

/** 그룹 키를 `drill_down_query`의 질의 키로 옮긴다 (FR-STAT-001 AC-5). */
export const GROUP_QUERY_KEYS = {
  repository: 'repo',
  org: 'org',
  // **`team:`이 아니다.** 그 키는 접근 권한을 뜻하므로 작성자 팀을 가리킬 수 없다.
  team: 'author_team',
  author: 'author',
  label: 'label',
  base_branch: 'base',
  state: 'state',
} as const satisfies Readonly<Record<GroupKey, string>>;

/** 지표 (FR-STAT-001 AC-2). `lead_time_median`은 `API-STAT-003`의 `p50`과 같은 값이다. */
export const METRIC_KEYS = ['count', 'changed_files_sum', 'additions_sum', 'lead_time_median'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export function isMetricKey(value: string): value is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(value);
}

/** 백분위 대상 필드 (FR-STAT-003 AC-1, FR-STAT-004). 둘 다 사전 계산 필드다. */
export const PERCENTILE_FIELDS = ['lead_time_seconds', 'first_review_wait_seconds'] as const;
export type PercentileField = (typeof PERCENTILE_FIELDS)[number];

export function isPercentileField(value: string): value is PercentileField {
  return (PERCENTILE_FIELDS as readonly string[]).includes(value);
}

export const DEFAULT_PERCENTILES = [50, 75, 90, 95, 99] as const;

/** 시계열 간격 (FR-STAT-002 AC-1). */
export const INTERVALS = ['hour', 'day', 'week', 'month'] as const;
export type Interval = (typeof INTERVALS)[number];

export function isInterval(value: string): value is Interval {
  return (INTERVALS as readonly string[]).includes(value);
}

/** 분포 축 (FR-STAT-005). */
export const DIMENSIONS = ['changed_files', 'changed_lines'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export function isDimension(value: string): value is Dimension {
  return (DIMENSIONS as readonly string[]).includes(value);
}

/**
 * 분포 구간 (FR-STAT-005 AC-1·AC-2).
 *
 * `to`가 `null`이면 위로 열린 구간이다. 문서에 값이 **없는** 것은 구간이 아니라
 * `unknown`이며, 그것은 0과 다른 사실이다 (AC-5).
 */
export interface DistributionBucketSpec {
  readonly key: string;
  readonly from: number;
  readonly to: number | null;
}

export const DISTRIBUTION_BUCKETS: Readonly<Record<Dimension, readonly DistributionBucketSpec[]>> = {
  changed_files: [
    { key: '1', from: 1, to: 1 },
    { key: '2-5', from: 2, to: 5 },
    { key: '6-20', from: 6, to: 20 },
    { key: '21-100', from: 21, to: 100 },
    { key: '100+', from: 101, to: null },
  ],
  changed_lines: [
    { key: '1-50', from: 1, to: 50 },
    { key: '51-200', from: 51, to: 200 },
    { key: '201-1000', from: 201, to: 1000 },
    { key: '1000+', from: 1001, to: null },
  ],
};

/** 분포가 세는 ES 필드. */
export const DIMENSION_FIELDS: Readonly<Record<Dimension, string>> = {
  changed_files: 'changed_files_count',
  changed_lines: 'changed_lines',
};

/**
 * 백분위에서 제외된 사유 (FR-STAT-004 AC-1, 예외/실패 처리).
 *
 * **리뷰가 없어서 값이 없는 것과 보강이 끝나지 않아 모르는 것은 다른 사실이다.**
 * 하나로 묶으면 운영자가 "리뷰 문화"와 "파이프라인 지연"을 구분할 수 없다.
 */
export type ExcludedReason = 'no_review' | 'enrichment_pending';
