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
    <Show when={updateReady() && !dismissed()}>
      <div class={styles.host}>
        <Toast
          message="A new version is available."
          actionLabel="Reload"
          action={reloadForUpdate}
          onDismiss={() => setDismissed(true)}
          duration={60_000}
        />
      </div>
    </Show>
  );
}
