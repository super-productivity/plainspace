import { test, expect } from '@playwright/test';
import { createProjectViaApi, joinProjectViaApi, verifyMemberViaApi } from '../helpers/api';
import { projectStorageKey, seedIdentity, seedPlainspaceEmail } from '../helpers/fixtures';

const API_BASE = `http://localhost:${process.env.E2E_API_PORT ?? '3000'}/api`;

test('verified person opens a Space by email on a clean browser', async ({ page }) => {
  const result = await createProjectViaApi('Recover Space', 'Owner', 'creator@test.local');
  const { project, token } = result;
  await verifyMemberViaApi(project.slug, token, 'creator@test.local');

  // Clean browser: no identity in localStorage. Go to join page.
  await page.goto(`/${project.slug}/join`);

  // Start open-by-email
  await page.getByTestId('recover-link').click();

  // Enter email and request a code
  await page.getByTestId('recover-email-input').fill('creator@test.local');
  await page.getByTestId('recover-email-button').click();

  // Dev code is autofilled into the input
  await expect(page.getByTestId('recover-code-input')).toHaveValue(/^\d{6}$/, { timeout: 5000 });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBeNull();
  await page.getByTestId('recover-verify-button').click();

  // Landed on the project page
  await expect(page).toHaveURL(new RegExp(`/${project.slug}$`));
  await expect(page.getByTestId('project-name')).toHaveText('Recover Space');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBe('creator@test.local');
});

test('recovering into one Space reopens every Space sharing the email', async ({ page }) => {
  const email = `multi-${Date.now()}@test.local`;
  const alpha = await createProjectViaApi('Alpha Space', 'Owner', email);
  await verifyMemberViaApi(alpha.project.slug, alpha.token, email);
  const beta = await createProjectViaApi('Beta Space', 'Owner', email);
  await verifyMemberViaApi(beta.project.slug, beta.token, email);

  // Clean browser: recover into Alpha by email.
  await page.goto(`/${alpha.project.slug}/join`);
  await page.getByTestId('recover-link').click();
  await page.getByTestId('recover-email-input').fill(email);
  await page.getByTestId('recover-email-button').click();
  await expect(page.getByTestId('recover-code-input')).toHaveValue(/^\d{6}$/, { timeout: 5000 });
  await page.getByTestId('recover-verify-button').click();
  await expect(page).toHaveURL(new RegExp(`/${alpha.project.slug}$`));

  // Beta's token was rotated and saved by the same verification, so opening it
  // needs no second recovery.
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), projectStorageKey(beta.project.slug)),
    )
    .not.toBeNull();
  await page.goto(`/${beta.project.slug}`);
  await expect(page.getByTestId('project-name')).toHaveText('Beta Space');
});

test('people panel lists a Space the verified email belongs to without a local token', async ({
  page,
}) => {
  const email = `panel-${Date.now()}@test.local`;
  const home = await createProjectViaApi('Home Space', 'Owner', email);
  await verifyMemberViaApi(home.project.slug, home.token, email);
  const faraway = await createProjectViaApi('Faraway Space', 'Owner', email);
  await verifyMemberViaApi(faraway.project.slug, faraway.token, email);

  // This device only has a local token for Home Space (Faraway was joined
  // elsewhere). The panel should still surface Faraway via the server lookup.
  await page.goto('/');
  await seedIdentity(page, home.project.slug, home.token, home.member.id, 'Home Space');

  await page.goto(`/${home.project.slug}`);
  await expect(page.getByTestId('project-name')).toHaveText('Home Space');
  await page.getByTestId('presence-bar').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();
  await expect(page.getByTestId('panel-space-link')).toContainText(['Faraway Space']);

  // A server-discovered Space (no local token) deep-links into open-by-email so
  // the list is actionable cross-device, not just informational.
  await page.getByTestId('panel-space-link').click();
  await expect(page).toHaveURL(new RegExp(`/${faraway.project.slug}/join`));
  await expect(page.getByTestId('recover-email-input')).toBeVisible();
});

test('a recovery on another device leaves this device signed in (additive sessions)', async ({
  page,
}) => {
  const email = `multi-device-${Date.now()}@test.local`;
  const result = await createProjectViaApi('Shared Space', 'Owner', email);
  const { project, member, token } = result;
  await verifyMemberViaApi(project.slug, token, email);

  // This device holds a session and the saved email.
  await page.goto('/');
  await seedIdentity(page, project.slug, token, member.id, 'Shared Space');
  await seedPlainspaceEmail(page, email);

  // A recovery on another device issues a NEW session (e.g. the owner opening
  // the Space on their phone). Sessions are additive, so this must NOT rotate
  // or invalidate the token this device already holds.
  const reqRes = await fetch(`${API_BASE}/projects/${project.slug}/auth/request-login-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const { devCode } = (await reqRes.json()) as { devCode?: string };
  expect(devCode).toMatch(/^\d{6}$/);
  const verifyRes = await fetch(`${API_BASE}/projects/${project.slug}/auth/verify-login-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: devCode }),
  });
  expect(verifyRes.status).toBe(200);

  // Reopening the Space here stays signed in — no bounce to the recover screen.
  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('project-name')).toHaveText('Shared Space');
  await expect(page).toHaveURL(new RegExp(`/${project.slug}$`));
});

test('my-spaces is self-scoped: 401 unauthenticated, [] for an unverified member', async () => {
  const email = `scoped-${Date.now()}@test.local`;
  const space = await createProjectViaApi('Scoped Space', 'Owner', email);
  await verifyMemberViaApi(space.project.slug, space.token, email);
  const path = `${API_BASE}/projects/${space.project.slug}/auth/my-spaces`;

  // Unauthenticated callers are rejected.
  expect((await fetch(path)).status).toBe(401);

  // An anonymous (unverified) member gets an empty list — no enumeration.
  const guest = await joinProjectViaApi(space.project.slug, 'Guest');
  const guestRes = await fetch(path, { headers: { Authorization: `Bearer ${guest.token}` } });
  expect(guestRes.status).toBe(200);
  expect(((await guestRes.json()) as { spaces: unknown[] }).spaces).toEqual([]);

  // The verified member sees their own Space.
  const ownerRes = await fetch(path, { headers: { Authorization: `Bearer ${space.token}` } });
  const ownerBody = (await ownerRes.json()) as { spaces: { slug: string }[] };
  expect(ownerBody.spaces.map((s) => s.slug)).toContain(space.project.slug);
});

test('unknown email shows generic success message and stays at code step', async ({ page }) => {
  const result = await createProjectViaApi('Quiet Space', 'Owner', 'owner@test.local');
  const { project } = result;

  await page.goto(`/${project.slug}/join`);
  await page.getByTestId('recover-link').click();

  await page.getByTestId('recover-email-input').fill('nobody@test.local');
  await page.getByTestId('recover-email-button').click();

  // Generic message regardless of membership
  await expect(page.getByTestId('recover-verify-form')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBeNull();

  // No dev code was issued, so the field stays empty.
  await expect(page.getByTestId('recover-code-input')).toHaveValue('');
});

test('reused open-by-email code fails', async ({ page, context }) => {
  // Email must be unique per run so per-email rate limits don't bleed
  // between tests.
  const email = `reuse-${Date.now()}@test.local`;
  const result = await createProjectViaApi('Reuse Space', 'Owner', email);
  const { project, token } = result;

  await verifyMemberViaApi(project.slug, token, email);

  // Request login code.
  const reqRes = await fetch(`${API_BASE}/projects/${project.slug}/auth/request-login-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const reqBody = (await reqRes.json()) as { devCode?: string };
  expect(reqBody.devCode).toMatch(/^\d{6}$/);
  const code = reqBody.devCode!;

  // First verify consumes the code.
  const first = await fetch(`${API_BASE}/projects/${project.slug}/auth/verify-login-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  expect(first.status).toBe(200);

  // Reusing the same code must fail with 400.
  const second = await fetch(`${API_BASE}/projects/${project.slug}/auth/verify-login-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  expect(second.status).toBe(400);

  // Sanity: page can still load and show the join/open-by-email entrypoint.
  const page2 = await context.newPage();
  await page2.goto(`/${project.slug}/join`);
  await expect(page2.getByTestId('recover-link')).toBeVisible();
  await page.close();
});

test('second member cannot verify an email already claimed in the Space', async () => {
  const sharedEmail = `shared-${Date.now()}@test.local`;
  const result = await createProjectViaApi('Collision Space', 'Owner', sharedEmail);
  const { project, token } = result;
  await verifyMemberViaApi(project.slug, token, sharedEmail);

  // A second member joins anonymously.
  const joinRes = await fetch(`${API_BASE}/projects/${project.slug}/members/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Second' }),
  });
  const second = (await joinRes.json()) as { token: string };

  // Second member requests a verification code for the same email.
  const reqRes = await fetch(`${API_BASE}/projects/${project.slug}/auth/request-verification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${second.token}`,
    },
    body: JSON.stringify({ email: sharedEmail }),
  });
  const { devCode } = (await reqRes.json()) as { devCode?: string };

  // Verifying must be rejected with 409 so open-by-email's (project, verified email)
  // → member lookup stays unambiguous.
  const verifyRes = await fetch(`${API_BASE}/projects/${project.slug}/auth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${second.token}`,
    },
    body: JSON.stringify({ code: devCode }),
  });
  expect(verifyRes.status).toBe(409);
});
