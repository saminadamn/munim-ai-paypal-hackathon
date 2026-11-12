import { formatMoney } from '../format';

// How Munim scores an open invoice: plain rules, each worth points, listed on the Agent page. The
// same invoice always gets the same score, and every score comes with the rules it hit.

export type RiskInput = {
  daysOverdue: number; // negative = due in N days
  amountDue: number;
  currency: string;
  avgDaysLate: number | null; // null = no paid invoices yet
  paymentStyle: string; // prompt | slow | partial | unknown
  remindersSent: number;
  daysSinceLastReminder: number | null;
  approvalThreshold: number;
};

export type RiskHit = { rule: string; points: number; text: string };
export type RiskLevel = 'low' | 'medium' | 'high';
export type Risk = { level: RiskLevel; points: number; hits: RiskHit[] };

/** The rules, in the order they are checked. Shown verbatim on the Agent page. */
export const RISK_RULES: { rule: string; points: string; when: string }[] = [
  { rule: 'overdue', points: '+1 / +2 / +3', when: '1-7, 8-30 or more than 30 days past the due date' },
  { rule: 'later than usual', points: '+1', when: "more than 3 days later than this client's average lateness" },
  { rule: 'slow payer', points: '+1', when: 'the client pays more than 7 days late on average' },
  { rule: 'pays in parts', points: '+1', when: 'the client has paid an invoice in parts before' },
  { rule: 'no history', points: '+1', when: 'the client has never paid an invoice yet' },
  { rule: 'large amount', points: '+1 / +2', when: 'amount due above the approval limit, or above 4x it' },
  { rule: 'ignored reminders', points: '+1 each, max +2', when: 'reminders already sent on this invoice' },
];

export const RISK_LEVELS = 'Low under 2 points, medium 2-4, high 5 or more.';

export function assessRisk(r: RiskInput): Risk {
  const hits: RiskHit[] = [];
  const hit = (rule: string, points: number, text: string) => hits.push({ rule, points, text });
  const money = formatMoney(r.amountDue, r.currency, { code: true, whole: Number.isInteger(r.amountDue) });

  if (r.daysOverdue > 30) hit('overdue', 3, `${r.daysOverdue} days late`);
  else if (r.daysOverdue > 7) hit('overdue', 2, `${r.daysOverdue} days late`);
  else if (r.daysOverdue > 0) hit('overdue', 1, `${r.daysOverdue} day${r.daysOverdue === 1 ? '' : 's'} late`);

  if (r.avgDaysLate !== null && r.daysOverdue > 0 && r.daysOverdue > r.avgDaysLate + 3)
    hit('later than usual', 1, `this client usually pays ${r.avgDaysLate <= 0 ? 'on time' : `${Math.round(r.avgDaysLate)} days late`}`);
  if (r.avgDaysLate !== null && r.avgDaysLate > 7) hit('slow payer', 1, `usually ${Math.round(r.avgDaysLate)} days late`);
  if (r.paymentStyle === 'partial') hit('pays in parts', 1, 'has paid in parts before');
  if (r.avgDaysLate === null || r.paymentStyle === 'unknown') hit('no history', 1, 'no paid invoices yet');

  if (r.amountDue > 4 * r.approvalThreshold) hit('large amount', 2, `${money} is over 4x your approval limit`);
  else if (r.amountDue > r.approvalThreshold) hit('large amount', 1, `${money} is above your approval limit`);

  if (r.remindersSent > 0) hit('ignored reminders', Math.min(2, r.remindersSent), `${r.remindersSent} reminder${r.remindersSent === 1 ? '' : 's'} already sent`);

  const points = hits.reduce((s, h) => s + h.points, 0);
  return { level: points >= 5 ? 'high' : points >= 2 ? 'medium' : 'low', points, hits };
}

/** "12 days late, this client usually pays 9 days late" */
export const riskSentence = (risk: Risk) => risk.hits.map((h) => h.text).join(', ');
