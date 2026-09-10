'use client';

/**
 * C-032 ReleaseTimeline (WP-026 / W-005-LIST, FR-SEQ-004).
 *
 * 릴리스 목록과 비교용 체크박스 2건 선택을 제공한다.
 *
 * - **순서는 서버의 서수 내림차순을 그대로 그린다** (CR-030, DEV-159) —
 *   재정렬 컨트롤이 없다. "직전 릴리스"가 서수 기준이라는 사실과 목록의
 *   순서가 같은 근거를 딛는다.
 * - **상한 2에서 나머지 체크박스를 비활성으로 그린다** (`maxSelection`) —
 *   셋째 선택을 말없이 버리는 대신 고를 수 없음을 보이게 한다.
 * - 행의 태그 이름 버튼이 상세 선택(`release.select`)이다 — 체크박스(비교
 *   후보)와 역할이 다르므로 컨트롤을 나눈다.
 */

import type { ReactNode } from 'react';
import { Badge, Checkbox } from '@conductor-by-89soone/react';
import { formatTimestamp } from '../lib/format';
import { MAX_COMPARE_SELECTION, toggleSelection, type ReleaseView } from '../lib/releases';

export interface ReleaseTimelineProps {
  readonly releases: readonly ReleaseView[];
  /** 비교 후보로 체크된 태그 이름들 — 최대 `maxSelection`개. */
  readonly selection: readonly string[];
  readonly onSelectionChange: (next: readonly string[]) => void;
  readonly maxSelection?: number;
  /** 상세가 열린 태그. 행 강조와 `aria-current`의 근거다. */
  readonly detailTag: string | null;
  readonly onDetailSelect: (tag: string) => void;
}

export function ReleaseTimeline({
  releases,
  selection,
  onSelectionChange,
  maxSelection = MAX_COMPARE_SELECTION,
  detailTag,
  onDetailSelect,
}: ReleaseTimelineProps): ReactNode {
  const atLimit = selection.length >= maxSelection;

  return (
    <ol data-testid="release-timeline" aria-label="릴리스 타임라인 (서수 내림차순)">
      {releases.map((release) => {
        const checked = selection.includes(release.tagName);
        const checkboxId = `release-check-${release.tagName}`;
        return (
          <li
            key={release.tagName}
            data-testid={`release-row-${release.tagName}`}
            aria-current={detailTag === release.tagName ? 'true' : undefined}
          >
            <Checkbox
              id={checkboxId}
              checked={checked}
              // 상한에서 체크되지 않은 상자만 잠근다 — 해제는 언제나 가능해야 한다.
              disabled={!checked && atLimit}
              onCheckedChange={() => {
                onSelectionChange(toggleSelection(selection, release.tagName));
              }}
            />
            {/* 체크박스만 읽으면 무엇을 고르는지 들리지 않는다 — 태그 이름이 라벨이다. */}
            <label htmlFor={checkboxId} data-testid={`release-check-label-${release.tagName}`}>
              비교 대상: {release.tagName}
            </label>
            <button
              type="button"
              data-testid={`release-detail-${release.tagName}`}
              onClick={() => {
                onDetailSelect(release.tagName);
              }}
            >
              {release.tagName}
            </button>
            <span data-testid={`release-meta-${release.tagName}`}>
              {formatTimestamp(release.releasedAt)} · seq {release.mergeSeq} ·{' '}
              {release.pullRequestCount === null
                ? 'PR 수 미확인'
                : release.previousTagName === null
                  ? `PR ${release.pullRequestCount.toLocaleString()}건 (히스토리 시작부터)`
                  : `PR ${release.pullRequestCount.toLocaleString()}건`}
            </span>
            {release.previousTagName === null ? <Badge tone="neutral">첫 릴리스</Badge> : null}
          </li>
        );
      })}
    </ol>
  );
}
