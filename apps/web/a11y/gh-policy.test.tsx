/**
 * 운영 정책 화면 접근성·상태 (WP-080 / A-005 · A-006 · W-010, QA-GH-47~49, CR-090).
 *
 * jsdom + axe로 본다. 실제 브라우저의 대화상자·제출·충돌 흐름은 `e2e/gh-policy.spec.ts`가 본다 — 이 파일의 증거 범위는
 * 렌더된 상태·역할별 버튼·요청 본문·WCAG 위반 0건이다.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhExecutionGateBanner } from '../components/GhExecutionGateBanner';
import { GhPolicyView } from '../components/GhPolicyView';
import { GhRegistryApprovalPanel } from '../components/GhRegistryApprovalPanel';
import { GATE_ADMIN_ACTION, GATE_BLOCKED, GATE_READY, GATE_REGISTRY, SERVED_REPORT_HASH, policyStatus, type PolicyScenario } from '../lib/gh-policy-fixtures';

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Posted {
  readonly body: Record<string, unknown>;
  readonly key: string | null;
}

function installFetch(options: { scenario?: PolicyScenario; status?: number; afterPost?: PolicyScenario; postStatus?: number; postBody?: unknown } = {}): { readonly posted: Posted[] } {
  const posted: Posted[] = [];
  let scenario = options.scenario ?? 'approval_required';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/gh/policies/changes' && init?.method === 'POST') {
      const headers = new Headers(init.headers);
      posted.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, key: headers.get('idempotency-key') });
      if (options.afterPost !== undefined) scenario = options.afterPost;
      return json(options.postStatus ?? 200, options.postBody ?? { outcome: 'applied', revision: 1 });
    }
    if (url === '/api/gh/policies') return json(options.status ?? 200, options.status === undefined || options.status === 200 ? policyStatus(scenario) : { error: { code: 'FORBIDDEN_ROLE', message: '역할' } });
    return json(404, { error: { code: 'NOT_FOUND', message: '없다' } });
  });
  return { posted };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('A-006 운영 승인 절 (QA-GH-47)', () => {
  it('승인 전 — 현재 정의·근거·자격을 보이고, 운영자는 미리보기에서 대상·게이트·열리는 것·열리지 않는 것·영향을 확인한다', async () => {
    const { posted } = installFetch();
    const { container } = render(<GhRegistryApprovalPanel canChange />);
    const panel = await screen.findByTestId('gh-approval-panel');
    expect(panel).toHaveAttribute('data-state', 'approval_required');
    expect(screen.getByTestId('gh-approval-state')).toHaveTextContent("Operational approval required");
    expect(screen.getByTestId('gh-approval-served')).toHaveTextContent('r0.3');
    expect(screen.getByTestId('gh-approval-approved')).toHaveTextContent("None");
    expect(screen.getByTestId('gh-approval-eligible')).toBeInTheDocument();
    expect(screen.getByTestId('gh-approval-evidence')).toHaveTextContent('#41');
    expect(screen.getByTestId('gh-approval-evidence')).toHaveTextContent("25h 20m");
    expect(screen.getByTestId('gh-approval-host')).toHaveTextContent("unverified");
    expect(screen.getByTestId('gh-approval-scope-note')).toHaveTextContent('REL-007 완료가 아니다');
    expect(await violations(container)).toEqual([]);

    fireEvent.click(screen.getByTestId('gh-approval-open'));
    const dialog = await screen.findByTestId('gh-approval-dialog');
    expect(within(dialog).getByTestId('gh-approval-preview-opens')).toHaveTextContent("gh pr list");
    expect(within(dialog).getByTestId('gh-approval-preview-not-opened')).toHaveTextContent("Disabled gh commands: 195");
    expect(within(dialog).getByTestId('gh-approval-preview-gates')).toHaveTextContent('GATE-GH-01d');
    expect(within(dialog).getByTestId('gh-approval-preview-impact')).toHaveTextContent("Previously queued requests close without inheriting the old policy");
    const submit = within(dialog).getByTestId('gh-approval-submit');
    expect(submit).toBeDisabled();
    expect(await violations(document.body)).toEqual([]);

    fireEvent.change(within(dialog).getByTestId('gh-approval-reason'), { target: { value: 'r0.3 배포 승인' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]?.body).toEqual({ action: 'approve', expected_revision: 0, reason: 'r0.3 배포 승인', snapshot_id: 7, verification_id: 41, report_hash: SERVED_REPORT_HASH });
    expect(posted[0]?.key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(await screen.findByTestId('gh-approval-applied')).toHaveTextContent('revision 1');
  });

  it('자격이 없으면 사유를 보이고 승인 버튼이 꺼진다 — 화면이 서버의 판정을 앞지르지 않는다', async () => {
    installFetch({ scenario: 'ineligible' });
    const { container } = render(<GhRegistryApprovalPanel canChange />);
    const reasons = await screen.findByTestId('gh-approval-reasons');
    expect(within(reasons).getByText(/evidence has expired/)).toBeInTheDocument();
    expect(within(reasons).getByText(/different validators or manifests/)).toBeInTheDocument();
    expect(screen.getByTestId('gh-approval-open')).toBeDisabled();
    expect(await violations(container)).toEqual([]);
  });

  it('조회 전용 역할에게는 승인·철회 버튼이 없고 그 사실을 말한다', async () => {
    installFetch({ scenario: 'approved' });
    render(<GhRegistryApprovalPanel canChange={false} />);
    expect(await screen.findByTestId('gh-approval-readonly')).toHaveTextContent('operator');
    expect(screen.queryByTestId('gh-approval-open')).toBeNull();
    expect(screen.queryByTestId('gh-approval-revoke-open')).toBeNull();
    expect(screen.getByTestId('gh-approval-history-row')).toHaveAttribute('data-action', 'approve');
  });

  it('승인된 정의가 현재 정의와 다르면 재승인이 필요하다고 말한다', async () => {
    installFetch({ scenario: 'other_definition' });
    render(<GhRegistryApprovalPanel canChange />);
    expect(await screen.findByTestId('gh-approval-state')).toHaveTextContent("approval required again");
  });

  it('충돌이면 다시 확인하라고 알리고 새로 읽는다', async () => {
    installFetch({ postStatus: 409, postBody: { error: { code: 'GH_POLICY_CONFLICT', message: 'x', detail: { reason: 'evidence_changed' } }, correlation_id: 'c-409' } });
    render(<GhRegistryApprovalPanel canChange />);
    fireEvent.click(await screen.findByTestId('gh-approval-open'));
    const dialog = await screen.findByTestId('gh-approval-dialog');
    fireEvent.change(within(dialog).getByTestId('gh-approval-reason'), { target: { value: '승인' } });
    fireEvent.click(within(dialog).getByTestId('gh-approval-submit'));
    expect(await screen.findByText(/The policy or evidence changed after your review/)).toBeInTheDocument();
  });

  it('403·404에서는 그리지 않는다 — 같은 페이지의 레지스트리 화면이 그 상태를 말한다', async () => {
    installFetch({ status: 403 });
    const { container } = render(<GhRegistryApprovalPanel canChange />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="gh-approval-loading"]')).toBeNull();
    });
    expect(container.textContent).toBe('');
  });
});

describe('A-005 실행 정책 — 최소 (QA-GH-48)', () => {
  it('허용 상태·사용자에게 보이는 상태·마지막 변경을 보이고, 차단 확인에서 사용자에게 보일 사유를 미리 보인다', async () => {
    const { posted } = installFetch({ scenario: 'approved', afterPost: 'blocked', postBody: { outcome: 'applied', revision: 2 } });
    const { container } = render(<GhPolicyView canChange />);
    const card = await screen.findByTestId('gh-policy-capability');
    expect(card).toHaveAttribute('data-blocked', 'false');
    expect(within(card).getByTestId('gh-policy-user-view')).toHaveTextContent("Available");
    expect(screen.getByTestId('gh-policy-scope')).toHaveTextContent('revision 1');
    expect(screen.getByTestId('gh-policy-limits')).toHaveTextContent("cannot enable additional commands");
    expect(await violations(container)).toEqual([]);

    fireEvent.click(within(card).getByTestId('gh-policy-block-open'));
    const dialog = await screen.findByTestId('gh-policy-block-dialog');
    expect(within(dialog).getByTestId('gh-policy-block-user-text')).toHaveTextContent("An administrator blocked this command");
    expect(dialog).toHaveTextContent("Running jobs continue");
    expect(await violations(document.body)).toEqual([]);
    fireEvent.change(within(dialog).getByTestId('gh-policy-reason'), { target: { value: '장애 대응' } });
    fireEvent.click(within(dialog).getByTestId('gh-policy-submit'));
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]?.body).toEqual({ action: 'block', expected_revision: 1, reason: '장애 대응', capability_id: 'pr.list' });
    await waitFor(() => {
      expect(screen.getByTestId('gh-policy-capability')).toHaveAttribute('data-blocked', 'true');
    });
    expect(screen.getByTestId('gh-policy-applied')).toHaveTextContent("blocked");
  });

  it('차단된 상태에서는 재개 확인을 열고, 조회 전용이면 버튼 없이 그 사실을 말한다', async () => {
    installFetch({ scenario: 'blocked' });
    const { unmount } = render(<GhPolicyView canChange />);
    fireEvent.click(await screen.findByTestId('gh-policy-resume-open'));
    expect(await screen.findByTestId('gh-policy-resume-dialog')).toHaveTextContent("will not restart automatically");
    unmount();
    cleanup();
    vi.restoreAllMocks();
    installFetch({ scenario: 'blocked' });
    render(<GhPolicyView canChange={false} />);
    expect(await screen.findByTestId('gh-policy-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('gh-policy-resume-open')).toBeNull();
  });

  it('승인되지 않은 배포에서는 차단 여부와 무관하게 실행이 거절된다고 알리고, 403이면 필요한 역할을 말한다', async () => {
    installFetch({ scenario: 'approval_required' });
    const { unmount } = render(<GhPolicyView canChange />);
    expect(await screen.findByTestId('gh-policy-approval-needed')).toHaveTextContent("lacks operational approval");
    unmount();
    vi.restoreAllMocks();
    installFetch({ status: 403 });
    const { container } = render(<GhPolicyView canChange />);
    expect(await screen.findByTestId('gh-policy')).toHaveAttribute('data-state', 'forbidden');
    expect(await violations(container)).toEqual([]);
  });
});

describe('W-010 실행 판정 배너 (QA-GH-49)', () => {
  it('실행 가능이면 그리지 않고, 운영 승인 필요·관리자 차단·레지스트리 불일치를 서로 다르게 말한다', async () => {
    const { container, rerender } = render(<GhExecutionGateBanner gate={GATE_READY} />);
    expect(container.textContent).toBe('');
    rerender(<GhExecutionGateBanner gate={GATE_ADMIN_ACTION} />);
    expect(screen.getByTestId('gh-execution-gate')).toHaveAttribute('data-gate-state', 'admin_action_required');
    expect(screen.getByTestId('gh-execution-gate')).toHaveTextContent("Operational approval is required");
    expect(await violations(container)).toEqual([]);
    rerender(<GhExecutionGateBanner gate={GATE_BLOCKED} />);
    expect(screen.getByTestId('gh-execution-gate')).toHaveAttribute('data-gate-state', 'policy_blocked');
    rerender(<GhExecutionGateBanner gate={GATE_REGISTRY} />);
    expect(screen.getByTestId('gh-execution-gate')).toHaveAttribute('data-gate-state', 'registry_mismatch');
    expect(container.textContent).not.toMatch(/all features|every feature/);
  });
});
