# UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver five UX improvements: wider layout, invite link in header, member-picker "@" assign, per-list kanban board with status columns, and email signup gate for project/list creation.

**Architecture:** Frontend is SolidJS + CSS modules at `packages/web/src`. Backend is Hono at `packages/server/src`. Shared types live at `packages/shared/src` and are imported directly from TypeScript source (no build step). Database is Postgres via Drizzle ORM. Migrations are SQL files in `packages/server/drizzle/`, applied with `tsx src/db/migrate.ts`.

**Tech Stack:** SolidJS, Hono, Drizzle ORM, Postgres, Zod, TypeScript, CSS Modules

---

## Task 1: Widen layout to 960px

**Files:**

- Modify: `packages/web/src/components/layout/Shell.module.css`

### Step 1: Change max-width

In `Shell.module.css`, change:

```css
max-width: 640px;
```

to:

```css
max-width: 960px;
```

### Step 2: Verify in browser

Open http://localhost:5173 — the page should be wider. The board columns will have more horizontal room.

### Step 3: Commit

```bash
git add packages/web/src/components/layout/Shell.module.css
git commit -m "feat: widen layout to 960px"
```

---

## Task 2: Invite button in header

**Files:**

- Modify: `packages/web/src/components/layout/Header.tsx`
- Modify: `packages/web/src/components/layout/Header.module.css`

### Step 1: Add invite button to Header.tsx

Replace the entire `packages/web/src/components/layout/Header.tsx` with:

```tsx
import { For, createSignal, Show } from 'solid-js';
import type { Project, Member } from '@spaces/shared';
import MemberChip from '../members/MemberChip';
import MemberList from '../members/MemberList';
import NudgeButton from '../nudge/NudgeButton';
import styles from './Header.module.css';

interface HeaderProps {
  project: Project;
  members: Member[];
  presence: string[];
  slug: string;
  myId: string;
  myRole: string;
  isCreator: boolean;
}

export default function Header(props: HeaderProps) {
  const [showMembers, setShowMembers] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const onlineMembers = () => props.members.filter((m) => props.presence.includes(m.id));

  async function copyInviteLink() {
    const url = `${window.location.origin}/${props.slug}/join`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <header class={styles.header} data-testid="project-header">
        <div class={styles.top}>
          <div>
            <h1 class={styles.name} data-testid="project-name">
              {props.project.name}
            </h1>
            <Show when={props.project.purpose}>
              <p class={styles.purpose}>{props.project.purpose}</p>
            </Show>
            <Show when={props.project.sharingMode === 'private'}>
              <span class={styles.privateBadge} data-testid="private-badge">
                Private
              </span>
            </Show>
          </div>
          <NudgeButton slug={props.slug} />
        </div>

        <div class={styles.presence} data-testid="presence-bar">
          <Show when={onlineMembers().length > 0}>
            <For each={onlineMembers()}>{(member) => <MemberChip member={member} small />}</For>
          </Show>
          <button
            class={styles.membersButton}
            onClick={() => setShowMembers(true)}
            data-testid="members-button"
          >
            {props.members.length} member{props.members.length !== 1 ? 's' : ''}
            {onlineMembers().length > 0 ? ` (${onlineMembers().length} online)` : ''}
          </button>
          <button
            class={`${styles.inviteButton} ${copied() ? styles.inviteButtonCopied : ''}`}
            onClick={copyInviteLink}
            data-testid="invite-button"
          >
            {copied() ? '✓ Copied!' : 'Invite'}
          </button>
        </div>
      </header>

      <Show when={showMembers()}>
        <MemberList
          members={props.members}
          presence={props.presence}
          myId={props.myId}
          myRole={props.myRole}
          isCreator={props.isCreator}
          slug={props.slug}
          onClose={() => setShowMembers(false)}
        />
      </Show>
    </>
  );
}
```

### Step 2: Add invite button styles to Header.module.css

Read the current `Header.module.css` first, then append these styles:

```css
.inviteButton {
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-primary);
  background: transparent;
  color: var(--color-primary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.inviteButton:hover {
  background: var(--color-primary);
  color: white;
}

.inviteButtonCopied {
  background: var(--color-success, #22c55e);
  border-color: var(--color-success, #22c55e);
  color: white;
}
```

### Step 3: Verify in browser

Open the project view — the "Invite" button should appear next to the members count. Clicking it should copy the join URL to clipboard and briefly show "✓ Copied!".

### Step 4: Commit

```bash
git add packages/web/src/components/layout/Header.tsx packages/web/src/components/layout/Header.module.css
git commit -m "feat: add persistent invite button to header"
```

---

## Task 3: Member picker popover for "@" assign

**Files:**

- Create: `packages/web/src/components/lists/MemberPicker.tsx`
- Create: `packages/web/src/components/lists/MemberPicker.module.css`
- Modify: `packages/web/src/components/lists/ListItem.tsx`

### Step 1: Create MemberPicker.tsx

Create `packages/web/src/components/lists/MemberPicker.tsx`:

```tsx
import { For, onCleanup, onMount } from 'solid-js';
import type { Member } from '@spaces/shared';
import MemberChip from '../members/MemberChip';
import styles from './MemberPicker.module.css';

interface MemberPickerProps {
  members: Member[];
  assignedTo: string | null;
  onSelect: (memberId: string | null) => void;
  onClose: () => void;
}

export default function MemberPicker(props: MemberPickerProps) {
  let ref: HTMLDivElement | undefined;

  function handleOutsideClick(e: MouseEvent) {
    if (ref && !ref.contains(e.target as Node)) {
      props.onClose();
    }
  }

  onMount(() => document.addEventListener('mousedown', handleOutsideClick));
  onCleanup(() => document.removeEventListener('mousedown', handleOutsideClick));

  return (
    <div class={styles.popover} ref={ref} data-testid="member-picker">
      <button
        class={`${styles.option} ${props.assignedTo === null ? styles.selected : ''}`}
        onClick={() => {
          props.onSelect(null);
          props.onClose();
        }}
        data-testid="unassign-option"
      >
        Unassigned
      </button>
      <For each={props.members}>
        {(member) => (
          <button
            class={`${styles.option} ${props.assignedTo === member.id ? styles.selected : ''}`}
            onClick={() => {
              props.onSelect(member.id);
              props.onClose();
            }}
            data-testid={`assign-option-${member.id}`}
          >
            <MemberChip member={member} small />
            <span class={styles.name}>{member.displayName}</span>
            {props.assignedTo === member.id && <span class={styles.check}>✓</span>}
          </button>
        )}
      </For>
    </div>
  );
}
```

### Step 2: Create MemberPicker.module.css

Create `packages/web/src/components/lists/MemberPicker.module.css`:

```css
.popover {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 50;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  min-width: 160px;
  padding: 4px;
}

.option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: 0.875rem;
  color: var(--color-text);
}

.option:hover {
  background: var(--color-bg);
}

.selected {
  background: var(--color-primary-light, #ede9fe);
}

.name {
  flex: 1;
}

.check {
  color: var(--color-primary);
  font-weight: 600;
}
```

### Step 3: Update ListItem.tsx

Replace the assign-related code in `packages/web/src/components/lists/ListItem.tsx`.

Change the imports line to add `createSignal` and import MemberPicker:

```tsx
import { Show, createMemo, createSignal } from 'solid-js';
import type { Item, Member, Attachment } from '@spaces/shared';
import { api } from '../../lib/api';
import MemberChip from '../members/MemberChip';
import MemberPicker from './MemberPicker';
import AttachmentList from '../attachments/AttachmentList';
import AttachmentUpload from '../attachments/AttachmentUpload';
import styles from './ListItem.module.css';
```

Inside the component, replace the `handleAssign` function and the assign button section.

Replace:

```tsx
async function handleAssign() {
  const newAssignee = props.item.assignedTo === props.myId ? null : props.myId;
  await api
    .updateItem(props.slug, props.item.id, {
      assignedTo: newAssignee,
    })
    .catch(() => {});
}
```

With:

```tsx
const [showPicker, setShowPicker] = createSignal(false);

async function handleAssign(memberId: string | null) {
  await api
    .updateItem(props.slug, props.item.id, {
      assignedTo: memberId,
    })
    .catch(() => {});
}
```

Replace the assign button JSX:

```tsx
<button
  class={styles.assignButton}
  onClick={handleAssign}
  title={props.item.assignedTo === props.myId ? 'Unassign from me' : 'Assign to me'}
  data-testid="assign-button"
>
  {props.item.assignedTo === props.myId ? '@' : '+@'}
</button>
```

With:

```tsx
<div class={styles.assignWrapper}>
  <button
    class={styles.assignButton}
    onClick={() => setShowPicker(!showPicker())}
    title="Assign member"
    data-testid="assign-button"
  >
    {props.item.assignedTo ? '@' : '+@'}
  </button>
  <Show when={showPicker()}>
    <MemberPicker
      members={props.members}
      assignedTo={props.item.assignedTo}
      onSelect={handleAssign}
      onClose={() => setShowPicker(false)}
    />
  </Show>
</div>
```

### Step 4: Add .assignWrapper to ListItem.module.css

Read the file first, then append:

```css
.assignWrapper {
  position: relative;
}
```

### Step 5: Verify in browser

Click the `+@` button on any item — a popover should appear listing all project members. Selecting one assigns them; selecting the already-assigned member or "Unassigned" clears it.

### Step 6: Commit

```bash
git add packages/web/src/components/lists/MemberPicker.tsx packages/web/src/components/lists/MemberPicker.module.css packages/web/src/components/lists/ListItem.tsx packages/web/src/components/lists/ListItem.module.css
git commit -m "feat: member picker popover for item assignment"
```

---

## Task 4: Kanban data model — schema, types, API

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/validation.ts`
- Modify: `packages/server/src/db/schema.ts`
- Run migrations
- Modify: `packages/server/src/lib/serialize.ts`
- Modify: `packages/server/src/routes/items.ts`
- Modify: `packages/server/src/routes/lists.ts`

### Step 1: Add KanbanColumn type and defaults to shared

In `packages/shared/src/types.ts`, add after the imports:

```ts
export interface KanbanColumn {
  id: string;
  name: string;
}
```

Update the `List` interface to add `columns`:

```ts
export interface List {
  id: string;
  projectId: string;
  name: string;
  position: number;
  columns: KanbanColumn[] | null;
  createdBy: string | null;
  createdAt: string;
}
```

Update the `Item` interface to add `columnId`:

```ts
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
  createdAt: string;
}
```

### Step 2: Add DEFAULT_KANBAN_COLUMNS to constants.ts

In `packages/shared/src/constants.ts`, append:

```ts
export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'done', name: 'Done' },
];
```

Also add this import at the top of the file:

```ts
import type { KanbanColumn } from './types.js';
```

### Step 3: Update validation schemas

In `packages/shared/src/validation.ts`:

Update `UpdateItemSchema` to add `columnId`:

```ts
export const UpdateItemSchema = z.object({
  text: z.string().min(1).max(MAX_ITEM_TEXT_LENGTH).optional(),
  checked: z.boolean().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  columnId: z.string().min(1).max(50).optional(),
  position: z.number().int().positive().optional(),
  listId: z.string().uuid().optional(),
});
```

Update `UpdateListSchema` to add `columns`:

```ts
export const UpdateListSchema = z.object({
  name: z.string().min(1).max(MAX_LIST_NAME_LENGTH).optional(),
  position: z.number().int().positive().optional(),
  columns: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        name: z.string().min(1).max(50),
      }),
    )
    .min(1)
    .max(20)
    .nullable()
    .optional(),
});
```

### Step 4: Update DB schema

In `packages/server/src/db/schema.ts`:

Add `columnId` to the `items` table (after the `assignedTo` field):

```ts
    columnId: varchar('column_id', { length: 50 }).notNull().default('todo'),
```

Add `columns` to the `lists` table (after the `position` field):

```ts
    columns: jsonb('columns').$type<Array<{ id: string; name: string }>>(),
```

### Step 5: Generate migration

Run:

```bash
pnpm --filter @spaces/server db:generate
```

Expected: a new SQL file appears in `packages/server/drizzle/` with ALTER TABLE statements.

### Step 6: Add backfill to migration

Find the newly generated `.sql` file in `packages/server/drizzle/`. Open it and append this line before the final statement (or at the end):

```sql
UPDATE "items" SET "column_id" = 'done' WHERE "checked" = true;
```

### Step 7: Run migration

```bash
cd packages/server && ./node_modules/.bin/tsx src/db/migrate.ts
```

Expected output:

```
Running migrations...
Migrations complete.
```

### Step 8: Update serialize.ts

In `packages/server/src/lib/serialize.ts`, update `serializeList`:

```ts
export function serializeList(row: ListRow): List {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    position: row.position,
    columns: (row.columns as Array<{ id: string; name: string }> | null) ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
```

Update `serializeItem`:

```ts
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
  };
}
```

### Step 9: Update items route to handle columnId + sync with checked

In `packages/server/src/routes/items.ts`, in the `PATCH /:itemId` handler, find the `updates` block and add:

After `if (parsed.data.assignedTo !== undefined) updates.assignedTo = parsed.data.assignedTo;`, add:

```ts
if (parsed.data.columnId !== undefined) {
  updates.columnId = parsed.data.columnId;
  // Sync checked state with done column
  if (parsed.data.columnId === 'done') {
    updates.checked = true;
    updates.checkedBy = member.id;
  } else if (existing.columnId === 'done') {
    updates.checked = false;
    updates.checkedBy = null;
  }
}
```

Also in the `checked` update block, add columnId sync. Find:

```ts
  if (parsed.data.checked !== undefined) {
    updates.checked = parsed.data.checked;
    updates.checkedBy = parsed.data.checked ? member.id : null;
```

And add after `updates.checkedBy`:

```ts
// Sync columnId with checked state
if (parsed.data.checked) {
  updates.columnId = 'done';
} else if (existing.columnId === 'done') {
  updates.columnId = 'todo';
}
```

### Step 10: Update lists route to handle columns

In `packages/server/src/routes/lists.ts`, in the `PATCH /:listId` handler, find the updates block:

After `if (parsed.data.position !== undefined) updates.position = parsed.data.position;`, add:

```ts
if (parsed.data.columns !== undefined) updates.columns = parsed.data.columns;
```

### Step 11: Update api.ts to accept columnId and columns

In `packages/web/src/lib/api.ts`, update `updateList` signature:

```ts
  updateList: (slug: string, listId: string, data: { name?: string; position?: number; columns?: Array<{ id: string; name: string }> | null }) =>
    request<any>(`/projects/${slug}/lists/${listId}`, { method: 'PATCH', body: JSON.stringify(data) }, slug),
```

The `updateItem` already uses `Record<string, unknown>` so no change needed.

### Step 12: Commit

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts packages/shared/src/validation.ts packages/server/src/db/schema.ts packages/server/drizzle/ packages/server/src/lib/serialize.ts packages/server/src/routes/items.ts packages/server/src/routes/lists.ts packages/web/src/lib/api.ts
git commit -m "feat: add columnId/columns fields for per-list kanban"
```

---

## Task 5: Per-list board view UI

**Files:**

- Create: `packages/web/src/components/lists/ListBoardView.tsx`
- Create: `packages/web/src/components/lists/ListBoardView.module.css`
- Modify: `packages/web/src/components/lists/ListCard.tsx`
- Modify: `packages/web/src/routes/Project.tsx`

### Step 1: Create ListBoardView.tsx

Create `packages/web/src/components/lists/ListBoardView.tsx`:

```tsx
import { For, Show, createMemo } from 'solid-js';
import type { List, Item, Member, Attachment } from '@spaces/shared';
import { DEFAULT_KANBAN_COLUMNS } from '@spaces/shared';
import { api } from '../../lib/api';
import ListItem from './ListItem';
import AddItem from './AddItem';
import styles from './ListBoardView.module.css';

interface ListBoardViewProps {
  list: List;
  items: Item[];
  members: Member[];
  attachments: Attachment[];
  slug: string;
  myId: string;
  onDeleteItem: (itemId: string) => void;
}

export default function ListBoardView(props: ListBoardViewProps) {
  const columns = createMemo(() => props.list.columns ?? DEFAULT_KANBAN_COLUMNS);

  function itemsForColumn(columnId: string) {
    return props.items.filter((i) => i.columnId === columnId);
  }

  async function moveToColumn(itemId: string, columnId: string) {
    await api.updateItem(props.slug, itemId, { columnId }).catch(() => {});
  }

  return (
    <div class={styles.board} data-testid="list-board-view">
      <For each={columns()}>
        {(col) => (
          <div class={styles.column} data-testid={`kanban-column-${col.id}`}>
            <div class={styles.columnHeader}>
              <span class={styles.columnName}>{col.name}</span>
              <span class={styles.columnCount}>{itemsForColumn(col.id).length}</span>
            </div>
            <div class={styles.columnItems}>
              <For each={itemsForColumn(col.id)}>
                {(item) => (
                  <div class={styles.itemWrapper}>
                    <ListItem
                      item={item}
                      members={props.members}
                      attachments={props.attachments.filter((a) => a.itemId === item.id)}
                      slug={props.slug}
                      myId={props.myId}
                      onDelete={props.onDeleteItem}
                    />
                    <div class={styles.columnMover}>
                      <For each={columns().filter((c) => c.id !== col.id)}>
                        {(target) => (
                          <button
                            class={styles.moveButton}
                            onClick={() => moveToColumn(item.id, target.id)}
                            title={`Move to ${target.name}`}
                          >
                            → {target.name}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <Show when={col.id === 'todo' || columns()[0].id === col.id}>
              <AddItem slug={props.slug} listId={props.list.id} />
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
```

### Step 2: Create ListBoardView.module.css

Create `packages/web/src/components/lists/ListBoardView.module.css`:

```css
.board {
  display: flex;
  gap: var(--space-md);
  overflow-x: auto;
  padding-bottom: var(--space-md);
  min-height: 200px;
}

.column {
  flex: 0 0 280px;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  max-height: 65vh;
}

.columnHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.columnName {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.columnCount {
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
}

.columnItems {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-xs);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.itemWrapper {
  background: var(--color-bg);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

.columnMover {
  display: flex;
  gap: 4px;
  padding: 4px var(--space-sm);
  border-top: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.moveButton {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.moveButton:hover {
  background: var(--color-primary-light, #ede9fe);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

@media (max-width: 640px) {
  .column {
    flex: 0 0 85vw;
  }
}
```

### Step 3: Add board toggle to ListCard.tsx

Replace the entire `packages/web/src/components/lists/ListCard.tsx`:

```tsx
import { For, Show, createSignal } from 'solid-js';
import type { List, Item, Member, Attachment } from '@spaces/shared';
import { api } from '../../lib/api';
import ListItem from './ListItem';
import AddItem from './AddItem';
import ListBoardView from './ListBoardView';
import styles from './ListCard.module.css';

interface ListCardProps {
  list: List;
  items: Item[];
  members: Member[];
  attachments: Attachment[];
  slug: string;
  myId: string;
  onDeleteList: (listId: string) => void;
  onDeleteItem: (itemId: string) => void;
}

export default function ListCard(props: ListCardProps) {
  const [showMenu, setShowMenu] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [renameText, setRenameText] = createSignal('');
  const [viewMode, setViewMode] = createSignal<'list' | 'board'>('list');
  let renameRef: HTMLInputElement | undefined;

  function startRename() {
    setRenameText(props.list.name);
    setRenaming(true);
    setShowMenu(false);
    requestAnimationFrame(() => {
      renameRef?.focus();
      renameRef?.select();
    });
  }

  async function commitRename() {
    const trimmed = renameText().trim();
    if (trimmed && trimmed !== props.list.name) {
      await api.updateList(props.slug, props.list.id, { name: trimmed }).catch(() => {});
    }
    setRenaming(false);
  }

  function handleRenameKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setRenaming(false);
    }
  }

  return (
    <div class={styles.card} data-testid="list-card">
      <div class={styles.header}>
        <Show
          when={renaming()}
          fallback={
            <h2 class={styles.name} data-testid="list-name">
              {props.list.name}
            </h2>
          }
        >
          <input
            ref={renameRef}
            class={styles.renameInput}
            value={renameText()}
            onInput={(e) => setRenameText(e.currentTarget.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            maxLength={100}
            data-testid="rename-list-input"
          />
        </Show>
        <div class={styles.actions}>
          <div class={styles.viewToggle}>
            <button
              class={`${styles.viewButton} ${viewMode() === 'list' ? styles.viewButtonActive : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              data-testid="list-view-button"
            >
              ≡
            </button>
            <button
              class={`${styles.viewButton} ${viewMode() === 'board' ? styles.viewButtonActive : ''}`}
              onClick={() => setViewMode('board')}
              title="Board view"
              data-testid="board-view-button"
            >
              ⊞
            </button>
          </div>
          <button
            class={styles.menuButton}
            onClick={() => setShowMenu(!showMenu())}
            aria-label="List options"
          >
            ...
          </button>
          <Show when={showMenu()}>
            <div class={styles.menu}>
              <button
                class={`${styles.menuItem} ${styles.menuItemDefault}`}
                onClick={startRename}
                data-testid="rename-list-button"
              >
                Rename
              </button>
              <button
                class={styles.menuItem}
                onClick={() => {
                  props.onDeleteList(props.list.id);
                  setShowMenu(false);
                }}
                data-testid="delete-list-button"
              >
                Delete list
              </button>
            </div>
          </Show>
        </div>
      </div>

      <Show
        when={viewMode() === 'board'}
        fallback={
          <>
            <div class={styles.items}>
              <Show
                when={props.items.length > 0}
                fallback={<div class={styles.emptyItems}>No items yet</div>}
              >
                <For each={props.items}>
                  {(item) => (
                    <ListItem
                      item={item}
                      members={props.members}
                      attachments={props.attachments.filter((a) => a.itemId === item.id)}
                      slug={props.slug}
                      myId={props.myId}
                      onDelete={props.onDeleteItem}
                    />
                  )}
                </For>
              </Show>
            </div>
            <AddItem slug={props.slug} listId={props.list.id} />
          </>
        }
      >
        <ListBoardView
          list={props.list}
          items={props.items}
          members={props.members}
          attachments={props.attachments}
          slug={props.slug}
          myId={props.myId}
          onDeleteItem={props.onDeleteItem}
        />
      </Show>
    </div>
  );
}
```

### Step 4: Add view toggle styles to ListCard.module.css

Read the current `ListCard.module.css`, then append:

```css
.viewToggle {
  display: flex;
  gap: 2px;
}

.viewButton {
  padding: 2px 7px;
  border: 1px solid var(--color-border);
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 1rem;
  color: var(--color-text-secondary);
}

.viewButtonActive {
  background: var(--color-primary-light, #ede9fe);
  border-color: var(--color-primary);
  color: var(--color-primary);
}
```

### Step 5: Simplify Project.tsx — remove global toggle

In `packages/web/src/routes/Project.tsx`:

Remove the `viewMode` signal and the global toggle. The `BoardView` import can also be removed.

Remove this line from imports:

```tsx
import BoardView from '../components/lists/BoardView';
```

Remove:

```tsx
const [viewMode, setViewMode] = createSignal<'list' | 'board'>('list');
```

Replace the entire `<Show when={sortedLists().length > 1}>` view toggle block and the conditional `<Show when={viewMode() === 'board' ...}>` with just the list view:

```tsx
<div class={styles.lists}>
  <Show
    when={sortedLists().length > 0}
    fallback={
      <div class={styles.emptyState}>
        <p>No lists yet. Create one to get started!</p>
      </div>
    }
  >
    <For each={sortedLists()}>
      {(list) => (
        <ListCard
          list={list}
          items={itemsForList(list.id)}
          members={state.members}
          attachments={state.attachments}
          slug={params.slug}
          myId={myId() ?? ''}
          onDeleteList={handleDeleteList}
          onDeleteItem={handleDeleteItem}
        />
      )}
    </For>
  </Show>
  <NewList slug={params.slug} />
</div>
```

Also remove the unused `viewMode`-related imports from the import line (remove `createSignal` if it's no longer used — check if it's used elsewhere in the file first).

### Step 6: Verify in browser

Each list card should now have two small icon buttons (≡ for list, ⊞ for board) in its header. Clicking ⊞ switches that list to kanban columns (To Do / In Progress / Done). Items appear in their columns. Small "→ In Progress" / "→ Done" buttons let you move items between columns. Moving to Done checks the item; moving away from Done unchecks it.

### Step 7: Commit

```bash
git add packages/web/src/components/lists/ListBoardView.tsx packages/web/src/components/lists/ListBoardView.module.css packages/web/src/components/lists/ListCard.tsx packages/web/src/components/lists/ListCard.module.css packages/web/src/routes/Project.tsx
git commit -m "feat: per-list kanban board view with status columns"
```

---

## Task 6: Signup gate — email required for project/list creation

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/validation.ts`
- Modify: `packages/server/src/routes/projects.ts`
- Modify: `packages/server/src/routes/lists.ts`
- Modify: `packages/web/src/routes/Home.tsx`
- Modify: `packages/web/src/components/lists/NewList.tsx`

### Step 1: Add error code to shared ErrorResponse

In `packages/shared/src/types.ts`, update `ErrorResponse`:

```ts
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}
```

### Step 2: Add email to CreateProjectSchema

In `packages/shared/src/validation.ts`, update `CreateProjectSchema`:

```ts
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  purpose: z.string().max(MAX_PURPOSE_LENGTH).default(''),
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  email: z.string().email().max(255),
});
```

### Step 3: Store email in project creation route

In `packages/server/src/routes/projects.ts`, in the `POST /` handler:

Change the member insert to include email:

```ts
const [member] = await db
  .insert(members)
  .values({
    projectId: project.id,
    token,
    displayName,
    email: parsed.data.email,
    color: MEMBER_COLORS[0],
    avatarIndex: 0,
    isCreator: true,
    role: 'admin',
  })
  .returning();
```

Also update the destructuring at the top of the handler to include `email`:

```ts
const { name, purpose, displayName, email } = parsed.data;
```

### Step 4: Gate list creation on emailVerified

In `packages/server/src/routes/lists.ts`, in `POST /`, after the membership check, add:

```ts
if (!member.emailVerified) {
  return c.json(
    { error: 'Email verification required to create lists', code: 'EMAIL_NOT_VERIFIED' },
    403,
  );
}
```

Place it after:

```ts
if (member.projectId !== project.id) {
  return c.json({ error: 'Not a member of this project' }, 401);
}
```

### Step 5: Add email field to Home.tsx

Replace the entire `packages/web/src/routes/Home.tsx`:

```tsx
import { createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { saveIdentity } from '../lib/identity';
import styles from './Home.module.css';

export default function Home() {
  const navigate = useNavigate();
  const [name, setName] = createSignal('');
  const [purpose, setPurpose] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!name().trim() || !displayName().trim() || !email().trim()) return;

    setSubmitting(true);
    setError('');

    try {
      const result = await api.createProject({
        name: name().trim(),
        purpose: purpose().trim(),
        displayName: displayName().trim(),
        email: email().trim(),
      });
      saveIdentity(result.project.slug, result.token, result.member.id);
      navigate(`/${result.project.slug}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
      setSubmitting(false);
    }
  }

  return (
    <div class={styles.container}>
      <div class={styles.hero}>
        <h1 class={styles.title}>Spaces</h1>
        <p class={styles.subtitle}>
          The simplest way to stay aligned with people who don't use your tools.
        </p>
      </div>

      <form class={styles.form} onSubmit={handleSubmit} data-testid="create-project-form">
        <div class={styles.field}>
          <label class={styles.label} for="project-name">
            What are you working on?
          </label>
          <input
            id="project-name"
            class={styles.input}
            type="text"
            placeholder="e.g. Summer Trip Planning"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            maxLength={100}
            required
            data-testid="project-name-input"
          />
        </div>

        <div class={styles.field}>
          <label class={styles.label} for="project-purpose">
            One-line purpose <span class={styles.optional}>(optional)</span>
          </label>
          <input
            id="project-purpose"
            class={styles.input}
            type="text"
            placeholder="e.g. Planning our two weeks in Tuscany"
            value={purpose()}
            onInput={(e) => setPurpose(e.currentTarget.value)}
            maxLength={280}
            data-testid="project-purpose-input"
          />
        </div>

        <div class={styles.field}>
          <label class={styles.label} for="display-name">
            Your display name
          </label>
          <input
            id="display-name"
            class={styles.input}
            type="text"
            placeholder="e.g. Johannes"
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
            maxLength={40}
            required
            data-testid="display-name-input"
          />
        </div>

        <div class={styles.field}>
          <label class={styles.label} for="email">
            Your email
          </label>
          <input
            id="email"
            class={styles.input}
            type="email"
            placeholder="e.g. you@example.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            maxLength={255}
            required
            data-testid="email-input"
          />
        </div>

        {error() && <p class={styles.error}>{error()}</p>}

        <button
          class={styles.button}
          type="submit"
          disabled={submitting() || !name().trim() || !displayName().trim() || !email().trim()}
          data-testid="create-project-button"
        >
          {submitting() ? 'Creating...' : 'Create Space'}
        </button>
      </form>
    </div>
  );
}
```

### Step 6: Update api.ts createProject signature

In `packages/web/src/lib/api.ts`, update:

```ts
  createProject: (data: { name: string; purpose?: string; displayName: string; email: string }) =>
    request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
```

### Step 7: Handle EMAIL_NOT_VERIFIED in NewList.tsx

Replace the entire `packages/web/src/components/lists/NewList.tsx`:

```tsx
import { createSignal, Show } from 'solid-js';
import { api, ApiError } from '../../lib/api';
import EmailVerify from '../members/EmailVerify';
import styles from './NewList.module.css';

interface NewListProps {
  slug: string;
}

export default function NewList(props: NewListProps) {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [needsVerification, setNeedsVerification] = createSignal(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const val = name().trim();
    if (!val || submitting()) return;

    setSubmitting(true);
    try {
      await api.createList(props.slug, { name: val });
      setName('');
      setEditing(false);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        (err.body as any).code === 'EMAIL_NOT_VERIFIED'
      ) {
        setEditing(false);
        setNeedsVerification(true);
      }
    }
    setSubmitting(false);
  }

  function handleVerified() {
    setNeedsVerification(false);
    setEditing(true);
  }

  return (
    <>
      <Show when={needsVerification()}>
        <div class={styles.verifyPrompt} data-testid="email-verify-prompt">
          <p class={styles.verifyMessage}>Verify your email to create lists</p>
          <EmailVerify slug={props.slug} onVerified={handleVerified} />
        </div>
      </Show>

      <Show when={!needsVerification()}>
        <Show
          when={editing()}
          fallback={
            <button
              class={styles.addButton}
              onClick={() => setEditing(true)}
              data-testid="new-list-button"
            >
              + New list
            </button>
          }
        >
          <form class={styles.form} onSubmit={handleSubmit}>
            <input
              class={styles.input}
              type="text"
              placeholder="List name..."
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              maxLength={100}
              autofocus
              onBlur={() => {
                if (!name().trim()) setEditing(false);
              }}
              data-testid="new-list-input"
            />
            <button class={styles.submit} type="submit" disabled={!name().trim() || submitting()}>
              Add
            </button>
          </form>
        </Show>
      </Show>
    </>
  );
}
```

### Step 8: Add verifyPrompt styles to NewList.module.css

Read the current file, then append:

```css
.verifyPrompt {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  background: var(--color-surface);
  margin-top: var(--space-sm);
}

.verifyMessage {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-sm) 0;
}
```

### Step 9: Verify end-to-end

1. Go to http://localhost:5173 (after server restart)
2. Create a project — the form now has an email field
3. Navigate to the project
4. Click "+ New list" — since email is not yet verified, the `EmailVerify` component appears
5. Enter the email and the 6-digit code (check server console for the code in dev mode)
6. After verification, the New List form appears and list creation succeeds

### Step 10: Commit

```bash
git add packages/shared/src/types.ts packages/shared/src/validation.ts packages/server/src/routes/projects.ts packages/server/src/routes/lists.ts packages/web/src/routes/Home.tsx packages/web/src/lib/api.ts packages/web/src/components/lists/NewList.tsx packages/web/src/components/lists/NewList.module.css
git commit -m "feat: require email signup before creating projects and lists"
```

---

## Done

All six tasks complete. Restart the dev server (`pnpm dev` from root) to pick up all changes.
