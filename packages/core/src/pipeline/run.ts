import { randomUUID } from "node:crypto";
import { listActiveCampaignsAllOrgs } from "../db/campaigns.js";
import type { Db } from "../db/client.js";
import { appendEvent } from "../db/events.js";
import { listRecentLabels } from "../db/labels.js";
import { type LeadWithPost, upsertLead } from "../db/leads.js";
import { findExtractionCandidates, updatePostContent, upsertPosts } from "../db/posts.js";
import { describeSource, findDueSourcesAllOrgs, listSourcesByIds, recordSourceRun } from "../db/sources.js";
import { BudgetExhaustedError, ProviderError } from "../errors.js";
import { SEARCH_BACKOFF_MIN, type SearchBudget } from "../extractor/budget.js";
import { EXTRACT_BATCH_SIZE, type Extractor } from "../extractor/extractor.js";
import { selectFewShot } from "../extractor/fewshot.js";
import type { Notifier } from "../notify/notifier.js";
import { applyRules } from "../rules/index.js";
import type { Campaign, Post, Source } from "../schema/index.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { RawPost } from "../types.js";
import { isSourceDue } from "./schedule.js";

// The pipeline run — docs/design.md §4. Each step is isolated: a failing source, batch
// or notifier is recorded and the run continues with whatever succeeded. Idempotent:
// cursors, dedupe and candidates-without-a-lead mean a second run does no new work.

export interface PipelineLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface PipelineDeps {
  db: Db;
  registry: SourceRegistry;
  /** Budget accounting is per organization, so the extractor is built per org. */
  extractorFor(organizationId: string): Extractor;
  notifiers: readonly Notifier[];
  logger: PipelineLogger;
  /** Google search query budget; google_search sources back off when it is nearly spent. */
  searchBudget?: SearchBudget;
  now?: () => Date;
  /** Manual "run now": poll exactly these sources instead of the due ones. */
  sourceIds?: readonly string[];
  /** Cap on posts extracted per campaign per run. Default 40 (five batches). */
  maxCandidatesPerCampaign?: number;
}

export interface RunCounts {
  polled: number;
  prefiltered: number;
  hydrated: number;
  extracted: number;
  scored: number;
  notified: number;
}

export interface SourceRunSummary {
  sourceId: string;
  name: string;
  /** New posts inserted by this source in this run. */
  posts: number;
  warnings: string[];
  error: string | null;
}

/** Payload of one `pipeline.run` event — one per organization touched. Matches the contract. */
export interface OrgRunReport {
  id: string;
  startedAt: string;
  durationMs: number;
  counts: RunCounts;
  errors: string[];
  perSource: SourceRunSummary[];
}

export interface PipelineRunResult {
  id: string;
  startedAt: Date;
  durationMs: number;
  perOrg: Record<string, OrgRunReport>;
  totals: RunCounts;
}

export const PIPELINE_EVENTS = {
  run: "pipeline.run",
  sourceRun: "source.run",
  sourceError: "source.error",
  extractDropped: "extract.dropped",
  extractError: "extract.error",
  budgetExhausted: "extract.budget_exhausted",
} as const;

const DEFAULT_MAX_CANDIDATES = 40;

const zeroCounts = (): RunCounts => ({
  polled: 0,
  prefiltered: 0,
  hydrated: 0,
  extracted: 0,
  scored: 0,
  notified: 0,
});

interface OrgAccumulator {
  counts: RunCounts;
  errors: string[];
  perSource: SourceRunSummary[];
}

export async function runPipeline(deps: PipelineDeps): Promise<PipelineRunResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const id = randomUUID();
  const orgs = new Map<string, OrgAccumulator>();
  const org = (organizationId: string): OrgAccumulator => {
    let acc = orgs.get(organizationId);
    if (!acc) {
      acc = { counts: zeroCounts(), errors: [], perSource: [] };
      orgs.set(organizationId, acc);
    }
    return acc;
  };
  let budgetExhausted = false;

  // 1. Poll. The SQL pre-selects on the shorter interval; the exact rule (active hours in the
  // source's time zone, search back-off while the query budget is nearly spent) runs here.
  let sources: Source[];
  if (deps.sourceIds) {
    sources = await listSourcesByIds(deps.db, deps.sourceIds);
  } else {
    const searchOk = deps.searchBudget ? await deps.searchBudget.canQuery() : true;
    if (!searchOk) deps.logger.warn({}, "search query budget nearly spent: google_search sources back off");
    sources = (await findDueSourcesAllOrgs(deps.db, startedAt)).filter((s) =>
      isSourceDue(
        s,
        startedAt,
        s.kind === "google_search" && !searchOk ? { minIntervalMin: SEARCH_BACKOFF_MIN } : {},
      ),
    );
  }
  for (const source of sources) {
    await pollSource(deps, source, org(source.organizationId), now);
  }

  // 2–6. Per campaign: candidates → hydrate → extract → score → notify
  for (const campaign of await listActiveCampaignsAllOrgs(deps.db)) {
    if (budgetExhausted) break;
    budgetExhausted = await processCampaign(deps, campaign, org(campaign.organizationId), now);
  }

  // 7. One event per organization touched
  const durationMs = now().getTime() - startedAt.getTime();
  const perOrg: Record<string, OrgRunReport> = {};
  const totals = zeroCounts();
  for (const [organizationId, acc] of orgs) {
    const report: OrgRunReport = {
      id,
      startedAt: startedAt.toISOString(),
      durationMs,
      counts: acc.counts,
      errors: acc.errors,
      perSource: acc.perSource,
    };
    perOrg[organizationId] = report;
    for (const key of Object.keys(totals) as (keyof RunCounts)[]) totals[key] += acc.counts[key];
    await appendEvent(deps.db, {
      organizationId,
      type: PIPELINE_EVENTS.run,
      entityType: "run",
      entityId: id,
      payload: report,
    });
  }

  deps.logger.info({ runId: id, durationMs, totals, organizations: orgs.size }, "pipeline run done");
  return { id, startedAt, durationMs, perOrg, totals };
}

async function pollSource(
  deps: PipelineDeps,
  source: Source,
  acc: OrgAccumulator,
  now: () => Date,
): Promise<void> {
  const summary: SourceRunSummary = {
    sourceId: source.id,
    name: describeSource(source),
    posts: 0,
    warnings: [],
    error: null,
  };
  try {
    const adapter = deps.registry.get(source.kind);
    const config = adapter.validateConfig(source.config);
    const result = await adapter.run(config, source.cursor);
    if (result.usage?.searchQueries && deps.searchBudget) {
      await deps.searchBudget.record(source.organizationId, result.usage.searchQueries);
    }
    const upserted = await upsertPosts(deps.db, source.organizationId, source.id, result.posts);

    summary.posts = upserted.inserted;
    summary.warnings = result.warnings;
    acc.counts.polled += upserted.inserted;

    await recordSourceRun(deps.db, source.id, { ranAt: now(), cursor: result.nextCursor });
    await appendEvent(deps.db, {
      organizationId: source.organizationId,
      type: PIPELINE_EVENTS.sourceRun,
      entityType: "source",
      entityId: source.id,
      payload: {
        fetched: result.posts.length,
        inserted: upserted.inserted,
        linked: upserted.linked,
        warnings: result.warnings,
      },
    });
    deps.logger.info(
      { sourceId: source.id, fetched: result.posts.length, inserted: upserted.inserted },
      "source run done",
    );
  } catch (err) {
    const message = errorMessage(err);
    summary.error = message;
    acc.errors.push(`${summary.name}: ${message}`);
    // A search request that got an HTTP answer counted against the quota even though it failed.
    if (
      source.kind === "google_search" &&
      deps.searchBudget &&
      err instanceof ProviderError &&
      err.status !== undefined
    ) {
      await deps.searchBudget.record(source.organizationId, 1);
    }
    // lastRunAt moves even on failure so a broken source waits its interval instead of hammering.
    await recordSourceRun(deps.db, source.id, { ranAt: now(), error: message });
    await appendEvent(deps.db, {
      organizationId: source.organizationId,
      type: PIPELINE_EVENTS.sourceError,
      entityType: "source",
      entityId: source.id,
      payload: { error: message },
    });
    deps.logger.warn({ sourceId: source.id, err: message }, "source run failed");
  }
  acc.perSource.push(summary);
}

/** Returns true when the token budget ran out, so the caller stops extracting for this run. */
async function processCampaign(
  deps: PipelineDeps,
  campaign: Campaign,
  acc: OrgAccumulator,
  now: () => Date,
): Promise<boolean> {
  const orgId = campaign.organizationId;
  const candidates = await findExtractionCandidates(
    deps.db,
    orgId,
    campaign,
    deps.maxCandidatesPerCampaign ?? DEFAULT_MAX_CANDIDATES,
  );
  acc.counts.prefiltered += candidates.length;
  if (candidates.length === 0) return false;

  // 3. Hydrate snippet-only posts (best effort; the adapter never throws)
  const posts: Post[] = [];
  for (const post of candidates) {
    posts.push(post.bodyIsSnippet ? await hydrate(deps, post, acc) : post);
  }

  // 4–5. Extract and score, one batch at a time
  const extractor = deps.extractorFor(orgId);
  const labels = await listRecentLabels(deps.db, orgId, campaign.id, { limit: campaign.fewshotLimit * 2 });
  const examples = selectFewShot(labels, campaign.fewshotLimit);
  const byExternalId = new Map(posts.map((p) => [p.externalId, p]));
  const newLeads: LeadWithPost[] = [];

  for (let i = 0; i < posts.length; i += EXTRACT_BATCH_SIZE) {
    const batch = posts.slice(i, i + EXTRACT_BATCH_SIZE);
    let out: Awaited<ReturnType<Extractor["extract"]>>;
    try {
      out = await extractor.extract({
        campaign: {
          offerDescription: campaign.offerDescription,
          icp: campaign.icp,
          disqualifiers: campaign.disqualifiers,
          criteria: campaign.criteria,
        },
        examples,
        posts: batch.map(postToRaw),
      });
    } catch (err) {
      const message = errorMessage(err);
      if (err instanceof BudgetExhaustedError) {
        acc.errors.push(message);
        await appendEvent(deps.db, {
          organizationId: orgId,
          type: PIPELINE_EVENTS.budgetExhausted,
          entityType: "campaign",
          entityId: campaign.id,
          payload: { providers: err.providers },
        });
        deps.logger.warn({ campaignId: campaign.id }, "token budget exhausted; leaving posts unscored");
        await notify(deps, campaign, newLeads, acc);
        return true;
      }
      acc.errors.push(`extract (${campaign.name}): ${message}`);
      await appendEvent(deps.db, {
        organizationId: orgId,
        type: PIPELINE_EVENTS.extractError,
        entityType: "campaign",
        entityId: campaign.id,
        payload: { error: message, posts: batch.length },
      });
      deps.logger.error({ campaignId: campaign.id, err: message }, "extraction batch failed");
      break; // later batches of this campaign will very likely fail the same way
    }

    acc.counts.extracted += out.results.length;
    for (const dropped of out.dropped) {
      const post = byExternalId.get(dropped.postExternalId);
      await appendEvent(deps.db, {
        organizationId: orgId,
        type: PIPELINE_EVENTS.extractDropped,
        entityType: "post",
        entityId: post?.id ?? dropped.postExternalId,
        payload: { campaignId: campaign.id, reason: dropped.reason },
      });
    }

    for (const result of out.results) {
      const post = byExternalId.get(result.postExternalId);
      if (!post) continue;
      const scored = applyRules(campaign, result.evidence, { bodyIsSnippet: post.bodyIsSnippet });
      const lead = await upsertLead(deps.db, orgId, {
        campaignId: campaign.id,
        postId: post.id,
        evidence: result.evidence,
        score: scored.score,
        scoreBreakdown: scored.breakdown,
        confidence: scored.confidence,
        verdict: scored.verdict,
        summary: result.evidence.summary,
        extractorProvider: out.provider,
        promptVersion: out.promptVersion,
        rulesVersion: campaign.rulesVersion,
      });
      acc.counts.scored += 1;
      newLeads.push({ ...lead, post });
    }
  }

  await notify(deps, campaign, newLeads, acc);
  void now; // clock is only needed by pollSource; kept in the signature for symmetry
  return false;
}

async function hydrate(deps: PipelineDeps, post: Post, acc: OrgAccumulator): Promise<Post> {
  const hydrated = await deps.registry.hydrate(postToRaw(post));
  if (hydrated.bodyIsSnippet && hydrated.body === post.body) return post;

  const patch = {
    body: hydrated.body,
    bodyIsSnippet: hydrated.bodyIsSnippet,
    title: hydrated.title ?? post.title,
    authorHandle: hydrated.authorHandle ?? post.authorHandle,
    authorUrl: hydrated.authorUrl ?? post.authorUrl,
    postedAt: post.postedAt ?? hydrated.postedAt ?? null,
  };
  await updatePostContent(deps.db, post.id, patch);
  acc.counts.hydrated += 1;
  return { ...post, ...patch };
}

/** 6. Notify — every notifier gets the same alertable leads; one failing notifier never blocks another. */
async function notify(
  deps: PipelineDeps,
  campaign: Campaign,
  leads: LeadWithPost[],
  acc: OrgAccumulator,
): Promise<void> {
  const alertable = leads.filter(
    (l) => l.verdict !== "insufficient" && l.verdict !== "disqualified" && l.score >= campaign.minScoreAlert,
  );
  if (alertable.length === 0) return;

  for (const notifier of deps.notifiers) {
    try {
      await notifier.notify(alertable, campaign);
    } catch (err) {
      const message = errorMessage(err);
      acc.errors.push(`notify ${notifier.name}: ${message}`);
      deps.logger.error(
        { campaignId: campaign.id, notifier: notifier.name, err: message },
        "notifier failed",
      );
    }
  }
  acc.counts.notified += alertable.length;
}

export function postToRaw(post: Post): RawPost {
  return {
    platform: post.platform,
    externalId: post.externalId,
    url: post.url,
    authorHandle: post.authorHandle ?? undefined,
    authorUrl: post.authorUrl ?? undefined,
    title: post.title ?? undefined,
    body: post.body,
    bodyIsSnippet: post.bodyIsSnippet,
    postedAt: post.postedAt ?? undefined,
    raw: post.raw,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
