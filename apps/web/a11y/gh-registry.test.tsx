/**
 * A-006 컴포넌트 시험 (WP-078 DoD / QA-GH-32·QA-GH-44, FR-GH-001 AC-6, FR-GH-011 AC-3, CR-088).
 *
 * 순수 판정은 `lib/gh-registry.test.ts`가 걸었다. 여기서 거는 것은 **그 판정이 실제로 그려지는가**와 접근성이다:
 *   - 신원(gh 버전·manifest 해시)·차원별 커버리지·게이트·실행 허용 수가 API 값 그대로 보이는가 (QA-GH-32)
 *   - 기록 없음이 「0개 정상」이 아니라 「없음」으로 보이는가
 *   - 드리프트가 있으면 command·flag diff가 보이는가 (QA-GH-32)
 *   - 403은 no_permission, 404는 unavailable — 접근 권한 부족과 미수집을 가른다
 *   - command를 고르면 상세(flag·positional·근거)가 읽히고, 요약의 마크업이 텍스트로만 그려지는가 (QA-GH-24)
 *   - axe 위반 0건
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhRegistryView } from '../components/GhRegistryView';
import { COMMAND_DETAIL_AUTH_TOKEN, COMMAND_DETAIL_PR_LIST, REGISTRY_STATUS_DRIFT, REGISTRY_STATUS_EMPTY, REGISTRY_STATUS_LEGACY, registryStatus } from '../lib/gh-registry-fixtures';
import { CAPABILITIES } from '../lib/gh-test-fixtures';

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

interface MockOptions {
  readonly registry?: { readonly status: number; readonly body: unknown };
  readonly capabilities?: { readonly status: number; readonly body: unknown };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFetch(options: MockOptions = {}): { readonly calls: string[] } {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (url === '/api/gh/registry') return json(options.registry?.status ?? 200, options.registry?.body ?? registryStatus());
    if (url === '/api/gh/capabilities') return json(options.capabilities?.status ?? 200, options.capabilities?.body ?? CAPABILITIES);
    if (url === '/api/gh/registry/commands/pr.list') return json(200, COMMAND_DETAIL_PR_LIST);
    if (url === '/api/gh/registry/commands/auth.token') return json(200, COMMAND_DETAIL_AUTH_TOKEN);
    return json(404, { error: { code: 'NOT_FOUND', message: '없다' }, correlation_id: 'c-404' });
  });
  return { calls };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function ready(): Promise<HTMLElement> {
  const root = await screen.findByTestId('gh-registry');
  await waitFor(() => {
    expect(root).toHaveAttribute('data-state', 'ready');
  });
  return root;
}

describe('A-006 — 신원·커버리지·게이트·실행 허용', () => {
  it('API가 준 값을 그대로 보이고, 실행 허용은 1개다 (QA-GH-32)', async () => {
    installFetch();
    const { container } = render(<GhRegistryView />);
    await ready();
    expect(screen.getByTestId('gh-registry-gh-version')).toHaveTextContent('2.97.0');
    expect(screen.getByTestId('gh-registry-manifest')).toHaveTextContent('r0.3');
    expect(screen.getByTestId('gh-registry-manifest')).toHaveTextContent('13623d63cb18…');
    expect(screen.getByTestId('gh-registry-manifest')).toHaveTextContent('해시 검증됨');
    expect(screen.getByTestId('gh-registry-execution')).toHaveTextContent('실행이 열린 capability 1개: pr.list');
    expect(screen.getByTestId('gh-registry-execution')).toHaveTextContent('분류된 leaf 196개 / 미분류 0개');

    const dimensions = screen.getByTestId('gh-registry-dimensions');
    const flagRow = within(dimensions).getByText('command 고유 flag 분류율').closest('tr');
    expect(flagRow).toHaveTextContent('1034/1034');
    expect(flagRow).toHaveTextContent('100%');
    const contractRow = within(dimensions).getByText('결과 계약 분류율').closest('tr');
    expect(contractRow).toHaveTextContent('196/196');
    const outputPortRow = within(dimensions).getByText('출력 port 분류율').closest('tr');
    expect(outputPortRow).toHaveTextContent('32/32');
    const flowRow = within(dimensions).getByText('실행 가능한 다단계 흐름 수').closest('tr');
    expect(flowRow).toHaveTextContent('n/a');

    const gates = screen.getByTestId('gh-registry-gates');
    expect(within(gates).getByText(/GATE-GH-01 capability/).closest('li')).toHaveAttribute('data-pass', 'true');
    expect(within(gates).getByText(/GATE-GH-01d/).closest('li')).toHaveAttribute('data-pass', 'true');

    // 결과 계약·연결 요약 (CR-089) — 분모가 다른 수치를 따로 보인다.
    const summary = screen.getByTestId('gh-registry-contract-summary');
    expect(summary.querySelector('[data-item="result_contracts"]')).toHaveTextContent('196/196');
    expect(summary.querySelector('[data-item="output_ports"]')).toHaveTextContent('36');
    expect(summary.querySelector('[data-item="adapters"]')).toHaveTextContent('pr.list:pr_list_v2');
    expect(summary.querySelector('[data-item="executable"]')).toHaveTextContent('pr.list');
    expect(summary.querySelector('[data-item="edges"]')).toHaveTextContent('398');
    expect(summary.querySelector('[data-item="flows"]')).toHaveTextContent('0');
    expect(summary.querySelector('[data-item="host"]')).toHaveTextContent('0');
    expect(screen.getByTestId('gh-registry-composability')).toHaveTextContent('조건부 연결 가능 32');
    expect(screen.getByTestId('gh-registry-gate-scope')).toHaveTextContent('REL-007 완료가 아니다');

    expect(screen.getByTestId('gh-registry-records-executor')).toHaveAttribute('data-status', 'passed');
    expect(screen.getByTestId('gh-registry-verification').querySelector('[data-contract-dimensions]')).toHaveAttribute('data-contract-dimensions', 'verified');
    expect(screen.getByTestId('gh-registry-host')).toHaveTextContent('미확인');
    expect(await violations(container)).toEqual([]);
  });

  it('옛 판 응답은 결과 계약 요약이 「없음」이고, r1 보고서의 검증 기록은 결과 계약 미검증으로 보인다 (CR-089)', async () => {
    installFetch({ registry: { status: 200, body: REGISTRY_STATUS_LEGACY } });
    const { container } = render(<GhRegistryView />);
    await ready();
    expect(screen.getByTestId('gh-registry-contracts-none')).toHaveTextContent('옛 판');
    expect(screen.queryByTestId('gh-registry-contract-summary')).toBeNull();
    const cell = screen.getByTestId('gh-registry-verification').querySelector('[data-contract-dimensions]');
    expect(cell).toHaveAttribute('data-contract-dimensions', 'legacy');
    expect(cell).toHaveTextContent('결과 계약 미검증(옛 판)');
    expect(await violations(container)).toEqual([]);
  });

  it('검증 기록이 없으면 「없음」으로 말한다 — 0개 정상으로 그리지 않는다', async () => {
    installFetch({ registry: { status: 200, body: REGISTRY_STATUS_EMPTY } });
    render(<GhRegistryView />);
    const root = await ready();
    expect(root).toHaveAttribute('data-records', 'no_records');
    expect(screen.getByTestId('gh-registry-records-none')).toHaveTextContent('검증 기록이 없습니다');
    expect(screen.getByTestId('gh-registry-verifications')).toHaveTextContent('기록 없음');
    expect(screen.getByTestId('gh-registry-snapshots')).toHaveTextContent('스냅숏 없음');
    expect(screen.queryByTestId('gh-registry-records-executor')).toBeNull();
  });

  it('드리프트가 확인된 배포는 diff와 거절 안내가 보인다 (QA-GH-32, FR-GH-011 AC-3)', async () => {
    installFetch({ registry: { status: 200, body: REGISTRY_STATUS_DRIFT } });
    render(<GhRegistryView />);
    await ready();
    expect(screen.getByTestId('gh-registry-records-executor')).toHaveAttribute('data-status', 'drift');
    expect(screen.getByTestId('gh-registry-records-executor')).toHaveTextContent('registry_stale로 거절');
    const drift = screen.getByTestId('gh-registry-drift');
    expect(drift).toHaveTextContent('바이너리에만 있음: pr frobnicate');
    expect(drift).toHaveTextContent('flag·JSON 필드가 달라짐: pr list');
    const row = screen.getByTestId('gh-registry-verification');
    expect(row).toHaveAttribute('data-status', 'drift');
    expect(row).toHaveTextContent('불일치');
  });
});

describe('A-006 — 접근·부재·오류를 가른다', () => {
  it('403은 필요한 역할을 적은 no_permission이다', async () => {
    installFetch({ registry: { status: 403, body: { error: { code: 'FORBIDDEN_ROLE', message: "'operator 또는 security_officer' 역할이 필요하다" }, correlation_id: 'c-403' } } });
    const { container } = render(<GhRegistryView />);
    const root = await screen.findByTestId('gh-registry');
    await waitFor(() => {
      expect(root).toHaveAttribute('data-state', 'no_permission');
    });
    expect(root).toHaveTextContent('운영자(operator) 또는 보안 담당자(security_officer)');
    expect(await violations(container)).toEqual([]);
  });

  it('404는 오류가 아니라 「열리지 않았다」다 (DEV-589의 규율)', async () => {
    installFetch({ registry: { status: 404, body: { message: 'Route GET:/api/v1/gh/registry not found', error: 'Not Found', statusCode: 404 } } });
    render(<GhRegistryView />);
    const root = await screen.findByTestId('gh-registry');
    await waitFor(() => {
      expect(root).toHaveAttribute('data-state', 'unavailable');
    });
    expect(root).toHaveTextContent('이 배포에서는 GitHub 작업이 열리지 않았습니다');
  });

  it('500은 상관 ID와 다시 읽기 버튼이 있는 실패다', async () => {
    installFetch({ registry: { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: '터졌다' }, correlation_id: 'c-500' } } });
    render(<GhRegistryView />);
    const root = await screen.findByTestId('gh-registry');
    await waitFor(() => {
      expect(root).toHaveAttribute('data-state', 'failed');
    });
    expect(root).toHaveTextContent('터졌다');
    expect(root).toHaveTextContent('c-500');
    expect(screen.getByRole('button', { name: '다시 읽기' })).toBeInTheDocument();
  });
});

describe('A-006 — command 탐색과 상세', () => {
  it('검색으로 거르고, 고르면 상세가 읽히며, 요약의 마크업은 텍스트로만 그려진다 (QA-GH-24)', async () => {
    const { calls } = installFetch();
    const { container } = render(<GhRegistryView />);
    await ready();
    const list = screen.getByTestId('gh-registry-command-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(CAPABILITIES.commands.length);

    fireEvent.change(screen.getByTestId('gh-registry-search'), { target: { value: 'merge' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('gh pr merge');

    fireEvent.change(screen.getByTestId('gh-registry-search'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('gh-registry-filter-execution'), { target: { value: 'allowed' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('gh-registry-command-pr.list'));
    const detail = await screen.findByTestId('gh-registry-detail-pr.list');
    expect(calls).toContain('/api/gh/registry/commands/pr.list');
    expect(detail).toHaveTextContent('실행 가능');
    expect(detail).toHaveTextContent('웹 폼');
    expect(detail).toHaveTextContent('읽기');
    expect(screen.getByTestId('gh-registry-detail-basis')).toHaveTextContent('List pull requests in a repository');
    // flag 표: --state는 열거값이, --web은 웹 등가가 보인다.
    expect(detail).toHaveTextContent('open | closed | merged | all');
    expect(detail).toHaveTextContent('웹 등가');
    // 요약에 심은 <script>는 텍스트다 — DOM에 script 요소가 없다.
    expect(container.querySelector('script')).toBeNull();
    expect(detail).toHaveTextContent('<script>alert(1)</script>');

    // 결과 계약·port·연결 후보 (CR-089) — 호환과 실행 미개방을 함께 말하고, 실행 버튼이 없다.
    const contract = within(detail).getByTestId('gh-registry-contract');
    expect(contract).toHaveAttribute('data-composability', 'partially_bindable');
    expect(within(contract).getByTestId('gh-registry-contract-resource')).toHaveTextContent('PullRequestRef');
    expect(within(contract).getByTestId('gh-registry-contract-outputs').querySelector('[data-mode="json"]')).toHaveAttribute('data-bindable', 'true');
    expect(within(contract).getByTestId('gh-registry-contract-outputs').querySelector('[data-mode="text"]')).toHaveAttribute('data-bindable', 'false');
    expect(within(contract).getByTestId('gh-registry-output-ports')).toHaveTextContent('pull_requests');
    expect(within(contract).getByTestId('gh-registry-output-ports')).toHaveTextContent('필드 선택: number');
    const edge = within(contract).getByTestId('gh-registry-graph-outgoing').querySelector('[data-edge="pr.list.pull_requests->pr.view.pull_request"]');
    expect(edge).toHaveAttribute('data-executable', 'false');
    expect(edge).toHaveTextContent('조건부 호환');
    expect(edge).toHaveTextContent('원소 하나를 명시적으로 선택');
    expect(edge).toHaveTextContent('실행 미개방');
    expect(within(detail).queryAllByRole('button')).toEqual([]);
    expect(await violations(container)).toEqual([]);
  });

  it('정책 차단 command는 이유와 함께 보이고 정의가 없다', async () => {
    installFetch({ capabilities: { status: 200, body: { ...CAPABILITIES, commands: [...CAPABILITIES.commands, { id: 'auth.token', path: ['auth', 'token'], summary: 'Print the authentication token', section: 'GENERAL COMMANDS', alias_of: null, support: 'policy_blocked', execution: 'policy_blocked', execution_reason: '이 제품이 열지 않기로 정한 command다', risk: 'R3', interaction: 'policy_blocked', side_effect: 'read', host_support: 'unverified' }] } } });
    render(<GhRegistryView />);
    await ready();
    fireEvent.click(screen.getByTestId('gh-registry-command-auth.token'));
    const detail = await screen.findByTestId('gh-registry-detail-auth.token');
    expect(detail).toHaveTextContent('정책 차단');
    expect(detail).toHaveTextContent('열지 않기로 정한');
    expect(detail).toHaveTextContent('secret');
    // 비밀 결과는 연결 후보가 없고 그 이유를 말한다 (CR-089).
    expect(within(detail).getByTestId('gh-registry-contract')).toHaveAttribute('data-composability', 'secret_non_bindable');
    expect(detail).toHaveTextContent('비밀 — 흐르지 않음');
    expect(within(detail).getByTestId('gh-registry-graph-outgoing')).toHaveTextContent('없음');
  });
});
