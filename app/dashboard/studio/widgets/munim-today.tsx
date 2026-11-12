'use client';

// "Munim today": what the agent has done for the business, at a glance.

import { useEffect } from 'react';
import type { AgWidgetParams } from 'ag-studio';
import { formatDay, formatMoney, timeAgo } from '@/lib/format';
import { useMunim } from './use-munim';

type Today = {
  currency: string;
  lastRunAt: string | null;
  lastRunTrigger: string | null;
  lastRunSummary: string | null;
  firstRunAt: string | null;
  actionsTaken: number;
  waiting: number;
  moneyChased: number;
  moneyCollected: number;
  collectedError: string | null;
  hoursSaved: number;
  minutesPerAction: number;
};

const money = (n: number, currency: string) => formatMoney(n, currency, { whole: n >= 10_000 });

export function MunimTodayWidget({ widgetApi }: AgWidgetParams) {
  const { data, error, loading } = useMunim<Today>('/api/munim/today');
  useEffect(() => widgetApi.setDisplayState(loading ? 'loading' : 'displayed'), [loading, widgetApi]);

  if (error) return <p className="p-2 text-sm text-pp-danger">Munim today is unavailable: {error}</p>;
  if (!data) return null;

  const stats: { label: string; value: string; note?: string }[] = [
    { label: 'Last run', value: data.lastRunAt ? timeAgo(data.lastRunAt) : 'Never', note: data.lastRunTrigger ? `${data.lastRunTrigger} run` : undefined },
    { label: 'Actions taken', value: String(data.actionsTaken), note: data.waiting ? `${data.waiting} waiting for you` : 'nothing waiting' },
    { label: 'Money chased', value: money(data.moneyChased, data.currency), note: 'on invoices Munim reminded' },
    {
      label: 'Collected',
      value: data.collectedError ? '–' : money(data.moneyCollected, data.currency),
      note: data.firstRunAt ? `since ${formatDay(data.firstRunAt)}` : 'since the first run',
    },
    { label: 'Hours saved', value: `~${data.hoursSaved} h`, note: `estimate: ${data.actionsTaken} actions x ${data.minutesPerAction} min` },
  ];

  return (
    <div className="flex h-full flex-col gap-3 font-paypal text-pp-ink">
      <div className="grid flex-1 auto-rows-fr grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col justify-center rounded-md bg-pp-canvas px-3 py-2" title={s.note}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-pp-muted">{s.label}</div>
            <div className="mt-0.5 whitespace-nowrap text-xl font-semibold text-pp-navy">{s.value}</div>
            {s.note && <div className="truncate text-xs text-pp-muted">{s.note}</div>}
          </div>
        ))}
      </div>
      {data.lastRunSummary && <p className="line-clamp-2 text-sm text-pp-muted">{data.lastRunSummary}</p>}
    </div>
  );
}
