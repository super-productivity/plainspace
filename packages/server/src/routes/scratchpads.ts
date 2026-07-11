import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { scratchpads } from '../db/schema.js';
import { ScratchpadEditingSchema, UpdateScratchpadSchema } from '@plainspace/shared';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { uuidParam } from '../middleware/uuid-param.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeScratchpad } from '../lib/serialize.js';
import { sseManager } from '../services/sse-manager.js';
import { recordActivity } from '../services/activity.js';
import { readJson } from '../lib/json.js';

export const scratchpadRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// PATCH /api/projects/:slug/scratchpads/:padId - Update content
scratchpadRoutes.patch('/:padId', authMiddleware, uuidParam('padId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const padId = c.req.param('padId');

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = UpdateScratchpadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.scratchpads.findFirst({
      where: and(eq(scratchpads.id, padId), eq(scratchpads.projectId, project.id)),
    });
    if (!existing) return null;

    const [updated] = await tx
      .update(scratchpads)
      .set({
        content: parsed.data.content,
        updatedBy: member.id,
        updatedAt: new Date(),
      })
      .where(and(eq(scratchpads.id, padId), eq(scratchpads.projectId, project.id)))
      .returning();

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'scratchpad.updated',
      targetType: 'scratchpad',
      targetId: padId,
      coalesceWithinMs: 5 * 60 * 1000,
    });
    return { scratchpad: updated, activityEntry };
  });

  if (!result) {
    return c.json({ error: 'Scratchpad not found' }, 404);
  }

  const serialized = serializeScratchpad(result.scratchpad);
  void sseManager.broadcast(project.id, 'scratchpad.updated', {
    scratchpad: serialized,
    memberId: member.id,
  });
  void sseManager.broadcast(project.id, 'activity', { entry: result.activityEntry });
  return c.json({ scratchpad: serialized });
});

// POST /api/projects/:slug/scratchpads/:padId/editing - Broadcast ephemeral editing state
scratchpadRoutes.post('/:padId/editing', authMiddleware, uuidParam('padId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const padId = c.req.param('padId');

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = ScratchpadEditingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const existing = await db.query.scratchpads.findFirst({
    where: and(eq(scratchpads.id, padId), eq(scratchpads.projectId, project.id)),
  });

  if (!existing) {
    return c.json({ error: 'Scratchpad not found' }, 404);
  }

  void sseManager.broadcast(project.id, 'scratchpad.editing', {
    scratchpadId: padId,
    memberId: member.id,
    editing: parsed.data.editing,
  });

  return c.body(null, 204);
});
