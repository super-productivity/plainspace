import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  activity,
  attachments,
  items,
  lists,
  members,
  panels,
  pollVotes,
  pushSubscriptions,
  scratchpads,
  timeslotResponses,
} from '../db/schema.js';
import { recordActivity } from './activity.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MemberRow = typeof members.$inferSelect;

// Absorb `from` (a duplicate guest member) into `into` (the canonical member
// that already owns the verified email), then delete `from`. Reassigns every
// member-owned reference and resolves the two uniqueness constraints that
// would otherwise block a blind UPDATE. Returns the up-to-date canonical row
// (its role/isCreator may have been raised). Must run inside a transaction.
export async function mergeMemberInto(
  tx: Tx,
  projectId: string,
  from: MemberRow,
  into: MemberRow,
): Promise<MemberRow> {
  // Plain ownership reassignments.
  await tx.update(items).set({ createdBy: into.id }).where(eq(items.createdBy, from.id));
  await tx.update(items).set({ checkedBy: into.id }).where(eq(items.checkedBy, from.id));
  await tx.update(items).set({ assignedTo: into.id }).where(eq(items.assignedTo, from.id));
  await tx.update(lists).set({ createdBy: into.id }).where(eq(lists.createdBy, from.id));
  await tx
    .update(scratchpads)
    .set({ createdBy: into.id })
    .where(eq(scratchpads.createdBy, from.id));
  await tx
    .update(scratchpads)
    .set({ updatedBy: into.id })
    .where(eq(scratchpads.updatedBy, from.id));
  await tx.update(panels).set({ createdBy: into.id }).where(eq(panels.createdBy, from.id));
  await tx
    .update(attachments)
    .set({ uploadedBy: into.id })
    .where(eq(attachments.uploadedBy, from.id));
  await tx
    .update(activity)
    .set({ memberId: into.id })
    .where(and(eq(activity.projectId, projectId), eq(activity.memberId, from.id)));

  // poll_votes is unique on (panelId, memberId): drop the guest's vote on any
  // panel the canonical member already voted on, then reassign the rest.
  const canonicalVotes = await tx.query.pollVotes.findMany({
    where: eq(pollVotes.memberId, into.id),
    columns: { panelId: true },
  });
  const votedPanelIds = canonicalVotes.map((v) => v.panelId);
  if (votedPanelIds.length > 0) {
    await tx
      .delete(pollVotes)
      .where(and(eq(pollVotes.memberId, from.id), inArray(pollVotes.panelId, votedPanelIds)));
  }
  await tx.update(pollVotes).set({ memberId: into.id }).where(eq(pollVotes.memberId, from.id));

  // timeslot_responses is unique on (panelId, memberId, slotId): TimeSlot is
  // multi-select, so dedupe per (panel, slot) the canonical member already
  // marked, then reassign the rest. Without this the guest's availability is
  // cascade-deleted with the member row below.
  const canonicalResponses = await tx.query.timeslotResponses.findMany({
    where: eq(timeslotResponses.memberId, into.id),
    columns: { panelId: true, slotId: true },
  });
  if (canonicalResponses.length > 0) {
    const taken = new Set(canonicalResponses.map((r) => `${r.panelId}:${r.slotId}`));
    const guestResponses = await tx.query.timeslotResponses.findMany({
      where: eq(timeslotResponses.memberId, from.id),
      columns: { id: true, panelId: true, slotId: true },
    });
    const collidingIds = guestResponses
      .filter((r) => taken.has(`${r.panelId}:${r.slotId}`))
      .map((r) => r.id);
    if (collidingIds.length > 0) {
      await tx.delete(timeslotResponses).where(inArray(timeslotResponses.id, collidingIds));
    }
  }
  await tx
    .update(timeslotResponses)
    .set({ memberId: into.id })
    .where(eq(timeslotResponses.memberId, from.id));

  // push_subscriptions PK is (memberId, endpoint). Just drop the guest's — the
  // merged browser re-subscribes after it reloads as the canonical member.
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.memberId, from.id));

  // Carry privilege over only if the guest record had more of it.
  const role = into.role === 'admin' || from.role === 'admin' ? 'admin' : into.role;
  const isCreator = into.isCreator || from.isCreator;
  let canonical = into;
  if (role !== into.role || isCreator !== into.isCreator) {
    [canonical] = await tx
      .update(members)
      .set({ role, isCreator })
      .where(eq(members.id, into.id))
      .returning();
  }

  await recordActivity(tx, {
    projectId,
    memberId: into.id,
    action: 'member.merged',
    targetType: 'member',
    targetId: into.id,
    meta: { fromDisplayName: from.displayName },
  });

  // Deleting the guest cascades its email_verifications (including the row the
  // caller just consumed) and leaves exactly one verified member for this
  // email, so idx_members_project_email_verified still holds.
  await tx.delete(members).where(and(eq(members.id, from.id), eq(members.projectId, projectId)));

  return canonical;
}
