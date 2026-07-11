import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { members, projects } from '../db/schema.js';
import { decryptStoredEmail } from '../lib/email-crypto.js';
import {
  authMiddleware,
  requireAdmin,
  requireCreator,
  type AuthContext,
} from '../middleware/auth.js';
import { uuidParam } from '../middleware/uuid-param.js';
import type { ProjectContext } from '../middleware/project.js';
import { serializeMember, serializeProject } from '../lib/serialize.js';
import { sseManager } from '../services/sse-manager.js';
import { sendStatementOfReasons } from '../services/email.js';
import { recordActivity } from '../services/activity.js';
import {
  deleteMemberAndScrubIdentifiers,
  scrubOrphanedApiTokensForProject,
} from '../services/member-deletion.js';
import { readJson } from '../lib/json.js';

export const adminRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// PATCH /api/projects/:slug/auth/settings - Update project settings (admin only)
adminRoutes.patch('/settings', authMiddleware, requireAdmin, async (c) => {
  const project = c.get('project');
  const member = c.get('member');

  const body = await readJson(c);
  if (body === null) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const sharingMode = (body as { sharingMode?: string })?.sharingMode;

  if (sharingMode && !['open', 'private'].includes(sharingMode)) {
    return c.json({ error: 'Invalid sharing mode' }, 422);
  }

  if (sharingMode) {
    if (sharingMode === 'private' && !member.emailVerified) {
      return c.json({ error: 'Add an email to this Space before turning link joining off' }, 400);
    }

    await db
      .update(projects)
      .set({ sharingMode, updatedAt: new Date() })
      .where(eq(projects.id, project.id));
  }

  const updated = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });

  if (!updated) {
    return c.json({ error: 'Space not found' }, 404);
  }

  const serialized = serializeProject(updated);
  void sseManager.broadcast(project.id, 'project.updated', { project: serialized });
  return c.json({ project: serialized });
});

// DELETE /api/projects/:slug/auth/members/:memberId - Remove member (admin only)
// Optional JSON body: { reason: string, language?: 'en' | 'de' }. If a reason
// is supplied AND the target has a known email, the affected user is sent a
// DSA Art. 17 Statement of Reasons before deletion (so we still have the
// plaintext email to send to). The reason is mirrored in the activity log.
adminRoutes.delete(
  '/members/:memberId',
  authMiddleware,
  requireAdmin,
  uuidParam('memberId'),
  async (c) => {
    const project = c.get('project');
    const member = c.get('member');
    const targetId = c.req.param('memberId');

    if (targetId === member.id) {
      return c.json({ error: 'Cannot remove yourself' }, 400);
    }

    // Body is optional; legacy callers (no JSON) still work.
    const rawBody = await c.req.json().catch(() => null);
    const reason =
      typeof rawBody === 'object' &&
      rawBody !== null &&
      typeof (rawBody as { reason?: unknown }).reason === 'string'
        ? (rawBody as { reason: string }).reason.trim().slice(0, 4000)
        : null;
    const language =
      typeof rawBody === 'object' &&
      rawBody !== null &&
      (rawBody as { language?: unknown }).language === 'de'
        ? 'de'
        : 'en';

    const target = await db.query.members.findFirst({
      where: and(eq(members.id, targetId), eq(members.projectId, project.id)),
    });

    if (!target) {
      return c.json({ error: 'Member not found' }, 404);
    }

    // The creator's record can never be removed by anyone (including a
    // non-creator admin). Deleting it would also orphan the role model:
    // POST /members/:id/role is creator-only, so a Space with no creator
    // can never reassign roles again.
    if (target.isCreator) {
      return c.json({ error: 'The Space creator cannot be removed' }, 403);
    }

    // Decrypt before the delete cascades the row away; the SoR itself is sent
    // after the transaction commits, so a failed removal can't produce a
    // removal notice for a member who is still in the Space.
    const targetEmail = decryptStoredEmail(target);

    await db.transaction(async (tx) => {
      // Record the suspension reason in the activity log before the cascade
      // nulls memberId references. This is what an auditor reads later.
      await recordActivity(tx, {
        projectId: project.id,
        memberId: member.id,
        action: 'member.removed',
        targetType: 'member',
        targetId,
        meta: {
          reason: reason ?? '(no reason supplied)',
          sorSent: Boolean(reason && targetEmail),
          sorLanguage: reason && targetEmail ? language : null,
        },
      });
      await deleteMemberAndScrubIdentifiers(tx, project.id, target);
    });

    // Send the Statement of Reasons now that the removal is committed. Failure
    // here is logged but does not undo the suspension: the operator must still
    // be able to act (the activity log records that an SoR was intended).
    if (reason && targetEmail) {
      await sendStatementOfReasons({
        toEmail: targetEmail,
        language,
        action: `Removal of your member record in the Space "${project.name}".`,
        factsAndCircumstances: reason,
        groundReference: 'Plainspace Terms of Service §7 (Acceptable Use)',
      }).catch((err: unknown) => {
        // Log the message only: a raw nodemailer error can embed the
        // recipient address, and emails stay out of plaintext logs.
        console.error('Failed to send Statement of Reasons', {
          projectId: project.id,
          targetId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    sseManager.disconnectMember(project.id, targetId);
    void sseManager.broadcast(project.id, 'member.removed', { memberId: targetId });
    void sseManager.broadcast(project.id, 'presence', {
      online: sseManager.getOnlineMemberIds(project.id),
    });

    return c.body(null, 204);
  },
);

// DELETE /api/projects/:slug/auth/space - Permanently delete the entire Space
// (creator only). One DELETE on the projects row cascades to members, items,
// lists, panels, polls, activity, session tokens, etc. (every child table is
// `ON DELETE CASCADE` from projects or from a row that is). Two deliberate
// exceptions: dsa_notices are NOT cascaded (loose-string slug refs keep the
// Art. 16 audit trail alive), and apiTokens are keyed by email and shared
// across Spaces, so the cascade can't reach them — we scrub the now-orphaned
// ones first, in the same transaction, mirroring per-member deletion.
//
// Afterward, broadcasting `project.deleted` tells connected clients to leave
// (they navigate home); the explicit disconnect then drops any stream that
// didn't self-close. Other devices' tokens are gone with the cascade, so even
// a client that misses the event 401s on its next request.
adminRoutes.delete('/space', authMiddleware, requireCreator, async (c) => {
  const project = c.get('project');

  await db.transaction(async (tx) => {
    await scrubOrphanedApiTokensForProject(tx, project.id);
    await tx.delete(projects).where(eq(projects.id, project.id));
  });

  // Awaited (unlike other broadcasts, which are fire-and-forget):
  // disconnectProject closes every stream, so the farewell event must flush
  // before the close.
  await sseManager.broadcast(project.id, 'project.deleted', { projectId: project.id });
  sseManager.disconnectProject(project.id);

  return c.body(null, 204);
});

// POST /api/projects/:slug/auth/members/:memberId/role - Update member role (creator only)
adminRoutes.post(
  '/members/:memberId/role',
  authMiddleware,
  requireCreator,
  uuidParam('memberId'),
  async (c) => {
    const project = c.get('project');
    const targetId = c.req.param('memberId');

    const body = await readJson(c);
    if (body === null) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const role = (body as { role?: string })?.role;
    if (!role || !['admin', 'member'].includes(role)) {
      return c.json({ error: 'Invalid role' }, 422);
    }

    const [updated] = await db
      .update(members)
      .set({ role })
      .where(and(eq(members.id, targetId), eq(members.projectId, project.id)))
      .returning();

    if (!updated) {
      return c.json({ error: 'Member not found' }, 404);
    }

    const serialized = serializeMember(updated);
    void sseManager.broadcast(project.id, 'member.updated', { member: serialized });

    return c.json({ member: serialized });
  },
);
