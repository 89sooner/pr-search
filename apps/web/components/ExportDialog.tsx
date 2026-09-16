'use client';

/** W-001 / QA-W001-20·21: preview count, explicit consent, then file or job. */
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Dialog } from './ui';
import type { QueryState } from '../lib/query-url';
import { serviceMessage } from '../lib/service-message';

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
        const data = await response.json() as { total?: number; error?: { message?: string; code?: string } };
        if (!response.ok) throw new Error(serviceMessage(data.error?.message, "Unable to determine the result count.", data.error?.code));
        if (!abort.signal.aborted) setTotal(data.total ?? 0);
      }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to determine the result count."); });
    return () => { abort.abort(); creation.current?.abort(); };
  }, [open, body]);
  useEffect(() => {
    if (!open || job === null) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/exports/${job}`, { signal: abort.signal, cache: 'no-store' });
        const data = await response.json() as { state: string; download_url: string | null; error?: string | { message?: string; code?: string } };
        if (!response.ok || data.state === 'failed' || data.state === 'cancelled') {
          const reasons: Record<string, string> = { export_scope_changed: "Your access permissions have changed.", export_epoch_changed: "The sequence was renumbered. Refresh your search.", export_limit_exceeded: "Results exceed 100,000 items.", export_timeout: "The export exceeded the 30-minute time limit.", export_failed: "Unable to generate the file." };
          throw new Error(typeof data.error === 'string' ? reasons[data.error] ?? "The export was interrupted." : serviceMessage(data.error?.message, "Unable to complete the export. Please request it again.", data.error?.code));
        }
        if (abort.signal.aborted) return;
        if (data.download_url !== null) { setDownload(data.download_url.replace('/api/v1/', '/api/')); setBusy(false); }
        else timer = setTimeout(() => { void poll(); }, 1000);
      } catch (reason) { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : "Unable to check status."); setBusy(false); } }
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
        const data = await response.json() as { error?: { message?: string; code?: string } };
        throw new Error(serviceMessage(data.error?.message, "Export failed.", data.error?.code));
      }
      if (response.status === 202) { const data = await response.json() as { job_id: number }; if (!abort.signal.aborted) setJob(data.job_id); return; }
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `pr-search.${format}`; link.click();
      setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
      setBusy(false); setOpen(false);
    } catch (reason) { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : "Export failed."); setBusy(false); } }
  };
  return <>
    <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setOpen(true); setBusy(false); }}>Export</Button>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content size="md">
        <Dialog.Title>Export search results</Dialog.Title>
        <Dialog.Description>Download up to 100,000 results matching your current search filters and access permissions.</Dialog.Description>
        <p>Search query: <code>{state.q}</code></p>
        <p role="status">{total === null ? error === null ? "Checking result count…" : "Unable to determine the result count." : `${total.toLocaleString("en-US")} items · ${total > 1000 ? "Download when the background job finishes" : "Download immediately"}`}</p>
        <fieldset disabled={busy}><legend>File format</legend>
          <label><input type="radio" name="export-format" checked={format === 'csv'} onChange={() => { setFormat('csv'); }} /> CSV</label>
          <label><input type="radio" name="export-format" checked={format === 'json'} onChange={() => { setFormat('json'); }} /> JSON</label>
        </fieldset>
        {error === null ? null : <Banner tone="danger" title="Export failed">{error}</Banner>}
        {job !== null ? <p role="status">Job #{job}{busy ? "Running…" : ''}</p> : null}
        {download === null ? null : <a href={download} download>Download completed file</a>}
        <Button disabled={total === null || busy || total > 100000 || download !== null} onClick={() => { void create(); }}>Export</Button>
        <Dialog.Close asChild><Button variant="ghost">Close</Button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Root>
  </>;
}
