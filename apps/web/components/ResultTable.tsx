'use client';

/**
 * C-013 ResultTable — 결과 목록, 정렬 제어, 행 이동 (WP-016 / FR-SRCH-006, FR-SRCH-007).
 *
 * ## 행은 링크다
 *
 * 명세가 "행 이동은 **링크 시맨틱**으로 구현해 새 탭 열기를 지원"을 요구한다.
 * `onClick`으로 `router.push`를 부르면 가운데 클릭·⌘클릭·"새 탭에서 열기"가
 * 전부 죽는다 — 조사 도구에서 그것은 큰 손실이다. 그래서 제목 칸에 실제
 * `<a href>`를 둔다.
 *
 * ## 관계 배지 열 (CR-042, DEV-262·264)
 *
 * WP-029까지 `link_summary`가 비어 있어 빈 열을 두지 않았다 (CR-019, DEV-081).
 * WP-030이 값을 채우면서 도달 가능해졌고 WP-031이 붙인다.
 *
 * **요약이 없는 행에는 아무것도 그리지 않는다.** `null`은 "아직 요약값이 없다"
 * 이고 값이 있는데 전부 비어 있는 것은 "확인했고 관계가 없다"이다 — 둘을 같이
 * 그리면 없는 사실을 주장하게 된다 (C-014가 세운 규율, DEV-077).
 *
 * **행마다 관계를 조회하지 않는다.** 목록 응답이 실어 온 비정규화
 * `link_summary`만 쓴다 — 그것이 그 필드가 존재하는 이유다 (ADR-009).
 */

import Link from 'next/link';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Table } from '@conductor-by-89soone/react';
import { SequenceBadge } from './SequenceBadge';
import { HighlightedText } from './HighlightedText';
import { RelationBadgeGroup } from './RelationBadgeGroup';
import type { LinkSummaryView } from '../lib/relations';
import { primaryFragment, type HighlightMap } from '../lib/highlight';

import { commonSpace } from '../lib/sequence';
import { MergeNumberBadge } from './MergeNumberBadge';
import { splitSequenceSpace, type MergeNumberFields } from '../lib/merge-number';
import { WorkbenchIcon } from './WorkbenchIcon';
import { shortSha, formatTimestamp } from '../lib/format';
import { withFromQuery } from '../lib/query-url';

/**
 * 목록 한 행. `/search`의 `items` 원소와 같은 모양이다.
 *
 * M 키(`merge_number*`)는 `MergeNumberFields`에서 온다 — **전부 선택**이라
 * 기능이 꺼진 배포와 구버전 응답에서는 키 자체가 없고 배지도 그리지 않는다
 * (WP-074 / API-SEQ-007).
 */
export interface ResultRow extends MergeNumberFields {
  readonly kind: 'pull_request' | 'commit';
  readonly repository: string | null;
  readonly pr_number?: number;
  readonly commit_sha?: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly state: string | null;
  readonly merge_seq: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_space: string | null;
  readonly merged_at: string | null;
  readonly changed_files_count: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  /** 비정규화 관계 요약 (ADR-009). **`null`은 "요약이 아직 없다"이다.** */
  readonly link_summary?: LinkSummaryView | null;
  /**
   * 강조 조각 (WP-032 / FR-SRCH-011 AC-5).
   *
   * **평문과 구간이다** — 마크업이 아니다 (THR-018). 자유 텍스트 검색이 아닐
   * 때는 키 자체가 없다.
   */
  readonly highlight?: HighlightMap;
  readonly url: string | null;
}


export interface SortState {
  readonly field: string;
  readonly order: 'asc' | 'desc';
}

export interface ResultTableProps {
  readonly rows: readonly ResultRow[];
  readonly sort: SortState;
  readonly onSortChange: (field: string) => void;
  /** 로딩 중이면 skeleton을 그린다 (상태 매트릭스 `loading_initial`). */
  readonly loading?: boolean;
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string | null) => void;
}

/** WP-073 / FR-SRCH-007: 헤더가 정렬 방향을 스크린 리더에 전달한다. */
function ariaSort(sort: SortState, field: string): 'ascending' | 'descending' | 'none' {
  if (sort.field !== field) return 'none';
  return sort.order === 'asc' ? 'ascending' : 'descending';
}

export function resultIdentity(row: ResultRow): string {
  return JSON.stringify([row.kind, row.repository, row.pr_number, row.commit_sha, row.sequence_space]);
}

/** 행이 가리키는 곳. 서버가 준 `url`을 쓰고, 없으면 링크하지 않는다. */
function rowHref(row: ResultRow, fromQuery: string): string | null {
  if (row.url === null) return null;
  /*
   * 원본 입력을 `from_q`로 남긴다 (CR-019, DEV-078 / FLOW-001 4단계).
   * `q`를 쓰지 않는 이유는 상세 URL에 `q`가 있으면 그 화면이 검색 결과처럼
   * 읽히고, 공유된 링크가 의도와 다르게 해석되기 때문이다.
   */
  return withFromQuery(row.url, fromQuery);
}

/**
 * 제목 칸의 내용.
 *
 * **`dangerouslySetInnerHTML`을 쓰지 않는다** (THR-018). API가 평문과 구간을
 * 주고 여기서 텍스트 노드와 `<mark>`로 조립한다 — 제목이 `<script>`를 담고
 * 있어도 그것은 글자로 그려진다.
 */
function TitleText({ row, fallback }: { row: ResultRow; fallback: string }): ReactNode {
  const fragment =
    primaryFragment(row.highlight, 'title') ?? primaryFragment(row.highlight, 'message');
  if (fragment !== null) return <HighlightedText fragment={fragment} />;
  return <>{row.title ?? fallback}</>;
}

/** 결과 행의 표시 이름. PR은 `#번호`, 커밋은 축약 SHA(12자)다. */
export function resultName(row: ResultRow): string {
  if (row.kind === 'pull_request' && row.pr_number !== undefined) return `#${String(row.pr_number)}`;
  if (row.commit_sha !== undefined) return shortSha(row.commit_sha);
  return '(식별자 없음)';
}

export function ResultTable({
  rows, sort, onSortChange, loading = false, fromQuery = '', selectedId = null, onSelect,
}: ResultTableProps & { readonly fromQuery?: string }): ReactNode {
  const context = commonSpace(rows.map((r) => r.sequence_space));
  const selections = useRef<Map<string, HTMLButtonElement>>(new Map());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') { event.preventDefault(); onSelect?.(null); return; }
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const row = rows[next];
    if (row === undefined) return;
    const id = resultIdentity(row);
    onSelect?.(id);
    selections.current.get(id)?.focus({ preventScroll: true });
    selections.current.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function sortHeader(field: string, label: string): ReactNode {
    return <Table.HeaderCell scope="col" aria-sort={ariaSort(sort, field)}>
      <Button variant="ghost" size="sm" className="prs-sort-button" type="button"
        onClick={() => { onSortChange(field); }}>{label}</Button>
    </Table.HeaderCell>;
  }

  return (
    <Table className="prs-result-table" caption="검색 결과" aria-label="검색 결과"
      scrollContainerProps={{ tabIndex: 0, role: 'region', ...(onSelect === undefined ? {} : { 'aria-describedby': 'result-keyboard-help' }) }}>
      <Table.Head>
        <Table.Row>
          {onSelect === undefined ? null : <Table.HeaderCell scope="col"><span className="cdt-sr-only">미리보기</span><WorkbenchIcon name="preview" /></Table.HeaderCell>}
          {sortHeader('merge_seq', '시퀀스')}
          <Table.HeaderCell scope="col">변경 내용</Table.HeaderCell>
          <Table.HeaderCell scope="col">작성자</Table.HeaderCell>
          <Table.HeaderCell scope="col">상태</Table.HeaderCell>
          {sortHeader('merged_at', '머지 시각')}
          {sortHeader('changed_files_count', '변경 파일')}
          {sortHeader('additions', '추가')}
          <Table.HeaderCell scope="col">관계</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {loading ? Array.from({ length: 8 }, (_, index) => (
          <Table.Row key={index} data-testid="result-skeleton" aria-hidden="true">
            <Table.Cell colSpan={onSelect === undefined ? 8 : 9}><span className="prs-skeleton-line">&nbsp;</span></Table.Cell>
          </Table.Row>
        )) : rows.map((row, index) => {
          const href = rowHref(row, fromQuery);
          const name = resultName(row);
          const id = resultIdentity(row);
          const selected = id === selectedId;
          return (
            <Table.Row key={id} data-testid="result-row" data-selected={selected ? '' : undefined}
              onClick={onSelect === undefined ? undefined : (event) => {
                if ((event.target as HTMLElement).closest('a,button,input')) return;
                onSelect(id);
                selections.current.get(id)?.focus({ preventScroll: true });
              }}>
              {onSelect === undefined ? null : <Table.Cell>
                <Button variant="ghost" size="sm" className="prs-row-select"
                  ref={(node) => { if (node === null) selections.current.delete(id); else selections.current.set(id, node); }}
                  data-result-select={id} aria-label={`${row.repository ?? ''} ${name} 미리보기`}
                  aria-pressed={selected} aria-describedby="result-keyboard-help"
                  tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1}
                  onKeyDown={(event) => { onKeyDown(event, index); }}
                  onClick={() => { onSelect(selected ? null : id); }}>
                  <WorkbenchIcon name="preview" />
                </Button>
              </Table.Cell>}
              <Table.Cell numeric><SequenceBadge merge_seq={row.merge_seq} seq_epoch={row.seq_epoch}
                sequence_space={row.sequence_space} state={row.state} contextSpace={context} /></Table.Cell>
              <Table.Cell className="prs-result-title">
                <div className="prs-result-title-line">
                  <span className="prs-result-kind" title={row.kind === 'pull_request' ? 'Pull request' : '커밋'}><WorkbenchIcon name={row.kind === 'pull_request' ? 'branch' : 'commit'} /><span className="cdt-sr-only">{row.kind === 'pull_request' ? 'PR' : '커밋'}</span></span>
                  <span className="prs-result-id prs-mono">{name}</span>
                  {/*
                    * M 배지 (WP-074 / FR-SEQ-008 AC-9 — 상세 설계 9절).
                    *
                    * **행마다 resolve를 부르지 않는다.** 이 목록 응답이 이미 실어 온
                    * M 키만 읽는다 (`link_summary`와 같은 규율, ADR-009). 문맥은
                    * `sequence_space`에서 가른다 — 목록 DTO에는 `base_branch`가 없고,
                    * 링크에는 그 값이 있어야 한다.
                    */}
                  <MergeNumberBadge
                    fields={row}
                    context={{
                      kind: row.kind,
                      repository: splitSequenceSpace(row.sequence_space)?.repository ?? row.repository,
                      baseBranch: splitSequenceSpace(row.sequence_space)?.baseBranch ?? null,
                    }}
                  />
                  {href === null ? <span><TitleText row={row} fallback={name} /></span> :
                    <Link href={href} data-testid="result-link" title={row.title ?? name}><TitleText row={row} fallback={name} /></Link>}
                </div>
                <span className="prs-result-repository prs-mono">{row.sequence_space ?? row.repository ?? '저장소 미상'}</span>
              </Table.Cell>
              <Table.Cell><span className="prs-cell-truncate" title={row.author ?? undefined}>{row.author ?? '—'}</span></Table.Cell>
              <Table.Cell><span className="prs-result-state" data-state={row.state ?? 'unknown'}>{row.state === 'merged' ? '머지됨' : row.state === 'open' ? '열림' : row.state === 'closed' ? '닫힘' : row.state ?? '—'}</span></Table.Cell>
              <Table.Cell><time className="prs-timestamp" dateTime={row.merged_at ?? undefined} title={row.merged_at ?? undefined}>{formatTimestamp(row.merged_at)}</time></Table.Cell>
              <Table.Cell numeric>{row.changed_files_count ?? '—'}</Table.Cell>
              <Table.Cell numeric><span className="prs-diff-added">{row.additions === null ? '—' : `+${row.additions}`}</span></Table.Cell>
              <Table.Cell><RelationBadgeGroup summary={row.link_summary ?? null} /></Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}
