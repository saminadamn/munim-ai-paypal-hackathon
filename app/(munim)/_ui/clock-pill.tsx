'use client';

// The demo clock, always visible: a pill showing which "today" Munim is working to, opening a
// dialog to move it forward (+3 / +7 / +14 days) or back to the real date. Overdue days, reminder
// spacing and the forecast all follow it (lib/clock.ts now()); PayPal's own dates do not.

import { useState, useTransition } from 'react';
import { Dialog } from '@/app/dashboard/components/ui/ui';
import { shiftClock } from './actions';

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function ClockPill({ offset, today }: { offset: number; today: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const shift = (days: number | 'reset') =>
    start(async () => {
      await shiftClock(days);
      setOpen(false);
    });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Demo clock: change which day Munim treats as today"
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
          offset ? 'border-pp-blue bg-pp-highlight text-pp-blue' : 'border-pp-border text-pp-muted hover:border-pp-blue hover:text-pp-ink'
        }`}
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {offset ? `Today +${offset} day${offset === 1 ? '' : 's'}` : 'Today'}
        <span className="font-normal">· {fmt(today)}</span>
      </button>
      <Dialog
        open={open}
        title="Demo clock"
        onClose={() => setOpen(false)}
        actions={
          <>
            {offset > 0 && (
              <button disabled={pending} onClick={() => shift('reset')} className="rounded-full border border-pp-border px-4 py-2 text-sm font-semibold hover:border-pp-blue">
                Back to the real date
              </button>
            )}
            <button disabled={pending} onClick={() => setOpen(false)} className="rounded-full px-4 py-2 text-sm font-semibold text-pp-blue hover:underline">
              Close
            </button>
          </>
        }
      >
        <p className="text-sm text-pp-muted">
          Munim is working to <span className="font-semibold text-pp-ink">{fmt(today)}</span>
          {offset ? `, ${offset} day${offset === 1 ? '' : 's'} ahead of the real date` : ', the real date'}. Moving it ages every open invoice, so reminders,
          risk and the forecast react as if those days had passed. PayPal itself is not affected.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[3, 7, 14].map((d) => (
            <button
              key={d}
              disabled={pending}
              onClick={() => shift(d)}
              className="rounded-lg border border-pp-border py-3 text-sm font-semibold text-pp-navy hover:border-pp-blue hover:bg-pp-highlight disabled:text-pp-muted"
            >
              +{d} days
            </button>
          ))}
        </div>
        {pending && <p className="mt-3 text-xs text-pp-muted">Moving the clock…</p>}
      </Dialog>
    </>
  );
}
