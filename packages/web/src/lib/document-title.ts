import { createEffect } from 'solid-js';

/**
 * Keeps `document.title` in sync with the mounted route.
 *
 * An effect rather than `onMount` so a title derived from fetched data (a Space
 * name) updates when it arrives, and so a request that resolves *after* the user
 * navigated away can't clobber the next route's title — the effect is disposed
 * with the route. Callers pass the full title: most read "X — Plainspace", but
 * the landing page inverts that, so a forced suffix would be wrong.
 */
export function useDocumentTitle(title: () => string): void {
  createEffect(() => {
    document.title = title();
  });
}
