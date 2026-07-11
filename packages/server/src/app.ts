import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { projectRoutes } from './routes/projects.js';
import { integrationRoutes } from './routes/integration.js';
import { publicAuthRoutes } from './routes/public-auth.js';
import { contactRoutes } from './routes/contact.js';
import { dsaRoutes } from './routes/dsa.js';
import { pushPublicRoutes } from './routes/push.js';
import { pgClient } from './db/connection.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function createApp() {
  const app = new Hono();

  // Bearer-token auth (no cookies) means CORS isn't load-bearing for the
  // authenticated API; keep it permissive so server-side integrations and
  // potential browser-based tools aren't blocked.
  app.use('*', cors());
  app.use('*', logger());

  // Cap request bodies before per-route zod validation, so an oversized
  // payload is rejected at the edge instead of being parsed into memory.
  // 512 KB clears the largest legitimate body (a 50k-char scratchpad, which
  // can reach a few hundred KB once UTF-8/JSON-escaped) with headroom.
  app.use(
    '*',
    bodyLimit({
      maxSize: 512 * 1024,
      onError: (c) => c.json({ error: 'Request body too large' }, 413),
    }),
  );

  app.onError((err, c) => {
    console.error(`[${c.req.method} ${c.req.path}]`, err);
    return c.json({ error: 'Internal error' }, 500);
  });

  // Hit the DB so an external uptime check (cron curl) catches a dead
  // connection, not just a live HTTP process. Returns 503 so `curl -f` fails.
  app.get('/health', async (c) => {
    try {
      await pgClient`select 1`;
      return c.json({ status: 'ok' });
    } catch (err) {
      console.error('[GET /health] db check failed', err);
      return c.json({ status: 'error' }, 503);
    }
  });

  app.route('/api/integration', integrationRoutes);
  app.route('/api/auth', publicAuthRoutes);
  app.route('/api/contact', contactRoutes);
  app.route('/api/dsa', dsaRoutes);
  app.route('/api/push', pushPublicRoutes);
  app.route('/api/projects', projectRoutes);

  // In production, serve the built SolidJS frontend
  if (process.env.NODE_ENV === 'production') {
    const staticRoot = resolve(import.meta.dirname, '../../web/dist');
    const indexPath = resolve(staticRoot, 'index.html');
    const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : null;

    // Service worker must not be cached by intermediaries — a fix-rollout
    // needs to reach existing users on the next navigation, not whenever an
    // upstream cache TTL expires. Browsers themselves cap SW caching at 24h
    // but reverse proxies and CDNs don't.
    app.get('/service-worker.js', async (c, next) => {
      await next();
      c.res.headers.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');
    });

    app.use('/*', serveStatic({ root: staticRoot }));

    // SPA fallback: serve index.html for client-side routes
    app.get('/*', (c) => {
      if (indexHtml) return c.html(indexHtml);
      return c.notFound();
    });
  }

  return app;
}
