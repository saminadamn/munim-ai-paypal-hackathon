// What happens when money arrives (or an invoice goes away) in PayPal. Three paths reach this:
//   - the PayPal webhook (app/api/webhooks/paypal), the fast path;
//   - the "Sync from PayPal" button, the fallback when a webhook is missed;
//   - every collections run, which reconciles before it decides anything.
// Each is safe to repeat: a payment is recorded once per paid amount, a cancellation once.

import { daysBetween, isoDay, now } from '../clock';
import { db } from '../db';
import { formatMoney } from '../format';
import { amountOf, getInvoice, type Invoice, type InvoiceStatus } from '../paypal';
import { actionLabel, type ActionPayload } from './action-payload';
import { clientHistories, fetchInvoices, invalidateInvoices, onMunimClock, type ClockMap } from './receivables';

async function clockMap(): Promise<ClockMap> {
  return { realToday: isoDay(new Date()), munimToday: isoDay(await now()) };
}

const PAID: InvoiceStatus[] = ['PAID', 'MARKED_AS_PAID', 'PARTIALLY_PAID'];
const CLOSED: InvoiceStatus[] = ['PAID', 'MARKED_AS_PAID', 'CANCELLED', 'REFUNDED', 'MARKED_AS_REFUNDED'];
const REMINDERS = ['gentle_reminder', 'firm_reminder', 'offer_partial'];

const recipient = (inv: Invoice) => {
  const b = inv.primary_recipients?.[0]?.billing_info;
  return { email: b?.email_address?.toLowerCase() ?? 'unknown', name: b?.business_name ?? b?.name?.full_name ?? b?.email_address ?? 'The client' };
};
const money = (n: number, c: string) => formatMoney(n, c, { code: true });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Client profiles from PayPal history: new recipients get a profile; known clients get their
 * lateness and payment style refreshed once they have history. Names and notes stay as the owner set them.
 */
export async function refreshClientProfiles(invoices: Invoice[], onlyEmail?: string) {
  const known = new Set((await db.clientProfile.findMany({ select: { email: true } })).map((c) => c.email));
  let added = 0;
  const clock = await clockMap();
  for (const h of clientHistories(invoices, clock)) {
    if (h.email === 'unknown' || (onlyEmail && h.email !== onlyEmail)) continue;
    if (!known.has(h.email)) {
      await db.clientProfile.create({ data: { email: h.email, name: h.name, company: h.company, avgDaysLate: h.avgDaysLate ?? 0, paymentStyle: h.paymentStyle } });
      added++;
    } else if (h.invoicesPaid > 0 || h.paymentStyle === 'partial') {
      await db.clientProfile.update({ where: { email: h.email }, data: { avgDaysLate: h.avgDaysLate ?? 0, paymentStyle: h.paymentStyle } });
    }
  }
  return added;
}

/** Queued actions on an invoice that is no longer open are withdrawn, so nobody approves a reminder for a paid invoice. */
async function withdrawPending(invoiceId: string, why: string) {
  const { count } = await db.agentAction.updateMany({
    where: { paypalInvoiceId: invoiceId, status: 'proposed' },
    data: { status: 'skipped', guardrail: `invoice_closed: ${why}` },
  });
  return count;
}

/** "Acme paid INV-0007, 3 days after the firm reminder." */
async function paymentReason(inv: Invoice, paidOn: string, paid: number, partial: boolean) {
  const { name } = recipient(inv);
  const number = inv.detail.invoice_number;
  const what = partial ? `${money(paid, inv.detail.currency_code)} of ${number} (part-payment)` : number;
  const lastReminder = await db.agentAction.findFirst({
    where: { paypalInvoiceId: inv.id, status: 'executed', actionType: { in: REMINDERS } },
    orderBy: { executedAt: 'desc' },
  });
  if (lastReminder?.executedAt) {
    const days = daysBetween(onMunimClock(isoDay(lastReminder.executedAt), await clockMap()), paidOn);
    const label = actionLabel(lastReminder.actionType).toLowerCase();
    return { text: `${name} paid ${what}, ${days <= 0 ? `the same day as the ${label}` : `${plural(days, 'day')} after the ${label}`}.`, daysAfterReminder: days };
  }
  const due = inv.detail.payment_term?.due_date;
  if (!due) return { text: `${name} paid ${what}.`, daysAfterReminder: null };
  const late = daysBetween(due, paidOn);
  return {
    text: `${name} paid ${what} ${late < 0 ? `${plural(-late, 'day')} before the due date` : late === 0 ? 'on the due date' : `${plural(late, 'day')} after the due date`}, without a reminder.`,
    daysAfterReminder: null,
  };
}

export type Reconciled = { payments: string[]; cancelled: string[]; withdrawn: number };

/**
 * Records what PayPal says happened to one invoice. `inv` must be the full invoice (getInvoice), not a summary.
 */
export async function reconcileInvoice(inv: Invoice, source: 'webhook' | 'sync' | 'run', eventId?: string): Promise<Reconciled> {
  const out: Reconciled = { payments: [], cancelled: [], withdrawn: 0 };
  const { email, name } = recipient(inv);
  const currency = inv.detail.currency_code;

  if (PAID.includes(inv.status)) {
    const paid = amountOf(inv.payments?.paid_amount);
    // One record per paid amount: a part-payment and the final payment are two events; a repeat is none.
    const paymentKey = `${inv.id}:${paid.toFixed(2)}`;
    const already = await db.agentAction.findFirst({ where: { paypalInvoiceId: inv.id, actionType: 'payment_received', payload: { path: ['paymentKey'], equals: paymentKey } } });
    if (!already && paid > 0) {
      const paidReal = (inv.payments?.transactions?.map((t) => t.payment_date).filter(Boolean).sort().at(-1) ?? new Date().toISOString()).slice(0, 10);
      // Against Munim's clock, so the reason matches the overdue days the owner has been seeing.
      const paidOn = onMunimClock(paidReal, await clockMap());
      const partial = inv.status === 'PARTIALLY_PAID';
      const reason = await paymentReason(inv, paidOn, paid, partial);
      await db.agentAction.create({
        data: {
          paypalInvoiceId: inv.id,
          invoiceNumber: inv.detail.invoice_number,
          actionType: 'payment_received',
          status: 'executed',
          reason: reason.text,
          payload: {
            clientName: name,
            clientEmail: email,
            amountDue: paid,
            currency,
            decidedBy: source,
            result: { status: inv.status, paidOn, daysAfterReminder: reason.daysAfterReminder, eventId: eventId ?? null },
            paymentKey,
          } as ActionPayload as object,
          executedAt: new Date(),
        },
      });
      out.payments.push(reason.text);
    }
  }

  if (inv.status === 'CANCELLED') {
    const already = await db.agentAction.findFirst({ where: { paypalInvoiceId: inv.id, actionType: 'invoice_cancelled' } });
    if (!already) {
      await db.agentAction.create({
        data: {
          paypalInvoiceId: inv.id,
          invoiceNumber: inv.detail.invoice_number,
          actionType: 'invoice_cancelled',
          status: 'executed',
          reason: `${inv.detail.invoice_number} for ${name} was cancelled in PayPal, so Munim stops chasing it.`,
          payload: { clientName: name, clientEmail: email, amountDue: amountOf(inv.amount), currency, decidedBy: source, result: { eventId: eventId ?? null } } as ActionPayload as object,
          executedAt: new Date(),
        },
      });
      out.cancelled.push(inv.detail.invoice_number);
    }
  }

  if (CLOSED.includes(inv.status)) out.withdrawn += await withdrawPending(inv.id, `PayPal shows it as ${inv.status.toLowerCase().replaceAll('_', ' ')}`);
  return out;
}

/** Reconciles every invoice Munim has touched (created, reminded or queued). Used by Sync and by each run. */
export async function reconcileAll(invoices: Invoice[], source: 'sync' | 'run'): Promise<Reconciled> {
  const [metas, acted] = await Promise.all([
    db.invoiceMeta.findMany({ select: { paypalId: true } }),
    db.agentAction.findMany({ distinct: ['paypalInvoiceId'], select: { paypalInvoiceId: true } }),
  ]);
  const touched = new Set([...metas.map((m) => m.paypalId), ...acted.map((a) => a.paypalInvoiceId)]);
  const total: Reconciled = { payments: [], cancelled: [], withdrawn: 0 };
  for (const inv of invoices) {
    if (!touched.has(inv.id) || !(PAID.includes(inv.status) || CLOSED.includes(inv.status))) continue;
    // Cancelled invoices come back from sync as summaries; payments need the full invoice.
    const full = inv.payments || inv.status === 'CANCELLED' ? inv : await getInvoice(inv.id);
    const r = await reconcileInvoice(full, source);
    total.payments.push(...r.payments);
    total.cancelled.push(...r.cancelled);
    total.withdrawn += r.withdrawn;
  }
  return total;
}

/** The "Sync from PayPal" button: fresh invoices, client profiles, and any payment a webhook missed. */
export async function syncFromPayPal() {
  invalidateInvoices();
  const invoices = await fetchInvoices(true);
  const added = await refreshClientProfiles(invoices);
  const r = await reconcileAll(invoices, 'sync');
  const parts = [
    `Synced ${plural(invoices.length, 'invoice')} from PayPal`,
    added ? `${plural(added, 'new client')}` : null,
    r.payments.length ? `${plural(r.payments.length, 'new payment')} recorded` : 'no new payments',
    r.cancelled.length ? `${plural(r.cancelled.length, 'cancellation')}` : null,
    r.withdrawn ? `${plural(r.withdrawn, 'queued action')} withdrawn` : null,
  ].filter(Boolean);
  return { summary: `${parts.join(', ')}.`, ...r };
}

/** A verified webhook event. Always re-reads the invoice from PayPal rather than trusting the payload. */
export async function handleInvoiceEvent(event: { id: string; event_type: string; resource?: Record<string, unknown> }) {
  const resource = event.resource ?? {};
  const invoiceId = ((resource.invoice as { id?: string } | undefined)?.id ?? (resource.id as string | undefined)) || null;
  if (!invoiceId) return { handled: false, note: 'no invoice id in the event' };
  invalidateInvoices();
  const inv = await getInvoice(invoiceId);

  if (event.event_type === 'INVOICING.INVOICE.UPDATED' && !CLOSED.includes(inv.status) && !PAID.includes(inv.status)) {
    return { handled: true, note: `${inv.detail.invoice_number} updated; nothing to record` };
  }
  const r = await reconcileInvoice(inv, 'webhook', event.id);
  if (r.payments.length) {
    // The client's lateness and payment style change with each payment.
    await refreshClientProfiles(await fetchInvoices(true), recipient(inv).email);
  }
  return { handled: true, note: [...r.payments, ...r.cancelled.map((n) => `${n} cancelled`), r.withdrawn ? `${r.withdrawn} queued withdrawn` : ''].filter(Boolean).join(' ') || 'already recorded' };
}

