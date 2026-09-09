# LeadSight — UI Design Brief

Paste this into Claude Design together with `design.md`.

## What it is

An internal social-listening tool. It watches Reddit and Google Alerts feeds
for posts that match a "campaign" (an offer + ideal poster + weighted
criteria), extracts evidence from each post with an LLM, scores it with fixed
rules, and puts the results in a ranked inbox. Three people use it daily.
Later it may become a multi-tenant product, so the layout should not assume a
single user, but v1 polish goes into the inbox, not onboarding.

## Tone and constraints

- Internal tool, desktop-first, responsive down to tablet. Phone is read-only
  (inbox + lead detail), no editing screens required on phone.
- Dense, scannable, low-chrome. Think Linear or Plausible, not a marketing
  SaaS. No hero sections, no illustrations, no gradients.
- Light theme by default, dark theme optional.
- Evidence and reasons are first-class: any score must be expandable to show
  why, with the quote it came from. Never show a number without a way to see
  the breakdown.
- Nothing is sent or posted automatically. The UI links out to the original
  post; outreach happens elsewhere.
- Use a neutral system font stack and one accent color. Verdict colors: hot,
  warm, cold, insufficient (grey), disqualified (muted red).
- Use shadcn/ui-style components (Next.js + Tailwind stack).

## Navigation

Left sidebar: Inbox, Campaigns, Sources & Runs, Settings. Top bar: campaign
selector (scopes Inbox and Sources), organization switcher, user menu.

## Screens

### 1. Inbox (primary screen)

The screen people live in.

Data per row:
- Verdict badge (hot / warm / cold / insufficient / disqualified)
- Score (0–100) and confidence (0–100), confidence as a small secondary value
- Platform icon (Reddit, LinkedIn, X, Facebook, web)
- Post title or first line; one-line LLM summary underneath
- Author handle
- Posted-at (relative) and source name
- Status (new, reviewed, contacted, replied, won, lost, not_fit) and assignee
  avatar

Interactions:
- Default sort: verdict, then score desc. Sort toggles for newest and
  confidence.
- Filters: verdict, status, assignee, platform, min score, date range. Filters
  persist per campaign.
- Row expands inline to show the score breakdown: one line per criterion with
  points awarded / possible and the supporting quote. Also shows disqualifier
  hits if any.
- Inline status change and assignee change without leaving the list.
- Keyboard navigation: j/k to move, e to expand, s to set status, o to open
  original post.
- Bulk select → set status / assign.
- Empty state for a new campaign: "No leads yet. Sources run hourly; next run
  in 23 min" with a "Run now" button.

### 2. Lead detail

Opens as a right-side panel from the inbox (not a full page), so context is
kept.

Sections top to bottom:
- Header: verdict, score, confidence, platform, link to original post.
- Full post text (title + body). Flag if body is a snippet only.
- Evidence table: criterion, value, points, quote, per-field confidence.
- Disqualifiers section if any hit.
- Status and assignee controls.
- Notes: chronological, with author and time; add-note box.
- Footer: extractor provider, prompt version, rules version, scored-at
  (small, grey).

### 3. Campaign setup (chat)

Two-pane layout. Left: chat. Right: the draft campaign, updating as the chat
progresses.

Chat starts with a single prompt: "Describe what you're looking for. You can
paste a URL to your offer." Follow-ups are short and specific.

Draft pane sections:
- Name
- Offer description (textarea)
- Ideal poster (textarea)
- Disqualifiers (tag list)
- Keywords (tag list)
- Criteria: one card per criterion with key, question, type, options/points
  for enums, and a weight slider. A total indicator shows weights summing to
  100 and blocks save otherwise. Criteria can be reordered, removed, or added
  manually.
- Thresholds: hot / warm sliders on a single 0–100 track.
- Suggested sources: subreddits and Reddit searches as toggles.
- Alert queries: copy-to-clipboard list, with an inline field to paste each
  resulting Google Alerts feed URL.

Primary action: "Create campaign". Secondary: "Regenerate criteria" (re-runs
only the criteria part of the draft).

### 4. Campaign settings

Same form as the draft pane, without the chat, for an existing campaign.

Additions:
- Rules version shown next to criteria; editing bumps it on save.
- "Preview rescoring" toggle: while weights are being changed, a small panel
  shows how many current leads would move between verdicts, computed from
  stored evidence (no LLM call). Save then applies it.
- Pause / archive campaign.
- Notification settings: email digest recipients, minimum score to alert.
  (A Slack webhook field is deferred until a chat notifier is wanted.)

### 5. Sources & runs

Top: source list for the current campaign. Columns: kind, config summary
(subreddit name / query / feed platform), enabled toggle, last run, last
error (red text, truncated, expandable), posts found in last 24h. Actions:
run now, edit, disable.

Bottom: recent pipeline runs as a table. Columns: started, duration, per-step
counts (polled, pre-filtered, hydrated, extracted, scored, notified), errors.
Row expands to a per-source breakdown for that run.

Small always-visible indicator of LLM budget: tokens used today vs. daily
cap, per provider.

### 6. Settings

- Organization: name, members with roles, invite by email.
- Integrations: email delivery status (SMTP configured or log-only, sender
  address), how many campaigns have digest recipients; chat alerts shown as
  deferred.
- Providers: Groq key, Gemini key, order of fallback (read-only display,
  keys masked).
- Personal: profile, theme, notification preferences.

### 7. Auth

Login (email + password, Google), sign-up, forgot password, accept
invitation, organization switcher. Plain and minimal; use the standard
Better Auth UI pattern.

## Things to avoid

- Charts and analytics dashboards. Not in v1.
- AI reply drafting UI. Not in v1.
- Onboarding tours, tooltips explaining the product, marketing copy.
- Modals for things that can be inline or in a side panel.

## Deliverables

Interactive prototype of screens 1–5 with realistic sample data (two
campaigns: "founders seeking an MVP team" and "JavaScript contract jobs", ~30
leads each with varied verdicts), plus a small design-system note: colors,
type scale, spacing, verdict badge styles, table density.
