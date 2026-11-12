// The invoice draft the owner edits on /inbox: its shape, what is still missing, and the PayPal
// payload it becomes. No server imports, so the browser uses the same checks as the API.

import { z } from 'zod';
import type { InvoicePayload } from '../paypal';

/** What the model returns for a message. Nullable rather than optional: structured output needs every key. */
export const extractionSchema = z.object({
  clientName: z.string().describe('Person or business being billed; empty string if not stated'),
  clientEmail: z.string().nullable().describe('Email to send the invoice to, only if it appears in the message'),
  company: z.string().nullable().describe("The client's business name, if different from or part of the client name"),
  currency: z.string().describe('ISO 4217 code: USD, INR, EUR, GBP...'),
  items: z.array(
    z.object({
      name: z.string().describe('Short professional English, e.g. "Logo design - 2 variations"'),
      quantity: z.number(),
      unitPrice: z.number().describe('Price per unit, in the invoice currency'),
    }),
  ),
  dueInDays: z.number().int().nullable().describe('Days from today until payment is due; null if the message gives no due date'),
  notes: z.string().describe('Short note to the client in English, or empty string'),
  confidence: z.number().describe('0 to 1: how sure you are that this draft matches what was agreed'),
  missingFields: z.array(z.string()).describe('Keys from this object that the message did not state, e.g. "clientEmail", "dueInDays"'),
});

export type Extraction = z.infer<typeof extractionSchema>;

export type InvoiceSource = 'chat' | 'email' | 'whatsapp';

export type FormItem = { name: string; quantity: number; unitPrice: number };

/** The editable draft. Same keys as the extraction, with everything the owner must fill in. */
export const formSchema = z.object({
  clientName: z.string(),
  clientEmail: z.string(),
  company: z.string(),
  currency: z.string(),
  items: z.array(z.object({ name: z.string(), quantity: z.number(), unitPrice: z.number() })),
  dueInDays: z.number().nullable(),
  notes: z.string(),
});

export type InvoiceForm = z.infer<typeof formSchema>;

export const FIELD_LABELS: Record<string, string> = {
  clientName: 'Client name',
  clientEmail: 'Client email',
  company: 'Company',
  currency: 'Currency',
  items: 'Line items',
  dueInDays: 'Due date',
  notes: 'Note',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field keys that block sending. "items" covers any line without a name, quantity or price. */
export function missingFields(f: InvoiceForm): string[] {
  const missing: string[] = [];
  if (!f.clientName.trim()) missing.push('clientName');
  if (!EMAIL.test(f.clientEmail.trim())) missing.push('clientEmail');
  if (!/^[A-Z]{3}$/.test(f.currency.trim().toUpperCase())) missing.push('currency');
  if (f.items.length === 0 || f.items.some((i) => !itemComplete(i))) missing.push('items');
  if (f.dueInDays === null || !Number.isFinite(f.dueInDays) || f.dueInDays < 0 || f.dueInDays > 120) missing.push('dueInDays');
  return missing;
}

export const itemComplete = (i: FormItem) => i.name.trim().length > 0 && i.quantity > 0 && i.unitPrice > 0;

export const formTotal = (f: Pick<InvoiceForm, 'items'>) => Math.round(f.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** From the model's extraction to the editable form: trimmed, rounded, nulls as empty strings. */
export function toForm(e: Extraction): InvoiceForm {
  return {
    clientName: e.clientName.trim(),
    clientEmail: (e.clientEmail ?? '').trim().toLowerCase(),
    company: (e.company ?? '').trim(),
    currency: e.currency.trim().toUpperCase(),
    items: e.items.map((i) => ({ name: i.name.trim(), quantity: round2(i.quantity), unitPrice: round2(i.unitPrice) })),
    dueInDays: e.dueInDays === null ? null : Math.round(e.dueInDays),
    notes: e.notes.trim(),
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The PayPal request body. invoice_date is the real today: PayPal schedules an invoice with a future
 * issue date instead of sending it, so the demo clock must not move it.
 */
export function toPayPalPayload(f: InvoiceForm, invoiceNumber: string | undefined): InvoicePayload {
  const today = new Date();
  const due = new Date(today.getTime() + (f.dueInDays ?? 0) * 86_400_000);
  const [given, ...rest] = f.clientName.trim().split(/\s+/);
  const company = f.company.trim();
  return {
    detail: {
      currency_code: f.currency.trim().toUpperCase(),
      invoice_number: invoiceNumber,
      invoice_date: isoDay(today),
      payment_term: { due_date: isoDay(due) },
      note: f.notes.trim() || undefined,
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: f.clientEmail.trim().toLowerCase(),
          name: { given_name: given, surname: rest.join(' ') || undefined },
          ...(company && { business_name: company }),
        },
      },
    ],
    items: f.items.map((i) => ({
      name: i.name.trim().slice(0, 200),
      quantity: String(i.quantity),
      unit_amount: { currency_code: f.currency.trim().toUpperCase(), value: i.unitPrice.toFixed(2) },
    })),
  };
}

export const SOURCE_PHRASE: Record<InvoiceSource, string> = {
  chat: 'a typed message',
  email: 'an email thread',
  whatsapp: 'a WhatsApp message',
};
