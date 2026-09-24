import { ProviderError } from "../../errors.js";
import type { Platform } from "../../types.js";

// The provider contract behind the web_search source. Each provider is a thin wrapper over its
// SDK that takes one query and returns normalised hits plus the billable units it charged.
// Providers never retry and never touch budgets; the rotator decides who is asked and the
// pipeline books the usage.

export interface SearchRequest {
  /** OR-query text, e.g. `"looking for a cto" OR "need a technical cofounder"`. */
  query: string;
  /** Domain filter, e.g. `["reddit.com"]`; empty = the open web. */
  includeDomains: string[];
  /** Only results published at or after this instant. */
  since: Date;
  maxResults: number;
  /** For logging and provider-specific tuning only. */
  platform: Platform;
}

export interface SearchHit {
  url: string;
  title?: string;
  /** Best available excerpt: highlights for Exa, content for Tavily. */
  snippet?: string;
  publishedAt?: Date;
  author?: string;
  /** Original provider item, kept for debugging. */
  raw: unknown;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Units the provider charged for this call (Exa: 1 per request; Tavily: credits). */
  units: number;
}

export interface SearchProvider {
  /** Stable id used for budgets and events: `exa`, `tavily`. */
  readonly name: string;
  search(request: SearchRequest): Promise<SearchResponse>;
}

/** How a failed call should be treated by the rotator. */
export type SearchFailureKind =
  /** Monthly/plan credits used up: cool the provider down until the next UTC month. */
  | "quota"
  /** Too many requests right now: skip the provider for a short while. */
  | "rate_limit"
  /** Bad or revoked key: skip the provider for a while and say so in the error. */
  | "auth"
  /** Timeout, network, 5xx: try the next provider now. */
  | "transient"
  /** Our request was rejected (400) or the response made no sense: try the next provider. */
  | "invalid";

export class SearchProviderError extends ProviderError {
  constructor(
    provider: string,
    message: string,
    readonly failure: SearchFailureKind,
    opts: { status?: number; cause?: unknown } = {},
  ) {
    super(provider, message, {
      status: opts.status,
      retryable: failure === "transient" || failure === "rate_limit",
      cause: opts.cause,
    });
    this.name = "SearchProviderError";
  }
}

export function failureForStatus(status: number | undefined): SearchFailureKind {
  if (status === undefined) return "transient";
  if (status === 401 || status === 403) return "auth";
  // 402 payment required, 432/433 are Tavily's plan / pay-as-you-go limits.
  if (status === 402 || status === 432 || status === 433) return "quota";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "transient";
  return "invalid";
}
