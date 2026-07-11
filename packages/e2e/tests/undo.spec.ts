import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';

test('undo restores a deleted item', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);

  await page.getByTestId('add-item-input').fill('Undo me');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Undo me');

  await page.getByTestId('delete-item-button').click();

  await expect(page.getByTestId('list-item')).not.toBeVisible();
  await expect(page.getByTestId('toast')).toBeVisible();

  await page.getByTestId('toast-action').click();

  await expect(page.getByTestId('item-text')).toHaveText('Undo me', { timeout: 5000 });
});
