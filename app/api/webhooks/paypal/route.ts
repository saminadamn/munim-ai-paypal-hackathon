import { after } from 'next/server';
import { processWebhook } from '@/lib/munim/webhook';

// PayPal webhook: INVOICING.INVOICE.PAID, .CANCELLED and .UPDATED.
//
// Answers 200 straight away and does the work after the response (Next's after()), so PayPal
// never times out and retries. lib/munim/webhook.ts verifies every event with PayPal's
// /v1/notifications/verify-webhook-signature against PAYPAL_WEBHOOK_ID before anything changes; an
// event that fails verification is logged and ignored, still with a 200.
//
// Register https://<your app>/api/webhooks/paypal in the sandbox app's Webhooks settings and set
// PAYPAL_WEBHOOK_ID to the id PayPal gives it. PayPal's webhook simulator sends events that cannot
// be verified, so test with a real sandbox payment.

export async function POST(request: Request) {
  // The body is read as text so the event PayPal verifies is exactly what it sent.
  const raw = await request.text();
  const h = request.headers;
  const signature = {
    authAlgo: h.get('paypal-auth-algo') ?? '',
    certUrl: h.get('paypal-cert-url') ?? '',
    transmissionId: h.get('paypal-transmission-id') ?? '',
    transmissionSig: h.get('paypal-transmission-sig') ?? '',
    transmissionTime: h.get('paypal-transmission-time') ?? '',
  };
  after(() => processWebhook(raw, signature));
  return Response.json({ received: true });
}
