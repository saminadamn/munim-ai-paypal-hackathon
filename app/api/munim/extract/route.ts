import { addDays, isoDay, now } from '@/lib/clock';
import { dbEnabled } from '@/lib/db';
import { MAIN_CURRENCY } from '@/lib/munim/action-payload';
import { rateLimit, TEN_MINUTES } from '@/lib/rate-limit';
import { matchClient, type ClientMatch } from '@/lib/munim/client-match';
import { extractInvoice } from '@/lib/munim/extract';
import { missingFields, toForm, type InvoiceSource } from '@/lib/munim/invoice-form';

const SOURCES: InvoiceSource[] = ['chat', 'email', 'whatsapp'];

// POST { text, source } -> { form, confidence, missing, assumed, client, dueDate }.
// Reads the message and matches the client. Nothing is sent to PayPal or saved here.
export async function POST(request: Request) {
  const limited = rateLimit(request, 'extract', 20, TEN_MINUTES);
  if (limited) return Response.json({ error: 'Too many messages read from your connection; try again in a few minutes.' }, { status: 429, headers: limited.headers });
  const body = (await request.json().catch(() => ({}))) as { text?: string; source?: string };
  const text = body.text?.trim();
  if (!text) return Response.json({ error: 'Paste or type a message first.' }, { status: 400 });
  const source = SOURCES.includes(body.source as InvoiceSource) ? (body.source as InvoiceSource) : 'chat';

  try {
    const today = await now();
    const extraction = await extractInvoice(text, { source, currency: MAIN_CURRENCY, today });
    const form = toForm(extraction);

    // A known client fills in what the message left out.
    let client: ClientMatch | null = null;
    if (dbEnabled()) {
      client = await matchClient({ name: form.clientName, email: form.clientEmail, company: form.company }).catch(() => null);
      if (client) {
        if (!form.clientEmail) form.clientEmail = client.email;
        if (!form.company && client.company) form.company = client.company;
      }
    }

    return Response.json({
      form,
      confidence: extraction.confidence,
      // What the model said it assumed, minus anything the client match has since filled in.
      assumed: extraction.missingFields.filter((f) => !(client && (f === 'clientEmail' || f === 'company'))),
      missing: missingFields(form),
      client,
      today: isoDay(today),
      dueDate: form.dueInDays === null ? null : isoDay(addDays(today, form.dueInDays)),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Munim could not read that message.' }, { status: 502 });
  }
}
