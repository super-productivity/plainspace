// API tokens authorize the holder for every project where their verified email
// is a member. Tokens are scoped to the email, not to a single project: if the
// same verified email is a member of N projects, the token can act in all of
// them. This is intentional so a user can use one PAT across all their Spaces.
// Revocation is per-token via DELETE /auth/api-tokens/:id.
import { Hono } from 'hono';
import { eq, and, isNull, inArray, gt, desc, count, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/connection.js';
import { members, items, lists, projects } from '../db/schema.js';
import { apiTokenMiddleware, type ApiTokenContext } from '../middleware/api-token.js';
import { isUuid } from '../middleware/uuid-param.js';
import { sseManager } from '../services/sse-manager.js';
import { recordActivity } from '../services/activity.js';
import { serializeItem, serializeProject } from '../lib/serialize.js';
import { encryptedEmailFields, normalizeEmail } from '../lib/email-crypto.js';
import { ensureProjectDefaults } from '../services/project-defaults.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import {
  itemUrl,
  projectUrl,
  TOS_VERSION,
  SLUG_LENGTH,
  MEMBER_COLORS,
  MAX_DISPLAY_NAME_LENGTH,
  POSITION_GAP,
  CreateSpaceViaTokenSchema,
  CreateTaskViaTokenSchema,
  type SPTask,
} from '@plainspace/shared';
import { readJson } from '../lib/json.js';
import { hasItemCapacity, ITEM_CAPACITY_ERROR } from '../services/item-capacity.js';

export const integrationRoutes = new Hono<{ Variables: ApiTokenContext }>();

integrationRoutes.use('*', apiTokenMiddleware);

type MemberRow = typeof members.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type ListRow = typeof lists.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

type IntegrationScope = {
  memberRows: MemberRow[];
  memberIds: string[];
  projectIds: string[];
  memberByProjectId: Map<string, MemberRow>;
};

async function loadIntegrationScope(emailLookup: Buffer): Promise<IntegrationScope> {
  const memberRows = await db.query.members.findMany({
    where: and(
      eq(members.emailLookup, emailLookup),
      eq(members.emailVerified, true),
      eq(members.tosVersion, TOS_VERSION),
    ),
  });

  return {
    memberRows,
    memberIds: memberRows.map((m) => m.id),
    projectIds: [...new Set(memberRows.map((m) => m.projectId))],
    memberByProjectId: new Map(memberRows.map((m) => [m.projectId, m])),
  };
}

function serializeSPTask(
  item: ItemRow,
  list: ListRow,
  project: ProjectRow,
  origin: string,
): SPTask {
  return {
    id: item.id,
    title: item.text,
    done: item.checked,
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    listId: list.id,
    url: itemUrl(origin, project.slug, item.id),
    scheduledAt: item.remindAt?.toISOString() ?? null,
    isRecurring: item.repeat !== null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function isAssignedToScopedMember(item: ItemRow, scope: IntegrationScope): boolean {
  return item.assignedTo === scope.memberByProjectId.get(item.projectId)?.id;
}

const appOrigin = (): string => process.env.APP_URL ?? 'http://localhost:5173';

// Hydrate a set of item rows into SPTask DTOs with one batched lists + projects
// fetch (shared by GET /tasks and GET /claimable-tasks).
async function toSPTasks(itemRows: ItemRow[]): Promise<SPTask[]> {
  if (itemRows.length === 0) return [];
  const listIds = [...new Set(itemRows.map((i) => i.listId))];
  const projectIds = [...new Set(itemRows.map((i) => i.projectId))];
  const [listRows, projectRows] = await Promise.all([
    db.query.lists.findMany({ where: inArray(lists.id, listIds) }),
    db.query.projects.findMany({ where: inArray(projects.id, projectIds) }),
  ]);
  const listMap = new Map(listRows.map((l) => [l.id, l]));
  const projMap = new Map(projectRows.map((p) => [p.id, p]));
  const origin = appOrigin();

  const tasks: SPTask[] = [];
  for (const item of itemRows) {
    const list = listMap.get(item.listId);
    const proj = projMap.get(item.projectId);
    if (!list || !proj) continue;
    tasks.push(serializeSPTask(item, list, proj, origin));
  }
  return tasks;
}

// Safety bound on the claim-pool feed. SP scopes the call to one Space, so this
// is a backstop, not a paging contract; raise it (or add a cursor) if a single
// Space ever holds more open unclaimed items than this.
const CLAIMABLE_TASKS_LIMIT = 200;

// Per-email cap on Space creation via a PAT. Keyed on the email blind index
// (not the token id) so re-minting a token can't reset the quota.
const CREATE_SPACE_LIMIT = 10;
const CREATE_SPACE_WINDOW_MS = 60 * 60 * 1000;

// Durable lifetime backstop on Space creation per email (issue #24). The
// in-memory limiter above caps *burst* but resets on restart and is
// per-instance; this DB count is the only bound that survives a restart loop
// or a leaked PAT hammering create-space — create-space has no second factor
// (unlike POST /api/projects). Creator member rows only disappear when the
// creator deletes the whole Space (DELETE /auth/space, which needs a creator
// session — a PAT alone can't trigger it), so for the leaked-PAT threat the
// count is effectively monotonic per email. Generous on purpose: clear of any
// legitimate multi-Space user, low enough to bound abuse to finite rows.
export const CREATE_SPACE_LIFETIME_LIMIT = 100;

// Per-email burst cap on task creation via a PAT. Generous on purpose: task
// entry is legitimately bursty — a user adding (or pasting a list of) tasks in
// SP fans out to one POST each — so this must clear real usage while still
// turning an unbounded leaked-PAT / runaway-loop into a bounded one. Burst-only,
// with no durable lifetime cap like create-space: unlike Spaces, a high lifetime
// task count is normal, so only the *rate* is abuse-worthy. Keyed on the email
// blind index (the PAT acts across every Space that email belongs to).
export const CREATE_TASK_LIMIT = 100;
const CREATE_TASK_WINDOW_MS = 60 * 1000;

// GET /api/integration/me - Verify token and get user info
integrationRoutes.get('/me', async (c) => {
  const email = c.get('apiTokenEmail');
  const emailLookup = c.get('apiTokenEmailLookup');

  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    return c.json({ email, projects: [] });
  }

  // Only fetch projects this user is a member of
  const projectRows = await db.query.projects.findMany({
    where: inArray(projects.id, scope.projectIds),
  });

  const projectMap = new Map(projectRows.map((p) => [p.id, p]));

  const projectList = scope.memberRows
    .map((m) => {
      const p = projectMap.get(m.projectId);
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        memberDisplayName: m.displayName,
        role: m.role,
      };
    })
    .filter(Boolean);

  return c.json({ email, projects: projectList });
});

// GET /api/integration/tasks - List all assigned tasks across projects.
// Optional ?updatedSince=<ISO> returns only tasks changed since that instant
// (high-water-mark polling); items.updated_at is bumped by a DB trigger.
integrationRoutes.get('/tasks', async (c) => {
  const emailLookup = c.get('apiTokenEmailLookup');

  const updatedSinceRaw = c.req.query('updatedSince');
  let updatedSince: Date | undefined;
  if (updatedSinceRaw !== undefined) {
    const parsed = new Date(updatedSinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'Invalid updatedSince timestamp' }, 422);
    }
    updatedSince = parsed;
  }

  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    return c.json({ tasks: [] });
  }

  const assignedItemRows = await db.query.items.findMany({
    where: and(
      inArray(items.projectId, scope.projectIds),
      inArray(items.assignedTo, scope.memberIds),
      isNull(items.deletedAt),
      updatedSince ? gt(items.updatedAt, updatedSince) : undefined,
    ),
  });
  const assignedItems = assignedItemRows.filter((item) => isAssignedToScopedMember(item, scope));

  return c.json({ tasks: await toSPTasks(assignedItems) });
});

// POST /api/integration/tasks - Create a task in a bound Space. Symmetric with
// the SP → Plainspace auto-import: a task added to a Plainspace-backed project
// in Super Productivity lands on the Space's primary (hero) list so
// collaborators see it. `spaceId` (id OR slug) is intersected with the caller's
// membership — a foreign or unknown Space is 404 (never a leak). The task is
// authored as the caller's own member for that Space (createdBy), mirroring the
// in-app POST /items but PAT-authed instead of member-token-authed.
integrationRoutes.post('/tasks', async (c) => {
  const emailLookup = c.get('apiTokenEmailLookup');

  // Burst-limit before any work (matches POST /spaces): a leaked PAT or runaway
  // loop can't hammer create-task, and malformed bodies still count against it.
  if (
    !checkRateLimit(
      `create-task:${emailLookup.toString('hex')}`,
      CREATE_TASK_LIMIT,
      CREATE_TASK_WINDOW_MS,
    )
  ) {
    return c.json({ error: 'Too many tasks created, please try again shortly' }, 429);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = CreateTaskViaTokenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    return c.json({ error: 'Space not found' }, 404);
  }

  // Resolve spaceId (id OR slug) against the caller's own projects in memory:
  // matching in JS avoids a uuid-column cast error when spaceId is a slug, and
  // limiting to scope.projectIds means a foreign or unknown Space simply isn't
  // found (404, no probe of a Space the caller isn't a member of).
  const projectRows = await db.query.projects.findMany({
    where: inArray(projects.id, scope.projectIds),
  });
  const project = projectRows.find(
    (p) => p.id === parsed.data.spaceId || p.slug === parsed.data.spaceId,
  );
  const member = project && scope.memberByProjectId.get(project.id);
  if (!project || !member) {
    return c.json({ error: 'Space not found' }, 404);
  }

  // The primary (hero) list — panel_id IS NULL — is always present
  // (ensureProjectDefaults seeds it on Space creation); the guard is for the
  // impossible-missing case only.
  const list = await db.query.lists.findFirst({
    where: and(eq(lists.projectId, project.id), isNull(lists.panelId)),
  });
  if (!list) {
    return c.json({ error: 'Space not found' }, 404);
  }

  const result = await db.transaction(async (tx) => {
    if (!(await hasItemCapacity(tx, project.id))) {
      return { capExceeded: true as const };
    }
    const [{ maxPos }] = await tx
      .select({ maxPos: max(items.position) })
      .from(items)
      .where(and(eq(items.listId, list.id), isNull(items.deletedAt)));
    const position = (maxPos ?? 0) + POSITION_GAP;

    // Assign to the caller's own member. GET /api/integration/tasks only returns
    // tasks assigned to the caller, so an unassigned task would be invisible to
    // SP's poll — the client would treat its own just-created task as
    // deleted-remotely and drop it. Self-assignment enqueues no notification
    // (assignee === creator) and keeps the task out of the claim pool (owned,
    // not up for grabs). columnId/checked fall to their DB defaults ('todo' /
    // false): a task added from SP always starts open.
    const [item] = await tx
      .insert(items)
      .values({
        listId: list.id,
        projectId: project.id,
        text: parsed.data.title,
        position,
        assignedTo: member.id,
        createdBy: member.id,
      })
      .returning();

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'item.created',
      targetType: 'item',
      targetId: item.id,
      meta: { text: item.text, source: 'sp' },
    });
    return { item, activityEntry };
  });

  if ('capExceeded' in result) {
    return c.json({ error: ITEM_CAPACITY_ERROR }, 422);
  }
  const { item, activityEntry } = result;

  const serialized = serializeItem(item);
  void sseManager.broadcast(project.id, 'item.created', { item: serialized, memberId: member.id });
  void sseManager.broadcast(project.id, 'activity', { entry: activityEntry });

  return c.json({ task: serializeSPTask(item, list, project, appOrigin()) }, 201);
});

// GET /api/integration/tasks/:taskId - Get single task
integrationRoutes.get('/tasks/:taskId', async (c) => {
  const emailLookup = c.get('apiTokenEmailLookup');
  const taskId = c.req.param('taskId');
  if (!isUuid(taskId)) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const item = await db.query.items.findFirst({
    where: and(
      eq(items.id, taskId),
      inArray(items.projectId, scope.projectIds),
      inArray(items.assignedTo, scope.memberIds),
      isNull(items.deletedAt),
    ),
  });

  if (!item || !isAssignedToScopedMember(item, scope)) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const list = await db.query.lists.findFirst({ where: eq(lists.id, item.listId) });
  const proj = await db.query.projects.findFirst({ where: eq(projects.id, item.projectId) });

  if (!list || !proj) {
    return c.json({ error: 'Task not found' }, 404);
  }

  return c.json({ task: serializeSPTask(item, list, proj, appOrigin()) });
});

// PATCH /api/integration/tasks/:taskId - Update task done status
integrationRoutes.patch('/tasks/:taskId', async (c) => {
  const emailLookup = c.get('apiTokenEmailLookup');
  const taskId = c.req.param('taskId');
  if (!isUuid(taskId)) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof (body as { done?: unknown })?.done !== 'boolean') {
    return c.json({ error: 'Invalid request. Expected { done: boolean }' }, 422);
  }
  const done = (body as { done: boolean }).done;

  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const item = await db.query.items.findFirst({
    where: and(
      eq(items.id, taskId),
      inArray(items.projectId, scope.projectIds),
      inArray(items.assignedTo, scope.memberIds),
      isNull(items.deletedAt),
    ),
  });

  if (!item || !isAssignedToScopedMember(item, scope)) {
    return c.json({ error: 'Task not found' }, 404);
  }

  // Find the member for this project to set checkedBy
  const member = scope.memberByProjectId.get(item.projectId);
  if (!member) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const [list, proj] = await Promise.all([
    db.query.lists.findFirst({ where: eq(lists.id, item.listId) }),
    db.query.projects.findFirst({ where: eq(projects.id, item.projectId) }),
  ]);

  if (!list || !proj) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const action = done ? 'item.checked' : 'item.unchecked';
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(items)
      .set({
        checked: done,
        checkedBy: done ? member.id : null,
        // Keep columnId in lockstep with checked, exactly like the in-app
        // PATCH (routes/items.ts): checking moves to 'done', unchecking a
        // done item falls back to 'todo'.
        columnId: done ? 'done' : item.columnId === 'done' ? 'todo' : item.columnId,
      })
      .where(
        and(
          eq(items.id, taskId),
          eq(items.projectId, item.projectId),
          eq(items.assignedTo, member.id),
          isNull(items.deletedAt),
        ),
      )
      .returning();
    if (!updated) {
      return null;
    }

    const activityEntry = await recordActivity(tx, {
      projectId: item.projectId,
      memberId: member.id,
      action,
      targetType: 'item',
      targetId: taskId,
      meta: { text: item.text, source: 'sp' },
    });
    return { updated, activityEntry };
  });
  if (!result) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const { updated, activityEntry } = result;

  const serialized = serializeItem(updated);
  void sseManager.broadcast(item.projectId, 'item.updated', {
    item: serialized,
    memberId: member.id,
  });
  void sseManager.broadcast(item.projectId, 'activity', { entry: activityEntry });

  return c.json({ task: serializeSPTask(updated, list, proj, appOrigin()) });
});

// GET /api/integration/claimable-tasks - The claim pool: unassigned, not-done,
// not-deleted items in the caller's projects. Optional ?projectId= is the bound
// Space; it is intersected with the caller's scope (never replaces it) so a
// forged id can't probe a foreign Space. Membership-based visibility — a
// private Space's members still see its unclaimed items (sharingMode gates
// joining, not member visibility).
integrationRoutes.get('/claimable-tasks', async (c) => {
  const emailLookup = c.get('apiTokenEmailLookup');

  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    return c.json({ tasks: [] });
  }

  // Intersect (never replace) the requested project with the caller's scope, so
  // a forged ?projectId can't probe a foreign Space. A non-UUID simply matches
  // nothing here (JS string compare, never reaches the DB) → empty result.
  const projectIdParam = c.req.query('projectId');
  let projectIds = scope.projectIds;
  if (projectIdParam !== undefined) {
    projectIds = scope.projectIds.filter((id) => id === projectIdParam);
  }
  if (projectIds.length === 0) {
    return c.json({ tasks: [] });
  }

  // The claim pool is the primary (hero) list only. Checklist-panel items are
  // real `items` rows too, but a checklist is a private tick-list, not shared
  // assignable work, so its items must not surface here. Restrict to items whose
  // backing list has no panel (panel_id IS NULL) -- filtering in SQL (not after
  // the LIMIT) so the pool can't be silently under-filled by checklist rows.
  const primaryListIds = db
    .select({ id: lists.id })
    .from(lists)
    .where(and(inArray(lists.projectId, projectIds), isNull(lists.panelId)));

  const claimable = await db.query.items.findMany({
    where: and(
      inArray(items.projectId, projectIds),
      inArray(items.listId, primaryListIds),
      isNull(items.assignedTo),
      eq(items.checked, false),
      isNull(items.deletedAt),
    ),
    orderBy: desc(items.createdAt),
    limit: CLAIMABLE_TASKS_LIMIT,
  });

  return c.json({ tasks: await toSPTasks(claimable) });
});

// POST /api/integration/tasks/:taskId/claim - Self-assign an unassigned task.
// The assignee is always the caller's own member for that project (never a
// request input), so a PAT can never assign to a third party. Idempotent: a
// task already assigned to the caller returns 200; only a task held by another
// member returns 409.
integrationRoutes.post('/tasks/:taskId/claim', async (c) => {
  const emailLookup = c.get('apiTokenEmailLookup');
  const taskId = c.req.param('taskId');
  if (!isUuid(taskId)) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const item = await db.query.items.findFirst({
    where: and(
      eq(items.id, taskId),
      inArray(items.projectId, scope.projectIds),
      isNull(items.deletedAt),
    ),
  });
  if (!item) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const member = scope.memberByProjectId.get(item.projectId);
  if (!member) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const [list, proj] = await Promise.all([
    db.query.lists.findFirst({ where: eq(lists.id, item.listId) }),
    db.query.projects.findFirst({ where: eq(projects.id, item.projectId) }),
  ]);
  // A checklist-panel item (backing list has a panel) is never claimable -- it
  // isn't in the pool, so it isn't claimable by id either. 404 (not 4xx-leak)
  // so the response is indistinguishable from a non-existent task.
  if (!list || !proj || list.panelId !== null) {
    return c.json({ error: 'Task not found' }, 404);
  }

  // Already mine → idempotent success without a write (the common SP re-import /
  // retry case). The conditional update below also handles a concurrent claim
  // that lands between this read and the update.
  if (item.assignedTo === member.id) {
    return c.json({ task: serializeSPTask(item, list, proj, appOrigin()) });
  }

  // Atomic claim: only succeeds if still unassigned, so two concurrent claims
  // resolve to exactly one winner (same conditional-update pattern as the
  // verification-code claim in routes/projects.ts). No assignmentNotifications
  // row is enqueued: claiming is a self-assignment, which routes/items.ts
  // deliberately skips (the `assignee !== member.id` guard) — pinging yourself
  // about a task you just claimed is noise. Side effects are exactly the
  // item.assigned activity + SSE below.
  const result = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(items)
      .set({ assignedTo: member.id })
      .where(
        and(
          eq(items.id, taskId),
          eq(items.projectId, item.projectId),
          isNull(items.assignedTo),
          isNull(items.deletedAt),
        ),
      )
      .returning();
    if (!claimed) {
      return null;
    }

    const activityEntry = await recordActivity(tx, {
      projectId: item.projectId,
      memberId: member.id,
      action: 'item.assigned',
      targetType: 'item',
      targetId: taskId,
      meta: { text: item.text, assignedTo: member.id, source: 'sp' },
    });
    return { claimed, activityEntry };
  });
  if (!result) {
    // Didn't claim: the task is now assigned. Re-read to distinguish a
    // concurrent claim by *this* member (idempotent 200) from one held by
    // another member (409).
    const current = await db.query.items.findFirst({ where: eq(items.id, taskId) });
    if (current && current.assignedTo === member.id) {
      return c.json({ task: serializeSPTask(current, list, proj, appOrigin()) });
    }
    return c.json({ error: 'Task already claimed' }, 409);
  }

  void sseManager.broadcast(item.projectId, 'item.updated', {
    item: serializeItem(result.claimed),
    memberId: member.id,
  });
  void sseManager.broadcast(item.projectId, 'activity', { entry: result.activityEntry });

  return c.json({ task: serializeSPTask(result.claimed, list, proj, appOrigin()) });
});

// POST /api/integration/spaces - Create a new Space owned by the PAT's email.
// No email-verification code: a valid PAT already proves email ownership (it is
// only minted from inside a Space by an email-verified member), so this is the
// same trust as the proofToken shortcut in POST /api/projects. The new member
// shares the PAT's emailLookup, so the same PAT can immediately act in the new
// Space — no session token is returned.
integrationRoutes.post('/spaces', async (c) => {
  const email = c.get('apiTokenEmail');
  const emailLookup = c.get('apiTokenEmailLookup');

  // Fast path: in-memory per-email burst limit (lib/rate-limit). Resets on
  // restart and is per-instance; the durable per-email lifetime backstop below
  // (inside the insert transaction) is what survives a restart loop.
  if (
    !checkRateLimit(
      `create-space:${emailLookup.toString('hex')}`,
      CREATE_SPACE_LIMIT,
      CREATE_SPACE_WINDOW_MS,
    )
  ) {
    return c.json({ error: 'Too many Spaces created, please try again later' }, 429);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = CreateSpaceViaTokenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  // Consent-record integrity: the new creator member is stamped with the
  // CURRENT TOS_VERSION/now below, so only a caller who has actually accepted
  // the current terms may create a Space. loadIntegrationScope filters on
  // tosVersion === TOS_VERSION (as every other integration route does); an empty
  // scope means this PAT predates a ToS bump — send them back to re-accept
  // in-app rather than fabricating an acceptance they never gave.
  const scope = await loadIntegrationScope(emailLookup);
  if (scope.memberRows.length === 0) {
    // Same shape as middleware/auth.ts (see ErrorResponse.terms in shared
    // types): 428 + terms, so API consumers reuse their existing re-accept
    // flow. The stale member row supplies acceptedVersion/acceptedAt.
    const stale = await db.query.members.findFirst({
      where: and(eq(members.emailLookup, emailLookup), eq(members.emailVerified, true)),
      orderBy: desc(members.tosAcceptedAt),
    });
    return c.json(
      {
        error: 'Please re-accept the updated terms in the app before creating a Space',
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        terms: {
          currentVersion: TOS_VERSION,
          acceptedVersion: stale?.tosVersion ?? null,
          acceptedAt: stale?.tosAcceptedAt?.toISOString() ?? null,
          acceptanceRequired: true,
        },
      },
      428,
    );
  }

  const memberEmail = normalizeEmail(email);
  // displayName defaults to the email local-part (clamped); never empty.
  const displayName =
    (parsed.data.displayName ?? memberEmail.split('@')[0]).slice(0, MAX_DISPLAY_NAME_LENGTH) ||
    'Member';
  const slug = nanoid(SLUG_LENGTH);

  const result = await db.transaction(async (tx) => {
    // Durable backstop: count existing Spaces this email created and refuse
    // past the lifetime ceiling. Read inside the txn so it sees a consistent
    // snapshot; not strictly serialized under READ COMMITTED, but the burst
    // limiter above bounds any overshoot. Cheap: idx_members_email_lookup.
    const [{ n }] = await tx
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.emailLookup, emailLookup), eq(members.isCreator, true)));
    if (n >= CREATE_SPACE_LIFETIME_LIMIT) return null;

    const [project] = await tx
      .insert(projects)
      .values({ slug, name: parsed.data.name, purpose: parsed.data.purpose })
      .returning();

    const [member] = await tx
      .insert(members)
      .values({
        projectId: project.id,
        // No member_tokens session row: SP acts via its PAT (api_tokens), never
        // a member bearer token, so this creator member needs no session.
        displayName,
        ...encryptedEmailFields(memberEmail),
        emailVerified: true,
        color: MEMBER_COLORS[0],
        avatarIndex: 0,
        isCreator: true,
        role: 'admin',
        tosVersion: TOS_VERSION,
        tosAcceptedAt: new Date(),
      })
      .returning();

    await ensureProjectDefaults(tx, { projectId: project.id, memberId: member.id });
    return { project, member };
  });

  if (!result) {
    return c.json({ error: 'Space creation limit reached for this account' }, 429);
  }
  const { project, member } = result;

  return c.json(
    {
      project: serializeProject(project),
      url: projectUrl(appOrigin(), project.slug),
      memberId: member.id,
    },
    201,
  );
});
