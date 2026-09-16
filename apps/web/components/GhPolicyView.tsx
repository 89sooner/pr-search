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
import { Badge, Button, Dialog, Panel } from './ui';
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

  if (load.kind === 'loading') return <p data-testid="gh-policy-loading">Loading execution policy…</p>;
  if (load.kind === 'unavailable') {
    return (
      <div data-testid="gh-policy" data-state="unavailable">
        <EmptyState cause="not_found" title="GitHub operations are not enabled in this deployment" description="Execution policy is unavailable while GH_OPERATIONS_ENABLED is disabled. Search and investigation remain available." />
      </div>
    );
  }
  if (load.kind === 'forbidden' || load.kind === 'unauthenticated') {
    return (
      <div data-testid="gh-policy" data-state="forbidden">
        <EmptyState cause="no_permission" title="The operator or security_officer role is required" description="Only operator and security_officer can view this page. Only operators can make changes." />
      </div>
    );
  }
  if (load.kind === 'failed') {
    return (
      <div data-testid="gh-policy" data-state="failed">
        <ErrorBanner
          tone="danger"
          title="Unable to load execution policy"
          impact={load.message}
          correlationId={load.correlationId}
          action={
            <Button variant="secondary" onClick={reload} data-testid="gh-policy-retry">
              Reload
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
    const verb = pending.action === 'block' ? "blocked" : "resumed";
    setPending(null);
    setLost(false);
    if (outcome.kind === 'done') {
      setMessage({ tone: 'status', text: `gh ${pending.capabilityId.split('.').join(' ')} Execution ${verb} (revision ${String(outcome.revision)})${outcome.outcome === 'replayed' ? "— this request was already applied" : ''}`, correlationId: null });
    } else {
      setMessage({ tone: outcome.error.stale ? 'warning' : 'danger', text: outcome.error.message, correlationId: outcome.error.correlationId });
    }
    reload();
  };

  return (
    <div data-testid="gh-policy" data-state="ready">
      <p data-testid="gh-policy-scope">
        Deployment scope <code>{status.scope}</code> · Policy revision {status.policy.revision} · Last change {status.policy.updated_by ?? '—'} ({formatTimestamp(status.policy.updated_at)})
      </p>
      <p data-testid="gh-policy-limits">
        Execution policy (A-005) currently supports blocking and resuming enabled commands. Risk overrides, approval policy editing, endpoints, and extension allowlists are not available. Policy can restrict enabled commands but cannot enable additional commands.
      </p>
      {status.policy.approval === null || !status.policy.approval.matches_served ? (
        <p role="status" data-testid="gh-policy-approval-needed">
          The current deployment definition lacks operational approval, so new executions are rejected regardless of blocking policy. <Link href="/ops/gh-registry">gh registry (A-006)</Link> to review operational approval.
        </p>
      ) : null}
      {message === null ? null : message.tone === 'status' ? (
        <p role="status" data-testid="gh-policy-applied">
          {message.text}
        </p>
      ) : (
        <ErrorBanner
          tone={message.tone}
          title="Unable to update execution policy"
          impact={message.text}
          correlationId={message.correlationId}
          action={
            <Button variant="secondary" onClick={() => setMessage(null)} data-testid="gh-policy-message-close">
              Close
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
                {capability.blocked ? "Blocked" : "Allowed"}
              </Badge>
            </h2>
            <p data-testid="gh-policy-user-view">
              Current user-visible status: {userText === null ? "Available" : userText.title}
            </p>
            {canChange ? (
              <Button
                variant={capability.blocked ? 'primary' : 'secondary'}
                tone={capability.blocked ? 'neutral' : 'danger'}
                onClick={() => open({ capabilityId: capability.id, action: capability.blocked ? 'resume' : 'block' })}
                data-testid={capability.blocked ? 'gh-policy-resume-open' : 'gh-policy-block-open'}
              >
                {capability.blocked ? "Resume execution" : "Block execution"}
              </Button>
            ) : (
              <p data-testid="gh-policy-readonly">Only operators can block or resume execution.</p>
            )}
          </Panel>
        );
      })}

      <Panel as="section" aria-labelledby="gh-policy-history-heading">
        <h2 id="gh-policy-history-heading">Change history</h2>
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
              <Dialog.Title>gh {pending.capabilityId.split('.').join(' ')} Resume execution</Dialog.Title>
              <Dialog.Description>
                New requests will be checked against current permissions and policy before running. Requests closed while blocked will not restart automatically.
              </Dialog.Description>
            </>
          ) : (
            <>
              <Dialog.Title>gh {pending?.capabilityId.split('.').join(' ') ?? ''} Block execution</Dialog.Title>
              <Dialog.Description>
                New requests and queued requests without execution claims will not run. Running jobs continue; cancel them from execution history if needed.
              </Dialog.Description>
              <div data-testid="gh-policy-block-user-text">
                <strong>Reason shown to users after this change</strong>
                <p>{GATE_TEXT.policy_blocked.title}</p>
                <p>{GATE_TEXT.policy_blocked.description}</p>
              </div>
            </>
          )}
          <ReasonField id="gh-policy-reason" value={reason} onChange={setReason} />
          {lost ? (
            <p role="alert" data-testid="gh-policy-lost">
              No response received. Retry the same request to check its result without applying the decision twice.
            </p>
          ) : null}
          <div>
            <Button variant="primary" tone={pending?.action === 'block' ? 'danger' : 'neutral'} disabled={submitting || reasonProblem(reason) !== null} data-testid="gh-policy-submit" onClick={() => void confirm()}>
              {submitting ? "Submitting…" : lost ? "Retry request" : pending?.action === 'block' ? "Blocked" : "Resume"}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={submitting} data-testid="gh-policy-cancel">
                Cancel
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
