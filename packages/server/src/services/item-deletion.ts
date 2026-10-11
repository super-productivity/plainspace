import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ActivityEntry } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { activity, attachments, items } from '../db/schema.js';
import { recordActivity } from './activity.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Soft-deletes a live item and scrubs its content from the activity log (item
 * and attachment rows). Shared by the in-app and integration deletes.
 * `assignedTo` makes the delete conditional on the item still being assigned
 * to that member, so a concurrent reassign or claim wins. Returns null (and
 * writes nothing) when no live item matched.
 */
export async function softDeleteItem(
  tx: Tx,
  opts: { projectId: string; itemId: string; memberId: string; assignedTo?: string },
): Promise<ActivityEntry | null> {
  const { projectId, itemId, memberId, assignedTo } = opts;
  // Guarded update first: a miss must leave the activity log untouched.
  const [deleted] = await tx
    .update(items)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(items.id, itemId),
        eq(items.projectId, projectId),
        isNull(items.deletedAt),
        assignedTo ? eq(items.assignedTo, assignedTo) : undefined,
      ),
    )
    .returning({ id: items.id });
  if (!deleted) return null;

  await tx
    .update(activity)
    .set({ meta: {} })
    .where(
      and(
        eq(activity.projectId, projectId),
        eq(activity.targetType, 'item'),
        eq(activity.targetId, itemId),
      ),
    );

  // Attachment activity rows carry a copy of item.text in meta; scrub them
  // too so erasure of the item doesn't leave its content in the activity log.
  const itemAttachments = await tx.query.attachments.findMany({
    where: eq(attachments.itemId, itemId),
    columns: { id: true },
  });
  if (itemAttachments.length > 0) {
    await tx
      .update(activity)
      .set({ meta: {} })
      .where(
        and(
          eq(activity.projectId, projectId),
          eq(activity.targetType, 'attachment'),
          inArray(
            activity.targetId,
            itemAttachments.map((a) => a.id),
          ),
        ),
      );
  }

  return recordActivity(tx, {
    projectId,
    memberId,
    action: 'item.deleted',
    targetType: 'item',
    targetId: itemId,
    meta: {},
  });
}
