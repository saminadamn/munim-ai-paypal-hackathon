'use server';

// Server Actions behind Munim's buttons. Pages render per request, so refresh() redraws them with
// the new state.

import { refresh, revalidatePath } from 'next/cache';
import { db, getSettings } from '@/lib/db';
import { payloadOf } from '@/lib/munim/action-payload';
import { decideAction } from '@/lib/munim/collect';
import { syncFromPayPal } from '@/lib/munim/payments';
import { PayPalApiError, testInvoicesEndpoint } from '@/lib/paypal';

export async function decide(id: string, decision: 'approve' | 'reject', edits?: { subject: string; message: string }) {
  const action = await decideAction(id, decision, edits);
  refresh();
  const p = action ? payloadOf(action) : undefined;
  return { status: action?.status ?? 'missing', error: p?.error, debugId: p?.debugId ?? null, guardrail: action?.guardrail ?? null };
}

/** Fallback for a missed webhook: re-read PayPal, record new payments and cancellations. */
export async function syncNow() {
  try {
    const r = await syncFromPayPal();
    refresh();
    return { summary: r.summary, payments: r.payments, failed: false, debugId: null };
  } catch (e) {
    return {
      summary: `Sync failed: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`,
      payments: [],
      failed: true,
      debugId: e instanceof PayPalApiError ? e.debugId : null,
    };
  }
}

export async function shiftClock(days: number | 'reset') {
  const settings = await getSettings();
  const demoOffsetDays = days === 'reset' ? 0 : Math.max(0, Math.min(365, settings.demoOffsetDays + days));
  await db.settings.update({ where: { id: 1 }, data: { demoOffsetDays } });
  // Every page that reads the clock is rendered per request; revalidate the whole tree and redraw this one.
  revalidatePath('/', 'layout');
  refresh();
  return { demoOffsetDays };
}

export async function saveSettings(form: FormData) {
  const num = (k: string, min: number, max: number, fallback: number) => {
    const n = Number(form.get(k));
    return Number.isFinite(n) && form.get(k) !== '' ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const text = (k: string, fallback: string) => String(form.get(k) ?? '').trim().slice(0, 100) || fallback;
  const s = await getSettings();
  await db.settings.update({
    where: { id: 1 },
    data: {
      businessName: text('businessName', s.businessName),
      ownerName: text('ownerName', s.ownerName),
      quietWeekends: form.get('quietWeekends') === 'on',
      approvalThreshold: num('approvalThreshold', 0, 1_000_000, s.approvalThreshold),
      minDaysBetweenReminders: Math.round(num('minDaysBetweenReminders', 1, 30, s.minDaysBetweenReminders)),
      maxRemindersPerInvoice: Math.round(num('maxRemindersPerInvoice', 1, 10, s.maxRemindersPerInvoice)),
      demoOffsetDays: Math.round(num('demoOffsetDays', 0, 365, s.demoOffsetDays)),
    },
  });
  refresh();
}

export type PayPalTestResult = {
  ok: boolean;
  status: number;
  ms: number;
  debugId: string | null;
  total?: number;
  invoices?: { id: string; number: string; status: string }[];
  error?: string;
};

/** Developer page: one call to the sandbox's invoice list, reported as PayPal answered it. */
export async function testPayPal(): Promise<PayPalTestResult> {
  try {
    const res = await testInvoicesEndpoint();
    refresh();
    if (typeof res.body === 'string') return { ok: false, status: res.status, ms: res.ms, debugId: res.debugId, error: res.body.slice(0, 500) };
    return {
      ok: true,
      status: res.status,
      ms: res.ms,
      debugId: res.debugId,
      total: res.body.total_items ?? res.body.items?.length ?? 0,
      invoices: (res.body.items ?? []).map((i) => ({ id: i.id, number: i.detail?.invoice_number ?? '', status: i.status })),
    };
  } catch (e) {
    // No response at all: missing credentials, a failed OAuth token, or the network.
    refresh();
    return { ok: false, status: 0, ms: 0, debugId: null, error: e instanceof Error ? e.message.slice(0, 500) : String(e) };
  }
}
