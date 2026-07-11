-- Partial indexes for the reminder sweep's two per-tick queries: the claim
-- (due reminders) and the self-heal pass (stranded recurring rows). Both
-- predicates match a tiny fraction of items, so partial indexes keep the
-- 60s sweep off full table scans as the table grows.

CREATE INDEX "idx_items_remind_due" ON "items" ("remind_at") WHERE "remind_at" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_items_repeat_stranded" ON "items" ("id") WHERE "repeat" IS NOT NULL AND "remind_at" IS NULL AND "deleted_at" IS NULL;
