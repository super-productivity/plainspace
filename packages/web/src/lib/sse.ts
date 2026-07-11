import { getToken, getMemberId, getPlainspaceEmail, clearIdentity } from './identity';
import { clearPushSubscription } from './push';
import { createSSEParser } from './sse-parser';
import type { SSEEvent } from '@plainspace/shared';
import {
  updateList,
  addItem,
  updateItem,
  removeItem,
  restoreItem as restoreItemInStore,
  updateProject,
  addMember,
  updateMember as updateMemberInStore,
  removeMember,
  updateScratchpad,
  setScratchpadEditing,
  addAttachment,
  removeAttachment,
  addPanel,
  updatePanel,
  removePanel,
  setPollVote,
  setTimeSlotResponse,
  setPresence,
  addActivity,
  setConnected,
} from './store';

type SSEEventName = SSEEvent['event'];
type SSEEventData<E extends SSEEventName> = Extract<SSEEvent, { event: E }>['data'];
type SSEEventHandlers = {
  [E in Exclude<SSEEventName, 'ping'>]?: (data: SSEEventData<E>) => void;
};

let streamAbort: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
// Tracked so the `member.removed` handler can detect self-removal and clear
// the local token. The connectSSE/disconnectSSE pair guarantees exactly one
// active slug at a time.
let currentSlug: string | null = null;
// Fired after a *re-established* connection (not the first connect). The
// stream carries no event ids and the server buffers nothing, so any
// mutation during the disconnect window is missed; the consumer uses this to
// re-fetch a full project snapshot and reconcile the store.
let onReconnect: (() => void) | null = null;
const SCRATCHPAD_EDITOR_STALE_MS = 6_500;
const scratchpadEditorTimers = new Map<string, ReturnType<typeof setTimeout>>();

function handleScratchpadEditing(data: { memberId: string; editing: boolean }) {
  const existingTimer = scratchpadEditorTimers.get(data.memberId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    scratchpadEditorTimers.delete(data.memberId);
  }

  setScratchpadEditing(data.memberId, data.editing);

  if (data.editing) {
    scratchpadEditorTimers.set(
      data.memberId,
      setTimeout(() => {
        scratchpadEditorTimers.delete(data.memberId);
        setScratchpadEditing(data.memberId, false);
      }, SCRATCHPAD_EDITOR_STALE_MS),
    );
  }
}

const EVENT_HANDLERS: SSEEventHandlers = {
  'list.updated': (d) => updateList(d.list),
  'item.created': (d) => addItem(d.item),
  'item.updated': (d) => updateItem(d.item),
  'item.deleted': (d) => removeItem(d.itemId),
  'item.restored': (d) => restoreItemInStore(d.item),
  'member.joined': (d) => addMember(d.member),
  'member.updated': (d) => updateMemberInStore(d.member),
  'member.removed': (d) => {
    // If the server just removed *us*, the join token is already invalid.
    // Drop it locally and bounce to /join instead of letting the SPA carry
    // a dead credential until the next 401.
    if (currentSlug && getMemberId(currentSlug) === d.memberId) {
      // Best-effort: drop the browser's PushSubscription before the redirect
      // so the next user on a shared browser doesn't inherit this one.
      void clearPushSubscription(currentSlug);
      clearIdentity(currentSlug);
      window.location.assign(`/${currentSlug}/join`);
      return;
    }
    removeMember(d.memberId);
  },
  'project.updated': (d) => updateProject(d.project),
  'project.deleted': () => {
    // The creator deleted the whole Space; this device's token is already dead
    // (cascade). Drop local state and leave — home, not /join, since the slug
    // no longer resolves.
    if (!currentSlug) return;
    void clearPushSubscription(currentSlug);
    clearIdentity(currentSlug);
    window.location.assign('/');
  },
  'scratchpad.updated': (d) => updateScratchpad(d.scratchpad),
  'scratchpad.editing': (d) => handleScratchpadEditing(d),
  'attachment.created': (d) => addAttachment(d.attachment),
  'attachment.deleted': (d) => removeAttachment(d.attachmentId),
  'panel.created': (d) => addPanel(d.panel),
  'panel.updated': (d) => updatePanel(d.panel),
  'panel.deleted': (d) => removePanel(d.panelId),
  'poll.vote': (d) => setPollVote(d.panelId, d.memberId, d.optionId),
  'timeslot.response': (d) => setTimeSlotResponse(d.panelId, d.memberId, d.slotId, d.available),
  presence: (d) => setPresence(d.online),
  activity: (d) => addActivity(d.entry),
};

function dispatchSSEEvent(eventName: string, data: string) {
  if (eventName === 'ping') return;
  const handler = EVENT_HANDLERS[eventName as Exclude<SSEEventName, 'ping'>];
  if (!handler) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return; // malformed wire data; skip the event
  }
  try {
    (handler as (d: unknown) => void)(parsed);
  } catch (err) {
    // A throwing store handler is a real bug, not wire noise — surface it
    // instead of silently diverging from server state (but keep the read
    // loop alive).
    console.error(`SSE handler for "${eventName}" failed`, err);
  }
}

class UnauthorizedError extends Error {}

async function readEventStream(slug: string, token: string, controller: AbortController) {
  const res = await fetch(`/api/projects/${slug}/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });

  if (res.status === 401) {
    throw new UnauthorizedError('SSE unauthorized');
  }

  if (!res.ok || !res.body) {
    throw new Error('SSE connection failed');
  }

  // A successful read after one or more failed attempts means we just
  // recovered a dropped stream; reconcile the snapshot the gap may have
  // skipped. The first connect (attempts === 0) is paired with the initial
  // project load, so it needs no resync.
  const wasReconnect = reconnectAttempts > 0;
  reconnectAttempts = 0;
  setConnected(true);
  if (wasReconnect) onReconnect?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();

  try {
    while (true) {
      const { value, done } = await reader.read();
      const chunk = decoder.decode(value, { stream: !done });
      for (const ev of parser.feed(chunk)) dispatchSSEEvent(ev.event, ev.data);
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  if (!controller.signal.aborted) {
    throw new Error('SSE stream closed');
  }
}

function scheduleReconnect(slug: string) {
  setConnected(false);
  const base = Math.min(1000 * 2 ** reconnectAttempts, 30000);
  const delay = base * (0.5 + Math.random() / 2);
  reconnectAttempts++;
  // Reuse openStream (not connectSSE) so the reconnect keeps the registered
  // onReconnect callback instead of resetting it.
  reconnectTimeout = setTimeout(() => openStream(slug), delay);
}

// Shared recovery for "this device's token is no longer valid" (member
// removed, merged away, identity cleared) — the single place that clears
// credentials and redirects, whether the 401 came from the stream or a
// project load. With a saved email, land in recover mode (email prefilled)
// instead of the join-as-new form, which would create a duplicate member.
export function handleUnauthorized(slug: string) {
  setConnected(false);
  void clearPushSubscription(slug);
  clearIdentity(slug);
  const recover = getPlainspaceEmail() ? '?recover=1' : '';
  // replace, not assign: Back must not return to the broken /{slug} URL,
  // which would just 401-redirect here again.
  window.location.replace(`/${slug}/join${recover}`);
}

function openStream(slug: string): void {
  const token = getToken(slug);
  if (!token) {
    // Identity was cleared out from under a live session (e.g. another tab
    // left the Space). Without this the reconnect chain would dead-end with
    // a permanent "Reconnecting…" banner; recover the same way as a 401.
    handleUnauthorized(slug);
    return;
  }

  // Abort any in-flight stream but keep timers / currentSlug / onReconnect,
  // so a reconnect doesn't tear down the session bookkeeping.
  streamAbort?.abort();
  const controller = new AbortController();
  streamAbort = controller;

  readEventStream(slug, token, controller).catch((err) => {
    if (controller.signal.aborted) return;
    if (err instanceof UnauthorizedError) {
      handleUnauthorized(slug);
      return;
    }
    scheduleReconnect(slug);
  });
}

export function connectSSE(slug: string, onReconnectResync?: () => void): void {
  disconnectSSE();
  currentSlug = slug;
  onReconnect = onReconnectResync ?? null;
  openStream(slug);
}

export function disconnectSSE(): void {
  streamAbort?.abort();
  streamAbort = null;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  scratchpadEditorTimers.forEach((timer) => clearTimeout(timer));
  scratchpadEditorTimers.clear();
  reconnectAttempts = 0;
  currentSlug = null;
  onReconnect = null;
  setConnected(false);
}
