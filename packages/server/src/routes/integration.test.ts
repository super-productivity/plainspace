import { describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  API_TOKEN_PREFIX,
  API_TOKEN_LENGTH,
  MAX_ITEMS_PER_PROJECT,
  MEMBER_COLORS,
  TOS_VERSION,
} from '@plainspace/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import {
  activity,
  apiTokens,
  assignmentNotifications,
  attachments,
  items,
  lists,
  members,
  panels,
  projects,
  scratchpads,
} from '../db/schema.js';
import { hashToken } from '../lib/crypto.js';
import { encryptedEmailFields } from '../lib/email-crypto.js';
import { sseManager } from '../services/sse-manager.js';
import { addItem, createProject } from '../../test/helpers.js';
import { CREATE_SPACE_LIFETIME_LIMIT, CREATE_TASK_LIMIT } from './integration.js';

const app = createApp();

let emailCounter = 0;
// Unique per call so the in-memory create-space rate limiter (keyed on the email
// blind index, module-level, not reset by DB truncation) can't leak between tests.
function uniqueEmail(): string {
  return `pat-user-${emailCounter++}-${nanoid(6).toLowerCase()}@example.com`;
}

// Mint a PAT bound to `email`; returns the plaintext bearer token. Mirrors the
// real mint path (encrypted email triple + hashed token).
async function mintPat(email: string): Promise<string> {
  const plaintext = API_TOKEN_PREFIX + nanoid(API_TOKEN_LENGTH);
  await db.insert(apiTokens).values({
    ...encryptedEmailFields(email),
    tokenHash: hashToken(plaintext),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return plaintext;
}

// A member that loadIntegrationScope includes: emailVerified + current TOS,
// bound to `email`. Pass tosVersion to create a stale-ToS member instead.
async function addScopedMember(
  projectId: string,
  email: string,
  opts: { displayName?: string; tosVersion?: string } = {},
): Promise<typeof members.$inferSelect> {
  const [row] = await db
    .insert(members)
    .values({
      projectId,
      displayName: opts.displayName ?? 'Tester',
      color: MEMBER_COLORS[0],
      avatarIndex: 0,
      ...encryptedEmailFields(email),
      emailVerified: true,
      tosVersion: opts.tosVersion ?? TOS_VERSION,
      tosAcceptedAt: new Date(),
    })
    .returning();
  return row;
}

// A Space the PAT is a member of: project + list + verified member + minted PAT.
async function setupSpace(email = uniqueEmail()): Promise<{
  projectId: string;
  listId: string;
  memberId: string;
  token: string;
  email: string;
}> {
  const { project, listId } = await createProject();
  const member = await addScopedMember(project.id, email);
  const token = await mintPat(email);
  return { projectId: project.id, listId, memberId: member.id, token, email };
}

// Create a checklist panel + its backing list (panel_id set), mirroring what
// `POST /panels {type:'checklist'}` does. Returns the backing list id, into
// which checklist items are inserted as real `items` rows.
async function addChecklistList(projectId: string, title = 'Checklist'): Promise<string> {
  const [panel] = await db.insert(panels).values({ projectId, type: 'checklist' }).returning();
  const [list] = await db.insert(lists).values({ projectId, panelId: panel.id, title }).returning();
  return list.id;
}

async function authGet(path: string, token: string): Promise<Response> {
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } });
}
async function authPost(path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function patchDone(taskId: string, token: string, done: boolean): Promise<Response> {
  return app.request(`/api/integration/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ done }),
  });
}

describe('POST /api/integration/tasks/:taskId/claim', () => {
  it('claims an unassigned task: 200, assigns to me, records activity, broadcasts', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'Claim me' });
    const spy = vi.spyOn(sseManager, 'broadcast');

    const res = await authPost(`/api/integration/tasks/${item.id}/claim`, token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe(item.id);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBe(memberId);

    const acts = await db
      .select()
      .from(activity)
      .where(and(eq(activity.targetId, item.id), eq(activity.action, 'item.assigned')));
    expect(acts).toHaveLength(1);
    expect(acts[0].meta).toMatchObject({ source: 'sp', assignedTo: memberId });

    expect(spy).toHaveBeenCalledWith(
      projectId,
      'item.updated',
      expect.objectContaining({ memberId }),
    );
    spy.mockRestore();
  });

  it('self-claim does NOT enqueue an assignment notification', async () => {
    const { projectId, listId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'self' });

    await authPost(`/api/integration/tasks/${item.id}/claim`, token);

    const notes = await db
      .select()
      .from(assignmentNotifications)
      .where(eq(assignmentNotifications.itemId, item.id));
    expect(notes).toHaveLength(0);
  });

  it('already assigned to another member: 409, row unchanged', async () => {
    const { projectId, listId, token } = await setupSpace();
    const other = await addScopedMember(projectId, uniqueEmail(), { displayName: 'Other' });
    const item = await addItem(listId, projectId, { assignedTo: other.id });

    const res = await authPost(`/api/integration/tasks/${item.id}/claim`, token);
    expect(res.status).toBe(409);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBe(other.id);
  });

  it('already assigned to me: idempotent 200', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { assignedTo: memberId });

    const res = await authPost(`/api/integration/tasks/${item.id}/claim`, token);
    expect(res.status).toBe(200);
    expect((await res.json()).task.id).toBe(item.id);
  });

  it('task in a project I am not a member of (incl. unassigned): 404, not 409', async () => {
    const { token } = await setupSpace();
    const { project: foreign, listId: foreignList } = await createProject('Foreign');
    const item = await addItem(foreignList, foreign.id, { text: 'theirs' });

    const res = await authPost(`/api/integration/tasks/${item.id}/claim`, token);
    expect(res.status).toBe(404);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBeNull();
  });

  it('non-uuid taskId: 404, not 500', async () => {
    const { token } = await setupSpace();
    const res = await authPost('/api/integration/tasks/not-a-uuid/claim', token);
    expect(res.status).toBe(404);
  });

  it('checklist-panel item is not claimable: 404, row unchanged', async () => {
    const { projectId, token } = await setupSpace();
    const checklistListId = await addChecklistList(projectId, 'Packing list');
    const item = await addItem(checklistListId, projectId, { text: 'Passport' });

    const res = await authPost(`/api/integration/tasks/${item.id}/claim`, token);
    expect(res.status).toBe(404);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBeNull();
  });

  it('two concurrent claims: exactly one 200, one 409', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const email2 = uniqueEmail();
    const m2 = await addScopedMember(projectId, email2, { displayName: 'Two' });
    const token2 = await mintPat(email2);
    const item = await addItem(listId, projectId, { text: 'race' });

    const [r1, r2] = await Promise.all([
      authPost(`/api/integration/tasks/${item.id}/claim`, token),
      authPost(`/api/integration/tasks/${item.id}/claim`, token2),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect([memberId, m2.id]).toContain(row.assignedTo);
  });

  it('two concurrent claims by the SAME member: both idempotent 200', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'double-tap' });

    const [r1, r2] = await Promise.all([
      authPost(`/api/integration/tasks/${item.id}/claim`, token),
      authPost(`/api/integration/tasks/${item.id}/claim`, token),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBe(memberId);
  });
});

describe('POST /api/integration/tasks', () => {
  it('201: creates a task on the hero list, returns SPTask, records activity, broadcasts', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const spy = vi.spyOn(sseManager, 'broadcast');

    const res = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: 'From SP',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task).toMatchObject({
      title: 'From SP',
      done: false,
      projectId,
      listId,
    });
    expect(body.task.id).toBeTruthy();

    const [row] = await db.select().from(items).where(eq(items.id, body.task.id));
    expect(row.listId).toBe(listId);
    expect(row.createdBy).toBe(memberId);
    expect(row.assignedTo).toBe(memberId); // assigned to the creator so it round-trips via GET /tasks
    expect(row.checked).toBe(false);
    expect(row.columnId).toBe('todo');

    const acts = await db
      .select()
      .from(activity)
      .where(and(eq(activity.targetId, body.task.id), eq(activity.action, 'item.created')));
    expect(acts).toHaveLength(1);
    expect(acts[0].meta).toMatchObject({ source: 'sp', text: 'From SP' });

    expect(spy).toHaveBeenCalledWith(
      projectId,
      'item.created',
      expect.objectContaining({ memberId }),
    );
    spy.mockRestore();
  });

  it('the new task round-trips via GET /tasks (assigned to caller) and is NOT in the claim pool', async () => {
    const { projectId, token } = await setupSpace();
    const created = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: 'sync me back',
    });
    const taskId = (await created.json()).task.id;

    // GET /tasks is assigned-to-me only: the SP poll must see the task it just
    // created, else the client treats it as deleted-remotely and drops it.
    const mine = await (await authGet('/api/integration/tasks', token)).json();
    expect(mine.tasks.map((t: { id: string }) => t.id)).toContain(taskId);

    // ...and because it is owned (assigned), it is not offered up for claiming.
    const pool = await (await authGet('/api/integration/claimable-tasks', token)).json();
    expect(pool.tasks.map((t: { id: string }) => t.id)).not.toContain(taskId);
  });

  it('echoes the title verbatim (no trim/normalize) so SP needs no reconciling PATCH', async () => {
    const { projectId, token } = await setupSpace();
    const res = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: '  Buy milk  ',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.title).toBe('  Buy milk  ');

    const [row] = await db.select().from(items).where(eq(items.id, body.task.id));
    expect(row.text).toBe('  Buy milk  ');
  });

  it('resolves spaceId given as a slug (not just the id)', async () => {
    const { projectId, listId, token } = await setupSpace();
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));

    const res = await authPost('/api/integration/tasks', token, {
      spaceId: proj.slug,
      title: 'By slug',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.title).toBe('By slug');
    expect(body.task.listId).toBe(listId);
  });

  it('appends after existing items (max position + gap)', async () => {
    const { projectId, listId, token } = await setupSpace();
    await addItem(listId, projectId, { text: 'first', position: 5000 });

    const res = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: 'second',
    });
    const body = await res.json();
    const [row] = await db.select().from(items).where(eq(items.id, body.task.id));
    expect(row.position).toBe(6000); // 5000 + POSITION_GAP
  });

  it('lands on the hero list even when the Space has a checklist panel', async () => {
    const { projectId, listId, token } = await setupSpace();
    await addChecklistList(projectId, 'Packing list');

    const res = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: 'goes to hero',
    });
    expect(res.status).toBe(201);
    expect((await res.json()).task.listId).toBe(listId);
  });

  it('unknown spaceId: 404, no item created', async () => {
    const { token } = await setupSpace();
    const res = await authPost('/api/integration/tasks', token, {
      spaceId: 'does-not-exist',
      title: 'nope',
    });
    expect(res.status).toBe(404);
  });

  it('foreign Space (I am not a member) by id or slug: 404, no item created', async () => {
    const { token } = await setupSpace();
    const { project: foreign, listId: foreignList } = await createProject('Foreign');

    for (const spaceId of [foreign.id, foreign.slug]) {
      const res = await authPost('/api/integration/tasks', token, { spaceId, title: 'theirs' });
      expect(res.status).toBe(404);
    }

    const rows = await db.select().from(items).where(eq(items.listId, foreignList));
    expect(rows).toHaveLength(0);
  });

  it('PAT with no membership: 404', async () => {
    const token = await mintPat(uniqueEmail());
    const res = await authPost('/api/integration/tasks', token, {
      spaceId: 'anything',
      title: 'orphan',
    });
    expect(res.status).toBe(404);
  });

  it('empty title: 422', async () => {
    const { projectId, token } = await setupSpace();
    const res = await authPost('/api/integration/tasks', token, { spaceId: projectId, title: '' });
    expect(res.status).toBe(422);
  });

  it('missing spaceId: 422', async () => {
    const { token } = await setupSpace();
    const res = await authPost('/api/integration/tasks', token, { title: 'no space' });
    expect(res.status).toBe(422);
  });

  it('shares the active-item ceiling with browser-created tasks', async () => {
    const { projectId, listId, token } = await setupSpace();
    await db.insert(items).values(
      Array.from({ length: MAX_ITEMS_PER_PROJECT }, (_, index) => ({
        listId,
        projectId,
        text: `Existing ${index}`,
        position: index + 1,
      })),
    );

    const res = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: 'One too many',
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: `A Space can have at most ${MAX_ITEMS_PER_PROJECT} active items`,
    });
  });

  it('per-email burst limit: 429 after the cap', async () => {
    const { projectId, token } = await setupSpace();
    for (let i = 0; i < CREATE_TASK_LIMIT; i++) {
      const r = await authPost('/api/integration/tasks', token, {
        spaceId: projectId,
        title: `t${i}`,
      });
      expect(r.status).toBe(201);
    }
    const over = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: 'over the cap',
    });
    expect(over.status).toBe(429);
  });
});

describe('GET /api/integration/claimable-tasks', () => {
  it('returns only unassigned, not-done, not-deleted in my projects', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const free = await addItem(listId, projectId, { text: 'free' });
    await addItem(listId, projectId, { text: 'mine', assignedTo: memberId });
    await addItem(listId, projectId, { text: 'done', checked: true });
    await addItem(listId, projectId, { text: 'deleted', deletedAt: new Date() });

    const res = await authGet('/api/integration/claimable-tasks', token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual([free.id]);
  });

  it('?projectId filters to that project (within scope)', async () => {
    const email = uniqueEmail();
    const { projectId: pA, listId: lA, token } = await setupSpace(email);
    const { project: pB, listId: lB } = await createProject('B');
    await addScopedMember(pB.id, email);
    const a = await addItem(lA, pA, { text: 'a' });
    const b = await addItem(lB, pB.id, { text: 'b' });

    const all = await (await authGet('/api/integration/claimable-tasks', token)).json();
    expect(all.tasks.map((t: { id: string }) => t.id).sort()).toEqual([a.id, b.id].sort());

    const onlyA = await (
      await authGet(`/api/integration/claimable-tasks?projectId=${pA}`, token)
    ).json();
    expect(onlyA.tasks.map((t: { id: string }) => t.id)).toEqual([a.id]);
  });

  it('?projectId outside my scope: [] (no foreign-project probe)', async () => {
    const { token } = await setupSpace();
    const { project: foreign, listId: fl } = await createProject('Foreign');
    await addItem(fl, foreign.id, { text: 'theirs' });

    const res = await authGet(`/api/integration/claimable-tasks?projectId=${foreign.id}`, token);
    expect((await res.json()).tasks).toEqual([]);
  });

  it('PAT with no membership: []', async () => {
    const token = await mintPat(uniqueEmail());
    const res = await authGet('/api/integration/claimable-tasks', token);
    expect((await res.json()).tasks).toEqual([]);
  });

  // Contract: a checklist panel is a private tick-list, NOT shared assignable
  // work, so its items must never enter the claim pool even though they are real
  // `items` rows. Only the primary (hero) list feeds claimable-tasks.
  it('excludes checklist-panel items from the claim pool', async () => {
    const { projectId, listId, token } = await setupSpace();
    const checklistListId = await addChecklistList(projectId, 'Packing list');
    const hero = await addItem(listId, projectId, { text: 'hero task' });
    await addItem(checklistListId, projectId, { text: 'Passport' });

    const res = await authGet('/api/integration/claimable-tasks', token);
    expect(res.status).toBe(200);
    const ids = (await res.json()).tasks.map((t: { id: string }) => t.id);
    expect(ids).toEqual([hero.id]);
  });
});

describe('POST /api/integration/spaces', () => {
  it('201: creates project + creator member + default list/scratchpad; PAT acts in it', async () => {
    const email = uniqueEmail();
    const { token } = await setupSpace(email);

    const res = await authPost('/api/integration/spaces', token, {
      name: 'New Space',
      purpose: 'hello',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project.name).toBe('New Space');
    expect(body.url).toContain(body.project.slug);
    expect(body.memberId).toBeTruthy();

    const [mem] = await db.select().from(members).where(eq(members.id, body.memberId));
    expect(mem.isCreator).toBe(true);
    expect(mem.role).toBe('admin');
    expect(mem.emailVerified).toBe(true);

    const projLists = await db.select().from(lists).where(eq(lists.projectId, body.project.id));
    expect(projLists).toHaveLength(1);
    const pads = await db
      .select()
      .from(scratchpads)
      .where(eq(scratchpads.projectId, body.project.id));
    expect(pads).toHaveLength(1);

    // The same PAT immediately sees the new Space (shared emailLookup).
    const me = await (await authGet('/api/integration/me', token)).json();
    expect(me.projects.map((p: { id: string }) => p.id)).toContain(body.project.id);
  });

  it('validation failure (empty name): 422', async () => {
    const { token } = await setupSpace();
    const res = await authPost('/api/integration/spaces', token, { name: '' });
    expect(res.status).toBe(422);
  });

  it('per-email rate limit: 429 after the cap', async () => {
    const email = uniqueEmail();
    const { token } = await setupSpace(email);
    for (let i = 0; i < 10; i++) {
      const r = await authPost('/api/integration/spaces', token, { name: `S${i}` });
      expect(r.status).toBe(201);
    }
    const over = await authPost('/api/integration/spaces', token, { name: 'too many' });
    expect(over.status).toBe(429);
  });

  it('durable backstop: 429 at the lifetime ceiling even with a fresh burst limiter', async () => {
    const email = uniqueEmail();
    const { projectId, token } = await setupSpace(email);

    // Seed creator rows up to one below the lifetime ceiling. They share the
    // PAT's emailLookup so the durable count picks them up. emailVerified:false
    // lets them share one project — the (projectId, emailLookup) unique index
    // is partial on emailVerified=true, while the durable count predicate
    // filters only isCreator + emailLookup, so this exercises the real query.
    const seed = Array.from({ length: CREATE_SPACE_LIFETIME_LIMIT - 1 }, () => ({
      projectId,
      displayName: 'Seed',
      color: MEMBER_COLORS[0],
      avatarIndex: 0,
      ...encryptedEmailFields(email),
      emailVerified: false,
      isCreator: true,
    }));
    await db.insert(members).values(seed);

    // One below the ceiling → succeeds (reaching the ceiling). Only two
    // endpoint calls total, so the burst limiter is nowhere near its cap: the
    // 429 below can only come from the durable per-email count.
    const ok = await authPost('/api/integration/spaces', token, { name: 'last allowed' });
    expect(ok.status).toBe(201);

    const over = await authPost('/api/integration/spaces', token, { name: 'over the cap' });
    expect(over.status).toBe(429);
  });

  it('428: a PAT whose email is only on a prior ToS version cannot create a Space', async () => {
    const email = uniqueEmail();
    const { project } = await createProject();
    // Verified member, but on a superseded ToS version — loadIntegrationScope
    // (tosVersion === TOS_VERSION) excludes it, so the caller has no current
    // acceptance and the new creator member's stamp would be fabricated.
    await addScopedMember(project.id, email, { tosVersion: '2000-01-01' });
    const token = await mintPat(email);

    const res = await authPost('/api/integration/spaces', token, { name: 'Blocked' });
    expect(res.status).toBe(428);
    const body = await res.json();
    expect(body.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
    // Same contract as middleware/auth.ts so clients reuse their re-accept flow.
    expect(body.terms).toMatchObject({
      currentVersion: TOS_VERSION,
      acceptedVersion: '2000-01-01',
      acceptanceRequired: true,
    });
  });
});

describe('GET /api/integration/tasks?updatedSince (polling)', () => {
  it('filters by high-water mark; the DB trigger bumps updatedAt on write', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'task', assignedTo: memberId });

    const before = await (await authGet('/api/integration/tasks', token)).json();
    expect(before.tasks).toHaveLength(1);
    const firstUpdatedAt: string = before.tasks[0].updatedAt;
    expect(firstUpdatedAt).toBeTruthy();

    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await (
      await authGet(`/api/integration/tasks?updatedSince=${encodeURIComponent(future)}`, token)
    ).json();
    expect(none.tasks).toEqual([]);

    // Ensure a strictly later timestamp, then mutate so the trigger bumps updatedAt.
    await new Promise((r) => setTimeout(r, 10));
    await patchDone(item.id, token, true);

    const after = await (
      await authGet(
        `/api/integration/tasks?updatedSince=${encodeURIComponent(firstUpdatedAt)}`,
        token,
      )
    ).json();
    expect(after.tasks.map((t: { id: string }) => t.id)).toContain(item.id);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(new Date(row.updatedAt).getTime()).toBeGreaterThan(new Date(firstUpdatedAt).getTime());
  });

  it('invalid updatedSince: 422', async () => {
    const { token } = await setupSpace();
    const res = await authGet('/api/integration/tasks?updatedSince=not-a-date', token);
    expect(res.status).toBe(422);
  });
});

describe('GET /api/integration/tasks — scheduled time & recurrence', () => {
  it('surfaces scheduledAt and isRecurring for a scheduled, repeating task', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const remindAt = new Date('2026-07-01T09:00:00.000Z');
    await addItem(listId, projectId, {
      text: 'scheduled + recurring',
      assignedTo: memberId,
      remindAt,
      repeat: {
        freq: 'daily',
        interval: 1,
        tz: 'Europe/Berlin',
        anchor: remindAt.toISOString(),
      },
    });

    const body = await (await authGet('/api/integration/tasks', token)).json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].scheduledAt).toBe(remindAt.toISOString());
    expect(body.tasks[0].isRecurring).toBe(true);
  });

  it('an unscheduled, one-shot task reports null scheduledAt and isRecurring false', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    await addItem(listId, projectId, { text: 'plain', assignedTo: memberId });

    const body = await (await authGet('/api/integration/tasks', token)).json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].scheduledAt).toBeNull();
    expect(body.tasks[0].isRecurring).toBe(false);
  });

  // scheduledAt and isRecurring come from two independent columns (remind_at,
  // repeat): a scheduled one-shot reminder is the common off-diagonal case.
  it('a scheduled, non-repeating task reports scheduledAt with isRecurring false', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const remindAt = new Date('2026-07-01T09:00:00.000Z');
    await addItem(listId, projectId, { text: 'one-shot reminder', assignedTo: memberId, remindAt });

    const body = await (await authGet('/api/integration/tasks', token)).json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].scheduledAt).toBe(remindAt.toISOString());
    expect(body.tasks[0].isRecurring).toBe(false);
  });
});

describe('PATCH /api/integration/tasks/:taskId — done toggle', () => {
  it('checking moves the task into the done column', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, {
      assignedTo: memberId,
      columnId: 'todo',
      checked: false,
    });

    const res = await patchDone(item.id, token, true);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(true);
    expect(row.columnId).toBe('done'); // kept in lockstep with checked
  });

  it('unchecking a done task moves it back to todo', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, {
      assignedTo: memberId,
      columnId: 'done',
      checked: true,
      checkedBy: memberId,
    });

    const res = await patchDone(item.id, token, false);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(false);
    expect(row.columnId).toBe('todo');
  });

  // Regression: completing a recurring task via the integration must advance
  // remind_at to the next occurrence — exactly like the in-app PATCH — or the
  // reminder sweep's day-start reopen re-unchecks it on the next tick.
  it('completing a recurring task advances remindAt to the next occurrence and frees notified_at', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    // Reminder earlier today: its occurrence day has begun, so completing it
    // means "done for today" → rest on the NEXT occurrence.
    const pastToday = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const anchor = pastToday.toISOString();
    const item = await addItem(listId, projectId, {
      assignedTo: memberId,
      remindAt: pastToday,
      repeat: { freq: 'daily', interval: 1, tz: 'Europe/Berlin', anchor },
    });
    await db.update(items).set({ notifiedAt: pastToday }).where(eq(items.id, item.id));

    const res = await patchDone(item.id, token, true);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(true);
    // Rests on a future occurrence so the day-start reopen can't re-uncheck it,
    // with notified_at freed and the immutable anchor preserved.
    expect(row.remindAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.notifiedAt).toBeNull();
    expect(row.repeat?.anchor).toBe(anchor);
  });

  it('un-completing a recurring task rolls remindAt back one occurrence', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    // The row as a completion would have left it: remind_at advanced two daily
    // occurrences past the anchor. Un-checking rolls it back exactly one
    // occurrence (to the anchor + 1 day). Fixed instants so the assertion is
    // deterministic; June → Berlin is CEST throughout (no DST transition).
    const anchor = '2026-06-01T09:00:00.000Z'; // 11:00 Europe/Berlin, daily
    const item = await addItem(listId, projectId, {
      assignedTo: memberId,
      columnId: 'done',
      checked: true,
      checkedBy: memberId,
      remindAt: new Date('2026-06-03T09:00:00.000Z'),
      repeat: { freq: 'daily', interval: 1, tz: 'Europe/Berlin', anchor },
    });

    const res = await patchDone(item.id, token, false);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.checked).toBe(false);
    expect(row.remindAt?.toISOString()).toBe('2026-06-02T09:00:00.000Z');
  });
});

async function patchTask(taskId: string, token: string, body: unknown): Promise<Response> {
  return app.request(`/api/integration/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/integration/tasks/:taskId — title & scheduledAt', () => {
  it('done-only responds exactly as before: full task, checked activity, SSE', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'old', assignedTo: memberId });
    const broadcast = vi.spyOn(sseManager, 'broadcast');

    const res = await patchDone(item.id, token, true);
    expect(res.status).toBe(200);
    const { task } = await res.json();
    expect(task).toMatchObject({ id: item.id, title: 'old', done: true, scheduledAt: null });

    const [entry] = await db.select().from(activity).where(eq(activity.targetId, item.id));
    expect(entry).toMatchObject({ action: 'item.checked', meta: { text: 'old', source: 'sp' } });
    expect(broadcast.mock.calls.map((call) => call[1])).toEqual(['item.updated', 'activity']);
    broadcast.mockRestore();
  });

  it('renames the task verbatim (no trim, like POST) and records item.updated', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'old', assignedTo: memberId });

    const res = await patchTask(item.id, token, { title: '  new title  ' });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ title: '  new title  ', done: false });

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.text).toBe('  new title  ');
    const [entry] = await db.select().from(activity).where(eq(activity.targetId, item.id));
    expect(entry).toMatchObject({
      action: 'item.updated',
      meta: { text: '  new title  ', source: 'sp' },
    });
  });

  it('sets scheduledAt, clearing notified_at, without recording activity', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { assignedTo: memberId });
    await db.update(items).set({ notifiedAt: new Date() }).where(eq(items.id, item.id));

    const scheduledAt = '2026-12-01T09:00:00.000Z';
    const res = await patchTask(item.id, token, { scheduledAt });
    expect(res.status).toBe(200);
    expect((await res.json()).task.scheduledAt).toBe(scheduledAt);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt?.toISOString()).toBe(scheduledAt);
    expect(row.notifiedAt).toBeNull();
    expect(await db.select().from(activity).where(eq(activity.targetId, item.id))).toHaveLength(0);
  });

  it('clears scheduledAt on a one-shot task', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, {
      assignedTo: memberId,
      remindAt: new Date('2026-12-01T09:00:00.000Z'),
    });

    const res = await patchTask(item.id, token, { scheduledAt: null });
    expect(res.status).toBe(200);
    expect((await res.json()).task.scheduledAt).toBeNull();
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt).toBeNull();
  });

  it('re-scheduling a recurring task re-anchors its rule (as in-app)', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const anchor = '2026-06-01T09:00:00.000Z';
    const item = await addItem(listId, projectId, {
      assignedTo: memberId,
      remindAt: new Date(anchor),
      repeat: { freq: 'daily', interval: 1, tz: 'Europe/Berlin', anchor },
    });

    const scheduledAt = '2026-12-01T10:00:00.000Z';
    expect((await patchTask(item.id, token, { scheduledAt })).status).toBe(200);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.repeat?.anchor).toBe(scheduledAt);
  });

  it('409s clearing scheduledAt on a recurring task and leaves it untouched', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const anchor = '2026-06-01T09:00:00.000Z';
    const item = await addItem(listId, projectId, {
      assignedTo: memberId,
      remindAt: new Date(anchor),
      repeat: { freq: 'daily', interval: 1, tz: 'Europe/Berlin', anchor },
    });

    const res = await patchTask(item.id, token, { scheduledAt: null, title: 'renamed' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'repeat_requires_remind_at' });
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.remindAt?.toISOString()).toBe(anchor);
    expect(row.repeat?.anchor).toBe(anchor);
    expect(row.text).not.toBe('renamed');
  });

  it('applies done, title and scheduledAt together; reschedule skips the recurrence advance', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const pastToday = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const item = await addItem(listId, projectId, {
      text: 'old',
      assignedTo: memberId,
      remindAt: pastToday,
      repeat: { freq: 'daily', interval: 1, tz: 'Europe/Berlin', anchor: pastToday.toISOString() },
    });

    const scheduledAt = '2026-12-01T09:00:00.000Z';
    const res = await patchTask(item.id, token, { done: true, title: 'new', scheduledAt });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ done: true, title: 'new', scheduledAt });

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row).toMatchObject({
      checked: true,
      checkedBy: memberId,
      columnId: 'done',
      text: 'new',
    });
    expect(row.remindAt?.toISOString()).toBe(scheduledAt);
    const [entry] = await db.select().from(activity).where(eq(activity.targetId, item.id));
    expect(entry).toMatchObject({ action: 'item.checked', meta: { text: 'old' } });
  });

  it.each([
    ['empty body', {}],
    ['only unknown fields', { foo: 'bar' }],
    ['empty title', { title: '' }],
    ['blank title', { title: '   ' }],
    ['too-long title', { title: 'x'.repeat(501) }],
    ['bad date', { scheduledAt: 'tomorrow' }],
    ['date without offset', { scheduledAt: '2026-12-01T09:00:00' }],
    ['non-boolean done', { done: 'yes' }],
  ])('422s on %s without touching the task', async (_label, body) => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'old', assignedTo: memberId });

    const res = await patchTask(item.id, token, body);
    expect(res.status).toBe(422);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.text).toBe('old');
  });

  it('echoes a scheduledAt with an offset normalized to UTC', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { assignedTo: memberId });

    const res = await patchTask(item.id, token, { scheduledAt: '2026-12-01T10:00:00+01:00' });
    expect(res.status).toBe(200);
    expect((await res.json()).task.scheduledAt).toBe('2026-12-01T09:00:00.000Z');
  });

  it('404s for a soft-deleted task', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, {
      text: 'gone',
      assignedTo: memberId,
      deletedAt: new Date(),
    });

    expect((await patchTask(item.id, token, { title: 'back' })).status).toBe(404);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.text).toBe('gone');
  });

  it('404s for a task not assigned to the caller', async () => {
    const { projectId, listId, token } = await setupSpace();
    const other = await addScopedMember(projectId, uniqueEmail(), { displayName: 'Other' });
    const item = await addItem(listId, projectId, { text: 'theirs', assignedTo: other.id });

    const res = await patchTask(item.id, token, { title: 'mine now' });
    expect(res.status).toBe(404);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.text).toBe('theirs');
  });
});

describe('PATCH /api/integration/tasks/:taskId — assigneeId', () => {
  it('hands the task to a member like in-app: activity, notification, SSE; no longer mine', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const other = await addScopedMember(projectId, uniqueEmail(), { displayName: 'Other' });
    const item = await addItem(listId, projectId, { text: 'hand off', assignedTo: memberId });
    const broadcast = vi.spyOn(sseManager, 'broadcast');

    const res = await patchTask(item.id, token, { assigneeId: other.id });
    expect(res.status).toBe(200);
    expect(broadcast.mock.calls.map((call) => call[1])).toEqual(['item.updated', 'activity']);
    broadcast.mockRestore();

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBe(other.id);
    const [entry] = await db.select().from(activity).where(eq(activity.targetId, item.id));
    expect(entry).toMatchObject({
      action: 'item.assigned',
      meta: { text: 'hand off', assignedTo: other.id, source: 'sp' },
    });
    const notes = await db
      .select()
      .from(assignmentNotifications)
      .where(eq(assignmentNotifications.itemId, item.id));
    expect(notes.map((n) => n.memberId)).toEqual([other.id]);

    expect((await (await authGet('/api/integration/tasks', token)).json()).tasks).toEqual([]);
    expect((await authGet(`/api/integration/tasks/${item.id}`, token)).status).toBe(404);
  });

  it('null releases the task to the Space: unassigned, claimable, no notification', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { text: 'release', assignedTo: memberId });

    const res = await patchTask(item.id, token, { assigneeId: null });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBeNull();
    const [entry] = await db.select().from(activity).where(eq(activity.targetId, item.id));
    expect(entry).toMatchObject({ action: 'item.assigned', meta: { assignedTo: null } });
    expect(await db.select().from(assignmentNotifications)).toHaveLength(0);
    const claimable = await (await authGet('/api/integration/claimable-tasks', token)).json();
    expect(claimable.tasks.map((t: { id: string }) => t.id)).toEqual([item.id]);
  });

  it('404s for an assignee from another Space, and leaves the task mine', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const { project: otherSpace } = await createProject();
    const stranger = await addScopedMember(otherSpace.id, uniqueEmail());
    const item = await addItem(listId, projectId, { assignedTo: memberId });

    const res = await patchTask(item.id, token, { assigneeId: stranger.id });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Member not found' });
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBe(memberId);
  });

  it('404s for a task not assigned to the caller, and leaves it untouched', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const other = await addScopedMember(projectId, uniqueEmail(), { displayName: 'Other' });
    const item = await addItem(listId, projectId, { assignedTo: other.id });

    expect((await patchTask(item.id, token, { assigneeId: memberId })).status).toBe(404);
    expect((await patchTask(item.id, token, { assigneeId: null })).status).toBe(404);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.assignedTo).toBe(other.id);
  });

  it('done + assigneeId: activity is the check, the new assignee is still notified (as in-app)', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const other = await addScopedMember(projectId, uniqueEmail());
    const item = await addItem(listId, projectId, { assignedTo: memberId });

    expect((await patchTask(item.id, token, { done: true, assigneeId: other.id })).status).toBe(
      200,
    );
    const entries = await db.select().from(activity).where(eq(activity.targetId, item.id));
    expect(entries.map((e) => e.action)).toEqual(['item.checked']);
    const notes = await db.select().from(assignmentNotifications);
    expect(notes.map((n) => n.memberId)).toEqual([other.id]);
  });

  it('two concurrent handoffs: exactly one wins, the loser records and notifies nothing', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const b = await addScopedMember(projectId, uniqueEmail());
    const c = await addScopedMember(projectId, uniqueEmail());
    const item = await addItem(listId, projectId, { assignedTo: memberId });

    const [r1, r2] = await Promise.all([
      patchTask(item.id, token, { assigneeId: b.id }),
      patchTask(item.id, token, { assigneeId: c.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 404]);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    const notes = await db.select().from(assignmentNotifications);
    expect(notes.map((n) => n.memberId)).toEqual([row.assignedTo]);
    expect(await db.select().from(activity).where(eq(activity.targetId, item.id))).toHaveLength(1);
  });

  it('a non-uuid assigneeId: 422', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { assignedTo: memberId });
    expect((await patchTask(item.id, token, { assigneeId: 'bob' })).status).toBe(422);
  });
});

describe('GET /api/integration/spaces/:spaceId/members', () => {
  it('lists id and display name of every member, in join order, nothing else', async () => {
    const { projectId, memberId, token } = await setupSpace();
    const other = await addScopedMember(projectId, uniqueEmail(), { displayName: 'Other' });

    const res = await authGet(`/api/integration/spaces/${projectId}/members`, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [
        { id: memberId, displayName: 'Tester' },
        { id: other.id, displayName: 'Other' },
      ],
    });
  });

  it('404s for a Space the token is not a member of, or a non-uuid id', async () => {
    const { token } = await setupSpace();
    const { project: foreign } = await createProject();
    await addScopedMember(foreign.id, uniqueEmail());

    expect((await authGet(`/api/integration/spaces/${foreign.id}/members`, token)).status).toBe(
      404,
    );
    expect((await authGet('/api/integration/spaces/nope/members', token)).status).toBe(404);
  });
});

async function deleteTask(taskId: string, token: string): Promise<Response> {
  return app.request(`/api/integration/tasks/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('DELETE /api/integration/tasks/:taskId', () => {
  it('soft-deletes a task assigned to me and broadcasts, so the poll no longer returns it', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { assignedTo: memberId });
    const spy = vi.spyOn(sseManager, 'broadcast');

    expect((await deleteTask(item.id, token)).status).toBe(204);

    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.deletedAt).not.toBeNull();
    const list = await (await authGet('/api/integration/tasks', token)).json();
    expect(list.tasks.map((t: { id: string }) => t.id)).not.toContain(item.id);
    expect(spy).toHaveBeenCalledWith(projectId, 'item.deleted', { itemId: item.id, memberId });
    expect(spy).toHaveBeenCalledWith(
      projectId,
      'activity',
      expect.objectContaining({ entry: expect.objectContaining({ action: 'item.deleted' }) }),
    );
    spy.mockRestore();
  });

  it('records item.deleted and scrubs the item activity meta', async () => {
    const { projectId, token } = await setupSpace();
    const created = await authPost('/api/integration/tasks', token, {
      spaceId: projectId,
      title: 'Secret title',
    });
    const { task } = await created.json();

    expect((await deleteTask(task.id, token)).status).toBe(204);

    const rows = await db.select().from(activity).where(eq(activity.targetId, task.id));
    expect(rows.map((r) => r.action)).toContain('item.deleted');
    expect(rows.every((r) => JSON.stringify(r.meta) === '{}')).toBe(true);
  });

  it('scrubs attachment activity meta too', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { assignedTo: memberId });
    const [att] = await db
      .insert(attachments)
      .values({
        projectId,
        itemId: item.id,
        filename: 'a.txt',
        storagePath: 'x/a.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
      })
      .returning();
    await db.insert(activity).values({
      projectId,
      memberId,
      action: 'attachment.created',
      targetType: 'attachment',
      targetId: att.id,
      meta: { itemText: 'Secret' },
    });

    expect((await deleteTask(item.id, token)).status).toBe(204);

    const rows = await db.select().from(activity).where(eq(activity.targetId, att.id));
    expect(rows.map((r) => r.meta)).toEqual([{}]);
  });

  it('404s for a task assigned to someone else, and leaves it untouched', async () => {
    const { projectId, listId, token } = await setupSpace();
    const other = await addScopedMember(projectId, uniqueEmail(), { displayName: 'Other' });
    const item = await addItem(listId, projectId, { assignedTo: other.id });

    expect((await deleteTask(item.id, token)).status).toBe(404);
    const [row] = await db.select().from(items).where(eq(items.id, item.id));
    expect(row.deletedAt).toBeNull();
  });

  it('404s for an unassigned task', async () => {
    const { projectId, listId, token } = await setupSpace();
    const item = await addItem(listId, projectId);
    expect((await deleteTask(item.id, token)).status).toBe(404);
  });

  it('404s for an already deleted task (client treats it as already gone)', async () => {
    const { projectId, listId, memberId, token } = await setupSpace();
    const item = await addItem(listId, projectId, { assignedTo: memberId });
    expect((await deleteTask(item.id, token)).status).toBe(204);
    expect((await deleteTask(item.id, token)).status).toBe(404);
  });

  it('404s for a task in a Space the token is not a member of', async () => {
    const mine = await setupSpace();
    const theirs = await setupSpace();
    const item = await addItem(theirs.listId, theirs.projectId, { assignedTo: theirs.memberId });
    expect((await deleteTask(item.id, mine.token)).status).toBe(404);
  });

  it('404s for a non-uuid id', async () => {
    const { token } = await setupSpace();
    expect((await deleteTask('not-a-uuid', token)).status).toBe(404);
  });
});

describe('auth', () => {
  it('missing token: 401', async () => {
    const res = await app.request('/api/integration/claimable-tasks');
    expect(res.status).toBe(401);
  });
});
