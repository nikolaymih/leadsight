import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "./app.js";
import {
  buildTestApp,
  type CookieJar,
  cookieHeader,
  createOrganization,
  rpcClient,
  signIn,
  signUp,
} from "./test/helpers.js";

// The session.create.before hook in auth.ts: a new session defaults its active org to the
// user's earliest membership, so a fresh sign-in isn't rejected by requireOrg.

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

async function activeOrganizationId(jar: CookieJar): Promise<string | null | undefined> {
  const res = await app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie: cookieHeader(jar) },
  });
  return res.json<{ session?: { activeOrganizationId?: string | null } } | null>()?.session
    ?.activeOrganizationId;
}

describe("session active organization default", () => {
  it("sets the earliest membership as active on a fresh sign-in", async () => {
    const email = `${randomUUID()}@example.com`;
    const signupJar = await signUp(app, email);
    const firstOrg = await createOrganization(app, signupJar, "First Org");
    await createOrganization(app, signupJar, "Second Org");

    const jar = await signIn(app, email);
    expect(await activeOrganizationId(jar)).toBe(firstOrg);
    await expect(rpcClient(app, jar).campaigns.list()).resolves.toEqual([]);
  });

  it("leaves it null when the user has no membership", async () => {
    const email = `${randomUUID()}@example.com`;
    await signUp(app, email);

    const jar = await signIn(app, email);
    expect(await activeOrganizationId(jar)).toBeNull();
    await expect(rpcClient(app, jar).campaigns.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
