ALTER TYPE "public"."source_kind" ADD VALUE 'google_search';--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "active_hours" jsonb;