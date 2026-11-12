// The demo clock. Everything about time passing (overdue days, reminder spacing, the forecast)
// uses now(), never new Date(), so a demo can jump ahead N days from Settings without waiting.

import { dbEnabled, getSettings } from './db';

const DAY_MS = 86_400_000;

export async function demoOffsetDays(): Promise<number> {
  if (!dbEnabled()) return 0;
  try {
    return (await getSettings()).demoOffsetDays;
  } catch {
    return 0;
  }
}

/** Real time plus Settings.demoOffsetDays. */
export async function now(): Promise<Date> {
  return new Date(Date.now() + (await demoOffsetDays()) * DAY_MS);
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
/** Whole days from `from` to `to` (date strings or Dates). */
export const daysBetween = (from: string | Date, to: string | Date) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);
