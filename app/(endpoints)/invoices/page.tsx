import type { Metadata } from 'next';
import { connection } from 'next/server';
import { daysBetween, isoDay, now } from '@/lib/clock';
import { formatMoney } from '@/lib/format';
import { db, dbEnabled } from '@/lib/db';
import { actionLabel, payloadOf } from '@/lib/munim/action-payload';
import { OPEN_STATUSES } from '@/lib/munim/receivables';
import { amountOf, listInvoices, type Invoice } from '@/lib/paypal';
import { EndpointPage } from '../endpoint-page';
import type { RowDetail, TimelineEvent } from '../row-detail-panel';

export const metadata: Metadata = { title: 'Invoices' };

const SOURCE_LABEL: Record<string, string> = { chat: 'Typed', email: 'Email', whatsapp: 'WhatsApp', manual: 'Manual', paypal: 'PayPal' };

type Meta = { source: string; remindersSent: number; lastReminderAt: Date | null; allowPartial: boolean; createdAt: Date; rawInput: string | null };
type Action = Awaited<ReturnType<typeof db.agentAction.findMany>>[number];

function timeline(inv: Invoice, meta: Meta | undefined, actions: Action[], today: string): RowDetail {
  const money = (n: number) => formatMoney(n, inv.detail.currency_code);
  const events: TimelineEvent[] = [];
  const md = (inv.detail as { metadata?: { first_sent_time?: string } }).metadata;

  if (inv.detail.invoice_date) events.push({ at: inv.detail.invoice_date, label: 'Invoice dated', by: 'PayPal', tone: 'muted' });
  if (md?.first_sent_time) events.push({ at: md.first_sent_time, label: 'Sent to the client', by: 'PayPal' });
  for (const a of actions) {
    // "No action" rows only matter when code held back something the model proposed.
    if (a.actionType === 'none' && !a.guardrail) continue;
    const p = payloadOf(a);
    events.push({
      at: (a.executedAt ?? a.createdAt).toISOString(),
      label: `${actionLabel(a.actionType)} · ${a.status}`,
      detail: [a.reason, a.guardrail && `Guardrail: ${a.guardrail}`, p.error && `Error: ${p.error}`].filter(Boolean).join(' '),
      by: a.actionType === 'create_invoice' ? 'Munim, approved by you' : 'Munim',
      tone: a.status === 'failed' ? 'danger' : a.status === 'proposed' ? 'warning' : a.status === 'skipped' ? 'muted' : 'normal',
    });
  }
  for (const t of inv.payments?.transactions ?? [])
    if (t.payment_date) events.push({ at: t.payment_date, label: `Payment of ${money(amountOf(t.amount))}`, detail: t.method ? `By ${t.method.toLowerCase().replaceAll('_', ' ')}` : undefined, by: 'PayPal', tone: 'success' });
  const due = inv.detail.payment_term?.due_date;
  if (due && OPEN_STATUSES.has(inv.status)) events.push({ at: due, label: due < today ? 'Was due' : 'Due', tone: due < today ? 'danger' : 'muted', future: due > today });

  const recipient = inv.primary_recipients?.[0]?.billing_info;
  return {
    title: `Invoice ${inv.detail.invoice_number}`,
    subtitle: [recipient?.business_name ?? recipient?.name?.full_name, recipient?.email_address].filter(Boolean).join(' · '),
    facts: [
      ['Status', inv.status.replaceAll('_', ' ').toLowerCase()],
      ['Due', money(amountOf(inv.due_amount))],
      ['Source', SOURCE_LABEL[meta?.source ?? 'paypal'] ?? meta?.source ?? 'PayPal'],
      ['Reminders sent', String(meta?.remindersSent ?? 0)],
      ...(meta?.allowPartial ? ([['Part-payment', 'allowed']] as [string, string][]) : []),
    ],
    events: events.sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export default async function InvoicesPage() {
  await connection();
  const [invoices, today] = await Promise.all([listInvoices(), now()]);
  const day = isoDay(today);

  // Munim's own records for these invoices: provenance, reminder counts and every action taken.
  const ids = invoices.map((i) => i.id);
  const [metas, actions] = dbEnabled()
    ? await Promise.all([
        db.invoiceMeta.findMany({ where: { paypalId: { in: ids } } }),
        db.agentAction.findMany({ where: { paypalInvoiceId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
      ])
    : [[], []];
  const metaById = new Map(metas.map((m) => [m.paypalId, m]));

  return (
    <EndpointPage
      title="Invoices"
      calls={['GET /v2/invoicing/invoices', 'GET /v2/invoicing/invoices/{id}']}
      source="listInvoices()"
      note={`The list endpoint omits line items, payments and refunds, so each invoice is then fetched in full. Amounts are in the invoice's own currency. Days overdue are counted to ${day} (Munim's clock); click a row for its timeline.`}
      rows={invoices.map((inv) => {
        const recipient = inv.primary_recipients?.[0]?.billing_info;
        const meta = metaById.get(inv.id);
        const due = inv.detail.payment_term?.due_date;
        return {
          id: inv.id,
          number: inv.detail.invoice_number,
          status: inv.status,
          recipient: recipient?.business_name ?? recipient?.name?.full_name,
          email: recipient?.email_address,
          invoiceDate: inv.detail.invoice_date,
          dueDate: due,
          daysOverdue: OPEN_STATUSES.has(inv.status) && due ? Math.max(0, daysBetween(due, day)) : null,
          remindersSent: meta?.remindersSent ?? 0,
          source: SOURCE_LABEL[meta?.source ?? 'paypal'] ?? meta?.source,
          total: amountOf(inv.amount),
          paid: amountOf(inv.payments?.paid_amount),
          due: amountOf(inv.due_amount),
          lineItems: inv.items?.length ?? 0,
          currency: inv.detail.currency_code,
        };
      })}
      columns={[
        { field: 'number', headerName: 'Invoice' },
        { field: 'status', headerName: 'Status' },
        { field: 'recipient', headerName: 'Recipient' },
        { field: 'email', headerName: 'Email' },
        { field: 'invoiceDate', headerName: 'Invoice date', cellDataType: 'dateString' },
        { field: 'dueDate', headerName: 'Due date', cellDataType: 'dateString' },
        { field: 'daysOverdue', headerName: 'Days overdue', filter: 'agNumberColumnFilter' },
        { field: 'remindersSent', headerName: 'Reminders sent', filter: 'agNumberColumnFilter' },
        { field: 'source', headerName: 'Source' },
        { field: 'total', headerName: 'Total', type: 'money' },
        { field: 'paid', headerName: 'Paid', type: 'money' },
        { field: 'due', headerName: 'Due', type: 'money' },
        { field: 'lineItems', headerName: 'Line items' },
        { field: 'currency', headerName: 'Currency' },
        { field: 'id', headerName: 'Invoice ID' },
      ]}
      details={Object.fromEntries(
        invoices.map((inv) => [inv.id, timeline(inv, metaById.get(inv.id), actions.filter((a) => a.paypalInvoiceId === inv.id), day)]),
      )}
    />
  );
}
