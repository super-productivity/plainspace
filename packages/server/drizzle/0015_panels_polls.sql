-- Panels framework + Polls. Generic `panels` owns layout (type + creator +
-- ordered-by-createdAt); per-type content lives in per-type tables. Polls is
-- the first (and so far only) type. Options live as JSONB on `polls` -- option
-- ids are server-generated. Votes are one-row-per-(panel,member) with a
-- unique index so re-voting is an upsert and retraction is a delete.

CREATE TABLE "panels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "type" varchar(20) NOT NULL,
  "created_by" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_panels_project" ON "panels" ("project_id");

CREATE TABLE "polls" (
  "panel_id" uuid PRIMARY KEY REFERENCES "panels"("id") ON DELETE CASCADE,
  "question" varchar(280) NOT NULL,
  "options" jsonb NOT NULL
);

CREATE TABLE "poll_votes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "panel_id" uuid NOT NULL REFERENCES "panels"("id") ON DELETE CASCADE,
  "option_id" varchar(64) NOT NULL,
  "member_id" uuid NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "idx_poll_votes_panel_member" ON "poll_votes" ("panel_id", "member_id");
