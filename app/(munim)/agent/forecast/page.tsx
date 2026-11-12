import type { Metadata } from 'next';
import { connection } from 'next/server';
import { buildForecast } from '@/lib/munim/forecast';
import { Card, money, PageTitle, Stat } from '../../_ui/ui';
import { ForecastChart, ForecastInvoicesGrid } from './forecast-views';

export const metadata: Metadata = { title: 'Cash forecast' };

export default async function ForecastPage() {
  await connection();
  const f = await buildForecast().catch((e: Error) => e);
  if (f instanceof Error) {
    return (
      <>
        <PageTitle title="Cash forecast" />
        <p className="rounded border border-pp-danger bg-pp-surface px-4 py-3 text-sm text-pp-danger">Could not build the forecast: {f.message.slice(0, 300)}</p>
      </>
    );
  }
  const gain = f.endWithMunim - f.endDoNothing;

  return (
    <>
      <PageTitle
        title="Cash forecast"
        detail={`A heuristic for the next 30 days from ${f.today}: your PayPal balance plus each open invoice on the day that client usually pays, weighted by how reliably they pay, against a do-nothing line where slow payers slip further.`}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Cash today" value={money(f.startBalance, f.currency)} detail={f.balanceAvailable ? 'PayPal available balance' : 'Balance unavailable'} />
        <Stat label="Open invoices" value={money(f.openTotal, f.currency)} detail={`${f.invoices.length} in ${f.currency}`} />
        <Stat label="Day 30, do nothing" value={money(f.endDoNothing, f.currency)} />
        <Stat label="Day 30, with Munim" value={money(f.endWithMunim, f.currency)} detail={gain > 0 ? `${money(gain, f.currency)} more` : undefined} />
      </div>

      <Card title="Expected cash, next 30 days (heuristic)" className="mt-6">
        <ForecastChart rows={f.rows} licenseKey={process.env.AG_STUDIO} />
      </Card>

      <Card title="When each invoice is expected" className="mt-6">
        <ForecastInvoicesGrid rows={f.invoices} />
        {f.invoices.some((i) => !i.inHorizon) && <p className="mt-3 text-xs text-pp-muted">Invoices expected after day 30 are listed but not in the chart.</p>}
        {f.otherCurrencies.length > 0 && (
          <p className="mt-3 text-xs text-pp-muted">Not included (different currency, not converted): {f.otherCurrencies.join(', ')}.</p>
        )}
      </Card>

      <Card title="How this heuristic works" className="mt-6">
        <ul className="list-disc space-y-1 pl-5 text-sm text-pp-muted">
          {f.heuristic.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
