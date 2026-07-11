import { Hono } from 'hono';
import { eq, and, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/connection.js';
import { panels, polls, pollVotes, timeslots, timeslotResponses, lists } from '../db/schema.js';
import {
  CreatePanelSchema,
  UpdatePanelSchema,
  PollVoteSchema,
  TimeSlotRespondSchema,
  MAX_PANELS_PER_PROJECT,
} from '@plainspace/shared';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { uuidParam } from '../middleware/uuid-param.js';
import type { ProjectContext } from '../middleware/project.js';
import {
  serializePollPanel,
  serializeTimeSlotPanel,
  serializeChecklistPanel,
} from '../lib/serialize.js';
import { sseManager } from '../services/sse-manager.js';
import { recordActivity } from '../services/activity.js';
import { readJson } from '../lib/json.js';
import { checkRateLimit } from '../lib/rate-limit.js';

export const panelRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// POST /api/projects/:slug/panels - Create a panel. Any member may create.
// Member-keyed rate limit: 5/min bounds activity-feed churn from a single
// authenticated actor (an IP-keyed limit would unfairly punish coworkers
// sharing one office NAT).
panelRoutes.post('/', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  if (!checkRateLimit(`panel-create:${member.id}`, 5, 60_000)) {
    return c.json({ error: 'Too many panels created, slow down a moment' }, 429);
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = CreatePanelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const input = parsed.data;
  const result = await db.transaction(async (tx) => {
    // Count-then-insert is not atomic under READ COMMITTED, so the cap is
    // best-effort -- worst case a couple over a 20-panel limit. Acceptable
    // for a soft cap that exists only to bound `GET /:slug` payload size.
    const [{ value: panelCount }] = await tx
      .select({ value: count() })
      .from(panels)
      .where(eq(panels.projectId, project.id));
    if (panelCount >= MAX_PANELS_PER_PROJECT) {
      return { capExceeded: true as const };
    }

    const [panel] = await tx
      .insert(panels)
      .values({ projectId: project.id, type: input.type, createdBy: member.id })
      .returning();

    // Option / slot ids are server-generated -- the client submits text only.
    let serialized;
    if (input.type === 'poll') {
      const options = input.options.map((text) => ({ id: nanoid(), text }));
      const [poll] = await tx
        .insert(polls)
        .values({ panelId: panel.id, question: input.question, options })
        .returning();
      serialized = serializePollPanel(panel, poll, []);
    } else if (input.type === 'timeslot') {
      const slots = input.slots.map((label) => ({ id: nanoid(), label }));
      const [timeslot] = await tx
        .insert(timeslots)
        .values({ panelId: panel.id, title: input.title, slots })
        .returning();
      serialized = serializeTimeSlotPanel(panel, timeslot, []);
    } else {
      // checklist: a real (secondary) list backs the panel so its items are
      // full tasks. `panelId` wires the cascade -- deleting the panel removes
      // this list and (via items.list_id) its items. Created empty; items are
      // added afterward through `POST /items` with this listId.
      const [list] = await tx
        .insert(lists)
        .values({
          projectId: project.id,
          panelId: panel.id,
          title: input.title,
          createdBy: member.id,
        })
        .returning();
      serialized = serializeChecklistPanel(panel, list);
    }

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'panel.created',
      targetType: 'panel',
      targetId: panel.id,
      meta: { type: input.type },
    });
    return { serialized, activityEntry };
  });

  if ('capExceeded' in result) {
    return c.json({ error: `A Space can have at most ${MAX_PANELS_PER_PROJECT} panels` }, 422);
  }

  const serialized = result.serialized;
  void sseManager.broadcast(project.id, 'panel.created', {
    panel: serialized,
    memberId: member.id,
  });
  void sseManager.broadcast(project.id, 'activity', { entry: result.activityEntry });
  return c.json({ panel: serialized }, 201);
});

// DELETE /api/projects/:slug/panels/:panelId - Hard delete. Any member may
// delete any panel: panels are shared, collaborative content (like items), so
// deletion isn't owner-scoped. Cascade clears poll + votes. No
// soft-delete/restore -- panels carry their state in shared content (votes), so
// undo semantics are unclear.
//
// Member-keyed rate limit (10/min): now that any member can delete any panel --
// and each delete is an irreversible cascade that also fans out two SSE
// broadcasts to every connected client -- the cap bounds mass-deletion griefing
// and the resulting broadcast churn from a single actor, while still letting a
// member clear a project's panels (capped at MAX_PANELS_PER_PROJECT) within a
// couple of minutes. Mirrors the create / vote / respond limits below.
panelRoutes.delete('/:panelId', authMiddleware, uuidParam('panelId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const panelId = c.req.param('panelId');

  if (!checkRateLimit(`panel-delete:${member.id}`, 10, 60_000)) {
    return c.json({ error: 'Too many panels deleted, slow down a moment' }, 429);
  }

  const result = await db.transaction(async (tx) => {
    const panel = await tx.query.panels.findFirst({
      where: and(eq(panels.id, panelId), eq(panels.projectId, project.id)),
    });
    if (!panel) return { notFound: true as const };

    // Hard delete: the cascade removes `polls` + `poll_votes` (and, for a
    // checklist panel, its backing `lists` row and all its `items`) immediately,
    // so poll question text and checklist item text are unrecoverable from this
    // point. If an operator
    // ever removes a panel as a DSA Art. 17 enforcement action, they must
    // capture the `polls.question` value out of band BEFORE calling this
    // endpoint -- the `panel.deleted` activity entry stores only `{ type }`.
    // The post-launch plan in `CLAUDE.md` ("DSA Art. 17 Statement-of-Reasons
    // scope") is to accept an optional `enforcementReason` on this route and
    // call `sendStatementOfReasons` inside the tx with a snapshot of the
    // question + options.
    await tx.delete(panels).where(eq(panels.id, panelId));

    // `activity.meta` carries only `{ type }` -- no user-authored text -- so
    // no scrubbing pass is needed here (unlike `items.ts`).
    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'panel.deleted',
      targetType: 'panel',
      targetId: panelId,
      meta: { type: panel.type },
    });
    return { activityEntry };
  });

  if ('notFound' in result) return c.json({ error: 'Panel not found' }, 404);

  void sseManager.broadcast(project.id, 'panel.deleted', { panelId, memberId: member.id });
  void sseManager.broadcast(project.id, 'activity', { entry: result.activityEntry });
  return c.body(null, 204);
});

// PATCH /api/projects/:slug/panels/:panelId - Rename a panel. The display title
// lives in the per-type table (a checklist's backing `lists` row, a poll's
// `question`, a time slot's `title`), so the update targets that table and
// re-serializes the panel. Any member may rename (panels are shared content,
// like delete). Member-keyed rate limit (20/min) bounds rename churn and the
// SSE broadcast it fans out, mirroring the other panel routes.
panelRoutes.patch('/:panelId', authMiddleware, uuidParam('panelId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const panelId = c.req.param('panelId');

  if (!checkRateLimit(`panel-update:${member.id}`, 20, 60_000)) {
    return c.json({ error: 'Too many changes, slow down a moment' }, 429);
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = UpdatePanelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }
  const { title } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const panel = await tx.query.panels.findFirst({
      where: and(eq(panels.id, panelId), eq(panels.projectId, project.id)),
    });
    if (!panel) return { notFound: true as const };

    if (panel.type === 'checklist') {
      const [list] = await tx
        .update(lists)
        .set({ title })
        .where(and(eq(lists.panelId, panelId), eq(lists.projectId, project.id)))
        .returning();
      return { panel: serializeChecklistPanel(panel, list) };
    }
    if (panel.type === 'poll') {
      const [poll] = await tx
        .update(polls)
        .set({ question: title })
        .where(eq(polls.panelId, panelId))
        .returning();
      const votes = await tx.select().from(pollVotes).where(eq(pollVotes.panelId, panelId));
      return { panel: serializePollPanel(panel, poll, votes) };
    }
    const [timeslot] = await tx
      .update(timeslots)
      .set({ title })
      .where(eq(timeslots.panelId, panelId))
      .returning();
    const responses = await tx
      .select()
      .from(timeslotResponses)
      .where(eq(timeslotResponses.panelId, panelId));
    return { panel: serializeTimeSlotPanel(panel, timeslot, responses) };
  });

  if ('notFound' in result) return c.json({ error: 'Panel not found' }, 404);

  void sseManager.broadcast(project.id, 'panel.updated', {
    panel: result.panel,
    memberId: member.id,
  });
  return c.json({ panel: result.panel });
});

// POST /api/projects/:slug/panels/:panelId/vote - Cast / change / retract.
// `optionId: null` retracts; non-null upserts. Votes are high-frequency by
// design and would flood the activity feed, so no `recordActivity` call here.
panelRoutes.post('/:panelId/vote', authMiddleware, uuidParam('panelId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const panelId = c.req.param('panelId');

  if (!checkRateLimit(`poll-vote:${member.id}`, 30, 60_000)) {
    return c.json({ error: 'Too many votes, slow down a moment' }, 429);
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = PollVoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }
  const { optionId } = parsed.data;

  const result = await db.transaction(async (tx) => {
    // Single join load proves the panel exists, belongs to the project, and
    // is a poll (only polls have a row in `polls`).
    const rows = await tx
      .select({ options: polls.options })
      .from(polls)
      .innerJoin(panels, eq(panels.id, polls.panelId))
      .where(and(eq(polls.panelId, panelId), eq(panels.projectId, project.id)));
    const poll = rows[0];
    if (!poll) return { notFound: true as const };

    if (optionId !== null && !poll.options.some((o) => o.id === optionId)) {
      return { badOption: true as const };
    }

    if (optionId === null) {
      await tx
        .delete(pollVotes)
        .where(and(eq(pollVotes.panelId, panelId), eq(pollVotes.memberId, member.id)));
    } else {
      await tx
        .insert(pollVotes)
        .values({ panelId, optionId, memberId: member.id })
        .onConflictDoUpdate({
          target: [pollVotes.panelId, pollVotes.memberId],
          set: { optionId },
        });
    }
    return { ok: true as const };
  });

  if ('notFound' in result) return c.json({ error: 'Poll not found' }, 404);
  if ('badOption' in result) return c.json({ error: 'Invalid option' }, 422);

  void sseManager.broadcast(project.id, 'poll.vote', {
    panelId,
    memberId: member.id,
    optionId,
  });
  return c.body(null, 204);
});

// POST /api/projects/:slug/panels/:panelId/respond - Mark / clear availability
// for one slot. `available: true` upserts a (panel, member, slot) row;
// `false` deletes it. Both are idempotent (redundant toggles are no-ops), so a
// retract with no existing row still returns 204. High-frequency like votes, so
// no `recordActivity`.
panelRoutes.post('/:panelId/respond', authMiddleware, uuidParam('panelId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const panelId = c.req.param('panelId');

  if (!checkRateLimit(`timeslot-respond:${member.id}`, 30, 60_000)) {
    return c.json({ error: 'Too many responses, slow down a moment' }, 429);
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = TimeSlotRespondSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }
  const { slotId, available } = parsed.data;

  const result = await db.transaction(async (tx) => {
    // Single join load proves the panel exists, belongs to the project, and
    // is a timeslot (only timeslots have a row in `timeslots`).
    const rows = await tx
      .select({ slots: timeslots.slots })
      .from(timeslots)
      .innerJoin(panels, eq(panels.id, timeslots.panelId))
      .where(and(eq(timeslots.panelId, panelId), eq(panels.projectId, project.id)));
    const timeslot = rows[0];
    if (!timeslot) return { notFound: true as const };

    if (!timeslot.slots.some((s) => s.id === slotId)) {
      return { badSlot: true as const };
    }

    if (available) {
      await tx
        .insert(timeslotResponses)
        .values({ panelId, slotId, memberId: member.id })
        .onConflictDoNothing({
          target: [timeslotResponses.panelId, timeslotResponses.memberId, timeslotResponses.slotId],
        });
    } else {
      await tx
        .delete(timeslotResponses)
        .where(
          and(
            eq(timeslotResponses.panelId, panelId),
            eq(timeslotResponses.memberId, member.id),
            eq(timeslotResponses.slotId, slotId),
          ),
        );
    }
    return { ok: true as const };
  });

  if ('notFound' in result) return c.json({ error: 'TimeSlot not found' }, 404);
  if ('badSlot' in result) return c.json({ error: 'Invalid slot' }, 422);

  void sseManager.broadcast(project.id, 'timeslot.response', {
    panelId,
    memberId: member.id,
    slotId,
    available,
  });
  return c.body(null, 204);
});
