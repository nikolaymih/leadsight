---
name: orpc-contract
description: How the LeadSight API contract works with oRPC — defining procedures in packages/contract, implementing them in apps/api, calling them from apps/web with the typed client, and handling errors. Load this whenever adding or changing an endpoint, a request/response shape, an API error, or when the user mentions "contract", "procedure", "oRPC", "endpoint", "API types", "the client", or asks how the frontend talks to the backend.
---

# oRPC contract

Contract-first. `packages/contract/src/index.ts` is the single definition of the API.
The server implements it, the web app consumes it, both are type-checked against it.

## Adding or changing an endpoint

1. **Contract** (`packages/contract`): add a procedure to the right group.
   ```ts
   remove: base
     .route({ method: "DELETE", path: "/campaigns/{id}" })
     .input(z.object({ id }))
     .output(z.object({ ok: z.literal(true) })),
   ```
   Every procedure has `route({ method, path })` (keeps REST semantics and enables an
   OpenAPI handler later), an `input` (unless none), and an `output`. Reuse the shared
   schemas at the top of the file; don't inline duplicate object shapes.
2. **Implement** (`apps/api/src/orpc/procedures/<group>.ts`):
   ```ts
   import { authed } from "../implementer.js"; // implement(contract).$context<Context>().use(requireOrg)

   export const campaigns = {
     // ...
     remove: authed.campaigns.remove.handler(async ({ input, context }) => {
       await deleteCampaign(context.db, context.orgId, input.id); // core function
       return { ok: true as const };
     }),
   };
   ```
   Each group file exports one object; `router.ts` does `os.router({ campaigns, sources, leads, runs })`.
   The compiler fails if a contract procedure has no implementation. Until a procedure is
   built, its handler is `notImplemented` from `orpc/not-implemented.ts` (responds 501).
3. **Consume** (`apps/web`): `orpc.campaigns.remove.mutationOptions()` via TanStack Query
   (see the `tanstack` skill). Types flow from the contract; no manual typing.

## Conventions

- Groups mirror domain nouns: `campaigns`, `sources`, `leads`, `runs`. Add a group for a
  new noun, not a new verb.
- Inputs that identify a resource use `id` (uuid). Path params appear in both
  `path: "/x/{id}"` and the input schema.
- Lists take filters + `cursor` + `limit`, return `{ items, nextCursor }`. No offsets.
- Outputs are wire shapes, not DB rows. Dates are ISO strings. Map in the procedure with a
  small `toCampaign(row)` helper in `apps/api/src/orpc/mappers.ts`; keep mappers pure.
- Enums come from `@leadsight/core` `as const` arrays via `z.enum(...)`. Never retype them.
- Defaults live in the input schema (`.default(50)`) so the client can omit them.
- Nothing organization-specific in inputs: the org comes from the session context, never
  from the client. A client that could pass `organizationId` could read another tenant.

## Errors

- The shared `base = oc.errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND })` is on every
  procedure. Add procedure-specific errors with `.errors({ ... })` on that procedure only,
  e.g. `INVALID_CRITERIA: { data: z.object({ issues: z.array(z.string()) }) }`.
- Throw with `errors.NOT_FOUND()` inside handlers, or let core throw its typed errors and
  have `apps/api/src/orpc/error-map.ts` translate them in a middleware. One translation
  point; no inline mapping in handlers.
- Zod validation failures are returned by oRPC automatically as `BAD_REQUEST` with issues.
  Don't re-validate input in handlers.

## Context and middleware

```ts
// apps/api/src/orpc/context.ts
export interface Context { db: Db; logger: Logger; session: Session | null; orgId: string | null }

// base middleware, applied to every procedure
export const requireOrg = os.$context<Context>().middleware(async ({ context, next, errors }) => {
  if (!context.session) throw errors.UNAUTHORIZED();
  if (!context.orgId) throw errors.FORBIDDEN();
  return next({ context: { ...context, orgId: context.orgId } }); // narrows to string
});
```

## Client (web)

```ts
// apps/web/src/lib/orpc.ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { Contract } from "@leadsight/contract";

const link = new RPCLink({ url: `${process.env.NEXT_PUBLIC_API_URL}/rpc`, fetch: (u, i) => fetch(u, { ...i, credentials: "include" }) });
export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
```

`credentials: "include"` is required so Better Auth's session cookie travels with RPC calls.

## Versioning

- Additive changes (new optional field, new procedure) need nothing special.
- Breaking changes to an output: update the contract, fix the compile errors in both apps,
  ship together. The monorepo is the version boundary; there is no public API yet.

## Testing

- `packages/contract` has no runtime logic; test only custom Zod refinements if any.
- Procedure tests live in `apps/api` and call the router directly with a fake context:
  `await call(router.campaigns.get, { id }, { context })` from `@orpc/server`.
