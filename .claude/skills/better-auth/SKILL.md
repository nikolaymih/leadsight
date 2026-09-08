---
name: better-auth
description: How authentication and organizations work in LeadSight using Better Auth — server config in apps/api, Drizzle adapter, email/password + Google, organization plugin (orgs, members, invitations, active org), admin plugin, the Next.js client, session handling, and cookie/CORS setup. Load this for any task about login, signup, sessions, cookies, users, roles, organizations, members, invitations, permissions, "who can see what", tenant scoping, or when the user mentions "auth", "Better Auth", "sign in", "org", or "team".
---

# Better Auth

Server config: `apps/api/src/auth.ts` exports `createAuth({ env, db })`; the Fastify auth
plugin calls it and decorates `app.auth`. Client: `apps/web/src/lib/auth-client.ts`.
Tables: `packages/core/src/schema/auth.ts` (Drizzle), shared migration stream.

Better Auth requires `drizzle-orm >= 0.45.2` (its adapter's peer range); the workspace is
pinned accordingly. It also brings its own nested zod 4 — that is why `apps/api` builds
with `declaration: false`.

## Server config

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,           // API origin, e.g. http://localhost:3001
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } },
  trustedOrigins: [env.WEB_ORIGIN],
  plugins: [
    organization({ allowUserToCreateOrganization: true }),
    admin(),
  ],
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  advanced: { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }, // prod only
});
```

- **Verify against current docs** (`https://www.better-auth.com/docs`) before changing
  option names; the API has renamed things between minor versions.
- After changing plugins, regenerate the schema:
  `pnpm --filter @leadsight/api exec npx @better-auth/cli generate --config src/auth.ts`,
  diff against `packages/core/src/schema/auth.ts`, apply changes there, then
  `pnpm db:generate`. Keep our column naming (`snake_case` DB, camelCase TS).

## Tenant model

- One **organization** = one tenant. Every business row carries `organization_id`.
- The session's `activeOrganizationId` is the tenant for every request. The oRPC context
  reads it; `requireOrg` middleware rejects requests without one.
- Roles from the organization plugin: `owner`, `admin`, `member`. v1 permission rules:
  - `member`: read everything in the org, update lead status/assignee/notes.
  - `admin`: plus create/edit campaigns and sources, run sources, manage members.
  - `owner`: plus delete campaigns, change org settings.
  Enforce in oRPC middleware (`requireRole("admin")`), not in the UI alone. The role is
  read by `buildContext` straight from Better Auth's `member` table (one indexed query per
  request; comma-separated multi-roles resolve to the highest). A signed-in user whose
  active org has no membership row gets `FORBIDDEN` from `requireOrg`.
- On signup, if the user has no org, the web app prompts to create one or shows pending
  invitations. Internal use: the first user creates "Dev Craft" and invites the others.

## Session in the API

```ts
// orpc/context.ts
const session = await auth.api.getSession({
  headers: toWebHeaders(request.headers),
  query: { disableCookieCache: true },
});
return { db, logger, session, orgId: session?.session.activeOrganizationId ?? null };
```

Better Auth exposes `auth.api.*` for server-side calls; use it instead of HTTP round-trips.

**`disableCookieCache` is not optional.** `session.cookieCache` is on (5 min) so the web
app's `useSession` is cheap, but the cached cookie is only refreshed by `set-active`, not by
`organization.create`, member removal, or an org switch in another tab. `orgId` is the
tenant boundary, so the API reads it from the database on every request. Removing that
flag re-introduces cross-tenant reads for up to five minutes.

In the web app, call `authClient.organization.setActive({ organizationId })` right after
creating an organization so the UI's cached session catches up immediately.

## Client (web)

```ts
import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  plugins: [organizationClient(), adminClient()],
});
```

- Server components: `authClient.getSession({ fetchOptions: { headers: await headers() } })`
  so the browser cookie is forwarded.
- Org switcher: `authClient.organization.setActive({ organizationId })`, then
  `queryClient.invalidateQueries()` (everything is tenant-scoped).
- Screens: hand-built forms over `authClient` (`apps/web/src/components/auth/*`). We
  decided against `@daveyplate/better-auth-ui` (2026-09-08): its peer list pulls in passkey,
  captcha, InstantDB and react-email packages we don't use. Revisit only if the auth surface
  grows well beyond login/signup/reset/invite.

## Cookies and CORS

- Dev: web on `localhost:3000`, API on `localhost:3001`. Same site (localhost), cookies
  work with `credentials: "include"` and `trustedOrigins` including the web origin.
- Prod: `leadsight.<company-domain>` for web and `api.leadsight.<company-domain>` for
  API → enable `crossSubDomainCookies` with `domain: ".leadsight.<company-domain>"`.
  Or reverse-proxy the API under `/api` on the same host and skip cross-domain entirely
  (simpler; preferred for the internal deploy).
- Secure, HttpOnly, SameSite=Lax cookies in prod (Better Auth defaults when `baseURL` is https).

## Email

- Invitations and password resets go through the `Mailer` interface in `apps/api/src/mailer.ts`
  (`send({ to, subject, text })`). `createAuth` wires it into `sendResetPassword` and
  `sendInvitationEmail`; the auth plugin currently passes `createLogMailer`, which logs the
  email instead of delivering it. Step 9 adds the nodemailer transport behind the same
  interface — don't call nodemailer from `auth.ts` directly.
- Invitation links point at the web app (`${WEB_ORIGIN}/invite/<id>`), which calls
  `organization.acceptInvitation`. Reset links come from Better Auth; the web app requests
  them with an absolute `redirectTo` (`<web origin>/reset-password`) and that page calls
  `resetPassword({ newPassword, token })`. A relative `redirectTo` would resolve against
  the API origin.

## Testing

- `auth.api.signUpEmail` / `signInEmail` in test setup to mint real sessions against the
  test DB; extract the cookie from the response and pass it to `app.inject`.
- Don't mock Better Auth. It's fast enough against the test DB.

## Don't

- Don't read `organizationId` from client input. Ever.
- Don't store roles or org membership anywhere except Better Auth's tables.
- Don't hand-roll password hashing, tokens, or session cookies.
