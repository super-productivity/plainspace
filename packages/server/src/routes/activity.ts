import { Hono } from 'hono';
import { eq, and, lt, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity } from '../db/schema.js';
import { ACTIVITY_ACTIONS, ACTIVITY_PAGE_SIZE } from '@plainspace/shared';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeActivity } from '../lib/serialize.js';
import { isUuid } from '../middleware/uuid-param.js';

export const activityRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// GET /api/projects/:slug/activity?beforeId=<activity UUID>&limit=30
// `before=<ISO-8601>` remains accepted for older clients, but IDs are the
// stable cursor: the timestamp is resolved inside Postgres at full precision.
activityRoutes.get('/', authMiddleware, async (c) => {
  const project = c.get('project');

  const before = c.req.query('before');
  const beforeId = c.req.query('beforeId');
  const parsedLimit = parseInt(c.req.query('limit') || String(ACTIVITY_PAGE_SIZE), 10);
  const limit = Number.isNaN(parsedLimit)
    ? ACTIVITY_PAGE_SIZE
    : Math.min(Math.max(parsedLimit, 1), 100);

  const conditions = [
    eq(activity.projectId, project.id),
    inArray(activity.action, [...ACTIVITY_ACTIONS]),
  ];
  if (beforeId) {
    if (!isUuid(beforeId)) {
      return c.json({ error: 'Invalid `beforeId` activity cursor' }, 400);
    }
    const cursor = await db.query.activity.findFirst({
      where: and(eq(activity.id, beforeId), eq(activity.projectId, project.id)),
      columns: { id: true },
    });
    if (!cursor) {
      return c.json({ error: 'Unknown `beforeId` activity cursor' }, 400);
    }
    // Tuple comparison gives deterministic keyset pagination. Keep this as a
    // DB-side subquery: selecting created_at through JavaScript would truncate
    // Postgres microseconds and could still skip rows at a page boundary.
    conditions.push(sql<boolean>`
      (${activity.createdAt}, ${activity.id}) < (
        SELECT cursor.created_at, cursor.id
        FROM activity AS cursor
        WHERE cursor.id = ${beforeId} AND cursor.project_id = ${project.id}
      )
    `);
  } else if (before) {
    const beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) {
      return c.json({ error: 'Invalid `before` timestamp' }, 400);
    }
    conditions.push(lt(activity.createdAt, beforeDate));
  }

  const entries = await db.query.activity.findMany({
    where: and(...conditions),
    orderBy: [desc(activity.createdAt), desc(activity.id)],
    limit: limit + 1, // fetch one extra to determine hasMore
  });

  const hasMore = entries.length > limit;
  const result = entries.slice(0, limit);

  const serialized = result.map(serializeActivity).filter((entry) => entry !== null);

  return c.json({
    entries: serialized,
    hasMore,
  });
});
