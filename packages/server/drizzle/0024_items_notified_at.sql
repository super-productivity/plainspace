-- Completion-driven recurrence.
--
-- items.notified_at: when the reminder sweep last delivered a push for the
-- occurrence currently in remind_at. A recurring reminder now fires ONCE at its
-- occurrence and then leaves remind_at untouched (the task reads as due → then
-- overdue) until the user checks it off; checking off advances remind_at to the
-- next occurrence and clears notified_at. The claim suppresses a recurring row
-- once notified_at >= remind_at, so an undone overdue occurrence is not
-- re-notified every tick. NULL for one-shot reminders (they still clear
-- remind_at on fire).
ALTER TABLE "items" ADD COLUMN "notified_at" timestamp with time zone;
--> statement-breakpoint
-- The reminder sweep no longer nulls remind_at on a recurring fire (it stamps
-- notified_at instead), so the "stranded" state this index guarded
-- (repeat set, remind_at NULL) is unreachable. Drop it with its self-heal pass.
DROP INDEX IF EXISTS "idx_items_repeat_stranded";
