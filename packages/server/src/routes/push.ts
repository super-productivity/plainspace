import { Hono } from 'hono';
import { PushSubscriptionSchema } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { pushSubscriptions } from '../db/schema.js';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import type { ProjectContext } from '../middleware/project.js';
import { readJson } from '../lib/json.js';
import { checkRateLimit } from '../lib/rate-limit.js';

// Two routers in one file: one unauthenticated public-key endpoint, mounted
// at /api/push (used by the SW before any session exists), and one project-
// scoped subscription endpoint mounted at /api/projects/:slug/push.

export const pushPublicRoutes = new Hono();

// GET /api/push/public-key — VAPID public key for the browser to subscribe.
// The key is by design public; no auth required.
pushPublicRoutes.get('/public-key', (c) => {
  return c.json({ key: process.env.VAPID_PUBLIC_KEY ?? null });
});

export const pushRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// PUT /api/projects/:slug/push/subscription — Idempotent upsert of the
// current member's push subscription. member_id always comes from the
// session, never from the body; the (member_id, endpoint) primary key plus
// ON CONFLICT DO UPDATE makes this safe against hijack attempts (an attacker
// PUTting a known victim endpoint only creates a row owned by the attacker;
// the victim's row is untouched and only the victim's p256dh/auth keys can
// decrypt pushes targeted at the victim).
pushRoutes.put('/subscription', authMiddleware, async (c) => {
  const member = c.get('member');

  if (!checkRateLimit(`push-sub:${member.id}`, 20, 60_000)) {
    return c.json({ error: 'Too many subscription updates' }, 429);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = PushSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  await db
    .insert(pushSubscriptions)
    .values({
      memberId: member.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.memberId, pushSubscriptions.endpoint],
      set: {
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
    });

  return c.body(null, 204);
});
