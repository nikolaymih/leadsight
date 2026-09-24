import { listPipelineRuns, type OrgRunReport } from "@leadsight/core";
import { authed } from "../implementer.js";
import { toPipelineRun } from "../mappers.js";

export const runs = {
  list: authed.runs.list.handler(async ({ input, context }) => {
    const page = await listPipelineRuns(context.db, context.orgId, input);
    // Payloads are written by runPipeline as OrgRunReport; the output schema re-validates.
    return { items: page.items.map((p) => toPipelineRun(p as OrgRunReport)), nextCursor: page.nextCursor };
  }),

  budget: authed.runs.budget.handler(async ({ context }) => {
    return Promise.all(
      context.pipeline.providerNames.map(async (provider) => ({
        provider,
        ...(await context.pipeline.budget.status(provider)),
      })),
    );
  }),
};
