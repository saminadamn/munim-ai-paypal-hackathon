import type { Metadata } from 'next';
import { connection } from 'next/server';
import { db, dbEnabled } from '@/lib/db';
import { Card, PageTitle } from '../_ui/ui';
import { ApiLogGrid, TestPayPal, type ApiLogRow } from './developer-views';

export const metadata: Metadata = { title: 'Developer' };

export default async function DeveloperPage() {
  await connection();
  const logs: ApiLogRow[] = dbEnabled()
    ? (await db.apiLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })).map((l) => ({
        at: l.createdAt.toISOString(),
        method: l.method,
        path: l.path,
        status: l.status,
        ms: l.ms,
        debugId: l.debugId,
      }))
    : [];

  return (
    <>
      <PageTitle
        title="Developer"
        detail="Every call Munim makes to the PayPal sandbox, newest first. Quote the debug ID to PayPal support when a call fails."
      />
      <TestPayPal configured={Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET)} merchantEmail={process.env.MERCHANT_EMAIL ?? null} />
      <Card title={`API log (${logs.length}${logs.length === 500 ? ', latest 500' : ''})`} className="mt-6">
        {dbEnabled() ? <ApiLogGrid rows={logs} /> : <p className="text-sm text-pp-muted">Set DATABASE_URL to keep an API log.</p>}
      </Card>
    </>
  );
}
