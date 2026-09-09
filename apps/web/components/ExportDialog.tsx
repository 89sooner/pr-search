'use client';

/** W-001 / QA-W001-20·21: preview count, explicit consent, then file or job. */
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Dialog } from '@conductor-by-89soone/react';
import type { QueryState } from '../lib/query-url';

export function ExportDialog({ state, disabled }: { readonly state: QueryState; readonly disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<number | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const creation = useRef<AbortController | null>(null);
  const body = JSON.stringify({ q: state.q, format, ...(state.sort === null ? {} : { sort: state.sort }), ...(state.order === null ? {} : { order: state.order }), ...(state.seqEpoch === null ? {} : { seq_epoch: state.seqEpoch }) });
  useEffect(() => {
    creation.current?.abort();
    if (!open) return;
    const abort = new AbortController();
    setTotal(null); setError(null); setJob(null); setDownload(null); setBusy(false);
    void fetch('/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(body) as object, preview: true }), signal: abort.signal })
      .then(async (response) => {
        const data = await response.json() as { total?: number; error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? '대상 건수를 확인하지 못했습니다.');
        if (!abort.signal.aborted) setTotal(data.total ?? 0);
      }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '대상 건수를 확인하지 못했습니다.'); });
    return () => { abort.abort(); creation.current?.abort(); };
  }, [open, body]);
  useEffect(() => {
    if (!open || job === null) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/exports/${job}`, { signal: abort.signal, cache: 'no-store' });
        const data = await response.json() as { state: string; download_url: string | null; error?: string | { message?: string } };
        if (!response.ok || data.state === 'failed' || data.state === 'cancelled') {
          const reasons: Record<string, string> = { export_scope_changed: '접근 권한이 변경되었습니다.', export_epoch_changed: '시퀀스가 재채번되었습니다. 검색을 새로고침하세요.', export_limit_exceeded: '결과가 100,000건을 초과했습니다.', export_timeout: '내보내기 제한 시간 30분을 초과했습니다.', export_failed: '파일 생성에 실패했습니다.' };
          throw new Error(typeof data.error === 'string' ? reasons[data.error] ?? '내보내기가 중단되었습니다.' : data.error?.message ?? '내보내기를 완료하지 못했습니다. 다시 요청하세요.');
        }
        if (abort.signal.aborted) return;
        if (data.download_url !== null) { setDownload(data.download_url.replace('/api/v1/', '/api/')); setBusy(false); }
        else timer = setTimeout(() => { void poll(); }, 1000);
      } catch (reason) { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : '상태 확인에 실패했습니다.'); setBusy(false); } }
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [open, job]);
  const create = async (): Promise<void> => {
    const abort = new AbortController(); creation.current = abort;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!response.ok) {
        const data = await response.json() as { error?: { message?: string } };
        throw new Error(data.error?.message ?? '내보내기에 실패했습니다.');
      }
      if (response.status === 202) { const data = await response.json() as { job_id: number }; if (!abort.signal.aborted) setJob(data.job_id); return; }
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `pr-search.${format}`; link.click();
      setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
      setBusy(false); setOpen(false);
    } catch (reason) { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : '내보내기에 실패했습니다.'); setBusy(false); } }
  };
  return <>
    <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setOpen(true); setBusy(false); }}>내보내기</Button>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content size="md">
        <Dialog.Title>검색 결과 내보내기</Dialog.Title>
        <Dialog.Description>현재 검색 조건과 접근 권한에 해당하는 결과를 파일로 받습니다. 최대 100,000건입니다.</Dialog.Description>
        <p>검색 조건: <code>{state.q}</code></p>
        <p role="status">{total === null ? error === null ? '대상 건수 확인 중…' : '대상 건수를 확인하지 못했습니다.' : `${total.toLocaleString('ko-KR')}건 · ${total > 1000 ? '비동기 작업 완료 후 다운로드' : '바로 다운로드'}`}</p>
        <fieldset disabled={busy}><legend>파일 형식</legend>
          <label><input type="radio" name="export-format" checked={format === 'csv'} onChange={() => { setFormat('csv'); }} />CSV</label>
          <label><input type="radio" name="export-format" checked={format === 'json'} onChange={() => { setFormat('json'); }} />JSON</label>
        </fieldset>
        {error === null ? null : <Banner tone="danger" title="내보내기 실패">{error}</Banner>}
        {job !== null ? <p role="status">작업 #{job}{busy ? ' 실행 중…' : ''}</p> : null}
        {download === null ? null : <a href={download} download>완성된 파일 다운로드</a>}
        <Button disabled={total === null || busy || total > 100000 || download !== null} onClick={() => { void create(); }}>내보내기 실행</Button>
        <Dialog.Close asChild><Button variant="ghost">닫기</Button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Root>
  </>;
}
