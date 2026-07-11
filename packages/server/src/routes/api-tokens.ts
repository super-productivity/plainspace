import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeApiToken } from '../lib/serialize.js';
import { findActiveToken, mintApiToken, revokeActiveTokens } from '../lib/api-token.js';

// API token management for external integrations. One active token per email,
// enforced by a partial unique index (idx_api_tokens_active_email): creating a
// new one revokes the previous. Tokens are keyed to the member's verified email
// (blind index), not the member row, so they survive member merges and work
// across Spaces.
export const apiTokenRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// POST /api/projects/:slug/auth/api-tokens - Create (replacing any existing) token
apiTokenRoutes.post('/api-tokens', authMiddleware, async (c) => {
  const member = c.get('member');

  if (!member.emailVerified || !member.emailCiphertext || !member.emailIv || !member.emailLookup) {
    return c.json({ error: 'Add an email to this Space before creating API tokens' }, 400);
  }

  const email = {
    emailCiphertext: member.emailCiphertext,
    emailIv: member.emailIv,
    emailLookup: member.emailLookup,
  };
  // Revoke + mint in one transaction so the pair is atomic (see lib/api-token.ts
  // for the exact concurrency guarantees under READ COMMITTED).
  const { token, row } = await db.transaction(async (tx) => {
    await revokeActiveTokens(tx, email.emailLookup);
    return mintApiToken(tx, email);
  });

  return c.json(
    {
      token,
      apiToken: serializeApiToken(row),
    },
    201,
  );
});

// GET /api/projects/:slug/auth/api-tokens - The active token for this email, if any
apiTokenRoutes.get('/api-tokens', authMiddleware, async (c) => {
  const member = c.get('member');

  if (!member.emailLookup) {
    return c.json({ token: null });
  }

  // At most one row matches (the partial unique index guarantees a single
  // non-revoked token per email).
  const token = await findActiveToken(db, member.emailLookup);

  return c.json({ token: token ? serializeApiToken(token) : null });
});

// DELETE /api/projects/:slug/auth/api-tokens - Revoke the active token
apiTokenRoutes.delete('/api-tokens', authMiddleware, async (c) => {
  const member = c.get('member');

  if (!member.emailLookup) {
    return c.json({ error: 'No email associated' }, 400);
  }

  await revokeActiveTokens(db, member.emailLookup);

  return c.body(null, 204);
});
