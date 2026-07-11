import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity, dsaNotices, memberTokens } from '../db/schema.js';
import { runRetentionSweep } from './retention.js';
import { addMember, createProject } from '../../test/helpers.js';

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function addNotice(receivedAt: Date): Promise<string> {
  const [row] = await db
    .insert(dsaNotices)
    .values({
      contentLocation: 'https://example.com/item',
      category: 'other',
      reason: 'Test notice for retention sweep',
      goodFaithConfirmed: true,
      receivedAt,
    })
    .returning({ id: dsaNotices.id });
  return row.id;
}

describe('runRetentionSweep', () => {
  it('purges DSA notices older than 3 years and keeps newer ones', async () => {
    const now = new Date();
    const expiredId = await addNotice(daysAgo(3 * 365 + 1, now));
    const keptId = await addNotice(daysAgo(3 * 365 - 1, now));

    await runRetentionSweep(now);

    const remaining = await db.query.dsaNotices.findMany({
      where: inArray(dsaNotices.id, [expiredId, keptId]),
    });
    expect(remaining.map((n) => n.id)).toEqual([keptId]);
  });

  it('keeps member.removed enforcement records for 3 years, other activity for 365 days', async () => {
    const now = new Date();
    const { project } = await createProject();
    const entry = (action: string, ageDays: number): typeof activity.$inferInsert => ({
      projectId: project.id,
      action,
      targetType: 'member',
      targetId: randomUUID(),
      createdAt: daysAgo(ageDays, now),
    });
    const rows = await db
      .insert(activity)
      .values([
        entry('member.removed', 366), // past activity cutoff, inside DSA window → kept
        entry('member.removed', 3 * 365 + 1), // past DSA window → deleted
        entry('item.created', 366), // past activity cutoff → deleted
        entry('item.created', 1), // fresh → kept
      ])
      .returning({ id: activity.id });

    await runRetentionSweep(now);

    const remaining = await db.query.activity.findMany({
      where: inArray(
        activity.id,
        rows.map((r) => r.id),
      ),
    });
    expect(remaining.map((r) => r.id).sort()).toEqual([rows[0].id, rows[3].id].sort());
  });

  it('purges expired member sessions and keeps live ones', async () => {
    const now = new Date();
    const { project } = await createProject();
    // addMember inserts one live session (expires_at now()+7d); add an expired one.
    const member = await addMember(project.id);
    const expiredHash = randomBytes(32).toString('hex');
    await db.insert(memberTokens).values({
      tokenHash: expiredHash,
      memberId: member.id,
      expiresAt: daysAgo(1, now),
    });

    await runRetentionSweep(now);

    const remaining = await db.query.memberTokens.findMany({
      where: eq(memberTokens.memberId, member.id),
    });
    expect(remaining.every((t) => t.expiresAt > now)).toBe(true);
    expect(remaining.some((t) => t.tokenHash === expiredHash)).toBe(false);
    expect(remaining).toHaveLength(1);
  });
});
