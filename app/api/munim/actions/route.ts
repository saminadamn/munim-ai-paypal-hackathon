import { db, dbEnabled } from '@/lib/db';
import { actionLabel, payloadOf } from '@/lib/munim/action-payload';

// GET ?status=proposed -> AgentActions, newest first. The approval-queue widget and the assistant read this.
export async function GET(request: Request) {
  if (!dbEnabled()) return Response.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });
  const status = new URL(request.url).searchParams.get('status') ?? 'proposed';
  const actions = await db.agentAction.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 50 });
  return Response.json(
    actions.map((a) => {
      const p = payloadOf(a);
      return {
        id: a.id,
        createdAt: a.createdAt.toISOString(),
        invoiceId: a.paypalInvoiceId,
        invoiceNumber: a.invoiceNumber,
        actionType: a.actionType,
        label: actionLabel(a.actionType),
        status: a.status,
        reason: a.reason,
        guardrail: a.guardrail,
        client: p.clientName ?? null,
        amountDue: p.amountDue ?? null,
        currency: p.currency ?? null,
        daysOverdue: p.daysOverdue ?? null,
        riskLevel: p.riskLevel ?? null,
        subject: p.subject ?? '',
        message: p.message ?? '',
        partialMinimum: p.partialMinimum ?? null,
      };
    }),
  );
}
