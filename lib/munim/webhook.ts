// Processes one PayPal webhook delivery after the route has already answered 200
// (app/api/webhooks/paypal). Verify first; change nothing unless PayPal says SUCCESS.

import { dbEnabled } from '../db';
import { verifyWebhookSignature, type WebhookEvent } from '../paypal';
import { handleInvoiceEvent } from './payments';

const HANDLED = new Set(['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.CANCELLED', 'INVOICING.INVOICE.UPDATED']);

export type WebhookSignature = { authAlgo: string; certUrl: string; transmissionId: string; transmissionSig: string; transmissionTime: string };

export type WebhookOutcome = { status: 'ignored' | 'verified' | 'handled' | 'failed'; message: string };

export async function processWebhook(raw: string, signature: WebhookSignature): Promise<WebhookOutcome> {
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return log({ status: 'ignored', message: 'body is not JSON' });
  }
  const tag = `${event.event_type ?? '?'} ${event.id ?? ''}`;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return log({ status: 'ignored', message: `${tag}: PAYPAL_WEBHOOK_ID is not set, so it cannot be verified` });
  if (Object.values(signature).some((v) => !v)) return log({ status: 'ignored', message: `${tag}: PAYPAL-* signature headers missing` });

  try {
    const result = await verifyWebhookSignature({ ...signature, webhookId, event });
    if (result !== 'SUCCESS') return log({ status: 'ignored', message: `${tag}: signature verification returned ${result}` });
  } catch (e) {
    return log({ status: 'ignored', message: `${tag}: verification call failed (${e instanceof Error ? e.message.slice(0, 200) : e})` });
  }

  if (!HANDLED.has(event.event_type)) return log({ status: 'verified', message: `${tag}: verified; not an event Munim handles` });
  if (!dbEnabled()) return log({ status: 'verified', message: `${tag}: verified but DATABASE_URL is not set` });
  try {
    const result = await handleInvoiceEvent(event);
    return log({ status: 'handled', message: `${tag}: ${result.note}` });
  } catch (e) {
    return log({ status: 'failed', message: `${tag}: handling failed; Sync from PayPal or the next run will pick it up (${e instanceof Error ? e.message.slice(0, 200) : e})` });
  }
}

function log(o: WebhookOutcome) {
  (o.status === 'ignored' || o.status === 'failed' ? console.warn : console.log)(`[webhook] ${o.status}: ${o.message}`);
  return o;
}
