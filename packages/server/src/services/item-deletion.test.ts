import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity, items } from '../db/schema.js';
import { softDeleteItem } from './item-deletion.js';
import { addItem, addMember, createProject } from '../../test/helpers.js';

describe('softDeleteItem', () => {
  // The integration route pre-checks the assignee, so only this guard stops a
  // reassign that lands between that check and the delete.
  it('returns null and writes nothing when the item is no longer assigned to assignedTo', async () => {
    const { project, listId } = await createProject();
    const caller = await addMember(project.id);
    const other = await addMember(project.id);
    const item = await addItem(listId, project.id, { assignedTo: other.id });
    await db.insert(activity).values({
      projectId: project.id,
      memberId: other.id,
      action: 'item.created',
      targetType: 'item',
      targetId: item.id,
      meta: { text: 'Secret' },
    });

    const result = await db.transaction((tx) =>
      softDeleteItem(tx, {
        projectId: project.id,
        itemId: item.id,
        memberId: caller.id,
        assignedTo: caller.id,
      }),
    );

    expect(result).toBeNull();
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.deletedAt).toBeNull();
    const rows = await db.select().from(activity).where(eq(activity.targetId, item.id));
    expect(rows.map((r) => [r.action, r.meta])).toEqual([['item.created', { text: 'Secret' }]]);
  });
});
