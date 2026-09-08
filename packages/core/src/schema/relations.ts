import { relations } from "drizzle-orm";
import { user } from "./auth.js";
import { campaigns, labels, leadNotes, leads, postSources, posts, sources } from "./tables.js";

// Relations power the relational query API (`db.query.x.findFirst({ with: … })`).
// Define one here for anything read with `with:`.

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  sources: many(sources),
  leads: many(leads),
  labels: many(labels),
}));

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [sources.campaignId], references: [campaigns.id] }),
  postSources: many(postSources),
}));

export const postsRelations = relations(posts, ({ many }) => ({
  leads: many(leads),
  postSources: many(postSources),
  labels: many(labels),
}));

export const postSourcesRelations = relations(postSources, ({ one }) => ({
  post: one(posts, { fields: [postSources.postId], references: [posts.id] }),
  source: one(sources, { fields: [postSources.sourceId], references: [sources.id] }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [leads.campaignId], references: [campaigns.id] }),
  post: one(posts, { fields: [leads.postId], references: [posts.id] }),
  assignee: one(user, { fields: [leads.assigneeId], references: [user.id] }),
  notes: many(leadNotes),
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
  user: one(user, { fields: [leadNotes.userId], references: [user.id] }),
}));

export const labelsRelations = relations(labels, ({ one }) => ({
  campaign: one(campaigns, { fields: [labels.campaignId], references: [campaigns.id] }),
  post: one(posts, { fields: [labels.postId], references: [posts.id] }),
}));
