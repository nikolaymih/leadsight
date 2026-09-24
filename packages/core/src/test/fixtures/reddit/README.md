# Reddit fixtures

Hand-authored from Reddit's documented listing shape (`kind: "Listing"`, `data.children[].data`
with `name`, `title`, `selftext`, `author`, `permalink`, `created_utc`, …). The sandbox this
project was scaffolded in had no egress to reddit.com, so these are not recordings.

To replace them with real captures once credentials exist:

```
pnpm --filter @leadsight/core exec tsx scripts/record-reddit.ts   # (to be added with the pipeline)
```

Keep them small and public. Nothing here is sensitive.
