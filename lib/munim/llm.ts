// The model Munim's server-side agent logic runs on: Google Gemini, with the key from GEMINI_API_KEY
// (free tier at https://aistudio.google.com/apikey). Returns undefined when no key is set, so callers
// can fall back to rules instead of failing.

import { createGoogleGenerativeAI } from '@ai-sdk/google';

const DEFAULT_MODEL = 'gemini-flash-latest';

export function munimModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return createGoogleGenerativeAI({ apiKey })(process.env.GEMINI_MODEL || DEFAULT_MODEL);
}
