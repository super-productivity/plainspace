import { test, expect, type Browser } from '@playwright/test';
import { createProjectViaApi, joinProjectViaApi, createItemViaApi } from '../helpers/api';
import { seedIdentity } from '../helpers/fixtures';

async function setupTwoUsers(browser: Browser) {
  const result = await createProjectViaApi('Sync Test', 'Alice');
  const { project, token } = result;

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto('/');
  await seedIdentity(page1, project.slug, token, result.member.id);
  await page1.goto(`/${project.slug}`);
  await expect(page1.getByTestId('project-name')).toHaveText('Sync Test');

  const bob = await joinProjectViaApi(project.slug, 'Bob');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto('/');
  await seedIdentity(page2, project.slug, bob.token, bob.member.id);
  await page2.goto(`/${project.slug}`);
  await expect(page2.getByTestId('project-name')).toHaveText('Sync Test');

  await page1.waitForTimeout(1000);

  return { project, token, page1, page2, ctx1, ctx2, bob };
}

test('two users see item created by other in real-time', async ({ browser }) => {
  const { page1, page2, ctx1, ctx2 } = await setupTwoUsers(browser);

  await page1.getByTestId('add-item-input').fill('Buy groceries');
  await page1.getByTestId('add-item-input').press('Enter');

  await expect(page2.getByTestId('item-text')).toHaveText('Buy groceries', { timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
});

test('two users see item checked by other in real-time', async ({ browser }) => {
  const { project, token, page1, page2, ctx1, ctx2 } = await setupTwoUsers(browser);

  await createItemViaApi(project.slug, token, 'Check me');

  await page1.reload();
  await page2.reload();
  await page1.waitForTimeout(1000);

  await expect(page1.getByTestId('item-text')).toHaveText('Check me');
  await expect(page2.getByTestId('item-text')).toHaveText('Check me');

  await page1.getByTestId('item-checkbox').click();
  await expect(page1.getByTestId('done-toggle')).toBeVisible();
  await page1.getByTestId('done-toggle').click();
  await expect(page1.getByTestId('item-checkbox')).toHaveAttribute('aria-checked', 'true');

  await expect(page2.getByTestId('done-toggle')).toBeVisible({ timeout: 5000 });
  await page2.getByTestId('done-toggle').click();
  await expect(page2.getByTestId('item-checkbox')).toHaveAttribute('aria-checked', 'true', {
    timeout: 5000,
  });

  await ctx1.close();
  await ctx2.close();
});

test('two users see item deleted by other in real-time', async ({ browser }) => {
  const { project, token, page1, page2, ctx1, ctx2 } = await setupTwoUsers(browser);

  await createItemViaApi(project.slug, token, 'Delete me');

  await page1.reload();
  await page2.reload();
  await page1.waitForTimeout(1000);

  await expect(page1.getByTestId('item-text')).toHaveText('Delete me');
  await expect(page2.getByTestId('item-text')).toHaveText('Delete me');

  await page1.getByTestId('delete-item-button').click();

  await expect(page2.getByTestId('list-item')).not.toBeVisible({ timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
});

test('two users see scratchpad editing indicator in real-time', async ({ browser }) => {
  const { page1, page2, ctx1, ctx2 } = await setupTwoUsers(browser);

  await page1.getByTestId('scratchpad-content').click();

  await expect(page2.getByTestId('scratchpad-editing-indicator')).toBeVisible({ timeout: 5000 });
  await expect(page2.getByTestId('scratchpad-editor-initial')).toHaveText('A');

  await page1.getByTestId('scratchpad-textarea').blur();
  await expect(page2.getByTestId('scratchpad-editing-indicator')).toBeHidden({ timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
});
