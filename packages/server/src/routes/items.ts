import { Hono } from 'hono';
import { eq, and, asc, inArray, isNull, max } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  activity,
  assignmentNotifications,
  attachments,
  items,
  lists,
  members,
  projects,
} from '../db/schema.js';
import {
  CreateItemSchema,
  ReorderItemsSchema,
  UpdateItemSchema,
  POSITION_GAP,
  type RepeatRule,
  type UpdateItemInput,
} from '@plainspace/shared';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { uuidParam } from '../middleware/uuid-param.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeItem } from '../lib/serialize.js';
import { recurrenceUpdateOnCheck } from '../lib/next-occurrence.js';
import { sseManager } from '../services/sse-manager.js';
import { recordActivity } from '../services/activity.js';
import { readJson } from '../lib/json.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { hasItemCapacity, ITEM_CAPACITY_ERROR } from '../services/item-capacity.js';

export const itemRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

type ItemRow = typeof items.$inferSelect;

// Reconcile the repeat/remindAt/anchor invariants for a PATCH, mutating
// `updates`. Returns false iff the request is invalid (repeat set without an
// effective remindAt → caller 422s). The server owns the immutable `anchor`:
// it's (re)stamped only on rule creation (null → non-null) or an explicit
// re-schedule (payload sets a non-null remindAt); every other PATCH preserves
// the stored anchor, so retry/DST-shifted remind_at values never leak into the
// series. Clearing remindAt (null) cascades to repeat:null; clearing repeat
// leaves remindAt as a one-shot reminder.
function applyRepeatUpdate(
  updates: Partial<typeof items.$inferInsert>,
  data: UpdateItemInput,
  existing: ItemRow,
): boolean {
  const clearsRemindAt = data.remindAt === null;
  // Effective remindAt after this PATCH: the explicit new value, else the
  // value already on the row.
  const effectiveRemindAt =
    data.remindAt !== undefined
      ? data.remindAt
        ? new Date(data.remindAt)
        : null
      : existing.remindAt;

  // Clearing the reminder removes any recurrence (a rule with no next
  // occurrence is meaningless) — regardless of what `repeat` the payload sent.
  if (clearsRemindAt) {
    updates.repeat = null;
    return true;
  }

  if (data.repeat === null) {
    updates.repeat = null;
    return true;
  }

  if (data.repeat !== undefined) {
    // Setting a rule requires an effective reminder time.
    if (!effectiveRemindAt) return false;
    // Re-anchor only on rule creation or an explicit re-schedule. A rule-only
    // PATCH keeps the old anchor: between a transient delivery failure and its
    // retry, remind_at holds a jittered retry timestamp — stamping that would
    // drift the series' time-of-day permanently.
    const anchor =
      existing.repeat && !data.remindAt ? existing.repeat.anchor : effectiveRemindAt.toISOString();
    updates.repeat = { ...data.repeat, anchor } as RepeatRule;
    return true;
  }

  // No `repeat` in the payload. If this PATCH re-schedules (explicit non-null
  // remindAt) an item that already repeats, re-anchor the existing rule to the
  // new time (new time-of-day + phase).
  if (data.remindAt !== undefined && effectiveRemindAt && existing.repeat) {
    updates.repeat = { ...existing.repeat, anchor: effectiveRemindAt.toISOString() };
  }
  return true;
}

// POST /api/projects/:slug/items - Create item
itemRoutes.post('/', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  // Items are the highest-volume write and each one fans out two SSE
  // broadcasts; this member-keyed cap bounds a flooding member (open Spaces
  // have anonymous join) while clearing any real person's entry pace —
  // rapid-fire list dumping sustains ~1 item per 2s.
  if (!checkRateLimit(`item-create:${member.id}`, 60, 60_000)) {
    return c.json({ error: 'Too many items created, slow down a moment' }, 429);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = CreateItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  // Target list: an explicit `listId` (a checklist panel's list) scoped to this
  // project, else the project's primary (hero) list (panel_id IS NULL).
  const list = await db.query.lists.findFirst({
    where: parsed.data.listId
      ? and(eq(lists.id, parsed.data.listId), eq(lists.projectId, project.id))
      : and(eq(lists.projectId, project.id), isNull(lists.panelId)),
  });

  if (!list) {
    return c.json({ error: 'List not found' }, 404);
  }

  const result = await db.transaction(async (tx) => {
    if (!(await hasItemCapacity(tx, project.id))) {
      return { capExceeded: true as const };
    }
    const [result] = await tx
      .select({ maxPos: max(items.position) })
      .from(items)
      .where(and(eq(items.listId, list.id), isNull(items.deletedAt)));
    const position = (result?.maxPos ?? 0) + POSITION_GAP;

    const [item] = await tx
      .insert(items)
      .values({
        listId: list.id,
        projectId: project.id,
        text: parsed.data.text,
        columnId: parsed.data.columnId,
        checked: parsed.data.columnId === 'done',
        checkedBy: parsed.data.columnId === 'done' ? member.id : null,
        position,
        createdBy: member.id,
      })
      .returning();

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'item.created',
      targetType: 'item',
      targetId: item.id,
      meta: { text: item.text },
    });
    return { item, activityEntry };
  });

  if ('capExceeded' in result) {
    return c.json({ error: ITEM_CAPACITY_ERROR }, 422);
  }
  const { item, activityEntry } = result;

  const serialized = serializeItem(item);
  void sseManager.broadcast(project.id, 'item.created', { item: serialized, memberId: member.id });
  void sseManager.broadcast(project.id, 'activity', { entry: activityEntry });
  return c.json({ item: serialized, activity: activityEntry }, 201);
});

// PATCH /api/projects/:slug/items - Atomically renumber item positions
itemRoutes.patch('/', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  // Gap exhaustion is rare, and one request can rewrite every active item.
  // Keep this separate from ordinary item edits so a client cannot amplify the
  // 240/min single-row allowance into an unbounded write multiplier. One full
  // rewrite per minute is enough for this rare recovery path and caps it at
  // the Space's 500 active items.
  if (!checkRateLimit(`item-reorder:${member.id}`, 1, 60_000)) {
    return c.json({ error: 'Too many item reorders, slow down a moment' }, 429);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = ReorderItemsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const result = await db.transaction(async (tx) => {
    // KEY SHARE conflicts with create/restore's project UPDATE lock, so neither
    // can append from a stale pre-renumber maximum. It remains compatible with
    // activity FK checks made by ordinary item writes while this batch waits on
    // their item locks. Destination lists likewise need only KEY SHARE: it
    // prevents deletion without conflicting with cross-list PATCH FK locks.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, project.id))
      .for('key share');

    const listIds = [...new Set(parsed.data.updates.map((update) => update.listId))];
    const ownedLists = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.projectId, project.id), inArray(lists.id, listIds)))
      .orderBy(asc(lists.id))
      .for('key share');
    if (ownedLists.length !== listIds.length) return { error: 'list_not_found' as const };

    const itemIds = parsed.data.updates.map((update) => update.id);
    const ownedItems = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.projectId, project.id), inArray(items.id, itemIds), isNull(items.deletedAt)),
      )
      .orderBy(asc(items.id))
      .for('update');
    if (ownedItems.length !== itemIds.length) return { error: 'item_not_found' as const };

    const updated = [];
    for (const update of parsed.data.updates) {
      const [item] = await tx
        .update(items)
        .set({ listId: update.listId, position: update.position })
        .where(
          and(eq(items.id, update.id), eq(items.projectId, project.id), isNull(items.deletedAt)),
        )
        .returning();
      updated.push(item);
    }
    return { updated };
  });

  if ('error' in result) {
    return result.error === 'list_not_found'
      ? c.json({ error: 'List not found' }, 404)
      : c.json({ error: 'Item not found' }, 404);
  }

  for (const item of result.updated) {
    void sseManager.broadcast(project.id, 'item.updated', {
      item: serializeItem(item),
      memberId: member.id,
    });
  }
  return c.body(null, 204);
});

// PATCH /api/projects/:slug/items/:itemId - Update item
itemRoutes.patch('/:itemId', authMiddleware, uuidParam('itemId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const itemId = c.req.param('itemId');

  // Higher than item-create because ordinary edits and single-row moves share
  // this route. Whole-list gap-exhaustion rewrites use the bounded collection
  // PATCH above instead of spending one request per row.
  if (!checkRateLimit(`item-update:${member.id}`, 240, 60_000)) {
    return c.json({ error: 'Too many item updates, slow down a moment' }, 429);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = UpdateItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.projectId, project.id), isNull(items.deletedAt)),
    });
    if (!existing) return null;

    if (parsed.data.assignedTo) {
      const assignee = await tx.query.members.findFirst({
        where: and(eq(members.id, parsed.data.assignedTo), eq(members.projectId, project.id)),
        columns: { id: true },
      });
      if (!assignee) {
        return { error: 'assignee_not_found' as const };
      }
    }

    // Moving the item to another list: the target must belong to this project.
    // Skip the lookup for a no-op (same list) so a plain reorder stays one query.
    if (parsed.data.listId !== undefined && parsed.data.listId !== existing.listId) {
      const targetList = await tx.query.lists.findFirst({
        where: and(eq(lists.id, parsed.data.listId), eq(lists.projectId, project.id)),
        columns: { id: true },
      });
      if (!targetList) return { error: 'list_not_found' as const };
    }

    const updates: Partial<typeof items.$inferInsert> = {};
    if (parsed.data.text !== undefined) updates.text = parsed.data.text;
    if (parsed.data.listId !== undefined) updates.listId = parsed.data.listId;
    if (parsed.data.position !== undefined) updates.position = parsed.data.position;
    if (parsed.data.assignedTo !== undefined) updates.assignedTo = parsed.data.assignedTo;
    if (parsed.data.remindAt !== undefined) {
      updates.remindAt = parsed.data.remindAt ? new Date(parsed.data.remindAt) : null;
      // Re-scheduling re-arms the fire for the new time: a stale notified_at
      // (from a past occurrence) must not suppress it.
      updates.notifiedAt = null;
    }

    // Recurrence. The server owns the immutable `anchor` (DTSTART): the rule
    // body sent by the client has no anchor (stripped by the schema), so we
    // stamp it from the effective remindAt — but only when the rule is first
    // created or when the request explicitly re-schedules (sets a non-null
    // remindAt). On every other PATCH the existing anchor is preserved, so a
    // rename/reorder/check can't leak a retry- or DST-shifted remind_at into
    // the series. The sweep never touches the anchor.
    if (!applyRepeatUpdate(updates, parsed.data, existing)) {
      return { error: 'repeat_requires_remind_at' as const };
    }

    if (parsed.data.columnId !== undefined) {
      updates.columnId = parsed.data.columnId;
      if (parsed.data.columnId === 'done') {
        updates.checked = true;
        updates.checkedBy = member.id;
      } else if (existing.columnId === 'done') {
        updates.checked = false;
        updates.checkedBy = null;
      }
    }

    if (parsed.data.checked !== undefined) {
      updates.checked = parsed.data.checked;
      updates.checkedBy = parsed.data.checked ? member.id : null;
      if (parsed.data.checked && parsed.data.columnId === undefined) {
        updates.columnId = 'done';
      } else if (
        !parsed.data.checked &&
        parsed.data.columnId === undefined &&
        existing.columnId === 'done'
      ) {
        updates.columnId = 'todo';
      }
    }

    // Advance / roll back a recurring task's remind_at when this PATCH flips its
    // completion — the same transition the integration PATCH applies, so the two
    // routes can't drift (recurrenceUpdateOnCheck is the shared owner of the
    // rationale). Skipped when the PATCH itself re-schedules: that path already
    // set remind_at/notified_at from the payload above and owns the pointer.
    if (parsed.data.remindAt === undefined) {
      const transition = recurrenceUpdateOnCheck(
        existing,
        updates.checked ?? existing.checked,
        new Date(),
      );
      if (transition) Object.assign(updates, transition);
    }

    const [updated] = await tx
      .update(items)
      .set(updates)
      .where(and(eq(items.id, itemId), eq(items.projectId, project.id)))
      .returning();

    let activityEntry;
    if (parsed.data.checked !== undefined) {
      const action = parsed.data.checked ? 'item.checked' : 'item.unchecked';
      activityEntry = await recordActivity(tx, {
        projectId: project.id,
        memberId: member.id,
        action,
        targetType: 'item',
        targetId: itemId,
        meta: { text: existing.text },
      });
    } else if (parsed.data.assignedTo !== undefined) {
      activityEntry = await recordActivity(tx, {
        projectId: project.id,
        memberId: member.id,
        action: 'item.assigned',
        targetType: 'item',
        targetId: itemId,
        meta: { text: existing.text, assignedTo: parsed.data.assignedTo },
      });
    } else if (parsed.data.text !== undefined) {
      activityEntry = await recordActivity(tx, {
        projectId: project.id,
        memberId: member.id,
        action: 'item.updated',
        targetType: 'item',
        targetId: itemId,
        meta: { text: parsed.data.text },
      });
    }

    // Queue a batched "assigned to you" push for the new assignee. Driven off
    // the assignment change itself, not the activity branch above, so a PATCH
    // that also flips `checked` (which takes the first branch) still enqueues.
    // Skip self-assignment (no point pinging yourself) and no-op re-assignments
    // to the same member. ON CONFLICT bumps assigned_at so a re-assign refreshes
    // the trailing window; the sweep re-validates the live item before sending,
    // so unassign/check/delete before flush need no cleanup here.
    const assignee = parsed.data.assignedTo;
    if (assignee && assignee !== member.id && assignee !== existing.assignedTo) {
      await tx
        .insert(assignmentNotifications)
        .values({ memberId: assignee, itemId })
        .onConflictDoUpdate({
          target: [assignmentNotifications.memberId, assignmentNotifications.itemId],
          set: { assignedAt: new Date() },
        });
    }
    return { updated, activityEntry };
  });

  if (!result) {
    return c.json({ error: 'Item not found' }, 404);
  }
  if ('error' in result) {
    if (result.error === 'repeat_requires_remind_at') {
      return c.json({ error: 'A repeat rule requires a reminder time' }, 422);
    }
    if (result.error === 'list_not_found') {
      return c.json({ error: 'List not found' }, 404);
    }
    return c.json({ error: 'Member not found' }, 404);
  }

  const serialized = serializeItem(result.updated);
  void sseManager.broadcast(project.id, 'item.updated', { item: serialized, memberId: member.id });
  if (result.activityEntry) {
    void sseManager.broadcast(project.id, 'activity', { entry: result.activityEntry });
  }
  return c.json({ item: serialized, activity: result.activityEntry });
});

// DELETE /api/projects/:slug/items/:itemId - Soft delete item
itemRoutes.delete('/:itemId', authMiddleware, uuidParam('itemId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const itemId = c.req.param('itemId');

  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.projectId, project.id), isNull(items.deletedAt)),
    });
    if (!existing) return null;

    await tx
      .update(activity)
      .set({ meta: {} })
      .where(
        and(
          eq(activity.projectId, project.id),
          eq(activity.targetType, 'item'),
          eq(activity.targetId, itemId),
        ),
      );

    // Attachment activity rows carry a copy of item.text in meta; scrub them
    // too so erasure of the item doesn't leave its content in the activity log.
    const itemAttachments = await tx.query.attachments.findMany({
      where: eq(attachments.itemId, itemId),
      columns: { id: true },
    });
    if (itemAttachments.length > 0) {
      await tx
        .update(activity)
        .set({ meta: {} })
        .where(
          and(
            eq(activity.projectId, project.id),
            eq(activity.targetType, 'attachment'),
            inArray(
              activity.targetId,
              itemAttachments.map((a) => a.id),
            ),
          ),
        );
    }

    await tx
      .update(items)
      .set({ deletedAt: new Date() })
      .where(and(eq(items.id, itemId), eq(items.projectId, project.id)));

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'item.deleted',
      targetType: 'item',
      targetId: itemId,
      meta: {},
    });
    return { activityEntry };
  });

  if (!result) {
    return c.json({ error: 'Item not found' }, 404);
  }

  void sseManager.broadcast(project.id, 'item.deleted', { itemId, memberId: member.id });
  void sseManager.broadcast(project.id, 'activity', { entry: result.activityEntry });
  return c.body(null, 204);
});

// POST /api/projects/:slug/items/:itemId/restore - Restore soft-deleted item
itemRoutes.post('/:itemId/restore', authMiddleware, uuidParam('itemId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const itemId = c.req.param('itemId');

  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.projectId, project.id)),
    });
    if (!existing || !existing.deletedAt) return null;

    // Restoring re-activates a row, so it must clear the same cap as creation —
    // otherwise the delete/create/restore cycle grows the active snapshot past
    // MAX_ITEMS_PER_PROJECT. hasItemCapacity locks the project row, serializing
    // this against concurrent creates.
    if (!(await hasItemCapacity(tx, project.id))) {
      return { capExceeded: true as const };
    }

    const [restored] = await tx
      .update(items)
      .set({ deletedAt: null })
      .where(and(eq(items.id, itemId), eq(items.projectId, project.id)))
      .returning();

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'item.restored',
      targetType: 'item',
      targetId: restored.id,
      meta: { text: restored.text },
    });
    return { restored, activityEntry };
  });

  if (!result) {
    return c.json({ error: 'Item not found or not deleted' }, 404);
  }
  if ('capExceeded' in result) {
    return c.json({ error: ITEM_CAPACITY_ERROR }, 422);
  }

  const serialized = serializeItem(result.restored);
  void sseManager.broadcast(project.id, 'item.restored', {
    item: serialized,
    memberId: member.id,
  });
  void sseManager.broadcast(project.id, 'activity', { entry: result.activityEntry });
  return c.json({ item: serialized, activity: result.activityEntry });
});
