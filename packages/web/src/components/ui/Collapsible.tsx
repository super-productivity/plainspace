import { Show, createSignal, untrack, type JSX } from 'solid-js';
import styles from './Collapsible.module.css';

// Per-device collapse state, persisted in localStorage. Panels are shared
// content, but how *I* fold them is mine — so the preference lives client-side,
// keyed by the panel's stable id rather than in the DB. The read is one-time at
// init (ids are stable), so untrack it.
export function createCollapsed(id: string) {
  const key = `panel-collapsed:${id}`;
  const [collapsed, setCollapsed] = createSignal(
    untrack(() => typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'),
  );
  function toggle() {
    const next = !collapsed();
    setCollapsed(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode); collapse just won't persist.
    }
  }
  return { collapsed, toggle };
}

// One-tap collapse on the whole title row. An expanded card shows just the
// heading — the content is right there, so a persistent affordance would only
// add clutter. A folded card surfaces a small gutter chevron + an optional count
// so it reads as "tap to expand" and says how much it's hiding (mirrors the
// "Done · N" disclosure). The whole title row is the tap target.
export function CollapseToggle(props: {
  collapsed: boolean;
  onToggle: () => void;
  count?: number;
  testId?: string;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class={styles.toggle}
      onClick={() => props.onToggle()}
      aria-expanded={!props.collapsed}
      title={props.collapsed ? 'Expand' : 'Collapse'}
      data-testid={props.testId ?? 'panel-collapse'}
    >
      {/* Always rendered (not <Show>) so it can animate the turn + fade on both
          collapse and expand — CSS reveals it only when collapsed. */}
      <svg class={styles.chevron} width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d="M2 4l3 3 3-3"
          stroke="currentColor"
          stroke-width="1.4"
          fill="none"
          stroke-linecap="round"
        />
      </svg>
      {props.children}
      <Show when={props.collapsed && props.count != null}>
        <span class={styles.count}>· {props.count}</span>
      </Show>
    </button>
  );
}

// Animated fold: the outer grid row goes 1fr→0fr while the inner clips overflow,
// so the body slides closed instead of vanishing. The inner stays mounted (so a
// SortableJS handle or a focused textarea survives the fold), and innerClass lets
// the consumer lay out the body.
export function CollapseBody(props: {
  collapsed: boolean;
  innerClass?: string;
  children: JSX.Element;
}) {
  return (
    <div classList={{ [styles.body]: true, [styles.collapsed]: props.collapsed }}>
      <div classList={{ [styles.inner]: true, [props.innerClass ?? '']: !!props.innerClass }}>
        {props.children}
      </div>
    </div>
  );
}
