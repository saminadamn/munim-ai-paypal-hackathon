'use client';

import type { ReactNode } from 'react';
import { BellIcon, HelpIcon } from './ui/icons';
import { AgStudioLogo } from './ui/logo';

// The app frame, laid out like the PayPal Developer Dashboard: a white top bar, a left sidebar
// and a light canvas. Shared by the dashboard, its loading skeleton and its error page.

function PayPalWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold italic tracking-tight ${className}`}>
      <span className="text-pp-blue-dark">Pay</span>
      <span className="text-pp-sky">Pal</span>
    </span>
  );
}

function BrandLockup() {
  return (
    <div className="flex items-center gap-3">
      <AgStudioLogo className="-ml-3 h-12 w-auto" />
      <span className="h-6 w-px bg-pp-border" aria-hidden />
      <span className="flex items-baseline gap-1 text-xs text-pp-muted">
        powered by <PayPalWordmark className="text-base" /> APIs
      </span>
    </div>
  );
}

function TopBar({ actions }: { actions?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-pp-border bg-white px-6">
      <BrandLockup />
      <div className="ml-auto flex items-center gap-1 text-pp-navy">
        {actions && <span className="mr-3">{actions}</span>}
        <span className="inline-flex size-9 items-center justify-center rounded-full" title="Help">
          <HelpIcon />
        </span>
        <span className="inline-flex size-9 items-center justify-center rounded-full" title="Notifications">
          <BellIcon />
        </span>
        <span className="ml-2 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-pp-navy text-sm font-semibold text-white">
            AG
          </span>
          <span className="hidden text-sm font-semibold sm:inline">Demo merchant</span>
        </span>
      </div>
    </header>
  );
}

export function AppShell({
  sidebar,
  children,
  topBarActions,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  /** Shown at the right of the top bar, before the account (the demo clock). */
  topBarActions?: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-pp-canvas font-paypal text-pp-ink">
      <TopBar actions={topBarActions} />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-64 shrink-0 flex-col border-r border-pp-border bg-white" aria-label="Reports">
          {sidebar}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
