-- Replace plaintext `email` columns with AES-256-GCM ciphertext + IV + HMAC
-- blind index across the five tables that store member email addresses.
-- Hard cutover; pre-launch DB is empty.

-- members ------------------------------------------------------------------

DROP INDEX IF EXISTS "idx_members_email";
DROP INDEX IF EXISTS "idx_members_project_email_verified";

ALTER TABLE "members" DROP COLUMN IF EXISTS "email";

ALTER TABLE "members" ADD COLUMN "email_ciphertext" bytea;
ALTER TABLE "members" ADD COLUMN "email_iv" bytea;
ALTER TABLE "members" ADD COLUMN "email_lookup" bytea;

CREATE INDEX "idx_members_email_lookup" ON "members" USING btree ("email_lookup");
CREATE UNIQUE INDEX "idx_members_project_email_verified"
  ON "members" USING btree ("project_id", "email_lookup")
  WHERE "members"."email_verified" = true;

-- email_verifications ------------------------------------------------------

ALTER TABLE "email_verifications" DROP COLUMN IF EXISTS "email";

ALTER TABLE "email_verifications" ADD COLUMN "email_ciphertext" bytea NOT NULL;
ALTER TABLE "email_verifications" ADD COLUMN "email_iv" bytea NOT NULL;
ALTER TABLE "email_verifications" ADD COLUMN "email_lookup" bytea NOT NULL;

-- creation_verifications ---------------------------------------------------

DROP INDEX IF EXISTS "idx_creation_verifications_email";

ALTER TABLE "creation_verifications" DROP COLUMN IF EXISTS "email";

ALTER TABLE "creation_verifications" ADD COLUMN "email_ciphertext" bytea NOT NULL;
ALTER TABLE "creation_verifications" ADD COLUMN "email_iv" bytea NOT NULL;
ALTER TABLE "creation_verifications" ADD COLUMN "email_lookup" bytea NOT NULL;

CREATE INDEX "idx_creation_verifications_email_lookup"
  ON "creation_verifications" USING btree ("email_lookup");

-- login_verifications ------------------------------------------------------

DROP INDEX IF EXISTS "idx_login_verifications_lookup";

ALTER TABLE "login_verifications" DROP COLUMN IF EXISTS "email";

ALTER TABLE "login_verifications" ADD COLUMN "email_ciphertext" bytea NOT NULL;
ALTER TABLE "login_verifications" ADD COLUMN "email_iv" bytea NOT NULL;
ALTER TABLE "login_verifications" ADD COLUMN "email_lookup" bytea NOT NULL;

CREATE INDEX "idx_login_verifications_lookup"
  ON "login_verifications" USING btree ("project_id", "email_lookup");

-- api_tokens ---------------------------------------------------------------

DROP INDEX IF EXISTS "idx_api_tokens_email";

ALTER TABLE "api_tokens" DROP COLUMN IF EXISTS "email";

ALTER TABLE "api_tokens" ADD COLUMN "email_ciphertext" bytea NOT NULL;
ALTER TABLE "api_tokens" ADD COLUMN "email_iv" bytea NOT NULL;
ALTER TABLE "api_tokens" ADD COLUMN "email_lookup" bytea NOT NULL;

CREATE INDEX "idx_api_tokens_email_lookup" ON "api_tokens" USING btree ("email_lookup");
