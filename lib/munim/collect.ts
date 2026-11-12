// COLLECT: one run of Munim's collections agent.
//   a) Sync invoices from PayPal; add a ClientProfile for every new recipient.
//   b) Score each open invoice with the rules in ./risk.ts.
//   c) The model proposes an action, a reason and a message per invoice.
//   d) Code applies the guardrails and records which one fired.
//   e) Allowed actions run through PayPal; the rest wait in the approval queue.
//   f) The run is saved with a two-sentence summary.
// The model proposes; code decides. Progress is reported through `onEvent` for the Agent page.

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { addDays, daysBetween, isoDay, now } from '../clock';
import { formatMoney } from '../format';
import { db, getSettings, type Settings } from '../db';
import {
  amountOf,
  cancelInvoice,
  createDraftInvoice,
  generateNextInvoiceNumber,
  getInvoice,
  PayPalApiError,
  remindInvoice,
  sendInvoice,
  setPartialPayment,
  type InvoicePayload,
} from '../paypal';
import { actionLabel, PARTIAL_MIN_PERCENT, payloadOf, type ActionPayload } from './action-payload';
import { munimModel } from './llm';
import { refreshClientProfiles, reconcileAll } from './payments';
import { fetchInvoices, OPEN_STATUSES, openInvoices, type OpenInvoice } from './receivables';
import { assessRisk, riskSentence, type Risk } from './risk';

export const ACTIONS = ['none', 'gentle_reminder', 'firm_reminder', 'offer_partial', 'escalate_to_owner'] as const;
export type Action = (typeof ACTIONS)[number];
/** Actions that email the client through PayPal. */
const SENDS: Action[] = ['gentle_reminder', 'firm_reminder', 'offer_partial'];
const MAX_WORDS = 80;

export type RunEvent =
  | { type: 'progress'; message: string }
  | { type: 'action'; message: string; invoice: string; actionType: string; status: string }
  | { type: 'done'; message: string; runId: string; executed: number; proposed: number }
  | { type: 'error'; message: string };

type Emit = (e: RunEvent) => void;

// --- c) The model's proposal ----------------------------------------------------------

const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      invoiceId: z.string(),
      action: z.enum(ACTIONS),
      reason: z.string().describe('One specific sentence for the owner, citing the facts that drove it'),
      subject: z.string().describe('Email subject, or empty string for none / escalate_to_owner'),
      message: z.string().describe('Email body to the client, at most 80 words, or empty string'),
    }),
  ),
});
type Proposal = z.infer<typeof decisionSchema>['decisions'][number];

const SYSTEM = `You are Munim, the collections clerk for a small business. For each open invoice choose one action:
- none: not due yet, reminded recently, or nothing useful to do now.
- gentle_reminder: friendly nudge, for an invoice due within 3 days or a first reminder.
- firm_reminder: clear and direct, only when at least one reminder has already been sent and ignored.
- offer_partial: let the client pay part now; for a large invoice well overdue from a client who usually pays eventually.
- escalate_to_owner: the owner should call; very late, high risk, or reminders keep being ignored.
reason: one specific sentence for the owner that cites the numbers (days late, amount, the client's usual lateness, reminders sent).
message: at most 80 words, addressed to the client by first name, names the invoice number and the exact amount due, polite and never threatening. No late fees, discounts, legal action or deadlines the owner did not set. Firmer wording only when reminders have already been sent.
For offer_partial, say they can pay at least the given minimum now and the rest later from the same PayPal link.
Return one decision for every invoice id.`;

type Facts = {
  invoice: OpenInvoice;
  risk: Risk;
  avgDaysLate: number | null;
  paymentStyle: string;
  remindersSent: number;
  daysSinceLastReminder: number | null;
  remindersLast24h: number;
  partialMinimum: number;
};

const money = (n: number, currency: string) => formatMoney(n, currency, { code: true });

async function proposeWithModel(facts: Facts[], s: Settings): Promise<Map<string, Proposal> | null> {
  const model = munimModel();
  if (!model || facts.length === 0) return null;
  const lines = facts.map((f) =>
    JSON.stringify({
      invoiceId: f.invoice.id,
      number: f.invoice.number,
      client: f.invoice.clientName,
      amountDue: money(f.invoice.amountDue, f.invoice.currency),
      dueDate: f.invoice.dueDate,
      daysOverdue: f.invoice.daysOverdue,
      risk: f.risk.level,
      riskRules: riskSentence(f.risk),
      clientUsuallyPays: f.avgDaysLate === null ? 'no history' : `${f.avgDaysLate} days late on average`,
      remindersSent: f.remindersSent,
      daysSinceLastReminder: f.daysSinceLastReminder,
      partialMinimumIfOffered: money(f.partialMinimum, f.invoice.currency),
      partialAlreadyAllowed: f.invoice.partialAllowed,
    }),
  );
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: decisionSchema }),
      system: SYSTEM,
      prompt: `Business: ${s.businessName}. Owner: ${s.ownerName}.\nOpen invoices, one JSON per line:\n${lines.join('\n')}`,
    });
    return new Map(output.decisions.map((d) => [d.invoiceId, d]));
  } catch (e) {
    console.error('[Munim] model decision failed, using rules', e);
    return null;
  }
}

/** Used when no model is configured or it fails: the same policy as plain rules, with the standard wording. */
function proposeWithRules(f: Facts): Proposal {
  const p = ruleDecision(f);
  return SENDS.includes(p.action) ? { ...p, ...template(p.action, f) } : p;
}

function ruleDecision(f: Facts): Proposal {
  const d = f.invoice.daysOverdue;
  const base = { invoiceId: f.invoice.id, subject: '', message: '' };
  const tail = f.avgDaysLate !== null ? `, and this client usually pays ${f.avgDaysLate} days late` : '';
  if (d < -3) return { ...base, action: 'none', reason: `Not due for ${-d} days, so there is nothing to chase yet.` };
  if (f.risk.level === 'high' && (d > 45 || f.remindersSent >= 2))
    return { ...base, action: 'escalate_to_owner', reason: `${d} days late after ${f.remindersSent} reminders${tail}, so a call from you will work better than another email.` };
  if (d > 30 && f.invoice.amountDue > 0 && !f.invoice.partialAllowed && f.paymentStyle !== 'unknown')
    return { ...base, action: 'offer_partial', reason: `${d} days late on ${money(f.invoice.amountDue, f.invoice.currency)}${tail}, so letting them pay part now may unlock cash sooner.` };
  if (f.remindersSent > 0) return { ...base, action: 'firm_reminder', reason: `${d} days late and ${f.remindersSent} reminder${f.remindersSent === 1 ? '' : 's'} already ignored${tail}.` };
  return { ...base, action: 'gentle_reminder', reason: d <= 0 ? `Due in ${-d} days, so a friendly heads-up helps it land on time.` : `${d} days late with no reminder yet${tail}, so a gentle nudge first.` };
}

function template(action: Action, f: Facts) {
  const inv = f.invoice;
  const first = inv.clientName.split(/\s+/)[0];
  const amount = money(inv.amountDue, inv.currency);
  switch (action) {
    case 'firm_reminder':
      return {
        subject: `Invoice ${inv.number} is ${inv.daysOverdue} days overdue`,
        message: `Hi ${first}, invoice ${inv.number} for ${amount} was due on ${inv.dueDate} and is now ${inv.daysOverdue} days overdue. We sent a reminder earlier. Please pay it from the PayPal link in this email, or reply to let us know when to expect it.`,
      };
    case 'offer_partial':
      return {
        subject: `Pay invoice ${inv.number} in parts`,
        message: `Hi ${first}, to make invoice ${inv.number} for ${amount} easier to settle, you can now pay part of it today, at least ${money(f.partialMinimum, inv.currency)}, and the rest later from the same PayPal link.`,
      };
    default:
      return {
        subject: inv.daysOverdue <= 0 ? `Invoice ${inv.number} is due on ${inv.dueDate}` : `Friendly reminder: invoice ${inv.number}`,
        message: `Hi ${first}, a quick reminder that invoice ${inv.number} for ${amount} ${inv.daysOverdue <= 0 ? 'is due on' : 'was due on'} ${inv.dueDate}. You can pay it from the PayPal link in this email. Thank you!`,
      };
  }
}

// --- d) Guardrails ----------------------------------------------------------------------

export type Guardrail = { code: string; text: string };
export type Verdict = {
  actionType: Action;
  status: 'skipped' | 'proposed' | 'approved';
  guardrails: Guardrail[];
  subject: string;
  message: string;
};

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const STRAYS = /discount|waive|late fee|penalt|interest|legal|lawyer|court|collection agenc|% off|or else|final notice/i;

/** Everything here runs after the model has answered. The first guardrail listed is the one that decided. */
export function applyGuardrails(p: Proposal, f: Facts, s: Settings, today: Date): Verdict {
  const inv = f.invoice;
  const guardrails: Guardrail[] = [];
  const fire = (code: string, text: string) => guardrails.push({ code, text });
  let action: Action = ACTIONS.includes(p.action) ? p.action : 'none';

  // Corrections: the action itself is changed, and the change is recorded.
  if (SENDS.includes(action) && inv.status === 'SCHEDULED') {
    action = 'none';
    fire('not_sent_yet', 'PayPal has not sent this scheduled invoice yet');
  }
  if (SENDS.includes(action) && inv.daysOverdue < -3) {
    action = 'none';
    fire('not_due', `not due for ${-inv.daysOverdue} days`);
  }
  if (action === 'firm_reminder' && f.remindersSent === 0) {
    action = 'gentle_reminder';
    fire('first_reminder_gentle', 'a firmer tone only after a reminder has been ignored');
  }
  if (action === 'offer_partial' && inv.partialAllowed) {
    action = f.remindersSent > 0 ? 'firm_reminder' : 'gentle_reminder';
    fire('partial_already_on', 'part-payment is already allowed on this invoice');
  }

  // The message: the model's draft unless it breaks a rule, in which case the standard wording is used.
  let { subject, message } = p;
  if (SENDS.includes(action)) {
    const minimumStated = action !== 'offer_partial' || message.includes(f.partialMinimum.toFixed(2)) || message.includes(f.partialMinimum.toLocaleString('en-US'));
    const amountDigits = Math.floor(inv.amountDue).toString();
    const namesInvoice = message.includes(inv.number) && message.replace(/[^0-9]/g, '').includes(amountDigits);
    const problems = [
      !subject.trim() || !message.trim() ? 'empty' : null,
      wordCount(message) > MAX_WORDS ? `over ${MAX_WORDS} words` : null,
      !namesInvoice ? 'did not name the invoice number and amount' : null,
      STRAYS.test(`${subject} ${message}`) ? 'mentioned fees, discounts or legal action' : null,
      !minimumStated ? 'did not state the part-payment minimum' : null,
      action !== p.action ? 'written for a different action' : null,
    ].filter(Boolean);
    if (problems.length) {
      ({ subject, message } = template(action, f));
      fire('message_rewritten', `standard wording used: draft ${problems.join(', ')}`);
    }
  } else {
    subject = '';
    message = '';
  }

  // Hard stops: nothing is sent.
  const stop = (code: string, text: string): Verdict => ({ actionType: action, status: 'skipped', guardrails: [{ code, text }, ...guardrails], subject, message });
  if (SENDS.includes(action)) {
    if (f.remindersSent >= s.maxRemindersPerInvoice) return stop('max_reminders', `${f.remindersSent} of ${s.maxRemindersPerInvoice} reminders already sent`);
    if (f.daysSinceLastReminder !== null && f.daysSinceLastReminder < s.minDaysBetweenReminders)
      return stop('too_soon', `last reminder ${f.daysSinceLastReminder === 1 ? '1 day' : `${f.daysSinceLastReminder} days`} ago, minimum ${s.minDaysBetweenReminders}`);
    if (f.remindersLast24h >= 2) return stop('paypal_daily_limit', 'PayPal allows 2 reminders per invoice per day');
  }
  if (action === 'none') return { actionType: action, status: 'skipped', guardrails, subject, message };

  // Approval queue.
  if (action === 'offer_partial') return { actionType: action, status: 'proposed', guardrails: [{ code: 'approval_needed', text: 'changing invoice terms always needs your approval' }, ...guardrails], subject, message };
  if (action === 'escalate_to_owner') return { actionType: action, status: 'proposed', guardrails: [{ code: 'approval_needed', text: 'handed to you' }, ...guardrails], subject, message };
  if (inv.amountDue > s.approvalThreshold)
    return {
      actionType: action,
      status: 'proposed',
      guardrails: [{ code: 'over_limit', text: `${money(inv.amountDue, inv.currency)} is above your ${money(s.approvalThreshold, inv.currency)} approval limit` }, ...guardrails],
      subject,
      message,
    };

  // Quiet weekends hold back what would otherwise go out automatically.
  const day = today.getUTCDay();
  if (s.quietWeekends && (day === 0 || day === 6)) return stop('quiet_weekend', 'waiting for Monday');

  return { actionType: action, status: 'approved', guardrails, subject, message };
}

export const guardrailText = (g: Guardrail[]) => (g.length ? g.map((x) => `${x.code}: ${x.text}`).join('; ') : null);

// --- e) Execution ----------------------------------------------------------------------

const errorOf = (e: unknown) =>
  e instanceof PayPalApiError ? { error: `PayPal ${e.status}: ${e.message.slice(0, 400)}`, debugId: e.debugId } : { error: e instanceof Error ? e.message : String(e), debugId: null };

async function recordReminder(paypalId: string, opts: { allowPartial?: boolean } = {}) {
  // Spacing is measured on the demo clock, so the last reminder is stored in demo time.
  const at = await now();
  await db.invoiceMeta.upsert({
    where: { paypalId },
    update: { remindersSent: { increment: 1 }, lastReminderAt: at, ...(opts.allowPartial && { allowPartial: true }) },
    create: { paypalId, remindersSent: 1, lastReminderAt: at, allowPartial: Boolean(opts.allowPartial) },
  });
}

/**
 * Part-payment on a sent invoice. PayPal documents updates as GET + PUT of the full invoice, but not
 * whether a sent invoice accepts one, so: try the update; if PayPal refuses it, cancel the invoice
 * and reissue the same items with part-payment allowed. Never reissues an invoice that already has
 * payments recorded.
 */
async function offerPartial(actionId: string, id: string, p: ActionPayload) {
  const minimum = { currency_code: p.currency ?? 'USD', value: (p.partialMinimum ?? 0).toFixed(2) };
  try {
    const put = await setPartialPayment(id, { allow_partial_payment: true, minimum_amount_due: minimum });
    const { debugId } = await remindInvoice(id, p.subject ?? '', p.message ?? '', `munim-${actionId}`);
    await recordReminder(id, { allowPartial: true });
    return { method: 'updated', minimum, debugId: debugId ?? put.debugId };
  } catch (e) {
    if (!(e instanceof PayPalApiError) || e.status >= 500 || !e.path.includes(`/invoices/${encodeURIComponent(id)}?`)) throw e;
    // PayPal refused the update itself: fall back to cancel and reissue.
    const current = await getInvoice(id);
    if (amountOf(current.payments?.paid_amount) > 0) throw new Error(`PayPal would not change the sent invoice (${e.status}), and it already has payments recorded, so Munim did not cancel it.`);

    const today = new Date(); // PayPal dates use the real calendar: a future issue date gets scheduled, not sent.
    const number = await generateNextInvoiceNumber();
    const payload: InvoicePayload = {
      detail: {
        currency_code: current.detail.currency_code,
        invoice_number: number,
        invoice_date: isoDay(today),
        payment_term: { due_date: isoDay(addDays(today, 7)) },
        note: `Replaces invoice ${current.detail.invoice_number}. You can pay in parts.`,
      },
      primary_recipients: current.primary_recipients as InvoicePayload['primary_recipients'],
      items: (current.items ?? []).map(({ id: _drop, ...item }) => (void _drop, item)) as InvoicePayload['items'],
      configuration: { ...current.configuration, partial_payment: { allow_partial_payment: true, minimum_amount_due: minimum } },
    };
    // Create the replacement first: if that fails, the original invoice is left untouched.
    const newId = await createDraftInvoice(payload, `munim-reissue-${actionId}`);
    await cancelInvoice(id, { subject: `Invoice ${current.detail.invoice_number} replaced`, note: `We are replacing invoice ${current.detail.invoice_number} with ${number}, which you can pay in parts.` });
    await sendInvoice(newId, { subject: p.subject, note: p.message }, `munim-reissue-send-${actionId}`);

    const meta = await db.invoiceMeta.findUnique({ where: { paypalId: id } });
    await db.invoiceMeta.upsert({
      where: { paypalId: newId },
      update: { allowPartial: true },
      create: { paypalId: newId, source: meta?.source ?? 'paypal', rawInput: `Reissued from invoice ${current.detail.invoice_number}.`, allowPartial: true, remindersSent: meta?.remindersSent ?? 0, lastReminderAt: await now() },
    });
    await db.agentAction.create({
      data: {
        paypalInvoiceId: newId,
        invoiceNumber: number,
        actionType: 'create_invoice',
        status: 'executed',
        reason: `Reissued from invoice ${current.detail.invoice_number} with part-payment allowed (at least ${minimum.currency_code} ${minimum.value}), because PayPal would not change the sent invoice.`,
        payload: { ...p, result: { reissuedFrom: id } } as object,
        executedAt: new Date(),
      },
    });
    return { method: 'cancelled_and_reissued', minimum, newInvoiceId: newId, newInvoiceNumber: number, updateRefused: `${e.status}`, debugId: e.debugId };
  }
}

/** Carries out an approved action through PayPal. Used by a run for allowed actions and by the approval queue. */
export async function executeAction(actionId: string) {
  const action = await db.agentAction.findUniqueOrThrow({ where: { id: actionId } });
  const p = payloadOf(action);
  const id = action.paypalInvoiceId;
  try {
    let result: Record<string, unknown> = {};
    let debugId: string | null = null;
    if (SENDS.includes(action.actionType as Action)) {
      // The invoice may have been paid or cancelled since this was proposed: never chase it then.
      const current = await getInvoice(id);
      if (!OPEN_STATUSES.has(current.status)) {
        return db.agentAction.update({
          where: { id: action.id },
          data: { status: 'skipped', guardrail: [`invoice_closed: PayPal shows it as ${current.status.toLowerCase().replaceAll('_', ' ')}`, action.guardrail].filter(Boolean).join('; ') },
        });
      }
    }
    if (action.actionType === 'gentle_reminder' || action.actionType === 'firm_reminder') {
      ({ debugId } = await remindInvoice(id, p.subject ?? '', p.message ?? '', `munim-${action.id}`));
      await recordReminder(id);
      result = { sent: 'reminder' };
    } else if (action.actionType === 'offer_partial') {
      result = await offerPartial(action.id, id, p);
      debugId = (result.debugId as string | null) ?? null;
    } else if (action.actionType === 'escalate_to_owner') {
      result = { handedTo: 'owner' };
    }
    return db.agentAction.update({
      where: { id: action.id },
      data: { status: 'executed', executedAt: new Date(), payload: { ...p, result, debugId } as object },
    });
  } catch (e) {
    return db.agentAction.update({ where: { id: action.id }, data: { status: 'failed', payload: { ...p, ...errorOf(e) } as object } });
  }
}

/** Scores invoices with what Munim knows about them: reminder history, client profile, risk. */
export async function factsFor(candidates: OpenInvoice[], settings: Settings, today: Date): Promise<Facts[]> {
  const ids = candidates.map((c) => c.id);
  const [metas, profiles, recent] = await Promise.all([
    db.invoiceMeta.findMany({ where: { paypalId: { in: ids } } }),
    db.clientProfile.findMany({ where: { email: { in: candidates.map((c) => c.clientEmail) } } }),
    db.agentAction.findMany({
      where: { paypalInvoiceId: { in: ids }, status: 'executed', actionType: { in: SENDS }, executedAt: { gte: new Date(Date.now() - 86_400_000) } },
      select: { paypalInvoiceId: true },
    }),
  ]);
  const metaById = new Map(metas.map((m) => [m.paypalId, m]));
  const profileByEmail = new Map(profiles.map((p) => [p.email, p]));
  return candidates.map((invoice) => {
    const meta = metaById.get(invoice.id);
    const profile = profileByEmail.get(invoice.clientEmail);
    const paymentStyle = profile?.paymentStyle ?? 'unknown';
    const avgDaysLate = profile && paymentStyle !== 'unknown' ? profile.avgDaysLate : null;
    const remindersSent = meta?.remindersSent ?? 0;
    const daysSinceLastReminder = meta?.lastReminderAt ? daysBetween(isoDay(meta.lastReminderAt), isoDay(today)) : null;
    return {
      invoice,
      avgDaysLate,
      paymentStyle,
      remindersSent,
      daysSinceLastReminder,
      // PayPal's own daily limit is real time.
      remindersLast24h: recent.filter((r) => r.paypalInvoiceId === invoice.id).length,
      partialMinimum: Math.round(invoice.amountDue * PARTIAL_MIN_PERCENT) / 100,
      risk: assessRisk({ daysOverdue: invoice.daysOverdue, amountDue: invoice.amountDue, currency: invoice.currency, avgDaysLate, paymentStyle, remindersSent, daysSinceLastReminder, approvalThreshold: settings.approvalThreshold }),
    };
  });
}

/**
 * The assistant's "propose a reminder": the same guardrails as a run, but the result is only ever
 * queued for the owner (status proposed), never sent. Returns the action, or why it was refused.
 */
export async function proposeReminder(invoiceId: string, tone: 'gentle' | 'firm') {
  const [settings, today] = await Promise.all([getSettings(), now()]);
  const invoice = openInvoices([await getInvoice(invoiceId)], today)[0];
  if (!invoice) return { ok: false as const, reason: 'That invoice is not open (it may be paid, cancelled or still a draft).' };
  const already = await db.agentAction.findFirst({ where: { paypalInvoiceId: invoice.id, status: 'proposed' } });
  if (already) return { ok: false as const, reason: `Invoice ${invoice.number} already has an action waiting for approval.`, actionId: already.id };

  const [f] = await factsFor([invoice], settings, today);
  const action: Action = tone === 'firm' ? 'firm_reminder' : 'gentle_reminder';
  const reason = `Requested in the assistant: a ${tone} reminder for ${invoice.number}, ${invoice.daysOverdue > 0 ? `${invoice.daysOverdue} days late` : `due ${invoice.dueDate}`} on ${money(invoice.amountDue, invoice.currency)}.`;
  const v = applyGuardrails({ invoiceId, action, reason, subject: '', message: '' }, f, settings, today);
  const blocking = v.status === 'skipped' ? v.guardrails[0] : null;
  if (blocking) return { ok: false as const, reason: `Guardrail ${blocking.code}: ${blocking.text}.` };

  const created = await db.agentAction.create({
    data: {
      paypalInvoiceId: invoice.id,
      invoiceNumber: invoice.number,
      actionType: v.actionType,
      reason,
      guardrail: guardrailText([{ code: 'requested_in_assistant', text: 'proposed from the assistant, waiting for your approval' }, ...v.guardrails.filter((g) => g.code !== 'over_limit' && g.code !== 'message_rewritten')]),
      status: 'proposed',
      payload: {
        clientName: invoice.clientName,
        clientEmail: invoice.clientEmail,
        amountDue: invoice.amountDue,
        currency: invoice.currency,
        daysOverdue: invoice.daysOverdue,
        riskLevel: f.risk.level,
        riskHits: f.risk.hits.map((h) => h.text),
        subject: v.subject,
        message: v.message,
        decidedBy: 'assistant',
      } satisfies ActionPayload as object,
    },
  });
  return { ok: true as const, actionId: created.id, invoice: invoice.number, actionType: v.actionType, subject: v.subject, message: v.message, guardrails: v.guardrails.map((g) => g.code) };
}

// --- f) The run ------------------------------------------------------------------------------

async function summarise(stats: { scanned: number; executed: number; proposed: number; skipped: number }, notes: string[]): Promise<string> {
  const fallback = [
    `Munim checked ${stats.scanned} open invoice${stats.scanned === 1 ? '' : 's'}, sent ${stats.executed} reminder${stats.executed === 1 ? '' : 's'} and put ${stats.proposed} in your approval queue.`,
    stats.skipped ? `${stats.skipped} ${stats.skipped === 1 ? 'was' : 'were'} left alone, by a guardrail or because nothing was due yet.` : 'Nothing was held back by a guardrail.',
  ].join(' ');
  const model = munimModel();
  if (!model) return fallback;
  try {
    const { text } = await generateText({
      model,
      system: 'Write exactly two short, plain sentences for a small business owner summarising what their collections assistant just did. Use only the facts given. No greeting, no emoji.',
      prompt: `Stats: ${JSON.stringify(stats)}\nEvents:\n${notes.slice(0, 30).join('\n')}`,
    });
    return text.trim().slice(0, 600) || fallback;
  } catch {
    return fallback;
  }
}

export async function runCollections(trigger: 'manual' | 'cron' | 'webhook', onEvent: Emit = () => {}) {
  const notes: string[] = [];
  const say = (message: string) => {
    notes.push(message);
    onEvent({ type: 'progress', message });
  };
  const [settings, today] = await Promise.all([getSettings(), now()]);
  const run = await db.agentRun.create({ data: { trigger } });

  try {
    // a) Sync.
    say('Syncing invoices from PayPal…');
    const invoices = await fetchInvoices(true);
    const added = await refreshClientProfiles(invoices);
    // Payments a webhook may have missed are recorded first, so nothing paid is chased.
    const reconciled = await reconcileAll(invoices, 'run');
    for (const p of reconciled.payments) say(`Payment found: ${p}`);
    const open = openInvoices(invoices, today);
    say(`Synced ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} from PayPal: ${open.length} open${added ? `, ${added} new client${added === 1 ? '' : 's'} added` : ''}.`);

    // Invoices already waiting for the owner are left alone, so the queue never doubles up.
    const waiting = new Set((await db.agentAction.findMany({ where: { status: 'proposed' }, select: { paypalInvoiceId: true } })).map((a) => a.paypalInvoiceId));
    const candidates = open.filter((i) => !waiting.has(i.id));
    if (waiting.size) say(`${waiting.size} invoice${waiting.size === 1 ? ' is' : 's are'} already waiting for your approval, so Munim leaves ${waiting.size === 1 ? 'it' : 'them'} alone.`);

    // b) Score.
    const facts = await factsFor(candidates, settings, today);
    for (const f of facts) if (f.risk.level !== 'low') say(`${f.invoice.number} is ${f.risk.level} risk: ${riskSentence(f.risk)}.`);

    // c) Decide.
    if (facts.length) say(munimModel() ? `Asking the model what to do about ${facts.length} invoice${facts.length === 1 ? '' : 's'}…` : 'No model configured, so Munim decides with its rules.');
    const proposals = await proposeWithModel(facts, settings);

    // d) + e) Guardrails, then act.
    let executed = 0;
    let proposed = 0;
    let skipped = 0;
    for (const f of facts) {
      const proposal = proposals?.get(f.invoice.id) ?? proposeWithRules(f);
      const v = applyGuardrails(proposal, f, settings, today);
      const payload: ActionPayload = {
        runId: run.id,
        clientName: f.invoice.clientName,
        clientEmail: f.invoice.clientEmail,
        amountDue: f.invoice.amountDue,
        currency: f.invoice.currency,
        daysOverdue: f.invoice.daysOverdue,
        riskLevel: f.risk.level,
        riskHits: f.risk.hits.map((h) => h.text),
        ...(proposal.action !== v.actionType && { proposedActionType: proposal.action }),
        subject: v.subject,
        message: v.message,
        ...(v.actionType === 'offer_partial' && { partialMinimum: f.partialMinimum }),
        decidedBy: proposals?.has(f.invoice.id) ? 'model' : 'rules',
      };
      const action = await db.agentAction.create({
        data: {
          paypalInvoiceId: f.invoice.id,
          invoiceNumber: f.invoice.number,
          actionType: v.actionType,
          reason: proposal.reason.slice(0, 400),
          guardrail: guardrailText(v.guardrails),
          status: v.status,
          payload: payload as object,
        },
      });

      const n = f.invoice.number;
      const label = actionLabel(v.actionType).toLowerCase();
      let message: string;
      let status: string = v.status;
      if (v.status === 'approved') {
        const done = await executeAction(action.id);
        status = done.status;
        if (done.status === 'executed') {
          executed++;
          message = `Sent a ${label} for ${n}.`;
        } else message = `Could not send the ${label} for ${n}: ${payloadOf(done).error ?? 'PayPal refused'}.`;
      } else if (v.status === 'proposed') {
        proposed++;
        message = `${n}: ${label}, ${v.guardrails[0].text}, so it's waiting for you.`;
      } else {
        skipped++;
        message = v.guardrails.length ? `${n}: no ${v.actionType === 'none' ? 'action' : label}, ${v.guardrails[0].text}.` : `${n}: nothing to do. ${proposal.reason}`;
      }
      notes.push(message);
      onEvent({ type: 'action', message, invoice: n, actionType: v.actionType, status });
    }

    // f) Save the run.
    say('Writing the run summary…');
    const summary = await summarise({ scanned: facts.length, executed, proposed, skipped }, notes);
    const saved = await db.agentRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), summary, proposed, executed } });
    onEvent({ type: 'done', message: summary, runId: run.id, executed, proposed });
    return saved;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    onEvent({ type: 'error', message });
    return db.agentRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), summary: `Run failed: ${message.slice(0, 500)}` } });
  }
}

export const runFailed = (run: { summary: string | null }) => Boolean(run.summary?.startsWith('Run failed'));

/**
 * Approve (optionally with the owner's edits to the message) or reject a queued action. Claiming it
 * atomically means a double click can't act twice.
 */
export async function decideAction(id: string, decision: 'approve' | 'reject', edits?: { subject?: string; message?: string }) {
  if (decision === 'approve' && edits) {
    const current = await db.agentAction.findUnique({ where: { id } });
    if (current?.status === 'proposed') {
      const p = payloadOf(current);
      await db.agentAction.updateMany({
        where: { id, status: 'proposed' },
        data: { payload: { ...p, subject: edits.subject ?? p.subject, message: edits.message ?? p.message, editedByOwner: true } as object },
      });
    }
  }
  const claimed = await db.agentAction.updateMany({
    where: { id, status: 'proposed' },
    data: decision === 'approve' ? { status: 'approved' } : { status: 'skipped' },
  });
  if (claimed.count === 0) return db.agentAction.findUnique({ where: { id } });
  if (decision === 'reject') {
    const a = await db.agentAction.findUniqueOrThrow({ where: { id } });
    return db.agentAction.update({ where: { id }, data: { guardrail: ['rejected_by_owner: you dismissed it', a.guardrail].filter(Boolean).join('; ') } });
  }
  return executeAction(id);
}
