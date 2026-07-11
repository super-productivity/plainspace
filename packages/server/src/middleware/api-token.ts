import { createMiddleware } from 'hono/factory';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { API_TOKEN_PREFIX } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { apiTokens } from '../db/schema.js';
import { hashToken } from '../lib/crypto.js';
import { decryptStoredEmail } from '../lib/email-crypto.js';

export type ApiTokenContext = {
  apiTokenEmail: string;
  // Blind index over the token's email — pass into queries against any
  // emailLookup column (members, etc.) to avoid round-tripping plaintext.
  apiTokenEmailLookup: Buffer;
  apiTokenId: string;
};

export const apiTokenMiddleware = createMiddleware<{ Variables: ApiTokenContext }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    // RFC 7235 §2.1: auth-scheme is case-insensitive. Require the scheme to
    // be present (the old .replace('Bearer ', '') silently accepted bare
    // tokens).
    const token = authHeader?.match(/^[Bb][Ee][Aa][Rr][Ee][Rr]\s+(\S+)$/)?.[1];

    if (!token || !token.startsWith(API_TOKEN_PREFIX)) {
      return c.json({ error: 'Missing or invalid API token' }, 401);
    }

    const hash = hashToken(token);
    const row = await db.query.apiTokens.findFirst({
      where: and(
        eq(apiTokens.tokenHash, hash),
        isNull(apiTokens.revokedAt),
        gt(apiTokens.expiresAt, new Date()),
      ),
    });

    if (!row) {
      return c.json({ error: 'Invalid, expired, or revoked API token' }, 401);
    }

    // Update last_used_at (fire-and-forget)
    db.update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, row.id))
      .then(() => {})
      .catch(() => {});

    const plaintext = decryptStoredEmail(row);
    if (plaintext === null) {
      return c.json({ error: 'Invalid API token' }, 401);
    }
    c.set('apiTokenEmail', plaintext);
    c.set('apiTokenEmailLookup', row.emailLookup);
    c.set('apiTokenId', row.id);
    await next();
  },
);
