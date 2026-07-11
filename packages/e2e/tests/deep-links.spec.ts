import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';
import { createItemViaApi } from '../helpers/api';

test('deep link to item scrolls and highlights', async ({ page }) => {
  const { project, token } = await setupProject(page);
  const itemResult = await createItemViaApi(project.slug, token, 'Target item');

  await page.goto(`/${project.slug}/item/${itemResult.item.id}`);

  await expect(page.getByTestId('item-text')).toHaveText('Target item');
  await expect(page.locator(`[data-item-id="${itemResult.item.id}"]`)).toBeVisible();
});
