// npm run seed: a clean demo for "Pixel & Pine Studio".
//
//   1. Resets Munim's tables and sets Settings (business, owner Samina, real-date clock).
//   2. Creates 5 client profiles with different payment styles and histories.
//   3. Creates and SENDS 8 real sandbox invoices ($80 to $1,500, due in 1 to 10 days) through
//      lib/paypal.ts, so the demo clock can push them overdue. One goes to SANDBOX_PAYER_EMAIL,
//      your sandbox personal account, so you can pay it live.
//   4. Prints a summary table.
//
// Safe to run twice: every seeded invoice is numbered PPS-..., and each run first cancels the
// previous run's open PPS invoices (without emailing anyone) and deletes PPS drafts.
// Needs PAYPAL_CLIENT_ID, PAYPAL_SECRET, MERCHANT_EMAIL, DATABASE_URL and SANDBOX_PAYER_EMAIL
// (read from .env.local).

import { addDays, isoDay } from '../lib/clock';
import { db } from '../lib/db';
import {
  cancelInvoice,
  createDraftInvoice,
  deleteInvoice,
  getInvoice,
  listInvoiceSummaries,
  sendInvoice,
  type InvoicePayload,
} from '../lib/paypal';

const PREFIX = 'PPS-';
const BUSINESS = 'Pixel & Pine Studio';
const OWNER = 'Samina';

type Client = { key: string; name: string; company: string | null; email: string; paymentStyle: string; avgDaysLate: number; notes: string };
type Seed = { client: string; item: string; amount: number; dueInDays: number; source: string; rawInput: string | null };

function clients(payerEmail: string): Client[] {
  // example.com addresses are reserved and never deliverable; the sandbox accepts them as recipients.
  return [
    { key: 'brightleaf', name: 'Priya Menon', company: 'Brightleaf Studio', email: 'priya.brightleaf@example.com', paymentStyle: 'prompt', avgDaysLate: -1, notes: 'Pays within a day or two, usually before the due date.' },
    { key: 'sharma', name: 'Rohit Sharma', company: 'Sharma Traders', email: 'rohit.sharmatraders@example.com', paymentStyle: 'slow', avgDaysLate: 12, notes: 'Always pays, always about two weeks late. Prefers WhatsApp.' },
    { key: 'northwind', name: 'Leah Fernandes', company: 'Northwind Cafe', email: 'leah.northwind@example.com', paymentStyle: 'partial', avgDaysLate: 6, notes: 'Has paid big invoices in two parts before.' },
    { key: 'okafor', name: 'Dan Okafor', company: null, email: 'dan.okafor@example.com', paymentStyle: 'unknown', avgDaysLate: 0, notes: 'New client this month.' },
    { key: 'payer', name: 'Arjun Mehta', company: 'Mehta Interiors', email: payerEmail, paymentStyle: 'slow', avgDaysLate: 8, notes: 'Your sandbox buyer account: pay this one live in the demo.' },
  ];
}

const INVOICES: Seed[] = [
  { client: 'brightleaf', item: 'Social media post templates (set of 6)', amount: 80, dueInDays: 2, source: 'email', rawInput: 'Please invoice Brightleaf for the six post templates, $80.' },
  { client: 'okafor', item: 'Website maintenance, November', amount: 300, dueInDays: 1, source: 'chat', rawInput: 'Bill Dan Okafor $300 for November website maintenance, due tomorrow' },
  { client: 'payer', item: 'Showroom photo retouching (20 images)', amount: 260, dueInDays: 4, source: 'whatsapp', rawInput: 'Arjun bhai, 20 photos ka retouch done, 260 dollars, 4 din mein bhej dena' },
  { client: 'sharma', item: 'Festive catalogue design', amount: 1500, dueInDays: 3, source: 'whatsapp', rawInput: 'Rohit: catalogue final hai, 1500 dollars, is week ke end tak' },
  { client: 'northwind', item: 'Menu redesign and print files', amount: 950, dueInDays: 5, source: 'email', rawInput: 'Hi! Confirming the menu redesign at $950. Net 5 is fine. Leah' },
  { client: 'sharma', item: 'Packaging mock-ups', amount: 420, dueInDays: 6, source: 'manual', rawInput: null },
  { client: 'brightleaf', item: 'Brand refresh, phase 1', amount: 640, dueInDays: 9, source: 'email', rawInput: 'Phase 1 of the brand refresh is approved, $640, net 9. Priya' },
  { client: 'payer', item: 'Logo animation', amount: 180, dueInDays: 10, source: 'chat', rawInput: 'Bill Mehta Interiors $180 for the logo animation, due in 10 days' },
];

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (add it to .env.local).`);
  return v;
}

async function clearPreviousSeed() {
  const previous = (await listInvoiceSummaries()).filter((i) => i.detail.invoice_number?.startsWith(PREFIX));
  let cancelled = 0;
  let deleted = 0;
  for (const inv of previous) {
    if (inv.status === 'DRAFT') {
      await deleteInvoice(inv.id);
      deleted++;
    } else if (['SENT', 'UNPAID', 'SCHEDULED'].includes(inv.status)) {
      await cancelInvoice(inv.id, { send_to_recipient: false, send_to_invoicer: false });
      cancelled++;
    }
    // Paid, part-paid and already-cancelled invoices are left as they are.
  }
  return { found: previous.length, cancelled, deleted };
}

async function resetMunim() {
  await db.$transaction([
    db.agentAction.deleteMany(),
    db.agentRun.deleteMany(),
    db.invoiceMeta.deleteMany(),
    db.clientProfile.deleteMany(),
    db.apiLog.deleteMany(),
  ]);
  const settings = { businessName: BUSINESS, ownerName: OWNER, demoOffsetDays: 0, maxRemindersPerInvoice: 3, minDaysBetweenReminders: 3, approvalThreshold: 500, quietWeekends: true };
  await db.settings.upsert({ where: { id: 1 }, update: settings, create: { id: 1, ...settings } });
}

export async function seed() {
  for (const v of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'DATABASE_URL', 'MERCHANT_EMAIL']) need(v);
  const payerEmail = need('SANDBOX_PAYER_EMAIL').toLowerCase();
  const runTag = new Date().toISOString().replace(/\D/g, '').slice(2, 12); // yyMMddHHmm

  console.log(`Seeding ${BUSINESS} (owner ${OWNER})…`);
  const cleared = await clearPreviousSeed();
  console.log(`  previous seed: ${cleared.found} PPS invoices found, ${cleared.cancelled} cancelled, ${cleared.deleted} drafts deleted`);
  await resetMunim();
  console.log('  Munim tables reset, settings saved');

  const people = clients(payerEmail);
  for (const c of people) {
    await db.clientProfile.create({ data: { email: c.email, name: c.name, company: c.company, paymentStyle: c.paymentStyle, avgDaysLate: c.avgDaysLate, notes: c.notes } });
  }
  console.log(`  ${people.length} client profiles created`);

  const today = new Date(); // PayPal dates use the real calendar; the demo clock moves Munim's view of them.
  const rows: { number: string; client: string; email: string; amount: string; due: string; status: string; id: string; link?: string }[] = [];
  for (const [n, s] of INVOICES.entries()) {
    const c = people.find((p) => p.key === s.client)!;
    const number = `${PREFIX}${runTag}-${String(n + 1).padStart(2, '0')}`;
    const [given, ...rest] = c.name.split(' ');
    const payload: InvoicePayload = {
      detail: {
        currency_code: 'USD',
        invoice_number: number,
        invoice_date: isoDay(today),
        payment_term: { due_date: isoDay(addDays(today, s.dueInDays)) },
        note: `Thank you for working with ${BUSINESS}.`,
      },
      primary_recipients: [{ billing_info: { email_address: c.email, name: { given_name: given, surname: rest.join(' ') }, ...(c.company && { business_name: c.company }) } }],
      items: [{ name: s.item, quantity: '1', unit_amount: { currency_code: 'USD', value: s.amount.toFixed(2) } }],
    };
    const id = await createDraftInvoice(payload, `seed-${number}`);
    await sendInvoice(id, { send_to_recipient: true, send_to_invoicer: false }, `seed-send-${number}`);
    await db.invoiceMeta.create({ data: { paypalId: id, source: s.source, rawInput: s.rawInput } });
    const sent = await getInvoice(id);
    const link = c.key === 'payer' ? (sent.detail as { metadata?: { recipient_view_url?: string } }).metadata?.recipient_view_url : undefined;
    rows.push({ number, client: c.company ?? c.name, email: c.email, amount: `$${s.amount.toLocaleString('en-US')}`, due: payload.detail.payment_term!.due_date!, status: sent.status, id, link });
  }

  console.log('\nInvoices sent from the sandbox business account:\n');
  console.table(rows.map(({ link: _l, ...r }) => (void _l, r)));
  const live = rows.filter((r) => r.link);
  if (live.length) {
    console.log(`\nPay live as ${payerEmail} (sandbox buyer):`);
    for (const r of live) console.log(`  ${r.number}  ${r.amount}  ${r.link}`);
  }
  console.log(`\nNext: open /agent, press the clock pill and add +7 days, then Run Munim.`);
}

// Run directly (npm run seed), not when imported by a test.
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`\nSeed failed: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
