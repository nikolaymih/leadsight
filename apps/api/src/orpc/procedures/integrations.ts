import { listCampaigns } from "@leadsight/core";
import { authed } from "../implementer.js";

export const integrations = {
  searchBudget: authed.integrations.searchBudget.handler(async ({ context }) => ({
    configured: context.pipeline.searchConfigured,
    ...(await context.pipeline.searchBudget.status()),
    enabledSourceKinds: [...context.pipeline.registry.enabledKinds()],
  })),

  status: authed.integrations.status.handler(async ({ context }) => {
    const campaigns = await listCampaigns(context.db, context.orgId);
    return {
      email: { configured: context.mailer.kind === "smtp", from: context.mailFrom },
      digestCampaigns: campaigns.filter((c) => c.notifications.digestRecipients.length > 0).length,
    };
  }),
};
