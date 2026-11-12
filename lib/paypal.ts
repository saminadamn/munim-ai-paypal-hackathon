// PayPal REST client: every call this demo makes to PayPal goes through here. It covers
// catalog products, billing plans, invoicing, Transaction Search and balances, with plain
// fetch and no SDK. Server-side only: it reads the client secret from the environment.

const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
    readonly debugId: string | null = null,
  ) {
    super(`PayPal ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = 'PayPalApiError';
  }
}

let cachedToken: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set (see .env.local)');

  const started = Date.now();
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  await logCall('POST', '/v1/oauth2/token', res.status, Date.now() - started, res.headers.get('paypal-debug-id'));
  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());

  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so an in-flight request never carries an expired token.
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

// Every call, the OAuth token included, writes an ApiLog row (method, path, status, ms, debug_id).
// The write is awaited so the Developer page sees it straight away, but a logging failure never
// fails the PayPal call; without a database it is skipped.
async function logCall(method: string, path: string, status: number, ms: number, debugId: string | null) {
  if (!process.env.DATABASE_URL) return;
  try {
    const { db } = await import('./db');
    await db.apiLog.create({ data: { method, path: path.slice(0, 500), status, ms, debugId } });
  } catch (e) {
    console.error('[ApiLog] write failed', e);
  }
}

type RequestOptions = { body?: unknown; headers?: Record<string, string>; idempotencyKey?: string };
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** One PayPal response as received, before any retry decision: for the Developer page's test. */
export type PayPalResponse<T> = { status: number; ms: number; debugId: string | null; body: T | string };

async function requestOnce<T>(method: Method, path: string, options: RequestOptions): Promise<PayPalResponse<T>> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
      // Lets PayPal de-duplicate a retried write instead of, say, sending a reminder twice.
      ...(options.idempotencyKey && { 'PayPal-Request-Id': options.idempotencyKey }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });
  const ms = Date.now() - started;
  const debugId = res.headers.get('paypal-debug-id');
  await logCall(method, path, res.status, ms, debugId);
  const text = await res.text();
  if (!res.ok) return { status: res.status, ms, debugId, body: text };
  return { status: res.status, ms, debugId, body: (text ? JSON.parse(text) : {}) as T };
}

async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestMeta<T>(method, path, options)).body;
}

/** As request(), also returning PayPal's debug id, which Munim records on each action it takes. */
async function requestMeta<T>(method: Method, path: string, options: RequestOptions = {}): Promise<{ body: T; debugId: string | null }> {
  for (let attempt = 1; ; attempt++) {
    const res = await requestOnce<T>(method, path, options);
    if (res.status >= 200 && res.status < 300) return { body: res.body as T, debugId: res.debugId };

    // A revoked or expired token: drop it and mint a new one once.
    if (res.status === 401 && attempt === 1) {
      cachedToken = undefined;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    throw new PayPalApiError(res.status, path, String(res.body), res.debugId);
  }
}

function get<T>(path: string) {
  return request<T>('GET', path);
}

// `path` must already carry whatever flag makes the endpoint report `total_pages`.
async function listAll<T>(path: string, key: string, pageSize: number): Promise<T[]> {
  const items: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const res = await get<{ total_pages?: number } & Record<string, unknown>>(
      `${path}${sep}page_size=${pageSize}&page=${page}`,
    );
    items.push(...((res[key] as T[] | undefined) ?? []));
    if (page >= (res.total_pages ?? 1)) return items;
  }
}

export type Money = { value: string; currency_code: string };

// PayPal sends amounts as decimal strings; missing amounts count as 0.
export const amountOf = (m?: Money | null) => (m?.value === undefined ? 0 : Number(m.value));

// --- Catalog products & billing plans ------------------------------------------

export type Product = {
  id: string;
  name: string;
  description?: string;
  type?: 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
  category?: string;
  create_time: string;
};

export type IntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export type BillingCycle = {
  frequency: { interval_unit: IntervalUnit; interval_count: number };
  tenure_type: 'REGULAR' | 'TRIAL';
  sequence: number;
  total_cycles: number;
  pricing_scheme?: { fixed_price?: Money };
};

export type Plan = {
  id: string;
  product_id: string;
  name: string;
  status: 'CREATED' | 'INACTIVE' | 'ACTIVE';
  create_time: string;
  billing_cycles: BillingCycle[];
  payment_preferences?: { setup_fee?: Money };
};

// The list endpoints return summaries (no product type/category, no billing cycles),
// so each record is fetched in full.
export async function listProducts(): Promise<Product[]> {
  const summaries = await listAll<{ id: string }>('/v1/catalogs/products?total_required=true', 'products', 20);
  return Promise.all(summaries.map((p) => get<Product>(`/v1/catalogs/products/${encodeURIComponent(p.id)}`)));
}

export async function listPlans(): Promise<Plan[]> {
  const summaries = await listAll<{ id: string }>('/v1/billing/plans?total_required=true', 'plans', 20);
  return Promise.all(summaries.map((p) => get<Plan>(`/v1/billing/plans/${encodeURIComponent(p.id)}`)));
}

// --- Invoicing -------------------------------------------------------------------

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'SCHEDULED'
  | 'UNPAID'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'MARKED_AS_PAID'
  | 'PARTIALLY_PAID'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'MARKED_AS_REFUNDED'
  | 'CANCELLED';

export type Invoice = {
  id: string;
  status: InvoiceStatus;
  detail: {
    invoice_number: string;
    currency_code: string;
    invoice_date?: string;
    payment_term?: { term_type?: string; due_date?: string };
  };
  primary_recipients?: {
    billing_info?: {
      name?: { full_name?: string; given_name?: string; surname?: string };
      business_name?: string;
      email_address?: string;
    };
  }[];
  items?: {
    id?: string;
    name: string;
    quantity: string;
    unit_amount: Money;
    unit_of_measure?: string;
    tax?: { percent?: string; amount?: Money };
    discount?: { percent?: string; amount?: Money };
  }[];
  amount?: Money & { breakdown?: { tax_total?: Money; shipping?: { amount?: Money } } };
  due_amount?: Money;
  payments?: {
    paid_amount?: Money;
    transactions?: { payment_id?: string; payment_date?: string; method?: string; amount: Money }[];
  };
  refunds?: {
    refund_amount?: Money;
    transactions?: { recipient_transaction_id?: string; refund_date?: string; method?: string; amount: Money }[];
  };
};

// The list omits line items, payments and refunds; the detail endpoint has them.
export async function listInvoices(): Promise<Invoice[]> {
  const summaries = await listAll<{ id: string }>('/v2/invoicing/invoices?total_required=true', 'items', 100);
  return Promise.all(summaries.map((i) => get<Invoice>(`/v2/invoicing/invoices/${encodeURIComponent(i.id)}`)));
}

// --- Transaction Search & balances -------------------------------------------------

export type Transaction = {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_amount?: Money;
    fee_amount?: Money;
    transaction_status?: string;
    ending_balance?: Money;
    transaction_subject?: string;
    transaction_note?: string;
    custom_field?: string;
  };
  payer_info?: { email_address?: string };
};

// Transaction Search allows ranges of at most 31 days and rejects fractional seconds.
export const TRANSACTION_SEARCH_MAX_DAYS = 31;

export function searchTransactions(start: Date, end: Date): Promise<Transaction[]> {
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  return listAll<Transaction>(
    `/v1/reporting/transactions?start_date=${iso(start)}&end_date=${iso(end)}&fields=all`,
    'transaction_details',
    500,
  );
}

export type Balances = {
  as_of_time?: string;
  balances?: { currency: string; total_balance?: Money; available_balance?: Money; withheld_balance?: Money }[];
};

export function getBalances(): Promise<Balances> {
  return get<Balances>('/v1/reporting/balances');
}

// --- Invoicing writes (Munim) -----------------------------------------------------------
// Paths and fields checked against PayPal's Invoicing v2 reference:
//   POST   /v2/invoicing/invoices                         create draft (201)
//   POST   /v2/invoicing/invoices/{id}/send               send (200, or 202 if scheduled)
//   POST   /v2/invoicing/invoices/{id}/remind             remind (204; at most 2 per invoice per day)
//   POST   /v2/invoicing/invoices/{id}/cancel             cancel a sent invoice (204)
//   POST   /v2/invoicing/invoices/{id}/payments           record an external payment (200)
//   POST   /v2/invoicing/generate-next-invoice-number     next number (200)
//   PUT    /v2/invoicing/invoices/{id}                    full replace (send_to_recipient/send_to_invoicer query, both default true)
// invoicer.email_address must be the email of the PayPal business account behind the credentials,
// so it comes from MERCHANT_EMAIL. Partial payment lives at configuration.partial_payment.

export type PartialPayment = { allow_partial_payment: boolean; minimum_amount_due?: Money };

/** The writable shape of an invoice: what create and full update take. */
export type InvoicePayload = {
  detail: {
    currency_code: string;
    invoice_number?: string;
    invoice_date?: string;
    note?: string;
    memo?: string;
    payment_term?: { term_type?: string; due_date?: string };
  };
  invoicer?: { email_address?: string; business_name?: string; name?: { given_name?: string; surname?: string } };
  primary_recipients: {
    billing_info: { email_address: string; business_name?: string; name?: { given_name?: string; surname?: string } };
  }[];
  items: {
    name: string;
    description?: string;
    quantity: string;
    unit_amount: Money;
    unit_of_measure?: 'QUANTITY' | 'HOURS' | 'AMOUNT';
  }[];
  configuration?: { allow_tip?: boolean; partial_payment?: PartialPayment };
};

/** The invoicer block: the merchant's own PayPal email, from MERCHANT_EMAIL. */
export function invoicer(): InvoicePayload['invoicer'] {
  const email = process.env.MERCHANT_EMAIL;
  return email ? { email_address: email } : undefined;
}

export function getInvoice(id: string): Promise<Invoice & InvoicePayload> {
  return get(`/v2/invoicing/invoices/${encodeURIComponent(id)}`);
}

export async function generateNextInvoiceNumber(): Promise<string> {
  const res = await request<{ invoice_number: string }>('POST', '/v2/invoicing/generate-next-invoice-number');
  return res.invoice_number;
}

/** Creates a DRAFT invoice and returns its id. MERCHANT_EMAIL is filled in as the invoicer. */
export async function createDraftInvoice(payload: InvoicePayload, idempotencyKey?: string): Promise<string> {
  const res = await request<{ id?: string; href?: string; links?: { rel: string; href: string }[] }>(
    'POST',
    '/v2/invoicing/invoices',
    { body: { invoicer: invoicer(), ...payload }, headers: { Prefer: 'return=representation' }, idempotencyKey },
  );
  // With return=representation the invoice comes back; the minimal response only carries a link.
  const href = res.href ?? res.links?.find((l) => l.rel === 'self')?.href;
  const id = res.id ?? href?.split('/').pop();
  if (!id) throw new Error('PayPal created the invoice but returned no id');
  return id;
}

export type InvoiceNotification = {
  subject?: string;
  note?: string;
  send_to_recipient?: boolean;
  send_to_invoicer?: boolean;
  additional_recipients?: string[];
};

export function sendInvoice(id: string, notification: InvoiceNotification = {}, idempotencyKey?: string) {
  return request<{ href?: string; rel?: string; method?: string }>('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    body: { send_to_recipient: true, send_to_invoicer: true, ...notification },
    idempotencyKey,
  });
}

/** Returns PayPal's debug id for the reminder. */
export async function remindInvoice(id: string, subject: string, note: string, idempotencyKey?: string) {
  const { debugId } = await requestMeta('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    body: { subject, note, send_to_recipient: true, send_to_invoicer: false },
    idempotencyKey,
  });
  return { debugId };
}

export async function cancelInvoice(id: string, notification: InvoiceNotification = {}) {
  const { debugId } = await requestMeta('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    body: { send_to_recipient: true, send_to_invoicer: true, ...notification },
  });
  return { debugId };
}

export type PaymentMethod = 'BANK_TRANSFER' | 'CASH' | 'CHECK' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PAYPAL' | 'WIRE_TRANSFER' | 'OTHER';

/** Records a payment made outside PayPal (bank transfer, cash...). payment_date is YYYY-MM-DD. */
export function recordPayment(id: string, payment: { method: PaymentMethod; payment_date?: string; amount?: Money; note?: string }) {
  return request<{ payment_id: string }>('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/payments`, { body: payment });
}

/** Full replace. Notifications are off unless asked for, since PayPal defaults both to true. */
export function updateInvoice(id: string, invoice: InvoicePayload & { id?: string }, notify: { recipient?: boolean; invoicer?: boolean } = {}) {
  const query = `send_to_recipient=${notify.recipient ?? false}&send_to_invoicer=${notify.invoicer ?? false}`;
  return request<Invoice>('PUT', `/v2/invoicing/invoices/${encodeURIComponent(id)}?${query}`, { body: { ...invoice, id } });
}

/**
 * Turns partial payment on or off. PUT replaces the whole invoice, so this follows PayPal's
 * documented pattern: GET the full invoice, change only configuration.partial_payment, PUT it all back.
 */
export async function setPartialPayment(id: string, partial: PartialPayment) {
  const current = (await getInvoice(id)) as Invoice & InvoicePayload & Record<string, unknown>;
  const updated = { ...current, configuration: { ...current.configuration, partial_payment: partial } };
  return requestMeta<Invoice>('PUT', `/v2/invoicing/invoices/${encodeURIComponent(id)}?send_to_recipient=false&send_to_invoicer=false`, {
    body: updated,
  });
}

/** Invoice summaries only (one call per page of 100): id, status, number, dates, amounts, recipient. */
export function listInvoiceSummaries(): Promise<Invoice[]> {
  return listAll<Invoice>('/v2/invoicing/invoices?total_required=true', 'items', 100);
}

/** For the Developer page: one list call, reported as PayPal answered it. */
export async function testInvoicesEndpoint() {
  return requestOnce<{ items?: { id: string; status: InvoiceStatus; detail?: { invoice_number?: string } }[]; total_items?: number }>(
    'GET',
    '/v2/invoicing/invoices?page=1&page_size=20&total_required=true',
    {},
  );
}

/** Permanently deletes a DRAFT (or scheduled) invoice; sent invoices are cancelled instead. */
export async function deleteInvoice(id: string) {
  await request('DELETE', `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
}

// --- Webhooks ----------------------------------------------------------------------------

export type WebhookEvent = {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  summary?: string;
  resource?: Record<string, unknown>;
};

/**
 * POST /v1/notifications/verify-webhook-signature: PayPal checks that the event came from PayPal
 * for this webhook. The five values come from the PAYPAL-* request headers; `event` must be the
 * request body as received, parsed but unchanged.
 */
export async function verifyWebhookSignature(params: {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  event: unknown;
}): Promise<'SUCCESS' | 'FAILURE'> {
  const res = await request<{ verification_status: 'SUCCESS' | 'FAILURE' }>('POST', '/v1/notifications/verify-webhook-signature', {
    body: {
      auth_algo: params.authAlgo,
      cert_url: params.certUrl,
      transmission_id: params.transmissionId,
      transmission_sig: params.transmissionSig,
      transmission_time: params.transmissionTime,
      webhook_id: params.webhookId,
      webhook_event: params.event,
    },
  });
  return res.verification_status;
}
