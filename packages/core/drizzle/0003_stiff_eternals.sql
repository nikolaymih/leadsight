-- google_search is retired (Google Custom Search JSON API is closed to new customers and shuts
-- down 2027-01-01). Its sources carry the same config shape as web_search, so they are converted,
-- not deleted; the rest of this migration is drizzle-kit's enum rebuild.
ALTER TABLE "sources" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
UPDATE "sources" SET "kind" = 'web_search' WHERE "kind" = 'google_search';--> statement-breakpoint
DROP TYPE "public"."source_kind";--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('reddit_subreddit', 'reddit_search', 'rss', 'web_search');--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "kind" SET DATA TYPE "public"."source_kind" USING "kind"::"public"."source_kind";