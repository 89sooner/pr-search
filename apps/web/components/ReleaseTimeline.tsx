'use client';

/**
 * C-032 ReleaseTimeline — W-005-LIST (WP-026 / FR-SEQ-004).
 *
 * **저장소 스코프다** (CR-030, DEV-158). 브랜치가 다른 릴리스가 한 목록에 함께
 * 있어야 "다른 대상 브랜치 릴리스 2건 선택"(AC-3)이 만들어지고, 그래야 그 규칙을
 * 검증할 수 있다. 그래서 행마다 브랜치를 표기한다.
 *
 * **서수 없는 릴리스도 그린다.** 체인 밖 태그이거나 현재 에폭으로 아직 재해석되지
 * 않은 릴리스는 앵커가 될 수 없어 체크박스를 비활성하지만, 숨기면 "그런 태그가
 * 없다"로 오인된다.
 *
 * **순서를 바꾸지 않는다** — 서버가 시각 내림차순을 보장하고 여기서 다시 정렬하지
 * 않는다 (`RangeResultTable`·C-020과 같은 원칙).
 */

import type { ReactNode } from 'react';
import { Badge, Button, Checkbox, Table } from './ui';
import { isSelectable, previousLabel, type ReleaseRowView } from '../lib/release';
import { formatTimestamp } from '../lib/format';

/** 비교는 두 지점 사이다 — 셋을 고를 수 있으면 무엇과 무엇인지 물어야 한다. */
export const MAX_SELECTION = 2;

export interface ReleaseTimelineProps {
  readonly releases: readonly ReleaseRowView[];
  readonly selection: readonly string[];
  readonly onSelectionChange: (next: readonly string[]) => void;
  /**
   * 상세를 보고 있는 릴리스. **비교 선택과 다른 축이다** — 와이어프레임의
   * `release.select`(행 클릭)와 `release.compare`(체크 2건)는 서로 다른 조작이고,
   * 체크박스를 상세 선택으로 겸하면 두 건을 고르는 순간 상세가 무엇인지 모호해진다.
   */
  readonly selectedTag: string | null;
  readonly onSelect: (tagName: string) => void;
}

export function ReleaseTimeline({
  releases,
  selection,
  onSelectionChange,
  selectedTag,
  onSelect,
}: ReleaseTimelineProps): ReactNode {
  const full = selection.length >= MAX_SELECTION;

  return (
    <section aria-label="Release timeline" data-testid="release-timeline">
      <Table caption="Releases (newest first; select two to compare)">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell scope="col">Compare</Table.HeaderCell>
            <Table.HeaderCell scope="col">Tag</Table.HeaderCell>
            <Table.HeaderCell scope="col">Base branch</Table.HeaderCell>
            <Table.HeaderCell scope="col">Time</Table.HeaderCell>
            <Table.HeaderCell scope="col">Ordinal</Table.HeaderCell>
            <Table.HeaderCell scope="col">Since previous release</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {releases.map((release) => {
            const checked = selection.includes(release.tagName);
            const selectable = isSelectable(release);
            /*
             * 상한에 닿으면 **미선택 행만** 비활성한다. 눌러도 아무 일이 없는
             * 컨트롤을 두지 않고, 왜 못 누르는지는 `aria-describedby`가 말한다.
             */
            const disabled = !selectable || (full && !checked);
            const id = `release-select-${release.tagName}`;
            const noteId = `${id}-note`;
            const note = !selectable
              ? "Cannot use as a comparison anchor without an ordinal"
              : full && !checked
                ? "Select up to two releases. Deselect one first."
                : null;

            return (
              <Table.Row key={release.tagName} data-testid="release-row">
                <Table.Cell>
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={disabled}
                    aria-label={`Select ${release.tagName} for comparison`}
                    {...(note === null ? {} : { 'aria-describedby': noteId })}
                    onCheckedChange={(next) => {
                      const on = next === true;
                      if (on && full && !checked) return;
                      onSelectionChange(
                        on
                          ? [...selection, release.tagName]
                          : selection.filter((tag) => tag !== release.tagName),
                      );
                    }}
                  />
                  {note === null ? null : (
                    <span id={noteId} data-testid="release-select-note">
                      {note}
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Button
                    variant="ghost"
                    data-testid="release-select"
                    aria-pressed={selectedTag === release.tagName}
                    onClick={() => {
                      onSelect(release.tagName);
                    }}
                  >
                    {release.tagName}
                  </Button>
                </Table.Cell>
                <Table.Cell>
                  {release.baseBranch ?? (
                    <Badge tone="neutral" data-testid="release-off-chain">
                      Off chain
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>{formatTimestamp(release.releasedAt)}</Table.Cell>
                <Table.Cell>
                  {release.mergeSeq === null ? (
                    <Badge tone="neutral" data-testid="release-no-seq">
                      No ordinal
                    </Badge>
                  ) : (
                    release.mergeSeq
                  )}
                </Table.Cell>
                {/*
                 * 무엇과 비교한 수인지 함께 말한다 (DEV-155). "직전"은 서수
                 * 기준이라 목록의 바로 아래 행이 아닐 수 있다.
                 */}
                <Table.Cell data-testid="release-previous">{previousLabel(release)}</Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </section>
  );
}
