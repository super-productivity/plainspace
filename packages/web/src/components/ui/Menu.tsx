import { For, Show, createSignal, type JSX } from 'solid-js';
import Popover from './Popover';
import styles from './Menu.module.css';

export interface MenuItem {
  label: string;
  onSelect: (trigger: HTMLButtonElement) => void;
  icon?: JSX.Element;
  /** Render in the danger color (e.g. a Delete action). */
  danger?: boolean;
  testId?: string;
}

interface MenuProps {
  /** aria-label + native tooltip for the trigger, e.g. "Checklist actions". */
  label: string;
  items: MenuItem[];
  class?: string;
  menuTestId?: string;
  triggerTestId?: string;
  onOpen?: () => void;
  onTriggerPointerDown?: JSX.EventHandler<HTMLButtonElement, PointerEvent>;
}

// A "⋯ more" trigger that opens a popover list of actions. Shared so card
// headers (checklist panels today) don't each re-implement the trigger button,
// the popover wiring, and the menu-item styling.
export default function Menu(props: MenuProps) {
  // The trigger element stays mounted the whole time, so it's a stable anchor.
  // (Anchoring on a signal that goes null on close makes Popover's onCleanup
  // read a stale value as the menu tears down.)
  let triggerRef: HTMLButtonElement | undefined;
  const itemRefs: HTMLButtonElement[] = [];
  const [open, setOpen] = createSignal(false);

  function openMenu() {
    props.onOpen?.();
    setOpen(true);
    queueMicrotask(() => itemRefs[0]?.focus());
  }

  function handleMenuKeyDown(event: KeyboardEvent) {
    const items = itemRefs.slice(0, props.items.length);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class={`${styles.trigger} ${props.class ?? ''}`}
        onClick={() => (open() ? setOpen(false) : openMenu())}
        onPointerDown={(event) => props.onTriggerPointerDown?.(event)}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open()}
        title={props.label}
        data-testid={props.triggerTestId}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <Show when={open()}>
        <Popover
          anchor={triggerRef!}
          onClose={() => setOpen(false)}
          class={styles.menu}
          data-testid={props.menuTestId}
        >
          <div role="menu" aria-label={props.label} onKeyDown={handleMenuKeyDown}>
            <For each={props.items}>
              {(item, index) => (
                <button
                  ref={(element) => (itemRefs[index()] = element)}
                  type="button"
                  role="menuitem"
                  class={`${styles.item} ${item.danger ? styles.danger : ''}`}
                  onClick={() => {
                    // Close first so the popover's focus-return runs before the
                    // action moves focus (e.g. Rename focuses the title input).
                    setOpen(false);
                    item.onSelect(triggerRef!);
                  }}
                  data-testid={item.testId}
                >
                  <Show when={item.icon}>
                    <span class={styles.icon}>{item.icon}</span>
                  </Show>
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </Popover>
      </Show>
    </>
  );
}
