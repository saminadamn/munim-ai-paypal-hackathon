import { rateLimit, TEN_MINUTES } from '@/lib/rate-limit';

// POST -> runs collections for the assistant's runCollections tool. The browser never sees the cron
// key: this route adds it server-side and calls the same POST /api/munim/run the Render Cron Job uses.
export async function POST(request: Request) {
  const limited = rateLimit(request, 'run', 10, TEN_MINUTES);
  if (limited) return Response.json({ error: 'Munim has run a lot from your connection; try again in a few minutes.' }, { status: 429, headers: limited.headers });
  const key = process.env.MUNIM_CRON_KEY;
  if (!key) return Response.json({ error: 'MUNIM_CRON_KEY is not set on the server.' }, { status: 503 });
  const res = await fetch(new URL('/api/munim/run?trigger=manual', request.url), { method: 'POST', headers: { 'x-munim-key': key }, cache: 'no-store' });
  const run = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return Response.json(
    run.error ? run : { id: run.id, trigger: 'manual (assistant)', summary: run.summary, executed: run.executed, proposed: run.proposed },
    { status: res.status },
  );
}
