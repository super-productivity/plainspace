import { test, expect } from '@playwright/test';
import { projectStorageKey, seedIdentity, setupProject } from '../helpers/fixtures';

test('invalid Space slug shows error', async ({ page }) => {
  // Set a fake identity so it doesn't redirect to join
  await page.goto('/');
  await seedIdentity(page, 'nonexistent', 'fake-token', 'fake-id');

  await page.goto('/nonexistent');

  // Should show error state (API returns 404 or 401)
  await expect(
    page
      .locator('text=Failed to load Space')
      .or(page.locator('text=404'))
      .or(page.locator('text=not found')),
  ).toBeVisible({ timeout: 5000 });
});

test('unauthenticated user visiting project is redirected to join page', async ({ page }) => {
  // Create a real project via API
  const { project } = await setupProject(page);

  // Clear the stored identity
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, projectStorageKey(project.slug));

  // Visit the project page with no stored token
  await page.goto(`/${project.slug}`);

  // Should redirect to join page
  await expect(page).toHaveURL(new RegExp(`/${project.slug}/join`), { timeout: 5000 });
  await expect(page.getByTestId('join-display-name-input')).toBeVisible();
});
