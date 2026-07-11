# Task-Add Animation — Design

**Date:** 2026-05-15
**Branch:** `feature/task-add-animation`
**Status:** Approved

## Goal

When a task is added to a list, the new row should animate in with a smooth,
subtle **slide-down + fade**: the row expands from zero to its natural height,
pushing existing items down, while fading in. Applies to additions from the
local user _and_ from collaborators (all arrive via the same store path), giving
the list a "live" feel.

## Context (verified)

- `ListCard.tsx:45` renders `<For each={props.items}>` → one `<ListItem>` per
  item. `<For>` is keyed by item reference.
- New items append via `addItem` → `setState('items', prev => [...prev, item])`
  (`store.ts`), driven by SSE `item.created` (`sse.ts`). Exactly **one new
  `<ListItem>` node mounts**; sibling DOM nodes are retained.
- Pure CSS only. No `@angular/animations`, **no animation library** (must not
  add one), no motion/easing tokens, and **no `prefers-reduced-motion`
  handling anywhere yet**.
- `ListItem` contains an absolutely-positioned `MemberPicker` popover. The
  entrance wrapper must **not** leave `overflow: hidden` behind at rest, or the
  assignee dropdown gets clipped.

## Approaches considered

|     | Approach                                                                     | Verdict                                                               |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A   | CSS `@keyframes` `translateY` + opacity on the item (like existing `fadeIn`) | ❌ Cannot push siblings down — row takes full height instantly        |
| B   | JS-measured `max-height` animation                                           | ❌ Needs magic numbers, janky with wrapping text                      |
| C   | **CSS Grid `grid-template-rows: 0fr → 1fr` wrapper + opacity**               | ✅ Animates to _natural_ height, siblings reflow, zero JS measurement |

**Chosen: C.**

## Design

### Entrance scope

Animate **only** items that arrive _after_ the list is on screen.

- `ListCard` captures, at its own mount, the set of item ids present
  (`initialIds`).
- An item animates iff `item.id` is **not** in `initialIds`.
- Result: page load / navigation → no cascade; a newly added task (local or
  collaborator) → animates.

**Deliberately YAGNI:** no staggered intro-on-load. The request is "when tasks
are added".

### Mechanism

- `ListItem` gains `animateIn?: boolean`, computed and passed by `ListCard`.
- When `animateIn` is true and reduced-motion is **not** requested, `ListItem`
  wraps its content in a grid wrapper with three states:
  1. **Start** (initial render): `display:grid; grid-template-rows:0fr;
overflow:hidden; opacity:0`.
  2. **Active**: `onMount` → double `requestAnimationFrame` → add active class →
     transitions to `grid-template-rows:1fr; opacity:1` over ~260ms ease-out.
  3. **Done**: on `transitionend` (filtered to `grid-template-rows`) → wrapper
     becomes `display:contents` so **no overflow/clip side-effects remain** and
     the item is byte-for-byte its prior self at rest (protects `MemberPicker`).
- When `animateIn` is false: render exactly as today (no wrapper, no JS).

### Accessibility

Reduced motion is **gated in TS, not CSS**: at mount `ListItem` checks
`matchMedia('(prefers-reduced-motion: reduce)').matches`; if true it renders the
plain unwrapped item (DOM identical to today, instant appear). A CSS
`transition:none` media query was rejected — with no transition the
`transitionend` never fires, so the wrapper would never dissolve to
`display:contents` (→ `MemberPicker` clipping + the `:last-child` bug below
persisting). The TS gate is the first reduced-motion handling in the codebase.

### Files touched

- `packages/web/src/components/lists/ListCard.tsx` — capture `initialIds` on
  mount, pass `animateIn` to `ListItem`.
- `packages/web/src/components/lists/ListItem.tsx` — `animateIn` prop, grid
  wrapper, `onMount` rAF flip, `transitionend` → done.
- `packages/web/src/components/lists/ListItem.module.css` — wrapper start/active
  rules + reduced-motion media query.

No new dependencies. No shared design-token changes. Board view
(`ListBoardView`) untouched.

## Risks / open points

- **`MemberPicker` clipping** — mitigated by the `display:contents` "done"
  state; verify the picker opens correctly on a freshly-animated row.
- **`transitionend` not firing** — node removal makes this moot (item gone); the
  listener is one-shot and filtered by `propertyName`.
- **`<For>` identity** — relies on `[...prev, item]` preserving prior item
  references so only the new node mounts. Verified in `store.ts`.
- **`.item:last-child` regression (FOUND IN TESTING — FIXED)** — the original
  mitigation ("`display:contents` at rest makes the DOM exactly today's") was
  **wrong for structural selectors**. `:last-child` resolves against an
  element's DOM _parent_, and `display:contents` removes the box but **not** DOM
  parentage. A wrapped row is `.items > .enter > .enterInner > .item`, so that
  `.item` is permanently the sole (`:last-child`) child of its own
  `.enterInner` — regardless of its real list position. Symptom: a previously
  added row loses its bottom separator once another row is added below it
  ("new task sometimes missing the border, until reloaded"). **Fix:** removed
  `.item:last-child { border-bottom: none }` and `.items`' own
  `border-bottom`; every `.item` now carries its own `border-bottom` and the
  last row's border is the list's closing line. No positional pseudo-class is
  involved, so per-row wrapping cannot break separators. Visually identical for
  non-empty lists; an empty list now shows one top line instead of a 2px
  bordered strip (negligible, arguably cleaner).
- **Stale `initialIds` on shared-component route reuse** — `initialIds` is a
  one-time snapshot captured at `ListCard` creation. It stays correct only
  because there is currently **no in-app project→project navigation**:
  `Project.tsx` resets state in `onMount` only (no `createEffect` on
  `params.slug`), and the `/:slug/item/:itemId` deep-link route is reached by a
  full page load (fresh remount → fresh snapshot). **Future work that adds an
  in-app project switcher, or in-app navigation between paths sharing the
  `Project` route component, MUST re-derive `initialIds` when `props.list.id`
  changes** — otherwise project A's stale snapshot would mark all of project B's
  initial items as entering (full-list cascade). Currently out of scope and not
  reachable through the UI.
