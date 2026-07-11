-- items.updated_at: high-water mark for the integration `?updatedSince=` poll.
--
-- A BEFORE UPDATE trigger stamps it on EVERY row update rather than relying on
-- application code to set it. This is deliberate: items are mutated from many
-- places (the items + integration routes, member-merge, and — critically — the
-- reminder sweep, which uses a raw `UPDATE items SET remind_at = NULL`). A
-- drizzle-level $onUpdate would silently miss the raw-SQL writers, leaving a
-- changed row invisible to polling. The trigger is the single choke point that
-- can't be forgotten by a future writer. Over-bumping (e.g. a no-op update) is
-- harmless for polling — it only ever causes an extra refetch, never a miss.
--
-- now() is stable (not immutable), so adding the NOT NULL DEFAULT rewrites the
-- table once to backfill existing rows with the migration timestamp; acceptable
-- at this scale.

ALTER TABLE "items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "set_items_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trg_items_updated_at" BEFORE UPDATE ON "items" FOR EACH ROW EXECUTE FUNCTION "set_items_updated_at"();
