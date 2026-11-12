'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { decide, syncNow } from '../_ui/actions';
import { paypalErrorToast, toast } from '@/app/components/toaster';
import { relativeDue, timeAgo } from '@/lib/format';
import { MunimGrid } from '../_ui/grid';
import { Button, Card, money } from '../_ui/ui';

export type InvoiceRow = {
  id: string;
  number: string;
  client: string;
  currency: string;
  amountDue: number;
  dueDate: string;
  daysOverdue: number;
  risk: 'low' | 'medium' | 'high';
  rules: string;
  reminders: number;
  lastAction: string;
};

export type QueueItem = {
  id: string;
  actionType: string;
  label: string;
  invoice: string;
  client: string;
  amount: string;
  partialMinimum: string | null;
  daysOverdue: number;
  risk: string | null;
  reason: string;
  guardrail: string | null;
  subject: string;
  message: string;
};

export type ActivityRow = {
  id: string;
  at: string;
  invoice: string;
  client: string;
  action: string;
  proposed: string;
  status: string;
  guardrail: string;
  reason: string;
  error: string;
  debugId: string;
  decidedBy: string;
};

// --- Badges ---------------------------------------------------------------------------

const TONES = {
  blue: 'border-pp-blue text-pp-blue',
  green: 'border-pp-success text-pp-success',
  amber: 'border-pp-warning text-pp-warning',
  red: 'border-pp-danger text-pp-danger',
  grey: 'border-pp-border text-pp-muted',
};

function Badge({ tone, children, title }: { tone: keyof typeof TONES; children: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-px text-xs font-semibold leading-5 ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, keyof typeof TONES> = { executed: 'green', approved: 'blue', proposed: 'amber', failed: 'red', skipped: 'grey' };
const STATUS_TEXT: Record<string, string> = { executed: 'executed', approved: 'approved', proposed: 'waiting for you', failed: 'failed', skipped: 'skipped' };
const RISK_TONE: Record<string, keyof typeof TONES> = { high: 'red', medium: 'amber', low: 'grey' };
const GUARD_TONE: Record<string, keyof typeof TONES> = {
  over_limit: 'amber',
  approval_needed: 'amber',
  max_reminders: 'grey',
  too_soon: 'grey',
  quiet_weekend: 'grey',
  paypal_daily_limit: 'grey',
  not_due: 'grey',
  not_sent_yet: 'grey',
  first_reminder_gentle: 'blue',
  partial_already_on: 'blue',
  message_rewritten: 'blue',
  rejected_by_owner: 'grey',
  invoice_closed: 'green',
  requested_in_assistant: 'blue',
};

/** "code: text; code: text" -> badges with the text as a tooltip. */
const parseGuardrails = (s: string) =>
  s
    .split('; ')
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(': ');
      return i > 0 ? { code: part.slice(0, i), text: part.slice(i + 2) } : { code: part, text: part };
    });

const StatusCell = (p: ICellRendererParams<ActivityRow>) => (p.value ? <Badge tone={STATUS_TONE[p.value] ?? 'grey'}>{STATUS_TEXT[p.value] ?? p.value}</Badge> : null);

const GuardrailCell = (p: ICellRendererParams<ActivityRow>) => (
  <span className="flex flex-wrap items-center gap-1">
    {parseGuardrails(p.value ?? '').map((g) => (
      <Badge key={g.code} tone={GUARD_TONE[g.code] ?? 'grey'} title={g.text}>
        {g.code.replaceAll('_', ' ')}
      </Badge>
    ))}
  </span>
);

const RiskCell = (p: ICellRendererParams<InvoiceRow>) => (p.value ? <Badge tone={RISK_TONE[p.value] ?? 'grey'}>{p.value}</Badge> : null);

// --- Run Munim, streamed ---------------------------------------------------------------

type LogLine = { type: string; message: string; status?: string };

export function RunPanel({ lastSummary, lastFailed }: { lastSummary: string | null; lastFailed: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [pending, start] = useTransition();
  const [synced, setSynced] = useState<{ summary: string; payments: string[]; failed: boolean } | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  const run = async () => {
    setRunning(true);
    setLines([]);
    try {
      const res = await fetch('/api/munim/run/stream', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Server-sent events are separated by a blank line; each carries one JSON `data:` line.
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const e of events) {
          const data = e.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const event = JSON.parse(data.slice(6)) as LogLine;
          setLines((ls) => [...ls, event]);
          if (event.type === 'error') toast({ tone: 'error', title: 'Munim run failed', message: event.message });
          requestAnimationFrame(() => logRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }));
        }
      }
    } catch (e) {
      setLines((ls) => [...ls, { type: 'error', message: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  const busy = running || pending;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={busy}>
          {running ? 'Munim is working…' : 'Run Munim'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setLines([]);
              const r = await syncNow();
              setSynced(r);
              if (r.failed) paypalErrorToast('Sync from PayPal failed', { error: r.summary, debugId: r.debugId });
              else if (r.payments.length) toast({ tone: 'success', title: `${r.payments.length} payment${r.payments.length === 1 ? '' : 's'} recorded`, message: r.payments[0] });
            })
          }
        >
          {pending ? 'Syncing…' : 'Sync from PayPal'}
        </Button>
        <span className="text-xs text-pp-muted">Use Sync if a payment hasn&apos;t shown up; webhooks normally record it within seconds.</span>
      </div>
      {lines.length > 0 ? (
        <ol ref={logRef} className="mt-4 max-h-72 space-y-1.5 overflow-y-auto rounded border border-pp-border bg-pp-canvas p-4 text-sm" aria-live="polite">
          {lines.map((l, i) => (
            <li
              key={i}
              className={
                l.type === 'error' ? 'text-pp-danger' : l.type === 'done' ? 'pt-2 font-semibold text-pp-navy' : l.status === 'proposed' ? 'text-pp-warning' : l.status === 'failed' ? 'text-pp-danger' : l.type === 'action' ? 'text-pp-ink' : 'text-pp-muted'
              }
            >
              {l.message}
            </li>
          ))}
          {running && <li className="text-pp-muted">…</li>}
        </ol>
      ) : synced ? (
        <div className={`mt-3 text-sm ${synced.failed ? 'text-pp-danger' : 'text-pp-ink'}`}>
          <p>{synced.summary}</p>
          {synced.payments.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-pp-success">
              {synced.payments.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className={`mt-3 text-sm ${lastFailed ? 'text-pp-danger' : 'text-pp-muted'}`}>
          {lastSummary ?? 'Munim has not run yet. Press Run Munim, or let the hourly job do it.'}
        </p>
      )}
    </Card>
  );
}

// --- Approval queue ---------------------------------------------------------------------

export function ApprovalQueue({ items }: { items: QueueItem[] }) {
  return (
    <Card title={`Waiting for your approval (${items.length})`}>
      <ul className="divide-y divide-pp-border">
        {items.map((item) => (
          <QueueCard key={item.id} item={item} />
        ))}
      </ul>
    </Card>
  );
}

function QueueCard({ item }: { item: QueueItem }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(item.subject);
  const [message, setMessage] = useState(item.message);
  const sends = item.actionType !== 'escalate_to_owner';
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  const guard = parseGuardrails(item.guardrail ?? '')[0];

  const act = (decision: 'approve' | 'reject') =>
    start(async () => {
      const edited = editing && (subject !== item.subject || message !== item.message);
      const r = await decide(item.id, decision, edited ? { subject, message } : undefined);
      if (r.status === 'failed') paypalErrorToast(`${item.invoice}: PayPal refused it`, r);
      else if (r.status === 'executed') toast({ tone: 'success', title: `${item.label} done`, message: `${item.invoice} · ${item.client}` });
      else if (r.status === 'skipped' && decision === 'approve') toast({ tone: 'info', title: `${item.invoice}: nothing sent`, message: r.guardrail?.split('; ')[0]?.split(': ')[1] ?? 'A guardrail stopped it.' });
    });

  return (
    <li className="py-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-pp-ink">{item.label}</span>
        <span className="text-sm text-pp-muted">
          {item.invoice} · {item.client} · {item.amount}
          {` · ${relativeDue(item.daysOverdue)}`}
        </span>
        {item.risk && <Badge tone={RISK_TONE[item.risk] ?? 'grey'}>{`${item.risk} risk`}</Badge>}
      </div>
      <p className="mt-1 text-sm text-pp-ink">{item.reason}</p>
      {guard && <p className="mt-1 text-xs text-pp-muted">Waiting for you because {guard.text}.</p>}

      {item.actionType === 'offer_partial' && (
        <p className="mt-2 rounded bg-pp-highlight px-3 py-2 text-sm text-pp-navy">
          On approval Munim turns on part-payment (at least {item.partialMinimum}) and sends this message. If PayPal won&apos;t change the sent invoice, Munim
          cancels it and reissues the same items as a new invoice that allows part-payment. It never reissues an invoice that already has payments.
        </p>
      )}

      {sends &&
        (editing ? (
          <div className="mt-3 grid gap-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-label="Subject"
              className="h-10 rounded border border-pp-border px-3 text-sm outline-none focus:border-pp-blue"
            />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              aria-label="Message"
              className="rounded border border-pp-border p-3 text-sm outline-none focus:border-pp-blue"
            />
            <span className={`text-xs ${words > 80 ? 'text-pp-warning' : 'text-pp-muted'}`}>{words} words</span>
          </div>
        ) : (
          <div className="mt-3 rounded border border-pp-border bg-pp-canvas p-3 text-sm">
            <div className="font-semibold">{subject}</div>
            <p className="mt-1 whitespace-pre-wrap">{message}</p>
          </div>
        ))}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={pending || (sends && (!subject.trim() || !message.trim()))} onClick={() => act('approve')}>
          {pending ? 'Working…' : sends ? (editing ? 'Approve edited message' : 'Approve') : "Approve: I'll call them"}
        </Button>
        {sends && (
          <Button variant="secondary" disabled={pending} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Stop editing' : 'Edit'}
          </Button>
        )}
        <Button variant="secondary" disabled={pending} onClick={() => act('reject')}>
          Reject
        </Button>
      </div>
    </li>
  );
}

// --- Grids ----------------------------------------------------------------------------------

const INVOICE_COLUMNS: ColDef<InvoiceRow>[] = [
  { field: 'number', headerName: 'Invoice', width: 110 },
  { field: 'client', headerName: 'Client', width: 170 },
  { field: 'amountDue', headerName: 'Due', width: 120, valueFormatter: (p) => (p.data ? money(p.data.amountDue, p.data.currency) : '') },
  { field: 'dueDate', headerName: 'Due date', width: 115 },
  {
    field: 'daysOverdue',
    headerName: 'Timing',
    width: 130,
    sort: 'desc',
    valueFormatter: (p) => (typeof p.value === 'number' ? relativeDue(p.value) : ''),
  },
  { field: 'risk', headerName: 'Risk', width: 100, cellRenderer: RiskCell },
  { field: 'rules', headerName: 'Rules hit', flex: 1, minWidth: 260, tooltipField: 'rules' },
  { field: 'reminders', headerName: 'Reminders', width: 110 },
  { field: 'lastAction', headerName: 'Last action', width: 200 },
];

export function OpenInvoicesGrid({ rows }: { rows: InvoiceRow[] }) {
  return rows.length === 0 ? (
    <p className="text-sm text-pp-muted">No open invoices. Create one from the Inbox.</p>
  ) : (
    <MunimGrid<InvoiceRow> rows={rows} columns={INVOICE_COLUMNS} height={Math.min(480, 50 + rows.length * 42)} />
  );
}

const ACTIVITY_COLUMNS: ColDef<ActivityRow>[] = [
  { field: 'at', headerName: 'When', width: 130, sort: 'desc', valueFormatter: (p) => (p.value ? timeAgo(String(p.value)) : ''), tooltipValueGetter: (p) => (p.value ? `${String(p.value).replace('T', ' ').slice(0, 16)} UTC` : '') },
  { field: 'invoice', headerName: 'Invoice', width: 105 },
  { field: 'client', headerName: 'Client', width: 150 },
  { field: 'action', headerName: 'Action', width: 160, tooltipValueGetter: (p) => (p.data?.proposed ? `Model proposed: ${p.data.proposed}` : undefined) },
  { field: 'status', headerName: 'Status', width: 140, cellRenderer: StatusCell },
  { field: 'guardrail', headerName: 'Guardrail', width: 230, cellRenderer: GuardrailCell, tooltipField: 'guardrail' },
  { field: 'reason', headerName: 'Reason', flex: 1, minWidth: 280, tooltipField: 'reason' },
  { field: 'error', headerName: 'Error', width: 180, tooltipField: 'error' },
  { field: 'debugId', headerName: 'PayPal debug ID', width: 160 },
  { field: 'decidedBy', headerName: 'Decided by', width: 110 },
];

export function ActivityGrid({ rows }: { rows: ActivityRow[] }) {
  const [search, setSearch] = useState('');
  return rows.length === 0 ? (
    <p className="text-sm text-pp-muted">Nothing yet. Press Run Munim.</p>
  ) : (
    <div className="grid gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter: invoice, client, status, guardrail…"
        aria-label="Filter the activity log"
        className="h-10 w-80 rounded border border-pp-border px-3 text-sm outline-none focus:border-pp-blue"
      />
      <MunimGrid<ActivityRow> rows={rows} columns={ACTIVITY_COLUMNS} height={Math.min(520, 50 + rows.length * 42)} quickFilterText={search} getRowId={(p) => p.data.id} />
    </div>
  );
}
