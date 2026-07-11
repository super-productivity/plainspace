import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TOS_VERSION, type RepeatRule } from '@plainspace/shared';
import { db } from '../src/db/connection.js';
import { items, lists, members, memberTokens, projects } from '../src/db/schema.js';
import { hashToken } from '../src/lib/crypto.js';
import { encryptedEmailFields } from '../src/lib/email-crypto.js';

type ProjectRow = typeof projects.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type ItemRow = typeof items.$inferSelect;

let slugCounter = 0;
function nextSlug(): string {
  return `tst${(slugCounter++).toString(36)}${randomBytes(4).toString('hex')}`.slice(0, 22);
}

/**
 * Insert a project + a single list and return both. Tests that need members
 * call addMember() afterwards.
 */
export async function createProject(name = 'Test project'): Promise<{
  project: ProjectRow;
  listId: string;
}> {
  const [project] = await db.insert(projects).values({ slug: nextSlug(), name }).returning();
  const [list] = await db
    .insert(lists)
    .values({ projectId: project.id, columns: [{ id: 'todo', name: 'To do' }] })
    .returning();
  return { project, listId: list.id };
}

export async function addMember(
  projectId: string,
  opts: { displayName?: string; email?: string | null } = {},
): Promise<MemberRow> {
  const displayName = opts.displayName ?? `Member ${randomBytes(2).toString('hex')}`;
  const emailFields = opts.email
    ? encryptedEmailFields(opts.email)
    : { emailCiphertext: null, emailIv: null, emailLookup: null };
  const [row] = await db
    .insert(members)
    .values({
      projectId,
      displayName,
      color: '#000000',
      avatarIndex: 0,
      ...emailFields,
      emailVerified: emailFields.emailCiphertext !== null,
    })
    .returning();
  // Give the member a session so helper-created members are authenticatable
  // like real ones. A raw 64-char hex stands in for a real token hash (no
  // plaintext is needed — callers that authenticate mint their own).
  await db
    .insert(memberTokens)
    .values({ tokenHash: randomBytes(32).toString('hex'), memberId: row.id });
  return row;
}

/**
 * Like addMember, but with accepted TOS and a KNOWN bearer token so the test
 * can authenticate as the member. Composes addMember so member-row defaults
 * live in one place (the extra random-hash session addMember inserts is
 * harmless — sessions are additive).
 */
export async function authedMember(
  projectId: string,
  opts: { displayName?: string; email?: string | null } = {},
): Promise<{ member: MemberRow; token: string }> {
  const inserted = await addMember(projectId, opts);
  const [member] = await db
    .update(members)
    .set({ tosVersion: TOS_VERSION, tosAcceptedAt: new Date() })
    .where(eq(members.id, inserted.id))
    .returning();
  const token = randomBytes(16).toString('hex');
  await db.insert(memberTokens).values({ tokenHash: hashToken(token), memberId: member.id });
  return { member, token };
}

export async function addItem(
  listId: string,
  projectId: string,
  opts: {
    text?: string;
    remindAt?: Date | null;
    assignedTo?: string | null;
    deletedAt?: Date | null;
    position?: number;
    repeat?: RepeatRule | null;
    columnId?: string;
    checked?: boolean;
    checkedBy?: string | null;
  } = {},
): Promise<ItemRow> {
  const [row] = await db
    .insert(items)
    .values({
      listId,
      projectId,
      text: opts.text ?? 'Item',
      position: opts.position ?? 0,
      remindAt: opts.remindAt ?? null,
      assignedTo: opts.assignedTo ?? null,
      deletedAt: opts.deletedAt ?? null,
      repeat: opts.repeat ?? null,
      columnId: opts.columnId ?? 'todo',
      checked: opts.checked ?? false,
      checkedBy: opts.checkedBy ?? null,
    })
    .returning();
  return row;
}
