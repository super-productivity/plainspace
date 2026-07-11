import { test, expect } from '@playwright/test';
import { createProjectViaApi, verifyMemberViaApi } from '../helpers/api';
import { seedIdentity, seedPlainspaceEmail } from '../helpers/fixtures';

// Once a browser holds a verified token for one Space, that token proves email
// control, so creating or joining further Spaces with the same email must not
// ask for a code again — the "global account" experience. The proof token is an
// ordinary per-Space member token (no new credential), so we seed a genuinely
// verified Space and point the witness key at it.
async function seedVerifiedWitness(page: import('@playwright/test').Page, email: string) {
  const home = await createProjectViaApi('Home Space', 'Owner', email);
  await verifyMemberViaApi(home.project.slug, home.token, email);

  await page.goto('/');
  await seedIdentity(page, home.project.slug, home.token, home.member.id, 'Home Space');
  await seedPlainspaceEmail(page, email);
  await page.evaluate(
    (slug) => localStorage.setItem('spaces:verifiedWitness', slug),
    home.project.slug,
  );
  return home;
}

test('create a second Space without re-entering a code', async ({ page }) => {
  const email = `global-create-${Date.now()}@test.local`;
  await seedVerifiedWitness(page, email);

  // Overview → create. The email is prefilled from the verified account.
  await page.goto('/spaces');
  await page.getByTestId('show-create-button').click();
  await expect(page.getByTestId('email-input')).toHaveValue(email);

  await page.getByTestId('project-name-input').fill('Second Space');
  await page.getByTestId('display-name-input').fill('Owner');
  await page.getByTestId('create-project-button').click();

  // No verify step — straight into the new Space.
  await expect(page.getByTestId('verify-code-input')).toHaveCount(0);
  await expect(page.getByTestId('project-name')).toHaveText('Second Space');
});

test('add your email to a joined Space in one click', async ({ page }) => {
  const email = `global-join-${Date.now()}@test.local`;
  await seedVerifiedWitness(page, email);

  // A brand-new Space the browser has no identity in yet.
  const second = await createProjectViaApi('Shared Space', 'Owner');
  await page.goto(`/${second.project.slug}`);
  await expect(page).toHaveURL(new RegExp(`/${second.project.slug}/join`));
  await page.getByTestId('join-display-name-input').fill('Guest');
  await page.getByTestId('join-button').click();

  await expect(page).toHaveURL(new RegExp(`/${second.project.slug}$`));
  await page.getByTestId('email-connection-button').click();

  // One-click connect using the proof token — no code form.
  const quick = page.getByTestId('email-quick-connect-button');
  await expect(quick).toContainText(email);
  await quick.click();

  // Email is now connected: the prompt to add one is gone.
  await expect(page.getByTestId('email-connection-banner')).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBe(email);
});
