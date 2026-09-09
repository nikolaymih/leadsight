import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type Event, events } from "../schema/index.js";
import type { DbLike } from "./client.js";

export interface AppendEventInput {
  organizationId: string;
  /** Dotted, past-tense-ish names: `lead.status_changed`, `source.run`, `llm.usage`, `pipeline.run`. */
  type: string;
  entityType?: string;
  entityId?: string;
  payload?: unknown;
}

/** Append-only audit/analytics log. Never updated, never deleted by application code. */
export async function appendEvent(db: DbLike, input: AppendEventInput): Promise<Event> {
  const [row] = await db
    .insert(events)
    .values({
      organizationId: input.organizationId,
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? null,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/**
 * Tokens spent on one provider since `since`, across all organizations — provider caps
 * are per API key, not per tenant. Reads the `llm.usage` events the budget store writes.
 */
export async function sumLlmUsageSince(db: DbLike, provider: string, since: Date): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum((${events.payload}->>'totalTokens')::int), 0)`.mapWith(Number),
    })
    .from(events)
    .where(and(eq(events.type, "llm.usage"), eq(events.entityId, provider), gte(events.createdAt, since)));
  return row?.total ?? 0;
}

/** When an event of `type` for `entityId` was last recorded in the organization, or null. */
export async function lastEventAt(
  db: DbLike,
  orgId: string,
  type: string,
  entityId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.organizationId, orgId), eq(events.type, type), eq(events.entityId, entityId)))
    .orderBy(desc(events.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** Payloads of the most recent `pipeline.run` events for an organization, newest first. */
export async function listPipelineRunPayloads(db: DbLike, orgId: string, limit = 20): Promise<unknown[]> {
  const rows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.organizationId, orgId), eq(events.type, "pipeline.run")))
    .orderBy(desc(events.createdAt))
    .limit(limit);
  return rows.map((r) => r.payload);
}
