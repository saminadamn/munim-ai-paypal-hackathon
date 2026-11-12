// The model Munim's server-side agent logic runs on: Google Gemini, with the key from GEMINI_API_KEY
// (free tier at https://aistudio.google.com/apikey). Returns undefined when no key is set, so callers
// can fall back to rules instead of failing.
//
// Free-tier Gemini models are sometimes "experiencing high demand" (503) or rate limited (429), so
// the returned model tries a list of models in order and moves to the next one on those errors.

import { createGoogleGenerativeAI } from '@ai-sdk/google';

// GEMINI_MODEL may list several ids, comma-separated; the first is tried first.
const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

function modelIds(): string[] {
  const ids = (process.env.GEMINI_MODEL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : DEFAULT_MODELS;
}

// A free-tier call can also hang without answering; give each model this long before moving on.
const PER_MODEL_TIMEOUT_MS = 20_000;

/** Overloaded, rate limited, timed out or a passing server error: worth trying the next model. */
function tryNext(e: unknown): boolean {
  const err = e as { statusCode?: number; isRetryable?: boolean; message?: string; name?: string };
  if (err?.statusCode && [404, 429, 500, 502, 503, 504].includes(err.statusCode)) return true;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return true;
  return Boolean(err?.isRetryable) || /high demand|overloaded|unavailable|quota|timed? ?out|aborted/i.test(err?.message ?? '');
}

export function munimModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  const google = createGoogleGenerativeAI({ apiKey });
  const models = modelIds().map((id) => google(id));
  const first = models[0];

  async function inTurn<T>(caller: AbortSignal | undefined, call: (m: typeof first, signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    let last: unknown;
    for (const m of models) {
      const signal = AbortSignal.any([AbortSignal.timeout(PER_MODEL_TIMEOUT_MS), ...(caller ? [caller] : [])]);
      try {
        return await call(m, signal);
      } catch (e) {
        last = e;
        // Stop if the caller gave up (e.g. the browser closed the request), not just this model.
        if (caller?.aborted || !tryNext(e)) throw e;
        console.warn(`[Munim] ${m.modelId} unavailable (${(e as Error)?.message?.slice(0, 80)}), trying the next Gemini model`);
      }
    }
    throw last;
  }

  // Same prototype and fields as the first model, so the AI SDK treats it as that model.
  const fallback: typeof first = Object.assign(Object.create(Object.getPrototypeOf(first)), first);
  fallback.doGenerate = (options) => inTurn(options.abortSignal, (m, abortSignal) => m.doGenerate({ ...options, abortSignal }));
  fallback.doStream = (options) => inTurn(options.abortSignal, (m, abortSignal) => m.doStream({ ...options, abortSignal }));
  return fallback;
}
