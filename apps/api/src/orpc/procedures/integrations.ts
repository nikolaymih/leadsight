import { listCampaigns } from "@leadsight/core";
import { authed } from "../implementer.js";

export const integrations = {
  webSearch: authed.integrations.webSearch.handler(async ({ context }) => {
    const { webSearchBudget, registry } = context.pipeline;
    const configured = new Set(webSearchBudget.providers);
    const providers = await Promise.all(
      (["exa", "tavily"] as const).map(async (name) => {
        if (!configured.has(name)) {
          return {
            name,
            configured: false,
            usedThisMonth: 0,
            monthlyCap: null,
            state: "not_configured" as const,
          };
        }
        const s = await webSearchBudget.status(name);
        return {
          name,
          configured: true,
          usedThisMonth: s.usedThisMonth,
          monthlyCap: s.monthlyCap,
          state: s.state,
        };
      }),
    );
    return {
      configured: configured.size > 0,
      backOff: await webSearchBudget.shouldBackOff(),
      providers,
      enabledSourceKinds: [...registry.enabledKinds()],
    };
  }),

  status: authed.integrations.status.handler(async ({ context }) => {
    const campaigns = await listCampaigns(context.db, context.orgId);
    return {
      email: { configured: context.mailer.kind === "smtp", from: context.mailFrom },
      digestCampaigns: campaigns.filter((c) => c.notifications.digestRecipients.length > 0).length,
    };
  }),
};
