import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity } from '../db/schema.js';
import { serializeRecordedActivity } from '../lib/serialize.js';
import type { ActivityAction, ActivityEntry } from '@plainspace/shared';

interface RecordActivityParams {
  projectId: string;
  memberId: string;
  action: ActivityAction;
  targetType: string;
  targetId: string;
  meta?: Record<string, unknown>;
  // When a matching (project, member, action, target) entry exists within this
  // window, bump its createdAt + meta in place instead of inserting a new row.
  // Keeps the feed readable for high-frequency actions like scratchpad edits.
  coalesceWithinMs?: number;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Inserts an activity row and returns the serialized entry. The connection
// argument may be the global db or a transaction tx. The caller is
// responsible for broadcasting the resulting entry over SSE (typically AFTER
// the transaction commits).
export async function recordActivity(
  conn: typeof db | Tx,
  params: RecordActivityParams,
): Promise<ActivityEntry> {
  if (params.coalesceWithinMs && params.coalesceWithinMs > 0) {
    const since = new Date(Date.now() - params.coalesceWithinMs);
    const recent = await conn.query.activity.findFirst({
      where: and(
        eq(activity.projectId, params.projectId),
        eq(activity.memberId, params.memberId),
        eq(activity.action, params.action),
        eq(activity.targetId, params.targetId),
        gte(activity.createdAt, since),
      ),
      orderBy: [desc(activity.createdAt)],
    });
    if (recent) {
      const [updated] = await conn
        .update(activity)
        .set({ meta: params.meta ?? {}, createdAt: new Date() })
        .where(eq(activity.id, recent.id))
        .returning();
      return serializeRecordedActivity(updated);
    }
  }

  const [entry] = await conn
    .insert(activity)
    .values({
      projectId: params.projectId,
      memberId: params.memberId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      meta: params.meta ?? {},
    })
    .returning();

  return serializeRecordedActivity(entry);
}
