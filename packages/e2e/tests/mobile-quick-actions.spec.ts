import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';

// The floating quick-actions pill only shows below 760px, so force a phone
// viewport regardless of the Playwright project this runs under.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('quick "Task" action expands the list when it is collapsed', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  const card = page.getByTestId('list-card');
  await expect(card).toBeVisible();

  // Fold the list via its header chevron.
  const toggle = card.getByTestId('panel-collapse');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Tapping the pill re-expands the card and focuses the add-item input.
  await page.getByTestId('quick-add-task').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('add-item-input')).toBeFocused();
});

test('quick "Scratchpad" action expands the scratchpad when it is collapsed', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  const card = page.getByTestId('scratchpad-card');
  await expect(card).toBeVisible();

  const toggle = card.getByTestId('panel-collapse');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Tapping the pill re-expands the card and drops into the editable textarea.
  await page.getByTestId('quick-edit-scratchpad').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByTestId('scratchpad-textarea')).toBeVisible();
});
