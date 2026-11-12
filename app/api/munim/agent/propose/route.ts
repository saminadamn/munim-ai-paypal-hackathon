import { dbEnabled } from '@/lib/db';
import { proposeReminder } from '@/lib/munim/collect';
import { PayPalApiError } from '@/lib/paypal';

// POST { invoiceId, tone: 'gentle' | 'firm' } -> queues a reminder for the owner's approval. Never sends.
export async function POST(request: Request) {
  if (!dbEnabled()) return Response.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });
  const { invoiceId, tone } = (await request.json().catch(() => ({}))) as { invoiceId?: string; tone?: string };
  if (!invoiceId) return Response.json({ error: 'invoiceId is required (the PayPal invoice id, e.g. INV2-...)' }, { status: 400 });
  try {
    const result = await proposeReminder(invoiceId, tone === 'firm' ? 'firm' : 'gentle');
    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (e) {
    const status = e instanceof PayPalApiError && e.status === 404 ? 404 : 502;
    return Response.json({ ok: false, reason: e instanceof Error ? e.message.slice(0, 300) : String(e) }, { status });
  }
}
