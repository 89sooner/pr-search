'use client';

/**
 * W-004 결과 목록 (WP-025 / W-004-RESULTS, QA-W004-11, CR-029 DEV-154).
 *
 * C-013을 쓰지 않는 이유: C-013은 정렬 컨트롤(정렬 변경 = 서버 재조회)을
 * 갖는 W-001 전용 표인데, 범위 결과는 **서수 오름차순 고정**이고 API에 정렬
 * 파라미터가 없다 — 부분 페이지를 클라이언트에서 재정렬하면 거짓이 된다.
 *
 * **순서를 바꾸지 않는다.** 서버(정본 조회)가 서수 오름차순을 보장하고,
 * 여기서 다시 정렬하지 않는다 — 두 곳이 각자 정렬하면 규칙이 갈라졌을 때
 * 화면이 그 사실을 숨긴다 (C-020과 같은 원칙).
 *
 * `indexed: false` 행은 서수·SHA·PR 번호만 확정이고 나머지는 색인 대기다
 * (DEV-130) — 빈칸을 채우지 않고 "색인 대기"로 말한다.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Table } from './ui';
import type { RangeItemView } from '../lib/range';
import { formatTimestamp } from '../lib/format';
import { MergeNumberBadge } from './MergeNumberBadge';

export interface RangeResultTableProps {
  readonly repository: string;
  /**
   * 이 결과가 속한 시퀀스 공간의 base 브랜치.
   *
   * M 배지의 링크는 저장소와 브랜치를 모두 알아야 성립한다. 범위 응답의 항목에는
   * 그 값이 없고 조사 조건에만 있으므로 화면이 내려 준다 — 행에서 짐작하지 않는다.
   */
  readonly baseBranch: string;
  readonly items: readonly RangeItemView[];
  /** 정본에는 있는데 색인에 없는 항목 수 (DEV-130) — 0이면 표기하지 않는다. */
  readonly missingInIndex: number;
}

function hrefOf(repository: string, item: RangeItemView): string {
  const [owner, name] = repository.split('/');
  if (item.prNumber !== null) {
    return `/pr/${owner ?? ''}/${name ?? ''}/${String(item.prNumber)}`;
  }
  return `/commit/${owner ?? ''}/${name ?? ''}/${item.commitSha}`;
}

export function RangeResultTable({ repository, baseBranch, items, missingInIndex }: RangeResultTableProps): ReactNode {
  return (
    <section aria-label="Range results" data-testid="range-results">
      {missingInIndex > 0 ? (
        <p data-testid="range-missing-in-index">
          {missingInIndex} items exist in the source of truth but are awaiting indexing. Only ordinals and identifiers are confirmed.
        </p>
      ) : null}
      <Table caption="Items in range (ascending ordinal)">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell scope="col">seq</Table.HeaderCell>
            <Table.HeaderCell scope="col">Title</Table.HeaderCell>
            <Table.HeaderCell scope="col">Author</Table.HeaderCell>
            <Table.HeaderCell scope="col">Merged at</Table.HeaderCell>
            <Table.HeaderCell scope="col">Size</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {items.map((item) => (
            <Table.Row key={item.mergeSeq} data-testid="range-row">
              <Table.Cell>{item.mergeSeq}</Table.Cell>
              <Table.Cell>
                <Link href={hrefOf(repository, item)} data-testid="range-row-link">
                  {item.title ??
                    (item.prNumber !== null ? `#${String(item.prNumber)}` : item.commitSha.slice(0, 12))}
                </Link>{' '}
                {/*
                  * M 병기 (WP-074 / 상세 설계 9절 — W-004는 **행 병기만** 한다).
                  *
                  * anchor·range·bisect의 입력은 그대로 `merge_seq`다. M 번호를 구간
                  * 입력으로 받지 않는다 — 직접 푸시가 섞인 구간에서 두 좌표계가
                  * 어긋나고, 인용의 근거가 무너진다.
                  */}
                <MergeNumberBadge
                  fields={item}
                  context={{ kind: item.kind, repository, baseBranch }}
                />{' '}
                {item.indexed ? null : (
                  <Badge tone="neutral" data-testid="range-row-unindexed">
                    Indexing pending
                  </Badge>
                )}
              </Table.Cell>
              <Table.Cell>{item.author ?? '—'}</Table.Cell>
              <Table.Cell>{item.mergedAt === null ? '—' : formatTimestamp(item.mergedAt)}</Table.Cell>
              <Table.Cell>
                {item.additions === null && item.deletions === null
                  ? '—'
                  : `+${String(item.additions ?? 0)} −${String(item.deletions ?? 0)}`}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </section>
  );
}
