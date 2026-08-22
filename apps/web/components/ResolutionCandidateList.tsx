'use client';

/**
 * C-017 ResolutionCandidateList — 해석 후보 카드 (WP-016 / FR-SRCH-001 AC-5).
 *
 * ## 표시만 한다
 *
 * 명세의 사용 규칙: "후보가 1건이어도 **자동 이동은 상위 화면이 결정한다.**
 * 이 컴포넌트는 표시만 담당한다." 그래서 여기에는 라우팅이 없다 — 카드가
 * 링크일 뿐이고, 언제 자동으로 따라갈지는 화면이 정한다.
 *
 * ## 절삭을 밝힌다
 *
 * 접두 결과가 상한을 넘으면 앞부분만 온다 (FR-SRCH-004 AC-3). 그것을
 * 말하지 않으면 사용자가 "이게 전부"로 읽고 엉뚱한 후보를 고른다.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardGrid } from '@conductor-by-89soone/react';
import { SequenceBadge } from './SequenceBadge';
import { shortSha } from '../lib/format';
import { withFromQuery } from '../lib/query-url';

/** `/resolve`의 후보 하나. 유형에 따라 채워지는 키가 다르다. */
export interface ResolutionCandidate {
  readonly kind: 'commit' | 'pull_request';
  readonly repository: string | null;
  readonly display_name: string | null;
  readonly url: string | null;
  readonly commit_sha?: string;
  readonly pr_number?: number;
  readonly state?: string;
  readonly author?: string;
  readonly merge_seq: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_space: string | null;
}

export interface ResolutionCandidateListProps {
  readonly candidates: readonly ResolutionCandidate[];
  readonly truncated: boolean;
  /** 원본 입력. 상세로 갈 때 `from_q`로 실어 뒤로가기를 살린다 (DEV-078). */
  readonly fromQuery: string;
}

function label(candidate: ResolutionCandidate): string {
  if (candidate.display_name !== null && candidate.display_name !== '') return candidate.display_name;
  if (candidate.pr_number !== undefined) return `#${String(candidate.pr_number)}`;
  if (candidate.commit_sha !== undefined) return shortSha(candidate.commit_sha);
  return '(이름 없음)';
}

export function ResolutionCandidateList({
  candidates,
  truncated,
  fromQuery,
}: ResolutionCandidateListProps): ReactNode {
  return (
    <section aria-label="해석 후보" data-testid="candidate-list">
      <h2>후보 {candidates.length}건</h2>
      <p>
        입력한 문자열이 여러 대상과 일치합니다. 어느 것인지 골라 주세요 — 자동으로 이동하지
        않았습니다.
      </p>

      {/* 절삭은 결과보다 먼저 말한다 (FR-SRCH-004 AC-3, QA-W001-06). */}
      {truncated ? (
        <p role="status" data-testid="candidates-truncated">
          일치하는 대상이 많아 일부만 표시했습니다. 저장소나 작성자 조건을 더하면 좁힐 수 있습니다.
        </p>
      ) : null}

      <CardGrid>
        {candidates.map((candidate) => {
          const name = label(candidate);
          const href = withFromQuery(candidate.url, fromQuery);

          const body = (
            <>
              <strong>{name}</strong>
              <span>{candidate.kind === 'pull_request' ? 'PR' : '커밋'}</span>
              <span>{candidate.repository ?? '저장소 미상'}</span>
              {candidate.author === undefined ? null : <span>{candidate.author}</span>}
              <SequenceBadge
                merge_seq={candidate.merge_seq}
                seq_epoch={candidate.seq_epoch}
                sequence_space={candidate.sequence_space}
                state={candidate.state ?? null}
              />
            </>
          );

          return href === null ? (
            <Card key={`${candidate.repository ?? '?'}-${name}`}>{body}</Card>
          ) : (
            // 링크 시맨틱을 유지한다 — 후보를 새 탭으로 펼쳐 비교할 수 있어야 한다.
            <Card key={`${candidate.repository ?? '?'}-${name}`} as="div">
              <Link href={href} data-testid="candidate-link">
                {body}
              </Link>
            </Card>
          );
        })}
      </CardGrid>
    </section>
  );
}
