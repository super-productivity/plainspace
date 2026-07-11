import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { projects } from '../db/schema.js';

export type ProjectContext = {
  project: typeof projects.$inferSelect;
};

export const projectMiddleware = createMiddleware<{
  Variables: ProjectContext;
}>(async (c, next) => {
  const slug = c.req.param('slug');
  if (!slug) {
    return c.json({ error: 'Space slug is required' }, 400);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, slug),
  });

  if (!project) {
    return c.json({ error: 'Space not found' }, 404);
  }

  c.set('project', project);
  await next();
});
