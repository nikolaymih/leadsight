import {
  appendEvent,
  createCampaign,
  createSource,
  getCampaign,
  listCampaigns,
  previewRescore,
  rescoreCampaign,
  updateCampaign,
} from "@leadsight/core";
import { admin, authed } from "../implementer.js";
import { toCampaign } from "../mappers.js";
import { notImplemented } from "../not-implemented.js";

export const campaigns = {
  list: authed.campaigns.list.handler(async ({ context }) => {
    return (await listCampaigns(context.db, context.orgId)).map(toCampaign);
  }),

  get: authed.campaigns.get.handler(async ({ input, context }) => {
    return toCampaign(await getCampaign(context.db, context.orgId, input.id));
  }),

  /** Setup chat → draft. Step 7. */
  draft: authed.campaigns.draft.handler(notImplemented),

  create: admin.campaigns.create.handler(async ({ input, context }) => {
    const { suggestedSources, ...fields } = input;
    const created = await context.db.transaction(async (tx) => {
      const campaign = await createCampaign(tx, context.orgId, {
        ...fields,
        createdBy: context.session.user.id,
      });
      for (const source of suggestedSources) {
        await createSource(tx, context.orgId, { ...source, campaignId: campaign.id });
      }
      return campaign;
    });
    await appendEvent(context.db, {
      organizationId: context.orgId,
      type: "campaign.created",
      entityType: "campaign",
      entityId: created.id,
      payload: { actorId: context.session.user.id, sources: suggestedSources.length },
    });
    return toCampaign(created);
  }),

  update: admin.campaigns.update.handler(async ({ input, context }) => {
    const { id, ...patch } = input;
    const before = await getCampaign(context.db, context.orgId, id);
    const updated = await updateCampaign(context.db, context.orgId, id, patch);
    if (updated.rulesVersion !== before.rulesVersion) {
      await appendEvent(context.db, {
        organizationId: context.orgId,
        type: "campaign.rules_changed",
        entityType: "campaign",
        entityId: id,
        payload: { actorId: context.session.user.id, from: before.rulesVersion, to: updated.rulesVersion },
      });
    }
    return toCampaign(updated);
  }),

  rescore: admin.campaigns.rescore.handler(async ({ input, context }) => {
    const result = await rescoreCampaign(context.db, context.orgId, input.id);
    await appendEvent(context.db, {
      organizationId: context.orgId,
      type: "campaign.rescored",
      entityType: "campaign",
      entityId: input.id,
      payload: { actorId: context.session.user.id, ...result },
    });
    return result;
  }),

  previewRescore: admin.campaigns.previewRescore.handler(async ({ input, context }) => {
    const { id, ...edited } = input;
    return previewRescore(context.db, context.orgId, id, edited);
  }),
};
