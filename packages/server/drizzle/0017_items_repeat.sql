-- Repeating tasks (recurring reminders).
--
-- items.repeat: nullable jsonb holding a RepeatRule (freq/interval/byWeekday/
-- byMonthDay/tz/anchor). NULL ⇒ a one-shot reminder, exact current behaviour.
-- The sweep reads it to advance remind_at to the next occurrence and to
-- reactivate the item. The immutable `anchor` field (DTSTART) is the sole
-- source of the series' time-of-day and interval>1 phase, so retry/DST
-- rewrites of remind_at never drift the schedule.

ALTER TABLE "items" ADD COLUMN "repeat" jsonb;
