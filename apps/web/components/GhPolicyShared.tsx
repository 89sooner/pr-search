'use client';

/**
 * 운영 정책 화면의 공용 부분 — 조회·제출·사유 입력·이력 표 (A-005 · A-006, API-GH-008, CR-090).
 *
 * ## 응답을 잃어도 결정은 하나다 (FR-GH-011 AC-8)
 *
 * 변경 한 번에 중복 방지 키 하나를 쓴다. 응답을 받지 못하면(네트워크) **같은 키로** 다시 보내며, 서버는 이미 적용했으면 같은
 * 결과(`replayed`)를, 아니면 적용 결과를 돌려준다 — 새 revision이 두 번 생기지 않는다. 서버가 거절(4xx)하면 그 키는 버린다.
 *
 * ## 역할은 서버가 정한다
 *
 * `canChange`는 버튼을 그릴지만 정한다. 조회 전용 사용자가 요청을 보내도 서버가 403으로 거절하고 감사에 남긴다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Field, Table, TextArea } from './ui';
import { formatTimestamp } from '../lib/format';
import { newIdempotencyKey } from '../lib/gh';
import { shortHash } from '../lib/gh-registry';
import { POLICY_ACTION_LABEL, POLICY_CHANGES_URL, POLICY_REASON_MAX, POLICY_URL, describePolicyError, reasonProblem, type PolicyErrorView, type PolicyRevisionView, type PolicyStatusView } from '../lib/gh-policy';

export type PolicyLoad =
  | { readonly kind: 'loading' }
  /** `/gh/*`가 등록되지 않았다 — 배포가 GitHub 작업을 껐다. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'failed'; readonly message: string; readonly correlationId: string | null }
  | { readonly kind: 'ok'; readonly body: PolicyStatusView };

export function usePolicyStatus(): { readonly load: PolicyLoad; readonly reload: () => void } {
  const [load, setLoad] = useState<PolicyLoad>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let response: Response;
      try {
        response = await fetch(POLICY_URL, { signal: controller.signal, cache: 'no-store' });
      } catch {
        if (controller.signal.aborted) return;
        setLoad({ kind: 'failed', message: "Unable to connect to the server.", correlationId: null });
        return;
      }
      const body = (await response.json().catch(() => null)) as unknown;
      if (controller.signal.aborted) return;
      if (response.status === 404) setLoad({ kind: 'unavailable' });
      else if (response.status === 403) setLoad({ kind: 'forbidden' });
      else if (response.status === 401) setLoad({ kind: 'unauthenticated' });
      else if (!response.ok) {
        const shaped = describePolicyError(body, "Unable to load operational policy.");
        setLoad({ kind: 'failed', message: shaped.message, correlationId: shaped.correlationId });
      } else setLoad({ kind: 'ok', body: body as PolicyStatusView });
    })();
    return () => controller.abort();
  }, [nonce]);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { load, reload };
}

export type SubmitOutcome =
  | { readonly kind: 'done'; readonly outcome: 'applied' | 'replayed'; readonly revision: number }
  | { readonly kind: 'rejected'; readonly error: PolicyErrorView }
  /** 응답을 받지 못했다. 같은 키로 다시 보내면 결과를 확인한다. */
  | { readonly kind: 'lost' };

/**
 * 한 변경의 제출기. 대화상자를 열 때 `begin()`으로 키를 정하고, 응답을 잃으면 같은 키로 `submit`을 다시 부른다.
 */
export function usePolicySubmit(): { readonly submitting: boolean; readonly begin: () => void; readonly submit: (body: Record<string, unknown>) => Promise<SubmitOutcome> } {
  const key = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const begin = useCallback(() => {
    key.current = newIdempotencyKey();
  }, []);
  const submit = useCallback(async (body: Record<string, unknown>): Promise<SubmitOutcome> => {
    if (key.current === null) key.current = newIdempotencyKey();
    setSubmitting(true);
    try {
      let response: Response;
      try {
        response = await fetch(POLICY_CHANGES_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key.current },
          body: JSON.stringify(body),
        });
      } catch {
        return { kind: 'lost' };
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      if (response.ok) {
        key.current = null;
        const record = (payload ?? {}) as { outcome?: 'applied' | 'replayed'; revision?: number };
        return { kind: 'done', outcome: record.outcome ?? 'applied', revision: record.revision ?? 0 };
      }
      if (response.status >= 500 && response.status !== 503) return { kind: 'lost' };
      key.current = null;
      return { kind: 'rejected', error: describePolicyError(payload, "Unable to update operational policy.") };
    } finally {
      setSubmitting(false);
    }
  }, []);
  return { submitting, begin, submit };
}

export function ReasonField({ id, value, onChange }: { readonly id: string; readonly value: string; readonly onChange: (value: string) => void }): ReactNode {
  const problem = value === '' ? null : reasonProblem(value);
  return (
    <Field id={id} label="Reason" description={`Recorded in the audit log and revision history. ${String(POLICY_REASON_MAX)} characters maximum. Do not include secrets.`} {...(problem === null ? {} : { error: problem })}>
      <TextArea id={id} data-testid={id} value={value} invalid={problem !== null} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function PolicyHistoryTable({ revisions, testId }: { readonly revisions: readonly PolicyRevisionView[]; readonly testId: string }): ReactNode {
  if (revisions.length === 0) {
    return (
      <p data-testid={`${testId}-empty`} role="status">
        No operational policy changes have been recorded.
      </p>
    );
  }
  return (
    <Table data-testid={testId} caption="Operational policy revisions, newest first. Records cannot be modified or deleted.">
      <thead>
        <tr>
          <th scope="col">revision</th>
          <th scope="col">Changes</th>
          <th scope="col">Target</th>
          <th scope="col">Operator</th>
          <th scope="col">Reason</th>
          <th scope="col">Time</th>
        </tr>
      </thead>
      <tbody>
        {revisions.map((revision) => (
          <tr key={revision.revision} data-testid={`${testId}-row`} data-action={revision.action}>
            <td>
              {revision.previous_revision} → {revision.revision}
            </td>
            <td>
              <Badge tone={revision.action === 'approve' || revision.action === 'resume' ? 'success' : 'warning'}>{POLICY_ACTION_LABEL[revision.action]}</Badge>
            </td>
            <td>
              {revision.capability_id !== null ? (
                <code>{revision.capability_id}</code>
              ) : (
                <span title={revision.manifest_hash ?? undefined}>
                  manifest {revision.manifest_version ?? '—'} · <code>{shortHash(revision.manifest_hash)}</code>
                </span>
              )}
            </td>
            <td>{revision.actor}</td>
            <td>{revision.reason}</td>
            <td>{formatTimestamp(revision.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
