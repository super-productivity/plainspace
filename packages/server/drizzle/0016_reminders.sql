-- Reminders + web push subscriptions.
--
-- items.remind_at: wall-clock fire time (UTC). The reminder sweep claims due
-- rows by nulling this column in a single UPDATE … RETURNING, so the predicate
-- "remind_at IS NOT NULL AND remind_at <= now()" doubles as "pending".
--
-- push_subscriptions: composite PK (member_id, endpoint). Composite means a
-- member can register multiple devices, and two members on the same shared
-- browser get two distinct rows (each row's p256dh/auth keys decrypt only
-- pushes targeted to its member_id). FCM endpoints can exceed 2048 chars, so
-- endpoint is `text`, not varchar. The composite PK's btree also serves the
-- only access pattern (member_id-prefix lookups in the reminder sweep), so
-- no separate index.

ALTER TABLE "items" ADD COLUMN "remind_at" timestamp with time zone;

CREATE TABLE "push_subscriptions" (
  "member_id" uuid NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" varchar(255) NOT NULL,
  "auth" varchar(255) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("member_id", "endpoint")
);
