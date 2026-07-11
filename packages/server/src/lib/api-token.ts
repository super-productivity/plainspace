import { and, eq, gt, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { API_TOKEN_PREFIX, API_TOKEN_LENGTH, API_TOKEN_EXPIRY_DAYS } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { apiTokens } from '../db/schema.js';
import { hashToken } from './crypto.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Conn = typeof db | Tx;

// The encrypted-email columns a token is keyed to. Both api-token rows and
// member rows expose this shape; a token minted from a verified member inherits
// their columns so decrypting it yields the owner's address (GET /integration/me).
export interface EmailColumns {
  emailCiphertext: Buffer;
  emailIv: Buffer;
  emailLookup: Buffer;
}

// Revoke every active token for an email. Callers mint a replacement right after
// (one active token per email — idx_api_tokens_active_email), so run it in the
// SAME transaction as the mint: that keeps the revoke+insert atomic. Under READ
// COMMITTED it does NOT make concurrent mints impossible — two near-simultaneous
// flows can still race the partial unique index and one insert may 500 — but the
// index guarantees at most one active token ever survives (integrity holds; the
// loser just errors and can retry). Pass a `tx` for the mint pairing; `db` is fine
// for the standalone DELETE (revoke) route.
export function revokeActiveTokens(conn: Conn, emailLookup: Buffer) {
  return conn
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.emailLookup, emailLookup), isNull(apiTokens.revokedAt)));
}

// The single active (non-revoked, unexpired) token for an email, or undefined.
// The partial unique index idx_api_tokens_active_email guarantees at most one,
// so findFirst is exact. Shared by the GET route and connect's already-active
// check so "what counts as active" stays a single definition.
export function findActiveToken(conn: Conn, emailLookup: Buffer) {
  return conn.query.apiTokens.findFirst({
    where: and(
      eq(apiTokens.emailLookup, emailLookup),
      isNull(apiTokens.revokedAt),
      gt(apiTokens.expiresAt, new Date()),
    ),
  });
}

// Mint a fresh token, returning the show-once plaintext + its serializable row.
// The caller MUST revokeActiveTokens(conn, …) first in the same `conn` — this
// insert alone would collide with any still-active token for the email.
export async function mintApiToken(
  conn: Conn,
  email: EmailColumns,
): Promise<{ token: string; row: typeof apiTokens.$inferSelect }> {
  const plaintext = API_TOKEN_PREFIX + nanoid(API_TOKEN_LENGTH);
  const expiresAt = new Date(Date.now() + API_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await conn
    .insert(apiTokens)
    .values({
      emailCiphertext: email.emailCiphertext,
      emailIv: email.emailIv,
      emailLookup: email.emailLookup,
      tokenHash: hashToken(plaintext),
      expiresAt,
    })
    .returning();
  return { token: plaintext, row };
}
