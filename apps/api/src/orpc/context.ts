import { ORPCError, os } from "@orpc/server";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { Auth } from "../auth.js";
import { toWebHeaders } from "../http.js";
import type { Db } from "../plugins/db.js";

export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export interface Context {
  db: Db;
  logger: FastifyBaseLogger;
  session: AuthSession | null;
  /** The session's active organization — the tenant for this request. Never from client input. */
  orgId: string | null;
}

export interface ContextDeps {
  db: Db;
  auth: Auth;
}

export async function buildContext(request: FastifyRequest, deps: ContextDeps): Promise<Context> {
  // orgId is the tenant boundary, so it is always read from the database. The session
  // cookie cache is for the web app's own UI reads; a stale activeOrganizationId here
  // (after org create/switch/removal) would scope queries to the wrong tenant.
  const session = await deps.auth.api.getSession({
    headers: toWebHeaders(request.headers),
    query: { disableCookieCache: true },
  });
  return {
    db: deps.db,
    logger: request.log,
    session,
    orgId: session?.session.activeOrganizationId ?? null,
  };
}

/** Applied to every procedure: signed in, and scoped to an active organization. */
export const requireOrg = os.$context<Context>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError("UNAUTHORIZED");
  if (!context.orgId) throw new ORPCError("FORBIDDEN");
  return next({ context: { ...context, session: context.session, orgId: context.orgId } });
});
