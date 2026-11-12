// Reads invoices from PayPal (the source of truth) and turns them into what Munim reasons about:
// each client's payment history and every open invoice with its age and risk.

import { daysBetween, isoDay } from '../clock';
import { amountOf, getInvoice, listInvoiceSummaries, type Invoice, type InvoiceStatus } from '../paypal';

// Open: money is still owed. Closed: settled or withdrawn. PAYMENT_PENDING (a payment in flight),
// drafts and refunds are neither, so Munim leaves them alone.
export const OPEN_STATUSES = new Set<InvoiceStatus>(['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED']);
export const CLOSED_STATUSES = new Set<InvoiceStatus>(['PAID', 'MARKED_AS_PAID', 'CANCELLED']);
export const PAID_STATUSES = new Set<InvoiceStatus>(['PAID', 'MARKED_AS_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'MARKED_AS_REFUNDED']);

export type ClientHistory = {
  email: string;
  name: string;
  company: string | null;
  /** prompt | slow | partial | unknown, as stored on ClientProfile.paymentStyle. */
  paymentStyle: 'prompt' | 'slow' | 'partial' | 'unknown';
  invoicesPaid: number;
  invoicesOpen: number;
  avgDaysLate: number | null;
  onTimeRate: number | null;
  outstanding: number;
};

export type OpenInvoice = {
  id: string;
  number: string;
  status: InvoiceStatus;
  clientEmail: string;
  clientName: string;
  currency: string;
  total: number;
  amountDue: number;
  invoiceDate: string | null;
  dueDate: string;
  daysOverdue: number; // negative = due in N days
  partialAllowed: boolean;
};

const emailOf = (inv: Invoice) => inv.primary_recipients?.[0]?.billing_info?.email_address?.toLowerCase() ?? 'unknown';
const nameOf = (inv: Invoice) => {
  const b = inv.primary_recipients?.[0]?.billing_info;
  return b?.business_name ?? b?.name?.full_name ?? ([b?.name?.given_name, b?.name?.surname].filter(Boolean).join(' ') || b?.email_address) ?? 'Unknown client';
};
const dueOf = (inv: Invoice) => inv.detail.payment_term?.due_date ?? inv.detail.invoice_date ?? null;

// A short in-memory cache: one collection run, the forecast and the assistant's tools often ask
// within seconds of each other.
let cache: { at: number; invoices: Invoice[] } | undefined;
const CACHE_MS = 20_000;

/**
 * Sync from PayPal: list every invoice (summaries), then fetch in full the open ones (to act on)
 * and the paid ones (their payment dates are how Munim learns how late each client pays).
 */
/** Forget the cached invoices, e.g. when a webhook says one changed. */
export const invalidateInvoices = () => {
  cache = undefined;
};

export async function fetchInvoices(fresh = false): Promise<Invoice[]> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.invoices;
  const summaries = await listInvoiceSummaries();
  const needsDetail = (i: Invoice) => OPEN_STATUSES.has(i.status) || PAID_STATUSES.has(i.status);
  const invoices = await Promise.all(summaries.map((i) => (needsDetail(i) ? getInvoice(i.id) : i)));
  cache = { at: Date.now(), invoices };
  return invoices;
}

/**
 * Maps a payment date onto Munim's clock: a payment made today (in real time) happened "today" for
 * Munim too, even when the demo clock is ahead. Older payments keep their real dates.
 */
export type ClockMap = { realToday: string; munimToday: string };
export const onMunimClock = (date: string, clock?: ClockMap) => (clock && date >= clock.realToday ? clock.munimToday : date);

export function clientHistories(invoices: Invoice[], clock?: ClockMap): ClientHistory[] {
  const byEmail = new Map<
    string,
    { name: string; company: string | null; lateness: number[]; open: number; outstanding: number; partial: boolean }
  >();
  for (const inv of invoices) {
    const email = emailOf(inv);
    const company = inv.primary_recipients?.[0]?.billing_info?.business_name ?? null;
    const entry = byEmail.get(email) ?? { name: nameOf(inv), company, lateness: [], open: 0, outstanding: 0, partial: false };
    if (inv.status === 'PARTIALLY_PAID') entry.partial = true;
    byEmail.set(email, entry);
    if (OPEN_STATUSES.has(inv.status)) {
      entry.open += 1;
      entry.outstanding += amountOf(inv.due_amount);
    }
    const due = dueOf(inv);
    const lastPayment = inv.payments?.transactions
      ?.map((t) => t.payment_date)
      .filter(Boolean)
      .sort()
      .at(-1);
    if (PAID_STATUSES.has(inv.status) && due && lastPayment) entry.lateness.push(daysBetween(due, onMunimClock(lastPayment.slice(0, 10), clock)));
  }
  return [...byEmail.entries()].map(([email, e]) => {
    const avgDaysLate = e.lateness.length ? Math.round((e.lateness.reduce((s, d) => s + d, 0) / e.lateness.length) * 10) / 10 : null;
    const paymentStyle: ClientHistory['paymentStyle'] = e.partial
      ? 'partial'
      : avgDaysLate === null
        ? 'unknown'
        : avgDaysLate > 5
          ? 'slow'
          : 'prompt';
    return {
      email,
      name: e.name,
      company: e.company,
      paymentStyle,
      invoicesPaid: e.lateness.length,
      invoicesOpen: e.open,
      avgDaysLate,
      onTimeRate: e.lateness.length ? Math.round((e.lateness.filter((d) => d <= 0).length / e.lateness.length) * 100) / 100 : null,
      outstanding: Math.round(e.outstanding * 100) / 100,
    };
  });
}

export function openInvoices(invoices: Invoice[], today: Date): OpenInvoice[] {
  const day = isoDay(today);
  return invoices
    .filter((inv) => OPEN_STATUSES.has(inv.status))
    .map((inv) => {
      const dueDate = dueOf(inv) ?? day;
      return {
        id: inv.id,
        number: inv.detail.invoice_number,
        status: inv.status,
        clientEmail: emailOf(inv),
        clientName: nameOf(inv),
        currency: inv.detail.currency_code,
        total: amountOf(inv.amount),
        amountDue: amountOf(inv.due_amount) || amountOf(inv.amount),
        invoiceDate: inv.detail.invoice_date ?? null,
        dueDate,
        daysOverdue: daysBetween(dueDate, day),
        partialAllowed: Boolean(
          (inv as unknown as { configuration?: { partial_payment?: { allow_partial_payment?: boolean } } }).configuration?.partial_payment
            ?.allow_partial_payment,
        ),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}
