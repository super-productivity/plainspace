import { Show, createSignal, onCleanup } from 'solid-js';
import styles from './Toast.module.css';

interface ToastProps {
  message: string;
  action?: () => void;
  actionLabel?: string;
  onDismiss: () => void;
  duration?: number;
}

const DEFAULT_DURATION_MS = 6_000;
// Action (undo) toasts get longer: touch users have no hover to pause the
// timer and need time to notice + aim before their only recovery path is gone.
const ACTION_DURATION_MS = 10_000;

export default function Toast(props: ToastProps) {
  // Snapshot once: a toast doesn't change duration mid-life.
  // eslint-disable-next-line solid/reactivity
  const durationMs = props.duration ?? (props.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS);
  const [paused, setPaused] = createSignal(false);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = Date.now();
  let remaining = durationMs;

  function scheduleDismiss(ms: number) {
    if (timer) clearTimeout(timer);
    startedAt = Date.now();
    timer = setTimeout(() => props.onDismiss(), ms);
  }

  function pause() {
    if (paused() || !timer) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    setPaused(true);
  }

  function resume() {
    if (!paused()) return;
    setPaused(false);
    scheduleDismiss(remaining);
  }

  scheduleDismiss(remaining);
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return (
    <div
      class={styles.toast}
      data-testid="toast"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocusIn={pause}
      onFocusOut={resume}
      onTouchStart={pause}
      onTouchEnd={resume}
      onTouchCancel={resume}
    >
      <span class={styles.message}>{props.message}</span>
      <div class={styles.actions}>
        <Show when={props.action && props.actionLabel}>
          <button
            class={styles.actionButton}
            onClick={() => {
              props.action!();
              props.onDismiss();
            }}
            data-testid="toast-action"
          >
            {props.actionLabel}
          </button>
        </Show>
        <button class={styles.dismiss} onClick={() => props.onDismiss()} aria-label="Dismiss">
          &#10005;
        </button>
      </div>
      <div
        class={`${styles.progress} ${paused() ? styles.progressPaused : ''}`}
        style={{ 'animation-duration': `${durationMs}ms` }}
        aria-hidden="true"
      />
    </div>
  );
}
