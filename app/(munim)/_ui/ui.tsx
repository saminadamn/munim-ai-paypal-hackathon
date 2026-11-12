// Small shared pieces for Munim's pages, in the boilerplate's PayPal tokens: one accent colour
// (pp-blue), white cards on the canvas, no gradients.

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatMoney } from '@/lib/format';

export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-pp-border bg-pp-surface p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title && <h2 className="text-base font-semibold text-pp-navy">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  const styles = {
    primary: 'bg-pp-blue text-white hover:bg-pp-blue-dark disabled:bg-pp-border disabled:text-pp-muted',
    secondary: 'border border-pp-border bg-pp-surface text-pp-ink hover:border-pp-blue disabled:text-pp-muted',
    quiet: 'text-pp-blue hover:underline disabled:text-pp-muted',
  }[variant];
  return <button className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles} ${className}`} {...props} />;
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-pp-border bg-pp-surface px-5 py-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-pp-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-pp-navy">{value}</div>
      {detail && <div className="mt-1 text-xs text-pp-muted">{detail}</div>}
    </div>
  );
}

export function PageTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[28px] font-semibold text-pp-navy">{title}</h1>
      {detail && <p className="mt-1 max-w-3xl text-sm text-pp-muted">{detail}</p>}
    </div>
  );
}

export const money = (value: number, currency = 'USD') => formatMoney(value, currency, { whole: value >= 10000 });

/** A grey block that stands in for content while a page waits on PayPal. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-pp-border/50 ${className}`} />;
}

/** The skeleton for a Munim page: title, stat row, two cards. */
export function PageSkeleton({ stats = 4 }: { stats?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-3 h-4 w-[min(640px,100%)]" />
      {stats > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      <Skeleton className="mt-6 h-40" />
      <Skeleton className="mt-6 h-72" />
    </div>
  );
}
