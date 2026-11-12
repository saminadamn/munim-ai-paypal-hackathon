import { now } from '@/lib/clock';
import { db, dbEnabled, getSettings } from '@/lib/db';
import { payloadOf } from '@/lib/munim/action-payload';
import { buildForecast, forecastOn } from '@/lib/munim/forecast';
import { clientHistories, fetchInvoices, openInvoices } from '@/lib/munim/receivables';
import { assessRisk, riskSentence } from '@/lib/munim/risk';

// Read-only data for Munim's tools inside AG Studio's assistant (app/dashboard/studio/munim-agent.ts).
// POST { tool, args } -> JSON the model reads. Nothing here changes PayPal or the database.

type Args = Record<string, unknown>;

const round = (n: number) => Math.round(n * 100) / 100;
const matches = (needle: unknown, ...hay: (string | null | undefined)[]) =>
  typeof needle !== 'string' || !needle.trim() || hay.some((h) => h?.toLowerCase().includes(needle.trim().toLowerCase()));

async function latestActions(invoiceIds: string[]) {
  const map = new Map<string, { action: string; status: string; reason: string; at: string }>();
  if (!dbEnabled() || invoiceIds.length === 0) return map;
  const rows = await db.agentAction.findMany({
    where: { paypalInvoiceId: { in: invoiceIds } },
    orderBy: { createdAt: 'desc' },
    select: { paypalInvoiceId: true, actionType: true, status: true, reason: true, createdAt: true },
  });
  for (const r of rows)
    if (!map.has(r.paypalInvoiceId)) map.set(r.paypalInvoiceId, { action: r.actionType, status: r.status, reason: r.reason, at: r.createdAt.toISOString() });
  return map;
}

const tools: Record<string, (args: Args) => Promise<unknown>> = {
  async receivables_summary() {
    const today = await now();
    const open = openInvoices(await fetchInvoices(), today);
    const byCurrency = new Map<string, { open: number; overdue: number; count: number; overdueCount: number }>();
    for (const i of open) {
      const c = byCurrency.get(i.currency) ?? { open: 0, overdue: 0, count: 0, overdueCount: 0 };
      c.open += i.amountDue;
      c.count++;
      if (i.daysOverdue > 0) {
        c.overdue += i.amountDue;
        c.overdueCount++;
      }
      byCurrency.set(i.currency, c);
    }
    const byClient = new Map<string, { client: string; currency: string; overdue: number; oldestDaysOverdue: number }>();
    for (const i of open.filter((x) => x.daysOverdue > 0)) {
      const key = `${i.clientEmail}|${i.currency}`;
      const c = byClient.get(key) ?? { client: i.clientName, currency: i.currency, overdue: 0, oldestDaysOverdue: 0 };
      c.overdue += i.amountDue;
      c.oldestDaysOverdue = Math.max(c.oldestDaysOverdue, i.daysOverdue);
      byClient.set(key, c);
    }
    return {
      today: today.toISOString().slice(0, 10),
      byCurrency: Object.fromEntries([...byCurrency].map(([k, v]) => [k, { ...v, open: round(v.open), overdue: round(v.overdue) }])),
      topOverdueClients: [...byClient.values()].sort((a, b) => b.overdue - a.overdue).slice(0, 8).map((c) => ({ ...c, overdue: round(c.overdue) })),
      note: 'Amounts are not converted between currencies.',
    };
  },

  async open_invoices(args) {
    const today = await now();
    const settings = dbEnabled() ? await getSettings() : undefined;
    const invoices = await fetchInvoices();
    const histories = new Map(clientHistories(invoices).map((h) => [h.email, h]));
    const minDays = typeof args.minDaysOverdue === 'number' ? args.minDaysOverdue : -10_000;
    const riskFilter = typeof args.riskLevel === 'string' && ['low', 'medium', 'high'].includes(args.riskLevel) ? args.riskLevel : null;
    const open = openInvoices(invoices, today).filter((i) => i.daysOverdue >= minDays && matches(args.client, i.clientName, i.clientEmail));
    const last = await latestActions(open.map((i) => i.id));
    const metas = dbEnabled() ? await db.invoiceMeta.findMany({ where: { paypalId: { in: open.map((i) => i.id) } } }) : [];
    const sent = new Map(metas.map((m) => [m.paypalId, m.remindersSent]));
    const rows = open.map((i) => ({
      invoiceId: i.id,
      number: i.number,
      status: i.status,
      client: i.clientName,
      amountDue: i.amountDue,
      currency: i.currency,
      dueDate: i.dueDate,
      daysOverdue: i.daysOverdue,
            ...(() => {
        const h = histories.get(i.clientEmail);
        const risk = assessRisk({
          daysOverdue: i.daysOverdue,
          amountDue: i.amountDue,
          currency: i.currency,
          avgDaysLate: h?.avgDaysLate ?? null,
          paymentStyle: h?.paymentStyle ?? 'unknown',
          remindersSent: sent.get(i.id) ?? 0,
          daysSinceLastReminder: null,
          approvalThreshold: settings?.approvalThreshold ?? 500,
        });
        return { risk: risk.level, riskBecause: riskSentence(risk), remindersSent: sent.get(i.id) ?? 0 };
      })(),
      lastMunimAction: last.get(i.id) ?? null,
    }));
    return rows.filter((r) => !riskFilter || r.risk === riskFilter).slice(0, 40);
  },

  async client_profile(args) {
    const invoices = await fetchInvoices();
    const today = await now();
    const found = clientHistories(invoices).filter((h) => matches(args.client, h.name, h.email));
    if (found.length === 0) return { error: `No client matches "${String(args.client ?? '')}".` };
    const open = openInvoices(invoices, today);
    const stored = dbEnabled() ? await db.clientProfile.findMany({ where: { email: { in: found.map((h) => h.email) } } }) : [];
    const byEmail = new Map(stored.map((p) => [p.email, p]));
    return found.slice(0, 5).map((h) => ({
      ...h,
      ...(byEmail.get(h.email) && { paymentStyle: byEmail.get(h.email)!.paymentStyle, avgDaysLate: byEmail.get(h.email)!.avgDaysLate, notes: byEmail.get(h.email)!.notes }),
      openInvoices: open.filter((i) => i.clientEmail === h.email).map((i) => ({ number: i.number, amountDue: i.amountDue, currency: i.currency, daysOverdue: i.daysOverdue })),
    }));
  },

  async cash_forecast(args) {
    const f = await buildForecast();
    const date = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : null;
    if (date) return forecastOn(f, date);
    return {
      today: f.today,
      currency: f.currency,
      startBalance: f.startBalance,
      in30DaysWithMunim: f.endWithMunim,
      in30DaysIfNothingIsDone: f.endDoNothing,
      weekly: f.rows.filter((r) => r.day % 7 === 0 || r.day === 30).map(({ date, cumulative_expected, do_nothing_cumulative }) => ({ date, withMunim: cumulative_expected, ifNothingIsDone: do_nothing_cumulative })),
      biggestExpectedPayments: [...f.invoices].sort((a, b) => b.amountDue - a.amountDue).slice(0, 5),
      heuristic: f.heuristic,
      otherCurrenciesExcluded: f.otherCurrencies,
    };
  },

  async munim_activity(args) {
    if (!dbEnabled()) return { error: 'No database configured, so there is no activity log.' };
    const status = typeof args.status === 'string' && args.status ? args.status : undefined;
    const [actions, lastRun] = await Promise.all([
      db.agentAction.findMany({
        where: { ...(status && { status }), actionType: { not: 'none' } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      db.agentRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);
    return {
      lastRun: lastRun && { at: lastRun.startedAt.toISOString(), trigger: lastRun.trigger, summary: lastRun.summary, sent: lastRun.executed, queued: lastRun.proposed },
      actions: actions.map((a) => {
        const p = payloadOf(a);
        return {
          at: a.createdAt.toISOString(),
          invoice: a.invoiceNumber,
          client: p.clientName,
          action: a.actionType,
          status: a.status,
          reason: a.reason,
          guardrail: a.guardrail,
          amountDue: p.amountDue,
          currency: p.currency,
        };
      }),
    };
  },
};

export async function POST(request: Request) {
  const { tool, args } = (await request.json().catch(() => ({}))) as { tool?: string; args?: Args };
  const fn = tool ? tools[tool] : undefined;
  if (!fn) return Response.json({ error: `Unknown tool ${tool}` }, { status: 400 });
  try {
    return Response.json(await fn(args ?? {}));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
