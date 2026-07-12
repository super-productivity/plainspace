import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';

test('add and check an item', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('list-card')).toBeVisible();

  await page.getByTestId('add-item-input').fill('Book flights');
  await page.getByTestId('add-item-input').press('Enter');

  await expect(page.getByTestId('item-text')).toHaveText('Book flights', { timeout: 5000 });

  await page.getByTestId('item-checkbox').click();

  await expect(page.getByTestId('done-toggle')).toContainText(/Done.*1/);
  await page.getByTestId('done-toggle').click();

  const doneSection = page.getByTestId('done-section');
  await expect(doneSection.getByTestId('item-text')).toHaveText('Book flights');
  await expect(doneSection.getByTestId('item-checkbox')).toHaveAttribute('aria-checked', 'true');
});

test('collapse folds the main list via the header chevron and persists across reload', async ({
  page,
}) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  const card = page.getByTestId('list-card');
  await expect(card).toBeVisible();

  await page.getByTestId('add-item-input').fill('Book flights');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(card.getByTestId('item-text')).toHaveText('Book flights', { timeout: 5000 });

  // The hero list folds on one tap like every other card. aria-expanded reflects
  // the state, and a count appears next to the title when folded.
  const toggle = card.getByTestId('panel-collapse');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('· 1');

  // The preference is per-device (localStorage), so it survives a reload.
  await page.reload();
  const reToggle = page.getByTestId('list-card').getByTestId('panel-collapse');
  await expect(reToggle).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 });
});

test('uncheck a checked item', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);

  await page.getByTestId('add-item-input').fill('Toggle me');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Toggle me');
  await page.getByTestId('item-checkbox').click();
  await expect(page.getByTestId('done-toggle')).toContainText(/Done.*1/);
  await page.getByTestId('done-toggle').click();

  const doneSection = page.getByTestId('done-section');
  await expect(doneSection.getByTestId('item-checkbox')).toHaveAttribute('aria-checked', 'true');
  await doneSection.getByTestId('item-checkbox').click();

  await expect(page.getByTestId('done-section')).not.toBeVisible();
  await expect(page.getByTestId('item-text')).toHaveText('Toggle me');
  await expect(page.getByTestId('item-checkbox')).toHaveAttribute('aria-checked', 'false');
});

test('edit item text via double-click', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);

  await page.getByTestId('add-item-input').fill('Original text');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Original text');

  await page.getByTestId('item-text').dblclick();

  await expect(page.getByTestId('item-edit-input')).toBeVisible();
  await page.getByTestId('item-edit-input').fill('Updated text');
  await page.getByTestId('item-edit-input').press('Enter');

  await expect(page.getByTestId('item-text')).toHaveText('Updated text');
});

test('assign item to self and unassign', async ({ page }) => {
  const { project, member } = await setupProject(page);

  await page.goto(`/${project.slug}`);

  await page.getByTestId('add-item-input').fill('Assign me');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Assign me');

  // The assign button opens a picker; choose self.
  await page.getByTestId('assign-button').click();
  await page.getByTestId(`assign-option-${member.id}`).click();
  await expect(page.getByTestId('assign-button')).toHaveAttribute('aria-label', /currently Alice/, {
    timeout: 3000,
  });

  // Reopen the picker and unassign.
  await page.getByTestId('assign-button').click();
  await page.getByTestId('unassign-option').click();
  // Match the unassigned state by prefix, not exact copy: the assigned label is
  // "Change assignee (currently …)", so /^Assign / proves we returned to
  // unassigned without re-breaking when the button's wording is tweaked.
  await expect(page.getByTestId('assign-button')).toHaveAttribute('aria-label', /^Assign /, {
    timeout: 3000,
  });
});

test('delete an item shows undo toast', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);

  await page.getByTestId('add-item-input').fill('Test item');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Test item');

  await page.getByTestId('delete-item-button').click();

  // A fresh Space also shows the "first share" nudge toast, so target the
  // delete toast specifically rather than any toast.
  await expect(page.getByTestId('toast').filter({ hasText: 'deleted' })).toBeVisible();
  await expect(page.getByTestId('list-item')).not.toBeVisible();
});
