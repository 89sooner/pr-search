'use client';

/**
 * W-010 실행 판정 표시 (WP-080 / FR-GH-011 AC-6·AC-9, FR-GH-009 AC-8, CR-090).
 *
 * 서버가 capability 목록에 실어 준 실행 판정(`execution_gate`)을 사용자의 말로 그린다 — 관리자 운영 승인 필요, 관리자 정책 차단,
 * 레지스트리 불일치, 정책 확인 불가를 서로 다르게 말한다. 기능 꺼짐(404)과 계정 연결·권한은 이미 다른 자리가 그린다. 실행
 * 가능하면 아무것도 그리지 않는다. **「회사에서 전 기능 사용 가능」 같은 말을 하지 않는다** — 승인은 R0 정의 하나의 결정이다.
 */

import type { ReactNode } from 'react';
import { ErrorBanner } from './ErrorBanner';
import { gateState, gateText, type ExecutionGateView } from '../lib/gh-policy';

export function GhExecutionGateBanner({ gate }: { readonly gate: ExecutionGateView | null | undefined }): ReactNode {
  const state = gateState(gate);
  const text = gateText(gate);
  if (state === null || state === 'ready' || text === null) return null;
  return (
    <div data-testid="gh-execution-gate" data-gate-state={state} data-gate-reason={gate?.reason ?? undefined}>
      <ErrorBanner tone="warning" title={text.title} impact={text.description} />
    </div>
  );
}
