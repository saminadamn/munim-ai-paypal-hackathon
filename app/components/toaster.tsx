'use client';

// Toasts for the whole app. Anything can call toast(); the <Toaster /> mounted in the Munim layout
// and the dashboard shows it. PayPal failures carry PayPal's debug_id, which support asks for.

import { useEffect, useState } from 'react';

export type Toast = { tone: 'success' | 'error' | 'info'; title: string; message?: string; debugId?: string | null };
type Shown = Toast & { id: number };

const EVENT = 'munim:toast';

export function toast(t: Toast) {
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: t }));
}

/** A failed PayPal call, from an API or action result: `{ error, debugId }`. */
export const paypalErrorToast = (title: string, r: { error?: string | null; debugId?: string | null }) =>
  toast({ tone: 'error', title, message: r.error ?? 'PayPal refused the request.', debugId: r.debugId });

const TONE = {
  success: 'border-l-pp-success',
  error: 'border-l-pp-danger',
  info: 'border-l-pp-blue',
};

let next = 1;

export function Toaster() {
  const [toasts, setToasts] = useState<Shown[]>([]);
  const dismiss = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = { ...(e as CustomEvent<Toast>).detail, id: next++ };
      setToasts((ts) => [...ts.slice(-3), t]);
      // Errors stay until dismissed, so a debug id can be copied.
      if (t.tone !== 'error') setTimeout(() => dismiss(t.id), 6000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto rounded-md border border-l-4 border-pp-border bg-pp-surface px-4 py-3 font-paypal text-sm text-pp-ink shadow-lg ${TONE[t.tone]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="font-semibold text-pp-navy">{t.title}</div>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-pp-muted hover:text-pp-ink">
              ×
            </button>
          </div>
          {t.message && <p className="mt-0.5 break-words text-pp-muted">{t.message}</p>}
          {t.debugId && (
            <p className="mt-1.5 flex items-center gap-2 text-xs text-pp-muted">
              PayPal debug ID <code className="rounded bg-pp-canvas px-1.5 py-0.5 text-pp-ink">{t.debugId}</code>
              <button className="font-semibold text-pp-blue hover:underline" onClick={() => navigator.clipboard?.writeText(t.debugId!)}>
                Copy
              </button>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
