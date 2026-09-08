import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../errors.js";
import { postSources, type Source, sources } from "../schema/index.js";
import { type SourceConfig, sourceConfigSchema } from "../types.js";
import { getCampaign } from "./campaigns.js";
import type { DbLike } from "./client.js";

export interface SourceWithStats extends Source {
  /** Posts this source surfaced in the last 24h (via post_sources). */
  postsLast24h: number;
}

export type CreateSourceInput = SourceConfig & {
  campaignId: string;
  pollIntervalMin?: number;
  enabled?: boolean;
};

export interface UpdateSourcePatch {
  enabled?: boolean;
  pollIntervalMin?: number;
  config?: Record<string, unknown>;
}

export interface SourceRunRecord {
  ranAt: Date;
  /** Persisted as-is; omit to leave the stored cursor untouched (e.g. on failure). */
  cursor?: unknown;
  /** Set on failure; cleared on success. */
  error?: string | null;
}

const postsLast24h = sql<number>`(
  select count(*) from ${postSources}
  where ${postSources.sourceId} = ${sources.id}
    and ${postSources.matchedAt} > now() - interval '24 hours'
)`.mapWith(Number);

export async function listSources(db: DbLike, orgId: string, campaignId: string): Promise<SourceWithStats[]> {
  const rows = await db
    .select({ source: sources, postsLast24h })
    .from(sources)
    .where(and(eq(sources.organizationId, orgId), eq(sources.campaignId, campaignId)))
    .orderBy(asc(sources.createdAt));
  return rows.map((r) => ({ ...r.source, postsLast24h: r.postsLast24h }));
}

export async function getSource(db: DbLike, orgId: string, id: string): Promise<Source> {
  const [row] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.organizationId, orgId), eq(sources.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("source", id);
  return row;
}

export async function getSourceWithStats(db: DbLike, orgId: string, id: string): Promise<SourceWithStats> {
  const [row] = await db
    .select({ source: sources, postsLast24h })
    .from(sources)
    .where(and(eq(sources.organizationId, orgId), eq(sources.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("source", id);
  return { ...row.source, postsLast24h: row.postsLast24h };
}

export async function createSource(db: DbLike, orgId: string, input: CreateSourceInput): Promise<Source> {
  await getCampaign(db, orgId, input.campaignId); // NotFound if the campaign is not in this org
  const { kind, config } = validateConfig({ kind: input.kind, config: input.config });

  const [row] = await db
    .insert(sources)
    .values({
      organizationId: orgId,
      campaignId: input.campaignId,
      kind,
      config,
      pollIntervalMin: input.pollIntervalMin,
      enabled: input.enabled,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function updateSource(
  db: DbLike,
  orgId: string,
  id: string,
  patch: UpdateSourcePatch,
): Promise<Source> {
  const current = await getSource(db, orgId, id);
  const config =
    patch.config === undefined
      ? undefined
      : validateConfig({ kind: current.kind, config: patch.config }).config;

  const [row] = await db
    .update(sources)
    .set({ enabled: patch.enabled, pollIntervalMin: patch.pollIntervalMin, config, updatedAt: new Date() })
    .where(and(eq(sources.organizationId, orgId), eq(sources.id, id)))
    .returning();
  if (!row) throw new NotFoundError("source", id);
  return row;
}

export async function deleteSource(db: DbLike, orgId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(sources)
    .where(and(eq(sources.organizationId, orgId), eq(sources.id, id)))
    .returning({ id: sources.id });
  if (deleted.length === 0) throw new NotFoundError("source", id);
}

/**
 * Enabled sources whose poll interval has elapsed (or that never ran), across all
 * organizations. The scheduler is a system actor, not a request: this is the one
 * deliberate exception to org-scoped queries, and the pipeline carries each source's
 * own organizationId forward from here.
 */
export async function findDueSourcesAllOrgs(db: DbLike, now: Date = new Date()): Promise<Source[]> {
  return db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.enabled, true),
        or(
          isNull(sources.lastRunAt),
          // Raw sql params skip Drizzle's column mapping, so the Date goes over as ISO text.
          sql`${sources.lastRunAt} + make_interval(mins => ${sources.pollIntervalMin}) <= ${now.toISOString()}::timestamptz`,
        ),
      ),
    )
    .orderBy(asc(sources.lastRunAt));
}

/** For manual "run now": the caller has already checked the source belongs to its org. */
export async function listSourcesByIds(db: DbLike, ids: readonly string[]): Promise<Source[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(sources)
    .where(inArray(sources.id, [...ids]));
}

/** Human label for run reports and the sources table: `r/startups`, `search "cto" in r/x`, `linkedin alerts`. */
export function describeSource(source: Pick<Source, "kind" | "config">): string {
  const c = source.config;
  const str = (key: string) => (typeof c[key] === "string" ? (c[key] as string) : undefined);
  switch (source.kind) {
    case "reddit_subreddit":
      return `r/${str("subreddit") ?? "?"}`;
    case "reddit_search":
      return `search "${str("query") ?? "?"}"${str("subreddit") ? ` in r/${str("subreddit")}` : ""}`;
    case "rss":
      return `${str("platform") ?? "web"} alerts`;
  }
}

export async function recordSourceRun(db: DbLike, sourceId: string, run: SourceRunRecord): Promise<void> {
  await db
    .update(sources)
    .set({
      lastRunAt: run.ranAt,
      lastError: run.error ?? null,
      ...(run.cursor === undefined ? {} : { cursor: run.cursor }),
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));
}

function validateConfig(value: { kind: string; config: unknown }): SourceConfig {
  const result = sourceConfigSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      "invalid source config",
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return result.data;
}
