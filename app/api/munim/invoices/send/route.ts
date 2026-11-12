import { db, dbEnabled, getSettings } from '@/lib/db';
import { formSchema, formTotal, missingFields, SOURCE_PHRASE, toPayPalPayload, type InvoiceSource } from '@/lib/munim/invoice-form';
import { createDraftInvoice, generateNextInvoiceNumber, getInvoice, PayPalApiError, sendInvoice } from '@/lib/paypal';

const SOURCES: InvoiceSource[] = ['chat', 'email', 'whatsapp'];

// POST { form, source, rawInput, requestId } -> creates the invoice in PayPal and sends it.
// Called only when the owner presses Approve, so the owner's approval is this action's guardrail.
//   ClientProfile upsert -> next invoice number -> create draft -> send -> InvoiceMeta -> AgentAction
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { form?: unknown; source?: string; rawInput?: string; requestId?: string };
  const parsed = formSchema.safeParse(body.form);
  if (!parsed.success) return Response.json({ error: 'The draft is incomplete.' }, { status: 400 });
  const form = parsed.data;
  const missing = missingFields(form);
  if (missing.length) return Response.json({ error: 'Fill in the highlighted fields first.', missing }, { status: 400 });
  const source = SOURCES.includes(body.source as InvoiceSource) ? (body.source as InvoiceSource) : 'chat';
  const email = form.clientEmail.trim().toLowerCase();
  const total = formTotal(form);
  // The same requestId on a retried click lets PayPal de-duplicate the create and the send.
  const key = body.requestId ?? crypto.randomUUID();

  let step = 'saving the client';
  try {
    let existingClient = false;
    let approver = 'the owner';
    if (dbEnabled()) {
      const { ownerName } = await getSettings();
      if (ownerName && ownerName !== 'Owner') approver = ownerName;
      const known = await db.clientProfile.findUnique({ where: { email } });
      existingClient = Boolean(known);
      await db.clientProfile.upsert({
        where: { email },
        update: { name: form.clientName.trim(), ...(form.company.trim() && { company: form.company.trim() }) },
        create: { email, name: form.clientName.trim(), company: form.company.trim() || null },
      });
    }

    step = 'getting an invoice number';
    const number = await generateNextInvoiceNumber();
    step = 'creating the invoice';
    const id = await createDraftInvoice(toPayPalPayload(form, number), `munim-create-${key}`);
    step = 'sending the invoice';
    await sendInvoice(id, { note: form.notes.trim() || undefined }, `munim-send-${key}`);
    // The payer link is on the invoice once it has been sent.
    const sent = await getInvoice(id).catch(() => null);
    const payerUrl = (sent?.detail as { metadata?: { recipient_view_url?: string } } | undefined)?.metadata?.recipient_view_url ?? null;

    const n = form.items.length;
    const reason = `Created from ${SOURCE_PHRASE[source]}; ${source === 'email' ? 'client confirmed' : 'message listed'} ${n} item${n === 1 ? '' : 's'} totalling ${form.currency} ${total.toFixed(2)}${existingClient ? ' for an existing client' : ''}, approved by ${approver}.`;

    if (dbEnabled()) {
      step = 'recording the invoice';
      await db.invoiceMeta.upsert({
        where: { paypalId: id },
        update: {},
        create: { paypalId: id, source, rawInput: body.rawInput?.slice(0, 20_000) ?? null },
      });
      await db.agentAction.create({
        data: {
          paypalInvoiceId: id,
          invoiceNumber: number,
          actionType: 'create_invoice',
          status: 'executed',
          reason,
          payload: { clientName: form.clientName, clientEmail: email, amountDue: total, currency: form.currency, result: { payerUrl } },
          executedAt: new Date(),
        },
      });
    }
    return Response.json({ id, number, total, currency: form.currency, payerUrl, reason });
  } catch (e) {
    let message = e instanceof Error ? e.message : 'Send failed.';
    const debugId = e instanceof PayPalApiError ? e.debugId : null;
    if (e instanceof PayPalApiError) {
      message = `PayPal refused while ${step} (HTTP ${e.status}).`;
      if (/CURRENCY|currency/.test(e.message)) message += ` Your sandbox business account may not accept ${form.currency} invoices; change the currency and amounts, then send again.`;
      message += ` ${e.message.slice(0, 300)}`;
    }
    return Response.json({ error: message, debugId }, { status: 502 });
  }
}
