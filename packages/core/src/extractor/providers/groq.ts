import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { ChatProvider } from "./provider.js";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function createGroqProvider(opts: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): ChatProvider {
  return createOpenAiCompatibleProvider({ name: "groq", baseURL: GROQ_BASE_URL, ...opts });
}
