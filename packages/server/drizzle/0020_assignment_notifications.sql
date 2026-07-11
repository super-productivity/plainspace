-- Batched "task assigned to you" push notifications.
--
-- A row queues a pending assignment notification for (member_id, item_id). The
-- reminder sweep's flush pass claims a member's whole batch atomically
-- (DELETE … RETURNING) once their assignments settle (newest >= quiet-window
-- old) or the batch has waited too long (oldest >= max-wait old), then deletes
-- the rows. A burst of assignments therefore collapses into one notification.
--
-- Composite PK (member_id, item_id) keeps one row per assignment and serves the
-- member-prefix lookups; the flush's GROUP BY member_id aggregates over the
-- small pending set, so no separate index. The FKs are ON DELETE CASCADE so a
-- removed member (hard delete) drops any queued notification for free. Items
-- are soft-deleted (deleted_at) rather than hard-deleted, so that cascade only
-- fires later during retention; in the meantime the flush re-validates each
-- item against the live row and skips soft-deleted ones, so a deleted item
-- never notifies.

CREATE TABLE "assignment_notifications" (
  "member_id" uuid NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("member_id", "item_id")
);
