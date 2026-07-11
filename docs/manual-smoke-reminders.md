# Reminders + push: manual smoke checklist

Automated tests cover the server logic and the web-side contract, but real
push delivery and real service-worker behaviour can only be verified on a
browser talking to an actual push service. Run this checklist once per
release that touches reminders, push, the service worker, or the
`clearIdentity` path.

## Automated layers (run these too)

- **Server sweep tests** (vitest). Cover atomic-claim, soft-delete exclusion,
  restore-after-fire, 410 cleanup, allow-list rejection, email fallback.
  ```sh
  docker compose -f docker-compose.test.yml up -d
  npm test --workspace @plainspace/server
  ```
- **Web-side e2e spec** (`packages/e2e/tests/reminders.spec.ts`). Stubs
  `PushManager`/`serviceWorker` via `addInitScript`; verifies the subscribe
  PUT, the reminder PATCH, persistence across reload, leave-Space
  unsubscribe, and VAPID rotation.
  ```sh
  npm run test:e2e -- reminders.spec.ts
  ```

## Prerequisites

- Local server running with VAPID keys in `.env`:
  ```
  npx web-push generate-vapid-keys
  # paste VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY into .env
  # set VAPID_SUBJECT=mailto:hello@plainspace.org
  ```
- Two browser profiles (or one browser + one incognito window) so you can
  exercise multi-member scenarios.
- A way to read outgoing SMTP — mailcatcher, MailHog, or the dev-mode stdout
  the SMTP service falls back to.

## Checklist

- [ ] **Push happy path.** Set a reminder ~90 s out, assigned to self, with
      push permission granted. Push notification fires; the body shows the
      task text (truncated to 200 chars with an ellipsis if longer).
      Clicking it opens `/:slug/item/:itemId` and focuses an existing tab on
      that slug if one is open.

- [ ] **Email fallback.** Same flow but deny push permission (or use a
      browser without a registered SW). Reminder email lands in the SMTP log.

- [ ] **Mixed targets.** Unassigned reminder, two members on two browsers
      (one subscribed, one not). First gets push, second gets email.

- [ ] **Cancel before fire.** Set, then clear `remindAt` before fire time.
      Sweep skips the row (no notification, no email).

- [ ] **Edit between set and fire.** Set a reminder, edit the item text,
      wait for fire. Push fires; the SPA renders the _current_ text on
      click (the payload only carries IDs, so this verifies the SPA
      re-reads from the project payload).

- [ ] **410 cleanup.** Unsubscribe the browser via DevTools → Application →
      Service Workers → Push. Set another reminder, wait for the sweep.
      `select * from push_subscriptions` shows the row is gone.

- [ ] **Hijack test.** As member A in a Space, copy member B's endpoint
      (sniff from B's `PUT /push/subscription` request in DevTools), then
      `PUT /api/projects/:slug/push/subscription` as A with B's endpoint
      and A's own p256dh/auth. Verify `select * from push_subscriptions`
      shows both `(A, endpoint)` and `(B, endpoint)` — A did _not_
      overwrite B's row.

- [ ] **Restore-after-fire.** Set a reminder ~30 s out, soft-delete the
      item, wait past the fire time, restore the item. Expect exactly one
      notification on the next sweep tick (documented behaviour — the
      restored item carries the now-overdue `remindAt`).

- [ ] **Leave Space on shared browser.** Member A on a shared browser sets
      a reminder, then taps "Leave Space". The push subscription row is
      removed (DevTools → Application → Service Workers → Push shows
      empty; DB confirms). Next member to sign up on the same browser
      gets a fresh endpoint, not A's.

- [ ] **VAPID rotation.** Stop the server, rotate `VAPID_PUBLIC_KEY` and
      `VAPID_PRIVATE_KEY` in `.env`, restart. Load the app — the client
      detects the key mismatch on the next reminder set, unsubscribes,
      and re-subscribes. The old `push_subscriptions` row is replaced
      (DB confirms).

## Recurrence (repeating reminders)

The next-occurrence math, sweep reactivation, anchor stamping, and DST
handling are covered by unit tests; this section is for real-push verification
of a recurring reminder end to end.

- [ ] **Daily reminder reactivates.** Set a reminder ~30 s out and pick
      **Daily** in the repeat `<select>`. Verify the badge shows the ↻ glyph.
      Check the item off. After the fire time, on the next sweep tick: a
      notification arrives, the item un-checks itself and returns to the todo
      column, and the badge persists with `remind_at` advanced ~24 h
      (`select remind_at, repeat from items where id = …`).

- [ ] **Anchor is immutable.** With a recurring item armed, rename it / drag
      it / check it off. Confirm `repeat->>'anchor'` in the DB is unchanged
      (only an explicit reminder-time edit re-anchors the series).

- [ ] **Weekly/Monthly derive correctly.** Pick a fire time on a Tuesday and
      choose **Weekly** — the option label reads "Weekly on Tuesday" and the
      stored rule has `byWeekday: ['TU']`. Pick the 28th and choose
      **Monthly** — the rule has `byMonthDay: 28`, never an impossible 31.

- [ ] **Clearing the reminder clears the rule.** Open the picker on a
      recurring item and hit **Clear**. Both `remind_at` and `repeat` go NULL
      (DB confirms); the ↻ badge disappears.
