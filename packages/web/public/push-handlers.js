/* Push + notificationclick handlers for the Plainspace SW.
 *
 * Loaded via Workbox's `importScripts` from `vite.config.ts`, so the
 * generated PWA SW (vite-plugin-pwa / generateSW) gets these listeners
 * alongside its precache + navigation-fallback logic. We intentionally
 * don't register our own SW or add a `fetch` handler — the PWA already
 * owns root scope; everything we do here is purely on `push` and
 * `notificationclick` events.
 *
 * Push payloads (set by the server's reminder sweep):
 *   reminder:   { type: 'reminder', projectSlug, projectName?, itemId, text?,
 *                 recurring? }
 *   assignment: { type: 'assignment', projectSlug, projectName?, count,
 *                 itemId?, text? }  // itemId/text present only when count === 1
 *
 * The item text is the title (the OS already shows "Plainspace" as the app
 * name above it, so repeating it there is wasted space); the body labels the
 * notification and names the project. Fields fall back to generic strings if
 * `text` / `projectName` are missing (older server build, malformed payload).
 *
 * Action buttons (reminders only): every reminder gets a "Done" button; one-shot
 * reminders also get "Snooze 1h" (omitted when `recurring`, since re-arming
 * remind_at would permanently re-anchor the rule's time-of-day). Taps surface
 * through `notificationclick` with `event.action` set; we PATCH the item directly
 * using the member token mirrored into IndexedDB by the web app (see
 * src/lib/push-tokens.ts), falling back to opening the item when no token is
 * available or the request fails. Unsupported on Safari/iOS, where the buttons
 * are simply ignored and the body tap still opens the item.
 */
/* global self, clients, URL, indexedDB, fetch */

const SNOOZE_MS = 60 * 60 * 1000;

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* malformed payload — fall through to generic notification */
  }
  event.waitUntil(self.registration.showNotification(...notificationFor(data)));
});

// Map a push payload to [title, options]. Assignment notifications batch, so
// the title reflects the count; everything else renders as a reminder.
function notificationFor(data) {
  if (data.type === 'assignment') {
    const count = data.count || 1;
    const title =
      count === 1 ? data.text || 'A task was assigned to you' : `${count} tasks assigned to you`;
    const body = data.projectName
      ? `Assigned · ${data.projectName}`
      : 'You have new assigned tasks';
    // Namespace the tag under `assigned:` so an assignment and a reminder for
    // the same item don't collapse into (replace) each other. A single-item
    // batch tags by item; a multi-item batch has no itemId, so it tags by
    // project — successive batches for the same Space collapse rather than stack.
    const tag = `assigned:${data.itemId || data.projectSlug}`;
    return [title, { body, data, tag }];
  }
  const title = data.text || 'Reminder';
  const body = data.projectName ? `Reminder · ${data.projectName}` : 'You have a reminder';
  // Every reminder gets "Done"; one-shot reminders also get "Snooze 1h" (hidden
  // when recurring — snoozing would re-anchor the rule's time-of-day).
  const actions = [{ action: 'done', title: 'Done' }];
  if (!data.recurring) actions.push({ action: 'snooze', title: 'Snooze 1h' });
  // tag de-dupes if a user clears + re-sets and both fire.
  return [title, { body, data, actions, tag: data.itemId }];
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const slug = data.projectSlug;
  const id = data.itemId;
  if (event.action === 'done' || event.action === 'snooze') {
    event.waitUntil(runAction(event.action, slug, id));
    return;
  }
  if (!slug) {
    event.waitUntil(clients.openWindow('/'));
    return;
  }
  // Deep-link to the item when we have one (reminders, single-item assignment
  // batches); a multi-item assignment batch has no itemId, so open the board.
  const url = id
    ? `/${encodeURIComponent(slug)}/item/${encodeURIComponent(id)}`
    : `/${encodeURIComponent(slug)}`;
  event.waitUntil(focusOrOpen(slug, url));
});

// Perform a quick action from an action-button tap. PATCHes the item with the
// mirrored member token; on any miss (no token, bad slug, failed request) opens
// the item so the tap is never silently lost.
async function runAction(action, slug, id) {
  const url = slug && id ? `/${encodeURIComponent(slug)}/item/${encodeURIComponent(id)}` : '/';
  const token = slug ? await readToken(slug) : null;
  if (!slug || !id || !token) {
    await focusOrOpen(slug, url);
    return;
  }
  const body =
    action === 'snooze'
      ? { remindAt: new Date(Date.now() + SNOOZE_MS).toISOString() }
      : { checked: true };
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(slug)}/items/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      },
    );
    // Any non-2xx falls through to opening the item by design: a stale/rotated
    // token 401s, a pending terms re-acceptance 428s — in both cases the tap
    // lands the user in the app rather than silently doing nothing.
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    await focusOrOpen(slug, url);
  }
}

// Read a Space's mirrored member token from IndexedDB (written by the web app's
// push-tokens.ts). Resolves null on any error or miss. Must stay in sync with
// that module's DB name / store / version.
function readToken(slug) {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open('plainspace-push', 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore('tokens');
    req.onerror = () => resolve(null);
    // A version bump on the web-app side (must stay in sync) could block the
    // open behind another tab's connection; fail safe to "open the item".
    req.onblocked = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const get = db.transaction('tokens', 'readonly').objectStore('tokens').get(slug);
        get.onsuccess = () => {
          resolve(get.result || null);
          db.close();
        };
        get.onerror = () => {
          resolve(null);
          db.close();
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

async function focusOrOpen(slug, url) {
  const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const sameOrigin = all.filter(
    (c) => 'focus' in c && new URL(c.url).origin === self.location.origin,
  );
  // Prefer a tab already on this project — switching slugs out from under
  // a user looking at a different project would be a UX surprise.
  const slugPath = `/${slug}`;
  const sameSlug = sameOrigin.find((c) => {
    const path = new URL(c.url).pathname;
    return path === slugPath || path.startsWith(`${slugPath}/`);
  });
  const target = sameSlug ?? sameOrigin[0];
  if (target) {
    try {
      await target.focus();
      if ('navigate' in target && new URL(target.url).pathname !== url) {
        await target.navigate(url);
      }
      return;
    } catch {
      /* fall through to openWindow if focus/navigate rejects */
    }
  }
  await clients.openWindow(url);
}
