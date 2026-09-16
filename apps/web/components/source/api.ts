'use client';
import { useEffect, useState } from 'react';
import { serviceMessage } from '../../lib/service-message';

export function sourceUrl(repository: string, operation: 'tree' | 'history' | 'file' | 'diff', query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `/api/source/${encodeURIComponent(repository)}/${operation}?${params}`;
}
export async function fetchSource<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  const body = await response.json() as T & { error?: { message?: string; code?: string } };
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again to continue.' : serviceMessage(body.error?.message, response.status === 404 ? 'Source browsing is unavailable for this repository or revision.' : 'Unable to load source. Try again.', body.error?.code));
  return body;
}
export function useSource<T>(url: string | null, delay = 0) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string; loading: boolean }>({ key: null, data: null, error: '', loading: false });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState({ key: url, data: null, error: '', loading: true });
    const timer = setTimeout(() => {
      void fetchSource<T>(url, controller.signal).then(data => { if (!controller.signal.aborted) setState({ key: url, data, error: '', loading: false }); })
        .catch(error => { if (!controller.signal.aborted) setState({ key: url, data: null, error: error instanceof Error ? error.message : 'Unable to load source.', loading: false }); });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, nonce, delay]);
  return { ...(state.key === url ? state : { key: url, data: null, error: '', loading: Boolean(url) }), reload: () => { setNonce(value => value + 1); } };
}
