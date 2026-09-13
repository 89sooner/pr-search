/**
 * W-010·W-021 컴포넌트 시험 (WP-077 DoD / QA-GH-01·02·04·11·12·14·17·18·21·24·25, CR-086).
 *
 * 순수 판정은 `lib/gh.test.ts`가 걸었다. 여기서 거는 것은 **그 판정이 실제로 그려지는가**와
 * 접근성이다:
 *   - 미지원·미구현 command가 사유와 함께 보이고 숨겨지지 않는가 (QA-GH-01)
 *   - 위반이 있으면 실행 버튼이 닫히고 **미리보기 요청이 나가지 않는가** (QA-GH-02)
 *   - 미리보기에 비밀 값이 없고 컨텍스트 여덟 항목이 보이는가 (QA-GH-04·21)
 *   - GitHub 필드에 심은 마크업이 **텍스트로만** 그려지는가 (QA-GH-24)
 *   - 절삭·바이너리가 사실대로 표시되는가 (QA-GH-11·25)
 *   - 상태 변화가 live region에 실리는가 (QA-GH-18)
 *   - 같은 버튼을 두 번 눌러도 실행 요청이 하나인가 (QA-GH-14)
 *   - 배포가 껐으면 404를 「열리지 않았다」로 그리는가 (DEV-589의 규율)
 *   - axe 위반 0건 (QA-GH-17)
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhCapabilityList } from '../components/GhCapabilityList';
import { GhCommandCenterView, PREVIEW_DEBOUNCE_MS } from '../components/GhCommandCenterView';
import { GhExecutionPanel } from '../components/GhExecutionPanel';
import { GhExecutionPreview } from '../components/GhExecutionPreview';
import { GhPrListForm } from '../components/GhPrListForm';
import { defaultFormState, validateForm, type IdentityView } from '../lib/gh';
import { CAPABILITIES, PREVIEW, PR_LIST_VIEW, execution } from '../lib/gh-test-fixtures';

const params = { current: new URLSearchParams() };

vi.mock('next/navigation', () => ({
  usePathname: () => '/gh',
  useSearchParams: () => params.current,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const REPOSITORIES = [
  { repository_id: 4021, repository: 'acme/payments', visibility: 'internal' },
  { repository_id: 4022, repository: 'acme/session', visibility: 'private' },
];

const CONNECTED: IdentityView = { status: 'connected', host: 'ghe.example.com', github_login: 'alice', connected_at: '2026-09-13T04:00:00.000Z', expires_at: '2026-09-13T12:00:00.000Z' };
const NOT_CONNECTED: IdentityView = { status: 'not_connected', host: 'ghe.example.com', github_login: null, connected_at: null, expires_at: null };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  params.current = new URLSearchParams();
});

describe('GhPrListForm (C-061)', () => {
  it('QA-GH-17: 컨트롤마다 레이블이 연결돼 있고 정의의 값으로 만들어진다', () => {
    const form = defaultFormState(PR_LIST_VIEW, 'acme/payments');
    render(<GhPrListForm capability={PR_LIST_VIEW} repositories={REPOSITORIES} form={form} violations={[]} onChange={vi.fn()} />);

    expect(screen.getByLabelText('저장소')).toBeTruthy();
    const state = screen.getByLabelText('PR 상태') as HTMLSelectElement;
    expect(Array.from(state.options).map((option) => option.value)).toEqual(['open', 'closed', 'merged', 'all']);
    const limit = screen.getByLabelText('조회 건수') as HTMLInputElement;
    expect(limit.min).toBe('1');
    expect(limit.max).toBe('100');
    // JSON 필드는 허용 목록의 체크박스다 — 자유 입력이 아니다.
    expect(within(screen.getByTestId('gh-json-fields')).getAllByRole('checkbox')).toHaveLength(PR_LIST_VIEW.options.find((o) => o.kind === 'json_fields')?.kind === 'json_fields' ? 10 : 0);
  });

  it('QA-GH-02: 위반은 그 컨트롤 옆에 alert로 보인다', () => {
    const form = { ...defaultFormState(PR_LIST_VIEW, 'acme/payments'), limit: '0' };
    render(<GhPrListForm capability={PR_LIST_VIEW} repositories={REPOSITORIES} form={form} violations={validateForm(PR_LIST_VIEW, form)} onChange={vi.fn()} />);
    expect(screen.getByTestId('gh-violation-limit').getAttribute('role')).toBe('alert');
    expect(screen.queryByTestId('gh-violation-state')).toBeNull();
  });

  it('변경은 그대로 넘긴다 — 폼이 값을 고치지 않는다', () => {
    const onChange = vi.fn();
    const form = defaultFormState(PR_LIST_VIEW, 'acme/payments');
    render(<GhPrListForm capability={PR_LIST_VIEW} repositories={REPOSITORIES} form={form} violations={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('gh-limit'), { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith({ ...form, limit: '0' });
  });

  it('axe 위반 0건', async () => {
    const form = { ...defaultFormState(PR_LIST_VIEW, 'acme/payments'), limit: '0' };
    const { container } = render(<GhPrListForm capability={PR_LIST_VIEW} repositories={REPOSITORIES} form={form} violations={validateForm(PR_LIST_VIEW, form)} onChange={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe('GhCapabilityList (W-010 목록)', () => {
  it('QA-GH-01: 실행이 열리지 않은 command도 사유와 함께 보인다 — 숨기지 않는다', () => {
    render(<GhCapabilityList capabilities={CAPABILITIES} selectedId="pr.list" onSelect={vi.fn()} />);
    const others = screen.getByTestId('gh-capability-others');
    expect(others.textContent).toContain('gh pr merge');
    expect(others.textContent).toContain('이 판이 열지 않은 capability');
    expect(others.textContent).toContain('정책 차단');
    expect(others.textContent).toContain('실행기에 작업 트리가 없다');
    // 분류하지 않은 것을 분류했다고 적지 않는다.
    expect(screen.getByTestId('gh-capability-coverage').textContent).toContain('분류되지 않음 195개');
  });

  it('실행 가능한 것만 버튼이고 선택 상태가 aria-pressed로 드러난다', () => {
    const onSelect = vi.fn();
    render(<GhCapabilityList capabilities={CAPABILITIES} selectedId="pr.list" onSelect={onSelect} />);
    const button = screen.getByTestId('gh-capability-pr.list');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByTestId('gh-capability-others')).queryAllByRole('button')).toHaveLength(0);
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<GhCapabilityList capabilities={CAPABILITIES} selectedId="pr.list" onSelect={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe('GhExecutionPreview (C-062)', () => {
  it('QA-GH-21: 호스트·저장소·신원·gh 버전·manifest·권한·권한 판정·정책이 보인다', () => {
    render(<GhExecutionPreview preview={PREVIEW} loading={false} />);
    const context = screen.getByTestId('gh-effective-context').textContent ?? '';
    for (const fragment of ['ghe.example.com', 'acme/payments', '@alice', '2.97.0', 'r0.1', 'ad00027d84b9', 'pull_requests:read', 'delegated_token_intersection', '30초']) {
      expect(context, fragment).toContain(fragment);
    }
  });

  it('QA-GH-04: 비밀 값은 서버가 가린 표기 그대로이고 원문은 없다', () => {
    render(<GhExecutionPreview preview={PREVIEW} loading={false} />);
    const env = screen.getByTestId('gh-preview-env').textContent ?? '';
    expect(env).toContain('GH_ENTERPRISE_TOKEN=<redacted>');
    expect(env).not.toMatch(/ghu_[A-Za-z0-9]+/);
    expect(screen.getByTestId('gh-preview-argv').textContent).toBe(`gh ${PREVIEW.argv.join(' ')}`);
  });

  it('서버가 실행 불가라 하면 그 사유가 status로 보인다', () => {
    render(<GhExecutionPreview preview={{ ...PREVIEW, executable: false, blockers: ['identity_not_connected'] }} loading={false} />);
    expect(screen.getByTestId('gh-preview-blockers').textContent).toContain('identity_not_connected');
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<GhExecutionPreview preview={PREVIEW} loading={false} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe('GhExecutionPanel (C-058)', () => {
  it('QA-GH-24: GitHub 필드의 마크업은 텍스트로만 그려진다', () => {
    const { container } = render(<GhExecutionPanel execution={execution()} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    const titles = screen.getAllByTestId('gh-result-title').map((cell) => cell.textContent);
    expect(titles[0]).toContain('<script>alert(1)</script>');
    expect(titles[0]).toContain('<img src=x onerror=alert(2)>');
  });

  it('URL은 http(s)만 링크가 된다 — 없는 행은 번호만', () => {
    render(<GhExecutionPanel execution={execution()} />);
    const rows = screen.getAllByTestId('gh-result-row');
    expect(within(rows[0] as HTMLElement).getByRole('link').getAttribute('href')).toBe('https://ghe.example.com/acme/payments/pull/12');
    expect(within(rows[1] as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('QA-GH-11: 절삭된 출력은 불완전한 목록임을 alert로 말한다', () => {
    render(<GhExecutionPanel execution={execution({ stdout: { text: '[…', truncated: true } })} />);
    expect(screen.getByTestId('gh-result-truncated').getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('gh-result-truncated').textContent).toContain('불완전한 목록');
  });

  it('QA-GH-25: 바이너리 출력은 텍스트로 그리지 않는다', () => {
    render(<GhExecutionPanel execution={execution({ output_binary: true, stdout: { text: 'garbage', truncated: false } })} />);
    expect(screen.getByTestId('gh-result-binary')).toBeTruthy();
    expect(screen.queryByTestId('gh-result-table')).toBeNull();
    expect(screen.queryByTestId('gh-stdout-text')).toBeNull();
    expect(screen.getByTestId('gh-stdout-binary')).toBeTruthy();
  });

  it('0건과 실패를 가른다', () => {
    render(<GhExecutionPanel execution={execution({ result: { schema: 'pr_list_v1', rows: [], row_count: 0, possibly_more: false, stdout_truncated: false } })} />);
    expect(screen.getByTestId('gh-result-empty')).toBeTruthy();
    cleanup();
    render(<GhExecutionPanel execution={execution({ state: 'failed', error: 'gh_exit_1', result: null })} />);
    expect(screen.getByTestId('gh-result-failed').textContent).toContain('종료 코드 1');
  });

  it('QA-GH-18: 상태는 live region에 실리고, 끝나지 않은 실행만 취소할 수 있다', () => {
    const onCancel = vi.fn();
    render(<GhExecutionPanel execution={execution({ state: 'running', finished_at: null, result: null, stdout: null })} onCancel={onCancel} />);
    const status = screen.getByTestId('gh-execution-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('실행 중');
    fireEvent.click(screen.getByTestId('gh-cancel'));
    expect(onCancel).toHaveBeenCalledWith(7);
    cleanup();
    render(<GhExecutionPanel execution={execution()} onCancel={onCancel} />);
    expect(screen.queryByTestId('gh-cancel')).toBeNull();
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<GhExecutionPanel execution={execution()} onCancel={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});

/** `fetch` 대역. 경로별 응답을 정하고 호출을 기록한다. */
interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function stubFetch(options: { identity?: IdentityView; unavailable?: boolean; executionAfter?: 'succeeded' | 'running' } = {}): Call[] {
  const calls: Call[] = [];
  let created = 0;
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, headers, body });

    const json = (status: number, payload: unknown): Promise<Response> =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(payload) } as Response);

    if (options.unavailable === true) return json(404, { message: 'Route not found', error: 'Not Found', statusCode: 404 });
    if (url === '/api/gh/identity') return json(200, options.identity ?? CONNECTED);
    if (url === '/api/gh/capabilities') return json(200, CAPABILITIES);
    if (url === '/api/gh/contexts/repositories') return json(200, { items: REPOSITORIES, host: 'ghe.example.com' });
    if (url === '/api/gh/executions/preview') return json(200, PREVIEW);
    if (url === '/api/gh/executions' && method === 'POST') {
      created += 1;
      return json(202, execution({ execution_id: 100 + created, state: 'queued', finished_at: null, started_at: null, result: null, stdout: null, stderr: null }));
    }
    if (/^\/api\/gh\/executions\/\d+$/.test(url)) {
      const id = Number(url.split('/').pop());
      return json(200, options.executionAfter === 'running' ? execution({ execution_id: id, state: 'running', finished_at: null, result: null, stdout: null }) : execution({ execution_id: id }));
    }
    return json(404, null);
  });
  return calls;
}

async function settleDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, PREVIEW_DEBOUNCE_MS + 150));
}

describe('GhCommandCenterView (W-010)', () => {
  it('DEV-589: 배포가 기능을 껐으면(404) 「열리지 않았다」로 그린다 — 오류가 아니다', async () => {
    stubFetch({ unavailable: true });
    render(<GhCommandCenterView />);
    await waitFor(() => {
      expect(screen.getByTestId('gh-command-center').getAttribute('data-state')).toBe('unavailable');
    });
    expect(screen.getByText('이 배포에서는 GitHub 작업이 열리지 않았습니다')).toBeTruthy();
  });

  it('QA-GH-12: 연결이 없으면 연결 안내가 나오고 실행 버튼은 닫혀 있다', async () => {
    stubFetch({ identity: NOT_CONNECTED });
    render(<GhCommandCenterView />);
    await waitFor(() => {
      expect(screen.getByTestId('gh-identity').getAttribute('data-status')).toBe('not_connected');
    });
    expect(screen.getByTestId('gh-identity-connect')).toBeTruthy();
    expect(screen.getByTestId('gh-identity-hint').textContent).toContain('Operations App');
    expect((screen.getByTestId('gh-execute') as HTMLButtonElement).disabled).toBe(true);
  });

  it('QA-GH-02: 위반이 있으면 실행 버튼이 닫히고 미리보기 요청이 **나가지 않는다**', async () => {
    const calls = stubFetch();
    render(<GhCommandCenterView />);
    await waitFor(() => {
      expect(screen.getByTestId('gh-pr-list-form')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('gh-repository'), { target: { value: 'acme/payments' } });
    fireEvent.change(screen.getByTestId('gh-limit'), { target: { value: '0' } });
    await settleDebounce();
    expect(screen.getByTestId('gh-violation-limit')).toBeTruthy();
    expect((screen.getByTestId('gh-execute') as HTMLButtonElement).disabled).toBe(true);
    expect(calls.filter((call) => call.url === '/api/gh/executions/preview')).toHaveLength(0);
  });

  it('유효한 폼 → 미리보기 argv → 실행 → 결과 표 (FR-GH-002 AC-3·AC-4·AC-10)', async () => {
    const calls = stubFetch();
    render(<GhCommandCenterView />);
    await waitFor(() => {
      expect(screen.getByTestId('gh-pr-list-form')).toBeTruthy();
    });
    // 저장소를 고르기 전에는 미리보기를 요청하지 않는다.
    await settleDebounce();
    expect(calls.filter((call) => call.url === '/api/gh/executions/preview')).toHaveLength(0);

    fireEvent.change(screen.getByTestId('gh-repository'), { target: { value: 'acme/payments' } });
    await waitFor(() => {
      expect(screen.getByTestId('gh-preview').getAttribute('data-ready')).toBe('true');
    });
    const previewCall = calls.find((call) => call.url === '/api/gh/executions/preview');
    expect(previewCall?.body).toEqual({ capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'open', '--limit': '30' }, output: { json_fields: PR_LIST_VIEW.options.find((o) => o.kind === 'json_fields')?.kind === 'json_fields' ? [...(PR_LIST_VIEW.options.find((o) => o.kind === 'json_fields') as { defaultValue: readonly string[] }).defaultValue] : [] } });
    expect(screen.getByTestId('gh-preview-argv').textContent).toContain('gh pr list --repo ghe.example.com/acme/payments');

    const execute = screen.getByTestId('gh-execute') as HTMLButtonElement;
    await waitFor(() => {
      expect(execute.disabled).toBe(false);
    });
    fireEvent.click(execute);
    await waitFor(() => {
      expect(screen.getByTestId('gh-execution-panel')).toBeTruthy();
    });
    const post = calls.find((call) => call.url === '/api/gh/executions' && call.method === 'POST');
    expect(post?.headers['idempotency-key']).toMatch(/^web-[0-9a-f]{32}$/);
    // 실행 본문은 미리보기 본문과 같다 — 같은 invocation이 두 곳으로 간다 (QA-GH-05의 화면 쪽 절반).
    expect(post?.body).toEqual(previewCall?.body);

    // jsdom에는 EventSource가 없다 → 폴링 대체 경로로 결과가 닿는다.
    await waitFor(
      () => {
        expect(screen.getByTestId('gh-execution-panel').getAttribute('data-state')).toBe('succeeded');
      },
      { timeout: 4_000 },
    );
    expect(screen.getAllByTestId('gh-result-row')).toHaveLength(2);
  }, 10_000);

  it('QA-GH-14: 같은 버튼을 두 번 눌러도 실행 요청은 하나다', async () => {
    const calls = stubFetch({ executionAfter: 'running' });
    render(<GhCommandCenterView />);
    await waitFor(() => {
      expect(screen.getByTestId('gh-pr-list-form')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('gh-repository'), { target: { value: 'acme/payments' } });
    const execute = screen.getByTestId('gh-execute') as HTMLButtonElement;
    await waitFor(() => {
      expect(execute.disabled).toBe(false);
    });
    fireEvent.click(execute);
    fireEvent.click(execute);
    await waitFor(() => {
      expect(screen.getByTestId('gh-execution-panel')).toBeTruthy();
    });
    const posts = calls.filter((call) => call.url === '/api/gh/executions' && call.method === 'POST');
    expect(posts).toHaveLength(1);
  });

  it('axe 위반 0건 (준비된 화면)', async () => {
    stubFetch();
    const { container } = render(<GhCommandCenterView />);
    await waitFor(() => {
      expect(screen.getByTestId('gh-pr-list-form')).toBeTruthy();
    });
    expect(await violations(container)).toEqual([]);
  });
});
