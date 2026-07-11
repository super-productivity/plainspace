import { For, Show, createSignal } from 'solid-js';
import Popover from './Popover';
import styles from './Menu.module.css';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Render in the danger color (e.g. a Delete action). */
  danger?: boolean;
  testId?: string;
}

interface MenuProps {
  /** aria-label + native tooltip for the trigger, e.g. "Checklist actions". */
  label: string;
  items: MenuItem[];
  triggerTestId?: string;
}

// A "⋯ more" trigger that opens a popover list of actions. Shared so card
// headers (checklist panels today) don't each re-implement the trigger button,
// the popover wiring, and the menu-item styling.
export default function Menu(props: MenuProps) {
  // The trigger element stays mounted the whole time, so it's a stable anchor.
  // (Anchoring on a signal that goes null on close makes Popover's onCleanup
  // read a stale value as the menu tears down.)
  let triggerRef: HTMLButtonElement | undefined;
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class={styles.trigger}
        onClick={() => setOpen((o) => !o)}
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
        <Popover anchor={triggerRef!} onClose={() => setOpen(false)} class={styles.menu}>
          <div role="menu">
            <For each={props.items}>
              {(item) => (
                <button
                  type="button"
                  role="menuitem"
                  class={`${styles.item} ${item.danger ? styles.danger : ''}`}
                  onClick={() => {
                    // Close first so the popover's focus-return runs before the
                    // action moves focus (e.g. Rename focuses the title input).
                    setOpen(false);
                    item.onSelect();
                  }}
                  data-testid={item.testId}
                >
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
