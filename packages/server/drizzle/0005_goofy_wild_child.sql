ALTER TABLE "items" ADD COLUMN "column_id" varchar(50) DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "columns" jsonb;
UPDATE "items" SET "column_id" = 'done' WHERE "checked" = true;