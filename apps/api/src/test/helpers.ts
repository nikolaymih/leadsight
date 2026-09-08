import { randomUUID } from "node:crypto";
import type { Contract } from "@leadsight/contract";
import { createTestDb } from "@leadsight/core/test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { InjectOptions } from "fastify";
import { type App, buildApp } from "../app.js";
import { loadEnv } from "../env.js";

// Each test app gets its own freshly migrated database (see the postgres-drizzle skill).
// `app.close()` drops it.

export async function buildTestApp(): Promise<App> {
  const testDb = await createTestDb();
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: testDb.url,
    WEB_ORIGIN: "http://localhost:3000",
    BETTER_AUTH_URL: "http://localhost:3001",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
  });
  const app = await buildApp(env);
  app.addHook("onClose", async () => {
    await testDb.close();
  });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Cookies: a tiny jar so a test can carry a Better Auth session across calls.
// ---------------------------------------------------------------------------

export type CookieJar = Map<string, string>;

function absorb(jar: CookieJar, setCookie: string | string[] | undefined): void {
  for (const raw of [setCookie].flat()) {
    if (!raw) continue;
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}

export function cookieHeader(jar: CookieJar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

// ---------------------------------------------------------------------------
// Better Auth flows, over app.inject
// ---------------------------------------------------------------------------

export async function signUp(app: App, email = `${randomUUID()}@example.com`): Promise<CookieJar> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Test User", email, password: "correct-horse-battery-staple" },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const jar: CookieJar = new Map();
  absorb(jar, res.headers["set-cookie"]);
  return jar;
}

export async function createOrganization(app: App, jar: CookieJar, name = "Test Org"): Promise<string> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/organization/create",
    headers: { cookie: cookieHeader(jar) },
    payload: { name, slug },
  });
  if (res.statusCode !== 200) throw new Error(`organization create failed: ${res.statusCode} ${res.body}`);
  absorb(jar, res.headers["set-cookie"]);
  const { id } = res.json<{ id: string }>();
  return id;
}

// ---------------------------------------------------------------------------
// oRPC: the real typed client, with fetch routed through app.inject
// ---------------------------------------------------------------------------

export function rpcClient(app: App, jar?: CookieJar): ContractRouterClient<Contract> {
  const link = new RPCLink({
    url: "http://localhost/rpc",
    headers: jar ? { cookie: cookieHeader(jar) } : {},
    fetch: async (request: Request) => {
      const res = await app.inject({
        method: request.method as InjectOptions["method"],
        url: request.url,
        headers: Object.fromEntries(request.headers),
        payload: request.method === "GET" ? undefined : await request.text(),
      });
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        for (const v of [value].flat()) headers.append(key, String(v));
      }
      return new Response(res.body, { status: res.statusCode, headers });
    },
  });
  return createORPCClient(link);
}
