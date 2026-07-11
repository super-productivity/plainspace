import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';
import { createItemViaApi } from '../helpers/api';

test('nudge button shows formatted summary', async ({ page }) => {
  const { project, token } = await setupProject(page);
  await createItemViaApi(project.slug, token, 'Book flights');

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('project-name')).toBeVisible();

  await expect(page.getByTestId('project-header').getByTestId('nudge-button')).toHaveCount(0);
  await expect(page.getByTestId('activity-feed')).toBeVisible();
  await page.getByTestId('activity-feed').getByTestId('nudge-button').click();

  await expect(page.getByTestId('nudge-modal')).toBeVisible();
  await expect(page.getByTestId('nudge-text')).toContainText('Book flights');
  await expect(page.getByTestId('nudge-text')).toContainText(project.slug);
});
