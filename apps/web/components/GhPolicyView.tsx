'use client';

/**
 * A-005 실행 정책 — 최소 부분 (WP-080 / FR-GH-009 AC-8, CR-090).
 *
 * 이 판이 여는 것은 **실행 가능한 capability(`pr.list`)의 차단과 재개** 하나다. 운영자는 현재 허용·차단 상태, 차단하면 사용자에게
 * 보일 사유, 마지막 변경자와 revision을 보고 사유와 함께 바꾼다. 위험도 재정의·승인 정책 편집·엔드포인트·확장 허용 목록은
 * 없다 — 없다고 말한다.
 *
 * 차단은 차단이 커밋된 뒤의 새 요청과 아직 실행권을 받지 않은 대기 요청을 막는다. **이미 실행 중인 작업을 취소하지 않는다** —
 * 화면이 그렇게 약속하지 않는다.
 */

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Badge, Button, Dialog, Panel } from '@conductor-by-89soone/react';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { PolicyHistoryTable, ReasonField, usePolicyStatus, usePolicySubmit } from './GhPolicyShared';
import { formatTimestamp } from '../lib/format';
import { GATE_TEXT, capabilityChangeBody, gateText, reasonProblem } from '../lib/gh-policy';

interface Pending {
  readonly capabilityId: string;
  readonly action: 'block' | 'resume';
}

export function GhPolicyView({ canChange }: { readonly canChange: boolean }): ReactNode {
  const { load, reload } = usePolicyStatus();
  const { submitting, begin, submit } = usePolicySubmit();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [lost, setLost] = useState(false);
  const [message, setMessage] = useState<{ readonly tone: 'status' | 'warning' | 'danger'; readonly text: string; readonly correlationId: string | null } | null>(null);

  if (load.kind === 'loading') return <p data-testid="gh-policy-loading">실행 정책을 읽는 중…</p>;
  if (load.kind === 'unavailable') {
    return (
      <div data-testid="gh-policy" data-state="unavailable">
        <EmptyState cause="not_found" title="이 배포에서는 GitHub 작업이 열리지 않았습니다" description="GH_OPERATIONS_ENABLED가 꺼져 있으면 실행 정책도 없습니다. 검색과 조사 화면은 그대로 쓸 수 있습니다." />
      </div>
    );
  }
  if (load.kind === 'forbidden' || load.kind === 'unauthenticated') {
    return (
      <div data-testid="gh-policy" data-state="forbidden">
        <EmptyState cause="no_permission" title="이 화면은 운영자(operator) 또는 보안 담당자(security_officer) 역할이 필요합니다" description="필요한 역할을 그대로 적습니다. 변경은 운영자만 할 수 있습니다." />
      </div>
    );
  }
  if (load.kind === 'failed') {
    return (
      <div data-testid="gh-policy" data-state="failed">
        <ErrorBanner
          tone="danger"
          title="실행 정책을 읽지 못했습니다"
          impact={load.message}
          correlationId={load.correlationId}
          action={
            <Button variant="secondary" onClick={reload} data-testid="gh-policy-retry">
              다시 읽기
            </Button>
          }
        />
      </div>
    );
  }

  const status = load.body;
  const open = (next: Pending): void => {
    begin();
    setReason('');
    setLost(false);
    setMessage(null);
    setPending(next);
  };

  const confirm = async (): Promise<void> => {
    if (pending === null || reasonProblem(reason) !== null) return;
    const outcome = await submit(capabilityChangeBody(status, pending.capabilityId, pending.action, reason));
    if (outcome.kind === 'lost') {
      setLost(true);
      return;
    }
    const verb = pending.action === 'block' ? '차단했습니다' : '재개했습니다';
    setPending(null);
    setLost(false);
    if (outcome.kind === 'done') {
      setMessage({ tone: 'status', text: `gh ${pending.capabilityId.split('.').join(' ')} 실행을 ${verb} (revision ${String(outcome.revision)})${outcome.outcome === 'replayed' ? ' — 이미 적용된 요청이었습니다' : ''}`, correlationId: null });
    } else {
      setMessage({ tone: outcome.error.stale ? 'warning' : 'danger', text: outcome.error.message, correlationId: outcome.error.correlationId });
    }
    reload();
  };

  return (
    <div data-testid="gh-policy" data-state="ready">
      <p data-testid="gh-policy-scope">
        배포 범위 <code>{status.scope}</code> · 정책 revision {status.policy.revision} · 마지막 변경 {status.policy.updated_by ?? '—'} ({formatTimestamp(status.policy.updated_at)})
      </p>
      <p data-testid="gh-policy-limits">
        이 화면은 실행 정책(A-005)의 최소 부분입니다 — 실행이 열린 명령의 차단·재개만 있습니다. 위험도 재정의·승인 정책 편집·엔드포인트·확장 허용 목록은
        아직 없습니다. 정책은 실행이 열린 명령을 줄일 수만 있고 늘릴 수 없습니다.
      </p>
      {status.policy.approval === null || !status.policy.approval.matches_served ? (
        <p role="status" data-testid="gh-policy-approval-needed">
          현재 배포 정의가 운영 승인되지 않아 차단 여부와 관계없이 새 실행은 거절됩니다. <Link href="/ops/gh-registry">gh 레지스트리(A-006)</Link>에서 운영
          승인을 확인하세요.
        </p>
      ) : null}
      {message === null ? null : message.tone === 'status' ? (
        <p role="status" data-testid="gh-policy-applied">
          {message.text}
        </p>
      ) : (
        <ErrorBanner
          tone={message.tone}
          title="실행 정책을 바꾸지 못했습니다"
          impact={message.text}
          correlationId={message.correlationId}
          action={
            <Button variant="secondary" onClick={() => setMessage(null)} data-testid="gh-policy-message-close">
              닫기
            </Button>
          }
        />
      )}

      {status.capabilities.map((capability) => {
        const userText = gateText(capability.gate);
        return (
          <Panel as="section" key={capability.id} aria-labelledby={`gh-policy-${capability.id}`} data-testid="gh-policy-capability" data-capability={capability.id} data-blocked={capability.blocked ? 'true' : 'false'}>
            <h2 id={`gh-policy-${capability.id}`}>
              <code>gh {capability.id.split('.').join(' ')}</code>{' '}
              <Badge tone={capability.blocked ? 'danger' : 'success'} data-testid="gh-policy-capability-state">
                {capability.blocked ? '차단' : '허용'}
              </Badge>
            </h2>
            <p data-testid="gh-policy-user-view">
              지금 사용자에게 보이는 상태: {userText === null ? '실행 가능' : userText.title}
            </p>
            {canChange ? (
              <Button
                variant={capability.blocked ? 'primary' : 'secondary'}
                tone={capability.blocked ? 'neutral' : 'danger'}
                onClick={() => open({ capabilityId: capability.id, action: capability.blocked ? 'resume' : 'block' })}
                data-testid={capability.blocked ? 'gh-policy-resume-open' : 'gh-policy-block-open'}
              >
                {capability.blocked ? '실행 재개' : '실행 차단'}
              </Button>
            ) : (
              <p data-testid="gh-policy-readonly">차단과 재개는 운영자(operator)만 할 수 있습니다.</p>
            )}
          </Panel>
        );
      })}

      <Panel as="section" aria-labelledby="gh-policy-history-heading">
        <h2 id="gh-policy-history-heading">변경 이력</h2>
        <PolicyHistoryTable revisions={status.revisions} testId="gh-policy-history" />
      </Panel>

      <Dialog.Root
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next && !submitting) setPending(null);
        }}
      >
        <Dialog.Content size="md" data-testid={pending?.action === 'resume' ? 'gh-policy-resume-dialog' : 'gh-policy-block-dialog'}>
          {pending?.action === 'resume' ? (
            <>
              <Dialog.Title>gh {pending.capabilityId.split('.').join(' ')} 실행을 재개합니다</Dialog.Title>
              <Dialog.Description>
                재개 뒤의 새 요청은 현재 권한과 정책을 다시 확인한 뒤 실행됩니다. 차단 중에 닫힌 요청은 자동으로 다시 실행되지 않습니다.
              </Dialog.Description>
            </>
          ) : (
            <>
              <Dialog.Title>gh {pending?.capabilityId.split('.').join(' ') ?? ''} 실행을 차단합니다</Dialog.Title>
              <Dialog.Description>
                차단 뒤의 새 요청과 아직 실행권을 받지 않은 대기 요청은 실행되지 않습니다. 이미 실행 중인 작업은 취소되지 않습니다 — 필요하면 실행 이력에서
                취소하세요.
              </Dialog.Description>
              <div data-testid="gh-policy-block-user-text">
                <strong>변경 후 사용자에게 보일 사유</strong>
                <p>{GATE_TEXT.policy_blocked.title}</p>
                <p>{GATE_TEXT.policy_blocked.description}</p>
              </div>
            </>
          )}
          <ReasonField id="gh-policy-reason" value={reason} onChange={setReason} />
          {lost ? (
            <p role="alert" data-testid="gh-policy-lost">
              응답을 받지 못했습니다. 다시 보내면 같은 요청으로 결과를 확인하며, 결정이 두 번 적용되지 않습니다.
            </p>
          ) : null}
          <div>
            <Button variant="primary" tone={pending?.action === 'block' ? 'danger' : 'neutral'} disabled={submitting || reasonProblem(reason) !== null} data-testid="gh-policy-submit" onClick={() => void confirm()}>
              {submitting ? '보내는 중…' : lost ? '다시 보내기' : pending?.action === 'block' ? '차단' : '재개'}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={submitting} data-testid="gh-policy-cancel">
                취소
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
