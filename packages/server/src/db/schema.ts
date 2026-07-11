import {
  pgTable,
  primaryKey,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  smallint,
  timestamp,
  jsonb,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { RepeatRule } from '@plainspace/shared';

// Drizzle doesn't ship a bytea column type out of the box; this maps to
// Postgres `bytea` and to Node `Buffer` at the JS boundary.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const projects = pgTable('projects', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: varchar('slug', { length: 22 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  purpose: varchar('purpose', { length: 280 }).notNull().default(''),
  sharingMode: varchar('sharing_mode', { length: 10 }).notNull().default('open'), // 'open' | 'private'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable(
  'members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    displayName: varchar('display_name', { length: 40 }).notNull(),
    color: varchar('color', { length: 7 }).notNull(),
    avatarIndex: smallint('avatar_index').notNull(),
    // Application-layer encryption: emailCiphertext + emailIv hold the
    // AES-256-GCM ciphertext, and emailLookup is the HMAC-SHA256 blind
    // index used for equality lookups (recovery flow, /verify collision
    // check). All three are NULL together for display-name-only members.
    emailCiphertext: bytea('email_ciphertext'),
    emailIv: bytea('email_iv'),
    emailLookup: bytea('email_lookup'),
    emailVerified: boolean('email_verified').notNull().default(false),
    isCreator: boolean('is_creator').notNull().default(false),
    role: varchar('role', { length: 10 }).notNull().default('member'), // 'admin' | 'member'
    tosVersion: varchar('tos_version', { length: 20 }),
    tosAcceptedAt: timestamp('tos_accepted_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_members_project').on(table.projectId),
    index('idx_members_email_lookup').on(table.emailLookup),
    // One verified email per Space: recovery looks members up by
    // (projectId, emailLookup) and findFirst would otherwise issue a token to
    // an arbitrary matching member.
    uniqueIndex('idx_members_project_email_verified')
      .on(table.projectId, table.emailLookup)
      .where(sql`${table.emailVerified} = true`),
  ],
);

// A member's active bearer-token sessions. Split out of `members` so the same
// person can stay signed in on several devices at once (phone + laptop):
// joining, creating, or recovering on a new device INSERTS a session row rather
// than overwriting a single token slot, so it never logs the other device out.
// Rows are cleaned up by the members ON DELETE CASCADE (self-deletion, admin
// removal, merge), so a removed member's tokens stop authenticating immediately.
export const memberTokens = pgTable(
  'member_tokens',
  {
    // The token hash is the natural key; PRIMARY KEY gives the O(1) auth lookup.
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Fixed lifetime keeps authentication reads read-only and makes the
    // maximum exposure of a copied bearer token explicit. Re-authentication
    // issues a fresh additive session without disturbing other devices.
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
  },
  (table) => [index('idx_member_tokens_member').on(table.memberId)],
);

export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    emailCiphertext: bytea('email_ciphertext').notNull(),
    emailIv: bytea('email_iv').notNull(),
    emailLookup: bytea('email_lookup').notNull(),
    code: varchar('code', { length: 6 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_email_verifications_member').on(table.memberId)],
);

// Standalone email verification used to gate project creation.
// Issued before a project exists, so it has no memberId.
export const creationVerifications = pgTable(
  'creation_verifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    emailCiphertext: bytea('email_ciphertext').notNull(),
    emailIv: bytea('email_iv').notNull(),
    emailLookup: bytea('email_lookup').notNull(),
    code: varchar('code', { length: 6 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_creation_verifications_email_lookup').on(table.emailLookup)],
);

// Login codes for the per-Space passwordless recovery flow. Looked up by
// (projectId, email) — the member is identified after the code is verified,
// so the row isn't linked to a memberId.
export const loginVerifications = pgTable(
  'login_verifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    emailCiphertext: bytea('email_ciphertext').notNull(),
    emailIv: bytea('email_iv').notNull(),
    emailLookup: bytea('email_lookup').notNull(),
    code: varchar('code', { length: 6 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_login_verifications_lookup').on(table.projectId, table.emailLookup)],
);

export const lists = pgTable(
  'lists',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // NULL ⇒ the project's primary (hero) list. Set ⇒ a checklist panel's
    // backing list; the cascade means deleting the panel removes this list and
    // (via items.list_id) its items in one step. `panels` is declared below --
    // the `() =>` ref is lazy, so the forward reference is fine.
    panelId: uuid('panel_id').references(() => panels.id, { onDelete: 'cascade' }),
    // NULL for the primary list (its name is the project name); set for a named checklist.
    title: varchar('title', { length: 280 }),
    columns: jsonb('columns').$type<Array<{ id: string; name: string }>>(),
    createdBy: uuid('created_by').references(() => members.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Partial unique: at most one primary list per project. Checklist lists
  // (panel_id set) are unconstrained -- bounded only by MAX_PANELS_PER_PROJECT.
  (table) => [
    uniqueIndex('idx_lists_project_primary')
      .on(table.projectId)
      .where(sql`${table.panelId} IS NULL`),
  ],
);

export const items = pgTable(
  'items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    text: varchar('text', { length: 500 }).notNull(),
    checked: boolean('checked').notNull().default(false),
    checkedBy: uuid('checked_by').references(() => members.id, {
      onDelete: 'set null',
    }),
    assignedTo: uuid('assigned_to').references(() => members.id, {
      onDelete: 'set null',
    }),
    columnId: varchar('column_id', { length: 50 }).notNull().default('todo'),
    position: integer('position').notNull(),
    createdBy: uuid('created_by').references(() => members.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Bumped on every mutating write by a BEFORE UPDATE trigger (see migration
    // `*_items_updated_at`), so it is a reliable high-water mark for the
    // integration `?updatedSince=` poll — the trigger also covers raw-SQL
    // writers (the reminder sweep) that a drizzle-level $onUpdate would miss.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Reminder fire time. For one-shot reminders the sweep claims due rows by
    // nulling this column. For recurring items it is the CURRENT occurrence and
    // is advanced only when the task is checked off (not by the fire), so an
    // undone occurrence stays put and reads as due → overdue.
    remindAt: timestamp('remind_at', { withTimezone: true }),
    // Recurrence rule (RepeatRule). NULL ⇒ one-shot reminder. For repeating
    // items remind_at is the current occurrence; the immutable `anchor` inside
    // this jsonb is the series' DTSTART (time-of-day + interval phase).
    repeat: jsonb('repeat').$type<RepeatRule>(),
    // When the sweep last delivered a push for the occurrence in remind_at.
    // Recurring only — fires once per occurrence (claim suppresses a row once
    // notified_at >= remind_at) and is cleared when remind_at advances on
    // check-off. NULL for one-shot reminders.
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_items_list').on(table.listId),
    index('idx_items_project').on(table.projectId),
    // Partial index for the sweep's per-tick claim (due reminders). Overdue
    // recurring rows keep remind_at and stay in this index until checked off;
    // the claim filters out already-notified ones by notified_at — acceptable
    // at single-node scale (the hot set is bounded by undone recurring tasks).
    index('idx_items_remind_due')
      .on(table.remindAt)
      .where(sql`remind_at IS NOT NULL AND deleted_at IS NULL`),
  ],
);

// Web Push subscriptions. Composite PK (member_id, endpoint) so a member can
// register multiple devices, and so two members on the same shared browser
// don't collide — both rows coexist, each only receives push for items
// targeted to their own member_id. The composite PK's btree also serves the
// only access pattern (member_id-prefix lookups), so no explicit index.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    // FCM endpoints can exceed 2048 chars — use text, not varchar.
    endpoint: text('endpoint').notNull(),
    p256dh: varchar('p256dh', { length: 255 }).notNull(),
    auth: varchar('auth', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.endpoint] })],
);

// Trailing-window queue for batched "task assigned to you" push. A row means
// member_id was assigned item_id and hasn't been notified yet. The reminder
// sweep's flush pass claims a member's whole batch atomically (DELETE …
// RETURNING) once their assignments settle (newest ≥ quiet-window old) or the
// batch has waited long enough (oldest ≥ max-wait old), so a burst of
// assignments collapses into one notification. Self-assignments are never
// enqueued. Reassign / unassign / check / delete before flush are absorbed at
// flush time by re-validating each item against the live row, so the enqueue
// path stays a bare upsert. Composite PK (member_id, item_id) keeps one row per
// assignment and serves the member-prefix lookups; the flush's GROUP BY
// member_id aggregates over the small pending set, so no extra index.
export const assignmentNotifications = pgTable(
  'assignment_notifications',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.itemId] })],
);

export const scratchpads = pgTable(
  'scratchpads',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    content: text('content').notNull().default(''),
    updatedBy: uuid('updated_by').references(() => members.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => members.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('idx_scratchpads_project_unique').on(table.projectId)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    storagePath: varchar('storage_path', { length: 500 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_attachments_item').on(table.itemId),
    index('idx_attachments_project').on(table.projectId),
  ],
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    emailCiphertext: bytea('email_ciphertext').notNull(),
    emailIv: bytea('email_iv').notNull(),
    emailLookup: bytea('email_lookup').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_api_tokens_hash').on(table.tokenHash),
    index('idx_api_tokens_email_lookup').on(table.emailLookup),
    // At most one active (non-revoked) token per email. Same partial
    // unique-index pattern as verified members and primary lists.
    uniqueIndex('idx_api_tokens_active_email')
      .on(table.emailLookup)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

// DSA Art. 16 notices: persisted reports of allegedly illegal content. Rows
// are kept for the audit trail even after the target content is removed, so
// references to project / item / attachment are loose strings (not FKs).
// Submitter email is encrypted with the same scheme used for member emails;
// CSAM-category notices may have all submitter fields NULL (Art. 16(2)(c)).
export const dsaNotices = pgTable(
  'dsa_notices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    contentLocation: varchar('content_location', { length: 500 }).notNull(),
    projectSlug: varchar('project_slug', { length: 22 }),
    itemId: uuid('item_id'),
    attachmentId: uuid('attachment_id'),
    category: varchar('category', { length: 30 }).notNull(),
    reason: text('reason').notNull(),
    submitterName: varchar('submitter_name', { length: 100 }),
    submitterEmailCiphertext: bytea('submitter_email_ciphertext'),
    submitterEmailIv: bytea('submitter_email_iv'),
    submitterEmailLookup: bytea('submitter_email_lookup'),
    goodFaithConfirmed: boolean('good_faith_confirmed').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    status: varchar('status', { length: 30 }).notNull().default('new'),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_dsa_notices_received').on(table.receivedAt),
    index('idx_dsa_notices_status').on(table.status, table.receivedAt),
  ],
);

export const activity = pgTable(
  'activity',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    action: varchar('action', { length: 30 }).notNull(),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: uuid('target_id').notNull(),
    meta: jsonb('meta').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_activity_project_created').on(table.projectId, table.createdAt)],
);

// Generic panel framework: `panels` owns layout (type + ordering), per-type
// content lives in per-type tables (`polls` today; `timeslots` etc. later).
export const panels = pgTable(
  'panels',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull(), // 'poll' (later 'timeslot')
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_panels_project').on(t.projectId)],
);

export const polls = pgTable('polls', {
  panelId: uuid('panel_id')
    .primaryKey()
    .references(() => panels.id, { onDelete: 'cascade' }),
  question: varchar('question', { length: 280 }).notNull(),
  options: jsonb('options').$type<Array<{ id: string; text: string }>>().notNull(),
});

export const pollVotes = pgTable(
  'poll_votes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    panelId: uuid('panel_id')
      .notNull()
      .references(() => panels.id, { onDelete: 'cascade' }),
    optionId: varchar('option_id', { length: 64 }).notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idx_poll_votes_panel_member').on(t.panelId, t.memberId)],
);

export const timeslots = pgTable('timeslots', {
  panelId: uuid('panel_id')
    .primaryKey()
    .references(() => panels.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 280 }).notNull(),
  slots: jsonb('slots').$type<Array<{ id: string; label: string }>>().notNull(),
});

export const timeslotResponses = pgTable(
  'timeslot_responses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    panelId: uuid('panel_id')
      .notNull()
      .references(() => panels.id, { onDelete: 'cascade' }),
    slotId: varchar('slot_id', { length: 64 }).notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One more column than poll_votes' (panel, member): TimeSlot is multi-select, so
  // a member may mark many slots. Don't "fix" this back to the poll shape.
  (t) => [
    uniqueIndex('idx_timeslot_responses_panel_member_slot').on(t.panelId, t.memberId, t.slotId),
  ],
);
