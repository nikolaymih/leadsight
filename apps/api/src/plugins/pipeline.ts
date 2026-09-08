import {
  type Budget,
  type CampaignDrafter,
  type ChatProvider,
  createBudget,
  createCampaignDrafter,
  createDbBudgetStore,
  createGeminiProvider,
  createGroqProvider,
  createLlmExtractor,
  createSourceRegistry,
  type PipelineDeps,
} from "@leadsight/core";
import fp from "fastify-plugin";
import type { Env } from "../env.js";

// Assembles the pipeline's dependencies from env once per process. The scheduler runs
// them on a timer; the sources.run procedure reuses them for manual runs; runs.budget
// reads the budget; campaigns.draft uses the same providers through drafterFor.

export type Pipeline = Omit<PipelineDeps, "sourceIds" | "maxCandidatesPerCampaign"> & {
  budget: Budget;
  /** Configured providers in fallback order. */
  providerNames: readonly string[];
  drafterFor(organizationId: string): CampaignDrafter;
};

declare module "fastify" {
  interface FastifyInstance {
    pipeline: Pipeline;
  }
}

export interface PipelinePluginOptions {
  env: Env;
}

export const pipelinePlugin = fp<PipelinePluginOptions>(
  async (app, { env }) => {
    const registry = createSourceRegistry({
      userAgent: env.REDDIT_USER_AGENT,
      reddit: { clientId: env.REDDIT_CLIENT_ID ?? "", clientSecret: env.REDDIT_CLIENT_SECRET ?? "" },
    });
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
      app.log.warn({}, "REDDIT_CLIENT_ID/SECRET not set: reddit sources will fail until configured");
    }

    const providers: ChatProvider[] = [];
    if (env.GROQ_API_KEY)
      providers.push(createGroqProvider({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL }));
    if (env.GEMINI_API_KEY)
      providers.push(createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }));
    if (providers.length === 0) {
      app.log.warn(
        {},
        "no LLM provider key set (GROQ_API_KEY / GEMINI_API_KEY): extraction and drafting will fail until configured",
      );
    }

    const budget = createBudget({
      store: createDbBudgetStore(app.db),
      caps: { groq: env.GROQ_DAILY_TOKENS ?? null, gemini: env.GEMINI_DAILY_TOKENS ?? null },
    });
    const log = (event: string, data: Record<string, unknown>) => app.log.info(data, event);

    const pipeline: Pipeline = {
      db: app.db,
      registry,
      notifiers: [],
      logger: app.log,
      budget,
      providerNames: providers.map((p) => p.name),
      extractorFor: (organizationId) => createLlmExtractor({ providers, budget, organizationId, log }),
      drafterFor: (organizationId) =>
        createCampaignDrafter({
          providers,
          budget,
          organizationId,
          log,
          fetch,
          userAgent: env.REDDIT_USER_AGENT,
        }),
    };
    app.decorate("pipeline", pipeline);
  },
  { name: "pipeline", dependencies: ["db"] },
);
