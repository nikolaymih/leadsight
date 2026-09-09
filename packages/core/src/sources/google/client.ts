import { z } from "zod";
import { ProviderError } from "../../errors.js";
import { REQUEST_TIMEOUT_MS, type SourceDeps } from "../source.js";
import { type SearchRequest, type SearchResultItem, searchRequestUrl } from "./query.js";

// Google Programmable Search JSON API — one GET per page. Errors are typed: quota (403/429)
// is not retryable today, 5xx is. The adapter above decides how many pages to spend.

export interface GoogleSearchCredentials {
  key: string;
  cx: string;
}

export interface GoogleSearchPage {
  items: SearchResultItem[];
  totalResults: number | null;
}

export interface GoogleSearchClient {
  search(req: Omit<SearchRequest, "key" | "cx">): Promise<GoogleSearchPage>;
}

const itemSchema = z.object({
  link: z.string().url(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  pagemap: z.object({ metatags: z.array(z.record(z.string(), z.string().optional())).optional() }).optional(),
});

const pageSchema = z.object({
  items: z.array(z.unknown()).optional(),
  searchInformation: z.object({ totalResults: z.string().optional() }).optional(),
});

const errorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

export const PROVIDER = "google_cse";

export function createGoogleSearchClient(
  deps: SourceDeps,
  credentials: GoogleSearchCredentials,
): GoogleSearchClient {
  return {
    async search(req) {
      const url = searchRequestUrl({ ...req, key: credentials.key, cx: credentials.cx });
      let res: Response;
      try {
        res = await deps.fetch(url, {
          headers: { "user-agent": deps.userAgent, accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new ProviderError(PROVIDER, "request failed", { retryable: true, cause: err });
      }

      if (!res.ok) {
        const body = await res.text();
        const parsed = errorSchema.safeParse(safeJson(body));
        const reason = parsed.success ? parsed.data.error.errors?.[0]?.reason : undefined;
        const message = parsed.success ? (parsed.data.error.message ?? "") : body.slice(0, 200);
        const quota = res.status === 429 || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded";
        throw new ProviderError(
          PROVIDER,
          quota ? `daily query quota exceeded (${message || res.status})` : `HTTP ${res.status}: ${message}`,
          { status: res.status, retryable: res.status >= 500 },
        );
      }

      const page = pageSchema.safeParse(await res.json());
      if (!page.success) throw new ProviderError(PROVIDER, "unexpected response shape", { status: 200 });

      const items: SearchResultItem[] = [];
      for (const raw of page.data.items ?? []) {
        const item = itemSchema.safeParse(raw);
        if (item.success) items.push(item.data);
      }
      const total = page.data.searchInformation?.totalResults;
      return { items, totalResults: total !== undefined ? Number(total) : null };
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
