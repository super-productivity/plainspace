-- TimeSlot (availability poll) panel type. Mirrors panels/polls (0015): the
-- generic `panels` table owns layout; `timeslots` holds per-type content. Slots
-- live as JSONB on `timeslots` -- slot ids are server-generated. Each response
-- row means "this member is available for this slot"; absence means
-- not-available. The unique index has one more column than poll_votes'
-- (panel, member) -- (panel, member, slot) -- because TimeSlot is multi-select:
-- a member may mark many slots.

CREATE TABLE "timeslots" (
  "panel_id" uuid PRIMARY KEY REFERENCES "panels"("id") ON DELETE CASCADE,
  "title" varchar(280) NOT NULL,
  "slots" jsonb NOT NULL
);

CREATE TABLE "timeslot_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "panel_id" uuid NOT NULL REFERENCES "panels"("id") ON DELETE CASCADE,
  "slot_id" varchar(64) NOT NULL,
  "member_id" uuid NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "idx_timeslot_responses_panel_member_slot" ON "timeslot_responses" ("panel_id", "member_id", "slot_id");
