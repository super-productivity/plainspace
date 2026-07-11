import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { members, projects } from '../db/schema.js';
import {
  JoinProjectSchema,
  UpdateMemberSchema,
  MEMBER_COLORS,
  AVATAR_COUNT,
  MAX_MEMBERS_PER_PROJECT,
  TOS_VERSION,
} from '@plainspace/shared';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { issueMemberToken } from '../lib/member-tokens.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeMember } from '../lib/serialize.js';
import { sseManager } from '../services/sse-manager.js';
import { recordActivity } from '../services/activity.js';
import { deleteMemberAndScrubIdentifiers } from '../services/member-deletion.js';
import { buildMemberExport } from '../services/member-export.js';
import { checkRateLimit, getClientIp } from '../lib/rate-limit.js';
import { readJson } from '../lib/json.js';

const devBypass = process.env.NODE_ENV === 'development';

export const memberRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// POST /api/projects/:slug/members/join - Join a project (unauthenticated)
memberRoutes.post('/join', async (c) => {
  if (!devBypass) {
    const ip = getClientIp(c);
    // Same vector as project creation: an open project's /join endpoint can
    // be flooded with anonymous member rows.
    if (!checkRateLimit(`join:${ip}`, 10, 15 * 60 * 1000)) {
      return c.json({ error: 'Too many attempts, please try again later' }, 429);
    }
  }

  const project = c.get('project');

  // Spaces with link joining turned off do not allow self-join.
  if (project.sharingMode === 'private') {
    return c.json({ error: 'Joining is off for this Space.' }, 403);
  }

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = JoinProjectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const { displayName } = parsed.data;

  const joinResult = await db.transaction(async (tx) => {
    // Project snapshots include every member. Serialize joins on the project
    // row so concurrent requests cannot both claim the last available slot.
    await tx.execute(
      sql`SELECT 1 FROM ${projects} WHERE ${projects.id} = ${project.id} FOR UPDATE`,
    );
    // Only the count and taken colors matter here; skip the encrypted email
    // blobs the full row would pull for up to 100 members.
    const existingMembers = await tx.query.members.findMany({
      where: eq(members.projectId, project.id),
      columns: { color: true },
    });
    if (existingMembers.length >= MAX_MEMBERS_PER_PROJECT) {
      return null;
    }

    const usedColors = new Set(existingMembers.map((member) => member.color));
    const color =
      MEMBER_COLORS.find((candidate) => !usedColors.has(candidate)) ??
      MEMBER_COLORS[existingMembers.length % MEMBER_COLORS.length];
    const avatarIndex = existingMembers.length % AVATAR_COUNT;

    const [member] = await tx
      .insert(members)
      .values({
        projectId: project.id,
        displayName,
        color,
        avatarIndex,
        isCreator: false,
        tosVersion: TOS_VERSION,
        tosAcceptedAt: new Date(),
      })
      .returning();

    const token = await issueMemberToken(tx, member.id);

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'member.joined',
      targetType: 'member',
      targetId: member.id,
      meta: { displayName },
    });
    return { member, token, activityEntry };
  });

  if (joinResult === null) {
    return c.json({ error: `A Space can have at most ${MAX_MEMBERS_PER_PROJECT} members` }, 422);
  }

  const { member, token, activityEntry } = joinResult;

  const serialized = serializeMember(member, member.id);
  void sseManager.broadcast(project.id, 'member.joined', {
    member: serializeMember(member),
  });
  void sseManager.broadcast(project.id, 'activity', { entry: activityEntry });
  return c.json(
    {
      member: serialized,
      token,
    },
    201,
  );
});

// DELETE /api/projects/:slug/members/me - Self-delete from this Space
memberRoutes.delete('/me', authMiddleware, async (c) => {
  const member = c.get('member');
  const project = c.get('project');

  if (member.isCreator) {
    return c.json(
      {
        error:
          'As the creator of this Space, you cannot leave it on your own. Please contact us at hello@plainspace.org to delete the entire Space.',
      },
      409,
    );
  }

  await db.transaction((tx) => deleteMemberAndScrubIdentifiers(tx, project.id, member));

  sseManager.disconnectMember(project.id, member.id);
  void sseManager.broadcast(project.id, 'member.removed', { memberId: member.id });

  return c.body(null, 204);
});

// GET /api/projects/:slug/members/me/export - Download own data as JSON
// (GDPR Art. 15 access / Art. 20 portability), scoped to this Space.
memberRoutes.get('/me/export', authMiddleware, async (c) => {
  const member = c.get('member');
  const project = c.get('project');

  const data = await buildMemberExport(project, member);

  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="plainspace-export-${project.slug}.json"`);
  return c.body(JSON.stringify(data, null, 2));
});

// PATCH /api/projects/:slug/members/me - Update own display name
memberRoutes.patch('/me', authMiddleware, async (c) => {
  const member = c.get('member');
  const project = c.get('project');

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = UpdateMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  const { updated, activityEntry } = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(members)
      .set({ displayName: parsed.data.displayName })
      .where(and(eq(members.id, member.id), eq(members.projectId, project.id)))
      .returning();

    const activityEntry = await recordActivity(tx, {
      projectId: project.id,
      memberId: member.id,
      action: 'member.updated',
      targetType: 'member',
      targetId: member.id,
      meta: { displayName: parsed.data.displayName, oldDisplayName: member.displayName },
    });
    return { updated, activityEntry };
  });

  const serialized = serializeMember(updated, updated.id);
  void sseManager.broadcast(project.id, 'member.updated', {
    member: serializeMember(updated),
  });
  void sseManager.broadcast(project.id, 'activity', { entry: activityEntry });
  return c.json({ member: serialized });
});
