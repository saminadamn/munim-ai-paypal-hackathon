'use client';

// A side panel for one grid row: a title and a dated timeline. Endpoint pages that pass `details`
// to DataGrid get it on row click; the data is plain, built on the server.

import { useEffect } from 'react';

export type TimelineEvent = {
  /** ISO date or date-time. */
  at: string;
  label: string;
  detail?: string;
  /** Who did it, e.g. "Munim", "PayPal", "Owner". */
  by?: string;
  tone?: 'normal' | 'warning' | 'danger' | 'success' | 'muted';
  future?: boolean;
};

export type RowDetail = { title: string; subtitle?: string; facts?: [string, string][]; events: TimelineEvent[] };

const TONE: Record<NonNullable<TimelineEvent['tone']>, string> = {
  normal: 'var(--pp-blue)',
  success: 'var(--pp-success)',
  warning: 'var(--pp-warning)',
  danger: 'var(--pp-danger)',
  muted: 'var(--pp-border)',
};

export function RowDetailPanel({ detail, onClose }: { detail: RowDetail; onClose: () => void }) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label={detail.title}
      className="fixed inset-y-0 right-0 z-20 flex w-[440px] max-w-full flex-col border-l border-pp-border bg-pp-surface shadow-[-8px_0_24px_rgba(0,20,53,0.08)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-pp-border px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-pp-navy">{detail.title}</h2>
          {detail.subtitle && <p className="mt-0.5 text-sm text-pp-muted">{detail.subtitle}</p>}
        </div>
        <button onClick={onClose} className="text-sm font-semibold text-pp-blue hover:underline" aria-label="Close panel">
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {detail.facts && (
          <dl className="mb-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {detail.facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wider text-pp-muted">{k}</dt>
                <dd className="font-semibold text-pp-ink">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-pp-muted">Timeline</h3>
        {detail.events.length === 0 ? (
          <p className="text-sm text-pp-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="relative ml-1.5 border-l border-pp-border">
            {detail.events.map((e, i) => (
              <li key={i} className="mb-5 ml-5">
                <span
                  className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-pp-surface"
                  style={{ background: TONE[e.tone ?? 'normal'] }}
                />
                <div className="text-xs text-pp-muted">
                  {e.at.length > 10 ? e.at.replace('T', ' ').slice(0, 16) : e.at}
                  {e.by ? ` · ${e.by}` : ''}
                  {e.future ? ' · upcoming' : ''}
                </div>
                <div className={`text-sm font-semibold ${e.future ? 'text-pp-muted' : 'text-pp-ink'}`}>{e.label}</div>
                {e.detail && <p className="mt-0.5 text-sm text-pp-muted">{e.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
