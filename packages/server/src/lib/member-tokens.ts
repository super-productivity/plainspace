import { and, desc, eq, gt, lte, ne, notInArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TOKEN_LENGTH } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { members, memberTokens } from '../db/schema.js';
import { hashToken } from './crypto.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MEMBER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The fixed lifetime bounds a copied token's usefulness without adding a DB
// write to every authenticated request. This cap separately bounds concurrent
// devices; minting session 11 retires the oldest still-live one.
const MAX_SESSIONS_PER_MEMBER = 10;

// Issue a fresh bearer token as a NEW session for a member and return the
// plaintext to hand back to the caller. Additive by design: existing sessions
// on other devices keep working (see the member_tokens schema comment), so
// signing in or recovering on one device never logs the others out.
export async function issueMemberToken(conn: typeof db | Tx, memberId: string): Promise<string> {
  const token = nanoid(TOKEN_LENGTH);
  const tokenHash = hashToken(token);
  const now = new Date();
  await conn
    .delete(memberTokens)
    .where(and(eq(memberTokens.memberId, memberId), lte(memberTokens.expiresAt, now)));
  await conn.insert(memberTokens).values({
    tokenHash,
    memberId,
    expiresAt: new Date(now.getTime() + MEMBER_SESSION_TTL_MS),
  });

  const newest = conn
    .select({ tokenHash: memberTokens.tokenHash })
    .from(memberTokens)
    .where(eq(memberTokens.memberId, memberId))
    .orderBy(desc(memberTokens.createdAt))
    .limit(MAX_SESSIONS_PER_MEMBER);
  // The extra ne() guard makes "never prune the token being returned" a hard
  // invariant: a created_at tie at the cap boundary (concurrent issuance)
  // could otherwise nondeterministically evict the fresh token and hand the
  // caller a session that no longer authenticates.
  await conn
    .delete(memberTokens)
    .where(
      and(
        eq(memberTokens.memberId, memberId),
        ne(memberTokens.tokenHash, tokenHash),
        notInArray(memberTokens.tokenHash, newest),
      ),
    );

  return token;
}

export type MemberSession = {
  member: typeof members.$inferSelect;
  tokenHash: string;
  expiresAt: Date;
};

// Resolve a live bearer session in one indexed join. Returning the expiry lets
// long-lived transports enforce the same boundary after their opening request.
export async function sessionForToken(token: string): Promise<MemberSession | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ member: members, expiresAt: memberTokens.expiresAt })
    .from(memberTokens)
    .innerJoin(members, eq(members.id, memberTokens.memberId))
    .where(and(eq(memberTokens.tokenHash, tokenHash), gt(memberTokens.expiresAt, new Date())))
    .limit(1);
  return row ? { member: row.member, tokenHash, expiresAt: row.expiresAt } : null;
}

// Proof-token callers need only the member, while request authentication uses
// sessionForToken directly for lifecycle metadata.
export async function memberForToken(token: string): Promise<typeof members.$inferSelect | null> {
  return (await sessionForToken(token))?.member ?? null;
}

// True if a session with this hash is still live (present and unexpired). SSE
// registration re-checks this after joining the manager to close the race where
// a logout revokes the token between authMiddleware and manager registration.
export async function isSessionLive(tokenHash: string): Promise<boolean> {
  const [row] = await db
    .select({ tokenHash: memberTokens.tokenHash })
    .from(memberTokens)
    .where(and(eq(memberTokens.tokenHash, tokenHash), gt(memberTokens.expiresAt, new Date())))
    .limit(1);
  return row !== undefined;
}

export async function revokeMemberToken(tokenHash: string, memberId: string): Promise<void> {
  await db
    .delete(memberTokens)
    .where(and(eq(memberTokens.tokenHash, tokenHash), eq(memberTokens.memberId, memberId)));
}
