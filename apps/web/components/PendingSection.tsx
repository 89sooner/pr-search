'use client';

/**
 * 아직 데이터가 없는 섹션의 골격 (WP-017 / W-002-NEIGHBORS·RELEASES·LINKS).
 *
 * ## 섹션을 숨기지 않는다
 *
 * 와이어프레임 구현 메모가 명시한다: "미머지 PR은 `W-002-NEIGHBORS`를
 * **비활성 상태로 렌더링**하고 사유를 표시한다. **섹션 자체를 숨기지 않는다** —
 * 숨기면 사용자가 기능 부재로 오인한다."
 *
 * 같은 원칙을 릴리스·관계에도 쓴다. 셋 다 데이터가 다른 WP에 있고, 없는
 * 이유가 서로 다르므로 **사유를 각각 적는다**.
 *
 * ## 확장해도 조회하지 않는다
 *
 * QA-W002-17이 "확장 시에만 조회"를 요구하는데 조회할 것이 아직 없다
 * (CR-020, DEV-088). **금지 규칙 쪽을 지금 세운다** — 진입 시 함께 부르지
 * 않는 구조를 잡아야 WP-031이 조회를 붙일 때 고칠 것이 없다.
 */

import { useState, type ReactNode } from 'react';
import { Badge, Button, Panel } from './ui';

export interface PendingSectionProps {
  readonly id: string;
  readonly title: string;
  /** 왜 비어 있는가. 사용자가 읽고 납득할 문장이어야 한다. */
  readonly reason: string;
  /** 어느 WP가 채우는가. 운영·개발이 추적할 수 있게 남긴다. */
  readonly owner: string;
  /**
   * 확장했을 때 조회할 함수. **지금은 아무도 넘기지 않는다** — 데이터가
   * 없기 때문이다. WP-031이 붙일 자리를 미리 열어 둔다.
   */
  readonly onExpand?: () => void;
}

export function PendingSection({ id, title, reason, owner, onExpand }: PendingSectionProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  return (
    <Panel as="section" aria-labelledby={`${id}-heading`} data-testid={`section-${id}`}>
      <h2 id={`${id}-heading`}>
        {title} <Badge tone="neutral">Coming soon</Badge>
      </h2>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={`${id}-body`}
        data-testid={`toggle-${id}`}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          // 확장할 때만 부른다 — 접을 때는 부르지 않는다 (QA-W002-17).
          if (next) onExpand?.();
        }}
      >
        {expanded ? 'Collapse' : 'Expand'}
      </Button>

      <div id={`${id}-body`} hidden={!expanded} data-testid={`body-${id}`}>
        <p data-testid={`reason-${id}`}>{reason}</p>
        <p>
          <span className="ui-sr-only">Owning work package: </span>
          {owner}
        </p>
      </div>
    </Panel>
  );
}
