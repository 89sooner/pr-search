'use client';

import { capabilityTitle } from '../lib/gh-presentation';

/**
 * W-010 GitHub Command Center — R0 첫 수직 (WP-077 / FR-GH-001·002·003·006·008·012, CR-086).
 *
 * 흐름은 지시서가 승인한 그대로다: 저장소 선택 → `pr list` → 상태·건수 입력 → argv 미리보기 →
 * 실행 → 결과·자기 이력. R0는 `pr.list` 하나만 연다.
 *
 * ## 판정을 다시 만들지 않는다
 *
 * 폼 위반은 서버와 **같은 함수**(`validateForm` → `evaluateInvocation`)가 판정하고, 미리보기의
 * argv·환경 키·컨텍스트는 서버가 **실행과 같은 준비 단계**로 만든 값을 그대로 그린다. 화면이
 * argv를 조립하거나 규칙을 복제하면 두 판정이 갈리고, 갈라진 쪽이 느슨하면 그것이 우회 경로다
 * (`OpsJobsView`·`AuditView`가 같은 자리에서 같은 판단을 했다).
 *
 * ## 배포가 껐으면 404를 「열리지 않았다」로 그린다 (DEV-589의 규율)
 *
 * `web`은 `GH_OPERATIONS_ENABLED`를 읽지 않는다. 기능이 꺼진 배포에서는 `search-api`가 `/gh/*`를
 * 등록하지 않아 404가 오고, 화면은 그 사실을 「이 배포에서는 GitHub 작업이 열리지 않았다」로
 * 말한다 — 「오류」로 그리면 운영자가 장애를 찾아 나선다.
 *
 * ## 같은 버튼을 두 번 눌러도 실행은 하나다 (FR-GH-012 AC-5, QA-GH-14)
 *
 * 제출마다 `Idempotency-Key` 하나를 쓰고, **실행이 실제로 묶인 뒤에만** 다음 키를 만든다. 다만 **폼이
 * 바뀌면 다음 제출은 다른 실행**이므로 그때도 키를 새로 만든다 — 앞선 제출의 응답을 못 받은 채 폼을
 * 바꿔 다시 누르면, 같은 키로는 서버가 옛 구성의 실행을 돌려준다 (`DEV-667`).
 * 네트워크가 응답 직전에 끊겨도 같은 키로 다시 보내면 서버가 기존 실행 ID를 돌려주므로
 * 화면은 그 실행에 붙는다 — 새 실행을 만들지 않는다.
 *
 * ## 스트리밍은 상태만이다 (API-GH-005, R0)
 *
 * `EventSource`로 `state`·`done` 이벤트를 받고, 붙지 못하면 1초 폴링으로 대체한다. 출력 청크는
 * 흘리지 않는다 — 결과는 종료 뒤 서버가 준 typed 결과와 무해화된 발췌뿐이다.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Panel } from './ui';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { GhCapabilityList } from './GhCapabilityList';
import { GhExecutionGateBanner } from './GhExecutionGateBanner';
import { GhExecutionPanel } from './GhExecutionPanel';
import { GhExecutionPreview } from './GhExecutionPreview';
import { GhIdentityBanner } from './GhIdentityBanner';
import { GhPrListForm } from './GhPrListForm';
import {
  canExecute,
  defaultFormState,
  describeApiError,
  formFromInvocation,
  isTerminal,
  loginPathOf,
  newIdempotencyKey,
  parsePrefill,
  toInvocation,
  validateForm,
  type CapabilitiesResponse,
  type CapabilityView,
  type ExecutionView,
  type IdentityView,
  type PreviewView,
  type PrListFormState,
  type RepositoryContextView,
} from '../lib/gh';

const IDENTITY_URL = '/api/gh/identity';
const CAPABILITIES_URL = '/api/gh/capabilities';
const REPOSITORIES_URL = '/api/gh/contexts/repositories';
const EXECUTIONS_URL = '/api/gh/executions';
const PREVIEW_URL = '/api/gh/executions/preview';

/** 입력이 멈춘 뒤 미리보기를 요청하기까지. 키 입력마다 서버를 부르지 않는다. */
export const PREVIEW_DEBOUNCE_MS = 300;
/** 스트림에 붙지 못했을 때의 폴링 주기. NFR-011의 취소 3초 안에 상태가 보이게 1초다. */
const POLL_MS = 1_000;

/** R0가 여는 유일한 capability. 목록에서 다른 것을 고르면 그 정의를 따른다. */
const DEFAULT_CAPABILITY_ID = 'pr.list';

type ScreenState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  /** `search-api`가 `/gh/*`를 등록하지 않았다 — 배포가 기능을 껐다. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unauthenticated'; readonly loginPath: string | null }
  | { readonly kind: 'failed'; readonly message: string; readonly correlationId: string | null };

type Loaded<T> =
  | { readonly kind: 'ok'; readonly body: T }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unauthenticated'; readonly loginPath: string | null }
  | { readonly kind: 'failed'; readonly message: string; readonly correlationId: string | null };

/** 응답 본문을 한 번만 읽는다. JSON이 아니면 `null`이다. */
async function bodyOf(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function loadJson<T>(url: string, signal: AbortSignal): Promise<Loaded<T>> {
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: 'no-store' });
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: 'failed', message: "Unable to connect to the server.", correlationId: null };
  }
  const body = await bodyOf(response);
  if (response.status === 404) return { kind: 'unavailable' };
  if (response.status === 401) return { kind: 'unauthenticated', loginPath: loginPathOf(body) };
  if (!response.ok) {
    const shaped = describeApiError(body, "Unable to read the response.");
    return { kind: 'failed', message: shaped.message, correlationId: shaped.correlationId };
  }
  return { kind: 'ok', body: body as T };
}

interface ActionError {
  readonly message: string;
  readonly correlationId: string | null;
}

export function GhCommandCenterView(): ReactNode {
  const params = useSearchParams();
  const prefill = useMemo(() => parsePrefill(params.get('prefill')), [params]);
  const identityFailed = params.get('identity') === 'failed';

  const [screen, setScreen] = useState<ScreenState>({ kind: 'loading' });
  const [identity, setIdentity] = useState<IdentityView | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [repositories, setRepositories] = useState<readonly RepositoryContextView[]>([]);
  const [selectedId, setSelectedId] = useState(prefill?.capability_id ?? DEFAULT_CAPABILITY_ID);
  const [form, setForm] = useState<PrListFormState | null>(null);

  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<ActionError | null>(null);

  const [execution, setExecution] = useState<ExecutionView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [identityNonce, setIdentityNonce] = useState(0);

  /**
   * 제출 키. `ref`인 것은 렌더와 무관하게 **제출 사이에만** 바뀌어야 하기 때문이다 — 상태로
   * 두면 재렌더마다 새 키가 되어 재시도가 새 실행을 만든다.
   */
  const idempotencyKey = useRef<string | null>(null);
  const keyFor = (): string => {
    idempotencyKey.current ??= newIdempotencyKey();
    return idempotencyKey.current;
  };

  const capability: CapabilityView | null = useMemo(
    () => capabilities?.capabilities.find((entry) => entry.id === selectedId && entry.execution === 'allowed') ?? null,
    [capabilities, selectedId],
  );

  /* 첫 적재 — 셋을 함께 부른다. 한 섹션의 실패가 나머지를 막지 않는다. */
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [identityLoaded, capabilitiesLoaded, repositoriesLoaded] = await Promise.all([
          loadJson<IdentityView>(IDENTITY_URL, controller.signal),
          loadJson<CapabilitiesResponse>(CAPABILITIES_URL, controller.signal),
          loadJson<{ readonly items: readonly RepositoryContextView[] }>(REPOSITORIES_URL, controller.signal),
        ]);
        if (controller.signal.aborted) return;

        const all = [identityLoaded, capabilitiesLoaded, repositoriesLoaded];
        const unavailable = all.find((entry) => entry.kind === 'unavailable');
        if (unavailable !== undefined) {
          setScreen({ kind: 'unavailable' });
          return;
        }
        const unauthenticated = all.find((entry): entry is Extract<Loaded<unknown>, { kind: 'unauthenticated' }> => entry.kind === 'unauthenticated');
        if (unauthenticated !== undefined) {
          setScreen({ kind: 'unauthenticated', loginPath: unauthenticated.loginPath });
          return;
        }
        const failed = all.find((entry): entry is Extract<Loaded<unknown>, { kind: 'failed' }> => entry.kind === 'failed');
        if (failed !== undefined) {
          setScreen({ kind: 'failed', message: failed.message, correlationId: failed.correlationId });
          return;
        }

        if (identityLoaded.kind === 'ok') setIdentity(identityLoaded.body);
        if (capabilitiesLoaded.kind === 'ok') setCapabilities(capabilitiesLoaded.body);
        if (repositoriesLoaded.kind === 'ok') setRepositories(repositoriesLoaded.body.items);
        setScreen({ kind: 'ready' });
      } catch (error) {
        if (!controller.signal.aborted) void error;
      }
    })();
    return () => {
      controller.abort();
    };
  }, [identityNonce]);

  /* capability가 정해지면 폼 초기값을 만든다. 이력의 「다시 실행」은 invocation을 초기값으로만 쓴다. */
  useEffect(() => {
    if (capability === null) {
      setForm(null);
      return;
    }
    setForm((current) => {
      if (current !== null) return current;
      if (prefill !== null && prefill.capability_id === capability.id) return formFromInvocation(capability, prefill);
      return defaultFormState(capability);
    });
  }, [capability, prefill]);

  const violations = useMemo(() => (capability === null || form === null ? [] : validateForm(capability, form)), [capability, form]);

  /*
   * 미리보기 — 폼이 유효할 때만, 입력이 멈춘 뒤에 요청한다. 위반이 있으면 서버를 부르지 않는다
   * (QA-GH-02): 같은 함수가 같은 답을 낼 것이고, 실행 버튼은 이미 닫혀 있다.
   */
  useEffect(() => {
    // 폼이 바뀌었다 — 다음 제출은 다른 실행이다. 같은 폼의 재시도는 이 효과가 다시 돌지 않으므로 키를 지킨다.
    idempotencyKey.current = null;
    if (capability === null || form === null || form.repository === '' || violations.length > 0) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(PREVIEW_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(toInvocation(capability, form)),
            signal: controller.signal,
            cache: 'no-store',
          });
          const body = await bodyOf(response);
          if (controller.signal.aborted) return;
          if (response.status === 404) {
            setScreen({ kind: 'unavailable' });
            return;
          }
          if (response.status === 401 && describeApiError(body, '').code === 'UNAUTHENTICATED') {
            setScreen({ kind: 'unauthenticated', loginPath: loginPathOf(body) });
            return;
          }
          if (!response.ok) {
            const shaped = describeApiError(body, "Unable to generate the preview.");
            setPreview(null);
            setPreviewError({ message: shaped.message, correlationId: shaped.correlationId });
            return;
          }
          setPreviewError(null);
          setPreview(body as PreviewView);
        } catch (error) {
          if (controller.signal.aborted) return;
          void error;
          setPreview(null);
          setPreviewError({ message: "Unable to request a preview.", correlationId: null });
        } finally {
          if (!controller.signal.aborted) setPreviewLoading(false);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [capability, form, violations]);

  /*
   * 실행 상태 — 스트림에 붙고, 못 붙으면 폴링한다. 의존성은 **실행 ID와 종료 여부**뿐이다 —
   * 상태 객체를 넣으면 이벤트마다 스트림을 다시 연다.
   */
  const executionId = execution?.execution_id ?? null;
  const executionDone = execution !== null && isTerminal(execution.state);
  useEffect(() => {
    if (executionId === null || executionDone) return;
    let closed = false;
    let source: EventSource | null = null;
    let timer: number | null = null;

    const apply = (next: unknown): void => {
      if (closed || typeof next !== 'object' || next === null) return;
      const view = next as ExecutionView;
      if (view.execution_id !== executionId) return;
      setExecution(view);
    };
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`${EXECUTIONS_URL}/${String(executionId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        apply(await bodyOf(response));
      } catch (error) {
        void error;
      }
    };
    const startPolling = (): void => {
      if (timer !== null) return;
      timer = window.setInterval(() => {
        void poll();
      }, POLL_MS);
    };

    if (typeof EventSource === 'function') {
      source = new EventSource(`${EXECUTIONS_URL}/${String(executionId)}/stream`);
      source.addEventListener('state', (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data));
        } catch (error) {
          void error;
        }
      });
      source.addEventListener('done', () => {
        source?.close();
        source = null;
        // 종료 뒤 한 번 더 읽는다 — 마지막 `state` 이벤트가 유실됐어도 결과가 화면에 닿게.
        void poll();
      });
      source.onerror = () => {
        source?.close();
        source = null;
        startPolling();
      };
    } else {
      startPolling();
    }

    return () => {
      closed = true;
      source?.close();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [executionId, executionDone]);

  const refreshIdentity = useCallback(() => {
    setIdentityNonce((current) => current + 1);
  }, []);

  const onConnect = useCallback(() => {
    setConnecting(true);
    setActionError(null);
    void (async () => {
      try {
        const response = await fetch(IDENTITY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ return_to: '/gh' }),
        });
        const body = await bodyOf(response);
        const url = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['authorize_url'] : undefined;
        if (response.status !== 201 || typeof url !== 'string') {
          const shaped = describeApiError(body, "Unable to start connecting your GitHub account.");
          setActionError({ message: shaped.message, correlationId: shaped.correlationId });
          setConnecting(false);
          return;
        }
        // 인가 URL은 서버가 만든다. 화면은 그리로 보낼 뿐이다.
        window.location.assign(url);
      } catch (error) {
        void error;
        setActionError({ message: "Unable to send the GitHub connection request.", correlationId: null });
        setConnecting(false);
      }
    })();
  }, []);

  const onDisconnect = useCallback(() => {
    setConnecting(true);
    setActionError(null);
    void (async () => {
      try {
        const response = await fetch(IDENTITY_URL, { method: 'DELETE' });
        if (!response.ok) {
          const shaped = describeApiError(await bodyOf(response), "Unable to disconnect.");
          setActionError({ message: shaped.message, correlationId: shaped.correlationId });
        }
      } catch (error) {
        void error;
        setActionError({ message: "Unable to send the disconnect request.", correlationId: null });
      } finally {
        setConnecting(false);
        setPreview(null);
        refreshIdentity();
      }
    })();
  }, [refreshIdentity]);

  const onExecute = useCallback(() => {
    if (capability === null || form === null || submitting || !canExecute(violations, preview)) return;
    setSubmitting(true);
    setActionError(null);
    const key = keyFor();
    void (async () => {
      try {
        const response = await fetch(EXECUTIONS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify(toInvocation(capability, form)),
        });
        const body = await bodyOf(response);
        if (response.status === 202) {
          setExecution(body as ExecutionView);
          idempotencyKey.current = null;
          return;
        }
        const shaped = describeApiError(body, "The execution request was rejected.");
        if (shaped.code === 'GH_DUPLICATE_REQUEST') {
          /*
           * 같은 키의 실행이 이미 있다 — 앞선 제출의 응답을 못 받았던 경우다. 새 실행을 만들지
           * 않고 **그 실행에 붙는다.**
           */
          const detail = typeof body === 'object' && body !== null ? ((body as Record<string, unknown>)['error'] as Record<string, unknown>)['detail'] : undefined;
          const existingId = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>)['execution_id'] : undefined;
          if (typeof existingId === 'number') {
            const existing = await fetch(`${EXECUTIONS_URL}/${String(existingId)}`, { cache: 'no-store' });
            if (existing.ok) {
              setExecution((await bodyOf(existing)) as ExecutionView);
              idempotencyKey.current = null;
              return;
            }
          }
        }
        if (shaped.code === 'GH_IDENTITY_REQUIRED') {
          setActionError({ message: "Your GitHub connection is missing or expired. Connect your account and try again.", correlationId: shaped.correlationId });
          refreshIdentity();
          return;
        }
        setActionError({ message: shaped.message, correlationId: shaped.correlationId });
      } catch (error) {
        void error;
        setActionError({ message: "Unable to send the execution request. Retrying the same request will not create a duplicate execution.", correlationId: null });
      } finally {
        setSubmitting(false);
      }
    })();
  }, [capability, form, submitting, violations, preview, refreshIdentity]);

  const onCancel = useCallback((id: number) => {
    setCancelling(true);
    setActionError(null);
    void (async () => {
      try {
        const response = await fetch(`${EXECUTIONS_URL}/${String(id)}/cancel`, { method: 'POST' });
        const body = await bodyOf(response);
        if (response.status === 202) {
          setExecution(body as ExecutionView);
        } else {
          const shaped = describeApiError(body, "The cancellation request was rejected.");
          setActionError({ message: shaped.message, correlationId: shaped.correlationId });
        }
      } catch (error) {
        void error;
        setActionError({ message: "Unable to send the cancellation request.", correlationId: null });
      } finally {
        setCancelling(false);
      }
    })();
  }, []);

  if (screen.kind === 'unavailable') {
    return (
      <div data-testid="gh-command-center" data-state="unavailable">
        <EmptyState
          cause="not_found"
          title="GitHub operations are not enabled in this deployment"
          description="An operator must enable GH_OPERATIONS_ENABLED and register the Operations App. Search and investigation remain available."
        />
      </div>
    );
  }

  if (screen.kind === 'unauthenticated') {
    const loginHref = screen.loginPath === null ? null : `${screen.loginPath}?return_to=${encodeURIComponent('/gh')}`;
    return (
      <div data-testid="gh-command-center" data-state="unauthenticated">
        <EmptyState
          cause="no_permission"
          title="Sign in required"
          description="GitHub operations run only with the signed-in user's delegated permissions."
          actions={loginHref === null ? undefined : <Link href={loginHref}>Sign in</Link>}
        />
      </div>
    );
  }

  if (screen.kind === 'failed') {
    return (
      <div data-testid="gh-command-center" data-state="failed">
        <ErrorBanner
          tone="danger"
          title="Unable to load GitHub operations"
          impact={screen.message}
          correlationId={screen.correlationId}
          recoverable
          action={
            <Button variant="secondary" onClick={refreshIdentity} data-testid="gh-retry">
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const ready = screen.kind === 'ready' && capabilities !== null;

  return (
    <div data-testid="gh-command-center" data-state={ready ? 'ready' : 'loading'} className="prs-gh-center">
      {identityFailed ? (
        <ErrorBanner
          tone="warning"
          title="Unable to connect your GitHub account"
          impact="Authorization did not complete. Connect again below. Failure details are available only in operational logs."
        />
      ) : null}
      {actionError === null ? null : (
        <ErrorBanner
          tone="danger"
          title="Unable to process the request"
          impact={actionError.message}
          correlationId={actionError.correlationId}
          action={
            <Button variant="secondary" onClick={() => setActionError(null)} data-testid="gh-dismiss-error">
              Close
            </Button>
          }
        />
      )}

      <Panel as="section" aria-label="GitHub identity" data-testid="section-identity">
        <GhIdentityBanner identity={identity} connecting={connecting} onConnect={onConnect} onDisconnect={onDisconnect} />
      </Panel>

      {!ready ? (
        <p data-testid="gh-loading">Loading GitHub operations…</p>
      ) : (
        <div className="prs-gh-layout">
          <Panel as="aside" aria-label="capability" data-testid="section-capabilities">
            <GhCapabilityList capabilities={capabilities} selectedId={selectedId} onSelect={setSelectedId} />
          </Panel>

          <div className="prs-gh-main">
            <Panel as="section" aria-label="Command input" data-testid="section-form">
              {capability === null || form === null ? (
                <p data-testid="gh-capability-not-executable">Select a capability enabled for this deployment.</p>
              ) : (
                <>
                  <h2>
                    gh {capability.path.join(' ')} <small>{capabilityTitle(capability)}</small>
                  </h2>
                  {/* 운영 승인 필요·관리자 차단·레지스트리 불일치를 입력 전에 알린다 (CR-090). 실행 가능하면 그리지 않는다. */}
                  <GhExecutionGateBanner gate={preview?.gate ?? capability.execution_gate} />
                  <GhPrListForm capability={capability} repositories={repositories} form={form} violations={violations} onChange={setForm} />
                </>
              )}
            </Panel>

            <Panel as="section" aria-label="Run" data-testid="section-preview">
              <GhExecutionPreview preview={preview} loading={previewLoading} />
              {previewError === null ? null : (
                <p role="alert" data-testid="gh-preview-error">
                  {previewError.message}
                  {previewError.correlationId === null ? '' : `(correlation ID ${previewError.correlationId})`}
                </p>
              )}
              <div className="prs-gh-actions">
                <Button data-testid="gh-execute" disabled={!canExecute(violations, preview) || submitting} onClick={onExecute}>
                  {submitting ? "Submitting…" : "Run"}
                </Button>
                <Link href="/gh/history" data-testid="gh-open-history">
                  Execution history
                </Link>
              </div>
            </Panel>

            {execution === null ? null : <GhExecutionPanel execution={execution} onCancel={onCancel} cancelling={cancelling} />}
          </div>
        </div>
      )}
    </div>
  );
}
