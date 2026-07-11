import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  activity,
  items,
  lists,
  members,
  panels,
  pollVotes,
  projects,
  scratchpads,
  timeslotResponses,
} from '../db/schema.js';
import { decryptStoredEmail } from '../lib/email-crypto.js';

type MemberRow = typeof members.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

// GDPR Art. 15/20 export of one member's data within a single Space. Scoped to
// the requesting member's own authorship — a member.id is unique to one Space,
// so member-keyed lookups are already project-scoped. Everything here is data
// the member can already read in-app, so a shared-collaborative scratchpad they
// edited is theirs to take, not a new disclosure of others' data.
export async function buildMemberExport(project: ProjectRow, member: MemberRow) {
  const projectId = project.id;
  const [
    authoredItems,
    authoredLists,
    editedScratchpads,
    authoredPanels,
    votes,
    slotResponses,
    ownActivity,
  ] = await Promise.all([
    db.query.items.findMany({
      where: and(eq(items.projectId, projectId), eq(items.createdBy, member.id)),
    }),
    db.query.lists.findMany({
      where: and(eq(lists.projectId, projectId), eq(lists.createdBy, member.id)),
    }),
    db.query.scratchpads.findMany({
      where: and(
        eq(scratchpads.projectId, projectId),
        or(eq(scratchpads.createdBy, member.id), eq(scratchpads.updatedBy, member.id)),
      ),
    }),
    db.query.panels.findMany({
      where: and(eq(panels.projectId, projectId), eq(panels.createdBy, member.id)),
    }),
    db.query.pollVotes.findMany({ where: eq(pollVotes.memberId, member.id) }),
    db.query.timeslotResponses.findMany({ where: eq(timeslotResponses.memberId, member.id) }),
    db.query.activity.findMany({
      where: and(eq(activity.projectId, projectId), eq(activity.memberId, member.id)),
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    space: { slug: project.slug, name: project.name, purpose: project.purpose },
    member: {
      id: member.id,
      displayName: member.displayName,
      email: decryptStoredEmail(member),
      emailVerified: member.emailVerified,
      role: member.role,
      isCreator: member.isCreator,
      color: member.color,
      avatarIndex: member.avatarIndex,
      tosVersion: member.tosVersion,
      tosAcceptedAt: member.tosAcceptedAt?.toISOString() ?? null,
      joinedAt: member.joinedAt.toISOString(),
    },
    contributions: {
      items: authoredItems.map((i) => ({
        id: i.id,
        text: i.text,
        checked: i.checked,
        columnId: i.columnId,
        position: i.position,
        listId: i.listId,
        remindAt: i.remindAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
        deletedAt: i.deletedAt?.toISOString() ?? null,
      })),
      lists: authoredLists.map((l) => ({
        id: l.id,
        columns: l.columns,
        createdAt: l.createdAt.toISOString(),
      })),
      scratchpadEdits: editedScratchpads.map((s) => ({
        content: s.content,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      panels: authoredPanels.map((p) => ({
        id: p.id,
        type: p.type,
        createdAt: p.createdAt.toISOString(),
      })),
      pollVotes: votes.map((v) => ({
        panelId: v.panelId,
        optionId: v.optionId,
        createdAt: v.createdAt.toISOString(),
      })),
      timeslotResponses: slotResponses.map((r) => ({
        panelId: r.panelId,
        slotId: r.slotId,
        createdAt: r.createdAt.toISOString(),
      })),
      activity: ownActivity.map((a) => ({
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        meta: a.meta,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  };
}
