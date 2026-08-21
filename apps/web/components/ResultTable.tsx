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
 * ## 관계 배지 열이 없는 이유
 *
 * `C-015 RelationBadgeGroup`은 WP-031 소관이고 `link_summary`는 WP-029까지
 * 비어 있다. **빈 열을 미리 두지 않는다** — 사용자가 "관계 없음"으로 읽는다
 * (CR-019, DEV-081).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Table } from '@conductor-by-89soone/react';
import { SequenceBadge } from './SequenceBadge';
import { commonSpace } from '../lib/sequence';
import { shortSha } from '../lib/format';

/** 목록 한 행. `/search`의 `items` 원소와 같은 모양이다. */
export interface ResultRow {
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
}

/** 정렬 가능한 열과 그 질의 키 (FR-SRCH-007 AC-1). */
const SORTABLE: readonly { readonly field: string; readonly label: string }[] = [
  { field: 'merge_seq', label: '시퀀스' },
  { field: 'merged_at', label: '머지 시각' },
  { field: 'changed_files_count', label: '변경 파일' },
  { field: 'additions', label: '추가' },
];

/** skeleton 행 수. 상태 매트릭스가 8행으로 정했다. */
const SKELETON_ROWS = 8;

function ariaSort(sort: SortState, field: string): 'ascending' | 'descending' | 'none' {
  if (sort.field !== field) return 'none';
  return sort.order === 'asc' ? 'ascending' : 'descending';
}

/** 행이 가리키는 곳. 서버가 준 `url`을 쓰고, 없으면 링크하지 않는다. */
function rowHref(row: ResultRow, fromQuery: string): string | null {
  if (row.url === null) return null;
  /*
   * 원본 입력을 `from_q`로 남긴다 (CR-019, DEV-078 / FLOW-001 4단계).
   * `q`를 쓰지 않는 이유는 상세 URL에 `q`가 있으면 그 화면이 검색 결과처럼
   * 읽히고, 공유된 링크가 의도와 다르게 해석되기 때문이다.
   */
  if (fromQuery.trim() === '') return row.url;
  return `${row.url}?from_q=${encodeURIComponent(fromQuery)}`;
}

/** 결과 행의 표시 이름. PR은 `#번호`, 커밋은 축약 SHA(12자)다. */
function displayName(row: ResultRow): string {
  if (row.kind === 'pull_request' && row.pr_number !== undefined) return `#${String(row.pr_number)}`;
  if (row.commit_sha !== undefined) return shortSha(row.commit_sha);
  return '(식별자 없음)';
}

export function ResultTable({
  rows,
  sort,
  onSortChange,
  loading = false,
  fromQuery = '',
}: ResultTableProps & { readonly fromQuery?: string }): ReactNode {
  // 목록 전체가 한 공간이면 그것이 문맥이다 (QA-W001-22).
  const context = commonSpace(rows.map((r) => r.sequence_space));

  return (
    <Table caption="검색 결과">
      <Table.Head>
        <Table.Row>
          {SORTABLE.map((column) => (
            <Table.HeaderCell key={column.field} scope="col" aria-sort={ariaSort(sort, column.field)}>
              {/*
               * 헤더 자체를 버튼으로 만든다 — 키보드로 정렬할 수 있어야 한다.
               * `aria-sort`는 `th`에 있어야 스크린 리더가 열의 정렬을 읽는다.
               */}
              <button
                type="button"
                onClick={() => {
                  onSortChange(column.field);
                }}
              >
                {column.label}
              </button>
            </Table.HeaderCell>
          ))}
          <Table.HeaderCell scope="col">유형</Table.HeaderCell>
          <Table.HeaderCell scope="col">제목</Table.HeaderCell>
          <Table.HeaderCell scope="col">작성자</Table.HeaderCell>
        </Table.Row>
      </Table.Head>

      <Table.Body>
        {loading
          ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <Table.Row key={`skeleton-${String(index)}`} data-testid="result-skeleton" aria-hidden="true">
                <Table.Cell colSpan={7}>&nbsp;</Table.Cell>
              </Table.Row>
            ))
          : rows.map((row) => {
              const href = rowHref(row, fromQuery);
              const name = displayName(row);
              return (
                <Table.Row key={`${row.repository ?? '?'}-${name}`} data-testid="result-row">
                  <Table.Cell numeric>
                    <SequenceBadge
                      merge_seq={row.merge_seq}
                      seq_epoch={row.seq_epoch}
                      sequence_space={row.sequence_space}
                      state={row.state}
                      contextSpace={context}
                    />
                  </Table.Cell>
                  <Table.Cell>{row.merged_at ?? '—'}</Table.Cell>
                  <Table.Cell numeric>{row.changed_files_count ?? '—'}</Table.Cell>
                  <Table.Cell numeric>{row.additions === null ? '—' : `+${String(row.additions)}`}</Table.Cell>
                  <Table.Cell>
                    <Badge tone="neutral">{row.kind === 'pull_request' ? 'PR' : '커밋'}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {/*
                     * **실제 링크다.** 새 탭 열기·가운데 클릭이 살아 있어야
                     * 조사 중에 여러 후보를 펼쳐 볼 수 있다 (C-013 접근성).
                     */}
                    {href === null ? (
                      <span>{row.title ?? name}</span>
                    ) : (
                      <Link href={href} data-testid="result-link">
                        {row.title ?? name}
                      </Link>
                    )}
                    <span className="cdt-sr-only"> ({row.repository ?? '저장소 미상'} {name})</span>
                  </Table.Cell>
                  <Table.Cell>{row.author ?? '—'}</Table.Cell>
                </Table.Row>
              );
            })}
      </Table.Body>
    </Table>
  );
}
