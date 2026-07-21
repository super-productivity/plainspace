import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import Sortable, { type SortableEvent } from 'sortablejs';
import type { List, Item, Member, Attachment } from '@plainspace/shared';
import { api } from '../../lib/api';
import { moveItem, setItemPosition, state } from '../../lib/store';
import { addToast } from '../../lib/toast';
import { byPosition, computeReorderPosition } from '../../lib/reorder';
import {
  CollapseBody,
  CollapseToggle,
  InlineRename,
  Menu,
  createCollapsed,
  type MenuItem,
} from '../ui';
import ListItem from './ListItem';
import AddItem from './AddItem';
import styles from './ListCard.module.css';
import underline from '../ui/headingUnderline.module.css';

interface ListCardProps {
  list: List;
  items: Item[];
  members: Member[];
  attachments: Attachment[];
  slug: string;
  myId: string;
  onDeleteItem: (itemId: string) => Promise<boolean>;
  /** Heading text. Defaults to the hero list's "What needs doing". */
  title?: string;
  /** When set, an actions menu appears in the header (checklist panels). */
  onDeletePanel?: () => void;
  /** When set, the menu offers Rename and the title becomes inline-editable. */
  onRenamePanel?: (title: string) => void;
  /** Card section + delete menu-item testids. Default to the hero list's. */
  cardTestId?: string;
  deleteTestId?: string;
}

// True while ANY list's row is mid-drag. Shared across every ListCard instance
// (module scope) so each open section can light up as an enlarged drop target
// for the duration of the drag — otherwise an empty or short list offers almost
// no area to drop a cross-list row onto, and the drop silently snaps back.
const [dragActive, setDragActive] = createSignal(false);
// One reorder commit at a time, across every list. Not to avoid stale reads —
// the optimistic write lands synchronously before the first await, so a second
// commit always bisects against the current order. It guards the failure path:
// a rollback can restore a position that a later commit already bisected
// against. Module scope because a cross-list drop renumbers the *destination*
// card's rows, which a per-card signal could not see. Refused attempts toast.
const [reorderPending, setReorderPending] = createSignal(false);

export default function ListCard(props: ListCardProps) {
  // Item ids seen by this list. Initial items are seeded at mount; later ids
  // animate only on their first render, not on updates that replace the item
  // object (assignee, checked state, text edits, etc.).
  // Intentionally a one-time, NON-reactive snapshot (component bodies run
  // once in Solid): do NOT wrap in createMemo/createEffect — that would make
  // it track props.items and re-include later adds, breaking the animation.
  const seenIds = untrack(() => new Set(props.items.map((i) => i.id)));

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  // When the user clicks an item's checkbox, pin it in its current section
  // for the outro window. Two phases:
  //   - 'animate': in-place mark-down animations (check pop, strike sweep)
  //     play on the row. Duration is direction-aware — check needs to fit
  //     the longer checkPop + strikeSweep, uncheck is snappier.
  //   - 'leaving': the row collapses out of the source section AND, in
  //     parallel, the destination section mounts the item and grows it in.
  //     The dual render is driven by openItems/doneItems both including the
  //     item during this phase, plus justArrived being seeded at the phase
  //     transition so the destination instance gets animateIn=true.
  const [outro, setOutro] = createSignal<{
    run: number;
    id: string;
    section: 'open' | 'done';
    // Toggle direction, kept explicit rather than inferred from `section`:
    // recurring tasks always animate in the 'open' section (they never cross
    // to Done), so an uncheck there must still play the uncheck animation.
    dir: 'check' | 'uncheck';
    phase: 'animate' | 'leaving';
  } | null>(null);
  let outroAnimTimer: ReturnType<typeof setTimeout> | undefined;
  let outroLeaveTimer: ReturnType<typeof setTimeout> | undefined;
  let outroRun = 0;

  // One-shot flag: items whose ids are here get animateIn=true on their next
  // renderItem call (and then the flag is consumed). Used to trigger the
  // destination-section grow-in after a section change WITHOUT mutating
  // seenIds, so subsequent unrelated updates on the same row don't keep
  // re-triggering the entrance animation (which leaves the row invisible
  // if a produce-mutation interrupts the WAAPI animation).
  const justArrived = new Set<string>();

  function startOutro(itemId: string, wasChecked: boolean, isRecurring: boolean) {
    if (prefersReducedMotion) return;
    if (outroAnimTimer) clearTimeout(outroAnimTimer);
    if (outroLeaveTimer) clearTimeout(outroLeaveTimer);
    // Recurring tasks rest in place in the open list rather than crossing into
    // Done, so their toggle is in-place: play the mark animation, no section
    // change and no collapse/grow leaving phase.
    const section: 'open' | 'done' = isRecurring ? 'open' : wasChecked ? 'done' : 'open';
    const dir: 'check' | 'uncheck' = wasChecked ? 'uncheck' : 'check';
    const run = ++outroRun;
    setOutro({ run, id: itemId, section, dir, phase: 'animate' });
    // Uncheck has shorter strike/icon animations than check.
    const animateMs = wasChecked ? 80 : 140;
    outroAnimTimer = setTimeout(() => {
      if (isRecurring) {
        setOutro((prev) => (prev?.run === run ? null : prev));
        return;
      }
      // Seed justArrived BEFORE the phase transition. On the next render the
      // destination section mounts the item; shouldAnimateItem consumes the
      // flag and the grow-in plays in parallel with the source collapse.
      setOutro((prev) => {
        if (prev?.run !== run) return prev;
        justArrived.add(itemId);
        return { ...prev, phase: 'leaving' };
      });
      outroLeaveTimer = setTimeout(() => {
        setOutro((prev) => (prev?.run === run ? null : prev));
      }, 150);
    }, animateMs);

    return () => {
      if (untrack(outro)?.run !== run) return;
      if (outroAnimTimer) clearTimeout(outroAnimTimer);
      if (outroLeaveTimer) clearTimeout(outroLeaveTimer);
      justArrived.delete(itemId);
      setOutro(null);
    };
  }

  // Items that just disappeared from props.items are kept rendered in their
  // last-known section for the leave window so they can collapse out instead
  // of vanishing. Triggered by both local deletes and remote (SSE) deletes.
  const [leavingItems, setLeavingItems] = createSignal(new Map<string, Item>());
  const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function startLeaving(item: Item) {
    if (prefersReducedMotion) return;
    if (leaveTimers.has(item.id)) return;
    setLeavingItems((prev) => {
      const next = new Map(prev);
      next.set(item.id, item);
      return next;
    });
    const t = setTimeout(() => {
      leaveTimers.delete(item.id);
      setLeavingItems((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
    }, 220);
    leaveTimers.set(item.id, t);
  }

  function cancelLeaving(itemId: string) {
    const t = leaveTimers.get(itemId);
    if (t) {
      clearTimeout(t);
      leaveTimers.delete(itemId);
    }
    setLeavingItems((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }

  // Detect items added/removed across renders. Removals start leaving;
  // restores (e.g., the Undo toast) cancel a pending leave.
  createEffect(
    on(
      () => props.items,
      (items, prev) => {
        if (!prev) return;
        const currentIds = new Set(items.map((i) => i.id));
        for (const p of prev) if (!currentIds.has(p.id)) startLeaving(p);
        const currentLeaving = untrack(leavingItems);
        for (const i of items) if (currentLeaving.has(i.id)) cancelLeaving(i.id);
      },
    ),
  );

  onCleanup(() => {
    if (outroAnimTimer) clearTimeout(outroAnimTimer);
    if (outroLeaveTimer) clearTimeout(outroLeaveTimer);
    for (const t of leaveTimers.values()) clearTimeout(t);
    leaveTimers.clear();
  });

  // Recurring tasks live in the open section permanently: actionable when due,
  // and "resting" (checked) at the bottom until their next occurrence fires,
  // rather than dropping into the collapsed Done drawer with one-off tasks.
  const inOpen = (i: Item) => !i.checked || i.repeat != null;
  const inDone = (i: Item) => i.checked && i.repeat == null;
  // Resting recurring tasks sink below the active ones; ties keep list order.
  const byRestThenPosition = (a: Item, b: Item) =>
    Number(a.checked) - Number(b.checked) || byPosition(a, b);

  const openItems = createMemo(() => {
    const o = outro();
    const leavers = leavingItems();
    const live = props.items.filter((i) => {
      if (o && i.id === o.id) {
        if (o.phase === 'animate') return o.section === 'open';
        // leaving phase: render in source (collapsing) AND destination (growing).
        return o.section === 'open' || inOpen(i);
      }
      return inOpen(i);
    });
    const leavingOpen = [...leavers.values()].filter(inOpen);
    return [...live, ...leavingOpen].sort(byRestThenPosition);
  });
  const doneItems = createMemo(() => {
    const o = outro();
    const leavers = leavingItems();
    const live = props.items.filter((i) => {
      if (o && i.id === o.id) {
        if (o.phase === 'animate') return o.section === 'done';
        return o.section === 'done' || inDone(i);
      }
      return inDone(i);
    });
    const leavingDone = [...leavers.values()].filter(inDone);
    return [...live, ...leavingDone].sort(byPosition);
  });

  const [doneExpanded, setDoneExpanded] = createSignal(false);
  const [announcement, setAnnouncement] = createSignal<{ message: string }>();
  const announce = (message: string) => setAnnouncement({ message });

  // Drag-to-reorder the open section. SortableJS owns pointer/touch (forceFallback)
  // so it works on mobile, where native HTML5 DnD is broken. Solid's <For> owns
  // these DOM nodes, so onEnd must REVERT Sortable's move before touching state
  // and let Solid reconcile the reorder from the new positions.
  let itemsRef: HTMLDivElement | undefined;
  onMount(() => {
    if (!itemsRef) return;
    const sortable = Sortable.create(itemsRef, {
      forceFallback: true, // never use native HTML5 DnD (broken on touch)
      // Shared group lets a row be dragged into any other list's open section
      // (the hero list and every checklist panel) — drop targets are the
      // [data-list-id] containers below. onEnd fires on the SOURCE list's
      // instance and reads `evt.to` to learn where the row landed.
      group: 'list-items',
      animation: 150,
      delay: 250, // long-press to lift…
      delayOnTouchOnly: true, // …on touch only; desktop drags immediately
      touchStartThreshold: 5, // finger drift cancels the long-press → page scrolls
      fallbackTolerance: 5, // sloppy desktop clicks stay clicks
      // text selection in the edit input must not drag; resting recurring rows
      // are pinned to the bottom by sort, so dragging them would only snap back
      // (and fire a wasted reorder) — exclude them from the lift.
      filter: 'input, [data-resting]',
      preventOnFilter: false,
      draggable: '[data-item-id]',
      ghostClass: styles.ghost,
      // Light up every list's drop zone for the duration of the drag.
      onStart: () => setDragActive(true),
      onEnd: handleDragEnd,
    });
    onCleanup(() => sortable.destroy());
  });

  function handleDragEnd(evt: SortableEvent) {
    setDragActive(false); // drag is over (drop or cancel) — collapse drop zones
    const { item: node, oldIndex, newIndex, from, to } = evt;
    // Solid may have remounted the row mid-drag (an SSE update replaces the
    // item object), detaching Sortable's node; re-inserting it below would
    // leave a Solid-untracked duplicate row in the DOM.
    if (!node.isConnected) return;
    // Read the dropped row's NEW neighbors from the live DOM before reverting.
    // Reading data-item-id off the siblings is robust against transient
    // leaving rows that aren't in openItems(). Skip resting recurring rows:
    // they're pinned to the bottom by sort and can't be dragged, so a drop into
    // that zone is really a drop at the end of the active group — bisecting
    // against a resting row's interleaved position would snap the row back.
    const id = node.getAttribute('data-item-id');
    const activeNeighborId = (start: Element | null, step: (el: Element) => Element | null) => {
      let el: Element | null = start;
      while (el && el.hasAttribute('data-resting')) el = step(el);
      return el?.getAttribute('data-item-id') ?? null;
    };
    const prevId = activeNeighborId(node.previousElementSibling, (el) => el.previousElementSibling);
    const nextId = activeNeighborId(node.nextElementSibling, (el) => el.nextElementSibling);

    // The row was dropped into a different list's open section.
    const crossList = from !== to;

    // Undo Sortable's DOM mutation: each list's <For> must remain the single
    // source of truth for node order, or its next reconcile leaves a duplicate
    // row. Same-list: the post-move children still include the dragged node, so
    // the anchor depends on drag direction (moving up shifts the original slot
    // down by one). Cross-list: the node now lives in `to`, so `from` no longer
    // contains it — re-inserting at `oldIndex` restores its original slot.
    if (crossList) {
      from.insertBefore(node, from.children[oldIndex ?? from.children.length] ?? null);
    } else if (oldIndex !== undefined && newIndex !== undefined) {
      const anchor = newIndex < oldIndex ? oldIndex + 1 : oldIndex;
      from.insertBefore(node, from.children[anchor] ?? null);
    }
    if (!crossList && oldIndex === newIndex) return;

    const dragged = id ? openItems().find((i) => i.id === id) : undefined;
    // Row may have left mid drag (outro/SSE delete); ignore the stale drop.
    if (!dragged) return;

    // The list the row now belongs to. Same-list drops keep props.list; cross-
    // list drops read the destination container's [data-list-id].
    const targetListId = crossList ? to.getAttribute('data-list-id') : props.list.id;
    if (!targetListId) return;

    // sorted = the target list's ACTIVE open rows in their NEW order, for
    // midpoint math + the renumber fallback. Read from the shared store so a
    // cross-list drop sees the destination list's rows (not this card's).
    // Resting recurring rows (checked) are excluded — pinned to the bottom and
    // never reordered — so renumbering can't disturb their position.
    const sorted = state.items
      .filter((i) => i.listId === targetListId && !i.checked && i.id !== id)
      .sort(byPosition);
    const insertAt = nextId ? sorted.findIndex((i) => i.id === nextId) : sorted.length;
    sorted.splice(insertAt < 0 ? sorted.length : insertAt, 0, dragged);

    void commitReorder(dragged, targetListId, sorted, prevId, nextId);
  }

  async function commitReorder(
    dragged: Item,
    targetListId: string,
    sorted: Item[],
    prevId: string | null,
    nextId: string | null,
  ): Promise<boolean> {
    // Refusing silently would leave a dropped row snapping back (the DOM was
    // already reverted) with no explanation. The toast is role="status", so it
    // reaches the keyboard path's screen-reader users too.
    if (reorderPending()) {
      addToast('Still saving the previous move. Please try again.');
      return false;
    }
    setReorderPending(true);
    try {
      const result = computeReorderPosition(sorted, prevId, nextId);
      if (result.kind === 'single') {
        return await commitMove(dragged, targetListId, result.position);
      }

      const updates: Promise<boolean>[] = [];
      for (const [itemId, pos] of result.positions) {
        const item = state.items.find((i) => i.id === itemId);
        if (!item) continue;
        // Only the dragged row can change lists; the renumbered siblings already
        // live in the target list, so they just shift position.
        updates.push(
          itemId === dragged.id
            ? commitMove(dragged, targetListId, pos)
            : reorderOne(itemId, item.position, pos),
        );
      }
      return (await Promise.all(updates)).every(Boolean);
    } finally {
      setReorderPending(false);
    }
  }

  const reorderableItems = createMemo(() =>
    props.items.filter((item) => !item.checked).sort(byPosition),
  );
  const reorderableIndexes = createMemo(
    () => new Map(reorderableItems().map((item, index) => [item.id, index])),
  );

  // Whether a row offers keyboard reorder, by POSITION only — deliberately not
  // gated on reorderPending(). Dropping the actions mid-flight would rebuild an
  // open ⋯ menu without them, destroying the menu item the user is standing on.
  // -1 = not reorderable (a done row, or a resting recurring task pinned to the
  // end of the list).
  const reorderIndex = (item: Item, section: 'open' | 'done') =>
    section === 'open' ? (reorderableIndexes().get(item.id) ?? -1) : -1;
  const canMoveDown = (item: Item, section: 'open' | 'done') => {
    const index = reorderIndex(item, section);
    return index >= 0 && index < reorderableItems().length - 1;
  };

  async function moveByKeyboard(item: Item, direction: -1 | 1) {
    const sorted = [...reorderableItems()];
    const index = reorderableIndexes().get(item.id) ?? -1;
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return;
    sorted.splice(index, 1);
    sorted.splice(targetIndex, 0, item);
    const prevId = sorted[targetIndex - 1]?.id ?? null;
    const nextId = sorted[targetIndex + 1]?.id ?? null;
    const directionLabel = direction < 0 ? 'up' : 'down';
    // The menu closed onto this trigger a moment ago. commitReorder writes the
    // new position synchronously before it awaits, and <For> reorders by
    // re-inserting the row — which blurs any focused descendant, so by the time
    // this call returns focus is on <body>. The node itself survives the move,
    // so hand focus straight back rather than leaving it lost for the whole
    // network round-trip.
    const trigger = document.activeElement as HTMLElement | null;
    const pending = commitReorder(item, props.list.id, sorted, prevId, nextId);
    if (document.activeElement === document.body && trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
    }
    // Success only. Every failure and refusal above already raises a toast, and
    // Toast is itself role="status" — announcing here too would read the same
    // event to a screen reader twice.
    if (await pending) announce(`Moved "${item.text}" ${directionLabel}.`);
  }

  async function reorderOne(id: string, prevPos: number, nextPos: number): Promise<boolean> {
    if (prevPos === nextPos) return true;
    setItemPosition(id, nextPos); // optimistic path write — keeps the row mounted
    try {
      await api.updateItem(props.slug, id, { position: nextPos });
      return true;
    } catch {
      setItemPosition(id, prevPos); // roll back on failure
      addToast('Could not reorder the item. Please try again.');
      return false;
    }
  }

  // Commit the dragged row's new (list, position). A same-list drop only sends
  // position (byte-identical to a plain reorder); a cross-list drop also sends
  // listId. Optimistic, with rollback to the prior list + position on failure.
  async function commitMove(item: Item, listId: string, position: number): Promise<boolean> {
    const prevListId = item.listId;
    const prevPos = item.position;
    if (prevListId === listId && prevPos === position) return true;
    moveItem(item.id, listId, position);
    try {
      const payload = prevListId === listId ? { position } : { listId, position };
      await api.updateItem(props.slug, item.id, payload);
      return true;
    } catch {
      moveItem(item.id, prevListId, prevPos);
      addToast('Could not move the item. Please try again.');
      return false;
    }
  }

  function shouldAnimateItem(item: Item) {
    if (justArrived.has(item.id)) {
      justArrived.delete(item.id);
      return true;
    }
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  }

  function justToggledFor(itemId: string, section: 'open' | 'done'): 'check' | 'uncheck' | null {
    const o = outro();
    if (!o || o.id !== itemId) return null;
    // Only the SOURCE instance gets the data attribute. If we set it on the
    // destination too, the freshly-mounted icon there would replay the pop
    // animation, which feels wrong (the action already happened in source).
    if (o.section !== section) return null;
    return o.dir;
  }

  function leavingFor(itemId: string, section: 'open' | 'done'): boolean {
    if (leavingItems().has(itemId)) return true;
    const o = outro();
    return o?.id === itemId && o.phase === 'leaving' && o.section === section;
  }

  // Collapse hides the card body (rows, add, done) but keeps the header. Every
  // card folds — the hero list included — keyed by the backing list id (stable
  // for the instance, so the read is untracked).
  const {
    collapsed,
    toggle: toggleCollapsed,
    bodyId,
  } = createCollapsed(untrack(() => props.list.id));
  // Shown next to the title when collapsed — count only open (not-done) items so
  // the number matches what the card is hiding (mirrors the "Done · N" disclosure).
  const itemCount = () => props.items.filter(inOpen).length;

  // Inline title rename via the shared InlineRename field. Non-optimistic like
  // every panel mutation: commit calls back to the parent (which hits the API)
  // and the heading updates when the panel.updated SSE echo lands.
  const [renaming, setRenaming] = createSignal(false);
  function commitRename(value: string) {
    setRenaming(false);
    if (value && value !== props.title) props.onRenamePanel?.(value);
  }

  // Collapse is a one-tap header chevron (below), so the menu is just the
  // occasional/destructive actions.
  const menuItems = (): MenuItem[] => [
    ...(props.onRenamePanel
      ? [{ label: 'Rename', onSelect: () => setRenaming(true), testId: 'panel-rename' }]
      : []),
    {
      label: 'Delete',
      onSelect: () => props.onDeletePanel?.(),
      danger: true,
      testId: props.deleteTestId,
    },
  ];

  function renderItem(section: 'open' | 'done') {
    return (item: Item) => {
      const animateIn = shouldAnimateItem(item);

      return (
        <ListItem
          item={item}
          members={props.members}
          attachments={props.attachments.filter((a) => a.itemId === item.id)}
          slug={props.slug}
          myId={props.myId}
          animateIn={animateIn}
          justToggled={justToggledFor(item.id, section)}
          leaving={leavingFor(item.id, section)}
          onBeforeToggle={startOutro}
          onMoveUp={
            reorderIndex(item, section) > 0 ? () => void moveByKeyboard(item, -1) : undefined
          }
          onMoveDown={canMoveDown(item, section) ? () => void moveByKeyboard(item, 1) : undefined}
          onAnnounce={announce}
          onDelete={props.onDeleteItem}
        />
      );
    };
  }

  return (
    <section class={styles.card} data-testid={props.cardTestId ?? 'list-card'}>
      <p class="visually-hidden" role="status" aria-live="polite">
        <Show when={announcement()} keyed>
          {(current) => <span>{current.message}</span>}
        </Show>
      </p>
      <header class={styles.header}>
        <h2 class={styles.titleGroup}>
          <Show
            when={renaming()}
            fallback={
              // Headers fold on one tap — the whole title row is the target, with
              // a count when collapsed (same idiom as the "Done · N" disclosure).
              <CollapseToggle
                collapsed={collapsed()}
                onToggle={toggleCollapsed}
                controls={bodyId}
                count={itemCount()}
              >
                <span class={`${styles.name} ${underline.line}`} data-testid="list-name">
                  {props.title ?? 'What needs doing'}
                </span>
              </CollapseToggle>
            }
          >
            <InlineRename
              class={styles.titleInput}
              value={props.title ?? ''}
              ariaLabel="Rename checklist"
              testId="panel-rename-input"
              onCommit={commitRename}
              onCancel={() => setRenaming(false)}
            />
          </Show>
        </h2>
        <Show when={props.onDeletePanel}>
          <div class={styles.headerActions}>
            <Menu
              label={`${props.title ?? 'List'} actions`}
              items={menuItems()}
              triggerTestId="panel-menu"
            />
          </div>
        </Show>
      </header>

      <CollapseBody collapsed={collapsed()} id={bodyId} innerClass={styles.bodyInner}>
        <div
          class={styles.items}
          classList={{ [styles.dropZone]: dragActive() }}
          ref={itemsRef}
          data-list-id={props.list.id}
        >
          <Show when={openItems().length > 0}>
            <For each={openItems()}>{renderItem('open')}</For>
          </Show>
        </div>
        <AddItem slug={props.slug} listId={props.list.id} />

        <Show when={doneItems().length > 0}>
          <div class={styles.doneSection} data-testid="done-section">
            <button
              type="button"
              class={styles.doneHeader}
              onClick={() => setDoneExpanded((v) => !v)}
              aria-expanded={doneExpanded()}
              data-testid="done-toggle"
            >
              <svg
                class={styles.doneChevron}
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
              >
                <path
                  d="M2 4l3 3 3-3"
                  stroke="currentColor"
                  stroke-width="1.4"
                  fill="none"
                  stroke-linecap="round"
                />
              </svg>
              <span>Done · {doneItems().length}</span>
            </button>
            <Show when={doneExpanded()}>
              <div class={styles.items}>
                <For each={doneItems()}>{renderItem('done')}</For>
              </div>
            </Show>
          </div>
        </Show>
      </CollapseBody>
    </section>
  );
}
