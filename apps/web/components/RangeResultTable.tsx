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
import { Badge, Table } from '@conductor-by-89soone/react';
import type { RangeItemView } from '../lib/range';
import { formatTimestamp } from '../lib/format';

export interface RangeResultTableProps {
  readonly repository: string;
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

export function RangeResultTable({ repository, items, missingInIndex }: RangeResultTableProps): ReactNode {
  return (
    <section aria-label="구간 결과" data-testid="range-results">
      {missingInIndex > 0 ? (
        <p data-testid="range-missing-in-index">
          {missingInIndex}건은 정본에는 있으나 색인 반영 대기 중입니다 — 서수·식별자만 확정 표시합니다.
        </p>
      ) : null}
      <Table caption="구간 내 항목 (서수 오름차순)">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell scope="col">seq</Table.HeaderCell>
            <Table.HeaderCell scope="col">제목</Table.HeaderCell>
            <Table.HeaderCell scope="col">작성자</Table.HeaderCell>
            <Table.HeaderCell scope="col">머지 시각</Table.HeaderCell>
            <Table.HeaderCell scope="col">규모</Table.HeaderCell>
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
                {item.indexed ? null : (
                  <Badge tone="neutral" data-testid="range-row-unindexed">
                    색인 대기
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
