// A small per-IP rate limit for the public routes that spend money (OpenAI calls) or act through
// PayPal. Kept in memory: it resets on restart and is per instance, which is enough for one Render
// web service and a hackathon demo, not for a fleet.

type Window = { start: number; count: number };
const buckets = new Map<string, Window>();

/** The caller's IP: the first X-Forwarded-For hop (Render's proxy sets it), else X-Real-IP. */
export function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Fixed window: at most `limit` requests per `windowMs` per IP and route. Returns null when the
 * request may go ahead, or a 429 response to return.
 */
export function rateLimit(request: Request, name: string, limit: number, windowMs: number): Response | null {
  const key = `${name}:${clientIp(request)}`;
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now - w.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
    return null;
  }
  if (w.count < limit) {
    w.count++;
    return null;
  }
  const retryAfter = Math.ceil((w.start + windowMs - now) / 1000);
  const minutes = Math.ceil(retryAfter / 60);
  // `error.message` is the shape the AG Studio adapter shows to the reader.
  return Response.json(
    { error: { message: `Too many requests from your connection. This demo allows ${limit} every ${Math.round(windowMs / 60_000)} minutes; try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.` } },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

export const TEN_MINUTES = 10 * 60_000;
