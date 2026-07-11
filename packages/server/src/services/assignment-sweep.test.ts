import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// Mock web-push before importing the sweep so its module-level import resolves
// to the mock (mirrors reminder-sweep.test.ts).
vi.mock('web-push', () => {
  class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    default: {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn().mockResolvedValue(undefined),
    },
    WebPushError,
  };
});

// VAPID env must be set before configureWebPush() runs.
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

import webpush from 'web-push';
import { db } from '../db/connection.js';
import { assignmentNotifications, pushSubscriptions } from '../db/schema.js';
import { configureWebPush, runAssignmentSweep } from './reminder-sweep.js';
import { addItem, addMember, createProject } from '../../test/helpers.js';

const sendNotification = vi.mocked(webpush.sendNotification);

beforeAll(() => {
  configureWebPush();
});

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined as never);
});

async function addPushSub(memberId: string): Promise<void> {
  await db.insert(pushSubscriptions).values({
    memberId,
    endpoint: `https://fcm.googleapis.com/fcm/send/${memberId}`,
    p256dh: 'p256dh-stub',
    auth: 'auth-stub',
  });
}

const MINUTE = 60_000;

async function enqueue(memberId: string, itemId: string, assignedAt: Date): Promise<void> {
  await db.insert(assignmentNotifications).values({ memberId, itemId, assignedAt });
}

describe('runAssignmentSweep', () => {
  it('does not flush a batch that is still within the quiet window', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const item = await addItem(listId, project.id, { assignedTo: member.id });
    await enqueue(member.id, item.id, new Date(Date.now() - MINUTE)); // 1 min ago

    await runAssignmentSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    const rows = await db.select().from(assignmentNotifications);
    expect(rows).toHaveLength(1); // still queued
  });

  it('flushes a settled single-item batch as a deep-linkable assignment push', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const item = await addItem(listId, project.id, { assignedTo: member.id, text: 'Buy milk' });
    await enqueue(member.id, item.id, new Date(Date.now() - 6 * MINUTE)); // settled

    await runAssignmentSweep();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [, payload] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual({
      type: 'assignment',
      projectSlug: project.slug,
      projectName: project.name,
      count: 1,
      itemId: item.id,
      text: 'Buy milk',
    });
    // Claimed rows are deleted so they can't re-fire.
    expect(await db.select().from(assignmentNotifications)).toHaveLength(0);
  });

  it('coalesces a multi-item batch into one count-only push', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const a = await addItem(listId, project.id, { assignedTo: member.id });
    const b = await addItem(listId, project.id, { assignedTo: member.id });
    await enqueue(member.id, a.id, new Date(Date.now() - 7 * MINUTE));
    await enqueue(member.id, b.id, new Date(Date.now() - 6 * MINUTE));

    await runAssignmentSweep();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [, payload] = sendNotification.mock.calls[0];
    const parsed = JSON.parse(payload as string);
    expect(parsed.count).toBe(2);
    expect(parsed.itemId).toBeUndefined(); // board-link, not item-link
  });

  it('drops queued items that were reassigned away or checked before flush', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    const other = await addMember(project.id);
    await addPushSub(member.id);
    // Queued for `member`, but the live item is now assigned to someone else.
    const reassigned = await addItem(listId, project.id, { assignedTo: other.id });
    const checked = await addItem(listId, project.id, { assignedTo: member.id, checked: true });
    await enqueue(member.id, reassigned.id, new Date(Date.now() - 6 * MINUTE));
    await enqueue(member.id, checked.id, new Date(Date.now() - 6 * MINUTE));

    await runAssignmentSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(await db.select().from(assignmentNotifications)).toHaveLength(0); // claimed + discarded
  });

  it('flushes once the oldest assignment passes the max-wait cap even while new ones keep arriving', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const old = await addItem(listId, project.id, { assignedTo: member.id });
    const fresh = await addItem(listId, project.id, { assignedTo: member.id });
    // Oldest is past the 30-min cap; newest is fresh (would block on quiet
    // alone), so only the cap can release this batch.
    await enqueue(member.id, old.id, new Date(Date.now() - 31 * MINUTE));
    await enqueue(member.id, fresh.id, new Date(Date.now() - 10_000));

    await runAssignmentSweep();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(await db.select().from(assignmentNotifications)).toHaveLength(0);
  });

  it('holds a batch just inside the quiet window, releases it just past', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const item = await addItem(listId, project.id, { assignedTo: member.id });

    // 10s inside the 5-min quiet window — not yet settled.
    await enqueue(member.id, item.id, new Date(Date.now() - (5 * MINUTE - 10_000)));
    await runAssignmentSweep();
    expect(sendNotification).not.toHaveBeenCalled();

    // Nudge it 10s past the window — now settled.
    await db
      .update(assignmentNotifications)
      .set({ assignedAt: new Date(Date.now() - (5 * MINUTE + 10_000)) })
      .where(eq(assignmentNotifications.memberId, member.id));
    await runAssignmentSweep();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('releases a batch via the 30-min cap even while its newest item is fresh', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const oldItem = await addItem(listId, project.id, { assignedTo: member.id });
    const freshItem = await addItem(listId, project.id, { assignedTo: member.id });

    // Oldest 10s inside the cap, newest fresh ⇒ neither quiet nor cap releases.
    await enqueue(member.id, oldItem.id, new Date(Date.now() - (30 * MINUTE - 10_000)));
    await enqueue(member.id, freshItem.id, new Date(Date.now() - 5_000));
    await runAssignmentSweep();
    expect(sendNotification).not.toHaveBeenCalled();

    // Push the oldest 10s past the cap ⇒ releases despite the fresh newest.
    await db
      .update(assignmentNotifications)
      .set({ assignedAt: new Date(Date.now() - (30 * MINUTE + 10_000)) })
      .where(eq(assignmentNotifications.itemId, oldItem.id));
    await runAssignmentSweep();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('drops queued items that were soft-deleted before flush', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const item = await addItem(listId, project.id, {
      assignedTo: member.id,
      deletedAt: new Date(),
    });
    await enqueue(member.id, item.id, new Date(Date.now() - 6 * MINUTE));

    await runAssignmentSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(await db.select().from(assignmentNotifications)).toHaveLength(0);
  });

  it('flushes each member independently in one sweep', async () => {
    const { project, listId } = await createProject();
    const settled = await addMember(project.id);
    const pending = await addMember(project.id);
    await addPushSub(settled.id);
    await addPushSub(pending.id);
    const a = await addItem(listId, project.id, { assignedTo: settled.id });
    const b = await addItem(listId, project.id, { assignedTo: settled.id });
    const c = await addItem(listId, project.id, { assignedTo: pending.id });
    await enqueue(settled.id, a.id, new Date(Date.now() - 6 * MINUTE));
    await enqueue(settled.id, b.id, new Date(Date.now() - 6 * MINUTE));
    await enqueue(pending.id, c.id, new Date(Date.now() - MINUTE)); // still in quiet window

    await runAssignmentSweep();

    // Only the settled member is notified; the pending member's row survives.
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [sub] = sendNotification.mock.calls[0];
    expect((sub as { endpoint: string }).endpoint).toContain(settled.id);
    const remaining = await db.select().from(assignmentNotifications);
    expect(remaining.map((r) => r.memberId)).toEqual([pending.id]);
  });

  it('claims a settled batch even when the member has no push subscription', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id); // no push sub
    const item = await addItem(listId, project.id, { assignedTo: member.id });
    await enqueue(member.id, item.id, new Date(Date.now() - 6 * MINUTE));

    await runAssignmentSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    // Push-only: nothing to deliver, and the claim already consumed the row so
    // it doesn't pile up forever.
    expect(await db.select().from(assignmentNotifications)).toHaveLength(0);
  });
});
