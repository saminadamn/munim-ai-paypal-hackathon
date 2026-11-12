// AgentAction keeps its details in `payload` (Json). This is the one place that knows its shape.

import type { AgentAction } from '../generated/prisma/client';

export type ActionPayload = {
  runId?: string;
  clientName?: string;
  clientEmail?: string;
  amountDue?: number;
  currency?: string;
  daysOverdue?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  /** The risk rules this invoice hit, as sentences. */
  riskHits?: string[];
  /** What the model proposed, when code changed it. */
  proposedActionType?: string;
  /** model | rules */
  decidedBy?: string;
  /** The email PayPal sends the client. */
  subject?: string;
  message?: string;
  editedByOwner?: boolean;
  partialMinimum?: number;
  result?: Record<string, unknown>;
  error?: string;
  /** Dedupes payment_received records: invoice id and paid amount. */
  paymentKey?: string;
  /** PayPal's debug id for the call that executed (or failed) this action. */
  debugId?: string | null;
};

export const payloadOf = (a: Pick<AgentAction, 'payload'>): ActionPayload => (a.payload ?? {}) as ActionPayload;

export const ACTION_LABELS: Record<string, string> = {
  none: 'No action',
  gentle_reminder: 'Gentle reminder',
  firm_reminder: 'Firm reminder',
  offer_partial: 'Offer part-payment',
  escalate_to_owner: 'Hand to owner',
  create_invoice: 'Invoice sent',
  payment_received: 'Payment received',
  invoice_cancelled: 'Invoice cancelled',
};

export const actionLabel = (type: string) => ACTION_LABELS[type] ?? type;

/** Totals and forecasts use one currency; amounts in others are listed, never converted. */
export const MAIN_CURRENCY = (process.env.MUNIM_CURRENCY ?? 'USD').toUpperCase();
/** offer_partial asks for at least this share of the amount due. */
export const PARTIAL_MIN_PERCENT = 50;
