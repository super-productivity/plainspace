import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './Popover.module.css';

interface PopoverProps {
  anchor: HTMLElement;
  onClose: () => void;
  align?: 'start' | 'end';
  offset?: number;
  class?: string;
  children: JSX.Element;
  'data-testid'?: string;
}

type Position = { top: number; left?: number; right?: number };

export default function Popover(props: PopoverProps) {
  // Declared before compute() runs (compute reads popoverRef, and it's first
  // called in the createSignal initializer below — referencing the binding
  // before this line would hit the temporal dead zone).
  let popoverRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  function compute(): Position {
    const rect = props.anchor.getBoundingClientRect();
    const offset = props.offset ?? 4;
    const align = props.align ?? 'end';
    const margin = 8;
    // Size is only known once mounted; the first synchronous call falls back to
    // edge-anchoring and is refined by the onMount reposition + ResizeObserver.
    const h = popoverRef?.offsetHeight ?? 0;
    const w = popoverRef?.offsetWidth ?? 0;

    // Vertical: open below the anchor; if that runs past the bottom edge, flip
    // above when there's room, else clamp into view.
    let top = rect.bottom + offset;
    if (h && top + h > window.innerHeight - margin) {
      const above = rect.top - offset - h;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - h - margin);
    }

    // Horizontal: anchor the chosen edge to the button, then clamp the whole box
    // within the viewport so it can't run off either side on a narrow screen.
    if (w) {
      const desired = align === 'end' ? rect.right - w : rect.left;
      const left = Math.max(margin, Math.min(desired, window.innerWidth - w - margin));
      return { top, left };
    }
    return align === 'end'
      ? { top, right: Math.max(margin, window.innerWidth - rect.right) }
      : { top, left: Math.max(margin, rect.left) };
  }

  const [pos, setPos] = createSignal<Position>(compute());

  function reposition() {
    setPos(compute());
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') props.onClose();
  }

  onMount(() => {
    // Outside-tap closing is owned by the backdrop scrim below — it swallows the
    // click so the page never gets it. (A document mousedown handler would close
    // on the mousedown and let the trailing click fall through to whatever was
    // underneath, an accidental action.)
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    // Now that the popover is in the DOM its height is known — re-measure so the
    // viewport clamp/flip applies, and keep it correct as the content grows or
    // shrinks (e.g. a disclosure expanding).
    reposition();
    if (popoverRef && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => reposition());
      resizeObserver.observe(popoverRef);
    }
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKey);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    resizeObserver?.disconnect();
    // Return focus to the trigger when the popover had it (closed via Escape,
    // a selection, or removal) — but don't steal focus if the user moved it
    // elsewhere (e.g. clicked another control). Owning this here keeps every
    // Popover consumer consistent instead of each re-implementing focus return.
    const active = document.activeElement;
    if (!active || active === document.body || popoverRef?.contains(active)) {
      props.anchor.focus({ preventScroll: true });
    }
  });

  return (
    <Portal>
      {/* Full-screen scrim just below the popover. Owns the tap-away: a click
          here closes the popover and, because it lands on the scrim, never
          reaches the element underneath — no accidental action from tapping
          away. It is visible on touch devices, where there is no hover cue.
          cursor:pointer is load-bearing: Solid delegates the click to the
          document root, and iOS Safari only bubbles clicks from elements it
          treats as clickable, so without it a tap on the scrim wouldn't dismiss
          the popover on iOS (its only tap-away path on touch). */}
      <div onClick={() => props.onClose()} role="presentation" class={styles.backdrop} />
      <div
        ref={popoverRef}
        class={props.class}
        style={{
          position: 'fixed',
          top: `${pos().top}px`,
          left: pos().left !== undefined ? `${pos().left}px` : undefined,
          right: pos().right !== undefined ? `${pos().right}px` : undefined,
          'z-index': 1000,
        }}
        data-testid={props['data-testid']}
      >
        {props.children}
      </div>
    </Portal>
  );
}
