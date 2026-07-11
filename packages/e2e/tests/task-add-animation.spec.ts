import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';
import { createItemViaApi } from '../helpers/api';

test('item present at load is not marked as entering; item added later is', async ({ page }) => {
  const { project, token } = await setupProject(page);

  // Seed one item BEFORE navigating so it is present at ListCard mount.
  await createItemViaApi(project.slug, token, 'Pre-existing task');

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('list-card')).toBeVisible();

  const preExisting = page.getByTestId('list-item').filter({ hasText: 'Pre-existing task' });
  await expect(preExisting).toBeVisible();
  // Pre-existing items must NOT be flagged as entering.
  await expect(preExisting).not.toHaveAttribute('data-animate-in', /.*/);

  // Add a new item via the UI.
  await page.getByTestId('add-item-input').fill('Freshly added task');
  await page.getByTestId('add-item-input').press('Enter');

  const added = page.getByTestId('list-item').filter({ hasText: 'Freshly added task' });
  await expect(added).toBeVisible({ timeout: 5000 });
  // Newly added item IS flagged as entering (stable attribute).
  await expect(added).toHaveAttribute('data-animate-in', 'true');

  // The pre-existing row must remain unmarked after a new item is added
  // (guards against <For> reconciliation marking every visible row).
  await expect(preExisting).not.toHaveAttribute('data-animate-in', /.*/);
});

test('assignee changes do not mark an existing task as entering again', async ({ page }) => {
  const { project, member } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('list-card')).toBeVisible();

  await page.getByTestId('add-item-input').fill('Assign without replay');
  await page.getByTestId('add-item-input').press('Enter');

  const added = page.getByTestId('list-item').filter({ hasText: 'Assign without replay' });
  await expect(added).toBeVisible({ timeout: 5000 });
  await expect(added).toHaveAttribute('data-animate-in', 'true');

  await added.getByTestId('assign-button').click();
  await page.getByTestId(`assign-option-${member.id}`).click();

  await expect(added.getByTestId('assign-button')).toHaveAttribute(
    'aria-label',
    /currently Alice/,
    { timeout: 5000 },
  );
  await expect(added).not.toHaveAttribute('data-animate-in', /.*/);
});
