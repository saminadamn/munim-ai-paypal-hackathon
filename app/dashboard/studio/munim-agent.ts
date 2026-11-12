// ASK: Munim as a custom agent in AG Studio's assistant, built on the Studio Agent Framework
// (directLlmRunner + client tools from api.defineAiTool + the harness's delegateTo).
//
// Its tools call this app's own API from the browser. None of them holds a secret: the OpenAI key
// stays behind /api/ai/responses (the adapter's endpoint) and the cron key behind
// /api/munim/agent/run. Reading is free; writing is limited to proposing (never sending) and to
// approving an action the owner has asked for by name. Chart and page building is delegated to
// Studio's built-in agents.

import {
  directLlmRunner,
  type AgAiHarnessBuilderTools,
  type AgAiParamsBuilder,
  type AgAiTool,
  type AgExternalShape,
  type AgLlmAdapter,
  type AgStudioApi,
} from 'ag-studio';
import { notifyMunimChanged } from './widgets/events';

async function call(url: string, init: RequestInit | undefined, signal: AbortSignal) {
  const res = await fetch(url, { ...init, signal, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  // A refused proposal (409) is an answer, not a failure: the model should relay the guardrail.
  const ok = res.ok || (res.status === 409 && body && body.ok === false);
  return { ok, body };
}

const ask = (tool: string, args: Record<string, unknown>) => ['/api/munim/ask', { method: 'POST', body: JSON.stringify({ tool, args }) }] as const;

function munimTools(api: AgStudioApi): AgAiTool[] {
  const tool = (
    name: string,
    description: string,
    params: (s: AgAiParamsBuilder) => AgExternalShape<Record<string, unknown>>,
    request: (args: Record<string, unknown>) => readonly [string, RequestInit?],
    opts: { writes?: boolean } = {},
  ) =>
    api.defineAiTool({
      name,
      description,
      params,
      execute: async (args: Record<string, unknown>, ctx) => {
        const [url, init] = request(args);
        const { ok, body } = await call(url, init, ctx.signal);
        if (opts.writes && ok) notifyMunimChanged();
        return ok ? ctx.success(JSON.stringify(body), body) : ctx.error(String(body?.error ?? body?.reason ?? 'The request failed.'));
      },
    });

  return [
    tool(
      'getOpenInvoices',
      'Open invoices from PayPal: invoiceId (PayPal id, needed by proposeReminder), number, client, amount due and currency, due date, days overdue (negative = not due yet), risk level with the rules it hit, reminders sent, and the last action Munim took with its reason. Filter by client, minimum days overdue, or risk level.',
      (s) =>
        s.object({
          client: s.string({ description: 'Part of a client name or email; omit for all clients' }).optional(),
          minDaysOverdue: s.number({ description: 'Only invoices at least this many days overdue. 8 = more than a week late.' }).optional(),
          riskLevel: s.enum(['low', 'medium', 'high'] as const, { description: 'Only invoices at this risk level' }).optional(),
        }),
      (args) => ask('open_invoices', args),
    ),
    tool(
      'getClientProfile',
      "A client's profile: payment style (prompt, slow, partial, unknown), average days late, invoices paid and open, outstanding amount, the owner's notes, and their open invoices.",
      (s) => s.object({ email: s.string({ description: "The client's email, or part of their name if the email is unknown" }) }),
      (args) => ask('client_profile', { client: args.email }),
    ),
    tool(
      'getForecast',
      "Munim's 30-day cash forecast (a heuristic). With a date (YYYY-MM-DD): expected cash on that date with Munim chasing and if nothing is done, and the payments expected by then. Without a date: today's date, the starting PayPal balance, weekly values and the biggest expected payments.",
      (s) => s.object({ date: s.string({ description: 'YYYY-MM-DD; omit for the overview, which also tells you today\'s date' }).optional() }),
      (args) => ask('cash_forecast', args.date ? { date: args.date } : {}),
    ),
    tool(
      'getApprovalQueue',
      "Actions waiting for the owner's approval: action id, invoice, client, amount, the reason, why it is waiting, and the drafted message.",
      (s) => s.object({}),
      () => ['/api/munim/actions?status=proposed'],
    ),
    tool(
      'getActivity',
      'What Munim has done recently: the last run and recent actions with their reasons, statuses and guardrails.',
      (s) => s.object({ status: s.enum(['executed', 'proposed', 'skipped', 'failed'] as const).optional() }),
      (args) => ask('munim_activity', args),
    ),
    tool(
      'proposeReminder',
      "Drafts a reminder for one invoice and puts it in the owner's approval queue. Never sends anything. The usual guardrails apply (reminder limits, spacing, quiet weekends); if one blocks it, you get the reason instead.",
      (s) =>
        s.object({
          invoiceId: s.string({ description: 'The PayPal invoice id (invoiceId from getOpenInvoices), not the invoice number' }),
          tone: s.enum(['gentle', 'firm'] as const, { description: 'firm only if a reminder has already been sent' }),
        }),
      (args) => ['/api/munim/agent/propose', { method: 'POST', body: JSON.stringify(args) }],
      { writes: true },
    ),
    tool(
      'runCollections',
      'Runs a full collections pass now, the same as the hourly job: syncs PayPal, sends the reminders the guardrails allow, and queues the rest for approval. Returns the run summary.',
      (s) => s.object({}),
      () => ['/api/munim/agent/run', { method: 'POST' }],
      { writes: true },
    ),
    tool(
      'approveAction',
      'Approves one action in the approval queue, which executes it through PayPal (for example sends the reminder). Only for an action the owner has asked, in this conversation, to approve.',
      (s) => s.object({ id: s.string({ description: 'The action id from getApprovalQueue' }) }),
      (args) => [`/api/munim/actions/${encodeURIComponent(String(args.id))}`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }],
      { writes: true },
    ),
  ];
}

const INSTRUCTIONS = `You are Munim, the finance clerk for a small business, working inside the owner's PayPal dashboard.
Your job: say who owes what, chase late payments within the owner's guardrails, and tell the owner what their cash will look like.

How to answer
- Use your tools for every number; never answer from memory. Quote amounts with their currency and never add different currencies together.
- Lead with the answer, then at most three supporting facts. When you mention something Munim did, give its reason.
- The forecast is a heuristic (due date plus the client's usual lateness, weighted by payment style). Say so whenever you quote it. For "will I have X by <date>", call getForecast with that date (call it without a date first if you need today's date) and compare against both lines.

What you may do
- proposeReminder only queues a reminder for approval; it never sends. Use gentle unless a reminder has already been sent on that invoice. For "chase everyone more than a week late", call getOpenInvoices with minDaysOverdue 8, propose a reminder for each, then report how many were queued and which a guardrail blocked, and point the owner to the approval queue.
- runCollections only when the owner asks you to run Munim or chase now.
- approveAction only for an action the owner has explicitly asked you to approve in this conversation, identified by invoice or client. Never approve on your own initiative, never approve everything unless the owner says so in those words, and confirm what was sent afterwards.
- You cannot change guardrails, cancel invoices or move money. Say where the owner can: Agent page for guardrails, PayPal for refunds.

Charts and pages
- For any chart, table, KPI or page ("show me overdue by client as a chart", "add a chart of collections by week"), delegate to the "lead" agent with a precise brief: the widget type, the fields and the data sources. Munim's sources are forecast (cumulative_expected vs do_nothing_cumulative by date; never sum across days), client_profiles, agent_actions (status, guardrail, amountDue, executed) and agent_runs. PayPal's are invoices (overdueAmount, outstanding, currency, customerId), customers, invoicePayments (date, signedAmount: use it for collections by week), transactions and balances.`;

export function munimAgent(adapter: AgLlmAdapter, api: AgStudioApi, tools: AgAiHarnessBuilderTools) {
  return directLlmRunner({
    id: 'munim',
    name: 'Munim',
    description: "The business's finance clerk: answers money questions from live PayPal data, proposes reminders, runs collections, and approves queued actions on request.",
    instructions: () => INSTRUCTIONS,
    tools: () => [...munimTools(api), tools.delegateTo(['lead', 'page', 'widget', 'data', 'planning']), tools.renameThread()],
    maxTurns: 30,
    adapter,
  });
}
