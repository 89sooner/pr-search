'use client';

/**
 * C-005 ErrorBanner — 원인·영향·복구 액션·상관 ID (WP-015).
 *
 * 사용 규칙: "복구 불가 오류는 `correlationId`를 반드시 표시한다."
 *
 * 상관 ID가 없으면 사용자가 운영자에게 "검색이 안 돼요"밖에 말할 수 없고,
 * 운영자는 로그 수백만 줄에서 그 요청을 찾을 방법이 없다. 그래서 복구
 * 불가일 때는 **표시를 선택 사항으로 두지 않는다** — 아래 `assertRecoverable`이
 * 그것을 개발 중에 잡는다.
 */

import type { ReactNode } from 'react';
import { Banner } from '@conductor-by-89soone/react';

export type ErrorTone = 'info' | 'warning' | 'danger';

export interface ErrorBannerProps {
  readonly tone: ErrorTone;
  readonly title: ReactNode;
  /** 이 오류가 사용자에게 무엇을 뜻하는가. "실패했습니다"만으로는 부족하다. */
  readonly impact: ReactNode;
  readonly action?: ReactNode;
  readonly correlationId?: string | null;
  /**
   * 사용자가 스스로 복구할 수 있는가.
   *
   * `false`면 `correlationId`가 **반드시** 있어야 한다 — 없으면 사용자가
   * 운영자에게 전달할 것이 아무것도 없다.
   */
  readonly recoverable?: boolean;
}

export function ErrorBanner({
  tone,
  title,
  impact,
  action,
  correlationId,
  recoverable = true,
}: ErrorBannerProps): ReactNode {
  const id = correlationId ?? null;

  if (!recoverable && id === null && process.env.NODE_ENV !== 'production') {
    // 개발 중에 잡는다. 운영에서 던지면 오류 화면이 또 다른 오류로 덮인다.
    // eslint-disable-next-line no-console
    console.error('[C-005] 복구 불가 오류에는 correlationId가 있어야 한다');
  }

  return (
    <Banner tone={tone} title={title} {...(action === undefined ? {} : { action })}>
      <p>{impact}</p>
      {id === null ? null : (
        <p data-testid="correlation-id">
          문의 시 이 값을 함께 알려 주세요: <code>{id}</code>
        </p>
      )}
    </Banner>
  );
}
