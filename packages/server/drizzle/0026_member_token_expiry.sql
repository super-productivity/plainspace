ALTER TABLE "member_tokens"
ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
-- Backfill existing sessions to expire 7 days after issuance, matching the
-- published "expires 7 days after issuance" promise. A column DEFAULT cannot
-- reference created_at, so backfill explicitly here; sessions already older
-- than 7 days land in the past and are rejected on their next request (the
-- promised behavior). New rows use the now()-based default set below.
UPDATE "member_tokens" SET "expires_at" = "created_at" + interval '7 days';
--> statement-breakpoint
ALTER TABLE "member_tokens"
ALTER COLUMN "expires_at" SET DEFAULT now() + interval '7 days',
ALTER COLUMN "expires_at" SET NOT NULL;
