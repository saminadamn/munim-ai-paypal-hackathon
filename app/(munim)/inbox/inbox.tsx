'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColDef } from 'ag-grid-community';
import type { ClientMatch } from '@/lib/munim/client-match';
import { FIELD_LABELS, formTotal, missingFields, type FormItem, type InvoiceForm, type InvoiceSource } from '@/lib/munim/invoice-form';
import { MunimGrid } from '../_ui/grid';
import { paypalErrorToast, toast } from '@/app/components/toaster';
import { formatMoney } from '@/lib/format';
import { Button, Card } from '../_ui/ui';
import { SAMPLES, TABS } from './samples';

type Reading = { form: InvoiceForm; confidence: number; assumed: string[]; client: ClientMatch | null; today: string };
type Sent = { id: string; number: string; total: number; currency: string; payerUrl: string | null; reason: string };
type Row = FormItem & { key: number };

const STYLE_TEXT: Record<string, string> = { prompt: 'usually pays on time', slow: 'usually pays late', partial: 'has paid in parts before', unknown: 'no payment history yet' };

const safeMoney = (value: number, currency: string) => formatMoney(value, currency || 'USD');

const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function Inbox() {
  const [source, setSource] = useState<InvoiceSource>('chat');
  const [texts, setTexts] = useState<Record<InvoiceSource, string>>({ chat: '', email: '', whatsapp: '' });
  const [reading, setReading] = useState<Reading | null>(null);
  const [form, setForm] = useState<InvoiceForm | null>(null);
  // The message and tab the current draft came from, saved with the invoice. One request id per
  // draft so a retried Approve can't create the invoice twice.
  const [origin, setOrigin] = useState<{ text: string; source: InvoiceSource; requestId: string } | null>(null);
  const [busy, setBusy] = useState<'read' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  const text = texts[source];
  const missing = useMemo(() => (form ? missingFields(form) : []), [form]);

  const read = async () => {
    setBusy('read');
    setError(null);
    setSent(null);
    try {
      const res = await fetch('/api/munim/extract', { method: 'POST', body: JSON.stringify({ text, source }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setReading(body);
      setForm(body.form);
      setOrigin({ text, source, requestId: crypto.randomUUID() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Munim could not read that message.');
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!form || !origin) return;
    setBusy('send');
    setError(null);
    try {
      const res = await fetch('/api/munim/invoices/send', {
        method: 'POST',
        body: JSON.stringify({ form, source: origin.source, rawInput: origin.text, requestId: origin.requestId }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 502) {
          paypalErrorToast('PayPal did not send the invoice', body);
          return;
        }
        throw new Error(body.error);
      }
      setSent(body);
      toast({ tone: 'success', title: `Invoice ${body.number} sent`, message: `${safeMoney(body.total, body.currency)} via PayPal` });
      setForm(null);
      setReading(null);
      setTexts((t) => ({ ...t, [origin.source]: '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the invoice.');
    } finally {
      setBusy(null);
    }
  };

  const update = (patch: Partial<InvoiceForm>) => form && setForm({ ...form, ...patch });

  return (
    <div className="grid gap-6">
      <Card>
        <div role="tablist" className="mb-4 flex gap-1 border-b border-pp-border">
          {TABS.map((t) => (
            <button
              key={t.source}
              role="tab"
              aria-selected={source === t.source}
              onClick={() => setSource(t.source)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${source === t.source ? 'border-pp-blue text-pp-blue' : 'border-transparent text-pp-muted hover:text-pp-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setTexts((t) => ({ ...t, [source]: e.target.value }))}
          rows={source === 'chat' ? 3 : 9}
          placeholder={TABS.find((t) => t.source === source)?.placeholder}
          className="w-full rounded border border-pp-border p-3 font-paypal text-sm outline-none focus:border-pp-blue"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={read} disabled={!text.trim() || busy !== null}>
            {busy === 'read' ? 'Reading…' : 'Read with Munim'}
          </Button>
          <Button variant="secondary" onClick={() => setTexts((t) => ({ ...t, [source]: SAMPLES[source] }))} disabled={busy !== null}>
            Use a sample
          </Button>
        </div>
      </Card>

      {error && <p className="rounded border border-pp-danger bg-pp-surface px-4 py-3 text-sm text-pp-danger">{error}</p>}

      {sent && <SentCard sent={sent} />}

      {form && reading && (
        <Card
          title="Invoice preview"
          action={
            <span className="text-xs text-pp-muted">
              Read by Munim · {Math.round(reading.confidence * 100)}% sure
            </span>
          }
        >
          {reading.client && (
            <p className="mb-4 rounded bg-pp-highlight px-3 py-2 text-sm text-pp-navy">
              Existing client: <span className="font-semibold">{reading.client.company ?? reading.client.name}</span> ({reading.client.email}), {STYLE_TEXT[reading.client.paymentStyle] ?? ''}
              {reading.client.paymentStyle === 'slow' ? `, about ${Math.round(reading.client.avgDaysLate)} days` : ''}.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Client name" value={form.clientName} missing={missing.includes('clientName')} onChange={(v) => update({ clientName: v })} />
            <Field label="Client email" value={form.clientEmail} missing={missing.includes('clientEmail')} onChange={(v) => update({ clientEmail: v.trim() })} />
            <Field label="Company" value={form.company} onChange={(v) => update({ company: v })} />
          </div>

          <div className="mt-4">
            <ItemsGrid items={form.items} currency={form.currency} missing={missing.includes('items')} onChange={(items) => update({ items })} />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Currency" value={form.currency} missing={missing.includes('currency')} onChange={(v) => update({ currency: v.toUpperCase().slice(0, 3) })} />
            <Field
              label={form.dueInDays !== null && form.dueInDays >= 0 ? `Due in days · ${addDays(reading.today, form.dueInDays)}` : 'Due in days'}
              value={form.dueInDays === null ? '' : String(form.dueInDays)}
              missing={missing.includes('dueInDays')}
              onChange={(v) => update({ dueInDays: v.trim() === '' ? null : Math.round(Number(v)) })}
              inputMode="numeric"
            />
            <div className="self-end text-right">
              <div className="text-xs font-semibold uppercase tracking-wider text-pp-muted">Total</div>
              <div className="text-2xl font-semibold text-pp-navy">{safeMoney(formTotal(form), form.currency || 'USD')}</div>
            </div>
          </div>
          <Field label="Note to client" value={form.notes} onChange={(v) => update({ notes: v })} className="mt-4" />

          {reading.assumed.length > 0 && (
            <p className="mt-4 text-xs text-pp-muted">
              Not in the message, so Munim left it for you or assumed it: {reading.assumed.map((f) => FIELD_LABELS[f] ?? f).join(', ')}.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-pp-border pt-4">
            <p className="text-sm text-pp-muted">
              {missing.length ? (
                <span className="text-pp-danger">Still needed: {missing.map((f) => FIELD_LABELS[f] ?? f).join(', ')}</span>
              ) : (
                'Ready. PayPal will email the client a payment link.'
              )}
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setForm(null)} disabled={busy !== null}>
                Discard
              </Button>
              <Button onClick={send} disabled={busy !== null || missing.length > 0}>
                {busy === 'send' ? 'Sending…' : 'Approve & send via PayPal'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function SentCard({ sent }: { sent: Sent }) {
  return (
    <Card title="Sent through PayPal">
      <p className="text-sm">
        Invoice <span className="font-semibold">{sent.number}</span> for {safeMoney(sent.total, sent.currency)} was created and emailed to the client by PayPal.
      </p>
      <p className="mt-1 text-sm text-pp-muted">{sent.reason}</p>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        {sent.payerUrl && (
          <a href={sent.payerUrl} target="_blank" rel="noreferrer" className="font-semibold text-pp-blue hover:underline">
            Open the payer link →
          </a>
        )}
        <Link href="/invoices" className="font-semibold text-pp-blue hover:underline">
          See it in Invoices →
        </Link>
      </div>
      <p className="mt-2 text-xs text-pp-muted">PayPal invoice ID {sent.id}</p>
    </Card>
  );
}

function ItemsGrid({ items, currency, missing, onChange }: { items: FormItem[]; currency: string; missing: boolean; onChange: (items: FormItem[]) => void }) {
  const rows: Row[] = items.map((item, key) => ({ ...item, key }));
  const bad = { boxShadow: 'inset 0 0 0 1px var(--pp-danger)' };
  const columns: ColDef<Row>[] = [
    { field: 'name', headerName: 'Item', editable: true, flex: 2, cellStyle: (p) => (p.data && !p.data.name.trim() ? bad : null) },
    { field: 'quantity', headerName: 'Qty', editable: true, cellEditor: 'agNumberCellEditor', width: 100, cellStyle: (p) => (p.data && !(p.data.quantity > 0) ? bad : null) },
    {
      field: 'unitPrice',
      headerName: 'Unit price',
      editable: true,
      cellEditor: 'agNumberCellEditor',
      width: 140,
      cellStyle: (p) => (p.data && !(p.data.unitPrice > 0) ? bad : null),
      valueFormatter: (p) => (typeof p.value === 'number' ? safeMoney(p.value, currency || 'USD') : ''),
    },
    {
      headerName: 'Line total',
      width: 140,
      valueGetter: (p) => (p.data ? Math.round(p.data.quantity * p.data.unitPrice * 100) / 100 : 0),
      valueFormatter: (p) => safeMoney(p.value ?? 0, currency || 'USD'),
    },
    {
      headerName: '',
      width: 90,
      sortable: false,
      cellRenderer: (p: { data?: Row }) => (
        <button className="text-sm text-pp-muted hover:text-pp-danger" onClick={() => onChange(items.filter((_, i) => i !== p.data?.key))}>
          Remove
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wider ${missing ? 'text-pp-danger' : 'text-pp-muted'}`}>
          Line items{missing ? ' · each line needs a name, quantity and price' : ''}
        </span>
        <button className="text-sm font-semibold text-pp-blue hover:underline" onClick={() => onChange([...items, { name: '', quantity: 1, unitPrice: 0 }])}>
          + Add line
        </button>
      </div>
      <MunimGrid<Row>
        rows={rows}
        columns={columns}
        height={50 + 42 * Math.max(rows.length, 1)}
        getRowId={(p) => String(p.data.key)}
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        onCellValueChanged={(e) => {
          if (!e.data) return;
          const next = items.map((it, i) =>
            i === e.data.key ? { name: String(e.data.name ?? ''), quantity: Number(e.data.quantity) || 0, unitPrice: Number(e.data.unitPrice) || 0 } : it,
          );
          onChange(next);
        }}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  missing,
  className = '',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  missing?: boolean;
  className?: string;
  inputMode?: 'numeric';
}) {
  return (
    <label className={`block text-xs font-semibold uppercase tracking-wider ${missing ? 'text-pp-danger' : 'text-pp-muted'} ${className}`}>
      {label}
      {missing && <span className="ml-1 normal-case tracking-normal">· needed</span>}
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={missing}
        className={`mt-1 block h-10 w-full rounded border px-3 text-sm font-normal normal-case tracking-normal text-pp-ink outline-none focus:border-pp-blue ${missing ? 'border-pp-danger' : 'border-pp-border'}`}
      />
    </label>
  );
}
