ALTER TABLE "members" ADD COLUMN "tos_version" varchar(20);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "tos_accepted_at" timestamp with time zone;