import type { TokenUsage } from "../extractor.js";

// One chat completion against one OpenAI-compatible endpoint. Providers are thin: they
// translate a request, surface HTTP failures as ProviderError, and report token usage.
// Retry and fallback policy lives in the extractor, not here.

export interface ChatRequest {
  system: string;
  user: string;
  /** Ask for a JSON object response where the endpoint supports it. Output is validated regardless. */
  json: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
}

export interface ChatProvider {
  /** Short stable id used for budget accounting and stored on leads: `groq`, `gemini`. */
  readonly name: string;
  readonly model: string;
  complete(request: ChatRequest): Promise<ChatResponse>;
}
