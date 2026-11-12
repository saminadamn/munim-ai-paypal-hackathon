'use client';

// The approval queue, inside the dashboard: what Munim wants to do but needs the owner for.
// Approve executes through PayPal (POST /api/munim/actions/{id}); Reject dismisses it.

import { useEffect, useState } from 'react';
import type { AgWidgetParams } from 'ag-studio';
import { paypalErrorToast, toast } from '@/app/components/toaster';
import { notifyMunimChanged } from './events';
import { formatMoney, relativeDue } from '@/lib/format';
import { useMunim } from './use-munim';

type Pending = {
  id: string;
  invoiceNumber: string | null;
  label: string;
  actionType: string;
  reason: string;
  guardrail: string | null;
  client: string | null;
  amountDue: number | null;
  currency: string | null;
  daysOverdue: number | null;
  riskLevel: string | null;
  subject: string;
  message: string;
  partialMinimum: number | null;
};

const money = (n: number, currency: string) => formatMoney(n, currency);
const waitingBecause = (g: string | null) => g?.split('; ')[0]?.split(': ').slice(1).join(': ') ?? null;
const RISK = { high: 'border-pp-danger text-pp-danger', medium: 'border-pp-warning text-pp-warning', low: 'border-pp-border text-pp-muted' } as Record<string, string>;

export function ApprovalQueueWidget({ widgetApi }: AgWidgetParams) {
  const { data, error, loading, reload } = useMunim<Pending[]>('/api/munim/actions?status=proposed', 30_000);
  useEffect(() => widgetApi.setDisplayState(loading ? 'loading' : 'displayed'), [loading, widgetApi]);

  if (error) return <p className="p-2 text-sm text-pp-danger">The approval queue is unavailable: {error}</p>;
  if (!data) return null;
  if (data.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center text-center font-paypal">
        <div className="text-sm font-semibold text-pp-navy">Nothing waiting for you</div>
        <div className="mt-1 text-xs text-pp-muted">Actions over your approval limit, part-payment offers and hand-offs appear here.</div>
      </div>
    );

  return (
    <ul className="h-full divide-y divide-pp-border overflow-y-auto pr-1 font-paypal text-pp-ink">
      {data.map((item) => (
        <Row key={item.id} item={item} onDone={reload} />
      ))}
    </ul>
  );
}

function Row({ item, onDone }: { item: Pending; onDone: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const sends = item.actionType !== 'escalate_to_owner';

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/munim/actions/${item.id}`, { method: 'POST', body: JSON.stringify({ decision }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.status === 'failed') {
        paypalErrorToast(`${item.invoiceNumber}: PayPal refused it`, body);
      } else if (body.status === 'executed') {
        toast({ tone: 'success', title: `${item.label} done`, message: `${item.invoiceNumber} · ${item.client}` });
      } else if (body.status === 'skipped' && decision === 'approve') {
        toast({ tone: 'info', title: `${item.invoiceNumber}: nothing sent`, message: 'The invoice is no longer open.' });
      }
      notifyMunimChanged();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-semibold">{item.label}</span>
            <span className="text-pp-muted">
              {item.invoiceNumber} · {item.client}
              {item.amountDue != null && item.currency ? ` · ${money(item.amountDue, item.currency)}` : ''}
              {item.daysOverdue != null ? ` · ${relativeDue(item.daysOverdue)}` : ''}
            </span>
            {item.riskLevel && <span className={`rounded-full border px-1.5 text-[11px] font-semibold ${RISK[item.riskLevel] ?? RISK.low}`}>{item.riskLevel}</span>}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug">{item.reason}</p>
          {waitingBecause(item.guardrail) && <p className="text-xs text-pp-muted">Waiting because {waitingBecause(item.guardrail)}.</p>}
          {sends && item.message && (
            <button className="mt-0.5 text-xs font-semibold text-pp-blue hover:underline" onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide message' : 'Show message'}
            </button>
          )}
          {open && (
            <div className="mt-1 rounded border border-pp-border bg-pp-canvas p-2 text-xs">
              <div className="font-semibold">{item.subject}</div>
              <p className="mt-0.5 whitespace-pre-wrap">{item.message}</p>
            </div>
          )}
          {error && <p className="mt-1 text-xs text-pp-danger">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            disabled={busy !== null}
            onClick={() => decide('reject')}
            className="rounded-full border border-pp-border px-3 py-1 text-xs font-semibold text-pp-ink hover:border-pp-blue disabled:text-pp-muted"
          >
            {busy === 'reject' ? '…' : 'Reject'}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => decide('approve')}
            className="rounded-full bg-pp-blue px-3 py-1 text-xs font-semibold text-white hover:bg-pp-blue-dark disabled:bg-pp-border disabled:text-pp-muted"
          >
            {busy === 'approve' ? 'Sending…' : sends ? 'Approve' : "I'll call"}
          </button>
        </div>
      </div>
    </li>
  );
}
