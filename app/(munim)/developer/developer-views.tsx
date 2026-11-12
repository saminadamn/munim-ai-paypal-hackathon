'use client';

import { useState, useTransition } from 'react';
import type { ColDef } from 'ag-grid-community';
import { testPayPal, type PayPalTestResult } from '../_ui/actions';
import { MunimGrid } from '../_ui/grid';
import { paypalErrorToast } from '@/app/components/toaster';
import { Button, Card } from '../_ui/ui';

export type ApiLogRow = { at: string; method: string; path: string; status: number; ms: number; debugId: string | null };

const statusColour = (status: number) => (status >= 200 && status < 300 ? 'var(--pp-success)' : status >= 400 && status < 500 ? 'var(--pp-warning)' : 'var(--pp-danger)');

const COLUMNS: ColDef<ApiLogRow>[] = [
  { field: 'at', headerName: 'Time (UTC)', width: 190, sort: 'desc', valueFormatter: (p) => (p.value ? String(p.value).replace('T', ' ').slice(0, 19) : '') },
  { field: 'method', headerName: 'Method', width: 100, filter: true },
  { field: 'path', headerName: 'Path', flex: 1, minWidth: 320, filter: true, tooltipField: 'path' },
  { field: 'status', headerName: 'Status', width: 100, filter: 'agNumberColumnFilter', cellStyle: (p) => ({ color: statusColour(p.value ?? 0), fontWeight: 600 }) },
  { field: 'ms', headerName: 'ms', width: 90, filter: 'agNumberColumnFilter' },
  { field: 'debugId', headerName: 'PayPal debug ID', width: 190 },
];

export function ApiLogGrid({ rows }: { rows: ApiLogRow[] }) {
  return rows.length === 0 ? (
    <p className="text-sm text-pp-muted">No calls logged yet. Press Test PayPal.</p>
  ) : (
    <MunimGrid<ApiLogRow> rows={rows} columns={COLUMNS} height={Math.min(560, 50 + rows.length * 42)} />
  );
}

export function TestPayPal({ configured, merchantEmail }: { configured: boolean; merchantEmail: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<PayPalTestResult | null>(null);

  return (
    <Card title="Sandbox connection">
      <div className="flex flex-wrap items-center gap-4">
        <Button disabled={pending} onClick={() =>
            start(async () => {
              const r = await testPayPal();
              setResult(r);
              if (!r.ok) paypalErrorToast(r.status ? `PayPal answered HTTP ${r.status}` : 'Could not reach PayPal', r);
            })
          }>
          {pending ? 'Calling PayPal…' : 'Test PayPal'}
        </Button>
        <code className="text-sm text-pp-muted">GET /v2/invoicing/invoices</code>
        {result && (
          <span className="text-sm font-semibold" style={{ color: result.ok ? 'var(--pp-success)' : 'var(--pp-danger)' }}>
            {result.status ? `HTTP ${result.status}` : 'No response'}
            {result.ms ? ` in ${result.ms} ms` : ''}
            {result.ok ? ` · ${result.total} invoice${result.total === 1 ? '' : 's'} in the sandbox` : ''}
          </span>
        )}
      </div>
      <p className="mt-3 text-xs text-pp-muted">
        Credentials {configured ? 'are set' : 'are missing: set PAYPAL_CLIENT_ID and PAYPAL_SECRET'}. Invoicer email{' '}
        {merchantEmail ? <span className="font-semibold text-pp-ink">{merchantEmail}</span> : 'is missing: set MERCHANT_EMAIL to your sandbox business account email'}.
      </p>
      {result?.debugId && <p className="mt-1 text-xs text-pp-muted">PayPal debug ID {result.debugId}</p>}
      {result?.error && <p className="mt-3 rounded border border-pp-danger px-3 py-2 text-sm text-pp-danger">{result.error}</p>}
      {result?.ok && result.invoices && result.invoices.length > 0 && (
        <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
          {result.invoices.slice(0, 10).map((i) => (
            <li key={i.id} className="flex justify-between gap-4 border-b border-pp-border py-1">
              <span>{i.number || i.id}</span>
              <span className="text-pp-muted">{i.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
