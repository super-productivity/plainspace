import { ACTIVITY_ACTIONS } from '@plainspace/shared';
import type {
  Project,
  Member,
  List,
  Item,
  Scratchpad,
  ActivityEntry,
  ActivityAction,
  PollPanel,
  TimeSlotPanel,
  ChecklistPanel,
  ApiToken,
} from '@plainspace/shared';
import {
  projects,
  members,
  lists,
  items,
  scratchpads,
  activity,
  panels,
  polls,
  pollVotes,
  timeslots,
  timeslotResponses,
  apiTokens,
} from '../db/schema.js';
import { decryptStoredEmail } from './email-crypto.js';

type ProjectRow = typeof projects.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type ListRow = typeof lists.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type ActivityRow = typeof activity.$inferSelect;
type PanelRow = typeof panels.$inferSelect;
type PollRow = typeof polls.$inferSelect;
type PollVoteRow = typeof pollVotes.$inferSelect;
type TimeSlotRow = typeof timeslots.$inferSelect;
type TimeSlotResponseRow = typeof timeslotResponses.$inferSelect;
type ApiTokenRow = typeof apiTokens.$inferSelect;

export function serializeProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    purpose: row.purpose,
    sharingMode: row.sharingMode as 'open' | 'private',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked =
    local.length <= 2
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

// Omit `currentMemberId` to get the public shape (masked email, null tos*).
// Pass it (matching `row.id`) to include current-user fields.
export function serializeMember(row: MemberRow, currentMemberId?: string): Member {
  const isCurrent = row.id === currentMemberId;
  const plaintext = decryptStoredEmail(row);
  return {
    id: row.id,
    projectId: row.projectId,
    displayName: row.displayName,
    color: row.color,
    avatarIndex: row.avatarIndex,
    email: plaintext && isCurrent ? plaintext : plaintext ? maskEmail(plaintext) : null,
    emailVerified: row.emailVerified,
    isCreator: row.isCreator,
    role: row.role as 'admin' | 'member',
    tosVersion: isCurrent ? row.tosVersion : null,
    tosAcceptedAt: isCurrent ? (row.tosAcceptedAt?.toISOString() ?? null) : null,
    joinedAt: row.joinedAt.toISOString(),
  };
}

export function serializeApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeList(row: ListRow): List {
  return {
    id: row.id,
    projectId: row.projectId,
    columns: (row.columns as Array<{ id: string; name: string }> | null) ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeItem(row: ItemRow): Item {
  return {
    id: row.id,
    listId: row.listId,
    projectId: row.projectId,
    text: row.text,
    checked: row.checked,
    checkedBy: row.checkedBy,
    assignedTo: row.assignedTo,
    columnId: row.columnId,
    position: row.position,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    remindAt: row.remindAt?.toISOString() ?? null,
    repeat: row.repeat ?? null,
  };
}

type ScratchpadRow = typeof scratchpads.$inferSelect;

export function serializeScratchpad(row: ScratchpadRow): Scratchpad {
  return {
    id: row.id,
    projectId: row.projectId,
    content: row.content,
    updatedBy: row.updatedBy,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Attachments are disabled — see project CLAUDE.md. serializeAttachment was
// removed along with the S3 presigner; restore from git history (commit c4e44d4)
// to re-enable.

// Flat, client-facing poll panel. Panel layout fields + per-type content
// inlined, matching the shared `PollPanel` discriminated-union shape.
export function serializePollPanel(
  panel: PanelRow,
  poll: PollRow,
  votes: PollVoteRow[],
): PollPanel {
  return {
    id: panel.id,
    projectId: panel.projectId,
    type: 'poll',
    createdBy: panel.createdBy,
    createdAt: panel.createdAt.toISOString(),
    question: poll.question,
    options: poll.options,
    votes: votes.map((v) => ({ optionId: v.optionId, memberId: v.memberId })),
  };
}

// Flat, client-facing timeslot panel. Panel layout fields + per-type content
// inlined, matching the shared `TimeSlotPanel` discriminated-union shape.
export function serializeTimeSlotPanel(
  panel: PanelRow,
  timeslot: TimeSlotRow,
  responses: TimeSlotResponseRow[],
): TimeSlotPanel {
  return {
    id: panel.id,
    projectId: panel.projectId,
    type: 'timeslot',
    createdBy: panel.createdBy,
    createdAt: panel.createdAt.toISOString(),
    title: timeslot.title,
    slots: timeslot.slots,
    responses: responses.map((r) => ({ slotId: r.slotId, memberId: r.memberId })),
  };
}

// Flat, client-facing checklist panel. Carries only the backing list's id and
// title -- the items live in the project `items` array (filtered client-side by
// `listId`), so there is no per-type content table or inlined item list.
export function serializeChecklistPanel(panel: PanelRow, list: ListRow): ChecklistPanel {
  return {
    id: panel.id,
    projectId: panel.projectId,
    type: 'checklist',
    createdBy: panel.createdBy,
    createdAt: panel.createdAt.toISOString(),
    listId: list.id,
    title: list.title ?? '',
  };
}

function toActivityAction(action: string): ActivityAction | null {
  return (ACTIVITY_ACTIONS as readonly string[]).includes(action)
    ? (action as ActivityAction)
    : null;
}

export function serializeActivity(row: ActivityRow): ActivityEntry | null {
  const action = toActivityAction(row.action);
  if (!action) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    memberId: row.memberId,
    action,
    targetType: row.targetType,
    targetId: row.targetId,
    meta: row.meta as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeRecordedActivity(row: ActivityRow): ActivityEntry {
  const serialized = serializeActivity(row);
  if (!serialized) {
    throw new Error(`Unknown activity action "${row.action}"`);
  }
  return serialized;
}
