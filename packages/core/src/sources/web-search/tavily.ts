import { tavily } from "@tavily/core";
import { z } from "zod";
import {
  failureForStatus,
  type SearchFailureKind,
  type SearchProvider,
  SearchProviderError,
  type SearchRequest,
  type SearchResponse,
} from "./provider.js";

// Tavily (@tavily/core). Basic-depth search, one credit per call; the response's
// `usage.credits` is trusted when present. The SDK throws plain Errors whose message is either
// `"<status> Error: <body>"` or the API's `detail.error` text without a status, so failures are
// classified from the message.

export const TAVILY = "tavily";

/** The slice of the SDK we use; tests pass a fake with the same shape. */
export interface TavilyClientLike {
  search(query: string, options: Record<string, unknown>): Promise<unknown>;
}

// Every field but the URL may be missing or null; a result is only dropped when its URL is unusable.
const resultSchema = z.object({
  url: z.string().url(),
  title: z.string().nullish(),
  content: z.string().nullish(),
  publishedDate: z.string().nullish(),
});

const responseSchema = z.object({
  results: z.array(z.unknown()),
  usage: z.object({ credits: z.number() }).optional(),
});

export interface TavilyProviderOptions {
  apiKey: string;
  /** Injected for tests; default `tavily({ apiKey })`. */
  client?: TavilyClientLike;
}

export function createTavilyProvider(opts: TavilyProviderOptions): SearchProvider {
  const client = opts.client ?? (tavily({ apiKey: opts.apiKey }) as unknown as TavilyClientLike);

  return {
    name: TAVILY,
    async search(request: SearchRequest): Promise<SearchResponse> {
      let raw: unknown;
      try {
        raw = await client.search(request.query, {
          searchDepth: "basic",
          topic: "general",
          maxResults: request.maxResults,
          ...(request.includeDomains.length > 0 ? { includeDomains: request.includeDomains } : {}),
          startDate: request.since.toISOString().slice(0, 10),
          includeUsage: true,
        });
      } catch (err) {
        throw toSearchError(err);
      }

      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new SearchProviderError(TAVILY, "unexpected response shape", "invalid");

      const hits: SearchResponse["hits"] = [];
      for (const item of parsed.data.results) {
        const r = resultSchema.safeParse(item);
        if (!r.success) continue;
        const published = r.data.publishedDate ? new Date(r.data.publishedDate) : undefined;
        hits.push({
          url: r.data.url,
          title: r.data.title ?? undefined,
          snippet: r.data.content ?? undefined,
          publishedAt: published && !Number.isNaN(published.getTime()) ? published : undefined,
          raw: item,
        });
      }
      return { hits, units: parsed.data.usage?.credits ?? 1 };
    },
  };
}

/** Status from `"432 Error: …"`, else keywords in the API's error text. */
export function classifyTavilyError(message: string): { failure: SearchFailureKind; status?: number } {
  const m = /^(\d{3}) Error:/.exec(message);
  if (m) {
    const status = Number(m[1]);
    return { failure: failureForStatus(status), status };
  }
  if (/timed out|ECONN|ETIMEDOUT|socket hang up|unexpected error occurred/i.test(message)) {
    return { failure: "transient" };
  }
  if (/unauthori[sz]ed|invalid api key|api key is (missing|invalid)|forbidden/i.test(message)) {
    return { failure: "auth" };
  }
  if (/rate limit|too many requests/i.test(message)) return { failure: "rate_limit" };
  if (/usage limit|plan limit|credits?|quota|exceed/i.test(message)) return { failure: "quota" };
  return { failure: "invalid" };
}

function toSearchError(err: unknown): SearchProviderError {
  const message = err instanceof Error ? err.message : String(err);
  const { failure, status } = classifyTavilyError(message);
  return new SearchProviderError(TAVILY, message, failure, { status, cause: err });
}
