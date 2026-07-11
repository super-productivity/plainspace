import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { MAX_ITEMS_PER_PROJECT } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { items, projects } from '../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Single source for the 422 body so the create, integration, and restore paths
// cannot drift apart.
export const ITEM_CAPACITY_ERROR = `A Space can have at most ${MAX_ITEMS_PER_PROJECT} active items`;

// Must be called inside the same transaction that adds an active item (create
// or restore). Locking the project row serializes all supported paths for that
// Space, so concurrent requests cannot both observe the final free slot.
export async function hasItemCapacity(tx: Tx, projectId: string): Promise<boolean> {
  await tx.execute(sql`SELECT 1 FROM ${projects} WHERE ${projects.id} = ${projectId} FOR UPDATE`);
  const [{ value }] = await tx
    .select({ value: count() })
    .from(items)
    .where(and(eq(items.projectId, projectId), isNull(items.deletedAt)));
  return value < MAX_ITEMS_PER_PROJECT;
}
