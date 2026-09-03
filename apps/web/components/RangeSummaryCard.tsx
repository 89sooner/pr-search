'use client';

/**
 * C-028 RangeSummaryCard (WP-025 / W-004-SUMMARY, FR-SEQ-002 AC-2).
 *
 * **되돌림 수는 값이 없으면 "준비 중"이다** (CR-029 DEV-150). API가 키를
 * 주지 않는 동안(WP-030 전) 0으로 그리면 "이 구간에 되돌림이 없다"는
 * 거짓이 된다 — 조사 화면에서 그 거짓은 잘못된 결론으로 직행한다.
 */

import type { ReactNode } from 'react';
import { Card, CardGrid } from '@conductor-by-89soone/react';
import type { RangeSummaryView } from '../lib/range';

export interface RangeSummaryCardProps {
  readonly summary: RangeSummaryView;
}

export function RangeSummaryCard({ summary }: RangeSummaryCardProps): ReactNode {
  return (
    <section aria-label="구간 요약" data-testid="range-summary">
      <CardGrid>
        <Card data-testid="summary-pr-count">
          <h3>PR</h3>
          <p>{summary.pullRequestCount}건</p>
        </Card>
        <Card data-testid="summary-commit-count">
          <h3>커밋</h3>
          <p>{summary.commitCount}건</p>
        </Card>
        <Card data-testid="summary-author-count">
          <h3>작성자</h3>
          <p>{summary.distinctAuthorCount}명</p>
        </Card>
        <Card data-testid="summary-size">
          <h3>변경 규모</h3>
          <p>
            파일 {summary.changedFilesTotal} · +{summary.additionsTotal} −{summary.deletionsTotal}
            {summary.filesTruncatedPullRequestCount > 0
              ? ` (절삭 PR ${String(summary.filesTruncatedPullRequestCount)}건 — 실제는 더 클 수 있음)`
              : ''}
          </p>
        </Card>
        <Card data-testid="summary-reverts">
          <h3>되돌림 보유</h3>
          {summary.reverted.kind === 'count' ? (
            <p>{summary.reverted.count}건</p>
          ) : (
            // 계산하지 않은 것을 계산한 척하지 않는다 (DEV-133·150).
            <p data-testid="summary-reverts-pending">준비 중 — 관계 파생({summary.reverted.owner})이 서면 표시됩니다</p>
          )}
        </Card>
      </CardGrid>

      {summary.topChangedPaths.length > 0 ? (
        <details data-testid="summary-top-paths">
          <summary>변경 경로 상위 {summary.topChangedPaths.length}</summary>
          <ul>
            {summary.topChangedPaths.map((entry) => (
              <li key={entry.path}>
                <code className="cdt-mono">{entry.path}</code> — {entry.count}건
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
