import { ProviderError } from "../../errors.js";
import { REQUEST_TIMEOUT_MS, type SourceDeps } from "../source.js";

// Reddit OAuth (client-credentials) + a GET helper that honours rate limits and
// retries once on 429/5xx. Nothing here knows about posts or listings.

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
/** Refresh this long before the token actually expires. */
const TOKEN_SKEW_MS = 60_000;
/** Below this many remaining requests, wait for the window to reset. */
const RATELIMIT_FLOOR = 5;
const DEFAULT_RETRY_AFTER_MS = 2_000;

export type RedditParams = Record<string, string | number | undefined>;

export interface RedditClient {
  get(path: string, params?: RedditParams): Promise<unknown>;
}

export function createRedditClient(deps: SourceDeps): RedditClient {
  let token: { value: string; expiresAt: number } | undefined;

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${deps.reddit.clientId}:${deps.reddit.clientSecret}`).toString("base64");
    const res = await deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "user-agent": deps.userAgent,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ProviderError("reddit", `token request failed: HTTP ${res.status}`, {
        status: res.status,
        retryable: res.status >= 500,
      });
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string")
      throw new ProviderError("reddit", "token response missing access_token");
    const ttl = typeof body.expires_in === "number" ? body.expires_in * 1000 : 3_600_000;
    token = { value: body.access_token, expiresAt: deps.now().getTime() + ttl };
    return token.value;
  }

  async function bearer(): Promise<string> {
    if (token && token.expiresAt - TOKEN_SKEW_MS > deps.now().getTime()) return token.value;
    return fetchToken();
  }

  async function request(path: string, params: RedditParams, attempt: number): Promise<unknown> {
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    url.searchParams.set("raw_json", "1");

    const res = await deps.fetch(url, {
      headers: { authorization: `Bearer ${await bearer()}`, "user-agent": deps.userAgent },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    await respectRateLimit(res.headers);

    if (res.status === 401 && attempt === 0) {
      token = undefined; // revoked or expired early; mint a new one and try once more
      return request(path, params, attempt + 1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await deps.sleep(retryAfterMs(res.headers));
      return request(path, params, attempt + 1);
    }
    if (!res.ok) {
      throw new ProviderError("reddit", `GET ${url.pathname}: HTTP ${res.status}`, {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return res.json();
  }

  async function respectRateLimit(headers: Headers): Promise<void> {
    const remaining = Number(headers.get("x-ratelimit-remaining"));
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (Number.isFinite(remaining) && remaining < RATELIMIT_FLOOR && Number.isFinite(reset) && reset > 0) {
      await deps.sleep(Math.ceil(reset) * 1000);
    }
  }

  function retryAfterMs(headers: Headers): number {
    const seconds = Number(headers.get("retry-after"));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
  }

  return { get: (path, params = {}) => request(path, params, 0) };
}
