/**
 * 선행·후행의 판정 (WP-027 / FR-REL-001, API-REL-001, CR-031).
 *
 * 판정을 렌더링에 섞지 않는다 — 앞선 화면들과 같은 이유다. 이 파일이 정하는 것:
 *
 * 1. **직접 푸시 커밋 행을 지우지 않는다** (DEV-161). 서버가 준 순서를 그대로 믿고
 *    재정렬하지 않으며, 제목·작성자가 없는 행도 서수·SHA로 그린다 (DEV-166).
 * 2. **"머지되지 않았다"와 "아직 모른다"를 가른다** (DEV-164 / C-014의 DEV-077).
 * 3. **범위 확장이 넘기는 앵커는 지금 보고 있는 창이다** (DEV-167): 첫 항목이
 *    시작(제외), 마지막 항목이 끝(포함).
 * 4. **에폭 비교는 쓰기가 아니다** (QA-W002-16): 문서의 에폭과 응답의 현재 에폭이
 *    다르면 경고만 내고 자동으로 다시 부르지 않는다.
 */

import { formatRangeQuery } from './range';

/** FR-REL-001 AC-1. 한쪽당 건수다 — 목록은 최대 `2N + 1`행이 된다. */
export const DEFAULT_NEIGHBOR_COUNT = 10;
export const MAX_NEIGHBOR_COUNT = 50;
export const NEIGHBOR_COUNT_OPTIONS = [10, 25, 50] as const;

export function clampNeighborCount(raw: number): number {
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_NEIGHBOR_COUNT;
  return Math.min(raw, MAX_NEIGHBOR_COUNT);
}

export interface NeighborRowView {
  readonly mergeSeq: number;
  readonly kind: 'pull_request' | 'commit';
  readonly commitSha: string;
  readonly prNumber: number | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly mergedAt: string | null;
  readonly isAnchor: boolean;
  /** 정본에는 있는데 색인에 표시값이 없다 (DEV-130). 직접 푸시 커밋은 늘 이 상태다. */
  readonly indexed: boolean;
  readonly url: string;
}

export interface NeighborsView {
  readonly anchorSeq: number;
  readonly sequenceSpace: string | null;
  readonly seqEpoch: number | null;
  readonly items: readonly NeighborRowView[];
  readonly boundary: { readonly atStart: boolean; readonly atEnd: boolean };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 응답 → 목록. 모양이 어긋난 항목은 지어내지 않고 건너뛴다. */
export function judgeNeighbors(source: unknown): NeighborsView | null {
  const body = (source ?? {}) as Record<string, unknown>;
  const anchor = body['anchor'];
  if (typeof anchor !== 'object' || anchor === null) return null;
  const anchorSeq = (anchor as Record<string, unknown>)['merge_seq'];
  if (typeof anchorSeq !== 'number') return null;

  const raw = body['items'];
  const items: NeighborRowView[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record['merge_seq'] !== 'number' || typeof record['commit_sha'] !== 'string') continue;
      const prNumber = typeof record['pr_number'] === 'number' ? record['pr_number'] : null;
      items.push({
        mergeSeq: record['merge_seq'],
        kind: prNumber === null ? 'commit' : 'pull_request',
        commitSha: record['commit_sha'],
        prNumber,
        title: stringOrNull(record['title']),
        author: stringOrNull(record['author']),
        mergedAt: stringOrNull(record['merged_at']),
        isAnchor: record['is_anchor'] === true,
        indexed: record['indexed'] === true,
        url: stringOrNull(record['url']) ?? '',
      });
    }
  }

  const boundary = (body['boundary'] ?? {}) as Record<string, unknown>;
  return {
    anchorSeq,
    sequenceSpace: stringOrNull(body['sequence_space']),
    seqEpoch: typeof body['seq_epoch'] === 'number' ? body['seq_epoch'] : null,
    items,
    boundary: { atStart: boundary['at_start'] === true, atEnd: boundary['at_end'] === true },
  };
}

export type NoSequenceReason = 'not_merged' | 'not_sequenced';

/**
 * 409의 사유를 읽는다.
 *
 * **모르면 `null`이다.** 사유를 못 읽었는데 하나로 단정하면 화면이 "머지되지
 * 않았다"는 사실 주장을 근거 없이 하게 된다 (DEV-077이 금지하는 것).
 */
export function judgeNoSequence(body: unknown): NoSequenceReason | null {
  const error = ((body ?? {}) as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) return null;
  const detail = (error as Record<string, unknown>)['detail'];
  if (typeof detail !== 'object' || detail === null) return null;
  const reason = (detail as Record<string, unknown>)['reason'];
  return reason === 'not_merged' || reason === 'not_sequenced' ? reason : null;
}

/**
 * 지금 보고 있는 창 → W-004 딥링크 (DEV-167).
 *
 * 첫 항목이 시작(**제외**), 마지막 항목이 끝(포함)이다. 반개구간 `(from, to]`의
 * 뜻 그대로이며, W-004가 두 앵커에 "제외"/"포함" 라벨을 상시 표시하므로 첫 행이
 * 왜 빠졌는지 사용자가 그 화면에서 바로 읽는다.
 *
 * **서수는 `seq:` 접두를 붙인다.** 맨 숫자는 `classifyAnchor`가 의도적으로
 * `ambiguous`로 판정해(PR 번호인지 서수인지 고르지 않는다) 조회가 잠긴 채로
 * 도착한다 — WP-026에서 실제로 겪은 결함이다.
 *
 * @returns 항목이 둘 미만이면 `null` — 구간이 성립하지 않는다.
 */
export function neighborRangeHref(
  repo: string,
  branch: string,
  items: readonly NeighborRowView[],
  epoch: number | null,
): string | null {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined || first.mergeSeq >= last.mergeSeq) return null;
  const query = formatRangeQuery({
    repo,
    branch,
    from: `seq:${String(first.mergeSeq)}`,
    to: `seq:${String(last.mergeSeq)}`,
    ...(epoch === null ? {} : { epoch }),
  });
  return `/ranges?${query}`;
}

/**
 * 화면이 들고 있던 에폭과 응답의 현재 에폭 (QA-W002-16 / FR-SEQ-005 AC-4).
 *
 * `unknown`은 비교할 값이 없는 것이지 일치가 아니다 — 없는 근거로 "괜찮다"고
 * 말하지 않는다.
 */
export function judgeNeighborEpoch(
  documentEpoch: number | null,
  currentEpoch: number | null,
): 'match' | 'stale' | 'unknown' {
  if (documentEpoch === null || currentEpoch === null) return 'unknown';
  return documentEpoch === currentEpoch ? 'match' : 'stale';
}
