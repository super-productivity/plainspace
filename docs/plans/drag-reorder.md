# Drag-to-reorder for the task list

## Goal

Let members reorder open items in the task list by dragging. Mobile (touch) is
the primary platform: long-press a row to lift it, drag, drop. Desktop drags
immediately with the mouse. Done section is not sortable (KISS — no use case).

## Approach

**SortableJS** (`sortablejs` ^1.15.7, 0 deps, ~18 KB gzip) with
`forceFallback: true` so it uses its own pointer/touch engine instead of native
HTML5 drag-and-drop (which is broken on touch). No drag handle: long-press is
the established mobile pattern (Google Tasks, Todoist) and avoids cluttering
already-dense rows on small screens.

**Everything below the UI already exists** (verified):

- `items.position` integer column, gap-based (`POSITION_GAP = 1000`,
  `packages/shared/src/constants.ts:29`); new items get `max + 1000`
  (`packages/server/src/routes/items.ts:107`).
- `PATCH /api/projects/:slug/items/:itemId` accepts `position`
  (`packages/shared/src/validation.ts:117`, `items.ts:173`). A position-only
  PATCH records **no** activity entry (checked in `items.ts:222-250`), so
  reordering does not spam the activity feed.
- The PATCH broadcasts `item.updated` over SSE; the web store replaces the item
  (`packages/web/src/lib/store.ts:103-110`) and `ListCard` re-sorts by
  `position` (`ListCard.tsx:159,172`). Remote clients sync for free.

No server, schema, or shared-type changes.

## Steps

Each step pairs with its verification.

### 1. Add dependency

`npm i sortablejs` + `npm i -D @types/sortablejs` in `packages/web`.
→ verify: `npm run typecheck` in `packages/web` passes.

### 2. Position math helper

New file `packages/web/src/lib/reorder.ts` — a pure function:

```ts
computeReorderPosition(sorted: Item[], prevId: string | null, nextId: string | null):
  | { kind: 'single'; position: number }
  | { kind: 'renumber'; positions: Map<string, number> }
```

- Dropped between neighbors: midpoint `Math.floor((prev + next) / 2)`; if the
  midpoint equals either neighbor (gap exhausted) → `renumber`.
- Dropped at top: `Math.floor(next / 2)`; must stay ≥ 1 (server validation
  requires a positive integer) else `renumber`.
- Dropped at bottom: `prev + POSITION_GAP`.
- `renumber` assigns `(index + 1) * POSITION_GAP` to every open item in the new
  order. This is the rare fallback (~10 repeated bisections at the same spot).

→ verify: typecheck; covered indirectly by the e2e test (no unit-test infra in
`packages/web` — do not add one).

### 3. Mount Sortable in `ListCard`

In `ListCard.tsx`, ref the open-items container (`<div class={styles.items}>`
that holds the open `<For>`) and mount Sortable in `onMount`, destroy in
`onCleanup`. Config:

```ts
{
  forceFallback: true,        // never use native HTML5 DnD
  animation: 150,
  delay: 250,                 // long-press to lift…
  delayOnTouchOnly: true,     // …on touch only; desktop drags immediately
  touchStartThreshold: 5,     // finger drift cancels the long-press → page scrolls
  fallbackTolerance: 5,       // sloppy desktop clicks stay clicks
  filter: 'input',            // text selection in the edit input must not drag
  preventOnFilter: false,
  draggable: '[data-item-id]',
  ghostClass: <CSS-module class>,  // see step 5
}
```

**Critical — Solid owns the DOM.** `<For>` keys rows by object reference and
moves nodes itself. In `onEnd`, before touching state, revert Sortable's DOM
mutation (remove `evt.item`, re-insert at `evt.oldIndex` in `evt.from`), then
apply the reorder through the store so Solid reconciles. Never let Sortable's
move and Solid's move both stand.

→ verify: desktop — drag a row in the dev server, order changes and no
duplicate/ghost rows remain in the DOM; clicking text/checkbox/buttons still
works (no accidental drags).

### 4. Drop handler: optimistic update + PATCH

In `onEnd` (after the DOM revert):

- Skip entirely if the dragged id is not in `openItems()` (row was mid
  leave/outro animation) or if the index didn't change.
- Determine `prevId`/`nextId` from the dragged row's new neighbors — read
  `data-item-id` off the adjacent DOM siblings at drop time (robust against
  transient leaving-rows), then look their items up in the store.
- Compute via `computeReorderPosition`.
- Optimistically set position(s) with a **path write**
  (`setState('items', idx, 'position', pos)`) — not whole-object replacement,
  which would remount the row through `<For>`. Add a small
  `setItemPosition(id, pos)` mutation in `store.ts` next to `updateItem`.
- PATCH via `api.updateItem(slug, id, { position })` — one call for `single`,
  sequential calls for `renumber` (rare; fine).
- On failure: restore the previous position(s) and
  `addToast('Could not reorder the item. Please try again.')` — same pattern
  as the other handlers in `ListItem.tsx`.
- The SSE echo will later replace the item object with identical data —
  harmless; `seenIds` already prevents re-running the entrance animation.

→ verify: reorder persists after a hard reload; a second browser window on the
same project shows the new order within ~1s (SSE).

### 5. CSS

In `ListCard.module.css`: a `ghost` class (drop placeholder — lower opacity,
keep existing row background/radius tokens from `global.css`) wired to
`ghostClass`. With `forceFallback` Sortable clones the dragged row as a
fallback element — give `.sortable-fallback` (global, Sortable injects it)
a subtle `box-shadow`/lift so the dragged row reads as floating. No
`touch-action` change on rows — `delayOnTouchOnly` + `touchStartThreshold`
preserve normal page scrolling.

→ verify: visually in dev server — dragged row floats, placeholder visible,
page still scrolls with a plain swipe (browser devtools touch emulation; flag
for real-device check before release).

### 6. e2e test

New `packages/e2e/tests/reorder.spec.ts` (follow the patterns in
`item-crud.spec.ts` / `realtime-sync.spec.ts`):

1. Create project + 3 items; mouse-drag the third row above the first
   (manual `mouse.down/move/move/up` — Playwright's `dragTo` assumes native
   HTML5 DnD, which `forceFallback` bypasses; move in several small steps so
   Sortable registers the drag).
2. Assert new visual order; reload; assert order persisted.
3. Open a second page on the same project before the drag; assert it converges
   to the new order (SSE).

→ verify: e2e suite passes (sandbox note: Docker DB is unreachable per-command;
run with embedded-postgres in a single bash command as the existing suite
does).

### 7. Final checks

`npm run typecheck` + lint + prettier on changed files; full e2e run.
Known pre-existing repo-wide prettier drift on main — only changed files must
be clean.

## Out of scope

- Reordering the done section, cross-section drag (checkbox owns that).
- Keyboard reordering (revisit `@dnd-kit/solid` when it reaches 1.0).
- A visible drag handle — fallback option if long-press conflicts surface in
  real-device testing.
- Server-side reorder endpoint — client midpoint math + the rare renumber
  fallback is sufficient at 5–50 items.

## Risks

- Sortable's DOM mutation vs. Solid's `<For>`: mitigated by the revert-then-
  set-state pattern (step 3); the e2e DOM assertion guards it.
- iOS Safari scroll-vs-drag behavior can differ from emulation — needs one
  real-device pass before release.
- Concurrent reorders from two clients can interleave positions; last-write-
  wins per item is acceptable (same as text edits today).
