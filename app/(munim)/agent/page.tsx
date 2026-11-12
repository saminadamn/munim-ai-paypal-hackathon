import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { now } from '@/lib/clock';
import { db, dbEnabled, getSettings } from '@/lib/db';
import { actionLabel, MAIN_CURRENCY, payloadOf } from '@/lib/munim/action-payload';
import { runFailed } from '@/lib/munim/collect';
import { timeAgo } from '@/lib/format';
import { clientHistories, fetchInvoices, openInvoices } from '@/lib/munim/receivables';
import { assessRisk, RISK_LEVELS, RISK_RULES } from '@/lib/munim/risk';
import { Card, money, PageTitle, Stat } from '../_ui/ui';
import { ActivityGrid, ApprovalQueue, OpenInvoicesGrid, RunPanel, type ActivityRow, type InvoiceRow, type QueueItem } from './agent-views';
import { GuardrailSettings } from './guardrail-settings';

export const metadata: Metadata = { title: 'Agent' };

export default async function AgentPage() {
  await connection();
  const today = await now();
  const hasDb = dbEnabled();

  const [settings, invoices, lastRun, pending, recent, metas, profiles] = await Promise.all([
    hasDb ? getSettings() : undefined,
    fetchInvoices().catch((e: Error) => e),
    hasDb ? db.agentRun.findFirst({ orderBy: { startedAt: 'desc' } }) : null,
    hasDb ? db.agentAction.findMany({ where: { status: 'proposed' }, orderBy: { createdAt: 'desc' } }) : [],
    hasDb ? db.agentAction.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }) : [],
    hasDb ? db.invoiceMeta.findMany() : [],
    hasDb ? db.clientProfile.findMany() : [],
  ]);

  const currency = MAIN_CURRENCY;
  const paypalError = invoices instanceof Error ? invoices.message : null;
  const all = invoices instanceof Error ? [] : invoices;
  const open = openInvoices(all, today);
  const history = new Map(clientHistories(all).map((h) => [h.email, h]));
  const profileByEmail = new Map(profiles.map((p) => [p.email, p]));
  const metaById = new Map(metas.map((m) => [m.paypalId, m]));
  const latest = new Map<string, (typeof recent)[number]>();
  for (const a of recent) if (a.actionType !== 'none' && !latest.has(a.paypalInvoiceId)) latest.set(a.paypalInvoiceId, a);

  const mine = open.filter((i) => i.currency === currency);
  const overdue = mine.filter((i) => i.daysOverdue > 0);

  const invoiceRows: InvoiceRow[] = open.map((i) => {
    const profile = profileByEmail.get(i.clientEmail);
    const style = profile?.paymentStyle ?? history.get(i.clientEmail)?.paymentStyle ?? 'unknown';
    const avgDaysLate = style === 'unknown' ? null : (profile?.avgDaysLate ?? history.get(i.clientEmail)?.avgDaysLate ?? null);
    const meta = metaById.get(i.id);
    const risk = assessRisk({
      daysOverdue: i.daysOverdue,
      amountDue: i.amountDue,
      currency: i.currency,
      avgDaysLate,
      paymentStyle: style,
      remindersSent: meta?.remindersSent ?? 0,
      daysSinceLastReminder: null,
      approvalThreshold: settings?.approvalThreshold ?? 500,
    });
    const last = latest.get(i.id);
    return {
      id: i.id,
      number: i.number,
      client: i.clientName,
      currency: i.currency,
      amountDue: i.amountDue,
      dueDate: i.dueDate,
      daysOverdue: i.daysOverdue,
      risk: risk.level,
      rules: risk.hits.map((h) => `${h.text} (+${h.points})`).join(', '),
      reminders: meta?.remindersSent ?? 0,
      lastAction: last ? `${actionLabel(last.actionType)} · ${last.status}` : '',
    };
  });

  const queue: QueueItem[] = pending.map((a) => {
    const p = payloadOf(a);
    return {
      id: a.id,
      actionType: a.actionType,
      label: actionLabel(a.actionType),
      invoice: a.invoiceNumber ?? '',
      client: p.clientName ?? '',
      amount: p.amountDue != null ? money(p.amountDue, p.currency ?? 'USD') : '',
      partialMinimum: p.partialMinimum != null ? money(p.partialMinimum, p.currency ?? 'USD') : null,
      daysOverdue: p.daysOverdue ?? 0,
      risk: p.riskLevel ?? null,
      reason: a.reason,
      guardrail: a.guardrail,
      subject: p.subject ?? '',
      message: p.message ?? '',
    };
  });

  const activity: ActivityRow[] = recent.map((a) => {
    const p = payloadOf(a);
    return {
      id: a.id,
      at: a.createdAt.toISOString(),
      invoice: a.invoiceNumber ?? '',
      client: p.clientName ?? '',
      action: actionLabel(a.actionType),
      proposed: p.proposedActionType ? actionLabel(p.proposedActionType) : '',
      status: a.status,
      guardrail: a.guardrail ?? '',
      reason: a.reason,
      error: p.error ?? '',
      debugId: p.debugId ?? '',
      decidedBy: p.decidedBy ?? '',
    };
  });

  return (
    <>
      <PageTitle
        title="Agent"
        detail="Each run, Munim syncs your invoices from PayPal, scores every open one with the rules below, asks the model what to do, and then applies your guardrails in code. Allowed reminders go out through PayPal; everything else waits for you."
      />
      <div className="-mt-3 mb-6 text-sm">
        <Link href="/agent/forecast" className="font-semibold text-pp-blue hover:underline">
          Cash forecast →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Open" value={money(mine.reduce((s, i) => s + i.amountDue, 0), currency)} detail={`${mine.length} invoices in ${currency}`} />
        <Stat label="Overdue" value={money(overdue.reduce((s, i) => s + i.amountDue, 0), currency)} detail={`${overdue.length} invoices`} />
        <Stat label="Waiting for you" value={String(queue.length)} detail="in the approval queue" />
        <Stat
          label="Last run"
          value={lastRun ? timeAgo(lastRun.startedAt.toISOString()) : 'Never'}
          detail={lastRun ? `${lastRun.trigger} · ${lastRun.executed} sent, ${lastRun.proposed} queued` : undefined}
        />
      </div>

      {paypalError && (
        <p className="mt-6 rounded border border-pp-danger bg-pp-surface px-4 py-3 text-sm text-pp-danger">Could not read invoices from PayPal: {paypalError.slice(0, 300)}</p>
      )}

      {hasDb && (
        <div className="mt-6">
          <RunPanel lastSummary={lastRun?.summary ?? null} lastFailed={lastRun ? runFailed(lastRun) : false} />
        </div>
      )}

      <div className="mt-6">
        {queue.length > 0 ? (
          <ApprovalQueue items={queue} />
        ) : (
          hasDb && (
            <Card title="Waiting for your approval">
              <p className="text-sm text-pp-muted">
                Nothing right now. Reminders above your {money(settings?.approvalThreshold ?? 500, MAIN_CURRENCY)} limit, part-payment offers and hand-offs will
                wait here for you.
              </p>
            </Card>
          )
        )}
      </div>

      <Card title="Open invoices" className="mt-6">
        <OpenInvoicesGrid rows={invoiceRows} />
      </Card>

      {hasDb && (
        <Card title="Activity log" className="mt-6">
          <ActivityGrid rows={activity} />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="How Munim scores risk">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-pp-border">
              {RISK_RULES.map((r) => (
                <tr key={r.rule}>
                  <td className="py-2 pr-3 font-semibold text-pp-ink">{r.rule}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-pp-blue">{r.points}</td>
                  <td className="py-2 text-pp-muted">{r.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-pp-muted">{RISK_LEVELS} The model sees the level and the rules hit; it never sets them.</p>
        </Card>
        {settings && <GuardrailSettings settings={settings} />}
      </div>
    </>
  );
}
