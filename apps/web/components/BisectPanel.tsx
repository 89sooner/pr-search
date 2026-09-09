'use client';

/** C-029 / FLOW-004 / WP-042. 서버 저장 상태만 탐색의 정본으로 사용한다. */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Banner, Button, Panel } from '@conductor-by-89soone/react';

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
        const response = await fetch(`/api/bisect-sessions?${query}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ResponseBody;
        if (!response.ok) throw new Error(body.error?.message ?? '탐색 상태를 불러오지 못했습니다.');
        if (!controller.signal.aborted) setSession(body.session ?? null);
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : '연결을 확인하세요.'); setBlocked(true); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [query]);

  async function submit(action: 'start' | 'good' | 'bad' | 'reset'): Promise<void> {
    if (busy) return;
    setBusy(true); setError(null);
    const body = action === 'start' && range !== null
      ? { action: 'start', seq_epoch: range.epoch, from_seq: range.from, to_seq: range.to }
      : { action: 'mark', seq_epoch: session?.seq_epoch, session_id: session?.session_id, merge_seq: session?.next?.merge_seq, verdict: action };
    try {
      const response = await fetch(action === 'reset'
        ? `/api/bisect-sessions?${query}&session_id=${encodeURIComponent(session?.session_id ?? '')}` : '/api/bisect-sessions', {
        method: action === 'reset' ? 'DELETE' : 'POST', cache: 'no-store',
        ...(action === 'reset' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repository, base_branch: baseBranch, ...body }) }),
      });
      const result = await response.json() as ResponseBody;
      if (!response.ok) {
        if (result.error?.code === 'SEQUENCE_EPOCH_STALE') {
          setSession((current) => current === null ? null : { ...current, epoch_stale: true, remaining: null, estimated_steps: null, next: null, result: null, converged: false });
        }
        const detail = result.error?.detail;
        const contradiction = result.error?.code === 'BISECT_CONTRADICTION'
          ? ` (정상 ${String(detail?.['good_seq'])}, 이상 ${String(detail?.['bad_seq'])})` : '';
        setError((result.error?.message ?? '탐색을 갱신하지 못했습니다.') + contradiction);
        setBlocked(true);
        return;
      }
      setSession(result.session ?? null); setBlocked(false);
    } catch { setError('네트워크 오류입니다. 새로고침해 저장된 상태를 확인하세요.'); setBlocked(true); }
    finally { setBusy(false); }
  }

  function pointLink(point: Point): ReactNode {
    const path = point.pull_request_number === null
      ? `/commit/${repository}/${point.commit_sha}` : `/pr/${repository}/${String(point.pull_request_number)}`;
    return <Link href={path}>{point.pull_request_number === null ? `커밋 ${point.commit_sha.slice(0, 12)} (연결된 PR 없음)` : `PR #${String(point.pull_request_number)}`}</Link>;
  }
  return (
    <Panel aria-label="이분 탐색" data-testid="bisect-panel">
      <h2>이분 탐색</h2>
      <p>외부 빌드·테스트로 다음 지점을 검사하고 정상 또는 이상을 표시하세요.</p>
      {error === null ? null : <p role="alert">{error}</p>}
      {session?.epoch_stale ? <Banner tone="warning" title="탐색 에폭이 낡았습니다">저장된 탐색을 초기화한 후 현재 에폭에서 구간을 다시 조회하세요.</Banner> : null}
      {session === null ? (
        <Button disabled={busy || blocked || range === null} onClick={() => void submit('start')}>이 구간에서 탐색 시작</Button>
      ) : (
        <>
          <p>후보 구간 ({session.good_seq}, {session.bad_seq}] · 에폭 {session.seq_epoch}</p>
          <p aria-live="polite" data-testid="bisect-remaining">{session.remaining === null ? '탐색 상태 무효' : `남은 후보 ${String(session.remaining)}건 · 예상 잔여 검사 ${String(session.estimated_steps)}회`}</p>
          {session.converged && session.result !== null ? <p data-testid="bisect-result">탐색 종료 — seq:{session.result.merge_seq} {pointLink(session.result)}</p> : null}
          {session.next === null ? null : (
            <>
              <p data-testid="bisect-next">다음 검사 지점 seq:{session.next.merge_seq} {pointLink(session.next)}</p>
              <Button disabled={busy || blocked || session.epoch_stale} onClick={() => void submit('good')}>정상</Button>
              <Button disabled={busy || blocked || session.epoch_stale} onClick={() => void submit('bad')}>이상</Button>
            </>
          )}
          <Button disabled={busy} onClick={() => void submit('reset')}>탐색 초기화</Button>
        </>
      )}
    </Panel>
  );
}
