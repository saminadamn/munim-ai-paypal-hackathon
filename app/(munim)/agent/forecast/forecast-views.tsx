'use client';

// The forecast chart is a one-widget, read-only AG Studio report over the forecast series, so the
// app uses AG Studio for every chart and adds no chart library of its own.

import { useMemo, useSyncExternalStore } from 'react';
import type { AgDataSourcesDefinition, AgReportState } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import type { ColDef } from 'ag-grid-community';
import type { ForecastInvoice, ForecastRow } from '@/lib/munim/forecast';
import { agStudioPayPalTheme } from '@/app/dashboard/studio/theme';
import { MunimGrid } from '../../_ui/grid';
import { money } from '../../_ui/ui';

const noSubscription = () => () => {};

const REPORT: AgReportState = {
  selectedPageId: 'forecast',
  pages: [
    {
      id: 'forecast',
      widgets: {
        chart: {
          type: 'area-chart',
          dataMapping: {
            categoryKey: [{ id: 'forecast.date' }],
            valueKey: [
              { id: 'forecast.cumulative_expected', aggregation: 'sum' },
              { id: 'forecast.do_nothing_cumulative', aggregation: 'sum' },
            ],
          },
          format: { style: { theme: { common: { legend: { enabled: true } } } } },
        },
      },
      widgetLayout: { chart: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 22 } },
    },
  ],
} as AgReportState;

export function ForecastChart({ rows, licenseKey }: { rows: ForecastRow[]; licenseKey?: string }) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const data = useMemo<AgDataSourcesDefinition>(
    () => ({
      sources: [
        {
          id: 'forecast',
          name: 'Cash forecast',
          data: rows.map((r) => ({ date: r.date, cumulative_expected: r.cumulative_expected, do_nothing_cumulative: r.do_nothing_cumulative })),
          fields: [
            { id: 'date', name: 'Date', format: 'textFormat' },
            { id: 'cumulative_expected', name: 'With Munim', format: 'currencyFormat' },
            { id: 'do_nothing_cumulative', name: 'Do nothing', format: 'currencyFormat' },
          ],
        },
      ],
    }),
    [rows],
  );

  if (!inBrowser) return <div className="h-[420px] animate-pulse rounded bg-pp-canvas" />;
  return (
    <div className="h-[420px]">
      <AgStudioProvider licenseKey={licenseKey}>
        <AgStudio style={{ height: '100%', width: '100%' }} theme={agStudioPayPalTheme} data={data} initialState={REPORT} mode="view" />
      </AgStudioProvider>
    </div>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

const COLUMNS: ColDef<ForecastInvoice>[] = [
  { field: 'number', headerName: 'Invoice', width: 110 },
  { field: 'client', headerName: 'Client', width: 170 },
  { field: 'amountDue', headerName: 'Due', width: 120, valueFormatter: (p) => (p.data ? money(p.data.amountDue, p.data.currency) : '') },
  { field: 'dueDate', headerName: 'Due date', width: 115 },
  { field: 'paymentStyle', headerName: 'Pays', width: 100 },
  { field: 'avgDaysLate', headerName: 'Usually late', width: 120, valueFormatter: (p) => (p.data?.paymentStyle === 'unknown' ? 'No history' : `${p.value} days`) },
  { field: 'expectedPayDate', headerName: 'With Munim: expected', width: 170, sort: 'asc' },
  { field: 'probability', headerName: 'Chance', width: 95, valueFormatter: (p) => pct(p.value ?? 0) },
  { field: 'doNothingPayDate', headerName: 'Do nothing: expected', width: 170 },
  { field: 'doNothingProbability', headerName: 'Chance', width: 95, valueFormatter: (p) => pct(p.value ?? 0) },
];

export function ForecastInvoicesGrid({ rows }: { rows: ForecastInvoice[] }) {
  return rows.length === 0 ? (
    <p className="text-sm text-pp-muted">No open invoices in this currency.</p>
  ) : (
    <MunimGrid<ForecastInvoice> rows={rows} columns={COLUMNS} height={Math.min(480, 50 + rows.length * 42)} />
  );
}
