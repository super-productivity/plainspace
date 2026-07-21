import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, isNotNull } from 'drizzle-orm';

// Mock web-push and the email sender before importing the sweep so the
// sweep's module-level imports resolve to the mocks. Both factories return
// vitest spies; tests reach them via the mocked-module `vi.mocked(...)`.
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

vi.mock('./email.js', () => ({
  sendReminderEmail: vi.fn().mockResolvedValue(undefined),
}));

// VAPID env must be set before configureWebPush() runs.
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

import webpush from 'web-push';
import type { RepeatRule } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { items, pushSubscriptions } from '../db/schema.js';
import { sendReminderEmail } from './email.js';
import { configureWebPush, runReminderSweep } from './reminder-sweep.js';
import { addItem, addMember, createProject } from '../../test/helpers.js';

const sendNotification = vi.mocked(webpush.sendNotification);
const sendEmail = vi.mocked(sendReminderEmail);

beforeAll(() => {
  configureWebPush();
});

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined as never);
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
});

async function addPushSub(
  memberId: string,
  endpoint = `https://fcm.googleapis.com/fcm/send/${memberId}`,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ memberId, endpoint, p256dh: 'p256dh-stub', auth: 'auth-stub' });
}

describe('runReminderSweep', () => {
  it('claims due reminders, fires push, and keeps remind_at for the overdue read', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);

    const past = new Date(Date.now() - 60_000);
    const item = await addItem(listId, project.id, { remindAt: past, assignedTo: member.id });

    await runReminderSweep();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [, payload] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual({
      type: 'reminder',
      projectSlug: project.slug,
      projectName: project.name,
      itemId: item.id,
      text: 'Item',
      recurring: false,
    });

    // The fire no longer consumes remind_at: the row keeps it (and so keeps
    // reading as overdue) and is claimed by the notified_at stamp instead.
    const [updated] = await db.select().from(items).where(eq(items.id, item.id));
    expect(updated.remindAt?.getTime()).toBe(past.getTime());
    expect(updated.notifiedAt).not.toBeNull();
  });

  it('does not re-fire on the next tick (atomic claim)', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep();
    await runReminderSweep();

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('leaves future reminders alone', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const future = new Date(Date.now() + 60_000);
    const item = await addItem(listId, project.id, { remindAt: future, assignedTo: member.id });

    await runReminderSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt).not.toBeNull();
  });

  it('skips soft-deleted items', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const item = await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      deletedAt: new Date(),
    });

    await runReminderSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    // remind_at preserved on soft-deleted rows so restoring re-arms the reminder.
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt).not.toBeNull();
  });

  it('fires once after restore-after-fire-time', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const past = new Date(Date.now() - 60_000);
    const item = await addItem(listId, project.id, {
      remindAt: past,
      assignedTo: member.id,
      deletedAt: new Date(),
    });

    // First sweep: soft-deleted, no fire.
    await runReminderSweep();
    expect(sendNotification).toHaveBeenCalledTimes(0);

    // Restore the item, then sweep again.
    await db.update(items).set({ deletedAt: null }).where(eq(items.id, item.id));
    await runReminderSweep();
    expect(sendNotification).toHaveBeenCalledTimes(1);

    // A second sweep should NOT re-fire — the claim stamped notified_at.
    await runReminderSweep();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('drops the subscription row on 410 Gone from the push service', async () => {
    const { WebPushError } = await import('web-push');
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    const endpoint = `https://fcm.googleapis.com/fcm/send/${member.id}-gone`;
    await addPushSub(member.id, endpoint);

    sendNotification.mockRejectedValueOnce(
      new WebPushError('gone', 410, {}, '', 'https://fcm.googleapis.com/fcm/send/x'),
    );

    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep();

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, member.id));
    expect(rows).toHaveLength(0);
  });

  it('keeps the subscription on other push errors (e.g. transient 5xx)', async () => {
    const { WebPushError } = await import('web-push');
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);

    sendNotification.mockRejectedValueOnce(
      new WebPushError(
        'temporarily unavailable',
        503,
        {},
        '',
        'https://fcm.googleapis.com/fcm/send/x',
      ),
    );

    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep();

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, member.id));
    expect(rows).toHaveLength(1);
  });

  it('does not resolve an assigned member outside the item project', async () => {
    const { project, listId } = await createProject('Project A');
    const { project: otherProject } = await createProject('Project B');
    const otherMember = await addMember(otherProject.id);
    await addPushSub(otherMember.id);

    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: otherMember.id,
    });

    await runReminderSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to email when the assignee has no push subscription', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id, { email: 'alice@example.com' });
    const item = await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      text: 'buy milk',
    });

    await runReminderSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [arg] = sendEmail.mock.calls[0];
    expect(arg).toMatchObject({
      toEmail: 'alice@example.com',
      itemText: 'buy milk',
      projectName: project.name,
    });
    expect(arg.itemUrl).toContain(project.slug);
    expect(arg.itemUrl).toContain(item.id);
  });

  it('falls back to email when all push deliveries for a member fail', async () => {
    const { WebPushError } = await import('web-push');
    const { project, listId } = await createProject();
    const member = await addMember(project.id, { email: 'alice@example.com' });
    await addPushSub(member.id);
    await addPushSub(member.id, `https://fcm.googleapis.com/fcm/send/${member.id}-device-2`);

    sendNotification.mockRejectedValue(
      new WebPushError(
        'temporarily unavailable',
        503,
        {},
        '',
        'https://fcm.googleapis.com/fcm/send/x',
      ),
    );

    const item = await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      text: 'buy milk',
    });

    await runReminderSweep();

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      toEmail: 'alice@example.com',
      itemText: 'buy milk',
      projectName: project.name,
    });
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt).not.toBeNull();
    expect(row.notifiedAt).not.toBeNull();
  });

  it('falls back to email after removing stale push subscriptions', async () => {
    const { WebPushError } = await import('web-push');
    const { project, listId } = await createProject();
    const member = await addMember(project.id, { email: 'alice@example.com' });
    await addPushSub(member.id, `https://fcm.googleapis.com/fcm/send/${member.id}-gone`);

    sendNotification.mockRejectedValueOnce(
      new WebPushError('gone', 410, {}, '', 'https://fcm.googleapis.com/fcm/send/x'),
    );

    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep();

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, member.id));
    expect(rows).toHaveLength(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('retries next tick when push and email fallback both fail transiently', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const { WebPushError } = await import('web-push');
    const { project, listId } = await createProject();
    const member = await addMember(project.id, { email: 'alice@example.com' });
    await addPushSub(member.id);

    sendNotification.mockRejectedValueOnce(
      new WebPushError(
        'temporarily unavailable',
        503,
        {},
        '',
        'https://fcm.googleapis.com/fcm/send/x',
      ),
    );
    sendEmail.mockRejectedValueOnce(new Error('smtp unavailable'));

    const item = await addItem(listId, project.id, {
      remindAt: new Date(now.getTime() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep(now);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    // remind_at is the reminder itself now, so a failed delivery must not move
    // it. The retry is re-armed by clearing notified_at: the next tick re-claims
    // this same row and tries again.
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt?.getTime()).toBe(item.remindAt!.getTime());
    expect(row.notifiedAt).toBeNull();

    sendEmail.mockClear();
    await runReminderSweep(new Date(now.getTime() + 60_000));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('skips email fallback for display-name-only members (no email on file)', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id, { email: null });
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('unassigned items target every member in the project', async () => {
    const { project, listId } = await createProject();
    const m1 = await addMember(project.id);
    await addMember(project.id, { email: 'b@example.com' });
    await addPushSub(m1.id);
    // The second member has no push sub → should get the email fallback instead.

    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: null,
    });

    await runReminderSweep();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].toEmail).toBe('b@example.com');
  });

  it('per-member push fan-out: one member with two devices gets one push each', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id, `https://fcm.googleapis.com/fcm/send/${member.id}-device-1`);
    await addPushSub(member.id, `https://fcm.googleapis.com/fcm/send/${member.id}-device-2`);

    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep();

    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it('payload carries item text so the SW can render it without an extra round-trip', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      text: 'buy milk',
    });

    await runReminderSweep();

    const [, payload] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload as string).text).toBe('buy milk');
  });

  it('leaves item text untouched at the 200-codepoint boundary', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const exact = 'x'.repeat(200);
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      text: exact,
    });

    await runReminderSweep();

    const [, payload] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload as string).text).toBe(exact);
  });

  it('truncates at 201 codepoints and appends an ellipsis', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      text: 'x'.repeat(201),
    });

    await runReminderSweep();

    const [, payload] = sendNotification.mock.calls[0];
    const parsed = JSON.parse(payload as string);
    expect(parsed.text).toBe(`${'x'.repeat(199)}…`);
    expect([...parsed.text]).toHaveLength(200);
  });

  it('does not split surrogate pairs when truncating astral code points', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    // 250 grinning-face emoji — each is a surrogate pair in UTF-16. A naive
    // .slice(0, 199) would chop the 100th emoji in half and emit a lone
    // surrogate in the JSON.
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      text: '😀'.repeat(250),
    });

    await runReminderSweep();

    const [, payload] = sendNotification.mock.calls[0];
    const parsed = JSON.parse(payload as string);
    expect(parsed.text).toBe(`${'😀'.repeat(199)}…`);
    expect([...parsed.text]).toHaveLength(200);
  });

  it('does nothing when there are no due rows', async () => {
    await runReminderSweep();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('claims every due row once, leaving them stamped as notified', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    // Two due, one with no reminder at all.
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
      position: 0,
    });
    await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 30_000),
      assignedTo: member.id,
      position: 1,
    });
    await addItem(listId, project.id, { remindAt: null, position: 2 });

    await runReminderSweep();
    expect(sendNotification).toHaveBeenCalledTimes(2);

    // Both keep remind_at (they read as overdue until checked off) and are
    // suppressed from re-firing by notified_at instead.
    const withReminder = await db.select().from(items).where(isNotNull(items.remindAt));
    expect(withReminder).toHaveLength(2);
    expect(withReminder.every((r) => r.notifiedAt != null)).toBe(true);
    await runReminderSweep();
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
});

describe('runReminderSweep — recurring items', () => {
  // A daily 09:00 Berlin rule anchored at a fixed instant. `now` is pinned
  // just after an occurrence so the fired remind_at IS an occurrence.
  function dailyRule(anchorIso: string): RepeatRule {
    return { freq: 'daily', interval: 1, tz: 'Europe/Berlin', anchor: anchorIso };
  }

  it('reopens a checked occurrence at day start, fires once, and leaves it overdue', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);

    const anchor = '2026-06-01T07:00:00.000Z';
    const occurrence = new Date('2026-06-02T07:00:00.000Z'); // a real occurrence
    const now = new Date(occurrence.getTime() + 1_000);
    const item = await addItem(listId, project.id, {
      remindAt: occurrence,
      assignedTo: member.id,
      repeat: dailyRule(anchor),
      columnId: 'done',
      checked: true,
      checkedBy: member.id,
    });

    await runReminderSweep(now);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    // The push payload flags recurrence so the SW hides "Snooze 1h" (snoozing
    // would re-anchor the rule's time-of-day).
    const [, payload] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload as string)).toMatchObject({ recurring: true });
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    // Reactivated at the start of its occurrence day…
    expect(row.checked).toBe(false);
    expect(row.checkedBy).toBeNull();
    expect(row.columnId).toBe('todo');
    // …and the fire only NOTIFIES: remind_at stays on the occurrence (now
    // overdue) instead of jumping to the next day, so it can still be done.
    expect(row.remindAt?.toISOString()).toBe('2026-06-02T07:00:00.000Z');
    expect(row.notifiedAt).not.toBeNull();
    // The anchor is never touched by the sweep.
    expect(row.repeat?.anchor).toBe(anchor);
  });

  it('fires a due occurrence once without advancing remind_at', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);

    const occurrence = new Date('2026-06-02T07:00:00.000Z');
    const now = new Date(occurrence.getTime() + 1_000);
    const item = await addItem(listId, project.id, {
      remindAt: occurrence,
      assignedTo: member.id,
      repeat: dailyRule('2026-06-01T07:00:00.000Z'),
      columnId: 'todo',
      checked: false,
    });

    await runReminderSweep(now);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(row.checked).toBe(false);
    // Not advanced — the occurrence stays put and reads as overdue until done.
    expect(row.remindAt?.toISOString()).toBe('2026-06-02T07:00:00.000Z');
    expect(row.notifiedAt).not.toBeNull();
  });

  it('does not re-fire an occurrence it has already notified (overdue, not done)', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);

    const occurrence = new Date('2026-06-02T07:00:00.000Z');
    const item = await addItem(listId, project.id, {
      remindAt: occurrence,
      assignedTo: member.id,
      repeat: dailyRule('2026-06-01T07:00:00.000Z'),
      columnId: 'todo',
      checked: false,
    });

    // Two ticks an hour apart, both after the occurrence: the task is still due
    // (undone), but notified_at >= remind_at suppresses the second fire.
    await runReminderSweep(new Date(occurrence.getTime() + 1_000));
    await runReminderSweep(new Date(occurrence.getTime() + 3_600_000));

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt?.toISOString()).toBe('2026-06-02T07:00:00.000Z');
  });

  it('retries the same occurrence next tick after a transient failure', async () => {
    const { WebPushError } = await import('web-push');
    const { project, listId } = await createProject();
    const member = await addMember(project.id, { email: 'alice@example.com' });
    await addPushSub(member.id);

    const anchor = '2026-06-01T07:00:00.000Z';
    const occurrence = new Date('2026-06-02T07:00:00.000Z');
    const item = await addItem(listId, project.id, {
      remindAt: occurrence,
      assignedTo: member.id,
      repeat: dailyRule(anchor),
      columnId: 'todo',
    });

    // Tick 1: occurrence fires, push + email both fail transiently. notified_at
    // is cleared so the row is eligible again next tick; remind_at is untouched.
    sendNotification.mockRejectedValueOnce(
      new WebPushError('temporarily unavailable', 503, {}, '', 'https://fcm.googleapis.com/x'),
    );
    sendEmail.mockRejectedValueOnce(new Error('smtp unavailable'));
    await runReminderSweep(new Date(occurrence.getTime() + 1_000));

    let [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt?.toISOString()).toBe('2026-06-02T07:00:00.000Z');
    expect(row.notifiedAt).toBeNull();

    // Tick 2: delivery succeeds. The occurrence is unchanged (the anchor is
    // never polluted by a retry timestamp); notified_at now suppresses further
    // fires of this same occurrence.
    await runReminderSweep(new Date(occurrence.getTime() + 61_000));

    [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(row.remindAt?.toISOString()).toBe('2026-06-02T07:00:00.000Z');
    expect(row.notifiedAt).not.toBeNull();
    expect(row.repeat?.anchor).toBe(anchor);
  });

  it('does not re-arm non-recurring rows (regression)', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);
    const item = await addItem(listId, project.id, {
      remindAt: new Date(Date.now() - 60_000),
      assignedTo: member.id,
    });

    await runReminderSweep();

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    // One-shot reminder fired and cleared; never re-armed.
    expect(row.remindAt).toBeNull();
    expect(row.repeat).toBeNull();
  });

  it('reopens a checked recurring task once its occurrence day begins, before the fire', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);

    // Daily 22:00 Berlin rule (20:00Z in CEST). "now" is 08:00 Berlin on the
    // occurrence day — the same day as the next fire, but well before it.
    const anchor = '2026-06-01T20:00:00.000Z';
    const occurrence = new Date('2026-06-03T20:00:00.000Z');
    const now = new Date('2026-06-03T06:00:00.000Z');
    const item = await addItem(listId, project.id, {
      remindAt: occurrence,
      assignedTo: member.id,
      repeat: dailyRule(anchor),
      columnId: 'done',
      checked: true,
      checkedBy: member.id,
    });

    await runReminderSweep(now);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    // Reactivated at the start of the day…
    expect(row.checked).toBe(false);
    expect(row.checkedBy).toBeNull();
    expect(row.columnId).toBe('todo');
    // …but the reminder neither fired nor advanced — that still happens at 22:00.
    expect(sendNotification).not.toHaveBeenCalled();
    expect(row.remindAt?.toISOString()).toBe('2026-06-03T20:00:00.000Z');
  });

  it('does not reopen while the next occurrence is still on a future day', async () => {
    const { project, listId } = await createProject();
    const member = await addMember(project.id);
    await addPushSub(member.id);

    const occurrence = new Date('2026-06-03T07:00:00.000Z');
    const now = new Date('2026-06-02T12:00:00.000Z'); // the day before
    const item = await addItem(listId, project.id, {
      remindAt: occurrence,
      assignedTo: member.id,
      repeat: dailyRule('2026-06-01T07:00:00.000Z'),
      columnId: 'done',
      checked: true,
      checkedBy: member.id,
    });

    await runReminderSweep(now);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(true);
    expect(row.columnId).toBe('done');
    expect(row.remindAt?.toISOString()).toBe('2026-06-03T07:00:00.000Z');
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('PushSubscriptionSchema host allow-list', () => {
  it('accepts FCM, Mozilla autopush, and Apple endpoints', async () => {
    const { PushSubscriptionSchema } = await import('@plainspace/shared');
    const cases = [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      'https://web.push.apple.com/topic/abc',
    ];
    for (const endpoint of cases) {
      expect(
        PushSubscriptionSchema.safeParse({
          endpoint,
          keys: { p256dh: 'p', auth: 'a' },
        }).success,
      ).toBe(true);
    }
  });

  it('rejects attacker-controlled endpoints', async () => {
    const { PushSubscriptionSchema } = await import('@plainspace/shared');
    const cases = [
      'https://attacker.example.com/abuse',
      'https://fcm.googleapis.com.evil.example/fake',
      'https://notify.windows.com/wns/abc',
      'not-a-url',
    ];
    for (const endpoint of cases) {
      const result = PushSubscriptionSchema.safeParse({
        endpoint,
        keys: { p256dh: 'p', auth: 'a' },
      });
      expect(result.success, `expected rejection for ${endpoint}`).toBe(false);
    }
  });
});
