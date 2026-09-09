import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Criteria, Evidence, NotificationSettings, Thresholds } from "../types.js";
import { CAMPAIGN_STATUSES, LEAD_STATUSES, PLATFORMS, SOURCE_KINDS, VERDICTS } from "../types.js";

// Business tables. Better Auth's tables live in ./auth.ts; both are re-exported from
// ./index.ts so they share one migration stream.

export const campaignStatus = pgEnum("campaign_status", CAMPAIGN_STATUSES);
export const sourceKind = pgEnum("source_kind", SOURCE_KINDS);
export const platform = pgEnum("platform", PLATFORMS);
export const verdict = pgEnum("verdict", VERDICTS);
export const leadStatus = pgEnum("lead_status", LEAD_STATUSES);
export const labelKind = pgEnum("label_kind", ["positive", "negative"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

// ---------------------------------------------------------------------------

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    status: campaignStatus("status").default("active").notNull(),
    offerDescription: text("offer_description").notNull(),
    icp: text("icp").notNull(),
    disqualifiers: text("disqualifiers").array().default([]).notNull(),
    keywords: text("keywords").array().default([]).notNull(),
    criteria: jsonb("criteria").$type<Criteria>().notNull(),
    rulesVersion: integer("rules_version").default(1).notNull(),
    thresholds: jsonb("thresholds").$type<Thresholds>().default({ hot: 70, warm: 40 }).notNull(),
    minConfidence: integer("min_confidence").default(50).notNull(),
    minScoreAlert: integer("min_score_alert").default(70).notNull(),
    fewshotLimit: integer("fewshot_limit").default(8).notNull(),
    notifications: jsonb("notifications")
      .$type<NotificationSettings>()
      .default({ digestRecipients: [] })
      .notNull(),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (t) => [index("campaigns_org_idx").on(t.organizationId, t.status)],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),
    kind: sourceKind("kind").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    cursor: jsonb("cursor").$type<unknown>(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    pollIntervalMin: integer("poll_interval_min").default(60).notNull(),
    ...timestamps,
  },
  (t) => [index("sources_campaign_idx").on(t.campaignId, t.enabled)],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    platform: platform("platform").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    authorHandle: text("author_handle"),
    authorUrl: text("author_url"),
    title: text("title"),
    body: text("body").notNull(),
    bodyIsSnippet: boolean("body_is_snippet").default(false).notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb("raw").$type<unknown>(),
  },
  (t) => [
    uniqueIndex("posts_org_platform_ext_uq").on(t.organizationId, t.platform, t.externalId),
    index("posts_org_posted_idx").on(t.organizationId, t.postedAt),
  ],
);

export const postSources = pgTable(
  "post_sources",
  {
    postId: uuid("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    sourceId: uuid("source_id")
      .references(() => sources.id, { onDelete: "cascade" })
      .notNull(),
    matchedAt: timestamp("matched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.sourceId] })],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),
    postId: uuid("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    evidence: jsonb("evidence").$type<Evidence>().notNull(),
    score: integer("score").notNull(),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<string, number>>().notNull(),
    confidence: integer("confidence").notNull(),
    verdict: verdict("verdict").notNull(),
    summary: text("summary").notNull(),
    status: leadStatus("status").default("new").notNull(),
    assigneeId: text("assignee_id"),
    extractorProvider: text("extractor_provider").notNull(),
    promptVersion: text("prompt_version").notNull(),
    rulesVersion: integer("rules_version").notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("leads_campaign_post_uq").on(t.campaignId, t.postId),
    index("leads_inbox_idx").on(t.campaignId, t.verdict, t.score),
    index("leads_status_idx").on(t.campaignId, t.status),
  ],
);

export const leadNotes = pgTable("lead_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id")
    .references(() => leads.id, { onDelete: "cascade" })
    .notNull(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),
    postId: uuid("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    label: labelKind("label").notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("labels_campaign_idx").on(t.campaignId, t.createdAt)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    type: text("type").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    payload: jsonb("payload").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("events_org_type_idx").on(t.organizationId, t.type, t.createdAt)],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadNote = typeof leadNotes.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Event = typeof events.$inferSelect;
