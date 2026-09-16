'use client';

/**
 * A-004 기록 목록 (WP-039 / `A-004-LIST`, QA-A004-02·10, CR-054).
 *
 * ## C-013을 쓰지 않는 이유
 *
 * `C-013 ResultTable`은 정렬 컨트롤을 갖는 W-001 전용 표이고 행 모양이
 * `ResultRow`(PR·커밋)에 묶여 있다. 감사 기록은 **정렬이 고정**이며
 * (`occurred_at DESC, audit_id DESC` — `API-ADM-005`가 그 순서로만 순회한다)
 * 열도 전혀 다르다. `W-004`의 `RangeResultTable`이 같은 자리에서 같은 판단을
 * 했다 — 재사용의 뜻은 **같은 시각 규칙**이지 같은 컴포넌트가 아니다.
 *
 * ## 빈 칸을 채우지 않는다
 *
 * `target`·`query`는 의미상 없을 때 `null`로 온다 (FR-AUTH-004 AC-2). `N/A`나
 * 빈 문자열을 그리면 **"대상이 없는 액션"과 "대상을 기록하지 못한 액션"이 같은
 * 모양이 된다.** 없음을 없음으로 그린다.
 *
 * ## 수정·삭제 컨트롤이 없다
 *
 * 행 액션도, 선택 상자도, 일괄 삭제도 두지 않는다 (AC-3, QA-A004-03).
 * 불변성의 실제 방어선은 DB 롤 권한이지만(마이그레이션 005) 화면이 그것을
 * 흉내 낼 수 있는 자리를 아예 만들지 않는다.
 */

import type { ReactNode } from 'react';
import { Table } from './ui';
import type { AuditRecordView } from '../lib/audit';
import { formatTimestamp } from '../lib/format';

export interface AuditRecordTableProps {
  readonly items: readonly AuditRecordView[];
}

/** 값이 없음을 그리는 한 자리. 세 열이 같은 모양을 쓴다. */
function Absent(): ReactNode {
  return (
    <span data-testid="audit-absent" aria-label="No value">
      —
    </span>
  );
}

export function AuditRecordTable({ items }: AuditRecordTableProps): ReactNode {
  return (
    <Table data-testid="audit-record-table">
      <caption>Audit records, newest first. Records cannot be edited or deleted.</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">User</th>
          <th scope="col">Action</th>
          <th scope="col">Target</th>
          <th scope="col">Query</th>
          <th scope="col">Results</th>
          <th scope="col">Correlation ID</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row) => (
          <tr key={`${row.correlationId}:${row.occurredAt}:${row.action}`} data-testid="audit-row">
            <td>{formatTimestamp(row.occurredAt)}</td>
            <td>{row.userId}</td>
            <td data-testid="audit-action">{row.action}</td>
            <td data-testid="audit-target">{row.target ?? <Absent />}</td>
            {/*
              질의는 길다. 자르지 않고 그대로 둔다 — AC-2가 요구하는 것이
              **재구성 가능한** 질의 문자열이고, 줄인 값은 그 성질을 잃는다.
            */}
            <td data-testid="audit-query">{row.query ?? <Absent />}</td>
            <td>{row.resultCode}</td>
            <td>{row.correlationId}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
