-- Per-device member sessions. The single bearer token used to live in
-- members.token_hash, so every new sign-in for a member overwrote it and logged
-- the member's other devices out (recovering on the phone killed the laptop's
-- session). Move it into its own table so one member (the same person on phone +
-- laptop) can hold several concurrent sessions: joining, creating, or recovering
-- on a device INSERTS a row here instead of overwriting a single slot.
--
-- token_hash is the natural key (sha256 hex, globally unique), so it is the
-- PRIMARY KEY and serves the O(1) auth lookup. ON DELETE CASCADE ties a
-- session's lifetime to its member, so removing a member (self-deletion, admin
-- removal, merge) revokes its tokens in one step; idx_member_tokens_member backs
-- those cascading deletes and any future "sign out my other devices" sweep.

CREATE TABLE "member_tokens" (
  "token_hash" varchar(64) PRIMARY KEY,
  "member_id" uuid NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_member_tokens_member" ON "member_tokens" ("member_id");

-- Backfill every existing single-slot token as a session so no one is logged
-- out by this deploy.
INSERT INTO "member_tokens" ("token_hash", "member_id")
SELECT "token_hash", "id" FROM "members";

-- The token now lives in member_tokens; drop the old single slot and its index
-- (dropping the column would cascade the index, but be explicit to match style).
DROP INDEX "idx_members_token_hash";
ALTER TABLE "members" DROP COLUMN "token_hash";
