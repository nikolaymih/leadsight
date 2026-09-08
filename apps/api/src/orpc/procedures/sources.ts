import {
  createSource,
  deleteSource,
  getCampaign,
  getSource,
  getSourceWithStats,
  listSources,
  runPipeline,
  updateSource,
} from "@leadsight/core";
import { ORPCError } from "@orpc/server";
import { admin, authed } from "../implementer.js";
import { toSource } from "../mappers.js";

export const sources = {
  list: authed.sources.list.handler(async ({ input, context }) => {
    await getCampaign(context.db, context.orgId, input.campaignId); // NOT_FOUND rather than an empty list
    return (await listSources(context.db, context.orgId, input.campaignId)).map(toSource);
  }),

  create: admin.sources.create.handler(async ({ input, context }) => {
    const created = await createSource(context.db, context.orgId, input);
    return toSource({ ...created, postsLast24h: 0 });
  }),

  update: admin.sources.update.handler(async ({ input, context }) => {
    const { id, ...patch } = input;
    await updateSource(context.db, context.orgId, id, patch);
    return toSource(await getSourceWithStats(context.db, context.orgId, id));
  }),

  remove: admin.sources.remove.handler(async ({ input, context }) => {
    await deleteSource(context.db, context.orgId, input.id);
    return { ok: true as const };
  }),

  /** Manual "run now": polls just this source, then the normal extract/score pass runs. */
  run: admin.sources.run.handler(async ({ input, context }) => {
    const source = await getSource(context.db, context.orgId, input.id);
    const result = await runPipeline({ ...context.pipeline, sourceIds: [source.id] });
    const summary = result.perOrg[context.orgId]?.perSource.find((s) => s.sourceId === source.id);
    if (!summary)
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "run produced no report for this source" });
    if (summary.error) throw new ORPCError("BAD_GATEWAY", { message: summary.error });
    return { posts: summary.posts, warnings: summary.warnings };
  }),
};
