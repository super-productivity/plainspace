// One-off GDPR erasure by email. Dry-run by default; pass --yes to delete.
//   tsx packages/server/src/scripts/erase-email.ts someone@example.com [--yes]
import { eq, sql } from 'drizzle-orm';
import { db, pgClient } from '../db/connection.js';
import {
  apiTokens,
  creationVerifications,
  dsaNotices,
  emailVerifications,
  loginVerifications,
  members,
  projects,
} from '../db/schema.js';
import { emailIndex } from '../lib/email-crypto.js';
import {
  deleteMemberAndScrubIdentifiers,
  scrubOrphanedApiTokensForProject,
} from '../services/member-deletion.js';

const email = process.argv[2];
const apply = process.argv.includes('--yes');
if (!email?.includes('@')) throw new Error('usage: erase-email.ts <email> [--yes]');
const lookup = emailIndex(email);

const rows = await db
  .select({ member: members, slug: projects.slug, name: projects.name })
  .from(members)
  .innerJoin(projects, eq(projects.id, members.projectId))
  .where(eq(members.emailLookup, lookup));

const memberCount = async (projectId: string) =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(eq(members.projectId, projectId))
  )[0].n;

for (const { member, slug, name } of rows) {
  const others = (await memberCount(member.projectId)) - 1;
  // Creator of a Space others still use: deleting it would wipe their data too.
  const action = !member.isCreator
    ? 'remove membership'
    : others === 0
      ? 'DELETE SPACE (sole member)'
      : `SKIP: creator, ${others} other member(s) — decide manually`;
  console.log(`${slug}  "${name}"  member=${member.displayName}  -> ${action}`);
  if (!apply || action.startsWith('SKIP')) continue;
  await db.transaction(async (tx) => {
    if (member.isCreator) {
      await scrubOrphanedApiTokensForProject(tx, member.projectId);
      await tx.delete(projects).where(eq(projects.id, member.projectId));
    } else {
      await deleteMemberAndScrubIdentifiers(tx, member.projectId, member);
    }
  });
}

// Email-keyed rows not tied to a membership (pending codes, API tokens).
const looseTables = {
  api_tokens: apiTokens,
  creation_verifications: creationVerifications,
  login_verifications: loginVerifications,
  email_verifications: emailVerifications,
};
for (const [label, t] of Object.entries(looseTables)) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(eq(t.emailLookup, lookup));
  console.log(`${n} leftover row(s) in ${label}`);
  if (apply && n > 0) await db.delete(t).where(eq(t.emailLookup, lookup));
}

// DSA notices are a legal record of a moderation decision — report, never auto-delete.
const [{ n: notices }] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(dsaNotices)
  .where(eq(dsaNotices.submitterEmailLookup, lookup));
console.log(`${notices} DSA notice(s) submitted by this email (kept)`);
console.log(apply ? 'Done.' : 'Dry run — nothing deleted. Re-run with --yes to apply.');
await pgClient.end();
