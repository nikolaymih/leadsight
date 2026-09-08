import { ProviderError } from "../errors.js";
import type { ChatProvider, ChatRequest } from "../extractor/providers/provider.js";

/** A scripted ChatProvider: each call pops the next reply (a string, or a ProviderError to throw). */
export function fakeProvider(
  name: string,
  replies: (string | ProviderError)[],
): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    name,
    model: `${name}-model`,
    requests,
    async complete(request) {
      requests.push(request);
      const next = replies.shift();
      if (next === undefined) throw new Error(`${name}: no scripted reply left`);
      if (next instanceof ProviderError) throw next;
      return { content: next, usage: { promptTokens: 100, completionTokens: 50 } };
    },
  };
}
