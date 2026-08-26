/**
 * C-015 RelationBadgeGroup (WP-031 / CR-042, FR-REL-004·FR-REL-005).
 *
 * ## 요약이 없는 것과 관계가 없는 것은 다른 사실이다 (DEV-264)
 *
 * `summary`가 `null`이면 **아무것도 그리지 않는다.** 빈 배지 영역을 두면
 * 사용자가 "관계 없음"으로 읽는데, 그것은 아직 확인하지 않은 것을 확인했다고
 * 말하는 것이다 — C-014가 `unassigned`와 `not_computed`에 대해 세운 규율과
 * 같다 (CR-019, DEV-077).
 *
 * ## 행마다 조회하지 않는다 (ADR-009)
 *
 * 목록 응답이 실어 온 비정규화 `link_summary`만 쓴다. 그것이 그 필드가 존재하는
 * 이유이며, 여기서 관계 API를 부르면 결과 20행이 20번의 왕복이 된다.
 */

import type { ReactNode } from 'react';
import { Badge } from '@conductor-by-89soone/react';
import { summaryBadges, type LinkSummaryView } from '../lib/relations';

export interface RelationBadgeGroupProps {
  readonly summary: LinkSummaryView | null;
}

export function RelationBadgeGroup({ summary }: RelationBadgeGroupProps): ReactNode {
  const badges = summaryBadges(summary);
  // 요약값 자체가 없다 — 그리지 않는다. 이것이 "관계 없음"과 다른 점이다.
  if (badges === null) return null;
  if (badges.length === 0) return null;

  return (
    <span data-testid="relation-badges">
      {badges.map((badge) => (
        // 라벨 텍스트를 항상 포함한다 — 색상만으로 유형을 구분하지 않는다.
        <Badge key={badge.key} tone="neutral" data-testid={`relation-badge-${badge.key}`}>
          {badge.label}
        </Badge>
      ))}
    </span>
  );
}
