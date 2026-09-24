import OpenAI from "openai";
import { ProviderError } from "../../errors.js";
import type { ChatProvider, ChatRequest, ChatResponse } from "./provider.js";

export interface OpenAiCompatibleOptions {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Groq and Gemini both expose OpenAI-compatible chat endpoints, so one implementation
 * serves both. The SDK's own retries are disabled: the extractor owns retry/fallback.
 */
export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): ChatProvider {
  const client = new OpenAI({
    baseURL: opts.baseURL,
    apiKey: opts.apiKey,
    fetch: opts.fetch,
    maxRetries: 0,
    timeout: opts.timeoutMs ?? 60_000,
  });

  return {
    name: opts.name,
    model: opts.model,

    async complete(request: ChatRequest): Promise<ChatResponse> {
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await client.chat.completions.create({
          model: opts.model,
          temperature: request.temperature ?? 0,
          max_tokens: request.maxTokens,
          response_format: request.json ? { type: "json_object" } : undefined,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        });
      } catch (err) {
        throw toProviderError(opts.name, err);
      }

      const content = completion.choices[0]?.message.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new ProviderError(opts.name, "empty completion", { retryable: true });
      }
      return {
        content,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

function toProviderError(name: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    const retryAfter = Number(err.headers?.get("retry-after"));
    return new ProviderError(name, `HTTP ${status ?? "?"}: ${err.message}`, {
      status,
      retryable: status === undefined || status === 429 || status >= 500,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      cause: err,
    });
  }
  // Network failures, aborts, timeouts: worth another try or another provider.
  return new ProviderError(name, err instanceof Error ? err.message : String(err), {
    retryable: true,
    cause: err,
  });
}
