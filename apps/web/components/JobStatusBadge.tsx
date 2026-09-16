/**
 * 잡 상태 배지 — Conductor `Status` 어휘로 그린다 (WP-040 / FR-ADMIN-002 AC-2).
 *
 * ## 왜 별도 파일인가
 *
 * `A-003`의 표와 `A-002`의 채번 잡 안내가 같은 상태를 그린다. 두 곳이 각자
 * 매핑을 두면 한쪽만 고쳐지는 날 같은 잡이 화면마다 다른 상태로 보인다.
 *
 * ## 색만으로 뜻을 나르지 않는다 (FR-A11Y-003)
 *
 * `StatusBadge`는 색·아이콘·텍스트 **세 채널**을 요구하고 아이콘 노드는
 * 소비자가 준다 — Conductor는 아이콘 세트를 담지 않는다. 이 저장소에는
 * `lucide-react`가 없으므로 토큰이 정한 이름을 `data-ui-icon`으로 싣고
 * 시각 기호를 함께 그린다. 이름을 지어내지 않는 것이 요점이다:
 * `STATUS_ICONS`가 그 이름의 정본이다.
 */

import type { ReactNode } from 'react';
import { StatusBadge } from './ui';
import type { Status } from './ui';

/**
 * 잡 상태 여섯을 Conductor `Status` 일곱 중 하나로 옮긴다 (FR-ADMIN-002 AC-2).
 *
 * `cancelled`가 `neutralEnd`인 것은 그것이 **끝났지만 성공도 실패도 아닌**
 * 상태이기 때문이다. `failed`와 같은 `danger`로 그리면 운영자가 자기가 누른
 * 중단을 장애로 읽는다.
 */
const JOB_STATUS: Readonly<Record<string, Status>> = {
  queued: 'queued',
  running: 'running',
  paused: 'waiting',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutralEnd',
};

const JOB_STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** 상태별 시각 기호. 아이콘 이름은 토큰이 정하고 여기서 지어내지 않는다. */
const GLYPHS: Readonly<Record<Status, string>> = {
  queued: '◌',
  running: '◐',
  waiting: '⏸',
  success: '✓',
  partial: '!',
  danger: '✕',
  neutralEnd: '⊘',
};

function StatusIcon({ status }: { readonly status: Status }): ReactNode {
  return (
    <span aria-hidden="true" data-ui-icon={status}>
      {GLYPHS[status]}
    </span>
  );
}

export interface JobStatusBadgeProps {
  readonly state: string;
}

export function JobStatusBadge({ state }: JobStatusBadgeProps): ReactNode {
  /*
   * 아는 상태가 아니면 배지를 만들지 않고 값을 그대로 적는다. 모르는 값을
   * `neutralEnd` 같은 것으로 접으면 새 상태가 조용히 "끝남"으로 보인다.
   */
  const status = JOB_STATUS[state];
  if (status === undefined) {
    return <span data-testid="job-status-unknown">{state}</span>;
  }

  return (
    <StatusBadge
      status={status}
      icon={<StatusIcon status={status} />}
      label={JOB_STATUS_LABELS[state] ?? state}
      data-testid="job-status"
      data-state={state}
    />
  );
}
