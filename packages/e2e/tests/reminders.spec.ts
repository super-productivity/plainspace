import { test, expect, type Page } from '@playwright/test';
import { setupProject, setupJoinedMember } from '../helpers/fixtures';
import { clickItemAction } from '../helpers/item-actions';

// A valid URL-safe base64 string (87 chars + '=' pad = 88 chars → 65 bytes,
// the size of a P-256 uncompressed public key). Bytes themselves are
// meaningless — `urlBase64ToBuffer` parses it; pushManager.subscribe is
// stubbed and doesn't care what bytes it sees.
const KEY_A = 'A'.repeat(87) + '=';
const KEY_B = 'B'.repeat(87) + '=';

/**
 * Installs fake Notification + serviceWorker + PushManager into the page
 * before any user script runs. The fake pushManager.subscribe() returns a
 * subscription with `endpoint`/`keys` shaped exactly like a real FCM
 * subscription so the server accepts it. The fake registration also tracks
 * subscribe/unsubscribe call counts on window.__pushMock for tests to
 * inspect.
 */
async function installPushMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Sub = {
      endpoint: string;
      options: { applicationServerKey: ArrayBuffer | null };
      toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
      unsubscribe: () => Promise<boolean>;
    };

    const state = {
      current: null as Sub | null,
      subscribeCalls: 0,
      unsubscribeCalls: 0,
    };
    (window as unknown as { __pushMock: typeof state }).__pushMock = state;

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: () => Promise.resolve('granted' as const),
      },
    });
    (window as unknown as { PushManager: unknown }).PushManager = class {};

    const fakeEndpoint = 'https://fcm.googleapis.com/fcm/send/playwright-stub';

    const fakeReg = {
      pushManager: {
        getSubscription: () => Promise.resolve(state.current),
        subscribe: (opts: { applicationServerKey: ArrayBuffer }) => {
          state.subscribeCalls++;
          const sub: Sub = {
            endpoint: fakeEndpoint,
            options: { applicationServerKey: opts.applicationServerKey },
            toJSON: () => ({
              endpoint: fakeEndpoint,
              keys: { p256dh: 'p256dh-stub', auth: 'auth-stub' },
            }),
            unsubscribe: () => {
              state.unsubscribeCalls++;
              // Persist to localStorage so tests can read it across the
              // navigation that follows "Leave Space" (which lands on '/'
              // and re-runs this init script with a fresh state object).
              localStorage.setItem('__pushMockUnsubscribes', String(state.unsubscribeCalls));
              state.current = null;
              return Promise.resolve(true);
            },
          };
          state.current = sub;
          return Promise.resolve(sub);
        },
      },
    };

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(fakeReg),
        getRegistration: () => Promise.resolve(fakeReg),
        register: () => Promise.resolve(fakeReg),
        addEventListener: () => {},
      },
    });
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localInputValue(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function setReminder(page: Page, offsetMs: number): Promise<void> {
  await clickItemAction(page, 'reminder');
  await expect(page.getByTestId('reminder-picker')).toBeVisible();
  // The exact-time native input now lives inside a <details> disclosure; reveal
  // it before filling for a deterministic future offset.
  await page.getByTestId('reminder-exact-toggle').click();
  await page.getByTestId('reminder-input').fill(localInputValue(offsetMs));
  await page.getByTestId('reminder-save').click();
  await expect(page.getByTestId('reminder-picker')).not.toBeVisible();
}

test.describe('reminders', () => {
  test.beforeEach(async ({ page }) => {
    await installPushMocks(page);
    // Default: server returns KEY_A as the VAPID public key. Individual
    // tests can override before navigation.
    await page.route('**/api/push/public-key', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ key: KEY_A }),
      }),
    );
  });

  test('setting a reminder subscribes for push and persists across reload', async ({ page }) => {
    const { project } = await setupProject(page);
    await page.goto(`/${project.slug}`);

    await page.getByTestId('add-item-input').fill('Call dentist');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('Call dentist');

    const pushPut = page.waitForRequest(
      (req) => /\/push\/subscription$/.test(req.url()) && req.method() === 'PUT',
    );

    await setReminder(page, 5 * 60_000);

    const putReq = await pushPut;
    const body = JSON.parse(putReq.postData() ?? '{}');
    expect(body.endpoint).toContain('fcm.googleapis.com');
    expect(body.keys).toEqual({ p256dh: 'p256dh-stub', auth: 'auth-stub' });

    // The reminder button gets the .hasReminder class once the PATCH lands.
    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);

    // Reload — the reminder is persisted server-side, so it should come
    // back populated from the project payload, not from any cache.
    await page.reload();
    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);
  });

  test('setting Daily sends a repeat rule and shows the recurring badge', async ({ page }) => {
    const { project } = await setupProject(page);
    await page.goto(`/${project.slug}`);

    await page.getByTestId('add-item-input').fill('Take meds');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('Take meds');

    const patch = page.waitForRequest(
      (req) => /\/items\/[^/]+$/.test(req.url()) && req.method() === 'PATCH',
    );

    // Open the picker, pick a future time, choose Daily, then save.
    await clickItemAction(page, 'reminder');
    await expect(page.getByTestId('reminder-picker')).toBeVisible();
    await page.getByTestId('reminder-exact-toggle').click();
    await page.getByTestId('reminder-input').fill(localInputValue(5 * 60_000));
    await page.getByTestId('reminder-repeat-daily').click();

    // The preview spells out that a recurring fire reopens the item.
    await expect(page.getByTestId('reminder-preview')).toContainText(
      'repeats daily — reopens when it fires',
    );

    await page.getByTestId('reminder-save').click();
    await expect(page.getByTestId('reminder-picker')).not.toBeVisible();

    // The PATCH payload carries the (remindAt, repeat) pair — repeat with a
    // daily rule and a browser-derived tz, never a client-sent anchor.
    const patchReq = await patch;
    const body = JSON.parse(patchReq.postData() ?? '{}');
    expect(body.remindAt).toBeTruthy();
    expect(body.repeat).toMatchObject({ freq: 'daily', interval: 1 });
    expect(typeof body.repeat.tz).toBe('string');
    expect(body.repeat.anchor).toBeUndefined();

    // The badge switches to the recurring icon (clock ring + arrowhead) once
    // the item updates — one icon per state, so the state is the attribute.
    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);
    await expect(page.getByTestId('reminder-button')).toHaveAttribute(
      'data-reminder-state',
      'repeat',
    );
  });

  test('Mon–Fri repeat sends the full weekday set and reads as "every weekday"', async ({
    page,
  }) => {
    const { project } = await setupProject(page);
    await page.goto(`/${project.slug}`);

    await page.getByTestId('add-item-input').fill('Standup');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('Standup');

    const patch = page.waitForRequest(
      (req) => /\/items\/[^/]+$/.test(req.url()) && req.method() === 'PATCH',
    );

    await clickItemAction(page, 'reminder');
    await expect(page.getByTestId('reminder-picker')).toBeVisible();
    await page.getByTestId('reminder-exact-toggle').click();
    await page.getByTestId('reminder-input').fill(localInputValue(5 * 60_000));
    await page.getByTestId('reminder-repeat-weekdays').click();

    await expect(page.getByTestId('reminder-preview')).toContainText('every weekday');

    await page.getByTestId('reminder-save').click();
    await expect(page.getByTestId('reminder-picker')).not.toBeVisible();

    // The rule pins the fixed Mon–Fri set, not the fire day's single weekday.
    const body = JSON.parse((await patch).postData() ?? '{}');
    expect(body.repeat).toMatchObject({ freq: 'weekly', interval: 1 });
    expect(body.repeat.byWeekday).toEqual(['MO', 'TU', 'WE', 'TH', 'FR']);

    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);
  });

  test('tapping a calendar day + time-of-day chip schedules the reminder', async ({ page }) => {
    const { project } = await setupProject(page);
    await page.goto(`/${project.slug}`);

    await page.getByTestId('add-item-input').fill('Book flights');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('Book flights');

    const patch = page.waitForRequest(
      (req) => /\/items\/[^/]+$/.test(req.url()) && req.method() === 'PATCH',
    );

    await clickItemAction(page, 'reminder');
    await expect(page.getByTestId('reminder-picker')).toBeVisible();

    // Advance to next month (always future, so the cell is never past-disabled)
    // and tap the 15th, then tap the Evening time chip — the no-typing path.
    const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 15);
    const dayId = `reminder-day-${next.getFullYear()}-${pad2(next.getMonth() + 1)}-15`;
    await page.getByTestId('reminder-month-next').click();
    await page.getByTestId(dayId).click();
    await page.getByTestId('reminder-time-evening').click();

    // Preview reflects the chosen instant before saving (locale-agnostic: the
    // day-of-month is always rendered, and the empty-state text is gone).
    await expect(page.getByTestId('reminder-preview')).not.toContainText('No time chosen');
    await expect(page.getByTestId('reminder-preview')).toContainText('15');

    await page.getByTestId('reminder-save').click();
    await expect(page.getByTestId('reminder-picker')).not.toBeVisible();

    // The PATCH carries an 18:00-local remindAt on the 15th and no repeat.
    const body = JSON.parse((await patch).postData() ?? '{}');
    const fired = new Date(body.remindAt);
    expect(fired.getDate()).toBe(15);
    expect(fired.getHours()).toBe(18);
    expect(body.repeat).toBeNull();

    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);
  });

  test('pressing Enter in the time input saves the reminder', async ({ page }) => {
    const { project } = await setupProject(page);
    await page.goto(`/${project.slug}`);

    await page.getByTestId('add-item-input').fill('Water plants');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('Water plants');

    await clickItemAction(page, 'reminder');
    await expect(page.getByTestId('reminder-picker')).toBeVisible();
    await page.getByTestId('reminder-exact-toggle').click();
    await page.getByTestId('reminder-input').fill(localInputValue(5 * 60_000));
    await page.getByTestId('reminder-input').press('Enter');
    await expect(page.getByTestId('reminder-picker')).not.toBeVisible();
    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);
  });

  test('monthly repeat on the 31st warns that short months are skipped', async ({ page }) => {
    const { project } = await setupProject(page);
    await page.goto(`/${project.slug}`);

    await page.getByTestId('add-item-input').fill('Pay rent');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('Pay rent');

    await clickItemAction(page, 'reminder');
    await expect(page.getByTestId('reminder-picker')).toBeVisible();
    await page.getByTestId('reminder-exact-toggle').click();
    // Next year's Jan 31 — deterministic day-of-month, always in the future.
    await page.getByTestId('reminder-input').fill(`${new Date().getFullYear() + 1}-01-31T09:00`);
    await page.getByTestId('reminder-repeat-monthly').click();
    await expect(page.getByTestId('reminder-monthly-hint')).toHaveText(
      'Months without a 31st are skipped',
    );
    // No hint for days every month has.
    await page.getByTestId('reminder-input').fill(`${new Date().getFullYear() + 1}-01-28T09:00`);
    await expect(page.getByTestId('reminder-monthly-hint')).not.toBeVisible();
  });

  test('leaving the Space unsubscribes the browser', async ({ page }) => {
    // Leave as a joined member: the creator is blocked from leaving (409).
    const { project } = await setupJoinedMember(page);
    await page.goto(`/${project.slug}`);

    await page.getByTestId('add-item-input').fill('Cleanup');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('Cleanup');
    await setReminder(page, 5 * 60_000);
    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);

    // Sanity-check that subscribe ran before leaving — otherwise the
    // unsubscribe assertion below is trivially true.
    const subscribeCalls = await page.evaluate(
      () =>
        (window as unknown as { __pushMock: { subscribeCalls: number } }).__pushMock.subscribeCalls,
    );
    expect(subscribeCalls).toBeGreaterThan(0);

    await page.getByTestId('presence-bar').click();
    await expect(page.getByTestId('member-list-panel')).toBeVisible();
    await page.getByTestId('account-toggle-button').click();
    await page.getByTestId('leave-space-button').click();
    await page.getByTestId('confirm-dialog-confirm').click();

    await page.waitForURL('**/');

    // The init script re-runs on the homepage and clobbers window.__pushMock,
    // so we read the counter from localStorage where the pre-navigation mock
    // persisted it.
    const unsubscribeCalls = await page.evaluate(() =>
      parseInt(localStorage.getItem('__pushMockUnsubscribes') ?? '0', 10),
    );
    expect(unsubscribeCalls).toBeGreaterThan(0);
  });

  test('VAPID rotation replaces the existing subscription', async ({ page }) => {
    const { project } = await setupProject(page);
    await page.goto(`/${project.slug}`);

    // First reminder subscribes with KEY_A.
    await page.getByTestId('add-item-input').fill('First');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text')).toHaveText('First');
    await setReminder(page, 5 * 60_000);
    await expect(page.getByTestId('reminder-button')).toHaveClass(/hasReminder/);

    // Rotate the server's VAPID key. Existing subscription stays in the
    // mock, still tagged with KEY_A's bytes.
    await page.unroute('**/api/push/public-key');
    await page.route('**/api/push/public-key', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ key: KEY_B }),
      }),
    );

    // Second reminder triggers ensurePushSubscription again; it detects the
    // key mismatch and re-subscribes.
    await page.getByTestId('add-item-input').fill('Second');
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text').nth(1)).toHaveText('Second');
    await clickItemAction(page, 'reminder', page.getByTestId('list-item').nth(1));
    await expect(page.getByTestId('reminder-picker')).toBeVisible();
    await page.getByTestId('reminder-exact-toggle').click();
    await page.getByTestId('reminder-input').fill(localInputValue(10 * 60_000));
    await page.getByTestId('reminder-save').click();
    await expect(page.getByTestId('reminder-picker')).not.toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __pushMock: { subscribeCalls: number; unsubscribeCalls: number };
              }
            ).__pushMock,
        ),
      )
      .toMatchObject({ subscribeCalls: 2, unsubscribeCalls: 1 });
  });
});
