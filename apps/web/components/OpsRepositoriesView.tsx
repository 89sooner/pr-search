'use client';

/**
 * A-002 저장소 등록 관리 (WP-040 / FR-ING-009, CR-055).
 *
 * ## 승인이라는 중간 상태를 만들지 않는다 (AC-11)
 *
 * 요청 목록의 "등록 폼 채우기"는 폼을 채울 뿐이고, 요청은 등록이 **성공해야**
 * 종료된다. 서버가 같은 트랜잭션에서 그 전부를 옮기므로 화면이 따로 옮기지
 * 않는다 — 화면이 옮기면 등록되지 않은 채 승인된 행이 생긴다.
 *
 * ## 처리 메모는 이 평면에만 있다 (AC-10, THR-045)
 *
 * `API-ADM-009`의 응답만 처리 상태를 담고, 요청자가 쓰는 `API-ING-003`은
 * 담지 않는다. 두 평면을 한 타입으로 합치지 않는 것이 그 경계를 지키는 방법이다.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Panel, Table } from './ui';
import { RegistrationRequestQueue } from './RegistrationRequestQueue';
import {
  RepositoryRegistrationForm,
  type RegistrationEditTarget,
  type RegistrationSubmission,
} from './RepositoryRegistrationForm';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { requestPrefill, type RegistrationRequestView } from '../lib/ops-repositories';
import { formatTimestamp } from '../lib/format';

const REPOSITORIES_URL = '/api/admin/repositories';
const REQUESTS_URL = '/api/admin/repository-registration-requests';

interface RepositoryRow {
  readonly repository_id: number;
  readonly owner: string;
  readonly name: string;
  readonly status: string;
  readonly sequence_branches: readonly string[];
  readonly mirror_enabled: boolean;
  readonly registered_at?: string | null;
}

interface RequestsState {
  readonly items: readonly RegistrationRequestView[];
  readonly nextCursor: string | null;
  readonly cursor: string | null;
}

const NO_REQUESTS: RequestsState = { items: [], nextCursor: null, cursor: null };

export function OpsRepositoriesView(): ReactNode {
  const [repositories, setRepositories] = useState<readonly RepositoryRow[] | null>(null);
  const [repositoriesFailed, setRepositoriesFailed] = useState(false);
  const [requests, setRequests] = useState<RequestsState>(NO_REQUESTS);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const [prefill, setPrefill] = useState<{ owner: string; name: string } | null>(null);
  const [edit, setEdit] = useState<RegistrationEditTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requiredPermissions, setRequiredPermissions] = useState<readonly string[] | null>(null);
  const [sequenceJobIds, setSequenceJobIds] = useState<readonly number[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      setLoading(true);
      try {
        const cursorParam = requests.cursor === null ? '' : `?cursor=${encodeURIComponent(requests.cursor)}`;
        const [repoResponse, requestResponse] = await Promise.all([
          fetch(REPOSITORIES_URL, { signal: controller.signal, cache: 'no-store' }),
          fetch(`${REQUESTS_URL}${cursorParam}`, { signal: controller.signal, cache: 'no-store' }),
        ]);

        if (repoResponse.status === 403 || repoResponse.status === 401) {
          setDenied(true);
          return;
        }

        if (repoResponse.ok) {
          const body: unknown = await repoResponse.json().catch(() => null);
          const items = (body as { items?: readonly RepositoryRow[] } | null)?.items ?? [];
          setRepositories(items);
          setRepositoriesFailed(false);
        } else {
          setRepositoriesFailed(true);
        }

        if (requestResponse.ok) {
          const body: unknown = await requestResponse.json().catch(() => null);
          const page = body as { items?: readonly RegistrationRequestView[]; next_cursor?: string | null } | null;
          setRequests((current) => ({
            // 커서가 없으면 첫 페이지다 — 쌓지 않고 갈아 끼운다.
            items: current.cursor === null ? (page?.items ?? []) : [...current.items, ...(page?.items ?? [])],
            nextCursor: page?.next_cursor ?? null,
            cursor: current.cursor,
          }));
          setRequestsFailed(false);
        } else {
          setRequestsFailed(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          void error;
          setRepositoriesFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [nonce, requests.cursor]);

  const onSubmit = useCallback(
    (submission: RegistrationSubmission) => {
      setSubmitting(true);
      setRequiredPermissions(null);
      setActionError(null);
      setSequenceJobIds([]);
      void (async () => {
        try {
          const editing = edit !== null;
          const response = await fetch(
            editing ? `${REPOSITORIES_URL}/${String(edit.repository_id)}` : REPOSITORIES_URL,
            {
              method: editing ? 'PATCH' : 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(
                editing
                  ? { sequence_branches: submission.sequence_branches, mirror_enabled: submission.mirror_enabled }
                  : submission,
              ),
            },
          );
          const body: unknown = await response.json().catch(() => null);

          if (!response.ok) {
            const error = (body as { error?: { code?: string; detail?: Record<string, unknown> } } | null)?.error;
            const permissions = error?.detail?.['required_permissions'];
            if (Array.isArray(permissions)) {
              setRequiredPermissions(permissions as readonly string[]);
            } else {
              setActionError("Unable to register the repository. Check the inputs.");
            }
            return;
          }

          const jobIds = (body as { sequence_job_ids?: readonly number[] } | null)?.sequence_job_ids ?? [];
          setSequenceJobIds(jobIds);
          setEdit(null);
          setPrefill(null);
          // 등록이 성공했으므로 요청 목록이 바뀌었다 — 첫 페이지부터 다시 읽는다.
          setRequests(NO_REQUESTS);
          refresh();
        } catch (error) {
          void error;
          setActionError("Unable to send the registration request.");
        } finally {
          setSubmitting(false);
        }
      })();
    },
    [edit, refresh],
  );

  const onUnregister = useCallback(
    (target: RegistrationEditTarget) => {
      setSubmitting(true);
      setActionError(null);
      void (async () => {
        try {
          const response = await fetch(`${REPOSITORIES_URL}/${String(target.repository_id)}`, { method: 'DELETE' });
          if (!response.ok) setActionError("The unregister request was rejected.");
          else setEdit(null);
        } catch (error) {
          void error;
          setActionError("Unable to send the unregister request.");
        } finally {
          setSubmitting(false);
          refresh();
        }
      })();
    },
    [refresh],
  );

  const onDismiss = useCallback(
    (requestId: string, reason: string) => {
      setSubmitting(true);
      setActionError(null);
      void (async () => {
        try {
          const response = await fetch(`${REQUESTS_URL}/${requestId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'dismiss', reason }),
          });
          if (!response.ok) setActionError("Closing the request was rejected.");
        } catch (error) {
          void error;
          setActionError("Unable to send the close request.");
        } finally {
          setSubmitting(false);
          setRequests(NO_REQUESTS);
          refresh();
        }
      })();
    },
    [refresh],
  );

  const onPrefill = useCallback((request: RegistrationRequestView) => {
    /*
     * **요청 상태를 바꾸지 않는다** (AC-11). 폼을 채우고 편집 모드를 푼다 —
     * 편집 중이면 새 등록이 아니라 그 저장소를 고치게 되기 때문이다.
     */
    const parsed = requestPrefill(request);
    if (parsed === null) return;
    setEdit(null);
    setPrefill(parsed);
  }, []);

  if (denied) {
    return (
      <div data-testid="ops-repositories-view" data-state="no_permission">
        <EmptyState
          cause="no_permission"
          title="The operator role is required"
          description="Only operators can register or unregister repositories."
        />
      </div>
    );
  }

  const list = repositories ?? [];
  const state =
    loading && repositories === null
      ? 'loading_initial'
      : submitting
        ? 'operation_pending'
        : list.length === 0
          ? 'empty_no_repository'
          : 'ready';

  return (
    <div data-testid="ops-repositories-view" data-state={state}>
      {actionError === null ? null : (
        <ErrorBanner tone="danger" title="Unable to process the request" impact={actionError} />
      )}

      <Panel as="section" aria-label="Registered repositories" data-testid="section-repositories">
        <h2>Registered repositories</h2>
        {repositoriesFailed ? (
          <ErrorBanner
            tone="warning"
            title="Unable to load repositories"
            impact="Registration requests remain available. Please try again later."
          />
        ) : list.length === 0 ? (
          <EmptyState
            cause="not_indexed"
            title="No registered repositories"
            description="Register your first repository below to start ingestion."
          />
        ) : (
          <Table data-testid="repository-table" caption="Registered repositories and sequence base branches.">
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col">Status</th>
                <th scope="col">Sequence base branches</th>
                <th scope="col">Mirror</th>
                <th scope="col">Registered at</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.repository_id} data-testid="repository-row" data-status={row.status}>
                  <td>
                    {row.owner}/{row.name}
                  </td>
                  <td>{row.status}</td>
                  <td>{row.sequence_branches.length === 0 ? '—' : row.sequence_branches.join(', ')}</td>
                  <td>{row.mirror_enabled ? "Enabled" : "Disabled"}</td>
                  <td>{formatTimestamp(row.registered_at ?? null)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      data-testid="repository-edit"
                      onClick={() => {
                        setPrefill(null);
                        setEdit({
                          repository_id: row.repository_id,
                          owner: row.owner,
                          name: row.name,
                          sequence_branches: row.sequence_branches,
                          mirror_enabled: row.mirror_enabled,
                        });
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel as="section" aria-label="Register / edit" data-testid="section-form">
        <h2>{edit === null ? "Register repository" : `${edit.owner}/${edit.name} Edit`}</h2>
        <RepositoryRegistrationForm
          prefill={prefill}
          edit={edit}
          onSubmit={onSubmit}
          onUnregister={onUnregister}
          submitting={submitting}
          requiredPermissions={requiredPermissions}
          sequenceJobIds={sequenceJobIds}
        />
      </Panel>

      <Panel as="section" aria-label="Request registration review" data-testid="section-requests">
        <h2>Request registration review</h2>
        {requestsFailed ? (
          <ErrorBanner
            tone="warning"
            title="Unable to load registration review requests"
            impact="The repository list and registration form remain available."
          />
        ) : (
          <RegistrationRequestQueue
            requests={requests.items}
            onPrefill={onPrefill}
            onDismiss={onDismiss}
            nextCursor={requests.nextCursor}
            onLoadMore={(cursor) => {
              setRequests((current) => ({ ...current, cursor }));
            }}
            submitting={submitting}
            loading={loading}
          />
        )}
      </Panel>
    </div>
  );
}
