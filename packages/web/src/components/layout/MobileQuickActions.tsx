import { createSignal, onCleanup, onMount } from 'solid-js';
import styles from './MobileQuickActions.module.css';

const SCROLL: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' };
// Matches the fold transition in Collapsible.module.css — wait it out before
// scrolling so the target is measured at its final, expanded height.
const COLLAPSE_MS = 220;

// Below this scroll position the pill is always visible regardless of
// scroll direction; above it, scrolling down hides it and up reveals it.
const ALWAYS_VISIBLE_Y = 40;
// Asymmetric thresholds: hiding requires a few px of intent to avoid
// flicker on jitter; revealing should feel almost immediate.
const HIDE_THRESHOLD = 8;
const REVEAL_THRESHOLD = 2;

// The quick-action targets live inside collapsible cards whose bodies stay
// mounted (just clipped) when folded — so a tap can find them but they'd be
// invisible. If the card holding `el` is collapsed, tap its header toggle to
// expand it; returns true so the caller can wait for the fold before scrolling.
function expandCard(el: Element): boolean {
  const toggle = el
    .closest('section')
    ?.querySelector<HTMLElement>('[data-testid="panel-collapse"]');
  if (toggle?.getAttribute('aria-expanded') === 'false') {
    toggle.click();
    return true;
  }
  return false;
}

function scrollToTarget(el: Element, expanded: boolean) {
  if (expanded) setTimeout(() => el.scrollIntoView(SCROLL), COLLAPSE_MS);
  else el.scrollIntoView(SCROLL);
}

function focusAddTask() {
  const input = document.querySelector<HTMLInputElement>('[data-testid="add-item-input"]');
  if (!input) return;
  const expanded = expandCard(input);
  // Focus synchronously (still inside the tap) so mobile opens the keyboard.
  input.focus({ preventScroll: true });
  scrollToTarget(input, expanded);
}

function focusScratchpad() {
  // If the scratchpad is already in edit mode, jump straight into the textarea.
  const textarea = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="scratchpad-textarea"]',
  );
  if (textarea) {
    const expanded = expandCard(textarea);
    textarea.focus({ preventScroll: true });
    scrollToTarget(textarea, expanded);
    return;
  }
  // Otherwise click the display to flip the card into edit mode (which
  // focuses the textarea itself via requestAnimationFrame).
  const display = document.querySelector<HTMLElement>('[data-testid="scratchpad-content"]');
  if (!display) return;
  const expanded = expandCard(display);
  display.click();
  // The display is now replaced by the textarea; scroll it into view once it
  // has mounted (and the fold has settled, if we just expanded).
  const settle = () =>
    document
      .querySelector<HTMLTextAreaElement>('[data-testid="scratchpad-textarea"]')
      ?.scrollIntoView(SCROLL);
  if (expanded) setTimeout(settle, COLLAPSE_MS);
  else requestAnimationFrame(settle);
}

export default function MobileQuickActions() {
  const [hidden, setHidden] = createSignal(false);

  onMount(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < ALWAYS_VISIBLE_Y) {
        setHidden(false);
      } else {
        const delta = y - lastY;
        if (delta > HIDE_THRESHOLD) setHidden(true);
        else if (delta < -REVEAL_THRESHOLD) setHidden(false);
      }
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', onScroll));
  });

  return (
    <div
      class={styles.bar}
      role="group"
      aria-label="Quick actions"
      data-hidden={hidden() ? 'true' : undefined}
    >
      <button
        type="button"
        class={styles.action}
        onClick={focusAddTask}
        aria-label="Add a task"
        data-testid="quick-add-task"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        <span>Task</span>
      </button>
      <span class={styles.divider} aria-hidden="true" />
      <button
        type="button"
        class={styles.action}
        onClick={focusScratchpad}
        aria-label="Edit scratchpad"
        data-testid="quick-edit-scratchpad"
      >
        <svg
          width="18"
          height="18"
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
        <span>Scratchpad</span>
      </button>
    </div>
  );
}
