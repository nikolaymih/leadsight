---
name: fastify
description: How to build and extend the LeadSight API server in apps/api with Fastify 5. Load this whenever working on anything server-side that isn't pure domain logic — routes, plugins, the oRPC handler mount, Better Auth mounting, the scheduler, request logging, CORS, graceful shutdown, health checks, or the API's app.ts/server.ts. Also load it when the user mentions "the API", "the backend", "the service", "endpoint", or "server".
---

# Fastify (apps/api)

## Layout

```
apps/api/src/
  env.ts              Zod-validated env, the only place that reads process.env; loadEnv(source?)
  server.ts           entry: loadEnv, buildApp, listen, SIGTERM/SIGINT with a 10s deadline
  migrate.ts          deploy-step entry (`node dist/migrate.js`): core's runMigrations over DATABASE_URL, non-zero exit on failure
  Dockerfile          multi-stage (root build context): pnpm install → build core/contract/api → `pnpm deploy --legacy --prod` → node:22-alpine runner; same image runs migrate and server
  app.ts              buildApp(env): registers plugins in order, returns the FastifyInstance
  auth.ts             createAuth({ env, db, mailer }) → Better Auth instance (explicit deps, no singleton)
  http.ts             Node ⇄ web conversions (toWebHeaders, toWebRequest) for Better Auth
  mailer.ts           createSmtpMailer (nodemailer, SMTP_URL/SMTP_FROM) and createLogMailer behind core's Mailer
  plugins/
    db.ts             decorates app.db (drizzle client), closes the pool on app.close
    mailer.ts         decorates app.mailer + app.mailFrom: SMTP when SMTP_URL is set, else log-only (warns in production)
    auth.ts           decorates app.auth, mounts /api/auth/* in an encapsulated scope with a raw-string body parser
    orpc.ts           RPCHandler from @orpc/server/fastify, mounts /rpc/*
    pipeline.ts       builds core's PipelineDeps from env once (registry, providers, budget, notifiers [email digest], extractorFor, drafterFor), decorates app.pipeline
    scheduler.ts      one node-cron job → runPipeline(app.pipeline); createTick() mutex; started on ready, stopped on close
  orpc/
    context.ts        Context type, buildContext(request, { db, auth, pipeline, mailer, mailFrom }), requireOrg middleware
    implementer.ts    os = implement(contract).$context<Context>(); authed = os.use(requireOrg)
    error-map.ts      core errors → ORPCError                                      (step 2)
    router.ts         os.router({ campaigns, sources, leads, runs }); fails to compile if a procedure is missing
    procedures/       one file per contract group, each exporting the group object
  routes/
    health.ts         GET /healthz (plain Fastify route; no auth)
  test/
    helpers.ts        buildTestApp, signUp, createOrganization, rpcClient (typed oRPC client over app.inject)
```

`tsconfig.json` sets `declaration: false`: this is an app, nobody consumes its types, and
Better Auth's inferred types reference its own nested zod, which is not nameable from
declaration output (TS2742).

## Rules

- **Plugins via `fastify-plugin`** so decorators are visible app-wide. Every file in
  `plugins/` exports `fp(async (app, opts) => { ... })` with a `name` and `dependencies`.
- **Register order matters** and is fixed in `app.ts`: env → logger config → cors → db →
  mailer → auth → pipeline → orpc → scheduler → routes. Don't register anything outside `app.ts`.
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

- `node-cron` in `plugins/scheduler.ts`. One job (`SCHEDULER_CRON`, default `*/5 * * * *`)
  calls `runPipeline(app.pipeline)`; the pipeline picks the due sources itself. Don't
  create one cron per source. `SCHEDULER_ENABLED=false` turns it off (tests do this).
- `createTick(run, log)` is the overlap guard: a tick while the previous run is in
  progress returns `"skipped"` and logs a warning; a throwing run returns `"failed"`
  and logs — a tick never throws. It is exported and unit-tested without a DB.
- `plugins/pipeline.ts` assembles the deps once: `createSourceRegistry` from
  `REDDIT_*`, Groq/Gemini providers for whichever keys are set (a warning at boot when
  none), `createBudget` over `createDbBudgetStore(app.db)` with `*_DAILY_TOKENS` caps,
  and `extractorFor(orgId)`. `app.pipeline` is what the `sources.run` procedure passes
  to `runPipeline({ ...app.pipeline, sourceIds: [id] })` for a manual run.

## Testing the API

- `buildTestApp()` from `src/test/helpers.ts` builds the app against `DATABASE_URL`
  (default: the docker-compose instance) with a silent logger. Migrations must already be
  applied; tests never run them.
- `app.inject()` for plain routes. For oRPC, use `rpcClient(app, jar)` — the real typed
  `@orpc/client` with `fetch` routed through `app.inject`, so tests exercise the same
  protocol the web app uses. Assert on `error.code` (`UNAUTHORIZED`, `FORBIDDEN`, …).
- `signUp(app)` and `createOrganization(app, jar)` mint real Better Auth sessions and
  carry cookies in a small jar. Don't mock Better Auth.
- Test files run serially (`fileParallelism: false`) because they share one database.
- For oRPC procedures, prefer testing the core function they call. Test the procedure
  only for auth/mapping behavior.

## Dev commands

- `pnpm dev:api` → `tsx watch src/server.ts`
- `pnpm --filter @leadsight/api typecheck`
