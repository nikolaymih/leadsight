import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { ChatProvider } from "./provider.js";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export function createGeminiProvider(opts: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): ChatProvider {
  return createOpenAiCompatibleProvider({ name: "gemini", baseURL: GEMINI_BASE_URL, ...opts });
}
