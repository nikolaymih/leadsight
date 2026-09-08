import { and, asc, desc, eq, gte, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError } from "../errors.js";
import {
  type Lead,
  type LeadNote,
  labels,
  leadNotes,
  leads,
  type Post,
  posts,
  user,
} from "../schema/index.js";
import { type Evidence, type LeadStatus, type Platform, VERDICTS, type Verdict } from "../types.js";
import type { DbLike } from "./client.js";
import { decodeCursor, encodeCursor, type KeyPart, keysetAfter } from "./cursor.js";

// ---------------------------------------------------------------------------
// Write: scoring results
// ---------------------------------------------------------------------------

export interface UpsertLeadInput {
  campaignId: string;
  postId: string;
  evidence: Evidence;
  score: number;
  scoreBreakdown: Record<string, number>;
  confidence: number;
  verdict: Verdict;
  summary: string;
  extractorProvider: string;
  promptVersion: string;
  rulesVersion: number;
}

/** One lead per (campaign, post). Re-extraction overwrites the scoring fields but keeps triage state. */
export async function upsertLead(db: DbLike, orgId: string, input: UpsertLeadInput): Promise<Lead> {
  const now = new Date();
  const [row] = await db
    .insert(leads)
    .values({ ...input, organizationId: orgId, scoredAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [leads.campaignId, leads.postId],
      set: {
        evidence: input.evidence,
        score: input.score,
        scoreBreakdown: input.scoreBreakdown,
        confidence: input.confidence,
        verdict: input.verdict,
        summary: input.summary,
        extractorProvider: input.extractorProvider,
        promptVersion: input.promptVersion,
        rulesVersion: input.rulesVersion,
        scoredAt: now,
        updatedAt: now,
      },
    })
    .returning();
  if (!row) throw new Error("upsert returned no row");
  return row;
}

// ---------------------------------------------------------------------------
// Read: inbox list with keyset pagination
// ---------------------------------------------------------------------------

export const LEAD_SORTS = ["rank", "newest", "confidence"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export interface ListLeadsFilter {
  campaignId: string;
  verdict?: readonly Verdict[];
  status?: readonly LeadStatus[];
  platform?: readonly Platform[];
  assigneeId?: string;
  minScore?: number;
}

export interface ListLeadsOptions {
  sort?: LeadSort;
  cursor?: string | null;
  limit?: number;
}

export interface LeadWithPost extends Lead {
  post: Post;
}

export interface LeadPage {
  items: LeadWithPost[];
  nextCursor: string | null;
}

// Cursor payloads. scoredAt travels as Postgres' own text form so microseconds survive
// the round trip; a JS Date would truncate to milliseconds and skip or repeat rows.
const pgTimestamp = z.string().min(1);
const cursorSchemas = {
  rank: z.tuple([z.enum(VERDICTS), z.number().int(), pgTimestamp, z.string().uuid()]),
  newest: z.tuple([pgTimestamp, z.string().uuid()]),
  confidence: z.tuple([z.number().int(), pgTimestamp, z.string().uuid()]),
} as const;

const scoredAtText = sql<string>`${leads.scoredAt}::text`;
const asTimestamp = (text: string): SQL => sql`${text}::timestamptz`;

export async function listLeads(
  db: DbLike,
  orgId: string,
  filter: ListLeadsFilter,
  opts: ListLeadsOptions = {},
): Promise<LeadPage> {
  const sort = opts.sort ?? "rank";
  const limit = opts.limit ?? 50;

  const conditions: (SQL | undefined)[] = [
    eq(leads.organizationId, orgId),
    eq(leads.campaignId, filter.campaignId),
    filter.verdict?.length ? inArray(leads.verdict, [...filter.verdict]) : undefined,
    filter.status?.length ? inArray(leads.status, [...filter.status]) : undefined,
    filter.platform?.length ? inArray(posts.platform, [...filter.platform]) : undefined,
    filter.assigneeId ? eq(leads.assigneeId, filter.assigneeId) : undefined,
    filter.minScore !== undefined ? gte(leads.score, filter.minScore) : undefined,
    opts.cursor ? keysetAfter(cursorParts(sort, opts.cursor)) : undefined,
  ];

  const rows = await db
    .select({ lead: leads, post: posts, scoredAtText })
    .from(leads)
    .innerJoin(posts, eq(posts.id, leads.postId))
    .where(and(...conditions))
    .orderBy(...orderFor(sort))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1] : undefined;

  return {
    items: page.map((r) => ({ ...r.lead, post: r.post })),
    nextCursor: last ? encodeCursor(cursorValues(sort, last.lead, last.scoredAtText)) : null,
  };
}

function orderFor(sort: LeadSort): SQL[] {
  switch (sort) {
    case "rank":
      // verdict is a pgEnum declared hot → disqualified, so ascending puts hot first.
      return [asc(leads.verdict), desc(leads.score), desc(leads.scoredAt), desc(leads.id)];
    case "newest":
      return [desc(leads.scoredAt), desc(leads.id)];
    case "confidence":
      return [desc(leads.confidence), desc(leads.scoredAt), desc(leads.id)];
  }
}

function cursorValues(sort: LeadSort, lead: Lead, scoredAt: string): unknown[] {
  switch (sort) {
    case "rank":
      return [lead.verdict, lead.score, scoredAt, lead.id];
    case "newest":
      return [scoredAt, lead.id];
    case "confidence":
      return [lead.confidence, scoredAt, lead.id];
  }
}

function cursorParts(sort: LeadSort, cursor: string): KeyPart[] {
  switch (sort) {
    case "rank": {
      const [verdict, score, scoredAt, id] = decodeCursor(cursor, cursorSchemas.rank);
      return [
        { column: leads.verdict, direction: "asc", value: verdict },
        { column: leads.score, direction: "desc", value: score },
        { column: leads.scoredAt, direction: "desc", value: asTimestamp(scoredAt) },
        { column: leads.id, direction: "desc", value: id },
      ];
    }
    case "newest": {
      const [scoredAt, id] = decodeCursor(cursor, cursorSchemas.newest);
      return [
        { column: leads.scoredAt, direction: "desc", value: asTimestamp(scoredAt) },
        { column: leads.id, direction: "desc", value: id },
      ];
    }
    case "confidence": {
      const [confidence, scoredAt, id] = decodeCursor(cursor, cursorSchemas.confidence);
      return [
        { column: leads.confidence, direction: "desc", value: confidence },
        { column: leads.scoredAt, direction: "desc", value: asTimestamp(scoredAt) },
        { column: leads.id, direction: "desc", value: id },
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// Read: one lead with post and notes
// ---------------------------------------------------------------------------

export interface LeadNoteWithUser extends LeadNote {
  userName: string;
}

export interface LeadDetail extends LeadWithPost {
  notes: LeadNoteWithUser[];
}

export async function getLead(db: DbLike, orgId: string, id: string): Promise<LeadDetail> {
  const row = await db.query.leads.findFirst({
    where: and(eq(leads.organizationId, orgId), eq(leads.id, id)),
    with: {
      post: true,
      notes: { orderBy: asc(leadNotes.createdAt), with: { user: { columns: { name: true } } } },
    },
  });
  if (!row) throw new NotFoundError("lead", id);

  const { notes, ...lead } = row;
  return {
    ...lead,
    notes: notes.map(({ user: author, ...note }) => ({ ...note, userName: author?.name ?? "Unknown" })),
  };
}

// ---------------------------------------------------------------------------
// Write: triage — status / assignee, with the label feedback loop
// ---------------------------------------------------------------------------

export interface TriagePatch {
  status?: LeadStatus;
  /** `null` unassigns. */
  assigneeId?: string | null;
  /** Reviewer's reason, stored on the label when the status is won/lost/not_fit. */
  labelNote?: string;
  /** Who made the change; recorded as the label author. */
  actorId: string;
}

const LABEL_FOR_STATUS: Partial<Record<LeadStatus, "positive" | "negative">> = {
  won: "positive",
  lost: "negative",
  not_fit: "negative",
};

export async function updateLead(db: DbLike, orgId: string, id: string, patch: TriagePatch): Promise<Lead> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(leads)
      .set({ status: patch.status, assigneeId: patch.assigneeId, updatedAt: new Date() })
      .where(and(eq(leads.organizationId, orgId), eq(leads.id, id)))
      .returning();
    if (!row) throw new NotFoundError("lead", id);

    await writeLabels(tx, [row], patch);
    return row;
  });
}

export async function bulkUpdateLeads(
  db: DbLike,
  orgId: string,
  ids: readonly string[],
  patch: Omit<TriagePatch, "labelNote">,
): Promise<number> {
  if (ids.length === 0) return 0;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(leads)
      .set({ status: patch.status, assigneeId: patch.assigneeId, updatedAt: new Date() })
      .where(and(eq(leads.organizationId, orgId), inArray(leads.id, [...ids])))
      .returning();

    await writeLabels(tx, rows, patch);
    return rows.length;
  });
}

/**
 * won → positive, lost/not_fit → negative. The newest label for a (campaign, post) is
 * the one the extractor learns from, so earlier ones for the same pair are replaced.
 */
async function writeLabels(tx: DbLike, rows: readonly Lead[], patch: TriagePatch): Promise<void> {
  const kind = patch.status ? LABEL_FOR_STATUS[patch.status] : undefined;
  if (!kind || rows.length === 0) return;

  for (const row of rows) {
    await tx.delete(labels).where(and(eq(labels.campaignId, row.campaignId), eq(labels.postId, row.postId)));
  }
  await tx.insert(labels).values(
    rows.map((row) => ({
      campaignId: row.campaignId,
      postId: row.postId,
      label: kind,
      note: patch.labelNote ?? null,
      createdBy: patch.actorId,
    })),
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addLeadNote(
  db: DbLike,
  orgId: string,
  leadId: string,
  userId: string,
  body: string,
): Promise<LeadNoteWithUser> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), eq(leads.id, leadId)))
    .limit(1);
  if (!lead) throw new NotFoundError("lead", leadId);

  const [note] = await db.insert(leadNotes).values({ leadId, userId, body }).returning();
  if (!note) throw new Error("insert returned no row");

  const [author] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return { ...note, userName: author?.name ?? "Unknown" };
}
