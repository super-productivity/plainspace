import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity, apiTokens, loginVerifications, members } from '../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;
type MemberRow = typeof members.$inferSelect;

// apiTokens are keyed by email and shared across Spaces (no projectId FK), so
// the projects ON DELETE CASCADE can't reach them. Before a Space is deleted,
// purge the tokens of any member whose ONLY verified membership was this Space
// — the bulk analogue of the per-member orphan check in
// deleteMemberAndScrubIdentifiers. Call this while the Space's member rows
// still exist (so "verified elsewhere" can be evaluated).
export async function scrubOrphanedApiTokensForProject(
  conn: DbOrTx,
  projectId: string,
): Promise<void> {
  const verifiedHere = await conn
    .select({ lookup: members.emailLookup })
    .from(members)
    .where(
      and(
        eq(members.projectId, projectId),
        eq(members.emailVerified, true),
        isNotNull(members.emailLookup),
      ),
    );
  const lookups = verifiedHere.map((r) => r.lookup).filter((l): l is Buffer => l !== null);
  if (lookups.length === 0) return;

  const verifiedElsewhere = await conn
    .select({ lookup: members.emailLookup })
    .from(members)
    .where(
      and(
        ne(members.projectId, projectId),
        eq(members.emailVerified, true),
        inArray(members.emailLookup, lookups),
      ),
    );
  // bytea compares byte-wise; hex strings give a cheap Set membership key.
  const keep = new Set(verifiedElsewhere.map((r) => r.lookup?.toString('hex')));
  const orphaned = lookups.filter((l) => !keep.has(l.toString('hex')));
  if (orphaned.length === 0) return;

  await conn.delete(apiTokens).where(inArray(apiTokens.emailLookup, orphaned));
}

export async function deleteMemberAndScrubIdentifiers(
  conn: DbOrTx,
  projectId: string,
  member: MemberRow,
): Promise<void> {
  await conn
    .update(activity)
    .set({
      meta: sql`(${activity.meta} - 'displayName' - 'oldDisplayName' - 'fromDisplayName')`,
    })
    .where(and(eq(activity.projectId, projectId), eq(activity.memberId, member.id)));

  if (member.emailLookup) {
    await conn
      .delete(loginVerifications)
      .where(
        and(
          eq(loginVerifications.projectId, projectId),
          eq(loginVerifications.emailLookup, member.emailLookup),
        ),
      );
  }

  if (member.emailLookup && member.emailVerified) {
    const remainingVerifiedMember = await conn.query.members.findFirst({
      where: and(
        eq(members.emailLookup, member.emailLookup),
        eq(members.emailVerified, true),
        ne(members.id, member.id),
      ),
    });

    if (!remainingVerifiedMember) {
      await conn.delete(apiTokens).where(eq(apiTokens.emailLookup, member.emailLookup));
    }
  }

  await conn
    .delete(members)
    .where(and(eq(members.id, member.id), eq(members.projectId, projectId)));
}
