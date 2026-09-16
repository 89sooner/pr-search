'use client';

/**
 * C-039 SequenceSpaceStatusList — 시퀀스 공간별 상태 (W-009-SPACES / WP-034, CR-050).
 *
 * ## 색으로만 구분하지 않는다
 *
 * 네 상태에 전부 **텍스트 레이블**이 붙는다. 색을 못 보는 사용자에게도 어느
 * 공간이 재채번 중인지 전달되어야 한다.
 *
 * ## 경고와 함께 값을 준다
 *
 * `stale`·`reassigning`에서도 마지막 확정 서수와 에폭을 숨기지 않는다 — 값을
 * 지우면 사용자에게 남는 정보가 없다. `unknown`만 값이 없는 상태이고, 그것을
 * `0`으로 그리면 "0번까지 채번됐다"는 거짓이 된다.
 */

import type { ReactNode } from 'react';
import { Badge, Table } from './ui';
import {
  SEQUENCE_LABEL,
  hasSequenceValue,
  type SequenceSpaceView,
  type SequenceState,
} from '../lib/repository-overview';

/** 상태별 tone. `unknown`은 경고가 아니라 아직 모르는 것이다. */
const TONE: Readonly<Record<SequenceState, 'accent' | 'warning' | 'neutral'>> = {
  ok: 'accent',
  stale: 'warning',
  reassigning: 'warning',
  unknown: 'neutral',
};

export interface SequenceSpaceStatusListProps {
  readonly spaces: readonly SequenceSpaceView[];
}

export function SequenceSpaceStatusList({ spaces }: SequenceSpaceStatusListProps): ReactNode {
  if (spaces.length === 0) {
    return <p data-testid="sequence-spaces-empty">No sequence base branches configured.</p>;
  }

  return (
    <Table caption="Sequence space status" data-testid="sequence-spaces">
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell scope="col">Branch</Table.HeaderCell>
          <Table.HeaderCell scope="col">Last sequence</Table.HeaderCell>
          <Table.HeaderCell scope="col">Epoch</Table.HeaderCell>
          <Table.HeaderCell scope="col">Status</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {spaces.map((space) => (
          <Table.Row key={space.base_branch} data-branch={space.base_branch}>
            <Table.Cell>{space.base_branch}</Table.Cell>
            <Table.Cell data-testid="last-sequence">
              {hasSequenceValue(space) ? String(space.last_sequence) : '—'}
            </Table.Cell>
            <Table.Cell data-testid="seq-epoch">
              {space.seq_epoch === null ? '—' : String(space.seq_epoch)}
            </Table.Cell>
            <Table.Cell>
              <Badge tone={TONE[space.sequence_state]} data-state={space.sequence_state}>
                {SEQUENCE_LABEL[space.sequence_state]}
              </Badge>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
