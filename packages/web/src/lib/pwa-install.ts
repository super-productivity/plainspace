import { createSignal } from 'solid-js';

// Chromium fires `beforeinstallprompt` when the app is installable; we stash the
// event so an in-app button can trigger the native install prompt on demand.
// Safari/iOS never fire it (install is via the Share menu), so `canInstall`
// simply stays false there and the button hides.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const [installEvent, setInstallEvent] = createSignal<BeforeInstallPromptEvent | null>(null);

export const canInstall = () => installEvent() !== null;

export function setupInstallPrompt() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setInstallEvent(e as BeforeInstallPromptEvent);
  });
  // Once installed the event is meaningless; hide the button.
  window.addEventListener('appinstalled', () => setInstallEvent(null));
}

export async function promptInstall(): Promise<void> {
  const evt = installEvent();
  if (!evt) return;
  // The prompt event is single-use; clear it so the button hides and we can't
  // double-prompt. prompt() rejects if already consumed or called outside a
  // user gesture — swallow it rather than leak an unhandled rejection.
  setInstallEvent(null);
  try {
    await evt.prompt();
    await evt.userChoice;
  } catch {
    /* nothing to recover; the event is spent either way */
  }
}
