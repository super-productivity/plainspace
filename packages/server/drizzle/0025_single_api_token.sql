-- One API token per email. The multi-token feature (a list of named,
-- independently-revocable tokens, capped at 5 per email) was speculative
-- flexibility: the realistic case is a single integration. Creating a token now
-- revokes any previous one, so the per-token "name" label -- which only existed
-- to disambiguate a list -- is dead. Drop it.
ALTER TABLE "api_tokens" DROP COLUMN "name";
--> statement-breakpoint
-- Enforce "one active token per email" at the DB level (same partial
-- unique-index pattern as verified members and primary lists), not just in app
-- code. Revoke any pre-existing duplicates first so the index can be created --
-- a no-op today (no real token users yet) but keeps the migration safe anywhere.
UPDATE "api_tokens" SET "revoked_at" = now()
WHERE "revoked_at" IS NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("email_lookup") "id"
    FROM "api_tokens"
    WHERE "revoked_at" IS NULL
    ORDER BY "email_lookup", "created_at" DESC
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_api_tokens_active_email" ON "api_tokens" ("email_lookup") WHERE "revoked_at" IS NULL;
