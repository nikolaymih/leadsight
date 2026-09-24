import {
  type Budget,
  type CampaignDrafter,
  type ChatProvider,
  createBudget,
  createCampaignDrafter,
  createDbBudgetStore,
  createDbWebSearchBudgetStore,
  createEmailDigestNotifier,
  createExaProvider,
  createGeminiProvider,
  createGroqProvider,
  createLlmExtractor,
  createSourceRegistry,
  createTavilyProvider,
  createWebSearchBudget,
  EXA,
  type PipelineDeps,
  type SearchProvider,
  TAVILY,
  type WebSearchBudget,
} from "@leadsight/core";
import fp from "fastify-plugin";
import type { Env } from "../env.js";

// Assembles the pipeline's dependencies from env once per process. The scheduler runs
// them on a timer; the sources.run procedure reuses them for manual runs; runs.budget
// reads the budget; campaigns.draft uses the same providers through drafterFor.

export type Pipeline = Omit<PipelineDeps, "sourceIds" | "maxCandidatesPerCampaign"> & {
  budget: Budget;
  webSearchBudget: WebSearchBudget;
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
    // Web search: whichever of Exa / Tavily has a key, Exa first. With neither, the app still
    // starts and web_search sources report "not configured" in their last_error.
    const webSearchProviders: SearchProvider[] = [];
    const caps: Record<string, number | null> = {};
    if (env.EXA_API_KEY) {
      webSearchProviders.push(createExaProvider({ apiKey: env.EXA_API_KEY }));
      caps[EXA] = env.EXA_MONTHLY_SEARCHES;
    }
    if (env.TAVILY_API_KEY) {
      webSearchProviders.push(createTavilyProvider({ apiKey: env.TAVILY_API_KEY }));
      caps[TAVILY] = env.TAVILY_MONTHLY_CREDITS;
    }
    const webSearchBudget = createWebSearchBudget({ store: createDbWebSearchBudgetStore(app.db), caps });
    const registry = createSourceRegistry({
      userAgent: env.REDDIT_USER_AGENT,
      // Our Reddit Data API request was denied (docs/reddit-access.md); reddit_* sources stay disabled without it.
      reddit:
        env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
          ? { clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET }
          : null,
      webSearchProviders,
      webSearchBudget,
    });
    if (webSearchProviders.length === 0) {
      app.log.warn({}, "EXA_API_KEY and TAVILY_API_KEY not set: web_search sources are not configured");
    }
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
      app.log.info({}, "Reddit API not configured: reddit_subreddit/reddit_search sources are disabled");
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
      webSearchBudget,
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
