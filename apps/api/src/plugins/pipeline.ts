import {
  type Budget,
  type CampaignDrafter,
  type ChatProvider,
  createBudget,
  createCampaignDrafter,
  createDbBudgetStore,
  createDbSearchBudgetStore,
  createEmailDigestNotifier,
  createGeminiProvider,
  createGroqProvider,
  createLlmExtractor,
  createSearchBudget,
  createSourceRegistry,
  DEFAULT_SEARCH_DAILY_QUERIES,
  type PipelineDeps,
  type SearchBudget,
} from "@leadsight/core";
import fp from "fastify-plugin";
import type { Env } from "../env.js";

// Assembles the pipeline's dependencies from env once per process. The scheduler runs
// them on a timer; the sources.run procedure reuses them for manual runs; runs.budget
// reads the budget; campaigns.draft uses the same providers through drafterFor.

export type Pipeline = Omit<PipelineDeps, "sourceIds" | "maxCandidatesPerCampaign"> & {
  budget: Budget;
  searchBudget: SearchBudget;
  searchConfigured: boolean;
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
    const searchBudget = createSearchBudget({
      store: createDbSearchBudgetStore(app.db),
      dailyCap: env.GOOGLE_CSE_DAILY_QUERIES ?? DEFAULT_SEARCH_DAILY_QUERIES,
    });
    const searchConfigured = Boolean(env.GOOGLE_CSE_KEY && env.GOOGLE_CSE_CX);
    const registry = createSourceRegistry({
      userAgent: env.REDDIT_USER_AGENT,
      // Optional and rarely approved (docs/reddit-access.md); reddit_* sources are disabled without it.
      reddit:
        env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
          ? { clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET }
          : null,
      google: searchConfigured ? { key: env.GOOGLE_CSE_KEY ?? "", cx: env.GOOGLE_CSE_CX ?? "" } : null,
      canSearch: () => searchBudget.canQuery(),
    });
    if (!searchConfigured) {
      app.log.warn({}, "GOOGLE_CSE_KEY/GOOGLE_CSE_CX not set: google_search sources are disabled");
    }
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
      app.log.info(
        {},
        "Reddit API not configured: reddit_subreddit/reddit_search sources are disabled (optional)",
      );
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
      // Email digest only for now; a chat notifier (Slack or similar) is deferred and would be appended here.
      notifiers: [createEmailDigestNotifier({ db: app.db, mailer: app.mailer, webOrigin: env.WEB_ORIGIN })],
      logger: app.log,
      budget,
      searchBudget,
      searchConfigured,
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
  { name: "pipeline", dependencies: ["db", "mailer"] },
);
