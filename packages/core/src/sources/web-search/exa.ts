import { Exa } from "exa-js";
import { z } from "zod";
import {
  failureForStatus,
  type SearchProvider,
  SearchProviderError,
  type SearchRequest,
  type SearchResponse,
} from "./provider.js";

// Exa (exa-js). One `search` per query with highlights as the snippet; billed per request, so
// every successful call is one unit. `type: "auto"` lets Exa pick keyword or neural retrieval
// for the OR-query. Errors carry `statusCode` (ExaError); anything else is a network failure.

export const EXA = "exa";

/** The slice of the SDK we use; tests pass a fake with the same shape. */
export interface ExaClientLike {
  search(query: string, options: Record<string, unknown>): Promise<unknown>;
}

// Every field but the URL may be missing or null (Exa returns `publishedDate: null` for
// pages it could not date); a result is only dropped when its URL is unusable.
const resultSchema = z.object({
  url: z.string().url(),
  title: z.string().nullish(),
  publishedDate: z.string().nullish(),
  author: z.string().nullish(),
  highlights: z.array(z.string()).nullish(),
  text: z.string().nullish(),
});

const responseSchema = z.object({ results: z.array(z.unknown()) });

export interface ExaProviderOptions {
  apiKey: string;
  /** Injected for tests; default `new Exa(apiKey)`. */
  client?: ExaClientLike;
}

export function createExaProvider(opts: ExaProviderOptions): SearchProvider {
  const client = opts.client ?? (new Exa(opts.apiKey) as unknown as ExaClientLike);

  return {
    name: EXA,
    async search(request: SearchRequest): Promise<SearchResponse> {
      let raw: unknown;
      try {
        raw = await client.search(request.query, {
          type: "auto",
          numResults: request.maxResults,
          ...(request.includeDomains.length > 0 ? { includeDomains: request.includeDomains } : {}),
          startPublishedDate: request.since.toISOString(),
          contents: { highlights: true },
        });
      } catch (err) {
        throw toSearchError(err);
      }

      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new SearchProviderError(EXA, "unexpected response shape", "invalid");

      const hits: SearchResponse["hits"] = [];
      for (const item of parsed.data.results) {
        const r = resultSchema.safeParse(item);
        if (!r.success) continue;
        hits.push({
          url: r.data.url,
          title: r.data.title ?? undefined,
          snippet: r.data.highlights?.join(" … ") || r.data.text || undefined,
          publishedAt: parseDate(r.data.publishedDate),
          author: r.data.author ?? undefined,
          raw: item,
        });
      }
      return { hits, units: 1 };
    },
  };
}

function toSearchError(err: unknown): SearchProviderError {
  const status =
    typeof err === "object" && err !== null && "statusCode" in err && typeof err.statusCode === "number"
      ? err.statusCode
      : undefined;
  const message = err instanceof Error ? err.message : String(err);
  return new SearchProviderError(
    EXA,
    status ? `HTTP ${status}: ${message}` : message,
    failureForStatus(status),
    {
      status,
      cause: err,
    },
  );
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
