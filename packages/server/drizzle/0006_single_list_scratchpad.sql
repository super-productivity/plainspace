-- Collapse to one list + one scratchpad per project.
-- Wipes existing items/lists/scratchpads, then bootstraps one of each per project.

TRUNCATE TABLE "attachments" CASCADE;--> statement-breakpoint
TRUNCATE TABLE "items" CASCADE;--> statement-breakpoint
TRUNCATE TABLE "lists" CASCADE;--> statement-breakpoint
TRUNCATE TABLE "scratchpads" CASCADE;--> statement-breakpoint

ALTER TABLE "lists" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "lists" DROP COLUMN "deleted_at";--> statement-breakpoint

ALTER TABLE "scratchpads" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "scratchpads" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "scratchpads" DROP COLUMN "deleted_at";--> statement-breakpoint

CREATE UNIQUE INDEX "idx_lists_project_unique" ON "lists" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_scratchpads_project_unique" ON "scratchpads" USING btree ("project_id");--> statement-breakpoint

INSERT INTO "lists" ("project_id", "columns")
SELECT id, '[{"id":"todo","name":"To Do"},{"id":"in_progress","name":"In Progress"},{"id":"done","name":"Done"}]'::jsonb FROM "projects";--> statement-breakpoint

INSERT INTO "scratchpads" ("project_id", "content") SELECT id, '' FROM "projects";
