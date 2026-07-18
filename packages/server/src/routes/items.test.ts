import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  MAX_ITEMS_PER_PROJECT,
  POSITION_GAP,
  TOS_VERSION,
  type RepeatRule,
} from '@plainspace/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import {
  assignmentNotifications,
  items,
  lists,
  members,
  memberTokens,
  panels,
} from '../db/schema.js';
import { hashToken } from '../lib/crypto.js';
import { addItem, addMember, createProject } from '../../test/helpers.js';

const app = createApp();

// A member with a known bearer token and accepted TOS, so PATCH passes the
// auth + terms gate.
async function authedMember(projectId: string): Promise<{ id: string; token: string }> {
  const token = randomBytes(16).toString('hex');
  const [row] = await db
    .insert(members)
    .values({
      projectId,
      displayName: 'Tester',
      color: '#000000',
      avatarIndex: 0,
      emailCiphertext: null,
      emailIv: null,
      emailLookup: null,
      emailVerified: false,
      tosVersion: TOS_VERSION,
      tosAcceptedAt: new Date(),
    })
    .returning();
  await db.insert(memberTokens).values({ tokenHash: hashToken(token), memberId: row.id });
  return { id: row.id, token };
}

async function patchItem(
  slug: string,
  itemId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/projects/${slug}/items/${itemId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createItem(slug: string, token: string, text: string): Promise<Response> {
  return app.request(`/api/projects/${slug}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

const dailyRuleBody = { freq: 'daily', interval: 1, tz: 'Europe/Berlin' };

async function reloadRepeat(itemId: string): Promise<RepeatRule | null> {
  const [row] = await db.select().from(items).where(eq(items.id, itemId));
  return row.repeat ?? null;
}

describe('PATCH item — request validation', () => {
  it('rejects an empty update instead of reaching Drizzle with .set({})', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const item = await addItem(listId, project.id);

    const res = await patchItem(project.slug, item.id, token, {});

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'Validation failed' });
  });
});

describe('POST item — project size bound', () => {
  it('rejects creation once the active-item snapshot reaches its ceiling', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    await db.insert(items).values(
      Array.from({ length: MAX_ITEMS_PER_PROJECT }, (_, index) => ({
        listId,
        projectId: project.id,
        text: `Existing ${index}`,
        position: (index + 1) * POSITION_GAP,
      })),
    );

    const res = await createItem(project.slug, token, 'One too many');

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: `A Space can have at most ${MAX_ITEMS_PER_PROJECT} active items`,
    });
  });
});

describe('POST item restore — respects the project size bound', () => {
  it('rejects restore when the active-item snapshot is already at its ceiling', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    // Fill every active slot, then add one soft-deleted row to restore.
    await db.insert(items).values(
      Array.from({ length: MAX_ITEMS_PER_PROJECT }, (_, index) => ({
        listId,
        projectId: project.id,
        text: `Existing ${index}`,
        position: (index + 1) * POSITION_GAP,
      })),
    );
    const [deleted] = await db
      .insert(items)
      .values({
        listId,
        projectId: project.id,
        text: 'Deleted',
        position: (MAX_ITEMS_PER_PROJECT + 1) * POSITION_GAP,
        deletedAt: new Date(),
      })
      .returning();

    const res = await app.request(`/api/projects/${project.slug}/items/${deleted.id}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: `A Space can have at most ${MAX_ITEMS_PER_PROJECT} active items`,
    });
    const stillDeleted = await db.query.items.findFirst({ where: eq(items.id, deleted.id) });
    expect(stillDeleted?.deletedAt).not.toBeNull();
  });
});

describe('PATCH item — anchor stamping', () => {
  it('stamps the anchor from remindAt on rule creation', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const item = await addItem(listId, project.id);

    const remindAt = '2026-06-01T07:00:00.000Z';
    const res = await patchItem(project.slug, item.id, token, {
      remindAt,
      repeat: dailyRuleBody,
    });
    expect(res.status).toBe(200);

    const repeat = await reloadRepeat(item.id);
    expect(repeat).toMatchObject({ ...dailyRuleBody, anchor: remindAt });
  });

  it('rejects a repeat rule without an effective remindAt (422)', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const item = await addItem(listId, project.id); // no remindAt on the row

    const res = await patchItem(project.slug, item.id, token, { repeat: dailyRuleBody });
    expect(res.status).toBe(422);
    expect(await reloadRepeat(item.id)).toBeNull();
  });

  it('leaves the anchor byte-identical on a text-only PATCH', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const anchor = '2026-06-01T07:00:00.000Z';
    const item = await addItem(listId, project.id, {
      remindAt: new Date(anchor),
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    const res = await patchItem(project.slug, item.id, token, { text: 'renamed' });
    expect(res.status).toBe(200);
    expect((await reloadRepeat(item.id))?.anchor).toBe(anchor);
  });

  it('leaves the anchor untouched even while remindAt holds a retry-ish timestamp', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const anchor = '2026-06-01T07:00:00.000Z';
    // Simulate a pending retry: remind_at is a jittered, non-occurrence instant.
    const item = await addItem(listId, project.id, {
      remindAt: new Date('2026-06-02T07:01:37.000Z'),
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    // A position PATCH must NOT re-stamp the anchor to the retry timestamp.
    const res = await patchItem(project.slug, item.id, token, { position: 5000 });
    expect(res.status).toBe(200);
    expect((await reloadRepeat(item.id))?.anchor).toBe(anchor);
  });

  it('keeps the old anchor on a rule-only PATCH (no remindAt in payload)', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const anchor = '2026-06-01T07:00:00.000Z';
    // Pending retry: remind_at holds a jittered, non-occurrence instant.
    const item = await addItem(listId, project.id, {
      remindAt: new Date('2026-06-02T07:01:37.000Z'),
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    // Editing only the rule must not adopt the retry timestamp as DTSTART.
    const res = await patchItem(project.slug, item.id, token, {
      repeat: { ...dailyRuleBody, interval: 2 },
    });
    expect(res.status).toBe(200);
    const repeat = await reloadRepeat(item.id);
    expect(repeat?.interval).toBe(2);
    expect(repeat?.anchor).toBe(anchor);
  });

  it('leaves the anchor untouched on a check PATCH', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const anchor = '2026-06-01T07:00:00.000Z';
    const item = await addItem(listId, project.id, {
      remindAt: new Date(anchor),
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    const res = await patchItem(project.slug, item.id, token, { checked: true });
    expect(res.status).toBe(200);
    expect((await reloadRepeat(item.id))?.anchor).toBe(anchor);
  });

  it('re-stamps the anchor when the PATCH explicitly sets a new remindAt', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const anchor = '2026-06-01T07:00:00.000Z';
    const item = await addItem(listId, project.id, {
      remindAt: new Date(anchor),
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    const newRemindAt = '2026-07-15T18:30:00.000Z';
    const res = await patchItem(project.slug, item.id, token, { remindAt: newRemindAt });
    expect(res.status).toBe(200);
    // Re-anchored to the new time; the rule body is preserved.
    expect((await reloadRepeat(item.id))?.anchor).toBe(newRemindAt);
  });

  it('cascades remindAt:null to repeat:null', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const anchor = '2026-06-01T07:00:00.000Z';
    const item = await addItem(listId, project.id, {
      remindAt: new Date(anchor),
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    const res = await patchItem(project.slug, item.id, token, { remindAt: null });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt).toBeNull();
    expect(row.repeat).toBeNull();
  });

  it('clearing repeat keeps remindAt as a one-shot reminder', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const anchor = '2026-06-01T07:00:00.000Z';
    const item = await addItem(listId, project.id, {
      remindAt: new Date(anchor),
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    const res = await patchItem(project.slug, item.id, token, { repeat: null });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt?.toISOString()).toBe(anchor);
    expect(row.repeat).toBeNull();
  });

  it('ignores a client-sent anchor and stamps the server-owned one', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const item = await addItem(listId, project.id);

    const remindAt = '2026-06-01T07:00:00.000Z';
    const res = await patchItem(project.slug, item.id, token, {
      remindAt,
      // A malicious/confused client tries to set its own anchor.
      repeat: { ...dailyRuleBody, anchor: '1999-01-01T00:00:00.000Z' },
    });
    expect(res.status).toBe(200);
    expect((await reloadRepeat(item.id))?.anchor).toBe(remindAt);
  });
});

describe('PATCH item — recurring check advances the schedule', () => {
  it('advances remindAt to the next occurrence when checked on/after its occurrence day', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    // Reminder earlier today: its occurrence day has already begun, so checking
    // it off means "done for today" → rest on the NEXT occurrence.
    const pastToday = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const anchor = pastToday.toISOString();
    const item = await addItem(listId, project.id, {
      remindAt: pastToday,
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    const res = await patchItem(project.slug, item.id, token, { checked: true });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(true);
    // Rests on a future occurrence — so the sweep's day-start reopen can't
    // re-uncheck it later today — while the immutable anchor is preserved.
    expect(row.remindAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.repeat?.anchor).toBe(anchor);
  });

  it('advances past a multi-day-overdue occurrence and clears notified_at', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    // Missed for days: the occurrence fired (notified_at stamped) and has sat
    // overdue. Completing it skips the whole missed streak to the next future
    // occurrence and frees notified_at so that occurrence can fire.
    const anchor = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const item = await addItem(listId, project.id, {
      remindAt: anchor,
      repeat: { ...dailyRuleBody, anchor: anchor.toISOString() } as RepeatRule,
    });
    await db.update(items).set({ notifiedAt: anchor }).where(eq(items.id, item.id));

    const res = await patchItem(project.slug, item.id, token, { checked: true });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(true);
    expect(row.remindAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.notifiedAt).toBeNull();
    expect(row.repeat?.anchor).toBe(anchor.toISOString());
  });

  it('skips to a future day when checked before an occurrence later the same day', async () => {
    // Fake only Date (not timers) so the async pg driver still runs. "now" is
    // 10:00 Berlin; the reminder is today at 22:00 Berlin — still ahead.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-17T08:00:00.000Z'));
    try {
      const { project, listId } = await createProject();
      const { token } = await authedMember(project.id);
      const anchor = '2026-06-10T20:00:00.000Z'; // 22:00 Europe/Berlin, daily
      const item = await addItem(listId, project.id, {
        remindAt: new Date('2026-06-17T20:00:00.000Z'), // today 22:00 Berlin
        repeat: { ...dailyRuleBody, anchor } as RepeatRule,
      });

      const res = await patchItem(project.slug, item.id, token, { checked: true });
      expect(res.status).toBe(200);

      const [row] = await db.select().from(items).where(eq(items.id, item.id));
      // Must skip today's still-upcoming 22:00 to tomorrow's — otherwise the
      // sweep's day-start reopen re-unchecks the just-completed task.
      expect(row.remindAt?.toISOString()).toBe('2026-06-18T20:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips to a future day when an overdue task is checked before its time-of-day today', async () => {
    // The "Vitamin D" report: a daily task overdue for days, checked off this
    // morning (10:00 Berlin) while its 22:00 occurrence is still ahead today.
    // Catching up off `now` must not land back on today — that rests as a
    // "next 22:00" today and the day-start reopen could re-uncheck it. It must
    // skip to tomorrow.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-24T08:00:00.000Z')); // 10:00 Berlin
    try {
      const { project, listId } = await createProject();
      const { token } = await authedMember(project.id);
      const anchor = '2026-06-10T20:00:00.000Z'; // 22:00 Europe/Berlin, daily
      const item = await addItem(listId, project.id, {
        remindAt: new Date('2026-06-21T20:00:00.000Z'), // overdue: 3 days ago, 22:00 Berlin
        repeat: { ...dailyRuleBody, anchor } as RepeatRule,
      });

      const res = await patchItem(project.slug, item.id, token, { checked: true });
      expect(res.status).toBe(200);

      const [row] = await db.select().from(items).where(eq(items.id, item.id));
      // Tomorrow 22:00 Berlin — not today's still-upcoming 22:00.
      expect(row.remindAt?.toISOString()).toBe('2026-06-25T20:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves remindAt scheduled when checked while the occurrence is still a future day', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    // Pre-completing ahead of time: the occurrence stays scheduled for its day.
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const anchor = future.toISOString();
    const item = await addItem(listId, project.id, {
      remindAt: future,
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    const res = await patchItem(project.slug, item.id, token, { checked: true });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(true);
    expect(row.remindAt!.getTime()).toBe(future.getTime());
  });

  it('does not touch remindAt on check for a non-recurring reminder', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const past = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const item = await addItem(listId, project.id, { remindAt: past }); // no repeat

    const res = await patchItem(project.slug, item.id, token, { checked: true });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(true);
    expect(row.remindAt!.getTime()).toBe(past.getTime());
  });
});

describe('PATCH item — un-check restores the completed occurrence', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-24T14:00:00.000Z')); // 16:00 Europe/Berlin
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rolls remindAt back to the current occurrence when an overdue recurring task is restored', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    // Daily task whose occurrence is earlier today and overdue (the "Kaffee since
    // 13:30" report): checking it off advances to tomorrow, so un-checking must
    // bring it back to today — restore is the inverse of completing.
    const pastToday = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const anchor = pastToday.toISOString();
    const item = await addItem(listId, project.id, {
      remindAt: pastToday,
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    await patchItem(project.slug, item.id, token, { checked: true });
    const [advanced] = await db.select().from(items).where(eq(items.id, item.id));
    expect(advanced.remindAt!.getTime()).toBeGreaterThan(Date.now()); // sanity: moved to tomorrow

    const res = await patchItem(project.slug, item.id, token, { checked: false });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(false);
    // Back on today's occurrence, not tomorrow.
    expect(row.remindAt!.getTime()).toBe(pastToday.getTime());
    // The past occurrence is marked notified so the restore can't re-fire a push.
    expect(row.notifiedAt).not.toBeNull();
    expect(row.notifiedAt!.getTime()).toBeGreaterThanOrEqual(row.remindAt!.getTime());
    expect(row.repeat?.anchor).toBe(anchor); // immutable anchor preserved
  });

  it('rolls back via a column move out of done, not only an explicit checked:false', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const pastToday = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const anchor = pastToday.toISOString();
    const item = await addItem(listId, project.id, {
      remindAt: pastToday,
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    await patchItem(project.slug, item.id, token, { checked: true });
    const res = await patchItem(project.slug, item.id, token, { columnId: 'todo' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(false);
    expect(row.remindAt!.getTime()).toBe(pastToday.getTime());
  });

  it('leaves a pre-completed future occurrence scheduled when un-checked', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    // Future occurrence pre-completed early: completion never advanced remind_at
    // (it is still the anchor), so un-checking must leave it on its future day —
    // previousOccurrence returns null at the anchor.
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const anchor = future.toISOString();
    const item = await addItem(listId, project.id, {
      remindAt: future,
      repeat: { ...dailyRuleBody, anchor } as RepeatRule,
    });

    await patchItem(project.slug, item.id, token, { checked: true });
    const res = await patchItem(project.slug, item.id, token, { checked: false });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(false);
    expect(row.remindAt!.getTime()).toBe(future.getTime());
  });

  it('does not touch remindAt when un-checking a non-recurring reminder', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const past = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const item = await addItem(listId, project.id, { remindAt: past }); // no repeat

    await patchItem(project.slug, item.id, token, { checked: true });
    const res = await patchItem(project.slug, item.id, token, { checked: false });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(false);
    expect(row.remindAt!.getTime()).toBe(past.getTime());
  });
});

describe('PATCH item — assignment notification queue', () => {
  async function queuedFor(memberId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(assignmentNotifications)
      .where(eq(assignmentNotifications.memberId, memberId));
    return rows.map((r) => r.itemId);
  }

  it('queues a notification when assigning to another member', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const assignee = await addMember(project.id);
    const item = await addItem(listId, project.id);

    const res = await patchItem(project.slug, item.id, token, { assignedTo: assignee.id });
    expect(res.status).toBe(200);
    expect(await queuedFor(assignee.id)).toEqual([item.id]);
  });

  it('queues when assignment is combined with another field in one PATCH', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const assignee = await addMember(project.id);
    const item = await addItem(listId, project.id);

    // `checked` takes the first activity branch; the enqueue must not hinge on
    // which activity branch runs, so the assignee still gets queued.
    const res = await patchItem(project.slug, item.id, token, {
      assignedTo: assignee.id,
      checked: false,
    });
    expect(res.status).toBe(200);
    expect(await queuedFor(assignee.id)).toEqual([item.id]);
  });

  it('does not queue when a member assigns a task to themselves', async () => {
    const { project, listId } = await createProject();
    const actor = await authedMember(project.id);
    const item = await addItem(listId, project.id);

    const res = await patchItem(project.slug, item.id, actor.token, { assignedTo: actor.id });
    expect(res.status).toBe(200);
    expect(await queuedFor(actor.id)).toEqual([]);
  });

  it('does not queue when unassigning (assignedTo: null)', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const assignee = await addMember(project.id);
    const item = await addItem(listId, project.id, { assignedTo: assignee.id });

    const res = await patchItem(project.slug, item.id, token, { assignedTo: null });
    expect(res.status).toBe(200);
    expect(await queuedFor(assignee.id)).toEqual([]);
  });

  it('does not re-queue when re-assigning to the member who already holds it', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const assignee = await addMember(project.id);
    const item = await addItem(listId, project.id, { assignedTo: assignee.id });

    const res = await patchItem(project.slug, item.id, token, { assignedTo: assignee.id });
    expect(res.status).toBe(200);
    expect(await queuedFor(assignee.id)).toEqual([]);
  });

  it('does not queue when the assignee is not a member of the project (404)', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const other = await createProject();
    const outsider = await addMember(other.project.id);
    const item = await addItem(listId, project.id);

    const res = await patchItem(project.slug, item.id, token, { assignedTo: outsider.id });
    expect(res.status).toBe(404);
    expect(await queuedFor(outsider.id)).toEqual([]);
  });
});

describe('PATCH item — move between lists', () => {
  async function reloadItem(itemId: string) {
    const [row] = await db.select().from(items).where(eq(items.id, itemId));
    return row;
  }

  // A second list in the same project. It must be a checklist panel's backing
  // list (panel_id set): the partial unique index allows only one primary
  // (panel-less) list per project, which createProject already made.
  async function addList(projectId: string): Promise<string> {
    const [panel] = await db.insert(panels).values({ projectId, type: 'checklist' }).returning();
    const [list] = await db
      .insert(lists)
      .values({ projectId, panelId: panel.id, columns: null })
      .returning();
    return list.id;
  }

  it('moves the item to another list in the same project, updating position', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const targetListId = await addList(project.id);
    const item = await addItem(listId, project.id, { position: 1000 });

    const res = await patchItem(project.slug, item.id, token, {
      listId: targetListId,
      position: 500,
    });
    expect(res.status).toBe(200);
    // The serialized response carries the new listId — clients (and the SSE
    // broadcast that reuses this payload) rebucket the row off it.
    const body = (await res.json()) as { item: { listId: string; position: number } };
    expect(body.item).toMatchObject({ listId: targetListId, position: 500 });

    const moved = await reloadItem(item.id);
    expect(moved.listId).toBe(targetListId);
    expect(moved.position).toBe(500);
  });

  it("rejects moving into another project's list (404), leaving the item put", async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const other = await createProject();
    const item = await addItem(listId, project.id);

    const res = await patchItem(project.slug, item.id, token, { listId: other.listId });
    expect(res.status).toBe(404);
    expect((await reloadItem(item.id)).listId).toBe(listId);
  });

  it('rejects a non-existent target list (404)', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const item = await addItem(listId, project.id);

    const res = await patchItem(project.slug, item.id, token, {
      listId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(404);
    expect((await reloadItem(item.id)).listId).toBe(listId);
  });
});
