// The AG Studio AI assistant, built with the Studio Agent Framework: a createAiHarness builder whose
// roster is Munim (./munim-agent.ts) plus AG's five built-in agents (lead, data, page, planning,
// widget), all on the same adapter. Munim fronts every conversation and hands chart and page
// building to the built-ins through delegate_to.
//
// The adapter calls `${endpoint}/responses`, i.e. this app's proxy at app/api/ai/responses, which is
// the only place the OpenAI key lives; nothing secret is sent from the browser.

import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { munimAgent } from './munim-agent';
import { openaiAdapter } from './openai-adapter';

// Suggestions shown in a new conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Who owes me the most?', prompt: 'Who owes me the most?' },
  { label: 'Will I have $3,000 by the 30th?', prompt: 'Will I have $3,000 by the 30th?' },
  { label: 'Chase everyone more than a week late', prompt: 'Chase everyone more than a week late' },
  { label: 'Add a chart of collections by week', prompt: 'Add a chart of collections by week' },
];

// `models` are the ids allowed by OPENAI_MODELS on the server; the first is the default, and the
// picker only shows for two or more.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: '/api/ai', model: models[0] });

  return ({ api }) =>
    createAiHarness(api, ({ tools, builtIn }) => ({
      agents: [
        munimAgent(adapter, api, tools),
        directLlmRunner({ ...builtIn.lead, adapter }),
        directLlmRunner({ ...builtIn.data, adapter }),
        directLlmRunner({ ...builtIn.page, adapter }),
        directLlmRunner({ ...builtIn.planning, adapter }),
        directLlmRunner({ ...builtIn.widget, adapter }),
      ],
      primary: 'munim',
      promptStarters: PROMPT_STARTERS,
      models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
    }));
}
