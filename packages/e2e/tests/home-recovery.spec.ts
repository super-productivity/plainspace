import { test, expect } from '@playwright/test';
import { apiRequest, createProjectViaApi, verifyMemberViaApi } from '../helpers/api';
import { projectStorageKey, seedIdentity, seedPlainspaceEmail } from '../helpers/fixtures';

// A freshly installed PWA / clean browser has no identity in localStorage, so
// Home shows no "Your Spaces" list. Pasting the Space link must still get the
// user to the Space (where they re-join or open by email).
test('open an existing Space from Home by pasting its link', async ({ page }) => {
  const { project } = await createProjectViaApi('Pasted Space', 'Owner');

  await page.goto('/');

  await expect(page.getByTestId('onboarding-choice')).toBeVisible();
  await expect(page.getByTestId('show-login-button')).toHaveText('Find my Spaces');
  await expect(page.getByTestId('show-create-button')).toHaveText('Create a Space');
  await page.getByTestId('show-open-button').click();

  await page.getByTestId('space-link-input').fill(`/${project.slug}`);
  await page.getByTestId('open-space-button').click();

  // No identity yet, so the Space redirects to its join/open-by-email entrypoint.
  await expect(page).toHaveURL(new RegExp(`/${project.slug}/join$`));
});

// "Find my Spaces" emails the address owner the list of Spaces. In
// dev the server echoes the matches back, which the UI renders as links.
test('find my Spaces by email lists the verified Space', async ({ page }) => {
  const email = `finder-${Date.now()}@test.local`;
  const { project, token } = await createProjectViaApi('Findable Space', 'Owner', email);
  await verifyMemberViaApi(project.slug, token, email);

  await page.goto('/');
  await page.getByTestId('show-login-button').click();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });

  await expect(page.getByText('Enter an email you added to a Space.')).toBeVisible();
  await expect(page.getByTestId('find-email-button')).toHaveText('Send Space links');
  await page.getByTestId('find-email-input').fill(email);
  const sendButton = page.getByTestId('find-email-button');
  await sendButton.click();

  // The dev echo surfaces the Space as a link back into it.
  const spaceLink = page.locator(`a[href="/${project.slug}"]`);
  await expect(spaceLink).toBeVisible({ timeout: 5000 });
  await expect(spaceLink).toContainText('Findable Space');
  // Typing an email into Find my Spaces is not proof of inbox ownership.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBeNull();

  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toHaveText('Send again in 30s');

  await page.clock.runFor(29_000);
  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toHaveText('Send again in 1s');

  await page.clock.runFor(1_000);
  await expect(sendButton).toBeEnabled();
  await expect(sendButton).toHaveText('Send Space links');
});

// The emailed "Find my Spaces" links are one-click sign-ins: opening
// /{slug}#login=<code>.<email> redeems the single-use code for a fresh token,
// no typing. The fragment is stripped once consumed.
test('opening a magic recovery link signs the owner in', async ({ page }) => {
  const email = `magic-${Date.now()}@test.local`;
  const { project, token } = await createProjectViaApi('Magic Space', 'Owner', email);
  await verifyMemberViaApi(project.slug, token, email);

  // The dev echo returns the single-use code so we can build the magic link.
  const { devSpaces } = await apiRequest<{
    devSpaces?: { slug: string; name: string; code?: string }[];
  }>('/auth/find-spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const match = devSpaces?.find((s) => s.slug === project.slug);
  expect(match?.code).toBeTruthy();

  const emailB64 = Buffer.from(email, 'utf8').toString('base64url');
  await page.goto(`/${project.slug}#login=${match!.code}.${emailB64}`);

  // Signed straight into the Space — no join/recover redirect.
  await expect(page.getByTestId('project-name')).toHaveText('Magic Space');
  await expect(page).toHaveURL(new RegExp(`/${project.slug}$`));

  // A token is now stored for the slug, and the secret was stripped from the URL.
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.token,
        projectStorageKey(project.slug),
      ),
    )
    .toBeTruthy();
  expect(await page.evaluate(() => window.location.hash)).toBe('');
});

// A stored identity whose Space has since been deleted (or whose token was
// revoked) 404s/401s on load and gets cleared. Emptying the "Your Spaces" list
// must not strand the visitor on a bare hero with only the optional Install
// button — it falls back to the first-visit onboarding choices.
test('clearing the last dead Space falls back to onboarding, not a dead end', async ({ page }) => {
  await page.goto('/');
  await seedIdentity(page, 'ghostspace', 'revoked-token', 'gone', 'Ghost Space');
  await page.reload();

  await expect(page.getByTestId('onboarding-choice')).toBeVisible();
  await expect(page.getByTestId('show-create-button')).toBeVisible();
  await expect(page.getByTestId('show-login-button')).toBeVisible();
});

test('saved email prefills the find form', async ({ page }) => {
  const email = `remembered-${Date.now()}@test.local`;
  await page.goto('/');
  await seedPlainspaceEmail(page, email);
  await page.reload();

  await page.getByTestId('show-login-button').click();
  await expect(page.getByTestId('find-email-input')).toHaveValue(email);
});

test('web app root reopens the last Space and people panel links back to overview', async ({
  page,
}) => {
  const first = await createProjectViaApi('First Space', 'Owner One');
  const second = await createProjectViaApi('Second Space', 'Owner Two');

  await page.goto('/');
  await seedIdentity(page, first.project.slug, first.token, first.member.id, 'First Space');
  await seedIdentity(page, second.project.slug, second.token, second.member.id, 'Second Space');

  await page.goto(`/${first.project.slug}`);
  await expect(page.getByTestId('project-name')).toHaveText('First Space');

  // The People panel keeps account and Space-switching actions tucked away
  // until they are needed.
  await page.getByTestId('presence-bar').click();
  await expect(page.getByTestId('member-list-panel')).toBeVisible();
  await page.getByTestId('account-toggle-button').click();
  // Other known Spaces are listed for quick switching.
  await expect(page.getByTestId('panel-space-link')).toContainText(['Second Space']);
  await page.getByTestId('panel-space-link').click();
  await expect(page).toHaveURL(new RegExp(`/${second.project.slug}$`));
  await expect(page.getByTestId('project-name')).toHaveText('Second Space');

  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/${second.project.slug}$`));
  await expect(page.getByTestId('project-name')).toHaveText('Second Space');

  await page.getByTestId('presence-bar').click();
  await page.getByTestId('account-toggle-button').click();
  await page.getByTestId('spaces-overview-link').click();
  await expect(page).toHaveURL('/spaces');
  await expect(page.getByTestId('known-spaces')).toBeVisible();
  await expect(page.getByTestId('known-space-link')).toContainText(['First Space', 'Second Space']);
});
