# Reddit data access

Status as of **2026-09-24**: the Reddit Data API request was **denied**. The API adapters
(`reddit_subreddit`, `reddit_search`) stay in the codebase but are disabled unless
`REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set. Do not plan around approval, do not
re-apply, and do not open duplicate tickets.

Reddit remains a priority platform. It is covered through the `web_search` source
(Exa / Tavily, see `CLAUDE.md` next steps) plus Google Alerts RSS. Until `web_search`
ships, the existing `google_search` kind (Google Programmable Search over public post
pages) does the same job. No scraping of reddit.com in any form.

## Timeline

| Date | Event |
|---|---|
| Nov 2025 | Reddit puts the Data API behind manual approval under the Responsible Builder Policy. Small commercial tools are rarely approved. |
| May 2026 | The unauthenticated `.json` and `.rss` endpoints start answering 403 for server-side clients. |
| 2026-09-09 | First submission of the access request (ticket **18465893**, account u/nikolaymih11). Use case: read-only monitoring of public posts matching a small set of phrases, for an internal lead-finding tool; no posting, no user data kept beyond public post text. |
| 2026-09-09 → 2026-09-16 | Second submission on the same ticket (details added on Reddit's request). Exact date not recorded here; add it if known. |
| 2026-09-16 | **Denied**, templated response: "not in compliance with the Responsible Builder Policy and/or lacks necessary details". |
| 2026-09-24 | Decision: no re-application. Coverage via `web_search` (Exa / Tavily) + Google Alerts RSS. Reddit API adapters remain feature-flagged. |

## Coverage strategy

- **Discovery**: `web_search` sources scoped to `reddit.com` (and to specific subreddits via
  a site scope) polled on the source's interval, plus Google Alerts feeds pasted in as
  `rss` sources. Both produce snippet posts; both are keyword-scoped, so every result is a
  scoring candidate.
- **Full text**: the per-platform hydrator (`packages/core/src/sources/hydrate/reddit.ts`)
  does a single GET of the public post page a search result pointed at, with a crawler user
  agent, and reads the server-rendered post. This is the only reddit.com request the system
  makes. It is not crawling: no listings, no pagination, no discovery, one page per lead.
  If Reddit blocks it, the snippet is kept and scoring continues.
- **Never**: the Reddit API without credentials, the `.json`/`.rss` endpoints, or any
  crawl of reddit.com listings, search pages or user pages.

## The API adapters

They cost nothing while disabled and are kept in case the situation changes on Reddit's
side. The registry registers them as disabled adapters: config still validates, a run
fails with a clear non-retryable error naming the missing env, and the add-source form
does not offer them (`integrations.searchBudget.enabledSourceKinds`). Should credentials
ever exist, setting `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` and `REDDIT_USER_AGENT` and
restarting the API is the whole switch. The Reddit fixtures under
`packages/core/src/test/fixtures/reddit` are hand-authored and would need real recordings
first.
