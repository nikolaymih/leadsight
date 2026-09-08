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
