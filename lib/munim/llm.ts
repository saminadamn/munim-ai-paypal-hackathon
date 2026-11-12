// The model Munim's server-side agent logic runs on: the first of OPENAI_MODELS, with the same key
// the AG Studio assistant uses (lib/ai.ts). Returns undefined when no key is set, so callers can
// fall back to rules instead of failing.

import { createOpenAI } from '@ai-sdk/openai';
import { aiModels, openAiKey } from '../ai';

export function munimModel() {
  const apiKey = openAiKey();
  if (!apiKey) return undefined;
  return createOpenAI({ apiKey })(aiModels()[0]);
}
