// INVOICE, step 1: the model reads a messy message and returns a structured draft. Code then checks
// the draft (lib/munim/invoice-form.ts) and matches the client against ClientProfile.

import { generateText, Output } from 'ai';
import { isoDay } from '../clock';
import { extractionSchema, type Extraction, type InvoiceSource } from './invoice-form';
import { munimModel } from './llm';

const SYSTEM = `You turn a small business owner's messy message into an invoice draft.
The message may be an email thread, a WhatsApp chat or one typed sentence, in English, Hindi or Hinglish.
Rules:
- Extract only what the message states. Never invent an email address, a company, a price or a due date: use null and list the key in missingFields.
- In an email thread, the client is the other party (usually the sender of the latest message), and the deliverables are what they confirmed, with the prices they confirmed.
- Hinglish: "hazaar"/"hazar"/"k" = thousand, "lakh" = 100000, "sau" = hundred. "kar do"/"bana do" = please do. "tak" = by.
- Currency: "₹", "Rs", "rupees", or an Indian-language message with a bare number = INR; "$" = USD; "€" = EUR; "£" = GBP. Otherwise use DEFAULT_CURRENCY and list "currency" in missingFields.
- If only a total is given for several deliverables, list each deliverable and split the total only if the message says how; otherwise one line named after all of them with the total as its price.
- "N items at X each" = quantity N, unitPrice X. A fixed fee = quantity 1.
- Due dates, counted from today (TODAY, a WEEKDAY): "in N days" / "net N" = N; "next friday" = days to the Friday of next week; "end of month" = days to the last day of this month; "kal" = 1; "agle hafte" / "next week" = 7.
- confidence: 0.9+ when client, every price and the due date are explicit; lower for each thing you had to assume.`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SOURCE_HINT: Record<InvoiceSource, string> = { chat: 'a typed sentence', email: 'an email thread', whatsapp: 'a WhatsApp message' };

export async function extractInvoice(text: string, opts: { source: InvoiceSource; currency: string; today: Date }): Promise<Extraction> {
  const model = munimModel();
  if (!model) throw new Error('Set GEMINI_API_KEY so Munim can read messages.');
  const { output } = await generateText({
    model,
    output: Output.object({ schema: extractionSchema }),
    system: SYSTEM.replace('DEFAULT_CURRENCY', opts.currency)
      .replace('TODAY', isoDay(opts.today))
      .replace('WEEKDAY', WEEKDAYS[opts.today.getUTCDay()]),
    prompt: `This is ${SOURCE_HINT[opts.source]}.\n"""\n${text.slice(0, 8000)}\n"""`,
  });
  return { ...output, confidence: Math.min(1, Math.max(0, output.confidence)) };
}
