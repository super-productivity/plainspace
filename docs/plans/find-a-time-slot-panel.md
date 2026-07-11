# Plan: TimeSlot panel (availability poll)

## Goal

Add a second panel type, **TimeSlot**, alongside the existing Poll. A Poll answers
_"which option?"_ (single-select). A TimeSlot answers _"which time(s) work for
everyone?"_ (multi-select availability across a set of slots). This is the panel
type the codebase already anticipates in three places:

- `packages/shared/src/types.ts` — `// When TimeSlot lands: PanelView = PollPanel | TimeSlotPanel`
- `packages/server/src/db/schema.ts` — `'poll' (later 'timeslot')`, `'polls' today; 'timeslots' etc. later`
- `packages/web/src/components/panels/PanelColumn.tsx` — `// When TimeSlot lands, wrap the body in a <Switch> on panel.type`

The generic `panels` table (layout: type + creator + createdAt ordering) already
exists; only per-type content + UI is new.

## Scope decision (read before implementing)

**v1 = two-state availability.** A TimeSlot has free-text **slots** (labels like
"Mon 9am", "Tue 2pm") and each member toggles each slot **available / not**.
A row in `timeslot_responses` means "this member is available for this slot";
absence means not-available/no-response. The best slot is the one with the most
available members.

This is the smallest delta from Poll that delivers scheduling: it is literally
"a poll where you can pick multiple options," reusing the poll machinery almost
verbatim (per-(panel,member) upsert → per-(panel,member,slot) upsert). It is the
KISS-aligned choice for this codebase.

**Deferred (NOT in v1):** tri-state yes/_maybe_/no ("if-need-be"), and
structured date/time slots (date pickers, timezones). Both are real TimeSlot
features but each adds meaningful surface (extra column + cycling UI states;
tz/RRULE handling). The repeat-rule code (`RepeatRule` in types.ts) shows the
project _can_ do tz/RRULE, but YAGNI says wait for a concrete ask. Free-text
slots + two-state get the use-case done. Tri-state is a clean follow-up: add an
`availability` enum column to `timeslot_responses` and a third button to the slot
row; nothing in v1 blocks it.

**Rejected alternative — `multiSelect` boolean on Poll** (relax the
`unique(panel,member)` constraint instead of a new type): rejected because the
codebase is explicitly architected for a separate `timeslot` type, a separate
table lets TimeSlot diverge (slot-vs-option wording, best-slot highlight, future
dates) without conditionals smeared through `PollCard`, and conditionally
relaxing a load-bearing unique index is messier than a clean second table.

## Data model

Mirror `polls` / `poll_votes` exactly.

```ts
// schema.ts
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
  (t) => [
    uniqueIndex('idx_timeslot_responses_panel_member_slot').on(t.panelId, t.memberId, t.slotId),
  ],
);
```

Slot ids are **server-generated** (`nanoid()`), exactly like poll option ids —
the client submits slot labels only.

The unique index is `(panelId, memberId, slotId)` — deliberately **one more
column** than polls' `(panelId, memberId)`. That extra column is the whole point
of TimeSlot (multi-select: a member may mark many slots); leave a one-line comment
so a future reader doesn't "fix" it back to the poll shape.

## File-by-file changes

Each step pairs with its verify. Run `npm run check` (typecheck + lint +
format:check) after the shared/server/web edits; `npm run test:e2e` at the end.

### shared (`packages/shared/src`)

1. **constants.ts** — add below the poll constants:

   ```ts
   export const MAX_TIMESLOT_TITLE_LENGTH = 280;
   export const MAX_TIMESLOT_SLOT_LENGTH = 80;
   export const MIN_TIMESLOT_SLOTS = 2;
   export const MAX_TIMESLOT_SLOTS = 15;
   ```

   `MAX_PANELS_PER_PROJECT` is shared across types — no change.

2. **types.ts** —
   - Add `TimeSlot { id; label }`, `TimeSlotResponse { slotId; memberId }`,
     `TimeSlotPanel { id; projectId; type: 'timeslot'; createdBy; createdAt; title; slots; responses }`.
   - Add `export type PanelView = PollPanel | TimeSlotPanel;` and replace the
     "When TimeSlot lands" comment.
   - `ProjectLoadResponse.panels: PanelView[]`.
   - SSE: change `panel.created` data `panel: PollPanel` → `panel: PanelView`;
     add `| { event: 'timeslot.response'; data: { panelId: string; memberId: string; slotId: string; available: boolean } }`.
   - _verify:_ `npm run typecheck` surfaces every downstream `PollPanel`-typed
     site that must widen to `PanelView` (store, api, PanelColumn) — fix each.

3. **validation.ts** —
   - Add a `'timeslot'` arm to the `CreatePanelSchema` discriminated union:
     ```ts
     z.object({
       type: z.literal('timeslot'),
       title: z.string().trim().min(1).max(MAX_TIMESLOT_TITLE_LENGTH),
       slots: z.array(z.string().trim().min(1).max(MAX_TIMESLOT_SLOT_LENGTH))
         .min(MIN_TIMESLOT_SLOTS).max(MAX_TIMESLOT_SLOTS),
     }).strict(),
     ```
   - Add `export const TimeSlotRespondSchema = z.object({ slotId: z.string().min(1).max(64), available: z.boolean() }).strict();`
     and its inferred type.

### server (`packages/server/src`)

4. **db/schema.ts** — add the two tables above (after `pollVotes`).

5. **migration** — run `npm run db:generate --workspace @plainspace/server`
   to emit `drizzle/0019_*.sql` + update `drizzle/meta` (incl. `_journal.json`).
   Hand-review the SQL: two `CREATE TABLE` + the unique index, FKs
   `ON DELETE CASCADE`. drizzle-kit generate diffs the schema snapshot — no live
   DB needed to _generate_. **Commit the generated `.sql` AND the `meta/` changes** —
   `npm run test:e2e` migrates a fresh Postgres from `drizzle/` on boot (this is
   how the poll tables get there); an uncommitted migration → every timeslot test
   500s on a missing table.
   _verify:_ generated SQL matches the model; no unintended diffs to other tables.

6. **lib/serialize.ts** — add `serializeTimeSlotPanel(panel, timeslot, responses): TimeSlotPanel`
   mirroring `serializePollPanel` (inline panel layout fields + `title`, `slots`,
   `responses.map(r => ({ slotId, memberId }))`). Add the `TimeSlotRow` /
   `TimeSlotResponseRow` `$inferSelect` types next to the poll ones.

7. **routes/panels.ts** —
   - **create:** branch on `parsed.data.type`. The `panels` insert sets
     `type: parsed.data.type` (not hardcoded `'poll'`). For `'timeslot'`: generate
     slot ids, insert into `timeslots`, set activity meta `{ type: 'timeslot' }`,
     serialize via `serializeTimeSlotPanel`, broadcast `panel.created`. Keep the
     poll branch behaviorally identical. Reuse the same cap check + rate limit.
   - **respond endpoint:** `POST /:panelId/respond`, `authMiddleware`,
     rate-limit `timeslot-respond:${member.id}` 30/60_000 (mirror poll-vote).
     Parse `TimeSlotRespondSchema`. In a tx: load the timeslot via
     `timeslots ⋈ panels` scoped to `project.id` (proves it exists, belongs to the
     project, and is a timeslot); 404 if missing; 422 if `slotId` not in
     `timeslot.slots`. `available` → `insert ... onConflictDoNothing` on
     `(panelId, memberId, slotId)`; `!available` → `delete` that row. Both are
     **idempotent**: a redundant available toggle is a no-op insert, and a
     retract with no existing row still returns **204** (mirror the poll
     `optionId: null` retract — no spurious 404). No `recordActivity`
     (high-frequency, like votes). Broadcast `timeslot.response`
     `{ panelId, memberId, slotId, available }`.
   - **delete:** unchanged — already type-agnostic (cascade + `meta: { type: panel.type }`).

8. **routes/projects.ts** (full-project load) — partition `projectPanels` by
   `type`. For poll ids load `polls` + `pollVotes` (existing); for timeslot ids
   load `timeslots` + `timeslotResponses`. Assemble a single `PanelView[]` in the
   original `projectPanels` (createdAt) order via `flatMap`, picking the
   serializer by `panel.type`. Keep the empty-panels fast path (no `inArray([])`).

### web (`packages/web/src`)

9. **lib/store.ts** — widen `panels: PanelView[]` at **every** site:
   `AppState.panels`, the `setProjectData` arg, the reset/clear default, AND
   **`addPanel(panel: PollPanel)` at line ~163** (the `panel.created` SSE handler
   pipes `d.panel` straight in — miss this one and the handler won't typecheck
   for a timeslot). Add `setTimeSlotResponse(panelId, memberId, slotId, available)`:
   locate the panel and **early-return unless `panel.type === 'timeslot'`** (this
   guard is load-bearing — a `timeslot.response` and a `poll.vote` can both target
   a panel id during a race; without it you'd push a response onto a `PollPanel`),
   remove any existing `(memberId, slotId)` response, push `{ slotId, memberId }`
   when `available`. Mirror `setPollVote`'s produce/early-return shape.

10. **lib/api.ts** — `createPanel` param becomes the union
    `{ type: 'poll'; question; options } | { type: 'timeslot'; title; slots }`;
    return `{ panel: PanelView }`. Add
    `respondTimeSlot(slug, panelId, slotId, available)` → `POST .../respond`.

11. **lib/sse.ts** — import `setTimeSlotResponse`; add
    `'timeslot.response': (d) => setTimeSlotResponse(d.panelId, d.memberId, d.slotId, d.available)`.

12. **components/panels/PanelColumn.tsx** — `panels: PanelView[]`; replace the
    single `<PollCard>` with `<Switch>`/`<Match>` on `panel.type` →
    `PollCard` | `TimeSlotCard`. `canDelete` already uses only common fields
    (`createdBy`) — keep it, typed on `PanelView`.

13. **components/panels/AddPanelButton.tsx** — add a panel-type selector inside
    the dialog. **Default to the poll form** so the existing poll e2e flow
    (`add-panel-question` / `add-panel-option` / `add-panel-submit` /
    `add-panel-add-option`) keeps working with **no extra clicks** and unchanged
    testids. Add a TimeSlot branch: title field + slot rows reusing the existing
    add/remove-row + `optionRefs` focus pattern (rename locally to slots). New
    testids: `add-panel-type-poll`, `add-panel-type-timeslot`, `add-panel-title`,
    `add-panel-slot`, `add-panel-add-slot`, `add-panel-timeslot-submit`. Submit
    calls `api.createPanel({ type: 'timeslot', title, slots })`.
    **Make the poll-specific copy type-dependent** — today these are hardcoded:
    dialog `ariaLabel="Add poll"` → `"Add panel"`; `<h2>New poll` →
    `New poll` / `New timeslot`; submit `Create poll` → `Create timeslot`; the catch
    error `'Could not create poll…'` → timeslot wording. (No e2e asserts these
    strings, so zero test risk, but don't ship a timeslot form titled "New poll".)
    Keep `api.createPanel`'s poll arm byte-identical (`{ type:'poll'; question; options }`)
    so the existing poll call site doesn't break.
    Consider extracting the shared label-row editor if the duplication is real,
    but only if it actually reads cleaner (KISS — default to NOT extracting).

14. **components/panels/TimeSlotCard.tsx** (+ `.module.css`) — mirror `PollCard`:
    - `responderAvatars(slotId)` joins `responses` against live `members`
      (drop ghosts — same defensive filter as PollCard).
    - Per-slot row: a toggle button (`aria-pressed` = I'm available),
      `available` count, responder avatars, and a "best slot" highlight on the
      max-count slot(s) (skip highlight when all counts are 0).
    - Multi-select: toggling a slot is independent per slot (no cross-slot
      disable). Disable only the in-flight slot's button while its request is
      pending (`respondingSlotId`), mirroring PollCard's per-action in-flight cue.
    - Delete button gated on `canDelete`.
    - testids: `timeslot-card`, `timeslot-slot`, `timeslot-slot-count`,
      `timeslot-responder-avatar`, `timeslot-delete`.

15. **routes/Styleguide.tsx** — add a TimeSlotCard example beside the existing
    panel/poll examples (CLAUDE.md requires the styleguide stay current). The
    existing demos build `PollPanel` literals with `votes`; the timeslot demo must
    be a **`TimeSlotPanel` literal** (`type: 'timeslot'`, `title`, `slots`,
    `responses` — NOT `votes`) or it won't compile under `strict: true`.

### tests (`packages/e2e`)

16. **tests/timeslots.spec.ts** (new; mirror `tests/panels.spec.ts` helpers and
    the open-two-pages pattern). **Consolidate like the poll spec does** — don't
    write one test per bullet:
    - **Lifecycle (single user):** create timeslot via UI (type selector → title +
      slots) → SSE render; toggle a slot (`aria-pressed`, count) → untoggle;
      then **mark two slots available at once** and assert both show
      `aria-pressed=true` with count 1 (the behavior a poll's `unique(panel,member)`
      forbids — the core differentiator); creator deletes → card gone.
    - **Two-user realtime:** B sees A's create, A's responses update B's counts,
      A's delete removes B's card (mirror panels.spec `two users…`).
    - **Cross-event isolation:** one poll + one timeslot in the same project; a
      `timeslot.response` must not touch the poll's votes and vice-versa (regression
      net for the `setTimeSlotResponse` type guard). Can be UI or API-level.
    - **Auth:** non-creator 403 on delete; admin-non-creator 204 (mirror existing).
    - **Validation (one test, all cases):** `<MIN_TIMESLOT_SLOTS` slots,
      `> MAX_TIMESLOT_SLOTS` slots (build the array from the **constant**, not a
      literal `16`), empty title, over-length title → 422. Fold into a single
      test like `panels.spec.ts:339`.
    - **Respond integrity (one test):** respond on non-existent panel → 404;
      bogus `slotId` → 422; duplicate available toggle is one row — assert via the
      full `GET /api/projects/:slug` payload (there is **no** per-panel GET; copy
      the pattern at `panels.spec.ts:193` 'vote integrity').
    - **Activity:** "added a timeslot" / "removed a timeslot" (already generic via
      `a ${meta.type}` — one assertion).

## Risks / notes

- **Type widening churn:** changing `panels` to `PanelView` ripples through
  store/api/PanelColumn. The typechecker is the checklist — let it drive.
- **AddPanelButton regression:** the existing poll e2e is the guard. Keep poll
  testids byte-identical and default the dialog to poll.
- **Cap + rate limits:** `MAX_PANELS_PER_PROJECT` and the create rate limit are
  type-agnostic and already cover timeslots.
- **DSA/delete:** delete is already type-agnostic; no SoR changes (consistent
  with the existing poll handling and CLAUDE.md's post-launch note).
- **Non-goals (do not build):** tri-state availability, date/time slots,
  per-slot comments, reminders tied to a chosen slot.

## Sequence for the implementing agent

shared (2,3,1) → server schema+migration (4,5) → serialize (6) → routes (7,8)
→ `npm run check` → web store/api/sse (9,10,11) → PanelColumn + TimeSlotCard +
AddPanelButton + Styleguide (12,13,14,15) → `npm run check` → e2e (16) →
`npm run test:e2e`. Commit as one `feat(panels): add TimeSlot availability panel`.
