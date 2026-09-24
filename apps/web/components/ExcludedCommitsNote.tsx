/**
 * 원본 커밋에서 뺀 커밋의 안내 (CR-117 / FR-SRCH-003 AC-5).
 *
 * PR 상세(C-018 `CommitList`)와 저장소 작업 공간의 상세 창이 **같은 문구**를 쓴다. 한쪽만 안내하면
 * 다른 쪽에서는 GitHub과 수가 다른 이유를 알 수 없다. 뺀 것이 없으면 아무것도 그리지 않는다.
 */

import type { ReactNode } from 'react';
import { excludedCommitsLabel } from '../lib/pr-detail';

export interface ExcludedCommitsNoteProps {
  /** 서버가 준 `source_commits_excluded`. 키가 없는 옛 응답은 0으로 넘긴다. */
  readonly count: number;
  /** 원본 목록이 절삭됐는가. 그때 뺀 수는 읽은 목록 안의 값이다. */
  readonly truncated: boolean;
  readonly className?: string;
}

export function ExcludedCommitsNote({ count, truncated, className }: ExcludedCommitsNoteProps): ReactNode {
  const note = excludedCommitsLabel(count, truncated);
  if (note === null) return null;
  return (
    <p className={className} data-testid="excluded-commits">
      {note}
    </p>
  );
}
