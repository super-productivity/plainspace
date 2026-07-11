# Task-Add Animation Implementation Plan

> **For Claude:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** New task rows slide-down + fade in (siblings reflow) when added, only for items that arrive after the list is on screen, with a TS reduced-motion gate.

**Architecture:** Solid.js. `ListCard` captures the item-id set present at its own mount; an item animates iff its id is not in that set. `ListItem` gains an `animateIn` prop: when true (and reduced motion not requested) it wraps its content in a CSS-grid `0fr→1fr` + opacity wrapper that dissolves to `display:contents` on `transitionend`. Behavioral contract for tests: the `[data-testid="list-item"]` element carries `data-animate-in="true"` iff it entered after mount (stable attribute, set whenever `animateIn` is true, independent of motion preference).

**Tech Stack:** Solid.js 1.9, CSS Modules, Playwright e2e (`packages/e2e`). No unit-test framework in `packages/web`; no animation library (must not add one).

## Design reference

See `docs/plans/2026-05-15-task-add-animation-design.md` (approved). Key constraints verified in code:

- `ListCard.tsx:45` `<For each={props.items}>`; new items appended via `addItem` → `[...prev, item]` (`store.ts`), so exactly one `<ListItem>` mounts; siblings keep DOM.
- `ListItem.module.css` has `.item:last-child { border-bottom:none }` and `.items` separates rows by `.item` border → wrapping _every_ row would erase separators. Only the single new item ever gets a live wrapper; it dissolves to `display:contents` at rest → DOM identical to today.
- `ListItem` has an absolutely-positioned `MemberPicker`; the wrapper must not leave `overflow:hidden` behind → the `display:contents` "done" state handles this.
- Assumption (normal flow): entering a project mounts `Project` route fresh → `resetState()` (Project.tsx:145) clears `state.list` → `ListCard` (under `<Show when={state.list}>`) mounts once with the project's initial items. In-app project→project navigation without remount is out of scope.

---

## Setup

Ensure infra is up (e2e webServer starts server+web but needs Postgres):

```bash
cd /home/johannes/www/spaces
npm run db:up   # starts/migrates Postgres on :5432
git status      # expect: on feature/task-add-animation, clean
```

No commit.

---

## Task 1 — Failing e2e test

**1a. Create the spec.**

File: `packages/e2e/tests/task-add-animation.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';
import { createItemViaApi } from '../helpers/api';

test('item present at load is not marked as entering; item added later is', async ({ page }) => {
  const { project, token } = await setupProject(page);

  // Seed one item BEFORE navigating so it is present at ListCard mount.
  await createItemViaApi(project.slug, token, 'Pre-existing task');

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('list-card')).toBeVisible();

  const preExisting = page.getByTestId('list-item').filter({ hasText: 'Pre-existing task' });
  await expect(preExisting).toBeVisible();
  // Pre-existing items must NOT be flagged as entering.
  await expect(preExisting).not.toHaveAttribute('data-animate-in', 'true');

  // Add a new item via the UI.
  await page.getByTestId('add-item-input').fill('Freshly added task');
  await page.getByTestId('add-item-input').press('Enter');

  const added = page.getByTestId('list-item').filter({ hasText: 'Freshly added task' });
  await expect(added).toBeVisible({ timeout: 5000 });
  // Newly added item IS flagged as entering (stable attribute).
  await expect(added).toHaveAttribute('data-animate-in', 'true');
});
```

**1b. Run it, verify it FAILS for the right reason.**

```bash
cd /home/johannes/www/spaces
npm run test:e2e -- task-add-animation --project=chromium
```

Expected: the `toHaveAttribute('data-animate-in', 'true')` assertion fails (attribute does not exist yet). The "not.toHaveAttribute" line may pass trivially — that is fine; the meaningful failure is the added-item assertion.

**1c. Commit.**

```bash
git add packages/e2e/tests/task-add-animation.spec.ts
git commit -m "test(e2e): failing test for task-add entrance marker"
```

---

## Task 2 — `ListItem` accepts `animateIn` and exposes the marker (makes Task 1 pass)

**2a. Add the prop.** File: `packages/web/src/components/lists/ListItem.tsx`

In `interface ListItemProps` (lines 9–16) add after `myId: string;`:

```ts
  animateIn?: boolean;
```

**2b. Set the stable attribute on the root.** Same file, the root `<div>` at lines 74–78. Change:

```tsx
    <div
      class={`${styles.item} ${props.item.checked ? styles.checked : ''}`}
      data-item-id={props.item.id}
      data-testid="list-item"
    >
```

to:

```tsx
    <div
      class={`${styles.item} ${props.item.checked ? styles.checked : ''}`}
      data-item-id={props.item.id}
      data-animate-in={props.animateIn ? 'true' : undefined}
      data-testid="list-item"
    >
```

(`undefined` omits the attribute entirely for non-entering items.)

**2c. Compute and pass it from `ListCard`.** File: `packages/web/src/components/lists/ListCard.tsx`

After `const handleViewChange = ...` (line 22) add:

```tsx
// Item ids present when this list first mounts. Items whose id is not
// here arrived later (local add or collaborator via SSE) → animate them.
const initialIds = new Set(props.items.map((i) => i.id));
```

In the list-view `<For>` (lines 46–55) add the prop to `<ListItem>`:

```tsx
<ListItem
  item={item}
  members={props.members}
  attachments={props.attachments.filter((a) => a.itemId === item.id)}
  slug={props.slug}
  myId={props.myId}
  animateIn={!initialIds.has(item.id)}
  onDelete={props.onDeleteItem}
/>
```

(`ListBoardView` is untouched — board items never receive `animateIn`.)

**2d. Run the test, verify it PASSES.**

```bash
cd /home/johannes/www/spaces
npm run test:e2e -- task-add-animation --project=chromium
```

Expected: 1 passed.

**2e. Typecheck + commit.**

```bash
npm run typecheck --workspace @plainspace/web   # expect: no errors
git add packages/web/src/components/lists/ListItem.tsx packages/web/src/components/lists/ListCard.tsx
git commit -m "feat(web): mark tasks added after list mount"
```

---

## Task 3 — Visual slide-down + fade wrapper (CSS)

**3a. Add wrapper styles.** File: `packages/web/src/components/lists/ListItem.module.css`

Append at end of file:

```css
/* Entrance animation for items added after the list is on screen.
   Grid 0fr→1fr animates to the row's natural height so siblings reflow.
   On transitionend the wrapper dissolves to display:contents, leaving the
   DOM identical to a non-animated item (protects .item:last-child and the
   absolutely-positioned MemberPicker). */
.enter {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 260ms ease-out,
    opacity 260ms ease-out;
}

.enterInner {
  min-height: 0;
  overflow: hidden;
}

.enterActive {
  grid-template-rows: 1fr;
  opacity: 1;
}

.enterDone,
.enterDone > .enterInner {
  display: contents;
}
```

No behavior change yet (no element uses these classes). No commit alone — proceed to 3b.

---

## Task 4 — Wire the wrapper + phase machine + reduced-motion gate into `ListItem`

**4a. Update imports.** File: `packages/web/src/components/lists/ListItem.tsx` line 1:

```ts
import { Show, createMemo, createSignal, onMount } from 'solid-js';
```

**4b. Add the phase machine + reduced-motion gate** inside the component, after `const [showPicker, ...]` (line 21):

```tsx
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const shouldAnimate = () => props.animateIn === true && !prefersReducedMotion;
const [phase, setPhase] = createSignal<'start' | 'active' | 'done'>('start');

onMount(() => {
  if (!shouldAnimate()) return;
  // Two rAFs: let the collapsed start state paint before transitioning.
  requestAnimationFrame(() => requestAnimationFrame(() => setPhase('active')));
});

function handleEntranceEnd(e: TransitionEvent) {
  if (e.propertyName === 'grid-template-rows') setPhase('done');
}
```

**4c. Wrap the rendered item.** Same file. The component currently `return (`s the `<div class={styles.item} ...>...</div>` (lines 73–199). Refactor so the item markup is rendered once and conditionally wrapped:

Replace `return (` (line 73) and the matching closing `);` (line 200) so the function returns:

```tsx
const itemEl = (
  <div
    class={`${styles.item} ${props.item.checked ? styles.checked : ''}`}
    data-item-id={props.item.id}
    data-animate-in={props.animateIn ? 'true' : undefined}
    data-testid="list-item"
  >
    {/* ...existing unchanged contents (row, checkbox, text, actions)... */}
  </div>
);

return (
  <Show when={shouldAnimate()} fallback={itemEl}>
    <div
      class={`${styles.enter} ${
        phase() === 'active' ? styles.enterActive : ''
      } ${phase() === 'done' ? styles.enterDone : ''}`}
      onTransitionEnd={handleEntranceEnd}
    >
      <div class={styles.enterInner}>{itemEl}</div>
    </div>
  </Show>
);
```

Keep the existing inner JSX (lines 79–198: `.row`, checkbox, text/edit `Show`, `.actions`, picker, delete) **verbatim** inside `itemEl`. Only the outer wrapper/return structure changes; the `data-animate-in` attribute from Task 2b stays on `itemEl`.

**4d. Typecheck.**

```bash
cd /home/johannes/www/spaces
npm run typecheck --workspace @plainspace/web   # expect: no errors
```

**4e. Re-run the e2e test (must still pass — attribute contract unchanged).**

```bash
npm run test:e2e -- task-add-animation --project=chromium
```

Expected: 1 passed. (`data-animate-in` lives on `itemEl` regardless of wrapper.)

**4f. Commit.**

```bash
git add packages/web/src/components/lists/ListItem.module.css packages/web/src/components/lists/ListItem.tsx
git commit -m "feat(web): slide-down + fade entrance for added tasks"
```

---

## Task 5 — Manual visual verification

Use the playwright-cli skill (or a manual browser) against `npm run dev`:

1. Open a project with a few existing items → on load, **no** cascade/animation (initial items unmarked).
2. Add a task via the input → the new row **expands from 0 height while fading in**, pushing existing rows down smoothly (~260ms), then settles.
3. After it settles, click the new row's **assign** button → the `MemberPicker` popover opens fully (not clipped) — confirms the `display:contents` done-state.
4. Confirm the last row still has no bottom border and earlier rows keep their separators (confirms `.item:last-child` intact).
5. DevTools → Rendering → emulate `prefers-reduced-motion: reduce`, reload, add a task → it appears instantly, no transition, no clipping.

If any check fails, debug with superpowers:systematic-debugging before proceeding. No code change → no commit; otherwise commit fixes with a `fix(web):` message.

---

## Task 6 — Quality gates

```bash
cd /home/johannes/www/spaces
npm run typecheck                         # all workspaces, expect no errors
npm run lint                              # eslint (incl. eslint-plugin-solid), expect clean
npx prettier --check \
  packages/web/src/components/lists/ListItem.tsx \
  packages/web/src/components/lists/ListItem.module.css \
  packages/web/src/components/lists/ListCard.tsx \
  packages/e2e/tests/task-add-animation.spec.ts
```

Fix any issues (`npx prettier --write <files>` for formatting), then:

```bash
git add -A
git commit -m "chore(web): lint/format task-add animation"   # only if there were fixes
```

---

## Task 7 — Finish

Run the full relevant e2e suite to check for regressions in list behavior:

```bash
cd /home/johannes/www/spaces
npm run test:e2e -- item-crud task-add-animation --project=chromium
```

Expected: all passed. Then invoke **superpowers:finishing-a-development-branch** to choose merge/PR/cleanup for `feature/task-add-animation`.
