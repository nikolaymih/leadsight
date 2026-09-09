# Reddit data access

Status as of **2026-09-09**: the Reddit Data API adapters (`reddit_subreddit`,
`reddit_search`) are **optional and disabled** unless `REDDIT_CLIENT_ID` and
`REDDIT_CLIENT_SECRET` are set. Discovery on Reddit goes through Google search over
public post pages (`google_search` with `platform: "reddit"`) instead.

## Why

- Since 2025 the Reddit Data API requires manual approval under the Responsible Builder
  Policy. Approvals for small commercial tools are rare and slow.
- The unauthenticated `.json` and `.rss` endpoints that used to work now answer 403 for
  server-side clients.
- Reddit's terms prohibit scraping; we do not crawl reddit.com for discovery. The only
  reddit.com requests we make are single GETs of public post pages that Google already
  indexed, to read the full text of a post a search result pointed at (see
  `packages/core/src/sources/hydrate/reddit.ts`). If Reddit blocks those, the snippet is
  kept and scoring continues.

## Ticket

| | |
|---|---|
| Request | Reddit Data API access, "Responsible Builder" application |
| Filed | 2026-09-09 |
| Use case stated | Read-only monitoring of public posts matching a small set of phrases, for an internal lead-finding tool; no posting, no user data retention beyond public post text |
| Status | Pending |
| Owner | Nikolay |

Update this table when Reddit answers.

## If approval arrives

1. Put the app's client id and secret in `deploy/.env` (`REDDIT_CLIENT_ID`,
   `REDDIT_CLIENT_SECRET`) and set `REDDIT_USER_AGENT` to name your Reddit username.
2. Restart the API. The registry enables the two `reddit_*` kinds automatically; the
   add-source form starts offering them (`integrations.searchBudget.enabledSourceKinds`).
3. Keep `google_search` sources running; the API adapters add coverage (new posts within
   minutes, full text without hydration) rather than replacing search.
4. Replace the hand-authored Reddit fixtures under `packages/core/src/test/fixtures/reddit`
   with real recordings.

## If it is refused

Nothing changes operationally. Delete the two `reddit_*` kinds only if they become a
maintenance burden; they cost nothing while disabled.
