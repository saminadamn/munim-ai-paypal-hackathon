import { db, dbEnabled } from '@/lib/db';

// Render's health check. 200 when the app is up and, if a database is configured, it answers.
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!dbEnabled()) return Response.json({ ok: true, db: 'not configured' });
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: 'up' });
  } catch (e) {
    return Response.json({ ok: false, db: 'down', error: e instanceof Error ? e.message.slice(0, 200) : String(e) }, { status: 503 });
  }
}
