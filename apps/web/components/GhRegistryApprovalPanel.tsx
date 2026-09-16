'use client';

/**
 * A-006 운영 승인 절 (WP-080 / FR-GH-011 AC-6~AC-8, CR-090).
 *
 * 운영자가 **현재 적재된 배포 정의와 그 실행기 검증 근거**를 보고, 무엇을 승인하는지(대상 정의·근거 기록·보고서 판·게이트·
 * 실제로 열리는 것·아직 열리지 않는 것·영향)를 미리 본 뒤 승인하거나 철회한다. 승인 자격은 서버가 판정해 사유로 준다 —
 * 화면이 다시 판정하지 않는다.
 *
 * - 승인 요청은 미리보기의 revision·스냅숏·기록·보고서 해시를 그대로 되돌려 보낸다. 그 사이 근거가 바뀌었으면 서버가 충돌로
 *   거절하고 화면은 새로 읽는다 — 예전 확인을 그대로 적용하지 않는다.
 * - 403·404는 이 절이 그리지 않는다. 같은 페이지의 레지스트리 화면이 이미 그 상태를 말한다.
 */

import { useState, type ReactNode } from 'react';
import { Badge, Button, Dialog, Panel, Table } from './ui';
import { ErrorBanner } from './ErrorBanner';
import { PolicyHistoryTable, ReasonField, usePolicyStatus, usePolicySubmit } from './GhPolicyShared';
import { formatTimestamp } from '../lib/format';
import { shortHash } from '../lib/gh-registry';
import { approvalBody, approvalReasonText, approvalState, formatDurationMs, notOpenedLines, reasonProblem, revokeBody, type PolicyStatusView } from '../lib/gh-policy';

const STATE_TEXT: Readonly<Record<ReturnType<typeof approvalState>, { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' }>> = {
  approved: { label: "Current definition approved", tone: 'success' },
  approval_required: { label: "Operational approval required", tone: 'warning' },
  approved_other_definition: { label: "Approved definition differs from the current definition — approval required again", tone: 'danger' },
};

type DialogKind = 'approve' | 'revoke' | null;

interface Notice {
  readonly tone: 'warning' | 'danger';
  readonly title: string;
  readonly impact: string;
  readonly correlationId: string | null;
  readonly reasons: readonly string[];
}

export function GhRegistryApprovalPanel({ canChange }: { readonly canChange: boolean }): ReactNode {
  const { load, reload } = usePolicyStatus();
  const { submitting, begin, submit } = usePolicySubmit();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lost, setLost] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  if (load.kind === 'loading') return <p data-testid="gh-approval-loading">Loading approval status…</p>;
  if (load.kind === 'unavailable' || load.kind === 'forbidden' || load.kind === 'unauthenticated') return null;
  if (load.kind === 'failed') {
    return (
      <ErrorBanner
        tone="danger"
        title="Unable to load approval status"
        impact={load.message}
        correlationId={load.correlationId}
        action={
          <Button variant="secondary" onClick={reload} data-testid="gh-approval-retry">
            Reload
          </Button>
        }
      />
    );
  }

  const status = load.body;
  const state = approvalState(status);
  const preview = status.approval_preview;
  const approval = status.policy.approval;

  const open = (kind: Exclude<DialogKind, null>): void => {
    begin();
    setReason('');
    setLost(false);
    setNotice(null);
    setApplied(null);
    setDialog(kind);
  };

  const confirm = async (body: Record<string, unknown> | null, done: string): Promise<void> => {
    if (body === null || reasonProblem(reason) !== null) return;
    const outcome = await submit(body);
    if (outcome.kind === 'lost') {
      // 같은 키로 다시 보내면 서버가 결과를 알려 준다 — 새 결정을 만들지 않는다.
      setLost(true);
      return;
    }
    setDialog(null);
    setLost(false);
    if (outcome.kind === 'done') {
      setApplied(outcome.outcome === 'replayed' ? `${done} — this request was already applied (revision ${String(outcome.revision)})` : `${done} (revision ${String(outcome.revision)})`);
    } else {
      setNotice({ tone: outcome.error.stale ? 'warning' : 'danger', title: "Unable to update operational approval", impact: outcome.error.message, correlationId: outcome.error.correlationId, reasons: outcome.error.reasons });
    }
    reload();
  };

  return (
    <Panel as="section" aria-labelledby="gh-approval-heading" data-testid="gh-approval-panel" data-state={state}>
      <h2 id="gh-approval-heading">Operational approval</h2>
      <p>
        <Badge tone={STATE_TEXT[state].tone} data-testid="gh-approval-state">
          {STATE_TEXT[state].label}
        </Badge>{' '}
        Policy revision {status.policy.revision} · Deployment scope <code>{status.scope}</code>
      </p>
      <p data-testid="gh-approval-scope-note">{preview.scope_note}</p>

      {applied === null ? null : (
        <p role="status" data-testid="gh-approval-applied">
          {applied}
        </p>
      )}
      {notice === null ? null : (
        <ErrorBanner
          tone={notice.tone}
          title={notice.title}
          impact={
            <>
              {notice.impact}
              {notice.reasons.length === 0 ? null : (
                <ul>
                  {notice.reasons.map((code) => (
                    <li key={code}>{approvalReasonText(code)}</li>
                  ))}
                </ul>
              )}
            </>
          }
          correlationId={notice.correlationId}
          action={
            <Button variant="secondary" onClick={() => setNotice(null)} data-testid="gh-approval-notice-close">
              Close
            </Button>
          }
        />
      )}

      <DefinitionTable status={status} />

      <h3>Approval eligibility</h3>
      {preview.eligible ? (
        <p role="status" data-testid="gh-approval-eligible">
          Current evidence satisfies operational approval requirements.
        </p>
      ) : (
        <ul data-testid="gh-approval-reasons">
          {preview.reasons.map((reason) => (
            <li key={`${reason.code}:${reason.detail ?? ''}`} data-reason={reason.code}>
              {approvalReasonText(reason.code)}
            </li>
          ))}
        </ul>
      )}
      <EvidenceSummary status={status} />
      <p data-testid="gh-approval-host">Internal GHES support: unverified. Operational approval does not change this status.</p>

      {canChange ? (
        <div className="prs-gh-actions">
          <Button variant="primary" disabled={!preview.eligible} onClick={() => open('approve')} data-testid="gh-approval-open">
            Preview approval
          </Button>
          {approval === null ? null : (
            <Button variant="secondary" tone="danger" onClick={() => open('revoke')} data-testid="gh-approval-revoke-open">
              Revoke approval
            </Button>
          )}
        </div>
      ) : (
        <p data-testid="gh-approval-readonly">Only operators can approve or revoke approval. This view is read only.</p>
      )}

      <h3>Change history</h3>
      <PolicyHistoryTable revisions={status.revisions} testId="gh-approval-history" />

      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next && !submitting) setDialog(null);
        }}
      >
        <Dialog.Content size="md" data-testid={dialog === 'revoke' ? 'gh-revoke-dialog' : 'gh-approval-dialog'}>
          {dialog === 'revoke' ? (
            <>
              <Dialog.Title>Revoke operational approval</Dialog.Title>
              <Dialog.Description>
                Revoking approval rejects new requests and closes queued requests without execution claims. Running jobs continue and can be canceled from execution history. Previously completed GHE queries are not undone.
              </Dialog.Description>
            </>
          ) : (
            <>
              <Dialog.Title>Approve the current deployment definition</Dialog.Title>
              <Dialog.Description>{preview.scope_note}</Dialog.Description>
              <ApprovalPreview status={status} />
            </>
          )}
          <ReasonField id={dialog === 'revoke' ? 'gh-revoke-reason' : 'gh-approval-reason'} value={reason} onChange={setReason} />
          {lost ? (
            <p role="alert" data-testid="gh-approval-lost">
              No response received. Retry the same request to check its result without applying the decision twice.
            </p>
          ) : null}
          <div>
            <Button
              variant="primary"
              tone={dialog === 'revoke' ? 'danger' : 'neutral'}
              disabled={submitting || reasonProblem(reason) !== null}
              data-testid={dialog === 'revoke' ? 'gh-revoke-submit' : 'gh-approval-submit'}
              onClick={() => {
                void confirm(dialog === 'revoke' ? revokeBody(status, reason) : approvalBody(status, reason), dialog === 'revoke' ? "Operational approval revoked" : "Operational approval granted");
              }}
            >
              {submitting ? "Submitting…" : lost ? "Retry request" : dialog === 'revoke' ? "Revoke" : "Approve"}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={submitting} data-testid="gh-approval-cancel">
                Cancel
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </Panel>
  );
}

function DefinitionTable({ status }: { readonly status: PolicyStatusView }): ReactNode {
  const approval = status.policy.approval;
  return (
    <Table data-testid="gh-approval-definitions" caption="Loaded and approved definitions">
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">gh</th>
          <th scope="col">manifest</th>
          <th scope="col">Snapshot</th>
          <th scope="col">Approve</th>
        </tr>
      </thead>
      <tbody>
        <tr data-testid="gh-approval-served">
          <th scope="row">Currently loaded</th>
          <td>{status.served.gh_version}</td>
          <td>
            {status.served.manifest_version} · <code title={status.served.manifest_hash}>{shortHash(status.served.manifest_hash)}</code>
          </td>
          <td>{status.served.snapshot_id === null ? "None" : `#${String(status.served.snapshot_id)}`}</td>
          <td>—</td>
        </tr>
        <tr data-testid="gh-approval-approved">
          <th scope="row">Operational approval</th>
          {approval === null ? (
            <td colSpan={4}>None</td>
          ) : (
            <>
              <td>{approval.gh_version}</td>
              <td>
                {approval.manifest_version} · <code title={approval.manifest_hash}>{shortHash(approval.manifest_hash)}</code>
              </td>
              <td>#{approval.snapshot_id}</td>
              <td>
                {approval.approved_by} · {formatTimestamp(approval.approved_at)}
              </td>
            </>
          )}
        </tr>
      </tbody>
    </Table>
  );
}

function EvidenceSummary({ status }: { readonly status: PolicyStatusView }): ReactNode {
  const preview = status.approval_preview;
  const evidence = preview.evidence;
  if (evidence === null) {
    return <p data-testid="gh-approval-evidence-none">No runner validation records exist for this deployment scope.</p>;
  }
  return (
    <dl data-testid="gh-approval-evidence" data-status={evidence.status}>
      <dt>Latest runner check</dt>
      <dd>
        #{evidence.verification_id} · {formatTimestamp(evidence.checked_at)} · {evidence.trigger} · {evidence.status}
      </dd>
      <dt>Report version</dt>
      <dd>{preview.report_version ?? '—'}</dd>
      <dt>Evidence expiration</dt>
      <dd>
        {preview.evidence_expires_at === null ? '—' : formatTimestamp(preview.evidence_expires_at)}
        {preview.evidence_max_age_ms === null ? null : `(check interval + worst-case check duration = ${formatDurationMs(preview.evidence_max_age_ms)})`}
      </dd>
    </dl>
  );
}

function ApprovalPreview({ status }: { readonly status: PolicyStatusView }): ReactNode {
  const preview = status.approval_preview;
  return (
    <div data-testid="gh-approval-preview">
      <dl>
        <dt>Target (deployment scope)</dt>
        <dd>
          <code>{status.scope}</code>
        </dd>
        <dt>Definition to approve</dt>
        <dd>
          gh {status.served.gh_version} · manifest {status.served.manifest_version} · <code title={status.served.manifest_hash}>{shortHash(status.served.manifest_hash)}</code> · Snapshot #
          {preview.snapshot_id ?? '—'}
        </dd>
        <dt>Evidence record</dt>
        <dd data-testid="gh-approval-preview-evidence">
          Runner check #{preview.verification_id ?? '—'} · {formatTimestamp(preview.evidence?.checked_at)} · Report {preview.report_version ?? '—'} ·{' '}
          <code title={preview.report_hash ?? undefined}>{shortHash(preview.report_hash)}</code>
        </dd>
      </dl>
      <Table data-testid="gh-approval-preview-gates" caption="Required gate results">
        <thead>
          <tr>
            <th scope="col">Gate</th>
            <th scope="col">Results</th>
          </tr>
        </thead>
        <tbody>
          {preview.required_gates.map((id) => {
            const pass = preview.gates.find((gate) => gate.id === id)?.pass === true;
            return (
              <tr key={id}>
                <td>{id}</td>
                <td>{pass ? "Passed" : "Failed"}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <h3>Capabilities being enabled</h3>
      <ul data-testid="gh-approval-preview-opens">
        {preview.opens.map((id) => (
          <li key={id}>
            <code>gh {id.split('.').join(' ')}</code> one
          </li>
        ))}
      </ul>
      <h3>Capabilities not yet enabled</h3>
      <ul data-testid="gh-approval-preview-not-opened">
        {notOpenedLines(status).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3>Operational impact</h3>
      <p data-testid="gh-approval-preview-impact">
        Approval enables new requests for this definition. Previously queued requests close without inheriting the old policy. Internal GHES support remains unverified and is independent of this approval. Definition changes require renewed approval.
      </p>
    </div>
  );
}
