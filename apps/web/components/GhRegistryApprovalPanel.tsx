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
import { Badge, Button, Dialog, Panel, Table } from '@conductor-by-89soone/react';
import { ErrorBanner } from './ErrorBanner';
import { PolicyHistoryTable, ReasonField, usePolicyStatus, usePolicySubmit } from './GhPolicyShared';
import { formatTimestamp } from '../lib/format';
import { shortHash } from '../lib/gh-registry';
import { approvalBody, approvalReasonText, approvalState, formatDurationMs, notOpenedLines, reasonProblem, revokeBody, type PolicyStatusView } from '../lib/gh-policy';

const STATE_TEXT: Readonly<Record<ReturnType<typeof approvalState>, { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' }>> = {
  approved: { label: '현재 정의 운영 승인됨', tone: 'success' },
  approval_required: { label: '운영 승인 필요', tone: 'warning' },
  approved_other_definition: { label: '승인된 정의가 현재 정의와 다름 — 재승인 필요', tone: 'danger' },
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

  if (load.kind === 'loading') return <p data-testid="gh-approval-loading">운영 승인 상태를 읽는 중…</p>;
  if (load.kind === 'unavailable' || load.kind === 'forbidden' || load.kind === 'unauthenticated') return null;
  if (load.kind === 'failed') {
    return (
      <ErrorBanner
        tone="danger"
        title="운영 승인 상태를 읽지 못했습니다"
        impact={load.message}
        correlationId={load.correlationId}
        action={
          <Button variant="secondary" onClick={reload} data-testid="gh-approval-retry">
            다시 읽기
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
      setApplied(outcome.outcome === 'replayed' ? `${done} — 이미 적용된 요청이었습니다 (revision ${String(outcome.revision)})` : `${done} (revision ${String(outcome.revision)})`);
    } else {
      setNotice({ tone: outcome.error.stale ? 'warning' : 'danger', title: '운영 승인을 바꾸지 못했습니다', impact: outcome.error.message, correlationId: outcome.error.correlationId, reasons: outcome.error.reasons });
    }
    reload();
  };

  return (
    <Panel as="section" aria-labelledby="gh-approval-heading" data-testid="gh-approval-panel" data-state={state}>
      <h2 id="gh-approval-heading">운영 승인</h2>
      <p>
        <Badge tone={STATE_TEXT[state].tone} data-testid="gh-approval-state">
          {STATE_TEXT[state].label}
        </Badge>{' '}
        정책 revision {status.policy.revision} · 배포 범위 <code>{status.scope}</code>
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
              닫기
            </Button>
          }
        />
      )}

      <DefinitionTable status={status} />

      <h3>승인 자격</h3>
      {preview.eligible ? (
        <p role="status" data-testid="gh-approval-eligible">
          현재 근거로 운영 승인할 수 있습니다.
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
      <p data-testid="gh-approval-host">사내 GHES 지원 확인: 미검증 — 운영 승인은 이 사실을 바꾸지 않습니다.</p>

      {canChange ? (
        <div className="prs-gh-actions">
          <Button variant="primary" disabled={!preview.eligible} onClick={() => open('approve')} data-testid="gh-approval-open">
            승인 미리보기
          </Button>
          {approval === null ? null : (
            <Button variant="secondary" tone="danger" onClick={() => open('revoke')} data-testid="gh-approval-revoke-open">
              승인 철회
            </Button>
          )}
        </div>
      ) : (
        <p data-testid="gh-approval-readonly">운영 승인과 철회는 운영자(operator)만 할 수 있습니다. 이 화면은 조회 전용입니다.</p>
      )}

      <h3>변경 이력</h3>
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
              <Dialog.Title>운영 승인을 철회합니다</Dialog.Title>
              <Dialog.Description>
                철회하면 새 요청은 「관리자 운영 승인이 필요합니다」로 거절되고, 아직 실행권을 받지 않은 대기 요청은 실행되지 않고 닫힙니다. 이미 실행 중인
                작업은 끝까지 진행되며 필요하면 실행 이력에서 취소합니다. 철회는 이미 수행한 GHE 조회를 되돌리지 않습니다.
              </Dialog.Description>
            </>
          ) : (
            <>
              <Dialog.Title>현재 배포 정의를 운영 승인합니다</Dialog.Title>
              <Dialog.Description>{preview.scope_note}</Dialog.Description>
              <ApprovalPreview status={status} />
            </>
          )}
          <ReasonField id={dialog === 'revoke' ? 'gh-revoke-reason' : 'gh-approval-reason'} value={reason} onChange={setReason} />
          {lost ? (
            <p role="alert" data-testid="gh-approval-lost">
              응답을 받지 못했습니다. 다시 보내면 같은 요청으로 결과를 확인하며, 결정이 두 번 적용되지 않습니다.
            </p>
          ) : null}
          <div>
            <Button
              variant="primary"
              tone={dialog === 'revoke' ? 'danger' : 'neutral'}
              disabled={submitting || reasonProblem(reason) !== null}
              data-testid={dialog === 'revoke' ? 'gh-revoke-submit' : 'gh-approval-submit'}
              onClick={() => {
                void confirm(dialog === 'revoke' ? revokeBody(status, reason) : approvalBody(status, reason), dialog === 'revoke' ? '운영 승인을 철회했습니다' : '운영 승인했습니다');
              }}
            >
              {submitting ? '보내는 중…' : lost ? '다시 보내기' : dialog === 'revoke' ? '철회' : '승인'}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={submitting} data-testid="gh-approval-cancel">
                취소
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
    <Table data-testid="gh-approval-definitions" caption="현재 적재된 정의와 운영 승인된 정의">
      <thead>
        <tr>
          <th scope="col">구분</th>
          <th scope="col">gh</th>
          <th scope="col">manifest</th>
          <th scope="col">스냅숏</th>
          <th scope="col">승인</th>
        </tr>
      </thead>
      <tbody>
        <tr data-testid="gh-approval-served">
          <th scope="row">현재 적재</th>
          <td>{status.served.gh_version}</td>
          <td>
            {status.served.manifest_version} · <code title={status.served.manifest_hash}>{shortHash(status.served.manifest_hash)}</code>
          </td>
          <td>{status.served.snapshot_id === null ? '없음' : `#${String(status.served.snapshot_id)}`}</td>
          <td>—</td>
        </tr>
        <tr data-testid="gh-approval-approved">
          <th scope="row">운영 승인</th>
          {approval === null ? (
            <td colSpan={4}>없음</td>
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
    return <p data-testid="gh-approval-evidence-none">이 배포 범위의 실행기 검증 기록이 아직 없습니다.</p>;
  }
  return (
    <dl data-testid="gh-approval-evidence" data-status={evidence.status}>
      <dt>최근 실행기 검사</dt>
      <dd>
        #{evidence.verification_id} · {formatTimestamp(evidence.checked_at)} · {evidence.trigger} · {evidence.status}
      </dd>
      <dt>보고서 판</dt>
      <dd>{preview.report_version ?? '—'}</dd>
      <dt>근거 유효 기한</dt>
      <dd>
        {preview.evidence_expires_at === null ? '—' : formatTimestamp(preview.evidence_expires_at)}
        {preview.evidence_max_age_ms === null ? null : ` (검사 주기 + 한 회차 최악 소요 = ${formatDurationMs(preview.evidence_max_age_ms)})`}
      </dd>
    </dl>
  );
}

function ApprovalPreview({ status }: { readonly status: PolicyStatusView }): ReactNode {
  const preview = status.approval_preview;
  return (
    <div data-testid="gh-approval-preview">
      <dl>
        <dt>적용 대상 (배포 범위)</dt>
        <dd>
          <code>{status.scope}</code>
        </dd>
        <dt>승인할 정의</dt>
        <dd>
          gh {status.served.gh_version} · manifest {status.served.manifest_version} · <code title={status.served.manifest_hash}>{shortHash(status.served.manifest_hash)}</code> · 스냅숏 #
          {preview.snapshot_id ?? '—'}
        </dd>
        <dt>근거 기록</dt>
        <dd data-testid="gh-approval-preview-evidence">
          실행기 검사 #{preview.verification_id ?? '—'} · {formatTimestamp(preview.evidence?.checked_at)} · 보고서 {preview.report_version ?? '—'} ·{' '}
          <code title={preview.report_hash ?? undefined}>{shortHash(preview.report_hash)}</code>
        </dd>
      </dl>
      <Table data-testid="gh-approval-preview-gates" caption="필요한 게이트 결과">
        <thead>
          <tr>
            <th scope="col">게이트</th>
            <th scope="col">결과</th>
          </tr>
        </thead>
        <tbody>
          {preview.required_gates.map((id) => {
            const pass = preview.gates.find((gate) => gate.id === id)?.pass === true;
            return (
              <tr key={id}>
                <td>{id}</td>
                <td>{pass ? '통과' : '미달'}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <h3>실제로 열리는 기능</h3>
      <ul data-testid="gh-approval-preview-opens">
        {preview.opens.map((id) => (
          <li key={id}>
            <code>gh {id.split('.').join(' ')}</code> 한 개
          </li>
        ))}
      </ul>
      <h3>아직 허용되지 않는 기능</h3>
      <ul data-testid="gh-approval-preview-not-opened">
        {notOpenedLines(status).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3>운영 영향</h3>
      <p data-testid="gh-approval-preview-impact">
        승인하면 이 정의로 새 요청을 실행할 수 있습니다. 승인 전에 수락된 대기 요청은 이전 정책을 승계하지 않고 닫힙니다. 사내 GHES 지원 확인은 이
        승인과 별개이며 여전히 미검증입니다. 배포 정의가 바뀌면 다시 승인해야 합니다.
      </p>
    </div>
  );
}
