import { and, eq, lt, ne, or, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  activity,
  apiTokens,
  creationVerifications,
  dsaNotices,
  emailVerifications,
  items,
  loginVerifications,
  memberTokens,
} from '../db/schema.js';
import { ADVISORY_LOCK, withAdvisoryLock } from '../lib/advisory-lock.js';

const ACTIVITY_RETENTION_DAYS = 365;
const DELETED_ITEM_RETENTION_DAYS = 30;
// DSA Art. 16 notices are kept as the legal record of our handling decision,
// then deleted. 3 years tracks the regular German limitation period (§ 195 BGB)
// within which a dispute over the decision could still arise.
const DSA_NOTICE_RETENTION_DAYS = 3 * 365;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function runRetentionSweep(now = new Date()): Promise<void> {
  const activityCutoff = daysAgo(ACTIVITY_RETENTION_DAYS, now);
  const deletedItemCutoff = daysAgo(DELETED_ITEM_RETENTION_DAYS, now);
  const dsaNoticeCutoff = daysAgo(DSA_NOTICE_RETENTION_DAYS, now);

  // Retention enforces the GDPR/DSA deletion deadlines, so it must finish a
  // large backlog delete rather than be killed by the request-oriented
  // statement_timeout (db/connection.ts) and re-attempt the same too-big
  // delete every day forever. Run in one transaction with that timeout lifted
  // for this connection only; the sweep is advisory-locked and daily, so an
  // uncapped background delete is safe. Deletes run serially because they share
  // the single transaction connection.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = 0`);

    // Attachments are disabled (see project CLAUDE.md): no S3 deletion to do,
    // so expired soft-deleted items go in one statement. (Re-enabling uploads
    // needs the row fetch back here to collect storagePath values first.)
    // Enforcement records (admin member removals) are the DSA Art. 17 audit
    // trail the operator "reads later"; keep them for the same 3-year window as
    // DSA notices (§ 195 BGB dispute period), not the 365-day activity default.
    // Known gap: activity cascades on project delete (schema.ts), so deleting
    // the Space erases its enforcement records early — tolerated pre-launch,
    // revisit with the content-removal SoR flow (project CLAUDE.md, DSA section).
    await tx
      .delete(activity)
      .where(
        or(
          and(lt(activity.createdAt, activityCutoff), ne(activity.action, 'member.removed')),
          and(eq(activity.action, 'member.removed'), lt(activity.createdAt, dsaNoticeCutoff)),
        ),
      );
    await tx
      .delete(items)
      .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, deletedItemCutoff)));
    await tx
      .delete(apiTokens)
      .where(or(lt(apiTokens.expiresAt, now), isNotNull(apiTokens.revokedAt)));
    // Expired sessions are dead the moment they lapse (sessionForToken filters
    // expires_at > now), but issueMemberToken only prunes a member's own expired
    // rows when *that* member signs in again — someone who logs in once and never
    // returns leaves a 7-day token row forever. Without this the table grows
    // unbounded and any raw count(*) over-reports who is "signed in".
    await tx.delete(memberTokens).where(lt(memberTokens.expiresAt, now));
    await tx
      .delete(emailVerifications)
      .where(or(lt(emailVerifications.expiresAt, now), isNotNull(emailVerifications.usedAt)));
    await tx
      .delete(creationVerifications)
      .where(or(lt(creationVerifications.expiresAt, now), isNotNull(creationVerifications.usedAt)));
    // request-login-code does an opportunistic sweep but only on traffic; if
    // recovery goes quiet, expired/used rows would persist indefinitely.
    await tx
      .delete(loginVerifications)
      .where(or(lt(loginVerifications.expiresAt, now), isNotNull(loginVerifications.usedAt)));
    await tx.delete(dsaNotices).where(lt(dsaNotices.receivedAt, dsaNoticeCutoff));
  });
}

export function startRetentionSweeper(): void {
  // Advisory-locked so a deploy-overlap second process can't run the
  // read-then-delete concurrently with this one.
  const run = (): Promise<void> =>
    withAdvisoryLock(ADVISORY_LOCK.retentionSweep, () => runRetentionSweep()).catch((err) => {
      console.error('Retention sweep failed', err);
    });

  void run();
  const interval = setInterval(() => void run(), SWEEP_INTERVAL_MS);
  interval.unref();
}
