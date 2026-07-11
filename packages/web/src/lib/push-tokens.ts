/* Mirror per-Space member tokens into IndexedDB so the service worker — which
 * can't read localStorage — can authenticate the API calls fired by
 * notification action buttons (see public/push-handlers.js). Written whenever an
 * identity is saved (saveIdentity, so token rotations refresh it) and on push
 * (re)subscription; cleared from clearIdentity. Best-effort: every op swallows
 * failures (private mode, blocked IDB) since the action buttons degrade to
 * "open the item" when no token is found.
 */

const DB_NAME = 'plainspace-push';
const STORE = 'tokens';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export async function storePushToken(slug: string, token: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.put(token, slug));
  } catch {
    /* IDB unavailable — action buttons just fall back to opening the item */
  }
}

// Drops one Space's mirrored token. Called from clearIdentity(slug) so the
// mirror's lifecycle tracks the localStorage identity exactly: every logout
// path clears it, and leaving one Space leaves other Spaces' tokens intact.
export async function clearPushToken(slug: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(slug));
  } catch {
    /* ignore */
  }
}
