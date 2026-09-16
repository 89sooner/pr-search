'use client';

/**
 * C-004 EmptyState — 빈 상태의 **원인**과 다음 액션 (WP-015).
 *
 * 사용 규칙: "`cause`별로 문구와 액션이 다르다. 하나의 범용 '데이터가
 * 없습니다'로 대체하지 않는다."
 *
 * 이것이 이 제품에서 특히 중요한 이유는 0건의 원인이 넷이나 되기 때문이다 —
 * 아직 안 찾았거나, 조건이 좁거나, 저장소가 수집 대상이 아니거나, 볼 권한이
 * 없거나. 넷을 "결과 없음" 하나로 뭉치면 사용자가 무엇을 고쳐야 할지 알 수
 * 없고, 특히 "수집 대상이 아니다"를 "그런 커밋이 없다"로 오해한다.
 */

import type { ReactNode } from 'react';
import { EmptyState as ProductEmptyState } from './ui';

export type EmptyCause = 'no_query' | 'no_result' | 'not_indexed' | 'no_permission' | 'not_found';

/** 원인별 기본 문구. 화면이 `title`·`description`으로 덮어쓸 수 있다. */
const COPY: Readonly<Record<EmptyCause, { title: string; description: string }>> = {
  no_query: {
    title: "Enter a search query",
    description: "Paste a commit SHA, PR number, or GHE URL.",
  },
  no_result: {
    title: "No matching results",
    description: "Remove filters one at a time to broaden your search.",
  },
  not_indexed: {
    title: "This repository is not registered for ingestion",
    description: "Check whether the repository is registered. Results remain empty until the initial backfill completes.",
  },
  no_permission: {
    title: "No accessible repositories",
    description: "Permission changes may take up to five minutes. Contact an administrator if access is still unavailable.",
  },
  not_found: {
    title: "Not found",
    description: "Check the identifier. Items you cannot access are also shown as not found.",
  },
};

export interface EmptyStateProps {
  readonly cause: EmptyCause;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

export function EmptyState({ cause, title, description, actions }: EmptyStateProps): ReactNode {
  const copy = COPY[cause];
  return (
    <ProductEmptyState
      // 원인을 DOM에 남긴다 — 시험과 운영 조사가 어느 빈 상태인지 구분할 수 있어야 한다.
      data-cause={cause}
      title={title ?? copy.title}
      description={description ?? copy.description}
      {...(actions === undefined ? {} : { action: actions })}
    />
  );
}
