'use client';

import { serviceMessage } from '../lib/service-message';
import { readBisect, resetBisect, writeBisect } from '../lib/bisect-client';

/** C-029 / FLOW-004 / WP-042. 서버 저장 상태만 탐색의 정본으로 사용한다. */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Banner, Button, Panel } from './ui';

interface Point { merge_seq: number; commit_sha: string; pull_request_number: number | null }
interface Session {
  session_id: string; seq_epoch: number; good_seq: number; bad_seq: number;
  epoch_stale: boolean; remaining: number | null; estimated_steps: number | null;
  next: Point | null; result: Point | null; converged: boolean;
}
interface ResponseBody { session?: Session | null; error?: { code: string; message: string; detail?: Record<string, unknown> } }
export interface BisectPanelProps {
  readonly repository: string;
  readonly baseBranch: string;
  readonly range: { from: number; to: number; epoch: number } | null;
}

export function BisectPanel({ repository, baseBranch, range }: BisectPanelProps): ReactNode {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const query = new URLSearchParams({ repository, base_branch: baseBranch }).toString();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await readBisect({ repository, baseBranch }, controller.signal);
        const body = await response.json() as ResponseBody;
        if (!response.ok) throw new Error(serviceMessage(body.error?.message, "Unable to load bisect state.", body.error?.code));
        if (!controller.signal.aborted) setSession(body.session ?? null);
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Check your connection."); setBlocked(true); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [query]);

  async function submit(action: 'start' | 'good' | 'bad' | 'reset'): Promise<void> {
    if (busy) return;
    if (action === 'start' ? range === null : session === null) return;
    if ((action === 'good' || action === 'bad') && session?.next == null) return;
    setBusy(true); setError(null);
    try {
      const scope = { repository, baseBranch };
      const response = action === 'reset' && session !== null ? await resetBisect(scope, session.session_id)
        : action === 'start' && range !== null ? await writeBisect(scope, { action: 'start', seq_epoch: range.epoch, from_seq: range.from, to_seq: range.to })
        : await writeBisect(scope, { action: 'mark', seq_epoch: session!.seq_epoch, session_id: session!.session_id, merge_seq: session!.next!.merge_seq, verdict: action as 'good' | 'bad' });
      const result = await response.json() as ResponseBody;
      if (!response.ok) {
        if (result.error?.code === 'SEQUENCE_EPOCH_STALE') {
          setSession((current) => current === null ? null : { ...current, epoch_stale: true, remaining: null, estimated_steps: null, next: null, result: null, converged: false });
        }
        const detail = result.error?.detail;
        const contradiction = result.error?.code === 'BISECT_CONTRADICTION'
          ? `(good ${String(detail?.['good_seq'])}, bad ${String(detail?.['bad_seq'])})` : '';
        setError(serviceMessage(result.error?.message, "Unable to update bisect.", result.error?.code) + contradiction);
        setBlocked(true);
        return;
      }
      setSession(result.session ?? null); setBlocked(false);
    } catch { setError("Network error. Refresh to check the saved state."); setBlocked(true); }
    finally { setBusy(false); }
  }

  function pointLink(point: Point): ReactNode {
    const path = point.pull_request_number === null
      ? `/commit/${repository}/${point.commit_sha}` : `/pr/${repository}/${String(point.pull_request_number)}`;
    return <Link href={path}>{point.pull_request_number === null ? `Commit ${point.commit_sha.slice(0, 12)} (no linked PR)` : `PR #${String(point.pull_request_number)}`}</Link>;
  }
  return (
    <Panel aria-label="Bisect" data-testid="bisect-panel">
      <h2>Bisect</h2>
      <p>Build and test the next commit externally, then mark it good or bad.</p>
      {error === null ? null : <p role="alert">{error}</p>}
      {session?.epoch_stale ? <Banner tone="warning" title="Bisect epoch is stale">Reset the saved bisect, then reload the range using the current epoch.</Banner> : null}
      {session === null ? (
        <Button disabled={busy || blocked || range === null} onClick={() => void submit('start')}>Start bisect in this range</Button>
      ) : (
        <>
          <p>Candidate range ({session.good_seq}, {session.bad_seq}] · Epoch {session.seq_epoch}</p>
          <p aria-live="polite" data-testid="bisect-remaining">{session.remaining === null ? "Invalid bisect state" : `Remaining candidates: ${String(session.remaining)} · Estimated remaining checks: ${String(session.estimated_steps)}`}</p>
          {session.converged && session.result !== null ? <p data-testid="bisect-result">Bisect complete — seq: {session.result.merge_seq} {pointLink(session.result)}</p> : null}
          {session.next === null ? null : (
            <>
              <p data-testid="bisect-next">Next commit to test: seq: {session.next.merge_seq} {pointLink(session.next)}</p>
              <Button disabled={busy || blocked || session.epoch_stale} onClick={() => void submit('good')}>Good</Button>
              <Button disabled={busy || blocked || session.epoch_stale} onClick={() => void submit('bad')}>Bad</Button>
            </>
          )}
          <Button disabled={busy} onClick={() => void submit('reset')}>Reset bisect</Button>
        </>
      )}
    </Panel>
  );
}
