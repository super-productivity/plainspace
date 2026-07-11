import { createSignal } from 'solid-js';
import { registerSW } from 'virtual:pwa-register';

const [updateReady, setUpdateReady] = createSignal(false);

let applyUpdate: (() => Promise<void>) | null = null;

export function setupServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    onNeedRefresh() {
      setUpdateReady(true);
    },
  }) as unknown as () => Promise<void>;
}

export { updateReady };

export function reloadForUpdate() {
  setUpdateReady(false);
  void applyUpdate?.();
}
