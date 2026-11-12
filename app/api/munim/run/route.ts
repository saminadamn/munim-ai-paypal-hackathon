import { dbEnabled } from '@/lib/db';
import { runCollections, runFailed } from '@/lib/munim/collect';

// POST with header x-munim-key: $MUNIM_CRON_KEY -> runs one collection pass and returns the
// AgentRun as JSON. The Render Cron Job calls this (scripts/run-munim.mjs); the assistant's
// runCollections tool reaches it through /api/munim/agent/run with ?trigger=manual.
export async function POST(request: Request) {
  const key = process.env.MUNIM_CRON_KEY;
  if (!key || request.headers.get('x-munim-key') !== key) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const trigger = new URL(request.url).searchParams.get('trigger') === 'manual' ? 'manual' : 'cron';
  return run(trigger);
}

// GET is what Vercel Cron calls (vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`
// when the CRON_SECRET environment variable is set on the project.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return run('cron');
}

async function run(trigger: 'manual' | 'cron') {
  if (!dbEnabled()) return Response.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });
  const result = await runCollections(trigger);
  return Response.json(result, { status: runFailed(result) ? 500 : 200 });
}

// A run calls PayPal and the model once per open invoice, so give it room on serverless hosts.
export const maxDuration = 300;
