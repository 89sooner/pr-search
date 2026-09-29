'use client';
import { useEffect, useState } from 'react';
import { fetchSource } from '../../lib/source-client';

// CR-132: the reads live in lib/source-client so the analysis worker uses the same code.
export { fetchSource, sourceUrl } from '../../lib/source-client';
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
