import { createSignal } from 'solid-js';

export interface ToastEntry {
  id: string;
  message: string;
  action?: () => void;
  actionLabel?: string;
}

const [toasts, setToasts] = createSignal<ToastEntry[]>([]);

export { toasts };

export function addToast(
  message: string,
  action?: () => void,
  actionLabel?: string,
): string | undefined {
  // Skip exact duplicates so a repeatedly failing autosave doesn't stack
  // identical error toasts. Only dedupe passive toasts: actionable ones (e.g.
  // per-item "Undo" deletes) can share text yet each needs its own affordance.
  if (!action && toasts().some((t) => t.message === message && !t.action)) return;
  const id = crypto.randomUUID();
  setToasts((prev) => [...prev, { id, message, action, actionLabel }]);
  return id;
}

export function dismissToast(id: string): void {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}
