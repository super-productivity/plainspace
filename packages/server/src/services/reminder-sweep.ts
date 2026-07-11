import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import webpush, { WebPushError } from 'web-push';
import { db } from '../db/connection.js';
import { items, members, projects, pushSubscriptions } from '../db/schema.js';
import { serializeItem } from '../lib/serialize.js';
import { nextOccurrence, startOfDayInTz } from '../lib/next-occurrence.js';
import { sseManager } from './sse-manager.js';
import { decryptStoredEmail } from '../lib/email-crypto.js';
import { sendReminderEmail } from './email.js';
import { itemUrl } from '@plainspace/shared';
import { ADVISORY_LOCK, withAdvisoryLock } from '../lib/advisory-lock.js';

const SWEEP_INTERVAL_MS = 60 * 1000;
// Assignment notifications batch on a trailing window: flush a member's queue
// once no new assignment has landed for ASSIGN_QUIET_MS (the burst settled), or
// once the oldest queued assignment has waited ASSIGN_MAX_WAIT_MS (a cap so a
// steady drip of assignments can't starve the notification forever).
const ASSIGN_QUIET_MS = 5 * 60 * 1000;
const ASSIGN_MAX_WAIT_MS = 30 * 60 * 1000;

let running = false;
let vapidConfigured = false;

// Wire up VAPID once at module load. Sweep no-ops if any key is missing so
// dev environments without VAPID don't claim rows. In production all three
// are required (boot throws).
// Exported for tests so they can flip `vapidConfigured` without starting the
// interval-driven sweeper. Production callers go through `startReminderSweeper`.
export function configureWebPush(): void {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must be set in production',
      );
    }
    console.warn('VAPID_* not set — reminder sweep will no-op');
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
}

type ItemRow = typeof items.$inferSelect;
type SubRow = typeof pushSubscriptions.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type DeliveryResult = { delivered: boolean; transientFailure: boolean };

export async function runReminderSweep(now = new Date()): Promise<void> {
  if (!vapidConfigured) return;

  // Reopen recurring tasks as soon as their next occurrence's DAY begins (before
  // the claim below, so a row whose occurrence also fires this tick is unchecked
  // first, then notified by the fire — which no longer advances the schedule).
  await reopenDueRecurringItems(now);

  // Atomic claim so a row can't be claimed twice by an overlapping tick or
  // process restart. One-shot rows are claimed by nulling remind_at; recurring
  // rows keep remind_at (the current occurrence) and are claimed by stamping
  // notified_at, so an undone occurrence keeps reading as due → overdue instead
  // of jumping to the next day. A plain `RETURNING *` still carries the current
  // text/assignment, so edits between set-time and fire-time are honoured.
  // Soft-deleted items are excluded so a deletion before fire time silently
  // cancels the reminder (and restoring the item preserves it). Side effect: if
  // an item is restored AFTER its fire time, the next sweep tick will claim+fire
  // it immediately — closer to "what they wanted" than silently dropping it.
  const claimed = await claimDueReminders(now);

  await Promise.allSettled(claimed.map((row) => deliverForItem(row, now)));
}

// Claim due reminders via one atomic UPDATE … RETURNING (CTE) so no row can be
// claimed twice. One-shot rows are cleared (remind_at → NULL); recurring rows
// keep remind_at and are stamped notified_at = now. The recurring guard
// `notified_at IS NULL OR notified_at < remind_at` makes a fire happen once per
// occurrence: after a successful fire notified_at >= remind_at suppresses the
// row, and a transient failure clears notified_at (see writeBackReminder) so it
// retries next tick. The returned rows are mapped back to the drizzle ItemRow
// shape.
async function claimDueReminders(now: Date): Promise<ItemRow[]> {
  // Bind `now` as an ISO string cast to timestamptz; the raw postgres-js path
  // (via db.execute) doesn't serialize a JS Date parameter the way the query
  // builder does.
  const nowIso = now.toISOString();
  const rows = await db.execute(sql`
    WITH due AS (
      SELECT id
      FROM items
      WHERE deleted_at IS NULL AND remind_at IS NOT NULL
        AND remind_at <= ${nowIso}::timestamptz
        AND (repeat IS NULL OR notified_at IS NULL OR notified_at < remind_at)
      FOR UPDATE SKIP LOCKED
    )
    UPDATE items
    SET remind_at = CASE WHEN repeat IS NULL THEN NULL ELSE remind_at END,
        notified_at = CASE WHEN repeat IS NULL THEN notified_at ELSE ${nowIso}::timestamptz END
    FROM due
    WHERE items.id = due.id
    RETURNING items.*
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    listId: r.list_id as string,
    projectId: r.project_id as string,
    text: r.text as string,
    checked: r.checked as boolean,
    checkedBy: r.checked_by as string | null,
    assignedTo: r.assigned_to as string | null,
    columnId: r.column_id as string,
    position: r.position as number,
    createdBy: r.created_by as string | null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    remindAt: r.remind_at ? new Date(r.remind_at as string) : null,
    repeat: (r.repeat as ItemRow['repeat']) ?? null,
    notifiedAt: r.notified_at ? new Date(r.notified_at as string) : null,
    deletedAt: null,
  }));
}

async function deliverForItem(item: ItemRow, now: Date): Promise<void> {
  const targetMembers = item.assignedTo
    ? await db.query.members.findMany({
        where: and(eq(members.id, item.assignedTo), eq(members.projectId, item.projectId)),
      })
    : await db.query.members.findMany({ where: eq(members.projectId, item.projectId) });

  if (targetMembers.length === 0) return;

  const subs = await db.query.pushSubscriptions.findMany({
    where: inArray(
      pushSubscriptions.memberId,
      targetMembers.map((m) => m.id),
    ),
  });
  const subsByMember = new Map<string, SubRow[]>();
  for (const s of subs) {
    const list = subsByMember.get(s.memberId) ?? [];
    list.push(s);
    subsByMember.set(s.memberId, list);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, item.projectId),
  });
  if (!project) return;

  const deliveryResults = await Promise.all(
    targetMembers.map(async (m) => {
      const memberSubs = subsByMember.get(m.id) ?? [];
      if (memberSubs.length > 0) {
        const pushSettled = await Promise.allSettled(
          memberSubs.map((s) => sendPush(s, item, project)),
        );
        const pushResults = pushSettled.map((r): DeliveryResult => {
          if (r.status === 'fulfilled') return r.value;
          console.error('Push delivery handling failed', { memberId: m.id, err: r.reason });
          return { delivered: false, transientFailure: true };
        });
        if (pushResults.some((r) => r.delivered)) {
          return {
            delivered: true,
            transientFailure: pushResults.some((r) => r.transientFailure),
          };
        }
        const emailResult = await sendEmailFallback(m, item, project);
        return {
          delivered: emailResult.delivered,
          transientFailure:
            emailResult.transientFailure || pushResults.some((r) => r.transientFailure),
        };
      }
      return sendEmailFallback(m, item, project);
    }),
  );

  const anyDelivered = deliveryResults.some((r) => r.delivered);
  const needsRetry = !anyDelivered && deliveryResults.some((r) => r.transientFailure);
  // Jitter the retry by ±SWEEP_INTERVAL_MS/2 so a sustained downstream outage
  // doesn't cause every failed item to re-fire in the same tick. Without
  // jitter the cohort marches in lockstep and hammers SMTP/push the moment
  // they come back up.
  const retryAt = new Date(
    now.getTime() + SWEEP_INTERVAL_MS + Math.floor(Math.random() * SWEEP_INTERVAL_MS),
  );
  const broadcastItem = await writeBackReminder(item, { needsRetry, retryAt });
  if (!broadcastItem) return;

  // SSE for online observers — the existing item.updated handler in the web
  // store reconciles a cleared one-shot reminder or a transient-failure retry.
  // For a recurring fire nothing on the row changed (remind_at stays put,
  // notified_at isn't serialized), but the broadcast still lands so the new
  // item reference re-renders and the now-passed occurrence reads as overdue.
  // memberId is null because the sweep is system-triggered, not user-initiated.
  void sseManager.broadcast(item.projectId, 'item.updated', {
    item: serializeItem(broadcastItem),
    memberId: null,
  });
}

// Post-delivery write. Delivery-only — it never touches `checked`:
//   - non-recurring: re-arm `retryAt` on transient failure, else stay cleared;
//   - recurring occurrence fire (delivered): nothing to write — the claim
//     already stamped notified_at, and the schedule advances on check-off, not
//     here, so an undone occurrence stays put and reads as due → overdue;
//   - recurring retry fire (delivery failed transiently): clear notified_at so
//     the next tick re-claims and retries this same occurrence. remind_at is
//     untouched, so the occurrence — and its overdue display — is preserved.
// Reactivating a completed recurring task is decoupled from the fire: it happens
// when its occurrence DAY begins, in reopenDueRecurringItems.
async function writeBackReminder(
  item: ItemRow,
  opts: { needsRetry: boolean; retryAt: Date },
): Promise<ItemRow | null> {
  const { needsRetry, retryAt } = opts;

  if (!item.repeat) {
    if (!needsRetry) return item; // stays cleared
    return requeueOrReload(item, { remindAt: retryAt });
  }

  if (needsRetry) return clearNotified(item);
  return item; // delivered; notified_at already stamped by the claim
}

// Apply a compare-and-set keyed on `remind_at IS NULL` (so a concurrent claim
// can't clobber it), returning the updated row. If the row was re-claimed or
// deleted out from under us, fall back to the current row for the broadcast.
async function requeueOrReload(
  item: ItemRow,
  updates: Partial<typeof items.$inferInsert>,
): Promise<ItemRow | null> {
  const [updated] = await db
    .update(items)
    .set(updates)
    .where(
      and(
        eq(items.id, item.id),
        eq(items.projectId, item.projectId),
        isNull(items.remindAt),
        isNull(items.deletedAt),
      ),
    )
    .returning();
  if (updated) return updated;

  const current = await db.query.items.findFirst({
    where: and(eq(items.id, item.id), eq(items.projectId, item.projectId)),
  });
  if (!current || current.deletedAt) return null;
  return current;
}

// Recurring transient-failure path: clear notified_at so the next tick
// re-claims and retries the same occurrence (remind_at stays put). Returns the
// updated row for the broadcast, or null if the item was deleted out from under
// us (nothing to broadcast).
async function clearNotified(item: ItemRow): Promise<ItemRow | null> {
  const [updated] = await db
    .update(items)
    .set({ notifiedAt: null })
    .where(and(eq(items.id, item.id), eq(items.projectId, item.projectId), isNull(items.deletedAt)))
    .returning();
  return updated ?? null;
}

// Reactivate completed recurring tasks the moment their next occurrence's DAY
// begins — so a finished repeating task stops looking "done" first thing on the
// day it's due again, rather than only when its reminder finally fires later
// that day. The reminder itself still fires at its set time via the normal claim
// (and is naturally skipped if the user re-checks the task, which advances
// remind_at past today's occurrence — see items PATCH).
//
// Keyed on `remind_at` (the next-occurrence pointer), guarded by an isOccurrence
// check so a jittered retry instant — which is never in the occurrence set —
// can't reopen an item the user checked off the same day. Compare-and-set on
// `checked = true` so a concurrent uncheck isn't clobbered.
async function reopenDueRecurringItems(now: Date): Promise<void> {
  const candidates = await db.query.items.findMany({
    where: and(
      isNotNull(items.repeat),
      eq(items.checked, true),
      isNotNull(items.remindAt),
      isNull(items.deletedAt),
    ),
  });
  const due = candidates.filter((row) => {
    const rule = row.repeat!;
    const remindAt = row.remindAt!;
    const isOccurrence =
      nextOccurrence(rule, new Date(remindAt.getTime() - 1)).getTime() === remindAt.getTime();
    return isOccurrence && startOfDayInTz(remindAt, rule.tz).getTime() <= now.getTime();
  });
  await Promise.allSettled(
    due.map(async (row) => {
      const updates: Partial<typeof items.$inferInsert> = { checked: false, checkedBy: null };
      if (row.columnId === 'done') updates.columnId = 'todo';
      const [updated] = await db
        .update(items)
        .set(updates)
        .where(and(eq(items.id, row.id), eq(items.checked, true), isNull(items.deletedAt)))
        .returning();
      if (!updated) return;
      // SSE so online observers see the task become active again immediately.
      // memberId is null because the reopen is system-triggered.
      void sseManager.broadcast(updated.projectId, 'item.updated', {
        item: serializeItem(updated),
        memberId: null,
      });
    }),
  );
}

// ── Assignment notifications ────────────────────────────────────────────────
// Batched "assigned to you" push. The enqueue side (items PATCH) queues a row
// per new assignment; this pass claims a member's whole settled batch in one
// atomic DELETE … RETURNING and fires a single notification. Push-only by
// design: an assignment is a convenience nudge (the task is already visible
// in-app), so members without a push subscription simply aren't pinged — there
// is no email fallback and no transient-failure retry.
export async function runAssignmentSweep(now = new Date()): Promise<void> {
  if (!vapidConfigured) return;

  const claimed = await claimDueAssignments(now);
  const itemsByMember = new Map<string, string[]>();
  for (const row of claimed) {
    const list = itemsByMember.get(row.memberId) ?? [];
    list.push(row.itemId);
    itemsByMember.set(row.memberId, list);
  }

  await Promise.allSettled(
    [...itemsByMember].map(([memberId, itemIds]) => deliverAssignments(memberId, itemIds)),
  );
}

// Atomic claim: one DELETE … RETURNING per due member so an overlapping tick
// can't double-send. A member is due when their newest queued assignment has
// settled (<= now − quiet) OR their oldest has waited out the cap
// (<= now − max). All of that member's rows go out together as one batch.
async function claimDueAssignments(now: Date): Promise<{ memberId: string; itemId: string }[]> {
  const quietCutoff = new Date(now.getTime() - ASSIGN_QUIET_MS).toISOString();
  const maxCutoff = new Date(now.getTime() - ASSIGN_MAX_WAIT_MS).toISOString();
  const rows = await db.execute(sql`
    WITH due AS (
      SELECT member_id
      FROM assignment_notifications
      GROUP BY member_id
      HAVING max(assigned_at) <= ${quietCutoff}::timestamptz
          OR min(assigned_at) <= ${maxCutoff}::timestamptz
    )
    DELETE FROM assignment_notifications a
    USING due
    WHERE a.member_id = due.member_id
    RETURNING a.member_id, a.item_id
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    memberId: r.member_id as string,
    itemId: r.item_id as string,
  }));
}

async function deliverAssignments(memberId: string, itemIds: string[]): Promise<void> {
  // Re-validate against the live rows: only items still assigned to this
  // member, not checked off, not deleted, count. This absorbs any reassign /
  // unassign / check / delete that landed between enqueue and flush, so the
  // enqueue path never has to clean up after itself.
  const valid = await db.query.items.findMany({
    where: and(
      inArray(items.id, itemIds),
      eq(items.assignedTo, memberId),
      eq(items.checked, false),
      isNull(items.deletedAt),
    ),
  });
  if (valid.length === 0) return;

  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.memberId, memberId),
  });
  if (subs.length === 0) return; // push-only: no subscription ⇒ nothing to send

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, valid[0].projectId),
  });
  if (!project) return;

  const single = valid.length === 1 ? valid[0] : null;
  const payload = JSON.stringify({
    type: 'assignment',
    projectSlug: project.slug,
    projectName: project.name,
    count: valid.length,
    // A single-item batch deep-links to that item; a multi-item batch carries
    // no itemId and the SW falls back to opening the project board.
    ...(single ? { itemId: single.id, text: truncateForPush(single.text) } : {}),
  });
  await Promise.allSettled(subs.map((s) => pushToSub(s, payload)));
}

// Iterate code points so we don't split a surrogate pair (emoji, astral chars)
// and emit ill-formed UTF-16 in the JSON payload.
function truncateForPush(text: string): string {
  const codepoints = [...text];
  return codepoints.length > 200 ? `${codepoints.slice(0, 199).join('')}…` : text;
}

async function sendPush(
  sub: SubRow,
  item: ItemRow,
  project: { slug: string; name: string },
): Promise<DeliveryResult> {
  return pushToSub(
    sub,
    JSON.stringify({
      type: 'reminder',
      projectSlug: project.slug,
      projectName: project.name,
      itemId: item.id,
      text: truncateForPush(item.text),
      // Drives which action buttons the SW shows. A "Snooze 1h" tap PATCHes a new
      // remind_at, which re-anchors a recurring rule's time-of-day permanently —
      // so the SW only offers Snooze on one-shot reminders.
      recurring: item.repeat != null,
    }),
  );
}

// Low-level send + endpoint hygiene, shared by reminders and assignment
// notifications. A 404/410 means the endpoint is gone — drop the row; the
// browser re-subscribes on its next ensurePushSubscription() call.
async function pushToSub(sub: SubRow, payload: string): Promise<DeliveryResult> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payload,
    );
    return { delivered: true, transientFailure: false };
  } catch (err) {
    if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.memberId, sub.memberId),
            eq(pushSubscriptions.endpoint, sub.endpoint),
          ),
        );
      return { delivered: false, transientFailure: false };
    }
    console.error('Push send failed', { memberId: sub.memberId, err });
    return { delivered: false, transientFailure: true };
  }
}

async function sendEmailFallback(
  member: MemberRow,
  item: ItemRow,
  project: { slug: string; name: string },
): Promise<DeliveryResult> {
  const email = decryptStoredEmail(member);
  if (!email) return { delivered: false, transientFailure: false }; // display-name-only members have no email
  const origin = process.env.APP_URL ?? 'https://plainspace.org';
  try {
    await sendReminderEmail({
      toEmail: email,
      itemText: item.text,
      projectName: project.name,
      itemUrl: itemUrl(origin, project.slug, item.id),
    });
    return { delivered: true, transientFailure: false };
  } catch (err) {
    console.error('Reminder email failed', { memberId: member.id, err });
    return { delivered: false, transientFailure: true };
  }
}

export function startReminderSweeper(): void {
  configureWebPush();

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    // `running` guards re-entry within this process; the advisory lock guards
    // against a second process (e.g. a deploy-overlap container) sweeping the
    // same rows at the same time.
    try {
      await withAdvisoryLock(ADVISORY_LOCK.reminderSweep, async () => {
        // Independent try/catch each: a failing reminder query (e.g. a transient
        // DB error) must not skip the assignment flush, and logs stay attributable.
        try {
          await runReminderSweep();
        } catch (err) {
          console.error('Reminder sweep failed', err);
        }
        try {
          await runAssignmentSweep();
        } catch (err) {
          console.error('Assignment sweep failed', err);
        }
      });
    } catch (err) {
      console.error('Reminder tick failed', err);
    } finally {
      running = false;
    }
  };

  void tick();
  const interval = setInterval(tick, SWEEP_INTERVAL_MS);
  interval.unref();
}
