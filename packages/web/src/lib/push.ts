/* Web Push client integration. Idempotent: callers can invoke
 * `ensurePushSubscription(slug)` every time the user sets a reminder; the
 * function bails out fast when a usable subscription already exists.
 *
 * We do NOT register our own service worker — `src/lib/sw.ts` registers
 * the PWA SW via vite-plugin-pwa, and our push/notificationclick handlers
 * are injected into that SW through Workbox's `importScripts`
 * (see vite.config.ts, `public/push-handlers.js`). Here we just talk to
 * the existing registration.
 */

import { api } from './api';
import { getToken, listKnownSpaces } from './identity';
import { storePushToken } from './push-tokens';
import type { PushSubscriptionInput } from '@plainspace/shared';

function supportsWebPush(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Fetched on each subscribe attempt rather than cached: a stale module-level
// cache would mask VAPID rotation client-side, leaving every existing user
// silently broken (the cached key would match the browser's existing
// subscription, keyMatches() would return true, and re-subscribe would
// never run) until a full page reload. A tab-local ~5ms fetch is cheap.
async function fetchPublicKey(): Promise<string | null> {
  try {
    const body = await api.getPushPublicKey();
    return body.key;
  } catch {
    return null;
  }
}

// VAPID public keys are URL-safe base64. PushManager.subscribe requires a
// BufferSource backed by a real ArrayBuffer (not SharedArrayBuffer), so we
// allocate one explicitly to satisfy the stricter lib.dom typing.
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

// True when the subscription's stored applicationServerKey matches `expected`.
// Used to detect VAPID rotation: if the operator rotates keys, the cached
// browser subscription still points at the old key; we must unsubscribe and
// re-subscribe before pushManager.subscribe() will accept the new key.
function keyMatches(sub: PushSubscription, expected: ArrayBuffer): boolean {
  const actual = sub.options.applicationServerKey;
  if (!actual || actual.byteLength !== expected.byteLength) return false;
  const a = new Uint8Array(actual);
  const b = new Uint8Array(expected);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Ensures the browser has a push subscription registered with the server
 * for the current member of `slug`. Safe to call repeatedly; no-ops once
 * the server-side row exists. Silently bails on any unrecoverable failure
 * (no support, permission denied, missing VAPID) — the reminder sweep
 * falls back to email when no subscription is registered.
 */
export async function ensurePushSubscription(slug: string): Promise<void> {
  if (!supportsWebPush()) return;
  if (!getToken(slug)) return;

  if (Notification.permission === 'denied') return;
  if (Notification.permission === 'default') {
    const granted = await Notification.requestPermission();
    if (granted !== 'granted') return;
  }

  // The PWA SW is registered at app boot via lib/sw.ts (vite-plugin-pwa);
  // wait for it to become active before driving pushManager.
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return;

  const key = await fetchPublicKey();
  if (!key) return;
  const keyBuffer = urlBase64ToBuffer(key);

  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !keyMatches(subscription, keyBuffer)) {
    // VAPID rotated under us; replace the stale subscription.
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuffer,
      });
    } catch (err) {
      console.warn('Push subscribe failed', err);
      return;
    }
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    // W3C declares these optional but every spec-compliant browser populates
    // them when subscribing with userVisibleOnly + a valid VAPID key. Bail
    // rather than ship a malformed PUT the server will 422 anyway.
    console.warn('PushSubscription.toJSON() returned an unexpected shape', json);
    return;
  }
  await api.updatePushSubscription(slug, json as PushSubscriptionInput).catch((err) => {
    console.warn('Push subscription PUT failed', err);
  });
  // Mirror this Space's token for the SW so notification action buttons can
  // authenticate. getToken(slug) is non-null here (guarded at the top).
  await storePushToken(slug, getToken(slug)!);
}

/**
 * Unsubscribes the browser's current PushSubscription when `leavingSlug` is
 * the LAST Space known on this device. Call this before `clearIdentity()` so
 * that the next user on a shared browser gets a fresh endpoint instead of
 * inheriting the previous member's subscription. The server-side row is left
 * to 410-cleanup (after `deleteSelf` cascade) or to the next sweep that tries
 * to push to the now-defunct endpoint. Best-effort: silently no-ops if web
 * push isn't supported or no subscription exists.
 */
export async function clearPushSubscription(leavingSlug: string): Promise<void> {
  // The browser holds ONE PushSubscription per origin, shared by every Space
  // on this device. Unsubscribing on a one-Space exit would point the other
  // Spaces' server-side subscription rows at a dead endpoint and silently
  // degrade their reminders to email — so only unsubscribe when no other
  // Space identity remains.
  if (listKnownSpaces().some((s) => s.slug !== leavingSlug)) return;
  if (!supportsWebPush()) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await sub.unsubscribe().catch(() => undefined);
}
