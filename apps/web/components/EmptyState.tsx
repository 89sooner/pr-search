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
import { EmptyState as ConductorEmptyState } from '@conductor-by-89soone/react';

export type EmptyCause = 'no_query' | 'no_result' | 'not_indexed' | 'no_permission' | 'not_found';

/** 원인별 기본 문구. 화면이 `title`·`description`으로 덮어쓸 수 있다. */
const COPY: Readonly<Record<EmptyCause, { title: string; description: string }>> = {
  no_query: {
    title: '검색어를 입력하세요',
    description: '커밋 SHA, PR 번호, GHE URL을 그대로 붙여넣어도 됩니다.',
  },
  no_result: {
    title: '조건에 맞는 결과가 없습니다',
    description: '조건을 하나씩 빼면서 범위를 넓혀 보세요.',
  },
  not_indexed: {
    title: '수집 대상이 아닌 저장소입니다',
    description: '저장소가 등록되어 있는지 확인하세요. 등록 직후에는 백필이 끝날 때까지 결과가 비어 있습니다.',
  },
  no_permission: {
    title: '볼 수 있는 저장소가 없습니다',
    description: '접근 권한이 반영되기까지 최대 5분이 걸립니다. 그 뒤에도 같으면 관리자에게 문의하세요.',
  },
  not_found: {
    title: '찾을 수 없습니다',
    description: '식별자가 정확한지 확인하세요. 접근 권한이 없는 경우에도 같게 보입니다.',
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
    <ConductorEmptyState
      // 원인을 DOM에 남긴다 — 시험과 운영 조사가 어느 빈 상태인지 구분할 수 있어야 한다.
      data-cause={cause}
      title={title ?? copy.title}
      description={description ?? copy.description}
      {...(actions === undefined ? {} : { action: actions })}
    />
  );
}
