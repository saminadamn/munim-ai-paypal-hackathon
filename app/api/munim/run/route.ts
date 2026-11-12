import { dbEnabled } from '@/lib/db';
import { runCollections, runFailed } from '@/lib/munim/collect';

// POST with header x-munim-key: $MUNIM_CRON_KEY -> runs one collection pass and returns the
// AgentRun as JSON. The Render Cron Job calls this (scripts/run-munim.mjs); the assistant's
// runCollections tool reaches it through /api/munim/agent/run with ?trigger=manual.
export async function POST(request: Request) {
  const key = process.env.MUNIM_CRON_KEY;
  if (!key || request.headers.get('x-munim-key') !== key) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!dbEnabled()) return Response.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });
  const trigger = new URL(request.url).searchParams.get('trigger') === 'manual' ? 'manual' : 'cron';
  const run = await runCollections(trigger);
  return Response.json(run, { status: runFailed(run) ? 500 : 200 });
}
