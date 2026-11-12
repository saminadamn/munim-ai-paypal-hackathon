import { dbEnabled } from '@/lib/db';
import { payloadOf } from '@/lib/munim/action-payload';
import { decideAction } from '@/lib/munim/collect';

// POST { decision: 'approve' | 'reject', subject?, message? } -> approves (and executes through
// PayPal) or rejects a queued action. Only actions with status "proposed" can be decided, once.
export async function POST(request: Request, ctx: RouteContext<'/api/munim/actions/[id]'>) {
  if (!dbEnabled()) return Response.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { decision?: string; subject?: string; message?: string };
  if (body.decision !== 'approve' && body.decision !== 'reject') return Response.json({ error: 'decision must be approve or reject' }, { status: 400 });
  const edits = body.subject !== undefined || body.message !== undefined ? { subject: body.subject, message: body.message } : undefined;
  const action = await decideAction(id, body.decision, edits);
  if (!action) return Response.json({ error: 'No such action.' }, { status: 404 });
  const p = payloadOf(action);
  return Response.json({ id: action.id, status: action.status, invoiceNumber: action.invoiceNumber, result: p.result ?? null, error: p.error ?? null, debugId: p.debugId ?? null });
}
