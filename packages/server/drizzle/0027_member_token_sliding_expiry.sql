ALTER TABLE "member_tokens"
ALTER COLUMN "expires_at" SET DEFAULT now() + interval '30 days';
--> statement-breakpoint
-- No backfill: expires_at is now an idle window rather than a fixed lifetime,
-- and every live session already sits below the halfway mark of the new 30-day
-- TTL, so sessionForToken slides each one out to the full window on its owner's
-- next request. Sessions nobody comes back for lapse on their original schedule.
