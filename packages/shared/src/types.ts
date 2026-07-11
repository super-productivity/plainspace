export interface Project {
  id: string;
  slug: string;
  name: string;
  purpose: string;
  sharingMode: 'open' | 'private';
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  projectId: string;
  displayName: string;
  color: string;
  avatarIndex: number;
  email: string | null;
  emailVerified: boolean;
  isCreator: boolean;
  role: 'admin' | 'member';
  tosVersion: string | null;
  tosAcceptedAt: string | null;
  joinedAt: string;
}

export interface KanbanColumn {
  id: string;
  name: string;
}

export interface List {
  id: string;
  projectId: string;
  columns: KanbanColumn[] | null;
  createdBy: string | null;
  createdAt: string;
}

export interface RepeatRule {
  freq: 'daily' | 'weekly' | 'monthly';
  /** every N days/weeks/months; 1–365 */
  interval: number;
  /** weekly only — RRULE weekday tokens, e.g. ['MO','TH'] */
  byWeekday?: ('MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU')[];
  /** monthly only — 1–31 */
  byMonthDay?: number;
  /** IANA zone captured from the browser when the rule is set,
   *  e.g. 'Europe/Berlin'. Maps to RRULE TZID. */
  tz: string;
  /** ISO instant of the first occurrence — RRULE DTSTART. Set by the
   *  SERVER, never sent by the client, never mutated by the sweep. Changes
   *  ONLY when the rule is first created or when a PATCH explicitly sets
   *  remindAt (re-stamping on unrelated PATCHes would leak retry/DST-shifted
   *  timestamps into the series). Sole source of the series' wall-clock
   *  time-of-day and interval>1 phase. */
  anchor: string;
}

export interface Item {
  id: string;
  listId: string;
  projectId: string;
  text: string;
  checked: boolean;
  checkedBy: string | null;
  assignedTo: string | null;
  columnId: string;
  position: number;
  createdBy: string | null;
  remindAt: string | null;
  createdAt: string;
  repeat: RepeatRule | null;
}

export interface Scratchpad {
  id: string;
  projectId: string;
  content: string;
  updatedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  projectId: string;
  itemId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
  url: string;
}

export interface PollOption {
  id: string;
  text: string;
}

export interface PollVote {
  optionId: string;
  memberId: string;
}

// Flat, discriminated on `type`.
export interface PollPanel {
  id: string;
  projectId: string;
  type: 'poll';
  createdBy: string | null;
  createdAt: string;
  question: string;
  options: PollOption[];
  votes: PollVote[];
}

export interface TimeSlot {
  id: string;
  label: string;
}

// A response means "this member is available for this slot"; absence means
// not-available/no-response. Multi-select: a member may respond to many slots.
export interface TimeSlotResponse {
  slotId: string;
  memberId: string;
}

export interface TimeSlotPanel {
  id: string;
  projectId: string;
  type: 'timeslot';
  createdBy: string | null;
  createdAt: string;
  title: string;
  slots: TimeSlot[];
  responses: TimeSlotResponse[];
}

// A lightweight secondary checklist, rendered as a side panel. Unlike poll/
// timeslot, its content is NOT inlined here: items are real `items` rows in the
// backing list `listId`, so the client filters the flat project `items` array
// by `listId` and every existing `item.*` SSE event drives the card for free.
export interface ChecklistPanel {
  id: string;
  projectId: string;
  type: 'checklist';
  createdBy: string | null;
  createdAt: string;
  listId: string;
  title: string;
}

// Panel views are discriminated on `.type`.
export type PanelView = PollPanel | TimeSlotPanel | ChecklistPanel;

export const ACTIVITY_ACTIONS = [
  'item.created',
  'item.checked',
  'item.unchecked',
  'item.assigned',
  'item.deleted',
  'item.updated',
  'item.restored',
  'list.updated',
  'scratchpad.updated',
  'attachment.created',
  'attachment.deleted',
  'member.joined',
  'member.updated',
  'member.removed',
  'member.merged',
  'panel.created',
  'panel.deleted',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEntry {
  id: string;
  projectId: string;
  memberId: string | null;
  action: ActivityAction;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

// SSE event types
export type SSEEvent =
  | { event: 'item.created'; data: { item: Item; memberId: string } }
  // memberId is null for system-triggered updates (e.g. the reminder sweep
  // firing). User-initiated PATCHes pass the actor's id as today.
  | { event: 'item.updated'; data: { item: Item; memberId: string | null } }
  | { event: 'item.deleted'; data: { itemId: string; memberId: string } }
  | { event: 'item.restored'; data: { item: Item; memberId: string } }
  | { event: 'list.updated'; data: { list: List; memberId: string } }
  | { event: 'scratchpad.updated'; data: { scratchpad: Scratchpad; memberId: string } }
  | {
      event: 'scratchpad.editing';
      data: { scratchpadId: string; memberId: string; editing: boolean };
    }
  | { event: 'attachment.created'; data: { attachment: Attachment; memberId: string } }
  | {
      event: 'attachment.deleted';
      data: { attachmentId: string; itemId: string; memberId: string };
    }
  | { event: 'member.joined'; data: { member: Member } }
  | { event: 'member.updated'; data: { member: Member } }
  | { event: 'member.removed'; data: { memberId: string } }
  | { event: 'project.updated'; data: { project: Project } }
  // The whole Space was deleted by its creator; every connected client clears
  // its now-dead token and leaves. Carries the projectId only — the rest is gone.
  | { event: 'project.deleted'; data: { projectId: string } }
  | { event: 'presence'; data: { online: string[] } }
  | { event: 'activity'; data: { entry: ActivityEntry } }
  | { event: 'panel.created'; data: { panel: PanelView; memberId: string } }
  | { event: 'panel.updated'; data: { panel: PanelView; memberId: string } }
  | { event: 'panel.deleted'; data: { panelId: string; memberId: string } }
  | { event: 'poll.vote'; data: { panelId: string; memberId: string; optionId: string | null } }
  | {
      event: 'timeslot.response';
      data: { panelId: string; memberId: string; slotId: string; available: boolean };
    }
  | { event: 'ping'; data: '' };

// TOS acceptance state for the calling member — returned by the project load
// and terms-status endpoints, and mirrored on the 428 error body.
export interface TermsStatus {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  acceptanceRequired: boolean;
}

// Full project load response
export interface ProjectLoadResponse {
  project: Project;
  list: List;
  items: Item[];
  members: Member[];
  scratchpad: Scratchpad;
  attachments: Attachment[];
  panels: PanelView[];
  terms: TermsStatus;
}

// API response wrappers
export interface CreateProjectResponse {
  project: Project;
  member: Member;
  token: string;
}

export interface JoinProjectResponse {
  member: Member;
  token: string;
}

// A Space whose per-Space token was (re)issued during a single email
// verification, so one recovery signs the person in everywhere on this device.
export interface RecoveredSpace {
  slug: string;
  name: string;
  token: string;
  memberId: string;
}

export interface VerifyLoginCodeResponse {
  member: Member;
  token: string;
  otherSpaces: RecoveredSpace[];
}

// Every Space the caller's own verified email belongs to. Used to populate the
// "Your Spaces" panel on a device that only has a local token for one Space.
export interface MySpacesResponse {
  spaces: { slug: string; name: string }[];
}

// A verified membership the connect flow seeds onto the calling device so it
// becomes a "witness" (its member token proves email control for future mints).
export interface ConnectWitness {
  slug: string;
  memberToken: string;
  memberId: string;
  projectName: string;
}

// The two 200 outcomes of POST /api/auth/connect, discriminated on `status`:
// - `already-connected`: a key is already active elsewhere; the web shows the
//   never-silent reconnect screen. `apiToken` is metadata only (no secret).
//   `witness` (when present) seeds this device with a member session token so
//   the just-verified user is signed in — else opening the Space would hit the
//   join form. Absent only when no verified membership resolves (shouldn't happen
//   when a key is active); the client signs in whenever it is present.
// - `connected`: a fresh key was minted (prior one revoked). `token` is the
//   show-once secret; `witness` seeds this device as a verified witness.
// The third outcome — no membership for this email — is a 404 `ErrorResponse`
// with `code: 'no-account'` (thrown as an ApiError, never a resolved value); the
// web gates its createProject fallback on that `code`, not a bare 404 (§10.5).
export type ConnectResponse =
  | { status: 'already-connected'; apiToken: ApiToken; email: string; witness?: ConnectWitness }
  | { status: 'connected'; token: string; email: string; witness: ConnectWitness };

export interface ActivityFeedResponse {
  entries: ActivityEntry[];
  hasMore: boolean;
}

export interface NudgeResponse {
  text: string;
}

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
  // Set alongside code 'merge-available' on a /verify collision: the display
  // name of the member that already owns this verified email (null on the rare
  // concurrent-write race, where it can't be re-read).
  canonicalDisplayName?: string | null;
  // Set alongside code 'TERMS_ACCEPTANCE_REQUIRED' (428, middleware/auth.ts).
  // The web client checks terms proactively via GET /auth/terms-status
  // instead of reading this; it exists for API consumers.
  terms?: TermsStatus;
}

export interface ContactMessageResponse {
  message: string;
}

// External integration types
export interface ApiToken {
  id: string;
  lastUsedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface SPTask {
  id: string;
  title: string;
  done: boolean;
  projectId: string;
  projectName: string;
  projectSlug: string;
  listId: string;
  url: string;
  // ISO instant the task is scheduled for (Plainspace `remindAt`), or null when
  // unscheduled. SP-facing name for the same value the in-app DTO calls remindAt.
  scheduledAt: string | null;
  // Whether the task repeats (Plainspace `repeat` rule is set). The cadence
  // itself stays Plainspace-side; SP only needs the yes/no to flag recurrence.
  isRecurring: boolean;
  createdAt: string;
  // High-water mark for `GET /tasks?updatedSince=`; bumped on every item write
  // by a DB trigger (see migration `*_items_updated_at`).
  updatedAt: string;
}

export interface SPMeResponse {
  email: string;
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    memberDisplayName: string;
    role: string;
  }>;
}

export interface SPTasksResponse {
  tasks: SPTask[];
}

// Response of POST /api/integration/tasks/:taskId/claim.
export interface SPClaimTaskResponse {
  task: SPTask;
}

// Response of GET /api/integration/claimable-tasks (same shape as /tasks).
export type SPClaimableTasksResponse = SPTasksResponse;

// Response of POST /api/integration/spaces. `url` is the Space's web link
// ({origin}/{slug}); `memberId` is the creator member the PAT now owns. The PAT
// itself can immediately act in the new Space — no returned session token needed.
export interface SPCreateSpaceResponse {
  project: Project;
  url: string;
  memberId: string;
}
