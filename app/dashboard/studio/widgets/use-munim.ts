'use client';

import { useCallback, useEffect, useState } from 'react';
import { onMunimChanged } from './events';

type State<T> = { data: T | null; error: string | null; loading: boolean };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok || body === null) throw new Error(body?.error ?? `the server answered ${res.status}; it will retry shortly`);
  return body as T;
}

/** Fetches JSON from Munim's API, again whenever Munim changes something, and every `everyMs`. */
export function useMunim<T>(url: string, everyMs = 60_000) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // State is only set from the request's callbacks, never synchronously in the effect.
  useEffect(() => {
    let live = true;
    getJson<T>(url).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) => live && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false })),
    );
    return () => {
      live = false;
    };
  }, [url, version]);

  useEffect(() => {
    const timer = setInterval(reload, everyMs);
    const off = onMunimChanged(reload);
    return () => {
      clearInterval(timer);
      off();
    };
  }, [reload, everyMs]);

  return { ...state, reload };
}
