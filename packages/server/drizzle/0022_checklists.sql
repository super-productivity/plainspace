-- Checklist panels: a lightweight secondary task list rendered as a side panel.
-- Unlike polls/timeslots (0015/0019), a checklist has NO per-type content table
-- -- its items are real `items` rows in a backing list, so they are full tasks
-- (assignable, remindable, visible to the SP integration). `lists` gains a
-- nullable `panel_id` (the backing-list link; ON DELETE CASCADE so removing the
-- panel removes the list and, via items.list_id, its items in one step) and a
-- nullable `title`. The primary (hero) list has both NULL; a checklist list has
-- both set.

ALTER TABLE "lists" ADD COLUMN "panel_id" uuid REFERENCES "panels"("id") ON DELETE CASCADE;
ALTER TABLE "lists" ADD COLUMN "title" varchar(280);

-- Was unique(project_id) -- exactly one list per project. Now at most one
-- PRIMARY list per project (panel_id IS NULL); checklist lists are unconstrained.
DROP INDEX "idx_lists_project_unique";
CREATE UNIQUE INDEX "idx_lists_project_primary" ON "lists" ("project_id") WHERE "panel_id" IS NULL;
