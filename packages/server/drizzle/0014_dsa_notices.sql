-- DSA Art. 16 notices: structured, persistent intake for reports of allegedly
-- illegal content. Decoupled from project / item / attachment by string
-- pointers so notices survive content removal (audit trail).

CREATE TABLE "dsa_notices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_location" varchar(500) NOT NULL,
  "project_slug" varchar(22),
  "item_id" uuid,
  "attachment_id" uuid,
  "category" varchar(30) NOT NULL,
  "reason" text NOT NULL,
  "submitter_name" varchar(100),
  "submitter_email_ciphertext" bytea,
  "submitter_email_iv" bytea,
  "submitter_email_lookup" bytea,
  "good_faith_confirmed" boolean NOT NULL DEFAULT false,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "status" varchar(30) NOT NULL DEFAULT 'new',
  "status_updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_dsa_notices_received" ON "dsa_notices" ("received_at");
CREATE INDEX "idx_dsa_notices_status" ON "dsa_notices" ("status", "received_at");
