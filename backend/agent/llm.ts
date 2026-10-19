// Chat model factory. Gemini (free tier, Google AI Studio key) is the default; any
// OpenAI-compatible endpoint works too, e.g. a local Ollama model or Gemini's OpenAI endpoint.
//   LLM_PROVIDER=gemini   GEMINI_API_KEY=...  GEMINI_MODEL=gemini-2.5-flash
//   LLM_PROVIDER=openai   OPENAI_BASE_URL=http://localhost:11434/v1  OPENAI_MODEL=qwen2.5:7b
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface ModelInfo {
  model: BaseChatModel;
  name: string;
}

export function createChatModel(overrides: { temperature?: number } = {}): ModelInfo {
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  const temperature = overrides.temperature ?? Number(process.env.LLM_TEMPERATURE ?? 0);

  if (provider === 'openai') {
    const { ChatOpenAI } = require('@langchain/openai');
    const name = process.env.OPENAI_MODEL || 'qwen2.5:7b';
    return {
      name: `openai:${name}`,
      model: new ChatOpenAI({
        model: name,
        temperature,
        apiKey: process.env.OPENAI_API_KEY || 'not-needed-for-ollama',
        configuration: { baseURL: process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1' },
        timeout: Number(process.env.LLM_TIMEOUT_MS || 120000),
        maxRetries: 1,
      }),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_WILL_ADD_LATER') {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
  const name = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  return {
    name: `gemini:${name}`,
    model: new ChatGoogleGenerativeAI({ model: name, apiKey, temperature, maxRetries: 2 }),
  };
}
