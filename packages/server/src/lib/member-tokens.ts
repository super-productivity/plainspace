import { and, desc, eq, gt, lte, ne, notInArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TOKEN_LENGTH } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { members, memberTokens } from '../db/schema.js';
import { hashToken } from './crypto.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The upper bound on how long a session stays valid after its last use — an
// idle window, not a fixed lifetime (see sessionForToken). Renewal only fires
// past the halfway mark, so the guarantee is a ceiling, not a floor: a session
// last used early in its window lapses sooner than a full TTL later. A copied
// token therefore dies within this long of the thief's last request, while
// someone who keeps showing up never has to ask for another email code.
export const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The hard ceiling sliding cannot cross: no session outlives this much time
// from its issuance, however continuously it is used. Without it a stolen
// token that the thief keeps exercising never expires at all, and there is no
// "sign out everywhere" control to fall back on — so this is what bounds a
// compromise the member never notices. Costs an active member four emailed
// codes a year.
export const MEMBER_SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// This cap bounds concurrent devices; minting session 11 retires the oldest
// still-live one.
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

  // Keep by expires_at, not created_at: now that sessions slide, expires_at
  // tracks last use while created_at only records first sign-in. Ordering by
  // age would retire the daily-driver device a member signed in on months ago
  // and keep a phone they touched once.
  const freshest = conn
    .select({ tokenHash: memberTokens.tokenHash })
    .from(memberTokens)
    .where(eq(memberTokens.memberId, memberId))
    .orderBy(desc(memberTokens.expiresAt))
    .limit(MAX_SESSIONS_PER_MEMBER);
  // The extra ne() guard makes "never prune the token being returned" a hard
  // invariant: an expires_at tie at the cap boundary (concurrent issuance)
  // could otherwise nondeterministically evict the fresh token and hand the
  // caller a session that no longer authenticates.
  await conn
    .delete(memberTokens)
    .where(
      and(
        eq(memberTokens.memberId, memberId),
        ne(memberTokens.tokenHash, tokenHash),
        notInArray(memberTokens.tokenHash, freshest),
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
//
// Sessions slide: a request landing in the second half of the window pushes the
// expiry out to a full TTL again, so an active member never re-authenticates
// until the MAX_AGE ceiling stops the sliding for good. Renewing only past the
// halfway mark is what keeps authentication read-only in the common case — at
// most one write per session per half-window, not one per request.
//
// The ceiling is enforced on read, by created_at, rather than left to emerge
// from the capped write below: a bound that holds only because no older code
// path ever wrote the row is not a bound worth relying on for revocation.
// Capping the write too keeps expires_at honest, so the retention sweep and the
// "live sessions" count don't treat an aged-out row as usable. The
// `next > expiresAt` guard then matters for more than tidiness: a session
// pinned at its ceiling sits permanently inside the halfway window, and without
// it every request would rewrite the same timestamp — exactly the per-request
// write the threshold exists to avoid.
export async function sessionForToken(token: string): Promise<MemberSession | null> {
  const tokenHash = hashToken(token);
  const now = new Date();
  const issuedAfter = new Date(now.getTime() - MEMBER_SESSION_MAX_AGE_MS);
  const [row] = await db
    .select({
      member: members,
      expiresAt: memberTokens.expiresAt,
      createdAt: memberTokens.createdAt,
    })
    .from(memberTokens)
    .innerJoin(members, eq(members.id, memberTokens.memberId))
    .where(
      and(
        eq(memberTokens.tokenHash, tokenHash),
        gt(memberTokens.expiresAt, now),
        gt(memberTokens.createdAt, issuedAfter),
      ),
    )
    .limit(1);
  if (!row) return null;

  let expiresAt = row.expiresAt;
  const next = Math.min(
    now.getTime() + MEMBER_SESSION_TTL_MS,
    row.createdAt.getTime() + MEMBER_SESSION_MAX_AGE_MS,
  );
  if (
    next > expiresAt.getTime() &&
    expiresAt.getTime() - now.getTime() < MEMBER_SESSION_TTL_MS / 2
  ) {
    expiresAt = new Date(next);
    await db.update(memberTokens).set({ expiresAt }).where(eq(memberTokens.tokenHash, tokenHash));
  }
  return { member: row.member, tokenHash, expiresAt };
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
