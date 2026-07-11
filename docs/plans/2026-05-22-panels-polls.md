# Panels framework + Polls module

**Date:** 2026-05-22
**Status:** Draft — revised after 2 rounds of multi-agent review; ready to implement
**Goal:** Add an "Add panel" button to the bottom of the right column of the
Space view that creates new panels. Ship the first panel type — **Polls** —
end to end (create poll, vote, live results, delete). Build a thin generic
panel framework so further panel types (Doodle the appointment finder; a
Files panel once attachment storage is re-enabled) slot in without touching
layout or plumbing.

## Scope decisions (settled)

- **Generic `panels` framework retained.** Three panel types are planned
  (polls, doodle, files); the generic `panels` table owns _layout_ (type),
  per-type _content_ lives in per-type tables. A KISS review argued for a
  flat `polls`-only table; the framework was chosen deliberately so Doodle
  needs no migration of poll data later.
- **Layout:** panels stack vertically in the existing right column, under
  the scratchpad; the "Add panel" button sits at the bottom of that column.
  No CSS-grid surgery; the existing `<1020px` breakpoint already collapses
  the right column below the list.
- **Panel create:** any Space member may add a panel (visible to the whole
  Space). **Panel delete:** the panel's creator, a Space admin, or the Space
  creator.
- **Non-optimistic everywhere.** Create/vote/delete call the API and let the
  SSE echo update the store — the established codebase pattern (`AddItem.tsx`,
  `Project.tsx#handleDeleteItem`). No optimistic local writes, so no rollback
  machinery. The one bit of local state still needed is an in-flight
  _pending_ flag on the vote button (see `PollCard`) so a vote can't be
  double-fired before its echo returns.
- **This milestone ships polls only.** Doodle and Files are out of scope
  (Files is still blocked — see "Out of scope").

## Baked-in poll UX defaults

- Single choice per member. One vote per member per poll
  (`unique(panelId, memberId)`).
- Votes are **changeable and retractable** — re-clicking your option clears
  it; clicking another switches. Implemented as an upsert / delete.
- Results (counts + voter avatars) are **always visible**, including before
  you have voted. No "hide until voted" gate.
- A poll's question and options are **fixed at creation**. Editing a live
  poll is a later add, not in this milestone.

---

## 1. Data model — 3 new tables

`packages/server/src/db/schema.ts` (formatting matches existing tables;
Prettier will normalise):

```ts
export const panels = pgTable(
  'panels',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull(), // 'poll' (later 'doodle')
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
```

Rationale, all KISS-driven:

- **No `position` column.** Reorder is out of scope; panels are ordered by
  `createdAt ASC`. Adding `position` later (with the reorder UI) is a
  one-column migration.
- **Options as JSONB**, not a child table — mirrors `lists.columns`
  (`schema.ts:148`). Option ids are **server-generated** with `nanoid()`
  (default 21 chars; `varchar(64)` gives headroom). The client never
  generates option ids — the create form submits option _text_ only.
- **`unique(panelId, memberId)`** enforces one vote per member; counts are
  aggregated from `poll_votes` — no denormalised counters to drift.
- **`onDelete: cascade`** throughout: deleting a panel removes its poll +
  votes; a member leaving removes their votes; `panels.createdBy` is
  `set null` (matches the "created_by → NULL" pattern in `ropa.md`).
- **No `config` column on `panels`.** Poll content lives in `polls`.

### Migration

```
cd packages/server && npm run db:generate   # writes drizzle/0015_*.sql
```

`drizzle/` currently ends at `0014_dsa_notices.sql`, so `0015` is the next
number. Apply with `npm run db:migrate`. Purely additive (3 new tables, no
changes to existing tables) — safe to apply before the new server code ships.

---

## 2. Shared types & validation — `packages/shared/src`

### `constants.ts`

```ts
export const MAX_POLL_QUESTION_LENGTH = 280;
export const MAX_POLL_OPTION_LENGTH = 200;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_PANELS_PER_PROJECT = 20;
```

### `types.ts`

The client-facing composite is **flat** and discriminated on a top-level
`type` field (no nested `panel.panel.type`):

```ts
export interface PollOption {
  id: string;
  text: string;
}

export interface PollVote {
  optionId: string;
  memberId: string;
}

// Flat, discriminated on `type`. When Doodle lands:
//   export type PanelView = PollPanel | DoodlePanel;  (discriminate on .type)
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
```

Three new `SSEEvent` variants:

```ts
| { event: 'panel.created'; data: { panel: PollPanel; memberId: string } }
| { event: 'panel.deleted'; data: { panelId: string; memberId: string } }
| { event: 'poll.vote';     data: { panelId: string; memberId: string; optionId: string | null } }
```

Add `panels: PollPanel[]` to `ProjectLoadResponse`.

### `validation.ts`

```ts
export const CreatePanelSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('poll'),
      question: z.string().trim().min(1).max(MAX_POLL_QUESTION_LENGTH),
      options: z
        .array(z.string().trim().min(1).max(MAX_POLL_OPTION_LENGTH))
        .min(MIN_POLL_OPTIONS)
        .max(MAX_POLL_OPTIONS),
    })
    .strict(),
]);

export const PollVoteSchema = z.object({ optionId: z.string().min(1).max(64).nullable() }).strict();
```

`.strict()` rejects unknown keys. The discriminated union is the extension
seam: adding Doodle = add a union member.

---

## 3. Server

### `lib/serialize.ts`

- `serializePollPanel(panelRow, pollRow, voteRows)` → `PollPanel` (flat):
  panel fields + question + options + `votes` mapped to `{ optionId, memberId }`.

### `routes/panels.ts` (new — modeled on `routes/items.ts`)

`export const panelRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>()`.
`recordActivity` takes `(tx, params)` and the resulting entry is broadcast
**after the transaction commits** (per its doc comment and `items.ts`).

- **`POST /`** — `authMiddleware`. Any member may create.
  - **Rate limit:** `checkRateLimit(\`panel-create:${member.id}\`, 5, 60*000)`→`429` if exceeded. Member-keyed (the threat is an authenticated member,
    not an IP). 5/min bounds create+delete activity-feed churn; note items
    have \_no* create rate limit today, so panels are already stricter.
  - Validate `CreatePanelSchema`. In one `db.transaction`: 1. Count panels for the project; if `>= MAX_PANELS_PER_PROJECT`, return
    `422`. (Count-then-insert is not atomic under READ COMMITTED, so the
    cap is best-effort — worst case a couple over. Acceptable for a soft
    limit; not worth an advisory lock. The cap bounds the `GET /:slug`
    payload size; the rate limit bounds bursts — they cover different
    things, keep both.) 2. Insert the `panels` row (`type: 'poll'`, `createdBy: member.id`). 3. Generate option ids (`nanoid()`), insert the `polls` row. 4. `recordActivity(tx, { projectId: project.id, memberId: member.id,
action: 'panel.created', targetType: 'panel', targetId: panel.id,
meta: { type: 'poll' } })`.
  - After commit: broadcast `panel.created` (full flat `PollPanel`,
    `votes: []`) and `activity`. Return `201` with the `PollPanel`.

- **`DELETE /:panelId`** — `authMiddleware`. In one `db.transaction`: load
  the panel scoped to the project (`404` if missing). **Authorize:**
  `member.id === panel.createdBy || member.role === 'admin' ||
member.isCreator` — else `403`. (The `role === 'admin' || isCreator`
  predicate is exactly what the codebase's `requireAdmin` middleware uses
  — `middleware/auth.ts`; do not drop `isCreator` or a Space creator who
  isn't separately flagged `admin` is locked out.) Delete the `panels` row
  (cascade removes poll + votes). `recordActivity(tx, { projectId:
project.id, memberId: member.id, action: 'panel.deleted', targetType:
'panel', targetId: panelId, meta: { type: panel.type } })` — **`targetId`
  is required** (`activity.target_id` is `NOT NULL uuid`). After commit:
  broadcast `panel.deleted` + `activity`. Return `204`.

- **`POST /:panelId/vote`** — `authMiddleware`.
  - **Rate limit:** `checkRateLimit(\`poll-vote:${member.id}\`, 30, 60_000)`→`429`.
  - Validate `PollVoteSchema`. In one `db.transaction`: 1. Load the `polls` row by `panelId`, joined to `panels` scoped to the
    project. `404` if absent — this single check proves the panel exists,
    belongs to the project, and is a poll. 2. If `optionId !== null`, assert it is one of `poll.options[].id` —
    else `422`. (Validating inside the tx keeps it correct once live-poll
    editing is added later.) 3. `optionId === null` → delete this member's `poll_votes` row.
    Else → `insert ... onConflictDoUpdate({ target: [pollVotes.panelId,
pollVotes.memberId], set: { optionId } })`.
  - After commit: broadcast `poll.vote`. **No activity entry** — votes are
    high-frequency and would flood the feed. Return `204`.

Activity `meta` stores only `{ type }` — no user-authored text — so panel
deletion needs no `activity.meta` scrubbing (unlike `items.ts`). See
"Compliance & docs" for the audit-trail consequence of hard-deleting polls.

### `routes/projects.ts`

- `import { panelRoutes }`; mount `slugRoutes.route('/panels', panelRoutes)`
  next to the other sub-routes (~line 230).
- In `GET /:slug`, load panels: add the panels-by-`projectId` query (ordered
  by `createdAt`) to the existing `Promise.all` alongside members + items.
  If there are no panels, set `panels: []`. Otherwise run the polls and
  votes queries (`inArray(panelId, ids)`) in a second `Promise.all`.
  Assemble into `PollPanel[]`, add to the response as `panels`.
- **Project creation needs no change** — panels start empty.

---

## 4. Frontend — `packages/web/src`

### `lib/store.ts`

- Add `panels: PollPanel[]` to `ProjectState`, the initial store, and
  `resetState`. Import `PollPanel`.
- `setProjectData`'s parameter is an **inline object type** (not
  `ProjectLoadResponse`) — add `panels: PollPanel[]` (required) to that
  inline type _and_ to the `setState({...})` call inside it.
- New mutations, **all driven only by the SSE handlers** (no component
  writes directly — non-optimistic):
  - `addPanel(panel: PollPanel)` — append, skip if id already present
    (mirrors `addMember`; append keeps `createdAt ASC` since new panels are
    newest).
  - `removePanel(panelId: string)`.
  - `setPollVote(panelId, memberId, optionId: string | null)` — remove any
    existing vote by `memberId` in that panel, then push `{ optionId,
memberId }` if `optionId` is non-null. Remove-then-replace (**not** a
    blind append) — idempotent, so the actor safely processes the echo of
    its own vote (`sseManager.broadcast` sends to the actor too).

### `lib/sse.ts`

Add three handlers to `EVENT_HANDLERS`:

```ts
'panel.created': (d) => addPanel(d.panel),
'panel.deleted': (d) => removePanel(d.panelId),
'poll.vote':     (d) => setPollVote(d.panelId, d.memberId, d.optionId),
```

**SSE reconnect caveat:** reconnect only _resumes the event stream_ —
`sse.ts`'s `scheduleReconnect` does **not** re-fetch `GET /:slug`, and events
missed during a disconnect window are not replayed. Panels accept the same
eventual-consistency behaviour as items/scratchpad today; not a regression,
out of scope to fix here.

### `lib/api.ts`

```ts
createPanel: (slug, data: { type: 'poll'; question: string; options: string[] }) =>
  request<{ panel: PollPanel }>(`/projects/${slug}/panels`, { method: 'POST', body: ... }, slug),
deletePanel: (slug, panelId) =>
  request<void>(`/projects/${slug}/panels/${panelId}`, { method: 'DELETE' }, slug),
votePoll: (slug, panelId, optionId: string | null) =>
  request<void>(`/projects/${slug}/panels/${panelId}/vote`, { method: 'POST', body: ... }, slug),
```

`deletePanel` / `votePoll` are `request<void>` (204). All three pass `slug`
so the `Authorization` header is attached.

### `components/activity/ActivityFeed.tsx` — **must be updated**

`ActivityFeed` filters entries through a hardcoded `KNOWN_ACTIONS` set and
drops anything not in it; `formatAction` has a switch with an empty
`default`. Without changes, `panel.created` / `panel.deleted` entries would
be **silently filtered out and never shown**. Add to both:

```ts
// KNOWN_ACTIONS: add 'panel.created', 'panel.deleted'
// formatAction switch (new cases before `default`):
case 'panel.created':
  return { actor, verb: 'added', subject: `a ${String(meta.type ?? 'panel')}` };
case 'panel.deleted':
  return { actor, verb: 'removed', subject: `a ${String(meta.type ?? 'panel')}` };
```

Deriving the subject from `meta.type` keeps it correct for future panel types.

### Components — new directory `components/panels/`

- **`PanelColumn.tsx`** — `<For>` over `state.panels` rendering `PollCard`
  directly (one type today). When Doodle lands, wrap the body in a `<Switch>`
  on `panel.type` — that is the runtime extension seam; a comment marks the
  spot. Renders `AddPanelButton` at the bottom. **Empty state:** when
  `state.panels` is empty, render just the `AddPanelButton`.
- **`PollCard.tsx`** — `<section class={card}>` matching `ScratchpadCard`'s
  header/content structure.
  - Each option is a real `<button type="button">` with `aria-pressed` set
    when it is the current member's vote — a `div` would not be keyboard-
    accessible.
  - Render `question` and `option.text` as **text nodes** (Solid escapes by
    default) — never `innerHTML`. This is the first feature broadcasting a
    structured array of member-authored text; same trust boundary as item
    text, so keep the same hygiene.
  - Shows a fill bar + vote count + voter `<Avatar>`s. Fill width is
    `count / Math.max(totalVotes, 1)` — guard the zero-votes divide.
  - **Derive voter avatars by joining `votes` against the live
    `state.members` list and skip any vote whose `memberId` is no longer a
    member** — otherwise a removed member leaves a ghost avatar.
  - A local `pending` signal: set on option click, cleared when
    `api.votePoll` settles (`finally`). While `pending`, **disable all
    option buttons** so a rapid double-click can't fire N requests. The
    displayed vote still updates from the `poll.vote` SSE echo (typically
    arriving within the same round-trip). Click an option → `api.votePoll`;
    re-click your option → `votePoll(…, null)` (retract); click another →
    switch. On error show a toast; on `404` the `panel.deleted` SSE will
    have already removed the card.
  - No "created by" attribution is shown on the card (so `createdBy: null`
    after the creator leaves needs no special handling).
  - A delete control is shown only when `myId === panel.createdBy`, the
    current member is an admin, or the current member is the Space creator;
    it calls `api.deletePanel`.
- **`AddPanelButton.tsx`** — a `Button` that **directly opens a `Dialog`**
  with the poll-create form: a `TextField` for the question and 2–10 dynamic
  option rows. Submit is disabled until the question and ≥2 options are
  non-empty (client mirror of `CreatePanelSchema`); on submit →
  `api.createPanel`, then close the dialog on `201`. The panel arrives via
  the `panel.created` SSE echo — **do not** add it from the HTTP response
  (matches `AddItem.tsx`; `addPanel`'s id-dedup is only a safety net). No
  type-picker menu while there is one panel type — when Doodle lands, the
  button opens a small `Popover` to choose the type first. Show pending +
  error states.
  - **Accessibility of the dynamic option rows:** each option input has a
    real `<label>` or `aria-label` ("Option 3"); the remove-row button has
    an `aria-label`; after **adding** a row, focus moves to the new input
    (`requestAnimationFrame(() => ref?.focus())`, as `ListItem` does); after
    **removing** a row, focus moves to the next row's input, or the add-row
    button if none follows. `Dialog` already provides focus trap, Escape,
    and focus restore.

### `routes/Styleguide.tsx`

`CLAUDE.md` requires `/_styleguide` stay current; the route already has
feature-component sections ("Add Item", "Tasks", "Scratchpad", "Recent
activity"). Add a **"Polls"** section showing `PollCard` in its unvoted,
voted, and zero-votes states, and the `AddPanelButton`.

### Components built from primitives / tokens

The three new components are feature components built from existing
`components/ui` primitives. **Reuse existing design tokens from
`global.css`** for the fill bar and count badge — introduce no new
colours/tokens. Give components `data-testid`s (`panel-column`,
`add-panel-button`, `poll-card`, `poll-option`, `poll-delete`) for the e2e
suite.

### `routes/Project.tsx` + `Project.module.css`

The right column is a single grid child. Today `<Show when={state.scratchpad}>`
wraps the whole `.scratchpads` div. Restructure so the div is always the grid
child and holds both (keep its existing `data-testid="scratchpads-section"`
— no rename):

```tsx
<div class={styles.scratchpads} data-testid="scratchpads-section">
  <Show when={state.scratchpad}>
    <ScratchpadCard pad={state.scratchpad!} ... />
  </Show>
  <PanelColumn
    panels={state.panels}
    members={state.members}
    slug={params.slug}
    myId={myId() ?? ''}
    myRole={state.members.find((m) => m.id === myId())?.role ?? 'member'}
    isCreator={state.members.find((m) => m.id === myId())?.isCreator ?? false}
  />
</div>
```

The scratchpad is auto-created at project creation and lazily by `GET /:slug`,
so the right column always has content; the `<Show>` is defensive.
`.scratchpads` is already `display:flex; flex-direction:column; gap` — panels
reuse it. No change to the `.content` grid or the `@media` breakpoints; the
right column already collapses below the list at `<1020px`. Add a minimal
`.panels` rule only if spacing needs tuning.

### i18n

The web app has **no i18n framework** — all existing strings are hardcoded
English. New panel/poll UI strings follow suit. Localisation is a separate
cross-cutting effort, out of scope.

---

## 5. Compliance & docs

The feature introduces three new tables holding member-linked / user-authored
data. Update **in the same PR** (verify exact section headings when editing):

- **`docs/erasure-runbook.md`** —
  - Amend the **"Creator / Space deletion"** step that enumerates what
    `DELETE FROM projects` cascades (currently "members, lists, scratchpad,
    items, attachments metadata, activity rows") to also list
    `panels` / `polls` / `poll_votes`.
  - Amend the **member-erasure** section: a removed member's `poll_votes`
    cascade-delete, and `panels.createdBy` → NULL for panels they created.
  - Add a distinct note (do **not** graft onto the soft-delete-shaped
    "Specific content deletion" step): panels/polls are **hard-deleted**
    with no retention sweep — an operator removes an abusive poll by
    deleting the `panels` row directly (cascade clears poll + votes);
    creator/admin/Space-creator may do this in-app.
- **`docs/dsar-runbook.md`** — the access/portability export must include
  the requesting member's authored poll questions/options and the votes
  they cast.
- **`docs/ropa.md`** §2 — add `panels` / `polls` / `poll_votes` to the data
  inventory.

**Audit-trail gap (acknowledged, not fixed here):** panels are hard-deleted
with no soft-delete/restore, and `panel.deleted` activity carries no question
text. For a DSA Art. 17 Statement of Reasons on a removed poll, the operator
must capture the question text out-of-band before deletion — consistent with
the existing operator-manual content-removal stance in `CLAUDE.md`.

---

## 6. Tests

`packages/server` has **no unit-test runner**. All coverage goes into the
Playwright e2e suite — `packages/e2e/tests/panels.spec.ts` (new), reusing
existing helpers and the `data-testid`s above:

- **Happy path** (two browsers): member A adds a poll panel; member B sees
  it live; B votes; A sees the count update; B changes then retracts the
  vote; creator A deletes the panel and it disappears for both.
- **Activity feed:** `panel.created` / `panel.deleted` render in the feed.
- **Ghost avatars:** B votes; admin A removes B; A sees the vote count
  persist but B's avatar gone from `PollCard`.
- **Authorization:** a non-creator non-admin gets `403` on `DELETE`;
  creator, admin, and Space creator succeed.
- **Validation rejections:** 0 options, 11 options, an empty / 281-char
  question are all rejected.
- **Vote integrity:** voting twice leaves exactly one `poll_votes` row;
  bogus `optionId` → `422`; voting on a deleted / non-poll panel → `404`.
- **Abuse limits:** exceeding the panel-create and vote rate limits → `429`;
  the `MAX_PANELS_PER_PROJECT` cap → `422`.

Gate: `npm run typecheck && npm run lint && npm run test:e2e` green.

---

## 7. Out of scope (do not bundle)

- **Doodle (appointment finder)** — next panel type; reuses the framework
  and the poll's "options + per-member responses" shape. Revisit a shared
  `panel_options`/`panel_responses` model _then_, with two real callers.
- **Files panel** — blocked: needs blob storage, and attachment uploads are
  intentionally disabled (`CLAUDE.md` "Attachments (disabled)").
- **Drag-to-reorder panels** — no `position` column yet; add both together.
- **Editing a live poll** (question/options) — fixed at creation for now.
- **Extracting a shared `Card` UI primitive** from `ListCard` /
  `ScratchpadCard` / `PollCard` — worthwhile, but a separate change.
- **Multi-select polls, closing/reopening, deadlines, panel soft-delete /
  restore** — later.
- **SSE missed-event replay on reconnect** — pre-existing limitation shared
  with items; not addressed here.

---

## 8. Build sequence

Each step is independently testable:

1. Schema + migration + shared constants/types/validation.
2. Server: `serializePollPanel` + `routes/panels.ts` (rate limits, panel
   cap, transactional vote) + mount + `GET /:slug`.
3. Frontend plumbing: `api` + `store` + `sse` + `ActivityFeed` update.
4. Components (`PanelColumn`, `PollCard`, `AddPanelButton`) + `Project.tsx`
   / `Project.module.css` layout + `Styleguide.tsx` "Polls" section.
5. Compliance & doc updates (`erasure-runbook.md`, `dsar-runbook.md`,
   `ropa.md`).
6. e2e test.

**Estimate:** ~4–5 focused days for one developer.

## Acceptance

- [ ] Migration `drizzle/0015_*.sql` creates `panels`, `polls`,
      `poll_votes`; `npm run db:migrate` applies cleanly.
- [ ] `POST /panels` creates a poll panel (any member); `panel.created`
      broadcasts; activity records `panel.created` with `targetId`.
- [ ] Panel-create (5/min) and vote (30/min) endpoints are member-keyed
      rate-limited (`429`); `MAX_PANELS_PER_PROJECT` is enforced (`422`).
- [ ] `POST /panels/:id/vote` casts, changes, and clears a vote inside a
      transaction; rejects bogus `optionId` (`422`) and non-poll panels
      (`404`); `unique(panelId, memberId)` holds; `poll.vote` broadcasts;
      the vote button is disabled while a request is in flight.
- [ ] `DELETE /panels/:id` is `403` for non-creator non-admins, `204` for
      the panel creator, a Space admin, or the Space creator (`isCreator`);
      cascade removes poll + votes; activity records `panel.deleted` with
      `targetId`.
- [ ] `GET /:slug` returns `panels` ordered by `createdAt`.
- [ ] `panel.created` / `panel.deleted` render in the activity feed
      (`ActivityFeed.tsx` `KNOWN_ACTIONS` + `formatAction` updated).
- [ ] Right column shows stacked poll panels under the scratchpad with an
      "Add panel" button at the bottom; results update live across clients;
      removed members leave no ghost avatars.
- [ ] `/_styleguide` has a "Polls" section.
- [ ] `erasure-runbook.md`, `dsar-runbook.md`, `ropa.md` updated for the new
      tables.
- [ ] `npm run typecheck && npm run lint && npm run test:e2e` green.
