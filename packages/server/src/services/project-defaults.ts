import { eq, and, isNull } from 'drizzle-orm';
import { DEFAULT_KANBAN_COLUMNS } from '@plainspace/shared';
import { db } from '../db/connection.js';
import { lists, scratchpads } from '../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Conn = typeof db | Tx;
type ListRow = typeof lists.$inferSelect;
type ScratchpadRow = typeof scratchpads.$inferSelect;

interface EnsureProjectDefaultsParams {
  projectId: string;
  memberId: string;
}

export interface ProjectDefaults {
  list: ListRow;
  scratchpad: ScratchpadRow;
}

export async function ensureProjectDefaults(
  conn: Conn,
  { projectId, memberId }: EnsureProjectDefaultsParams,
): Promise<ProjectDefaults> {
  const list = await ensureProjectList(conn, projectId, memberId);
  const scratchpad = await ensureProjectScratchpad(conn, projectId, memberId);
  return { list, scratchpad };
}

async function ensureProjectList(
  conn: Conn,
  projectId: string,
  memberId: string,
): Promise<ListRow> {
  // The primary (hero) list is the one with no backing panel. Checklist lists
  // (panel_id set) also live under this projectId, so every lookup here must
  // scope to `panel_id IS NULL` -- matching the partial unique index.
  const primaryWhere = and(eq(lists.projectId, projectId), isNull(lists.panelId));

  const existing = await conn.query.lists.findFirst({ where: primaryWhere });
  if (existing) return existing;

  const [inserted] = await conn
    .insert(lists)
    .values({ projectId, columns: DEFAULT_KANBAN_COLUMNS, createdBy: memberId })
    .onConflictDoNothing({ target: lists.projectId, where: isNull(lists.panelId) })
    .returning();
  if (inserted) return inserted;

  const createdByConcurrentRequest = await conn.query.lists.findFirst({
    where: primaryWhere,
  });
  if (!createdByConcurrentRequest) {
    throw new Error(`Failed to ensure list default for project ${projectId}`);
  }
  return createdByConcurrentRequest;
}

async function ensureProjectScratchpad(
  conn: Conn,
  projectId: string,
  memberId: string,
): Promise<ScratchpadRow> {
  const existing = await conn.query.scratchpads.findFirst({
    where: eq(scratchpads.projectId, projectId),
  });
  if (existing) return existing;

  const [inserted] = await conn
    .insert(scratchpads)
    .values({ projectId, createdBy: memberId, updatedBy: memberId })
    .onConflictDoNothing({ target: scratchpads.projectId })
    .returning();
  if (inserted) return inserted;

  const createdByConcurrentRequest = await conn.query.scratchpads.findFirst({
    where: eq(scratchpads.projectId, projectId),
  });
  if (!createdByConcurrentRequest) {
    throw new Error(`Failed to ensure scratchpad default for project ${projectId}`);
  }
  return createdByConcurrentRequest;
}
