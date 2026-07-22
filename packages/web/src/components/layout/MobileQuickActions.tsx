import { createSignal, onCleanup, onMount } from 'solid-js';
import styles from './MobileQuickActions.module.css';

const SCROLL: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' };
const MOBILE_QUERY = '(max-width: 760px)';
// Matches the fold transition in Collapsible.module.css — wait it out before
// scrolling so the target is measured at its final, expanded height.
const COLLAPSE_MS = 220;

function isDirectlyVisible(el: Element): boolean {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const { top, bottom } = el.getBoundingClientRect();
  return bottom > 0 && top < window.innerHeight;
}

function shouldHide(): boolean {
  const addItem = document.querySelector('[data-testid="add-item-input"]');
  const scratchpad = document.querySelector(
    '[data-testid="scratchpad-textarea"], [data-testid="scratchpad-content"]',
  );
  if (!addItem || !scratchpad) return true;
  const addItemVisible = isDirectlyVisible(addItem);
  const scratchpadVisible = isDirectlyVisible(scratchpad);
  return addItemVisible && scratchpadVisible;
}

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

interface MobileQuickActionsProps {
  /** Keeps the inline styleguide specimen visible independent of page targets. */
  alwaysVisible?: boolean;
}

export default function MobileQuickActions(props: MobileQuickActionsProps) {
  // Start hidden so the floating controls never flash over their inline targets
  // before the first layout measurement runs.
  const [hideForTargets, setHideForTargets] = createSignal(true);
  const hidden = () => !props.alwaysVisible && hideForTargets();

  onMount(() => {
    if (props.alwaysVisible) return;
    const mobile = window.matchMedia(MOBILE_QUERY);
    let stopTracking: (() => void) | undefined;

    const syncTracking = () => {
      stopTracking?.();
      stopTracking = undefined;
      setHideForTargets(true);
      if (!mobile.matches) return;

      let frame: number | undefined;
      const updateHidden = () => {
        if (frame !== undefined) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          setHideForTargets(shouldHide());
        });
      };
      // Folding cards and editing their contents can change target availability
      // or position without scrolling or resizing.
      const visibilityObserver = new MutationObserver(updateHidden);
      visibilityObserver.observe(document.body, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
        attributeFilter: ['aria-hidden', 'inert'],
      });
      window.addEventListener('scroll', updateHidden, { passive: true });
      window.addEventListener('resize', updateHidden);
      updateHidden();

      stopTracking = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        visibilityObserver.disconnect();
        window.removeEventListener('scroll', updateHidden);
        window.removeEventListener('resize', updateHidden);
      };
    };

    mobile.addEventListener('change', syncTracking);
    syncTracking();
    onCleanup(() => {
      mobile.removeEventListener('change', syncTracking);
      stopTracking?.();
    });
  });

  return (
    <div
      class={styles.bar}
      role="group"
      aria-label="Quick actions"
      aria-hidden={hidden() ? 'true' : undefined}
      inert={hidden()}
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
