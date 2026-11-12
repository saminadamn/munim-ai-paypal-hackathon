import { db, dbEnabled } from '@/lib/db';
import { MAIN_CURRENCY } from '@/lib/munim/action-payload';
import { payloadOf } from '@/lib/munim/action-payload';
import { fetchInvoices } from '@/lib/munim/receivables';
import { amountOf } from '@/lib/paypal';

// GET -> the "Munim today" widget's numbers. Hours saved is an estimate: executed actions x 6 minutes.
const MINUTES_PER_ACTION = 6;

// Live numbers on every request, never prerendered at build time.
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!dbEnabled()) return Response.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });

  const [lastRun, firstRun, executed, waiting] = await Promise.all([
    db.agentRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    db.agentRun.findFirst({ orderBy: { startedAt: 'asc' } }),
    db.agentAction.findMany({ where: { status: 'executed' }, select: { actionType: true, paypalInvoiceId: true, payload: true } }),
    db.agentAction.count({ where: { status: 'proposed' } }),
  ]);

  // Money chased: the amount due on each invoice Munim reminded, counted once per invoice.
  const chased = new Map<string, number>();
  for (const a of executed)
    if (['gentle_reminder', 'firm_reminder', 'offer_partial'].includes(a.actionType)) {
      const p = payloadOf(a);
      if ((p.currency ?? MAIN_CURRENCY) === MAIN_CURRENCY) chased.set(a.paypalInvoiceId, Math.max(chased.get(a.paypalInvoiceId) ?? 0, p.amountDue ?? 0));
    }

  // Money collected since the first run: payments PayPal recorded on any invoice since then.
  let collected = 0;
  let collectedError: string | null = null;
  if (firstRun) {
    const since = firstRun.startedAt.toISOString().slice(0, 10);
    try {
      for (const inv of await fetchInvoices())
        if (inv.detail.currency_code === MAIN_CURRENCY)
          for (const t of inv.payments?.transactions ?? []) if (t.payment_date && t.payment_date.slice(0, 10) >= since) collected += amountOf(t.amount);
    } catch (e) {
      collectedError = e instanceof Error ? e.message.slice(0, 200) : 'PayPal unavailable';
    }
  }

  return Response.json({
    currency: MAIN_CURRENCY,
    lastRunAt: lastRun?.startedAt.toISOString() ?? null,
    lastRunTrigger: lastRun?.trigger ?? null,
    lastRunSummary: lastRun?.summary ?? null,
    firstRunAt: firstRun?.startedAt.toISOString() ?? null,
    actionsTaken: executed.length,
    waiting,
    moneyChased: Math.round([...chased.values()].reduce((s, v) => s + v, 0) * 100) / 100,
    moneyCollected: Math.round(collected * 100) / 100,
    collectedError,
    hoursSaved: Math.round(((executed.length * MINUTES_PER_ACTION) / 60) * 10) / 10,
    minutesPerAction: MINUTES_PER_ACTION,
  });
}
