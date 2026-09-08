import { type Db, schema } from "@leadsight/core";
import { ORPCError, os } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { Auth } from "../auth.js";
import { toWebHeaders } from "../http.js";
import type { Pipeline } from "../plugins/pipeline.js";

export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export const ORG_ROLES = ["member", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
const RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

export interface Context {
  db: Db;
  logger: FastifyBaseLogger;
  pipeline: Pipeline;
  session: AuthSession | null;
  /** The session's active organization — the tenant for this request. Never from client input. */
  orgId: string | null;
  /** The user's role in that organization, from Better Auth's member table. */
  role: OrgRole | null;
}

export interface ContextDeps {
  db: Db;
  auth: Auth;
  pipeline: Pipeline;
}

export async function buildContext(request: FastifyRequest, deps: ContextDeps): Promise<Context> {
  // orgId is the tenant boundary, so it is always read from the database. The session
  // cookie cache is for the web app's own UI reads; a stale activeOrganizationId here
  // (after org create/switch/removal) would scope queries to the wrong tenant.
  const session = await deps.auth.api.getSession({
    headers: toWebHeaders(request.headers),
    query: { disableCookieCache: true },
  });
  const orgId = session?.session.activeOrganizationId ?? null;
  const role = session && orgId ? await lookupRole(deps.db, orgId, session.user.id) : null;

  return { db: deps.db, logger: request.log, pipeline: deps.pipeline, session, orgId, role };
}

/** Better Auth may store several comma-separated roles; the highest one counts. */
async function lookupRole(db: Db, orgId: string, userId: string): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!row) return null;
  const roles = row.role
    .split(",")
    .map((r) => r.trim())
    .filter(isOrgRole);
  return roles.length > 0 ? roles.reduce((best, r) => (RANK[r] > RANK[best] ? r : best)) : "member";
}

function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

/** Applied to every procedure: signed in, and scoped to an active organization the user belongs to. */
export const requireOrg = os.$context<Context>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError("UNAUTHORIZED");
  if (!context.orgId || !context.role) throw new ORPCError("FORBIDDEN");
  return next({
    context: { ...context, session: context.session, orgId: context.orgId, role: context.role },
  });
});

/** member: read + triage. admin: campaigns, sources, runs, members. owner: delete campaigns, org settings. */
export function requireRole(min: OrgRole) {
  return os.$context<Context>().middleware(async ({ context, next }) => {
    if (!context.role || RANK[context.role] < RANK[min]) {
      throw new ORPCError("FORBIDDEN", { message: `This action requires the ${min} role` });
    }
    return next();
  });
}
