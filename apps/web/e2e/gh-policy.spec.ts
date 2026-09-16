import { expect, test, type Page, type Route } from '@playwright/test';
import { GATE_ADMIN_ACTION, GATE_BLOCKED, GATE_READY, SERVED_REPORT_HASH, policyStatus, type PolicyScenario } from '../lib/gh-policy-fixtures';
import { registryStatus } from '../lib/gh-registry-fixtures';
import { CAPABILITIES, PREVIEW } from '../lib/gh-test-fixtures';
import type { ExecutionGateView } from '../lib/gh-policy';

/**
 * 운영 정책 화면 — 실제 Chromium (WP-080 / A-005 · A-006 · W-010, QA-GH-47~49, CR-090).
 *
 * search-api 응답은 브라우저 경로에서 목킹한다 — 이 파일의 증거 범위는 **화면이 무엇을 보이고 무엇을 보내는가**다:
 * 승인 미리보기의 내용, 요청 본문의 근거·revision·중복 방지 키, 충돌·권한 거부의 표시, 차단·재개 확인, W-010의 상태 구분과
 * 실행 버튼. 서버의 실제 판정·DB·실행기·gh는 `apps/gh-executor/integration/policy-flow.test.ts`와
 * `apps/search-api/integration/gh/policy-routes.test.ts`가 본다.
 */

interface Posted {
  readonly body: Record<string, unknown>;
  readonly key: string | undefined;
}

interface PolicyMock {
  scenario: PolicyScenario;
  readonly posted: Posted[];
  policyReads: number;
  readonly postStatus?: number;
  readonly postBody?: unknown;
  readonly afterPost?: PolicyScenario;
}

const json = (route: Route, status: number, body: unknown): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installPolicyRoutes(page: Page, mock: PolicyMock): Promise<void> {
  await page.route('**/api/gh/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/gh/policies/changes' && method === 'POST') {
      mock.posted.push({ body: request.postDataJSON() as Record<string, unknown>, key: request.headers()['idempotency-key'] });
      if (mock.afterPost !== undefined) mock.scenario = mock.afterPost;
      return json(route, mock.postStatus ?? 200, mock.postBody ?? { outcome: 'applied', revision: policyStatus(mock.scenario).policy.revision, correlation_id: 'c-change' });
    }
    if (path === '/api/gh/policies') {
      mock.policyReads += 1;
      return json(route, 200, { ...policyStatus(mock.scenario), correlation_id: 'c-policy' });
    }
    if (path === '/api/gh/registry') return json(route, 200, registryStatus());
    if (path === '/api/gh/capabilities') return json(route, 200, CAPABILITIES);
    return json(route, 404, { error: { code: 'NOT_FOUND', message: '없다' }, correlation_id: 'c-404' });
  });
}

const mockOf = (scenario: PolicyScenario, extra: Partial<Omit<PolicyMock, 'scenario' | 'posted' | 'policyReads'>> = {}): PolicyMock => ({ scenario, posted: [], policyReads: 0, ...extra });

test.describe('A-006 운영 승인 (QA-GH-47)', () => {
  test('운영자가 현재 정의와 근거를 미리 본 뒤 승인한다 — 요청은 미리보기의 근거·revision·중복 방지 키를 싣는다', async ({ page }) => {
    const mock = mockOf('approval_required', { afterPost: 'approved' });
    await installPolicyRoutes(page, mock);
    await page.goto('/ops/gh-registry');

    const panel = page.getByTestId('gh-approval-panel');
    await expect(panel).toHaveAttribute('data-state', 'approval_required');
    await expect(page.getByTestId('gh-approval-served')).toContainText('r0.3');
    await expect(page.getByTestId('gh-approval-evidence')).toContainText('#41');
    await expect(page.getByTestId('gh-approval-host')).toContainText("unverified");

    await page.getByTestId('gh-approval-open').click();
    const dialog = page.getByTestId('gh-approval-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('gh-approval-preview-opens')).toContainText("gh pr list");
    await expect(dialog.getByTestId('gh-approval-preview-not-opened')).toContainText("195");
    await expect(dialog.getByTestId('gh-approval-preview-gates')).toContainText('GATE-GH-01d');
    await expect(dialog.getByTestId('gh-approval-preview-impact')).toContainText("Internal GHES support remains unverified and is independent of this approval");
    await expect(dialog.getByTestId('gh-approval-submit')).toBeDisabled();

    await dialog.getByTestId('gh-approval-reason').fill('r0.3 배포 운영 승인');
    await dialog.getByTestId('gh-approval-submit').click();

    await expect(page.getByTestId('gh-approval-applied')).toContainText("Operational approval granted");
    await expect(panel).toHaveAttribute('data-state', 'approved');
    expect(mock.posted).toHaveLength(1);
    expect(mock.posted[0]?.body).toEqual({ action: 'approve', expected_revision: 0, reason: 'r0.3 배포 운영 승인', snapshot_id: 7, verification_id: 41, report_hash: SERVED_REPORT_HASH });
    expect(mock.posted[0]?.key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    await expect(page.getByTestId('gh-approval-history-row')).toHaveAttribute('data-action', 'approve');
  });

  test('확인한 뒤 근거가 바뀌었으면 409 충돌을 알리고 새로 읽는다 — 예전 확인을 그대로 적용하지 않는다', async ({ page }) => {
    const mock = mockOf('approval_required', { postStatus: 409, postBody: { error: { code: 'GH_POLICY_CONFLICT', message: '바뀌었다', detail: { reason: 'evidence_changed' } }, correlation_id: 'c-409' } });
    await installPolicyRoutes(page, mock);
    await page.goto('/ops/gh-registry');
    await page.getByTestId('gh-approval-open').click();
    await page.getByTestId('gh-approval-reason').fill('승인');
    const readsBefore = mock.policyReads;
    await page.getByTestId('gh-approval-submit').click();
    await expect(page.getByText("The policy or evidence changed after your review")).toBeVisible();
    await expect.poll(() => mock.policyReads).toBeGreaterThan(readsBefore);
    await expect(page.getByTestId('gh-approval-panel')).toHaveAttribute('data-state', 'approval_required');
  });

  test('운영자 역할이 없으면 서버의 403을 그대로 알린다 — 버튼을 숨기는 것이 방어가 아니다', async ({ page }) => {
    const mock = mockOf('approved', { postStatus: 403, postBody: { error: { code: 'FORBIDDEN_ROLE', message: "'operator' 역할이 필요하다", detail: { required_role: 'operator' } }, correlation_id: 'c-403' } });
    await installPolicyRoutes(page, mock);
    await page.goto('/ops/gh-registry');
    await page.getByTestId('gh-approval-revoke-open').click();
    await page.getByTestId('gh-revoke-reason').fill('권한 없는 철회 시도');
    await page.getByTestId('gh-revoke-submit').click();
    await expect(page.getByText("The operator role is required to change operational policy.")).toBeVisible();
    await expect(page.getByTestId('gh-approval-panel')).toHaveAttribute('data-state', 'approved');
  });
});

test.describe('A-005 실행 정책 — 최소 (QA-GH-48)', () => {
  test('차단은 사용자에게 보일 사유를 미리 보이고, 재개는 명시적으로만 한다', async ({ page }) => {
    const mock = mockOf('approved', { afterPost: 'blocked' });
    await installPolicyRoutes(page, mock);
    await page.goto('/ops/gh-policy');

    const card = page.getByTestId('gh-policy-capability');
    await expect(card).toHaveAttribute('data-blocked', 'false');
    await expect(card.getByTestId('gh-policy-user-view')).toContainText("Enabled");
    await card.getByTestId('gh-policy-block-open').click();
    const blockDialog = page.getByTestId('gh-policy-block-dialog');
    await expect(blockDialog.getByTestId('gh-policy-block-user-text')).toContainText("An administrator blocked this command");
    await expect(blockDialog).toContainText("Running jobs continue");
    await blockDialog.getByTestId('gh-policy-reason').fill('장애 대응 — 조회 폭주');
    await blockDialog.getByTestId('gh-policy-submit').click();
    await expect(card).toHaveAttribute('data-blocked', 'true');
    await expect(card.getByTestId('gh-policy-user-view')).toContainText("An administrator blocked this command");
    expect(mock.posted[0]?.body).toEqual({ action: 'block', expected_revision: 1, reason: '장애 대응 — 조회 폭주', capability_id: 'pr.list' });

    mock.scenario = 'blocked';
    const resumeMock = mockOf('blocked', { afterPost: 'approved' });
    await page.unroute('**/api/gh/**');
    await installPolicyRoutes(page, resumeMock);
    await page.reload();
    await page.getByTestId('gh-policy-resume-open').click();
    const resumeDialog = page.getByTestId('gh-policy-resume-dialog');
    await expect(resumeDialog).toContainText("will not restart automatically");
    await resumeDialog.getByTestId('gh-policy-reason').fill('장애 해소');
    await resumeDialog.getByTestId('gh-policy-submit').click();
    await expect(page.getByTestId('gh-policy-capability')).toHaveAttribute('data-blocked', 'false');
    expect(resumeMock.posted[0]?.body).toEqual({ action: 'resume', expected_revision: 2, reason: '장애 해소', capability_id: 'pr.list' });
  });
});

const IDENTITY = { status: 'connected', host: 'ghe.example.com', github_login: 'alice', github_user_id: 1, connected_at: '2026-09-14T04:00:00.000Z', expires_at: null, revoked_at: null, scopes: [], correlation_id: 'c-id' };
const REPOSITORIES = { host: 'ghe.example.com', items: [{ repository_id: 4021, repository: 'acme/payments', visibility: 'internal' }], correlation_id: 'c-repo' };

async function installCommandCenter(page: Page, gate: ExecutionGateView): Promise<void> {
  await page.route('**/api/gh/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/gh/identity') return json(route, 200, IDENTITY);
    if (path === '/api/gh/contexts/repositories') return json(route, 200, REPOSITORIES);
    if (path === '/api/gh/capabilities') {
      return json(route, 200, { ...CAPABILITIES, capabilities: CAPABILITIES.capabilities.map((capability) => ({ ...capability, execution_gate: gate })) });
    }
    if (path === '/api/gh/executions/preview') {
      return json(route, 200, { ...PREVIEW, gate, executable: gate.allowed, blockers: gate.allowed || gate.reason === null ? [] : [gate.reason], correlation_id: 'c-preview' });
    }
    return json(route, 404, { error: { code: 'NOT_FOUND', message: '없다' }, correlation_id: 'c-404' });
  });
}

test.describe('W-010 실행 판정 표시 (QA-GH-49)', () => {
  test('운영 승인 필요·관리자 차단은 서로 다른 말로 보이고 실행 버튼이 꺼진다 — 실행 가능이면 배너가 없다', async ({ page }) => {
    for (const [gate, state, text] of [
      [GATE_ADMIN_ACTION, 'admin_action_required', '관리자 운영 승인이 필요합니다'],
      [GATE_BLOCKED, 'policy_blocked', '관리자가 이 명령의 실행을 차단했습니다'],
    ] as const) {
      await page.unroute('**/api/gh/**');
      await installCommandCenter(page, gate);
      await page.goto('/gh');
      // 배너는 입력 전에 뜬다 — capability 목록의 판정이다.
      const banner = page.getByTestId('gh-execution-gate');
      await expect(banner).toHaveAttribute('data-gate-state', state);
      await expect(banner).toContainText(text);
      // 미리보기는 저장소를 고른 뒤에만 요청한다(기존 W-010 계약, `gh.spec.ts`와 같은 절차). 그 사유도 같은 말이다.
      await page.getByTestId('gh-repository').selectOption('acme/payments');
      await expect(page.getByTestId('gh-preview')).toHaveAttribute('data-ready', 'true');
      await expect(page.getByTestId('gh-preview-blockers')).toContainText(text);
      await expect(page.getByTestId('gh-execute')).toBeDisabled();
      await expect(page.locator('body')).not.toContainText("all features");
    }

    await page.unroute('**/api/gh/**');
    await installCommandCenter(page, GATE_READY);
    await page.goto('/gh');
    await expect(page.getByTestId('gh-command-center')).toHaveAttribute('data-state', 'ready');
    await page.getByTestId('gh-repository').selectOption('acme/payments');
    await expect(page.getByTestId('gh-preview')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('gh-preview-blockers')).toHaveCount(0);
    await expect(page.getByTestId('gh-execute')).toBeEnabled();
    await expect(page.getByTestId('gh-execution-gate')).toHaveCount(0);
  });
});
