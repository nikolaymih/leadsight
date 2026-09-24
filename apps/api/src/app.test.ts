import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "./app.js";
import { buildTestApp, createOrganization, rpcClient, signUp } from "./test/helpers.js";

describe("api skeleton", () => {
  let app: App;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /healthz reports the database up", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: "up" });
  });

  it("returns 404 for an unknown rpc path", async () => {
    const res = await app.inject({ method: "POST", url: "/rpc/nope", payload: { json: null } });
    expect(res.statusCode).toBe(404);
  });

  it("rejects rpc calls without a session", async () => {
    await expect(rpcClient(app).campaigns.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects rpc calls from a session with no active organization", async () => {
    const jar = await signUp(app);
    await expect(rpcClient(app, jar).campaigns.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reaches the router once an organization is active", async () => {
    const jar = await signUp(app);
    await createOrganization(app, jar);
    await expect(rpcClient(app, jar).campaigns.list()).resolves.toEqual([]);
  });
});
