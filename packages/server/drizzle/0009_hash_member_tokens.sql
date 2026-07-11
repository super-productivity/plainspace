-- Requires brief downtime: stop the app before applying, then deploy new code AFTER the migration completes. Old code (reading members.token) is incompatible with the post-migration schema.
-- The SQL and snapshot for this migration were hand-authored because drizzle-kit does not emit CREATE EXTENSION or data-mutating UPDATE statements.
-- Hash member join tokens server-side.
-- Existing browser tokens keep working because we backfill token_hash = sha256(token)
-- and only then drop the plaintext column. Clients send the plaintext; the server hashes on lookup.

CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

ALTER TABLE "members" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint

UPDATE "members" SET "token_hash" = encode(digest("token", 'sha256'), 'hex');--> statement-breakpoint

ALTER TABLE "members" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint

DROP INDEX "idx_members_token";--> statement-breakpoint

ALTER TABLE "members" DROP COLUMN "token";--> statement-breakpoint

CREATE UNIQUE INDEX "idx_members_token_hash" ON "members" USING btree ("token_hash");
