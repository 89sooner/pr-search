'use client';

/**
 * C-018 CommitList — 머지 커밋과 원본 커밋 (WP-017 / FR-SRCH-003).
 *
 * ## 총계를 모를 때 아는 척하지 않는다
 *
 * `totalCount: null`은 **"250건 이상, 정확한 수 모름"**이다 (CR-020, DEV-083).
 * 배열 길이를 총계로 쓰면 "정확히 250건"이라는 거짓이 된다 — 절삭됐을 때
 * 서버가 총계 키를 빼는 것이 바로 그 뜻이다 (CR-017, DEV-063).
 *
 * ## 커밋 항목이 SHA뿐인 이유
 *
 * `EVT-ING-002`가 커밋에 대해 SHA만 나른다 (CR-017, DEV-062). 메시지·작성자는
 * WP-020이 미러로 보강할 때 붙는다. 없는 열을 미리 만들어 비워 두지 않는다.
 */

import type { ReactNode } from 'react';
import { Badge, Button, Table } from '@conductor-by-89soone/react';
import { shortSha } from '../lib/format';
import type { CommitListModel } from '../lib/pr-detail';

export interface CommitListProps extends CommitListModel {
  /** 보강 재조회. **자동 폴링을 하지 않는다** — 사용자가 누를 때만 (FLOW-002). */
  readonly onRefetch: () => void;
  readonly refetching: boolean;
}

/** 원본 커밋 수를 사람이 읽는 문구로. 모르면 모른다고 말한다. */
export function commitCountLabel(model: CommitListModel): string {
  const shown = model.sourceCommits.length;
  if (!model.truncated) return `원본 커밋 ${String(shown)}건`;
  if (model.totalCount === null) {
    // **"250건 중 250건"이라고 쓰지 않는다.** 총계를 모른다.
    return `원본 커밋 ${String(shown)}건 이상 (앞 ${String(shown)}건만 표시, 전체 건수는 수집하지 않습니다)`;
  }
  return `원본 커밋 ${String(model.totalCount)}건 중 앞 ${String(shown)}건`;
}

export function CommitList({
  mergeCommitSha,
  sourceCommits,
  truncated,
  totalCount,
  enrichmentPending,
  onRefetch,
  refetching,
}: CommitListProps): ReactNode {
  const model = { mergeCommitSha, sourceCommits, truncated, totalCount, enrichmentPending };

  return (
    <section aria-labelledby="commits-heading" data-testid="commit-list">
      <h2 id="commits-heading">커밋</h2>

      <Table caption="이 PR의 커밋">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell scope="col">역할</Table.HeaderCell>
            <Table.HeaderCell scope="col">SHA</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {/*
           * 머지 커밋은 **항상 첫 행**이고 배지로 구분한다 (C-018 사용 규칙).
           * 미머지면 그 사실을 적는다 — 행을 빼면 "커밋이 없다"로 읽힌다.
           */}
          <Table.Row data-testid="merge-commit-row">
            <Table.Cell>
              <Badge tone="accent">머지 커밋</Badge>
            </Table.Cell>
            <Table.Cell>
              {mergeCommitSha === null ? (
                <span data-testid="no-merge-commit">아직 머지되지 않았습니다</span>
              ) : (
                <code>{shortSha(mergeCommitSha)}</code>
              )}
            </Table.Cell>
          </Table.Row>

          {sourceCommits.map((commit) => (
            <Table.Row key={commit.commit_sha} data-testid="source-commit-row">
              <Table.Cell>
                <Badge tone="neutral">원본</Badge>
              </Table.Cell>
              <Table.Cell>
                <code>{shortSha(commit.commit_sha)}</code>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      {/*
       * 보강 미완료 (QA-W002-15). 머지 커밋은 위에서 이미 표시됐고
       * **여기만 수집 중이다.** 자동 폴링은 하지 않는다 (FLOW-002 예외 흐름).
       */}
      {enrichmentPending ? (
        <div data-testid="enrichment-pending">
          <Badge tone="warning">수집 중</Badge>
          <p>원본 커밋을 아직 수집하지 못했습니다. 머지 커밋은 위에 표시되어 있습니다.</p>
          <Button variant="secondary" loading={refetching} onClick={onRefetch}>
            다시 조회
          </Button>
        </div>
      ) : (
        <p data-testid="commit-count">{commitCountLabel(model)}</p>
      )}
    </section>
  );
}
