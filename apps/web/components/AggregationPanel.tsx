'use client';

/**
 * C-030 AggregationPanel — 그룹 집계 표와 근거 목록 이동 (WP-038 / FR-STAT-001, FR-STAT-006).
 *
 * ## 드릴다운 질의는 서버가 준 것을 그대로 쓴다
 *
 * 각 그룹 행의 `drill_down_query`는 이미 `kind:pull_request`를 포함하고 team은
 * `author_team:`을 쓴다(FR-STAT-001 AC-5, WP-037). 클라이언트가 재조립하면 OR가
 * 남거나 인코딩이 틀려 목록이 버킷보다 큰 수를 보인다 — 그래서 문자열을 손대지 않는다.
 *
 * ## 세 가지를 조용히 숨기지 않는다
 *
 * `truncated`(상위 500만 보임), `approximate`(100만 초과 근사), 그리고 빈 그룹.
 * team 그룹은 작성자 팀 투영이 아직 없어 정상적으로 비어 있다(WP-037) — 그것을
 * 0이나 오류로 그리지 않는다.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Panel, Table } from '@conductor-by-89soone/react';
import { formatDuration } from '../lib/format';

export interface AggregationGroup {
  readonly key: string;
  readonly count: number;
  readonly changed_files_sum: number;
  readonly additions_sum: number;
  readonly lead_time_median: number | null;
  /** 서버가 완성해 실어 준 근거 목록 질의. */
  readonly drill_down_query: string;
}

export interface AggregationPanelProps {
  readonly groups: readonly AggregationGroup[];
  readonly approximate?: boolean;
  readonly truncated?: boolean;
  /** `seq:` 범위가 있을 때 드릴다운에 보존할 에폭. */
  readonly seqEpoch?: string | null;
  /** 드릴다운 href를 만든다. 뷰가 seq 보존 규칙을 안다. */
  readonly hrefFor: (drillDownQuery: string) => string | null;
  /** 그룹 키의 사람이 읽는 이름. team은 숫자 id가 아니라 이름으로 온다. */
  readonly groupLabel?: string;
}

function num(value: number): string {
  return value.toLocaleString('ko-KR');
}

export function AggregationPanel({
  groups,
  approximate = false,
  truncated = false,
  hrefFor,
  groupLabel = '그룹',
}: AggregationPanelProps): ReactNode {
  return (
    <Panel as="section" aria-label="그룹 집계">
      <header>
        <h3>그룹 집계</h3>
        {approximate ? (
          <Badge tone="warning" data-testid="approximate-badge">
            근사값
          </Badge>
        ) : null}
        {truncated ? (
          <Badge tone="info" data-testid="truncated-badge">
            상위 500개만
          </Badge>
        ) : null}
      </header>

      {groups.length === 0 ? (
        <p data-testid="group-empty">이 그룹으로 집계할 데이터가 없습니다.</p>
      ) : (
        <Table caption="그룹별 건수와 변경 규모, 리드타임 중앙값">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell scope="col">{groupLabel}</Table.HeaderCell>
              <Table.HeaderCell scope="col" aria-sort="descending">
                건수
              </Table.HeaderCell>
              <Table.HeaderCell scope="col">변경 파일 합계</Table.HeaderCell>
              <Table.HeaderCell scope="col">추가 라인 합계</Table.HeaderCell>
              <Table.HeaderCell scope="col">리드타임 중앙값</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {groups.map((group) => {
              const href = hrefFor(group.drill_down_query);
              return (
                <Table.Row key={group.key}>
                  <Table.HeaderCell scope="row">
                    {href === null ? (
                      group.key
                    ) : (
                      <Link href={href} data-testid="group-drilldown">
                        {group.key}
                      </Link>
                    )}
                  </Table.HeaderCell>
                  <Table.Cell numeric>{num(group.count)}</Table.Cell>
                  <Table.Cell numeric>{num(group.changed_files_sum)}</Table.Cell>
                  <Table.Cell numeric>{num(group.additions_sum)}</Table.Cell>
                  <Table.Cell numeric>
                    {group.lead_time_median === null ? '—' : formatDuration(group.lead_time_median)}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}
    </Panel>
  );
}
