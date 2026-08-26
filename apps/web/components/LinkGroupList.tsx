'use client';

/**
 * C-021 LinkGroupList (WP-031 / CR-042, FR-REL-003~006).
 *
 * 표시 계층이다. 판정은 `lib/relations.ts`가 이미 끝냈다.
 *
 * ## 없는 것 · 모르는 것 · 실패한 것 · 해제된 것을 같이 그리지 않는다
 *
 * - `detached` — 스택 의존이 해제됐다. **숨기지도 active로 그리지도 않는다**
 *   (FR-REL-006 AC-3). 저장 계층이 지우지 않고 보존한 사실이다
 * - `contentAvailable: false` — 대상을 볼 수 없다. **사유를 밝히지 않는다**
 *   (THR-034). "권한이 없습니다"는 대상의 존재를 밝히는 문장이다
 * - `resolved: false` — 대상이 아직 색인되지 않았다. 원 표현만 보이고 링크 비활성
 * - `ambiguous` — 후보가 여럿이다. **하나를 고르지 않는다** (FR-REL-004 예외)
 *
 * ## `heuristic`은 근거를 반드시 함께 표시한다 (FR-REL-003 AC-2)
 *
 * `CodeBlock`은 `code: string`을 받아 **평문으로** 렌더링한다 — HTML로 해석하지
 * 않는다 (THR-020).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, CodeBlock, Table } from '@conductor-by-89soone/react';
import {
  confidenceLabel,
  directionLabel,
  linkTypeLabel,
  type RelationGroupView,
  type RelationItemView,
} from '../lib/relations';

export interface LinkGroupListProps {
  readonly group: RelationGroupView;
}

function endpointCell(item: RelationItemView): ReactNode {
  const { endpoint } = item;
  if (endpoint.url !== null) {
    return (
      <Link href={endpoint.url} data-testid="relation-target-link">
        {endpoint.label}
      </Link>
    );
  }
  // 링크를 만들 수 없다. 비활성 텍스트로 남기고 왜인지는 옆 배지가 말한다.
  return (
    <span data-testid="relation-target-inactive" aria-disabled="true">
      {endpoint.label}
    </span>
  );
}

export function LinkGroupList({ group }: LinkGroupListProps): ReactNode {
  if (group.items.length === 0) {
    return (
      <p data-testid={`relation-empty-${group.linkType}-${group.direction}`}>
        {linkTypeLabel(group.linkType)} 관계가 없습니다.
      </p>
    );
  }

  const caption = `${linkTypeLabel(group.linkType)} — ${directionLabel(group.linkType, group.direction)}`;

  return (
    <div data-testid={`relation-group-${group.linkType}-${group.direction}`}>
      <Table caption={caption}>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell scope="col">대상</Table.HeaderCell>
            <Table.HeaderCell scope="col">신뢰도</Table.HeaderCell>
            <Table.HeaderCell scope="col">상태</Table.HeaderCell>
            <Table.HeaderCell scope="col">근거</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {group.items.map((item) => (
            <Table.Row key={item.linkId} data-testid="relation-row">
              <Table.Cell>
                {/* 방향을 문장으로도 말한다 — 화살표만으로 주체·대상을 구분하지 않는다. */}
                <span className="cdt-sr-only">{directionLabel(group.linkType, group.direction)}: </span>
                {endpointCell(item)}
              </Table.Cell>
              <Table.Cell>
                <Badge tone="neutral" data-testid={`relation-confidence-${item.confidence ?? 'unknown'}`}>
                  {confidenceLabel(item.confidence)}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                {item.detached === true ? (
                  <Badge tone="warning" data-testid="relation-detached">
                    해제됨
                  </Badge>
                ) : null}
                {item.ambiguous ? (
                  <Badge tone="warning" data-testid="relation-ambiguous">
                    후보 여러 개
                  </Badge>
                ) : null}
                {!item.resolved ? (
                  <Badge tone="neutral" data-testid="relation-unresolved">
                    미해결 참조
                  </Badge>
                ) : null}
                {item.resolved && !item.endpoint.contentAvailable ? (
                  <Badge tone="neutral" data-testid="relation-content-unavailable">
                    대상 상세 없음
                  </Badge>
                ) : null}
              </Table.Cell>
              <Table.Cell>
                {/* `heuristic`은 근거를 반드시 보인다. 나머지도 있으면 보인다 — 감추면 조사가 근거를 잃는다. */}
                {item.evidence === '' ? (
                  '—'
                ) : (
                  <CodeBlock code={item.evidence} data-testid="relation-evidence" />
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {group.truncated ? (
        <p data-testid={`relation-truncated-${group.linkType}-${group.direction}`}>
          상한을 넘는 관계가 더 있습니다. 표시된 것은 일부입니다.
        </p>
      ) : null}
    </div>
  );
}
