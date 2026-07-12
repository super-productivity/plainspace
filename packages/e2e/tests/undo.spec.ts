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
  // A fresh Space also shows the "first share" nudge toast, so target the
  // delete toast specifically rather than any toast.
  const undoToast = page.getByTestId('toast').filter({ hasText: 'deleted' });
  await expect(undoToast).toBeVisible();

  await undoToast.getByTestId('toast-action').click();

  await expect(page.getByTestId('item-text')).toHaveText('Undo me', { timeout: 5000 });
});
