// FORECAST: the next 30 days of cash. A heuristic, labelled as one wherever it is shown.
//
//   start            PayPal available balance (GET /v1/reporting/balances) in Munim's currency
//   expected date    due date + the client's average days late, never before today (Munim's clock)
//   probability      by payment style: prompt 0.95, slow 0.80, partial 0.60, unknown 0.85
//   expected inflow  amount due x probability, on the expected date
//   "do nothing"     slow and partial clients pay 10 days later still, with 0.15 less probability
//
// computeForecast() is pure, so the dashboard can build it from data it has already fetched.

import { addDays, daysBetween, isoDay, now } from '../clock';
import { db, dbEnabled } from '../db';
import { amountOf, getBalances, type Balances, type Invoice } from '../paypal';
import { MAIN_CURRENCY } from './action-payload';
import { clientHistories, fetchInvoices, openInvoices } from './receivables';

export const HORIZON_DAYS = 30;
export const PROBABILITY: Record<string, number> = { prompt: 0.95, slow: 0.8, partial: 0.6, unknown: 0.85 };
const DO_NOTHING_EXTRA_DAYS = 10;
const DO_NOTHING_PROBABILITY_CUT = 0.15;

export const FORECAST_HEURISTIC = [
  'Heuristic, not a prediction.',
  "Each open invoice is expected on its due date plus the client's average days late (never before today).",
  'Chance of payment by payment style: prompt 95%, slow 80%, part-payer 60%, no history 85%.',
  `"Do nothing" assumes slow and part-paying clients pay ${DO_NOTHING_EXTRA_DAYS} days later still, with ${DO_NOTHING_PROBABILITY_CUT * 100} points less chance, when nobody chases them.`,
  'Starts from the PayPal available balance; amounts in other currencies are left out, not converted.',
];

export type ProfileLite = { email: string; avgDaysLate: number; paymentStyle: string };

export type ForecastRow = {
  date: string;
  day: number;
  expected_inflow: number;
  cumulative_expected: number;
  do_nothing_inflow: number;
  do_nothing_cumulative: number;
};

export type ForecastInvoice = {
  id: string;
  number: string;
  client: string;
  clientEmail: string;
  amountDue: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  paymentStyle: string;
  avgDaysLate: number;
  expectedPayDate: string;
  probability: number;
  doNothingPayDate: string;
  doNothingProbability: number;
  inHorizon: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeForecast(input: { invoices: Invoice[]; balances: Balances | null; profiles: ProfileLite[]; today: Date; currency?: string }) {
  const currency = input.currency ?? MAIN_CURRENCY;
  const today = isoDay(input.today);
  const balance = input.balances?.balances?.find((b) => b.currency === currency);
  const startBalance = balance ? amountOf(balance.available_balance ?? balance.total_balance) : 0;

  // Stored profiles win; PayPal history fills in clients Munim hasn't profiled yet.
  const stored = new Map(input.profiles.map((p) => [p.email, p]));
  const learned = new Map(clientHistories(input.invoices).map((h) => [h.email, h]));
  const styleOf = (email: string) => {
    const p = stored.get(email);
    if (p && (p.paymentStyle !== 'unknown' || !learned.has(email))) return { style: p.paymentStyle, late: p.avgDaysLate };
    const h = learned.get(email);
    return { style: h?.paymentStyle ?? 'unknown', late: h?.avgDaysLate ?? 0 };
  };

  const open = openInvoices(input.invoices, input.today);
  const horizonEnd = isoDay(addDays(input.today, HORIZON_DAYS));
  const notBeforeToday = (d: string) => (d < today ? today : d);

  const invoices: ForecastInvoice[] = open
    .filter((i) => i.currency === currency)
    .map((i) => {
      const { style, late } = styleOf(i.clientEmail);
      const expected = notBeforeToday(isoDay(addDays(new Date(`${i.dueDate}T00:00:00Z`), Math.round(late))));
      const probability = PROBABILITY[style] ?? PROBABILITY.unknown;
      const slowed = style === 'slow' || style === 'partial';
      const doNothingPayDate = slowed ? isoDay(addDays(new Date(`${expected}T00:00:00Z`), DO_NOTHING_EXTRA_DAYS)) : expected;
      return {
        id: i.id,
        number: i.number,
        client: i.clientName,
        clientEmail: i.clientEmail,
        amountDue: i.amountDue,
        currency: i.currency,
        dueDate: i.dueDate,
        daysOverdue: i.daysOverdue,
        paymentStyle: style,
        avgDaysLate: late,
        expectedPayDate: expected,
        probability,
        doNothingPayDate,
        doNothingProbability: slowed ? round2(Math.max(0, probability - DO_NOTHING_PROBABILITY_CUT)) : probability,
        inHorizon: expected <= horizonEnd,
      };
    })
    .sort((a, b) => a.expectedPayDate.localeCompare(b.expectedPayDate));

  const rows: ForecastRow[] = [];
  let withMunim = startBalance;
  let doNothing = startBalance;
  for (let day = 0; day <= HORIZON_DAYS; day++) {
    const date = isoDay(addDays(input.today, day));
    const inflow = invoices.filter((i) => i.expectedPayDate === date).reduce((s, i) => s + i.amountDue * i.probability, 0);
    const inflowDoNothing = invoices.filter((i) => i.doNothingPayDate === date).reduce((s, i) => s + i.amountDue * i.doNothingProbability, 0);
    withMunim += inflow;
    doNothing += inflowDoNothing;
    rows.push({
      date,
      day,
      expected_inflow: round2(inflow),
      cumulative_expected: round2(withMunim),
      do_nothing_inflow: round2(inflowDoNothing),
      do_nothing_cumulative: round2(doNothing),
    });
  }

  const last = rows.at(-1)!;
  return {
    today,
    currency,
    startBalance: round2(startBalance),
    balanceAvailable: Boolean(balance),
    endWithMunim: last.cumulative_expected,
    endDoNothing: last.do_nothing_cumulative,
    openTotal: round2(invoices.reduce((s, i) => s + i.amountDue, 0)),
    otherCurrencies: [...new Set(open.filter((i) => i.currency !== currency).map((i) => i.currency))],
    rows,
    invoices,
    heuristic: FORECAST_HEURISTIC,
  };
}

export type Forecast = ReturnType<typeof computeForecast>;

/** Fetches what the forecast needs, for the forecast page and the assistant. */
export async function buildForecast(): Promise<Forecast> {
  const today = await now();
  const [invoices, balances, profiles] = await Promise.all([
    fetchInvoices(),
    getBalances().catch(() => null),
    dbEnabled() ? db.clientProfile.findMany({ select: { email: true, avgDaysLate: true, paymentStyle: true } }) : [],
  ]);
  return computeForecast({ invoices, balances, profiles, today });
}

/** The forecast on one date: "Will I have $3,000 by the 30th?" */
export function forecastOn(f: Forecast, date: string) {
  const row = f.rows.find((r) => r.date === date) ?? (date > f.rows.at(-1)!.date ? f.rows.at(-1)! : f.rows[0]);
  return {
    date: row.date,
    asked: date,
    beyondHorizon: date > f.rows.at(-1)!.date,
    daysFromToday: daysBetween(f.today, row.date),
    currency: f.currency,
    startBalance: f.startBalance,
    expectedWithMunim: row.cumulative_expected,
    expectedIfNothingIsDone: row.do_nothing_cumulative,
    expectedPaymentsByThen: f.invoices
      .filter((i) => i.expectedPayDate <= row.date)
      .map((i) => ({ invoice: i.number, client: i.client, amountDue: i.amountDue, expectedPayDate: i.expectedPayDate, probability: i.probability })),
    heuristic: f.heuristic,
  };
}
