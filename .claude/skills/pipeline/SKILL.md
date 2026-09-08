---
name: pipeline
description: How the LeadSight ingestion and scoring pipeline works in packages/core — Source adapters (Reddit API, RSS/Google Alerts, hydrators for LinkedIn and X), the LLM Extractor with Groq→Gemini fallback and token budget, the rules engine, labels/few-shot, notifiers, and the scheduler loop. Load this for any task about polling, scraping, feeds, Reddit, RSS, Google Alerts, LinkedIn/X post fetching, LLM calls, prompts, extraction, scoring, evidence, verdicts, confidence, rescoring, Slack/email alerts, or the words "source", "adapter", "extractor", "provider", "budget", "batch", "cursor", "dedupe".
---

# Pipeline (packages/core)

Read `docs/design.md` §3–§6 first; this skill is the implementation guide for it.

```
packages/core/src/
  sources/    source.ts (Source, SourceDeps, SourceRunResult), registry.ts (createSourceRegistry),
              config.ts (validateSourceConfig), text.ts + url.ts (pure helpers, tested),
              reddit/{client,listing,subreddit,search}.ts, rss.ts, hydrate/{linkedin,x}.ts
  extractor/  extractor.ts (Extractor, ExtractionInput/Result, EXTRACT_BATCH_SIZE), llm-extractor.ts
              (createLlmExtractor, parseResponse), prompt.ts (PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt),
              fewshot.ts (selectFewShot, formatExample), budget.ts (createBudget, createDbBudgetStore),
              providers/{provider,openai-compatible,groq,gemini}.ts
  rules/      index.ts (pure), tested
  notify/     notifier.ts, slack.ts, email.ts
  pipeline/   run.ts (orchestrates steps), prefilter.ts, dedupe.ts
  db/         queries (see postgres-drizzle skill). The pipeline uses: findDueSourcesAllOrgs,
              recordSourceRun, upsertPosts, findUnscoredPosts, listRecentLabels, upsertLead, appendEvent
```

## Sources

- Implement the `Source<C>` interface from `docs/design.md`. `validateConfig` uses
  `sourceConfigSchema` from core's `types.ts` — one definition, re-exported by the contract
  for the web app. Core never imports the contract (the contract depends on core).
  `RawPost` also lives in `types.ts`.
- Adapters get their outside world through `SourceDeps` (`fetch`, `userAgent`, `now`, `sleep`,
  Reddit credentials) at construction — `createSourceRegistry({ userAgent, reddit, fetch? })`
  builds them all. `run(config, cursor)` therefore keeps the shape in design.md and tests
  inject a fake fetch. Never reach for the global `fetch` inside an adapter.
- `run(config, cursor)` is read-only and idempotent. Return `nextCursor` even on partial
  failure so progress is never lost. A whole-request failure (auth, 5xx after retry, bad
  feed) throws `ProviderError`; the pipeline records it in `sources.last_error`.
- Never throw for a single bad item; push a warning and continue. Every external payload
  is Zod-parsed item by item (`redditPostSchema`, oEmbed).
- All HTTP via `deps.fetch` with `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` and the
  User-Agent from deps.
- **Reddit**: OAuth client-credentials flow (`client_credentials` grant, cached token with
  expiry). Respect `X-Ratelimit-Remaining` / `X-Ratelimit-Reset` headers; if remaining < 5,
  sleep until reset. Endpoints: `/r/{sub}/new.json?limit=100&before=<fullname>` and
  `/search.json?q=...&sort=new&restrict_sr=1`. `reddit/client.ts` owns the token cache
  (refreshes 60s early, re-auths once on 401), one retry on 429/5xx honouring
  `Retry-After`, and the rate-limit sleep. Cursors: subreddit `{ newest: fullname }` walked
  with `before` (max 5 pages; if the cursor post vanished and `before` returns nothing,
  refetch the latest page and let dedupe absorb repeats); search `{ newestCreatedUtc }`
  filtered client-side (max 3 pages). Strip Reddit markdown lightly (links kept as text).
  Post body = `selftext`, or the title for link posts; skip `[removed]`/`[deleted]`.
- **RSS**: `rss-parser` over the Google Alerts feed. Items have title, link (wrapped in a
  Google redirect — unwrap `url=` param), `published`, and a content snippet. Set
  `bodyIsSnippet: true`, `platform` from config, `externalId` = `canonicalUrl(target)`
  (lowercase host, no hash, tracking params and `utm_*` dropped, no trailing slash — see
  `url.ts`). The `url` column keeps the original target. Cursor `{ newestPublished: ISO }`.
  Parse with `parser.parseString(text)` on a body fetched through `deps.fetch`, never
  `parseURL` (it would bypass the injected fetch).
- **Hydrators** (`hydrate/`): given a `RawPost` with a snippet, try to fetch the full text.
  - LinkedIn: GET the post URL with a crawler-like UA; parse the `<meta property="og:description">`
    and the main text blocks. On auth wall (HTTP 999 or redirect to `/authwall`), keep the snippet.
  - X: `https://publish.twitter.com/oembed?url=<post>&omit_script=true` → strip HTML from
    `html`. Free, official, no auth.
  - Facebook: no hydrator; snippet only.
  Hydration is best-effort and never blocks scoring.
- Register sources in `registry.ts` by `kind`. The pipeline resolves adapters through the
  registry; nothing else imports adapters directly.

## Dedupe and pre-filter

- Insert posts with `onConflictDoNothing` on `(organization_id, platform, external_id)`.
  Then link `post_sources`. A post seen by three sources is one row.
- Pre-filter (`pipeline/prefilter.ts`): a post is a scoring candidate for a campaign if
  the source is keyword-scoped (`reddit_search`, `rss`) or title+body contains any campaign
  keyword (case-insensitive substring; `escapeLike` keeps `%`/`_` literal). It runs **inside
  the candidate query** (`findExtractionCandidates` → `candidateCondition`) so filtered
  posts never occupy the oldest-first batch window; `isCandidate` is the same rule in TS,
  kept for tests. Change both together.

## Extractor

- `LlmExtractor` takes an ordered provider list. Each provider is an OpenAI-compatible
  chat endpoint: Groq `https://api.groq.com/openai/v1`, Gemini
  `https://generativelanguage.googleapis.com/v1beta/openai`. Model ids live in env
  (`GROQ_MODEL`, `GEMINI_MODEL`), never in code.
- Providers implement `ChatProvider { name, model, complete(request) }` and are thin:
  `createOpenAiCompatibleProvider` wraps the `openai` SDK with `maxRetries: 0` (the
  extractor owns retry/fallback) and maps failures to `ProviderError` with `status`,
  `retryable` (429/5xx/network) and `retryAfterMs`. `createGroqProvider` /
  `createGeminiProvider` only set the base URL. Pass `fetch` to test against `fakeFetch`.
- One request scores a **batch** (`EXTRACT_BATCH_SIZE = 8`; the pipeline slices). The model
  is asked for a JSON **object** `{"results": [{id, evidence}]}` — JSON mode needs an object
  root — with `response_format: { type: "json_object" }`; `parseResponse` strips stray
  code fences, validates each item with `evidenceSchema`, drops criteria keys we didn't ask
  about, and ignores unknown ids.
- Per-post validation: malformed or missing items are re-asked once, alone, then returned
  in `ExtractionResult.dropped` with a reason. The extractor is DB-free apart from budget
  accounting, so the **pipeline** writes the `extract.dropped` event. Never let one bad
  item fail the batch.
- Retry policy: on a retryable `ProviderError`, retry once after `retryAfterMs` (default
  2s) on the same provider, then fall through to the next provider; when all fail, the
  last error propagates. A non-retryable error (400/401/403 — our bug) throws immediately.
- **Budget** (`budget.ts`): `createBudget({ store, caps })` over a `BudgetStore`;
  `createDbBudgetStore(db)` writes `llm.usage` events (`entityId` = provider, payload has
  `totalTokens`) and sums them with `sumLlmUsageSince` from the start of the UTC day,
  across organizations (caps are per API key). `canSpend` is false at ≥ 90% of the cap;
  uncapped providers always pass. When every provider is over budget the extractor throws
  `BudgetExhaustedError` — the pipeline must catch it and leave posts unscored, not drop them.
  `budget.status(provider)` feeds `runs.budget`.
- Few-shot: `selectFewShot(labels, limit)` alternates positive/negative from newest;
  `formatExample` truncates to 600 chars and appends the reviewer note. The pipeline loads
  labels with `listRecentLabels` and passes the selection in `ExtractionInput.examples`.
- The model never sees weights or thresholds. It receives criteria as `{key, question, type, options}`.
- Prompt template lives in `prompt.ts` with `PROMPT_VERSION = "2026-09-08.1"`. Bump it on
  any wording change; it's stored on every lead.

## Few-shot

- `fewshot.ts`: load up to `campaign.fewshotLimit` most recent labels for the campaign,
  balanced positive/negative where possible, join to the post text, truncate each to ~600
  chars. Format as examples before the posts to score. Tested with fixtures.

## Rules

- `applyRules` is pure and already tested. Pipeline step "score" calls it and writes
  `score`, `scoreBreakdown`, `confidence`, `verdict`, `rulesVersion`.
- Rescore = rules only over stored evidence, in batches of 500, in a transaction per batch.

## Notifiers

- `SlackWebhookNotifier`: one message per campaign per run, listing up to 10 leads with
  verdict, score, summary, link. Silent when nothing qualifies.
- `EmailDigestNotifier`: same content, once a day, via the configured SMTP (`nodemailer`).
- Never notify `insufficient` or `disqualified`.

## Pipeline run

`pipeline/run.ts` exports `runPipeline(deps: PipelineDeps)` with
`{ db, registry, extractorFor(orgId), notifiers, logger, now?, sourceIds?, maxCandidatesPerCampaign? }`.
`extractorFor` exists because budget usage events are recorded per organization.
`sourceIds` makes it a manual run (poll exactly those, due or not).

1. poll due sources (`findDueSourcesAllOrgs`, or `listSourcesByIds`) → `upsertPosts`,
   `recordSourceRun` (lastRunAt moves even on failure so a broken source waits its interval),
   `source.run` / `source.error` event per source.
2. for every active campaign (`listActiveCampaignsAllOrgs`): `findExtractionCandidates`
   (pre-filter included, oldest first, capped at 40) → hydrate snippet posts through the
   `rss` adapter and `updatePostContent` → extract in `EXTRACT_BATCH_SIZE` batches with
   few-shot from `listRecentLabels` → `applyRules` + `upsertLead` → notify each notifier
   with new leads at or above `minScoreAlert` (never insufficient/disqualified).
3. one `pipeline.run` event **per organization touched**, payload = `OrgRunReport`
   (`id, startedAt, durationMs, counts, errors, perSource`) — the shape `runs.list` returns.

Error isolation: a failing source, a failing extraction batch, a dropped post
(`extract.dropped`, written here, not by the extractor) and a failing notifier are all
recorded in the report's `errors`/events and the run continues. `BudgetExhaustedError`
stops extraction for the rest of the run (`extract.budget_exhausted`); the posts stay
candidates. Constants for event types live in `PIPELINE_EVENTS`.

Idempotent: running twice in a row does no duplicate work (cursors, dedupe,
candidates-without-a-lead). A post the model dropped is retried on the next run.

Tested end-to-end in `pipeline/run.test.ts` against the real DB with fake adapters,
extractor and notifiers — extend that test when you add a step.

## Testing

- Adapters: `src/test/fake-fetch.ts` — `fakeFetch(routes)` returns a `fetch` plus every
  recorded call (`callsTo(match)`); `jsonResponse`/`textResponse` build responses, a
  `respond: Response[]` sequence drives retry scenarios, `loadFixture(path)` reads
  `src/test/fixtures/<source>/…`. No msw (not approved), no live network.
  The current fixtures are hand-authored from the documented payload shapes — the
  scaffolding sandbox had no egress — so replace them with real recordings once Reddit
  credentials exist (public posts; nothing to scrub) and keep them small.
- Extractor: inject a fake provider returning canned JSON; test batching, validation,
  fallback, and budget behavior. Never call a real LLM in tests.
- Pipeline: integration test against the test DB with fake adapters end-to-end.
- Manual run: `pnpm --filter @leadsight/core exec tsx scripts/run-source.ts <sourceId>`
  for debugging a source against the live network.
