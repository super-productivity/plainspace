import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, isNull, and, gt, inArray, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/connection.js';
import { readJson } from '../lib/json.js';
import {
  projects,
  members,
  items,
  lists,
  creationVerifications,
  panels,
  polls,
  pollVotes,
  timeslots,
  timeslotResponses,
} from '../db/schema.js';
import { CreateProjectSchema, SLUG_LENGTH, MEMBER_COLORS, TOS_VERSION } from '@plainspace/shared';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { issueMemberToken } from '../lib/member-tokens.js';
import { emailIndex, encryptedEmailFields, normalizeEmail } from '../lib/email-crypto.js';
import { resolveProofEmail } from '../lib/proof-token.js';
import { projectMiddleware, type ProjectContext } from '../middleware/project.js';
import { memberRoutes } from './members.js';
import { listRoutes } from './lists.js';
import { itemRoutes } from './items.js';
import { activityRoutes } from './activity.js';
import { nudgeRoutes } from './nudge.js';
import { sseRoutes } from './sse.js';
import { scratchpadRoutes } from './scratchpads.js';
import { panelRoutes } from './panels.js';
import { pushRoutes } from './push.js';
import { authRoutes } from './auth.js';
import { verificationRoutes } from './verification.js';
import { adminRoutes } from './admin.js';
import { apiTokenRoutes } from './api-tokens.js';
import {
  serializeProject,
  serializeMember,
  serializeList,
  serializeItem,
  serializeScratchpad,
  serializePollPanel,
  serializeTimeSlotPanel,
  serializeChecklistPanel,
} from '../lib/serialize.js';
import type { PanelView } from '@plainspace/shared';
import { checkRateLimit, getClientIp } from '../lib/rate-limit.js';
import { ensureProjectDefaults } from '../services/project-defaults.js';

export const projectRoutes = new Hono();

// Fail-closed: only bypass verification when NODE_ENV is explicitly
// 'development'. Anything else (unset, 'staging', typos) enforces the gate.
const devBypass = process.env.NODE_ENV === 'development';

// POST /api/projects - Create a new project. In production this requires a
// verification code issued by POST /api/auth/request-creation-code; in dev
// the code is optional so local testing isn't gated on receiving an email.
projectRoutes.post('/', async (c) => {
  if (!devBypass) {
    const ip = getClientIp(c);
    // Caps brute-force attempts at the 6-digit code (1M combos) before the
    // 10-minute expiry can be exhausted.
    if (!checkRateLimit(`create-project:${ip}`, 10, 15 * 60 * 1000)) {
      return c.json({ error: 'Too many attempts, please try again later' }, 429);
    }
  }

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400);
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const { name, purpose, displayName, email, code, proofToken } = parsed.data;
  const slug = nanoid(SLUG_LENGTH);

  // Global account: a token from another Space whose verified email matches this
  // one proves email control, standing in for the creation code so a returning
  // user creates further Spaces in one step. Resolved outside the tx (a read).
  const proofEmail = await resolveProofEmail(proofToken);
  const proofVerified = proofEmail !== null && proofEmail === normalizeEmail(email);

  const { project, member, token } = await db.transaction(async (tx) => {
    // Canonicalize: emailIndex normalizes (trim + lowercase) before HMAC, so
    // the stored lookup buffer is stable across casing variants.
    const memberEmail = email.toLowerCase();

    // Verify a supplied creation code (and consume it so it can't be reused). A
    // valid code — or a matching proof token — is what marks the creator's email
    // verified. Production REQUIRES one of the two; dev allows codeless creation
    // (so local testing isn't gated on receiving an email) but still verifies a
    // supplied valid code, so token-gated flows like Connect work in dev too.
    let codeVerified = false;
    if (!proofVerified && code) {
      const verification = await tx.query.creationVerifications.findFirst({
        where: and(
          eq(creationVerifications.emailLookup, emailIndex(memberEmail)),
          eq(creationVerifications.code, code),
          isNull(creationVerifications.usedAt),
          gt(creationVerifications.expiresAt, new Date()),
        ),
      });
      if (verification) {
        // Mark used with usedAt IS NULL in the predicate so two concurrent
        // requests can't both claim the same code under READ COMMITTED.
        const claimed = await tx
          .update(creationVerifications)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(creationVerifications.id, verification.id),
              isNull(creationVerifications.usedAt),
            ),
          )
          .returning({ id: creationVerifications.id });
        codeVerified = claimed.length > 0;
      }
    }
    if (!devBypass && !proofVerified && !codeVerified) {
      throw new HTTPException(401, {
        message: code ? 'Invalid or expired verification code' : 'Email verification required',
      });
    }

    const [project] = await tx.insert(projects).values({ slug, name, purpose }).returning();

    const [member] = await tx
      .insert(members)
      .values({
        projectId: project.id,
        displayName,
        ...encryptedEmailFields(memberEmail),
        emailVerified: proofVerified || codeVerified,
        color: MEMBER_COLORS[0],
        avatarIndex: 0,
        isCreator: true,
        role: 'admin',
        tosVersion: TOS_VERSION,
        tosAcceptedAt: new Date(),
      })
      .returning();

    const token = await issueMemberToken(tx, member.id);

    await ensureProjectDefaults(tx, { projectId: project.id, memberId: member.id });

    return { project, member, token };
  });

  return c.json(
    {
      project: serializeProject(project),
      member: serializeMember(member, member.id),
      token,
    },
    201,
  );
});

// All routes below need :slug
const slugRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// GET /api/projects/:slug/info - Public project info (unauthenticated)
slugRoutes.get('/info', (c) => {
  const project = c.get('project');
  if (project.sharingMode === 'private') {
    return c.json({
      name: 'Space',
      purpose: '',
      sharingMode: project.sharingMode,
    });
  }

  return c.json({
    name: project.name,
    purpose: project.purpose,
    sharingMode: project.sharingMode,
  });
});

// GET /api/projects/:slug/summary - Lightweight load for the landing page
// (name, purpose, members). Authenticated; no side effects, unlike GET '/'
// which lazy-creates the list and scratchpad rows.
slugRoutes.get('/summary', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const projectMembers = await db.query.members.findMany({
    where: eq(members.projectId, project.id),
  });
  return c.json({
    name: project.name,
    purpose: project.purpose,
    members: projectMembers.map((m) => serializeMember(m, member.id)),
  });
});

// GET /api/projects/:slug - Full project load (authenticated)
slugRoutes.get('/', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  const [projectMembers, projectItems, projectPanels] = await Promise.all([
    db.query.members.findMany({
      where: eq(members.projectId, project.id),
    }),
    db.query.items.findMany({
      where: and(eq(items.projectId, project.id), isNull(items.deletedAt)),
    }),
    db.query.panels.findMany({
      where: eq(panels.projectId, project.id),
      orderBy: asc(panels.createdAt),
    }),
  ]);

  // Assemble flat PanelView[] in createdAt order: panel layout + per-type
  // content. Partition ids by type so polls load poll content and timeslots load
  // timeslot content. Two round trips so the empty-panels case stays a single
  // `findMany` (no pointless `inArray([])` queries).
  let serializedPanels: PanelView[] = [];
  if (projectPanels.length > 0) {
    const pollIds = projectPanels.filter((p) => p.type === 'poll').map((p) => p.id);
    const timeslotIds = projectPanels.filter((p) => p.type === 'timeslot').map((p) => p.id);
    const checklistIds = projectPanels.filter((p) => p.type === 'checklist').map((p) => p.id);
    const [pollRows, voteRows, timeslotRows, responseRows, checklistListRows] = await Promise.all([
      pollIds.length ? db.query.polls.findMany({ where: inArray(polls.panelId, pollIds) }) : [],
      pollIds.length
        ? db.query.pollVotes.findMany({ where: inArray(pollVotes.panelId, pollIds) })
        : [],
      timeslotIds.length
        ? db.query.timeslots.findMany({ where: inArray(timeslots.panelId, timeslotIds) })
        : [],
      timeslotIds.length
        ? db.query.timeslotResponses.findMany({
            where: inArray(timeslotResponses.panelId, timeslotIds),
          })
        : [],
      // Checklist content is the backing list (id + title); its items ride in
      // the project `items` array below, filtered client-side by listId.
      checklistIds.length
        ? db.query.lists.findMany({ where: inArray(lists.panelId, checklistIds) })
        : [],
    ]);
    const pollByPanel = new Map(pollRows.map((r) => [r.panelId, r]));
    const votesByPanel = new Map<string, (typeof pollVotes.$inferSelect)[]>();
    for (const v of voteRows) {
      const arr = votesByPanel.get(v.panelId);
      if (arr) arr.push(v);
      else votesByPanel.set(v.panelId, [v]);
    }
    const timeslotByPanel = new Map(timeslotRows.map((r) => [r.panelId, r]));
    const responsesByPanel = new Map<string, (typeof timeslotResponses.$inferSelect)[]>();
    for (const r of responseRows) {
      const arr = responsesByPanel.get(r.panelId);
      if (arr) arr.push(r);
      else responsesByPanel.set(r.panelId, [r]);
    }
    const listByPanel = new Map(checklistListRows.map((l) => [l.panelId, l]));
    serializedPanels = projectPanels.flatMap<PanelView>((panel) => {
      if (panel.type === 'poll') {
        const poll = pollByPanel.get(panel.id);
        if (!poll) return [];
        return [serializePollPanel(panel, poll, votesByPanel.get(panel.id) ?? [])];
      }
      if (panel.type === 'checklist') {
        const list = listByPanel.get(panel.id);
        if (!list) return [];
        return [serializeChecklistPanel(panel, list)];
      }
      const timeslot = timeslotByPanel.get(panel.id);
      if (!timeslot) return [];
      return [serializeTimeSlotPanel(panel, timeslot, responsesByPanel.get(panel.id) ?? [])];
    });
  }

  const { list: projectList, scratchpad: projectScratchpad } = await ensureProjectDefaults(db, {
    projectId: project.id,
    memberId: member.id,
  });

  return c.json({
    project: serializeProject(project),
    list: serializeList(projectList),
    items: projectItems.map(serializeItem),
    members: projectMembers.map((m) => serializeMember(m, member.id)),
    scratchpad: serializeScratchpad(projectScratchpad),
    // Attachments are disabled — see project CLAUDE.md "Attachments (disabled)".
    attachments: [],
    panels: serializedPanels,
    terms: {
      currentVersion: TOS_VERSION,
      acceptedVersion: member.tosVersion,
      acceptedAt: member.tosAcceptedAt?.toISOString() ?? null,
      acceptanceRequired: member.tosVersion !== TOS_VERSION,
    },
  });
});

// Mount sub-routes
slugRoutes.route('/members', memberRoutes);
slugRoutes.route('/lists', listRoutes);
slugRoutes.route('/items', itemRoutes);
slugRoutes.route('/activity', activityRoutes);
slugRoutes.route('/nudge', nudgeRoutes);
slugRoutes.route('/events', sseRoutes);
slugRoutes.route('/scratchpads', scratchpadRoutes);
slugRoutes.route('/panels', panelRoutes);
slugRoutes.route('/push', pushRoutes);
// /auth hosts four routers with disjoint paths: login recovery + terms,
// email verification/merge, admin actions, and API tokens.
slugRoutes.route('/auth', authRoutes);
slugRoutes.route('/auth', verificationRoutes);
slugRoutes.route('/auth', adminRoutes);
slugRoutes.route('/auth', apiTokenRoutes);

// Mount slug routes with project middleware
projectRoutes.route('/:slug', new Hono().use('*', projectMiddleware).route('/', slugRoutes));
