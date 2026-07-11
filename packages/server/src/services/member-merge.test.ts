import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity, items, members, panels, pollVotes, timeslotResponses } from '../db/schema.js';
import { mergeMemberInto } from './member-merge.js';
import { addItem, addMember, createProject } from '../../test/helpers.js';

async function merge(projectId: string, fromId: string, intoId: string) {
  const from = await db.query.members.findFirst({ where: eq(members.id, fromId) });
  const into = await db.query.members.findFirst({ where: eq(members.id, intoId) });
  if (!from || !into) throw new Error('member missing');
  await db.transaction((tx) => mergeMemberInto(tx, projectId, from, into));
}

describe('mergeMemberInto', () => {
  it('reassigns ownership, deletes the guest, and logs the merge', async () => {
    const { project, listId } = await createProject();
    const canonical = await addMember(project.id, { email: 'dup@example.com' });
    const guest = await addMember(project.id, { displayName: 'Guest Dupe' });

    const item = await addItem(listId, project.id, { assignedTo: guest.id });
    await db
      .update(items)
      .set({ createdBy: guest.id, checkedBy: guest.id })
      .where(eq(items.id, item.id));
    await db.insert(activity).values({
      projectId: project.id,
      memberId: guest.id,
      action: 'item.created',
      targetType: 'item',
      targetId: item.id,
    });

    await merge(project.id, guest.id, canonical.id);

    // Guest is gone.
    const guestRow = await db.query.members.findFirst({ where: eq(members.id, guest.id) });
    expect(guestRow).toBeUndefined();

    // All references point at the canonical member.
    const itemRow = await db.query.items.findFirst({ where: eq(items.id, item.id) });
    expect(itemRow?.createdBy).toBe(canonical.id);
    expect(itemRow?.checkedBy).toBe(canonical.id);
    expect(itemRow?.assignedTo).toBe(canonical.id);

    const guestActivity = await db.query.activity.findMany({
      where: and(eq(activity.projectId, project.id), eq(activity.memberId, guest.id)),
    });
    expect(guestActivity).toHaveLength(0);

    const mergeEntry = await db.query.activity.findFirst({
      where: and(eq(activity.projectId, project.id), eq(activity.action, 'member.merged')),
    });
    expect(mergeEntry?.memberId).toBe(canonical.id);
    expect((mergeEntry?.meta as { fromDisplayName?: string })?.fromDisplayName).toBe('Guest Dupe');
  });

  it('drops the guest poll vote where the canonical already voted, and keeps the rest', async () => {
    const { project } = await createProject();
    const canonical = await addMember(project.id, { email: 'dup2@example.com' });
    const guest = await addMember(project.id);

    const [p1] = await db
      .insert(panels)
      .values({ projectId: project.id, type: 'poll' })
      .returning();
    const [p2] = await db
      .insert(panels)
      .values({ projectId: project.id, type: 'poll' })
      .returning();

    await db.insert(pollVotes).values([
      { panelId: p1.id, optionId: 'a', memberId: canonical.id },
      { panelId: p1.id, optionId: 'b', memberId: guest.id },
      { panelId: p2.id, optionId: 'c', memberId: guest.id },
    ]);

    await merge(project.id, guest.id, canonical.id);

    const p1Votes = await db.query.pollVotes.findMany({ where: eq(pollVotes.panelId, p1.id) });
    expect(p1Votes).toHaveLength(1);
    expect(p1Votes[0].memberId).toBe(canonical.id);
    expect(p1Votes[0].optionId).toBe('a'); // canonical's original vote survived

    const p2Votes = await db.query.pollVotes.findMany({ where: eq(pollVotes.panelId, p2.id) });
    expect(p2Votes).toHaveLength(1);
    expect(p2Votes[0].memberId).toBe(canonical.id); // reassigned
  });

  it('keeps the guest timeslot responses, deduping slots the canonical already marked', async () => {
    const { project } = await createProject();
    const canonical = await addMember(project.id, { email: 'dup4@example.com' });
    const guest = await addMember(project.id);

    const [panel] = await db
      .insert(panels)
      .values({ projectId: project.id, type: 'timeslot' })
      .returning();

    const [canonicalSlot1] = await db
      .insert(timeslotResponses)
      .values([
        // Overlap on slot-1: canonical already marked it, guest's must be dropped.
        { panelId: panel.id, slotId: 'slot-1', memberId: canonical.id },
        { panelId: panel.id, slotId: 'slot-1', memberId: guest.id },
        // Unique to the guest: must survive as the canonical member's.
        { panelId: panel.id, slotId: 'slot-2', memberId: guest.id },
      ])
      .returning();

    await merge(project.id, guest.id, canonical.id);

    const rows = await db.query.timeslotResponses.findMany({
      where: eq(timeslotResponses.panelId, panel.id),
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.memberId === canonical.id)).toBe(true);
    expect(rows.map((r) => r.slotId).sort()).toEqual(['slot-1', 'slot-2']);
    // The canonical's own slot-1 row survived; the guest's duplicate was the
    // one dropped (not the other way around).
    expect(rows.some((r) => r.id === canonicalSlot1.id)).toBe(true);
  });

  it('carries privilege up to the canonical member when the guest had more', async () => {
    const { project } = await createProject();
    const canonical = await addMember(project.id, { email: 'dup3@example.com' });
    const guest = await addMember(project.id);
    await db
      .update(members)
      .set({ isCreator: true, role: 'admin' })
      .where(eq(members.id, guest.id));

    await merge(project.id, guest.id, canonical.id);

    const canonicalRow = await db.query.members.findFirst({ where: eq(members.id, canonical.id) });
    expect(canonicalRow?.isCreator).toBe(true);
    expect(canonicalRow?.role).toBe('admin');
  });
});
