'use client';

/**
 * C-028 RangeSummaryCard (WP-025 / W-004-SUMMARY, FR-SEQ-002 AC-2).
 *
 * **되돌림 수는 값이 없으면 "준비 중"이다** (CR-029 DEV-150). API가 키를
 * 주지 않는 동안(WP-030 전) 0으로 그리면 "이 구간에 되돌림이 없다"는
 * 거짓이 된다 — 조사 화면에서 그 거짓은 잘못된 결론으로 직행한다.
 */

import type { ReactNode } from 'react';
import { Card, CardGrid } from './ui';
import type { RangeSummaryView } from '../lib/range';

export interface RangeSummaryCardProps {
  readonly summary: RangeSummaryView;
}

export function RangeSummaryCard({ summary }: RangeSummaryCardProps): ReactNode {
  return (
    <section aria-label="Range summary" data-testid="range-summary">
      <CardGrid>
        <Card data-testid="summary-pr-count">
          <h3>PR</h3>
          <p>{summary.pullRequestCount} items</p>
        </Card>
        <Card data-testid="summary-commit-count">
          <h3>Commit</h3>
          <p>{summary.commitCount} items</p>
        </Card>
        <Card data-testid="summary-author-count">
          <h3>Author</h3>
          <p>{summary.distinctAuthorCount} people</p>
        </Card>
        <Card data-testid="summary-size">
          <h3>Change size</h3>
          <p>
            Files {summary.changedFilesTotal} · +{summary.additionsTotal} −{summary.deletionsTotal}
            {summary.filesTruncatedPullRequestCount > 0
              ? `(truncated PRs: ${String(summary.filesTruncatedPullRequestCount)} — actual totals may be larger)`
              : ''}
          </p>
        </Card>
        <Card data-testid="summary-reverts">
          <h3>Has reverts</h3>
          {summary.reverted.kind === 'count' ? (
            <p>{summary.reverted.count} items</p>
          ) : (
            // 계산하지 않은 것을 계산한 척하지 않는다 (DEV-133·150).
            <p data-testid="summary-reverts-pending">Pending — relationship derivation ({summary.reverted.owner}) must complete first</p>
          )}
        </Card>
      </CardGrid>

      {summary.topChangedPaths.length > 0 ? (
        <details data-testid="summary-top-paths">
          <summary>Top changed paths {summary.topChangedPaths.length}</summary>
          <ul>
            {summary.topChangedPaths.map((entry) => (
              <li key={entry.path}>
                <code className="ui-mono">{entry.path}</code> — {entry.count} items
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
