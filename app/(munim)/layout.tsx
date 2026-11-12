import Link from 'next/link';
import type { ReactNode } from 'react';
import { connection } from 'next/server';
import { demoOffsetDays, now } from '@/lib/clock';
import { dbEnabled } from '@/lib/db';
import { Toaster } from '@/app/components/toaster';
import { ClockPill } from './_ui/clock-pill';
import { NavLinks } from './_ui/nav-links';

// The shell around every Munim page: name, navigation and the demo clock, so it is always clear
// which "today" overdue days and the forecast are measured from.
export default async function MunimLayout({ children }: { children: ReactNode }) {
  await connection();
  const [offset, today] = await Promise.all([demoOffsetDays(), now()]);

  return (
    <div className="flex min-h-dvh flex-col bg-pp-canvas font-paypal text-pp-ink">
      <header className="border-b border-pp-border bg-pp-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-8 px-8 py-4">
          <Link href="/" className="text-xl font-semibold text-pp-navy">
            Munim
          </Link>
          <NavLinks />
          <div className="ml-auto">
            <ClockPill offset={offset} today={today.toISOString().slice(0, 10)} />
          </div>
        </div>
      </header>
      {!dbEnabled() && (
        <div className="border-b border-pp-border bg-pp-highlight px-8 py-2 text-center text-sm text-pp-navy">
          DATABASE_URL is not set, so Munim can draft invoices but cannot log actions, run collections, keep an API log or save settings.
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-8">{children}</main>
      <Toaster />
    </div>
  );
}
