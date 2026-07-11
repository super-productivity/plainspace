import { test, expect } from '@playwright/test';
import { createProjectViaApi, joinProjectViaApi, verifyMemberViaApi } from '../helpers/api';
import {
  seedIdentity,
  seedPlainspaceEmail,
  setupJoinedMember,
  setupProject,
} from '../helpers/fixtures';

test('join a project via link', async ({ page }) => {
  // Create project via API
  const result = await createProjectViaApi('Trip Planning', 'Alice');
  const slug = result.project.slug;

  // Visit the project link (no identity stored yet)
  await page.goto(`/${slug}`);

  // Should redirect to join page
  await expect(page).toHaveURL(new RegExp(`/${slug}/join`));

  // Fill in name and join
  await page.getByTestId('join-display-name-input').fill('Bob');
  await page.getByTestId('join-button').click();

  // Should enter the Space immediately; email is prompted in context.
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await expect(page.getByTestId('project-name')).toHaveText('Trip Planning');
  await expect(page.getByTestId('email-connection-banner')).toContainText(
    'This browser can open this Space.',
  );

  await page.getByTestId('email-connection-button').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();
  await expect(page.getByTestId('email-verify-section')).toBeVisible();
  await expect(page.getByTestId('device-link-section')).not.toBeVisible();

  await page.getByTestId('advanced-toggle-button').click();
  await expect(page.getByTestId('device-link-section')).toBeVisible();
});

test('add an email from the in-Space prompt', async ({ page }) => {
  const bobEmail = `bob-${Date.now()}@test.local`;
  const result = await createProjectViaApi('Trip Planning', 'Alice');
  const slug = result.project.slug;

  await page.goto(`/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/${slug}/join`));

  await page.getByTestId('join-display-name-input').fill('Bob');
  await page.getByTestId('join-button').click();

  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await page.getByTestId('email-connection-button').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();

  // Request a verification code for an email.
  await page.getByTestId('email-verify-email-input').fill(bobEmail);
  await page.getByTestId('email-verify-send-button').click();

  // Dev mode autofills the code; confirm and land on the project.
  await expect(page.getByTestId('email-verify-code-input')).toHaveValue(/^\d{6}$/, {
    timeout: 5000,
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBeNull();
  await page.getByTestId('email-verify-confirm-button').click();

  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await expect(page.getByTestId('project-name')).toHaveText('Trip Planning');
  await expect(page.getByTestId('email-connection-banner')).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBe(bobEmail);
});

test('saved email prefills join and in-Space email forms', async ({ page }) => {
  const savedEmail = `saved-${Date.now()}@test.local`;
  await page.addInitScript((email) => {
    window.localStorage.setItem('spaces:plainspaceEmail', email);
  }, savedEmail);

  const result = await createProjectViaApi('Prefill Space', 'Alice');
  const slug = result.project.slug;

  await page.goto(`/${slug}/join`);
  await page.getByTestId('recover-link').click();
  await expect(page.getByTestId('recover-email-input')).toHaveValue(savedEmail);

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('join-display-name-input').fill('Bob');
  await page.getByTestId('join-button').click();

  await page.getByTestId('email-connection-button').click();
  await expect(page.getByTestId('email-verify-email-input')).toHaveValue(savedEmail);
  await expect(page.getByTestId('forget-plainspace-email-button')).toBeVisible();

  await page.getByTestId('forget-plainspace-email-button').click();
  await expect(page.getByTestId('email-verify-email-input')).toHaveValue('');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBeNull();
});

test('advanced API token state survives hiding and showing Advanced', async ({ page }) => {
  const email = `token-admin-${Date.now()}@test.local`;
  const { project, member, token } = await createProjectViaApi('Token Space', 'Alice', email);
  await verifyMemberViaApi(project.slug, token, email);

  await page.goto('/');
  await seedIdentity(page, project.slug, token, member.id);

  await page.goto(`/${project.slug}`);
  await page.getByTestId('presence-bar').click();
  await expect(page.getByTestId('api-tokens-section')).not.toBeVisible();

  await page.getByTestId('advanced-toggle-button').click();
  await expect(page.getByTestId('api-tokens-section')).toBeVisible();
  await page.getByTestId('generate-token-button').click();
  await expect(page.getByTestId('new-token-banner')).toBeVisible();
  const tokenValue = await page.getByTestId('token-value').innerText();

  await page.getByTestId('advanced-toggle-button').click();
  await expect(page.getByTestId('api-tokens-section')).not.toBeVisible();
  await page.getByTestId('advanced-toggle-button').click();
  await expect(page.getByTestId('token-value')).toHaveText(tokenValue);
});

test('Space link button copies the join link and explains access', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          window.localStorage.setItem('__testClipboard', text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
  });

  const { project } = await setupProject(page, 'Trip Planning');

  await page.goto(`/${project.slug}`);
  const origin = await page.evaluate(() => window.location.origin);
  await page.getByTestId('space-link-button').click();

  await expect(page.getByTestId('toast')).toContainText(
    'Join link copied. Anyone with this link can join this Space.',
  );
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('__testClipboard')))
    .toBe(`${origin}/${project.slug}/join`);
});

test('member panel keeps Tab focus trapped while Advanced is collapsed', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await page.getByTestId('presence-bar').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();

  // Advanced is collapsed by default, so its DeviceLink/ApiTokens controls sit
  // in a display:none subtree. The Advanced toggle is the last *visible*
  // focusable; tabbing off it must wrap back into the dialog rather than escape
  // to the page behind the modal (regression guard for the focus trap counting
  // hidden, unfocusable controls as the wrap anchor).
  await page.getByTestId('advanced-toggle-button').focus();
  await page.keyboard.press('Tab');

  const focusInsidePanel = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="member-list-panel"]');
    return !!panel && !!document.activeElement && panel.contains(document.activeElement);
  });
  expect(focusInsidePanel).toBe(true);
});

test('leaving your last Space clears the device-wide saved email', async ({ page }) => {
  const savedEmail = `leaver-${Date.now()}@test.local`;
  const { project } = await setupJoinedMember(page);
  // Set the saved email via the live page (not addInitScript) so the post-leave
  // navigation to '/' doesn't re-seed it.
  await seedPlainspaceEmail(page, savedEmail);

  await page.goto(`/${project.slug}`);
  await page.getByTestId('presence-bar').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();
  await expect(page.getByTestId('forget-plainspace-email-button')).toBeVisible();

  await page.getByTestId('leave-space-button').click();
  await page.getByTestId('confirm-dialog-confirm').click();

  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBeNull();
});

test('signing out revokes this browser session without leaving the Space', async ({ page }) => {
  const { project, token } = await setupProject(page, 'Session Space');

  await page.goto(`/${project.slug}`);
  await page.getByTestId('presence-bar').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();
  await page.getByTestId('sign-out-button').click();

  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() =>
      page.evaluate((slug) => localStorage.getItem(`spaces:projects:${slug}`), project.slug),
    )
    .toBeNull();

  const rejected = await page.request.get(
    `http://localhost:${process.env.E2E_API_PORT ?? '3000'}/api/projects/${project.slug}/auth/terms-status`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(rejected.status()).toBe(401);
});

test('leaving one of several Spaces keeps the saved email', async ({ page }) => {
  const savedEmail = `multi-${Date.now()}@test.local`;
  const spaceA = await createProjectViaApi('Space A', 'Alice');
  const bobA = await joinProjectViaApi(spaceA.project.slug, 'Bob');
  const spaceB = await createProjectViaApi('Space B', 'Carol');
  const bobB = await joinProjectViaApi(spaceB.project.slug, 'Bob');

  await page.goto('/');
  await seedIdentity(page, spaceA.project.slug, bobA.token, bobA.member.id);
  await seedIdentity(page, spaceB.project.slug, bobB.token, bobB.member.id);
  await seedPlainspaceEmail(page, savedEmail);

  await page.goto(`/${spaceA.project.slug}`);
  await page.getByTestId('presence-bar').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();

  await page.getByTestId('leave-space-button').click();
  await page.getByTestId('confirm-dialog-confirm').click();

  // Still a member of Space B, so the device-wide email stays for its forms.
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBe(savedEmail);
});
