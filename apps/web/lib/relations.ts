/**
 * 관계 조회 응답의 화면 판정 (WP-031 / CR-042, C-015·C-021).
 *
 * 라우트 핸들러 없이 시험할 수 있도록 **순수 함수**로 떼어 낸다 —
 * `lib/containment.ts`·`lib/neighbors.ts`와 같은 구조다.
 *
 * ## 이 파일이 지키는 구분 넷
 *
 * | 사실 | 표현 |
 * | --- | --- |
 * | 대상이 아직 색인되지 않았다 | `resolved: false` — 원 표현만, 링크 비활성 |
 * | 대상을 볼 수 없다 | `contentAvailable: false` — 사유를 밝히지 않는다 |
 * | 의존이 해제되었다 | `detached: true` — 숨기지도 active로 그리지도 않는다 |
 * | 후보가 여럿이다 | `ambiguous: true` — 하나를 고르지 않는다 |
 */

export type RelationLinkType = 'references' | 'reverts' | 'cherry_picks' | 'stacks_on';
export type RelationDirection = 'outgoing' | 'incoming';
export type RelationConfidence = 'exact' | 'derived' | 'heuristic';

/**
 * 목록 화면의 비정규화 관계 요약 (ADR-009).
 *
 * **`null`과 "전부 false"는 다른 사실이다** (CR-042, DEV-264). 전자는 요약값이
 * 아직 없다는 것이고 후자는 확인했고 관계가 없다는 것이다.
 */
export interface LinkSummaryView {
  readonly has_revert?: boolean;
  readonly is_reverted?: boolean;
  readonly has_cherry_pick?: boolean;
  /** PR 문서에만 있다 — 커밋에는 스택이라는 개념이 없다 (CR-041). */
  readonly has_stack?: boolean;
  readonly reference_count?: number;
}

export interface RelationEndpointView {
  readonly kind: 'pull_request' | 'commit' | null;
  /** 화면에 그릴 이름. 대상을 못 보면 원 참조 표현이거나 안내 문구다. */
  readonly label: string;
  readonly repository: string | null;
  /** `null`이면 링크를 비활성으로 둔다. */
  readonly url: string | null;
  readonly contentAvailable: boolean;
}

export interface RelationItemView {
  readonly linkId: string;
  readonly confidence: RelationConfidence | null;
  readonly evidence: string;
  readonly resolved: boolean;
  /** `stacks_on`에만 있다. 다른 유형은 `null`이며 "해제 아님"이 아니다. */
  readonly detached: boolean | null;
  readonly ambiguous: boolean;
  readonly endpoint: RelationEndpointView;
}

export interface RelationGroupView {
  readonly linkType: RelationLinkType;
  readonly direction: RelationDirection;
  readonly items: readonly RelationItemView[];
  readonly truncated: boolean;
}

const LINK_TYPES: readonly RelationLinkType[] = [
  'references',
  'reverts',
  'cherry_picks',
  'stacks_on',
];
const CONFIDENCES: readonly RelationConfidence[] = ['exact', 'derived', 'heuristic'];

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

/** 신뢰도 배지 라벨. 색상만으로 구분하지 않는다. */
export function confidenceLabel(confidence: RelationConfidence | null): string {
  if (confidence === 'exact') return 'Certain';
  if (confidence === 'derived') return 'Derived';
  if (confidence === 'heuristic') return 'Inferred';
  return 'Unknown';
}

/** 유형별 그룹 제목. */
export function linkTypeLabel(linkType: RelationLinkType): string {
  switch (linkType) {
    case 'references':
      return 'References';
    case 'reverts':
      return 'Reverts';
    case 'cherry_picks':
      return 'Cherry-pick';
    case 'stacks_on':
      return 'Stack';
  }
}

/**
 * 방향을 **문장으로** 말한다 (CR-042, C-021).
 *
 * 화살표만 그리면 주체와 대상이 뒤집혀도 화면이 같아 보인다. QA-W002-11이
 * 요구하는 것은 방향이 사용자에게 **읽히는** 것이다.
 */
export function directionLabel(linkType: RelationLinkType, direction: RelationDirection): string {
  const outgoing = direction === 'outgoing';
  switch (linkType) {
    case 'reverts':
      return outgoing ? 'Reverted by this item' : 'Items that revert this item';
    case 'cherry_picks':
      return outgoing ? 'Originals cherry-picked by this item' : 'Copies cherry-picked from this item';
    case 'stacks_on':
      return outgoing ? 'Parent PRs this PR depends on' : 'Child PRs that depend on this PR';
    case 'references':
      return outgoing ? 'Items referenced by this item' : 'Items that reference this item';
  }
}

function judgeEndpoint(raw: unknown, resolved: boolean): RelationEndpointView {
  const source = (raw ?? {}) as Record<string, unknown>;
  const kindValue = str(source['kind']);
  const kind = kindValue === 'pull_request' || kindValue === 'commit' ? kindValue : null;
  const repository = str(source['repository']);
  const url = str(source['url']);
  const expression = str(source['reference_expression']);

  const prNumber = typeof source['pr_number'] === 'number' ? source['pr_number'] : null;
  const commitSha = str(source['commit_sha']);
  const title = str(source['title']);

  if (url !== null) {
    const identity =
      prNumber !== null
        ? `#${String(prNumber)}`
        : commitSha === null
          ? ''
          : commitSha.slice(0, 12);
    const prefix = repository === null ? identity : `${repository} ${identity}`.trim();
    return {
      kind,
      label: title === null ? prefix : `${prefix} ${title}`.trim(),
      repository,
      url,
      contentAvailable: true,
    };
  }

  /*
   * 링크를 만들 수 없는 두 경우다 — 대상이 아직 색인되지 않았거나(`resolved:
   * false`), 볼 수 없거나. **문구로 둘을 구분하지 않는다**: 후자를 "권한이
   * 없습니다"라고 쓰면 대상의 존재가 드러난다 (THR-034).
   */
  if (expression !== null) {
    return { kind, label: expression, repository, url: null, contentAvailable: false };
  }
  return {
    kind,
    label: resolved ? 'Target details are unavailable' : 'The target has not been indexed yet',
    repository,
    url: null,
    contentAvailable: false,
  };
}

/** API-REL-006 응답을 화면 모델로 옮긴다. 형식이 어긋나면 `null`. */
export function judgeRelations(body: unknown): RelationGroupView | null {
  if (typeof body !== 'object' || body === null) return null;
  const source = body as Record<string, unknown>;

  const linkType = str(source['link_type']);
  const direction = str(source['direction']);
  if (linkType === null || !LINK_TYPES.includes(linkType as RelationLinkType)) return null;
  if (direction !== 'outgoing' && direction !== 'incoming') return null;
  if (!Array.isArray(source['items'])) return null;

  const items: RelationItemView[] = [];
  for (const raw of source['items'] as readonly unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const linkId = str(item['link_id']);
    if (linkId === null) continue;

    const confidenceValue = str(item['confidence']);
    const confidence =
      confidenceValue !== null && CONFIDENCES.includes(confidenceValue as RelationConfidence)
        ? (confidenceValue as RelationConfidence)
        : null;
    const resolved = bool(item['resolved']);

    items.push({
      linkId,
      confidence,
      evidence: str(item['evidence']) ?? '',
      resolved,
      // 키가 없으면 `null`이다. `false`로 채우면 "해제될 수 있는데 아니다"가 된다.
      detached: typeof item['detached'] === 'boolean' ? item['detached'] : null,
      ambiguous: bool(item['ambiguous']),
      endpoint: judgeEndpoint(item['endpoint'], resolved),
    });
  }

  return {
    linkType: linkType as RelationLinkType,
    direction,
    items,
    truncated: bool(source['truncated']),
  };
}

export interface RelationBadge {
  readonly key: string;
  readonly label: string;
}

/**
 * C-015가 그릴 배지.
 *
 * @returns 요약값이 없으면 `null` — **배지 영역 자체를 그리지 않는다.** 빈
 * 배열을 돌려주면 화면이 "관계 없음"으로 그리게 되고, 그것은 아직 확인하지
 * 않은 것을 확인했다고 말하는 것이다 (CR-042, DEV-264 / CR-019, DEV-077).
 */
export function summaryBadges(summary: LinkSummaryView | null | undefined): readonly RelationBadge[] | null {
  if (summary === null || summary === undefined) return null;

  const badges: RelationBadge[] = [];
  if ((summary.reference_count ?? 0) > 0) {
    badges.push({ key: 'references', label: `References: ${String(summary.reference_count)}` });
  }
  if (summary.has_revert === true) badges.push({ key: 'has_revert', label: 'Reverts' });
  if (summary.is_reverted === true) badges.push({ key: 'is_reverted', label: 'Reverted' });
  if (summary.has_cherry_pick === true) badges.push({ key: 'has_cherry_pick', label: 'Cherry-pick' });
  if (summary.has_stack === true) badges.push({ key: 'has_stack', label: 'Stack' });
  return badges;
}

/* ------------------------------------------------------------------------- */
/* 동시 변경 (API-REL-003)                                                     */
/* ------------------------------------------------------------------------- */

export type CoChangeReason = 'not_merged' | 'enrichment_pending' | 'too_many_changed_files';

export interface CoChangeItemView {
  readonly repository: string | null;
  readonly prNumber: number | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly similarity: number;
  readonly overlappingPaths: readonly string[];
  readonly url: string | null;
}

export type CoChangeView =
  | { readonly kind: 'unavailable'; readonly reason: CoChangeReason | null }
  | { readonly kind: 'ready'; readonly items: readonly CoChangeItemView[] };

const CO_CHANGE_REASONS: readonly CoChangeReason[] = [
  'not_merged',
  'enrichment_pending',
  'too_many_changed_files',
];

/** 계산할 수 없는 사유를 사용자 문장으로. **오류가 아니라 정상 상태다.** */
export function coChangeReasonLabel(reason: CoChangeReason | null): string {
  switch (reason) {
    case 'not_merged':
      return 'Co-changes cannot be calculated before merging. They cover 90 days before and after the merge time.';
    case 'enrichment_pending':
      return 'Co-changes cannot be calculated until changed paths are collected.';
    case 'too_many_changed_files':
      return 'Excluded from co-change analysis because more than 200 files changed.';
    default:
      return 'Co-changes cannot be calculated.';
  }
}

export function judgeCoChanges(body: unknown): CoChangeView | null {
  if (typeof body !== 'object' || body === null) return null;
  const source = body as Record<string, unknown>;

  if (source['available'] !== true) {
    const reason = str(source['reason']);
    return {
      kind: 'unavailable',
      reason:
        reason !== null && CO_CHANGE_REASONS.includes(reason as CoChangeReason)
          ? (reason as CoChangeReason)
          : null,
    };
  }

  if (!Array.isArray(source['items'])) return null;
  const items: CoChangeItemView[] = [];
  for (const raw of source['items'] as readonly unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const paths = Array.isArray(item['overlapping_paths'])
      ? (item['overlapping_paths'] as readonly unknown[]).filter(
          (path): path is string => typeof path === 'string',
        )
      : [];
    items.push({
      repository: str(item['repository']),
      prNumber: typeof item['pr_number'] === 'number' ? item['pr_number'] : null,
      title: str(item['title']),
      author: str(item['author']),
      similarity: typeof item['similarity'] === 'number' ? item['similarity'] : 0,
      overlappingPaths: paths,
      url: str(item['url']),
    });
  }
  return { kind: 'ready', items };
}
