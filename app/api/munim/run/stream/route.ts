import { dbEnabled } from '@/lib/db';
import { runCollections, type RunEvent } from '@/lib/munim/collect';
import { rateLimit, TEN_MINUTES } from '@/lib/rate-limit';

export const maxDuration = 300;

// POST -> text/event-stream. The Agent page's "Run Munim" button reads this to show progress as the
// run happens; the run itself is the same function the cron route calls.
export async function POST(request: Request) {
  // Each run calls the model and can send real reminders.
  const limited = rateLimit(request, 'run', 10, TEN_MINUTES);
  if (limited) return Response.json({ error: 'Munim has run a lot from your connection; try again in a few minutes.' }, { status: 429, headers: limited.headers });
  if (!dbEnabled()) return Response.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: RunEvent) => controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      try {
        await runCollections('manual', send);
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
