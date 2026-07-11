import { Hono } from 'hono';
import { eq, and, desc, gte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity, members } from '../db/schema.js';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import type { ProjectContext } from '../middleware/project.js';
import { projectUrl } from '@plainspace/shared';

export const nudgeRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// GET /api/projects/:slug/nudge
nudgeRoutes.get('/', authMiddleware, async (c) => {
  const project = c.get('project');

  // Get activity from last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentActivity = await db.query.activity.findMany({
    where: and(eq(activity.projectId, project.id), gte(activity.createdAt, since)),
    orderBy: [desc(activity.createdAt)],
    limit: 20,
  });

  // Get all members for display name lookup
  const projectMembers = await db.query.members.findMany({
    where: eq(members.projectId, project.id),
  });
  const memberMap = new Map(projectMembers.map((m) => [m.id, m.displayName]));

  // Format the nudge text
  const lines: string[] = [];
  let addedCount = 0;
  let completedCount = 0;

  for (const entry of recentActivity) {
    const name = entry.memberId ? (memberMap.get(entry.memberId) ?? 'Someone') : 'Someone';
    const meta = entry.meta as Record<string, unknown>;

    switch (entry.action) {
      case 'item.created':
        lines.push(`- ${name} added "${meta.text}"`);
        addedCount++;
        break;
      case 'item.checked':
        lines.push(`- ${name} completed "${meta.text}"`);
        completedCount++;
        break;
      case 'member.joined':
        lines.push(`- ${meta.displayName ?? name} joined`);
        break;
    }
  }

  const summary: string[] = [];
  if (completedCount > 0)
    summary.push(`${completedCount} item${completedCount > 1 ? 's' : ''} done`);
  if (addedCount > 0) summary.push(`${addedCount} added`);

  let text = `Hey! Here's what's new in "${project.name}":\n\n`;
  if (lines.length > 0) {
    text += lines.slice(0, 10).join('\n') + '\n\n';
  }
  if (summary.length > 0) {
    text += summary.join(', ') + ' today.\n';
  }
  const origin = process.env.APP_URL ?? 'http://localhost:5173';
  text += `Check it out: ${projectUrl(origin, project.slug)}`;

  return c.json({ text });
});
