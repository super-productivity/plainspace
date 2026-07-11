import type { JSX } from 'solid-js';
import { onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './Dialog.module.css';

// Open dialogs, in mount order. With nested dialogs (e.g. a ConfirmDialog
// opened from inside a side panel) every instance gets the document keydown,
// so Escape must only act on the topmost one or both would close at once.
const openDialogs: HTMLElement[] = [];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DialogProps {
  onClose: () => void;
  ariaLabel?: string;
  class?: string;
  placement?: 'center' | 'side';
  children: JSX.Element;
  'data-testid'?: string;
}

export default function Dialog(props: DialogProps) {
  let dialogRef: HTMLDivElement | undefined;
  let previousActiveElement: HTMLElement | null = null;

  function getFocusableElements(): HTMLElement[] {
    if (!dialogRef) return [];
    // getClientRects() is empty for elements in a display:none subtree (e.g. a
    // collapsed [hidden] section), which can't be focused. Excluding them keeps
    // the Tab wrap-around anchored to reachable elements so focus stays trapped.
    return Array.from(dialogRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.tabIndex !== -1 && el.getClientRects().length > 0,
    );
  }

  function handleKey(e: KeyboardEvent) {
    if (dialogRef !== openDialogs[openDialogs.length - 1]) return;
    if (e.key === 'Escape') props.onClose();
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) {
      e.preventDefault();
      dialogRef?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    if (dialogRef) openDialogs.push(dialogRef);
    previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.addEventListener('keydown', handleKey);
    queueMicrotask(() => {
      const [first] = getFocusableElements();
      (first ?? dialogRef)?.focus();
    });
  });
  onCleanup(() => {
    const index = dialogRef ? openDialogs.indexOf(dialogRef) : -1;
    if (index !== -1) openDialogs.splice(index, 1);
    document.removeEventListener('keydown', handleKey);
    previousActiveElement?.focus();
  });

  const isSidePanel = () => props.placement === 'side';

  return (
    <Portal>
      <div
        class={`${styles.overlay} ${isSidePanel() ? styles.sideOverlay : ''}`}
        onClick={() => props.onClose()}
        role="presentation"
      >
        <div
          ref={(el) => (dialogRef = el)}
          class={`${styles.dialog} ${isSidePanel() ? styles.sideDialog : ''} ${props.class ?? ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={props.ariaLabel}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          data-testid={props['data-testid']}
        >
          {props.children}
        </div>
      </div>
    </Portal>
  );
}
