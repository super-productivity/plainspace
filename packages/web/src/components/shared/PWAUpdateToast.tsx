import { Show, createSignal, createEffect } from 'solid-js';
import Toast from './Toast';
import { updateReady, reloadForUpdate } from '../../lib/sw';
import styles from './PWAUpdateToast.module.css';

export default function PWAUpdateToast() {
  const [dismissed, setDismissed] = createSignal(false);
  // Reset dismissal if another update comes in later.
  createEffect(() => {
    if (updateReady()) setDismissed(false);
  });
  return (
    // The host stays mounted and carries the live region: a region inserted in
    // the same tick as its content is unreliably announced. It is fixed,
    // pointer-events:none and has no box of its own, so an empty one costs
    // nothing. aria-atomic is explicit because role="status" implies true.
    <div class={styles.host} role="status" aria-atomic="false">
      <Show when={updateReady() && !dismissed()}>
        <Toast
          message="A new version is available."
          actionLabel="Reload"
          action={reloadForUpdate}
          onDismiss={() => setDismissed(true)}
          duration={60_000}
        />
      </Show>
    </div>
  );
}
