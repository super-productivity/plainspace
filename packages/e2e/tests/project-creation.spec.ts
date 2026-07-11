import { test, expect } from '@playwright/test';

test('create a project and land on the project page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('onboarding-choice')).toBeVisible();
  await page.getByTestId('show-create-button').click();

  const email = `johannes-${Date.now()}@test.local`;
  await page.getByTestId('project-name-input').fill('Summer Trip');
  await page.getByTestId('display-name-input').fill('Johannes');
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('create-project-button').click();

  // Server runs in dev mode, so the verification step auto-fills the dev code.
  await expect(page.getByTestId('verify-code-input')).toHaveValue(/^\d{6}$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBeNull();
  await page.getByTestId('verify-code-button').click();

  await expect(page).not.toHaveURL('/');
  await expect(page.getByTestId('project-name')).toHaveText('Summer Trip');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spaces:plainspaceEmail')))
    .toBe(email);
});
