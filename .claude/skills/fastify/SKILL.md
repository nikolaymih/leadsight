---
name: fastify
description: How to build and extend the LeadSight API server in apps/api with Fastify 5. Load this whenever working on anything server-side that isn't pure domain logic — routes, plugins, the oRPC handler mount, Better Auth mounting, the scheduler, request logging, CORS, graceful shutdown, health checks, or the API's app.ts/server.ts. Also load it when the user mentions "the API", "the backend", "the service", "endpoint", or "server".
---

# Fastify (apps/api)

## Layout

```
apps/api/src/
  env.ts              Zod-validated env, the only place that reads process.env
  server.ts           entry: build app, listen, handle SIGTERM
  app.ts              buildApp(): registers plugins in order, returns FastifyInstance
  plugins/
    db.ts             decorates app.db (drizzle client), closes on app.close
    auth.ts           Better Auth instance, mounts /api/auth/*, decorates request.session
    orpc.ts           RPCHandler from @orpc/server/fastify, mounts /rpc/*
    scheduler.ts      node-cron jobs, started on ready, stopped on close
  orpc/
    context.ts        builds the oRPC context from request (session, org, db, logger)
    error-map.ts      core errors → ORPCError
    router.ts         implement(contract) with all procedures wired
    procedures/       one file per contract group: campaigns.ts, sources.ts, leads.ts, runs.ts
  routes/
    health.ts         GET /healthz (plain Fastify route; no auth)
```

## Rules

- **Plugins via `fastify-plugin`** so decorators are visible app-wide. Every file in
  `plugins/` exports `fp(async (app, opts) => { ... })` with a `name` and `dependencies`.
- **Register order matters** and is fixed in `app.ts`: env → logger config → cors → db →
  auth → orpc → scheduler → routes. Don't register anything outside `app.ts`.
- **No business logic in the API package.** Procedures call functions from
  `@leadsight/core` and map rows to contract shapes. See `code-style` skill.
- **Auth on every oRPC procedure** except none. The oRPC context builder reads the Better
  Auth session; a base middleware throws `UNAUTHORIZED` when missing and `FORBIDDEN` when
  the requested resource's `organizationId` ≠ session's active org.
- **Health endpoint is plain Fastify** (`routes/health.ts`), returns `{ ok: true, db: "up" }`
  after a `select 1`. Used by the hosting machine's process manager.
- **Graceful shutdown**: `server.ts` listens for SIGTERM/SIGINT, calls `app.close()`,
  which triggers `onClose` hooks (scheduler stop, DB pool end). Give it a 10s deadline.
- **Logging**: pino via Fastify's `logger` option. Pretty-print only when
  `NODE_ENV=development`. Redact `authorization`, `cookie`, and any `*key*` header.
- **CORS**: `@fastify/cors` with `origin: env.WEB_ORIGIN`, `credentials: true`
  (Better Auth cookies cross origin in dev).
- **Body limits**: default is fine; campaign draft with pasted page text can be long —
  set `bodyLimit: 1_048_576` in `buildApp`.

## Mounting Better Auth

```ts
// plugins/auth.ts
app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) if (v) headers.append(k, String(v));
    const req = new Request(url, { method: request.method, headers, body: request.body ? JSON.stringify(request.body) : undefined });
    const res = await auth.handler(req);
    reply.status(res.status);
    res.headers.forEach((v, k) => reply.header(k, v));
    reply.send(res.body ? await res.text() : null);
  },
});
```

Set `app.addContentTypeParser("application/json", { parseAs: "string" }, (_r, body, done) => done(null, body))`
scoped to this plugin so Better Auth receives the raw body. Check the current Better Auth
docs for the Fastify integration before changing this; the API surface has moved before.

## Mounting oRPC

```ts
// plugins/orpc.ts
import { RPCHandler } from "@orpc/server/fastify";
const handler = new RPCHandler(router);
app.all("/rpc/*", async (request, reply) => {
  const { matched } = await handler.handle(request, reply, {
    prefix: "/rpc",
    context: await buildContext(request),
  });
  if (!matched) reply.status(404).send({ error: "not found" });
});
```

Use `RPCHandler` (RPC protocol, compact) for the web app. If a third party ever needs REST,
add `OpenAPIHandler` from `@orpc/openapi/fastify` on `/api/*` — the contract already has
`method` and `path` on every route for that reason.

## Scheduler

- `node-cron` in `plugins/scheduler.ts`. One job: `*/5 * * * *` calls
  `runDueSources(db, ...)` from core, which picks sources whose `poll_interval_min` has
  elapsed. Don't create one cron per source.
- Guard against overlap with an in-process mutex (`let running = false`). If a run is
  still going, skip the tick and log it.
- Jobs must never throw out of the tick. Wrap in try/catch, log, write an `events` row.

## Testing the API

- `app.inject()` for route tests; build the app with a test DB URL.
- For oRPC procedures, prefer testing the core function they call. Test the procedure
  only for auth/mapping behavior.

## Dev commands

- `pnpm dev:api` → `tsx watch src/server.ts`
- `pnpm --filter @leadsight/api typecheck`
