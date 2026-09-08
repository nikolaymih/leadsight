import { addLeadNote, appendEvent, bulkUpdateLeads, getLead, listLeads, updateLead } from "@leadsight/core";
import { authed } from "../implementer.js";
import { toLeadDetail, toLeadSummary, toNote } from "../mappers.js";

// Triage is open to every member; org scoping comes from the context, never the client.

export const leads = {
  list: authed.leads.list.handler(async ({ input, context }) => {
    const { sort, cursor, limit, ...filter } = input;
    const page = await listLeads(context.db, context.orgId, filter, { sort, cursor, limit });
    return { items: page.items.map(toLeadSummary), nextCursor: page.nextCursor };
  }),

  get: authed.leads.get.handler(async ({ input, context }) => {
    return toLeadDetail(await getLead(context.db, context.orgId, input.id));
  }),

  update: authed.leads.update.handler(async ({ input, context }) => {
    const { id, ...patch } = input;
    const before = await getLead(context.db, context.orgId, id);
    const updated = await updateLead(context.db, context.orgId, id, {
      ...patch,
      actorId: context.session.user.id,
    });
    if (patch.status && patch.status !== before.status) {
      await appendEvent(context.db, {
        organizationId: context.orgId,
        type: "lead.status_changed",
        entityType: "lead",
        entityId: id,
        payload: { actorId: context.session.user.id, from: before.status, to: patch.status },
      });
    }
    return toLeadSummary({ ...updated, post: before.post });
  }),

  bulkUpdate: authed.leads.bulkUpdate.handler(async ({ input, context }) => {
    const { ids, ...patch } = input;
    const updated = await bulkUpdateLeads(context.db, context.orgId, ids, {
      ...patch,
      actorId: context.session.user.id,
    });
    if (patch.status) {
      await appendEvent(context.db, {
        organizationId: context.orgId,
        type: "lead.bulk_status_changed",
        entityType: "lead",
        payload: { actorId: context.session.user.id, to: patch.status, count: updated },
      });
    }
    return { updated };
  }),

  addNote: authed.leads.addNote.handler(async ({ input, context }) => {
    return toNote(
      await addLeadNote(context.db, context.orgId, input.id, context.session.user.id, input.body),
    );
  }),
};
