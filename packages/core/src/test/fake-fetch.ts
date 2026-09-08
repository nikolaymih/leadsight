import { readFile } from "node:fs/promises";

// A programmable `fetch` for adapter tests. Routes match on URL; responses can be
// fixtures, inline JSON, or a sequence for retry scenarios. Every call is recorded.

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FakeRoute {
  /** Substring or RegExp tested against the full URL. */
  match: string | RegExp;
  /** One response, or a sequence consumed per call (the last one repeats). */
  respond: ((call: RecordedCall, index: number) => Response | Promise<Response>) | Response[];
}

export interface FakeFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Calls whose URL matched the given substring/RegExp. */
  callsTo(match: string | RegExp): RecordedCall[];
}

export function fakeFetch(routes: FakeRoute[]): FakeFetch {
  const calls: RecordedCall[] = [];
  const hits = new Map<FakeRoute, number>();

  const impl: typeof fetch = async (input, init) => {
    const call = record(input, init);
    calls.push(call);

    const route = routes.find((r) => matches(r.match, call.url));
    if (!route) throw new TypeError(`fetch failed: no fake route for ${call.url}`);

    const index = hits.get(route) ?? 0;
    hits.set(route, index + 1);
    if (Array.isArray(route.respond)) {
      const res = route.respond[Math.min(index, route.respond.length - 1)];
      if (!res) throw new Error("fake route has no responses");
      return res.clone();
    }
    return route.respond(call, index);
  };

  return {
    fetch: impl,
    calls,
    callsTo: (match) => calls.filter((c) => matches(match, c.url)),
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...headersToObject(init.headers) },
  });
}

export function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

/** Read a file from `src/test/fixtures/<path>`. */
export async function loadFixture(path: string): Promise<string> {
  return readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

export async function loadJsonFixture(path: string): Promise<unknown> {
  return JSON.parse(await loadFixture(path));
}

function matches(match: string | RegExp, url: URL): boolean {
  return typeof match === "string" ? url.toString().includes(match) : match.test(url.toString());
}

function record(input: string | URL | Request, init: RequestInit | undefined): RecordedCall {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers = headersToObject(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const body = typeof init?.body === "string" ? init.body : undefined;
  return { url, method: (init?.method ?? "GET").toUpperCase(), headers, body };
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
