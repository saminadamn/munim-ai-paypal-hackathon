import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { absolute: 'Munim: the finance employee your business can’t afford to hire' },
  description: 'Munim drafts invoices from messy messages, chases late payments through PayPal within your rules, and forecasts your cash.',
};

const STEPS = [
  { name: 'Invoice', href: '/inbox', text: 'Paste an email or a WhatsApp message, Hinglish included. Munim drafts the invoice; you approve and PayPal sends it.' },
  { name: 'Collect', href: '/agent', text: 'Every hour Munim scores what is owed and sends polite reminders through PayPal. Anything risky waits for you, with a reason.' },
  { name: 'Forecast', href: '/agent/forecast', text: 'Thirty days of cash from your PayPal balance and how each client actually pays, next to what happens if nobody chases.' },
];

// The boilerplate's endpoint pages, one AG Grid per PayPal endpoint, kept as they were.
const PAYPAL_DATA = [
  { href: '/products', label: 'Catalog products', detail: 'GET /v1/catalogs/products' },
  { href: '/plans', label: 'Billing plans', detail: 'GET /v1/billing/plans' },
  { href: '/invoices', label: 'Invoices', detail: 'GET /v2/invoicing/invoices' },
  { href: '/transactions', label: 'Transactions', detail: 'GET /v1/reporting/transactions' },
  { href: '/balances', label: 'Balances', detail: 'GET /v1/reporting/balances' },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-pp-canvas font-paypal text-pp-ink">
      <header className="border-b border-pp-border bg-pp-surface">
        <nav className="mx-auto flex w-full max-w-6xl items-center gap-8 px-8 py-4 text-sm">
          <span className="text-xl font-semibold text-pp-navy">Munim</span>
          <Link href="/inbox" className="text-pp-muted hover:text-pp-ink">
            Inbox
          </Link>
          <Link href="/agent" className="text-pp-muted hover:text-pp-ink">
            Agent
          </Link>
          <Link href="/dashboard" className="text-pp-muted hover:text-pp-ink">
            Dashboard
          </Link>
          <Link href="/developer" className="text-pp-muted hover:text-pp-ink">
            Developer
          </Link>
          <a href="#paypal-data" className="ml-auto text-pp-muted hover:text-pp-ink">
            PayPal data
          </a>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-8">
        <section className="pt-20 pb-14">
          <h1 className="max-w-4xl text-[44px] leading-[1.15] font-semibold tracking-tight text-pp-navy">
            Munim — the finance employee your business can&apos;t afford to hire. Now you can.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-pp-muted">
            For freelancers and small businesses who lose hours every week writing invoices, chasing late payments and guessing how much cash is coming.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="rounded-full bg-pp-blue px-6 py-3 text-sm font-semibold text-white hover:bg-pp-blue-dark">
              Open the live demo
            </Link>
            <Link href="/inbox" className="rounded-full border border-pp-border bg-pp-surface px-6 py-3 text-sm font-semibold text-pp-ink hover:border-pp-blue">
              Try the inbox
            </Link>
          </div>
        </section>

        <ol className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {STEPS.map((step, i) => (
            <li key={step.name} className="contents">
              <Link href={step.href} className="group rounded-lg border border-pp-border bg-pp-surface p-6 hover:border-pp-blue">
                <div className="text-xs font-semibold tracking-wider text-pp-muted uppercase">Step {i + 1}</div>
                <div className="mt-1 text-xl font-semibold text-pp-navy group-hover:text-pp-blue">{step.name}</div>
                <p className="mt-2 text-sm text-pp-muted">{step.text}</p>
              </Link>
              {i < STEPS.length - 1 && (
                <span aria-hidden className="hidden self-center text-2xl text-pp-border md:block">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>

        <figure className="mt-14">
          <Image
            src="/screenshots/dashboard.png"
            alt="The Munim command centre: today's numbers, the approval queue, a 30-day cash forecast, overdue by client and every action Munim took with its reason."
            width={1600}
            height={1000}
            priority
            className="h-auto w-full rounded-lg border border-pp-border shadow-sm"
          />
          <figcaption className="mt-3 text-center text-sm text-pp-muted">
            The command centre in AG Studio, with Munim&apos;s approval queue and today&apos;s numbers as custom widgets.
          </figcaption>
        </figure>

        <p className="mt-14 text-center text-sm font-semibold text-pp-navy">Built on PayPal Invoicing, AG Studio and Gemini</p>

        <section id="paypal-data" className="mt-20 mb-16 scroll-mt-8">
          <h2 className="text-sm font-semibold tracking-wider text-pp-muted uppercase">PayPal data</h2>
          <p className="mt-1 text-sm text-pp-muted">One AG Grid per PayPal endpoint, from the hackathon boilerplate Munim is built on.</p>
          <ul className="mt-3 divide-y divide-pp-border border-y border-pp-border">
            {PAYPAL_DATA.map((page) => (
              <li key={page.href}>
                <Link href={page.href} className="flex items-baseline justify-between gap-4 py-3 hover:text-pp-blue">
                  <span className="font-semibold">{page.label} →</span>
                  <code className="text-sm text-pp-muted">{page.detail}</code>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
