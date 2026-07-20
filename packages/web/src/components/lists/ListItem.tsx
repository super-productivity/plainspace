import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js';
import type { Item, Member, Attachment, RepeatRule } from '@plainspace/shared';
import { api, type ItemWithActivityResponse } from '../../lib/api';
import { addActivity, updateItem } from '../../lib/store';
import { addToast } from '../../lib/toast';
import { ensurePushSubscription } from '../../lib/push';
import { Avatar, Menu } from '../ui';
import MemberPicker from './MemberPicker';
import ReminderPicker, { describeRepeat } from './ReminderPicker';
import styles from './ListItem.module.css';

function formatRemindAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Relative phrasing for a resting recurring task's next occurrence: time-only
// today, "tomorrow", a weekday within the week, else a short date.
function formatNextDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'tomorrow';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface ListItemProps {
  item: Item;
  members: Member[];
  attachments: Attachment[];
  slug: string;
  myId: string;
  animateIn?: boolean;
  /** 'check' or 'uncheck' while a user-initiated toggle is animating; null
   *  otherwise. Owned by the parent so it survives the <For> remount that
   *  fires when the item's object reference changes after the SSE update. */
  justToggled?: 'check' | 'uncheck' | null;
  /** True while the row is collapsing out after its item has been removed
   *  from the live list. Owned by the parent (ListCard) so it can keep the
   *  row rendered for the leave window. */
  leaving?: boolean;
  onBeforeToggle?: (itemId: string, wasChecked: boolean, isRecurring: boolean) => void;
  onDelete: (itemId: string) => void;
}

export default function ListItem(props: ListItemProps) {
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');
  const [showPicker, setShowPicker] = createSignal(false);
  const [showReminderPicker, setShowReminderPicker] = createSignal(false);
  // Mobile: the non-state actions (empty assign, empty reminder, delete) move
  // into a ⋯ popover menu so the title reclaims the row width (a CSS media
  // query hides the inline buttons on touch; desktop keeps its hover-reveal).
  // The picker it opens anchors to whichever element was tapped — the inline
  // badge on desktop, the ⋯ trigger on mobile.
  const [reminderAnchor, setReminderAnchor] = createSignal<HTMLButtonElement>();
  const [assignAnchor, setAssignAnchor] = createSignal<HTMLButtonElement>();
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const shouldAnimate = () => props.animateIn === true && !prefersReducedMotion;
  // A completed recurring task "rests" in place in the open list (it reopens
  // when its reminder next fires) instead of dropping into Done.
  const isResting = () => props.item.checked && props.item.repeat != null;
  // An active recurring task whose current occurrence has passed without being
  // checked off. The fire only notifies; the schedule advances on completion,
  // not on the clock — so a missed occurrence reads as overdue until done.
  const isOverdue = () =>
    !props.item.checked &&
    props.item.repeat != null &&
    props.item.remindAt != null &&
    new Date(props.item.remindAt).getTime() < Date.now();
  let itemRef: HTMLDivElement | undefined;

  // Drive enter/leave with the Web Animations API on the row element itself.
  // The element is never unmounted/remounted between enter, idle, and leave —
  // that would interrupt in-flight CSS animations (checkPop, strikeSweep) and
  // snap the icon mid-bounce, which reads as a flicker (especially on
  // mark-done because of the bouncy check pop).
  onMount(() => {
    if (!shouldAnimate() || !itemRef) return;
    // Pin the start state synchronously so the browser doesn't paint at
    // natural height for a frame before WAAPI takes over.
    itemRef.style.height = '0px';
    itemRef.style.opacity = '0';
    itemRef.style.overflow = 'hidden';
    const target = itemRef.scrollHeight;
    const anim = itemRef.animate(
      [
        { height: '0px', opacity: 0 },
        { height: `${target}px`, opacity: 1 },
      ],
      { duration: 140, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
    );
    const finish = () => {
      if (!itemRef) return;
      // Clear inline styles first (WAAPI is still holding the end state via
      // fill:forwards, so this is invisible), then cancel the animation so
      // the element goes back to natural layout. Done in this order to
      // avoid any single frame where neither override is in effect.
      itemRef.style.height = '';
      itemRef.style.opacity = '';
      itemRef.style.overflow = '';
      anim.cancel();
    };
    anim.addEventListener('finish', finish);
    onCleanup(() => anim.cancel());
  });

  createEffect(
    on(
      () => props.leaving,
      (leaving) => {
        if (!leaving || !itemRef) return;
        const start = itemRef.offsetHeight;
        itemRef.style.overflow = 'hidden';
        itemRef.animate(
          [
            { height: `${start}px`, opacity: 1 },
            { height: '0px', opacity: 0 },
          ],
          { duration: 140, easing: 'cubic-bezier(0.7, 0, 0.84, 0)', fill: 'forwards' },
        );
      },
    ),
  );

  let inputRef: HTMLInputElement | undefined;
  let assignButtonRef: HTMLButtonElement | undefined;
  let reminderButtonRef: HTMLButtonElement | undefined;

  const assignedMember = createMemo(() =>
    props.members.find((m) => m.id === props.item.assignedTo),
  );

  // Open a picker anchored to `anchor`. Both pickers are Popovers positioned
  // against a live element, so the
  // anchor must stay mounted while open — the inline badge (visible on desktop,
  // or on mobile when it carries state) or the ⋯ trigger (visible on mobile).
  function openReminderPicker(anchor: HTMLButtonElement) {
    setReminderAnchor(anchor);
    setShowReminderPicker(true);
  }
  function openAssignPicker(anchor: HTMLButtonElement) {
    setAssignAnchor(anchor);
    setShowPicker(true);
  }

  async function toggleChecked() {
    const wasChecked = props.item.checked;
    const checked = !wasChecked;
    // Let the parent (ListCard) pin this item in its current section and
    // own the justToggled window so the mark-down animation has time to
    // play across the <For> remount that fires when the item ref changes.
    props.onBeforeToggle?.(props.item.id, wasChecked, props.item.repeat != null);
    const result = await api
      .updateItem(props.slug, props.item.id, {
        checked,
      })
      .catch(() => void addToast('Could not update the item. Please try again.'));
    applyResult(result);
  }

  // Apply a confirmed PATCH response directly instead of waiting for the SSE
  // echo: during a reconnect window the echo can be seconds away (or missed
  // until resync), and the row would visibly snap back. Idempotent with the
  // echo (same pattern AddItem uses for creates). `result` is undefined/void
  // when the request failed and the .catch toast already fired.
  function applyResult(result: ItemWithActivityResponse | void) {
    if (!result) return;
    updateItem(result.item);
    if (result.activity) addActivity(result.activity);
  }

  async function handleAssign(memberId: string | null) {
    const result = await api
      .updateItem(props.slug, props.item.id, {
        assignedTo: memberId,
      })
      .catch(() => void addToast('Could not change the assignee. Please try again.'));
    applyResult(result);
  }

  async function handleReminder(iso: string | null, repeat: Omit<RepeatRule, 'anchor'> | null) {
    // Run push-subscribe and the PATCH in parallel so a cold permission
    // prompt + FCM subscribe (~1-2s) doesn't block the reminder save. The
    // first reminder fire is at least one sweep tick (60s) away, so there's
    // no race where the push delivery beats the subscription PUT. Subscribe
    // failure is silently tolerated — the sweep falls back to email when no
    // push subscription exists.
    const subscribe = iso ? ensurePushSubscription(props.slug) : Promise.resolve();
    const patch = api.updateItem(props.slug, props.item.id, { remindAt: iso, repeat }).catch(() => {
      addToast('Could not save the reminder. Please try again.');
      return undefined;
    });
    const [, result] = await Promise.all([subscribe, patch]);
    applyResult(result);
  }

  function startEdit() {
    setEditText(props.item.text);
    setEditing(true);
    // Focus after render
    requestAnimationFrame(() => inputRef?.focus());
  }

  async function commitEdit() {
    const trimmed = editText().trim();
    if (trimmed && trimmed !== props.item.text) {
      const result = await api
        .updateItem(props.slug, props.item.id, { text: trimmed })
        .catch(() => void addToast('Could not save the edit. Please try again.'));
      applyResult(result);
    }
    setEditing(false);
  }

  function handleEditKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      commitEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  return (
    <div
      ref={itemRef}
      class={`${styles.item} ${props.item.checked ? styles.checked : ''} ${
        isResting() ? styles.resting : ''
      }`}
      data-item-id={props.item.id}
      data-resting={isResting() ? 'true' : undefined}
      data-animate-in={props.animateIn ? 'true' : undefined}
      data-just-toggled={props.justToggled ?? undefined}
      data-testid="list-item"
      aria-hidden={props.leaving ? 'true' : undefined}
    >
      <button
        class={styles.checkbox}
        onClick={toggleChecked}
        role="checkbox"
        aria-checked={props.item.checked}
        data-testid="item-checkbox"
      >
        <Show when={props.item.checked} fallback={<span class={styles.unchecked} />}>
          <span class={styles.checkedIcon} aria-hidden="true" />
        </Show>
      </button>

      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            class={styles.text}
            data-testid="item-text"
            onClick={startEdit}
            aria-label={`Edit item: ${props.item.text}`}
            title={props.item.text}
          >
            <span class={styles.textContent}>{props.item.text}</span>
            <svg
              class={styles.editHint}
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        }
      >
        <input
          ref={inputRef}
          class={styles.editInput}
          value={editText()}
          onInput={(e) => setEditText(e.currentTarget.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={commitEdit}
          maxLength={500}
          data-testid="item-edit-input"
        />
      </Show>

      <div class={styles.actions}>
        <div class={styles.reminderWrapper}>
          <button
            ref={reminderButtonRef}
            class={`${styles.reminderButton} ${props.item.remindAt ? styles.hasReminder : ''} ${
              isOverdue() ? styles.overdue : ''
            }`}
            onClick={() =>
              showReminderPicker()
                ? setShowReminderPicker(false)
                : openReminderPicker(reminderButtonRef!)
            }
            onMouseDown={(e) => e.stopPropagation()}
            // Sortable listens on pointerdown (not mousedown) on PointerEvent
            // browsers; without this, press-and-drag from the button lifts the row.
            onPointerDown={(e) => e.stopPropagation()}
            title={
              props.item.remindAt
                ? `${isResting() ? 'Next' : isOverdue() ? 'Overdue' : 'Reminder'}: ${new Date(
                    props.item.remindAt,
                  ).toLocaleString()}${
                    props.item.repeat ? ` · repeats ${describeRepeat(props.item.repeat)}` : ''
                  }`
                : 'Set reminder'
            }
            aria-label={props.item.remindAt ? 'Change reminder' : 'Set reminder'}
            data-testid="reminder-button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <Show when={props.item.remindAt}>
              <span class={styles.reminderLabel}>
                <Show when={props.item.repeat}>
                  <span class={styles.repeatGlyph} aria-hidden="true">
                    &#8635;
                  </span>
                </Show>
                <Show when={isResting()} fallback={formatRemindAt(props.item.remindAt!)}>
                  next {formatNextDue(props.item.remindAt!)}
                </Show>
              </span>
            </Show>
          </button>
          <Show when={showReminderPicker() && reminderAnchor()}>
            <ReminderPicker
              anchor={reminderAnchor()!}
              remindAt={props.item.remindAt}
              repeat={props.item.repeat}
              onSet={handleReminder}
              onClose={() => setShowReminderPicker(false)}
            />
          </Show>
        </div>
        <div class={styles.assignWrapper}>
          <button
            ref={assignButtonRef}
            class={`${styles.assignButton} ${assignedMember() ? styles.hasAssignee : ''}`}
            onClick={() =>
              showPicker() ? setShowPicker(false) : openAssignPicker(assignButtonRef!)
            }
            onMouseDown={(e) => e.stopPropagation()}
            // Sortable listens on pointerdown (not mousedown) on PointerEvent
            // browsers; without this, press-and-drag from the button lifts the row.
            onPointerDown={(e) => e.stopPropagation()}
            title={
              assignedMember() ? `Assigned to ${assignedMember()!.displayName}` : 'Assign someone'
            }
            aria-label={
              assignedMember()
                ? `Change assignee (currently ${assignedMember()!.displayName})`
                : 'Assign someone'
            }
            data-testid="assign-button"
          >
            <Show
              when={assignedMember()}
              fallback={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M19 8v6" />
                  <path d="M22 11h-6" />
                </svg>
              }
            >
              <Avatar
                name={assignedMember()!.displayName}
                color={assignedMember()!.color}
                size="sm"
                letters={1}
                class={styles.assigneeBadge}
              />
            </Show>
          </button>
          <Show when={showPicker() && assignAnchor()}>
            <MemberPicker
              anchor={assignAnchor()!}
              members={props.members}
              assignedTo={props.item.assignedTo ?? null}
              onSelect={handleAssign}
              onClose={() => setShowPicker(false)}
            />
          </Show>
        </div>
        <button
          class={styles.deleteButton}
          onClick={() => props.onDelete(props.item.id)}
          title="Delete item"
          aria-label="Delete item"
          data-testid="delete-item-button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
        {/* Mobile-only: empty reminder/assign actions and delete collapse into
            the shared ⋯ menu. Desktop keeps its hover-revealed inline buttons. */}
        <Menu
          class={styles.moreButton}
          label={`Actions for ${props.item.text}`}
          triggerTestId="more-actions-button"
          menuTestId="actions-menu"
          onOpen={() => {
            setShowReminderPicker(false);
            setShowPicker(false);
          }}
          onTriggerPointerDown={(event) => event.stopPropagation()}
          items={[
            {
              label: props.item.remindAt ? 'Edit reminder' : 'Set reminder',
              onSelect: openReminderPicker,
              testId: 'menu-reminder',
              icon: (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              ),
            },
            {
              label: assignedMember() ? 'Reassign' : 'Assign',
              onSelect: openAssignPicker,
              testId: 'menu-assign',
              icon: (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M19 8v6" />
                  <path d="M22 11h-6" />
                </svg>
              ),
            },
            {
              label: 'Delete',
              onSelect: () => props.onDelete(props.item.id),
              danger: true,
              testId: 'menu-delete',
              icon: (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
