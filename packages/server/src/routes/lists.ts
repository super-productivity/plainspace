import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { lists } from '../db/schema.js';
import { UpdateListSchema } from '@plainspace/shared';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { uuidParam } from '../middleware/uuid-param.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeList } from '../lib/serialize.js';
import { sseManager } from '../services/sse-manager.js';
import { readJson } from '../lib/json.js';

export const listRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// PATCH /api/projects/:slug/lists/:listId - Update columns (kanban config)
listRoutes.patch('/:listId', authMiddleware, uuidParam('listId'), async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const listId = c.req.param('listId');

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = UpdateListSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const existing = await db.query.lists.findFirst({
    where: and(eq(lists.id, listId), eq(lists.projectId, project.id)),
  });

  if (!existing) {
    return c.json({ error: 'List not found' }, 404);
  }

  // columns is the only (optional) field; an empty body would reach Drizzle's
  // .set({}) which throws. Nothing to change → return the current state.
  if (parsed.data.columns === undefined) {
    return c.json({ list: serializeList(existing) });
  }

  const [updated] = await db
    .update(lists)
    .set({ columns: parsed.data.columns })
    .where(and(eq(lists.id, listId), eq(lists.projectId, project.id)))
    .returning();

  const serialized = serializeList(updated);
  void sseManager.broadcast(project.id, 'list.updated', { list: serialized, memberId: member.id });
  return c.json({ list: serialized });
});
