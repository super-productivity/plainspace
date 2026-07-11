import { test, expect } from '@playwright/test';
import { createProjectViaApi, joinProjectViaApi } from '../helpers/api';
import { seedIdentity } from '../helpers/fixtures';

test('presence bar shows online members', async ({ browser }) => {
  const result = await createProjectViaApi('Presence Test', 'Alice');
  const { project, token } = result;

  // User 1 (Alice)
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto('/');
  await seedIdentity(page1, project.slug, token, result.member.id);
  await page1.goto(`/${project.slug}`);
  await expect(page1.getByTestId('project-name')).toHaveText('Presence Test');

  // User 2 (Bob) joins
  const bob = await joinProjectViaApi(project.slug, 'Bob');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto('/');
  await seedIdentity(page2, project.slug, bob.token, bob.member.id);
  await page2.goto(`/${project.slug}`);
  // Wait for page2 to fully load (SSE connection established)
  await expect(page2.getByTestId('project-name')).toHaveText('Presence Test');

  // Both pages should show presence. The presence bar renders every member as
  // an avatar and marks the connected ones with data-online; check page2 since
  // it connects after page1 and so receives presence for both.
  await expect(page2.getByTestId('presence-bar')).toBeVisible({ timeout: 15000 });
  await expect(page2.getByTestId('presence-bar').locator('[data-online="true"]')).toHaveCount(2, {
    timeout: 15000,
  });

  await ctx1.close();
  await ctx2.close();
});

test('member disappears from presence when disconnected', async ({ browser }) => {
  const result = await createProjectViaApi('Disconnect Test', 'Alice');
  const { project, token } = result;

  // User 1 (Alice)
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto('/');
  await seedIdentity(page1, project.slug, token, result.member.id);
  await page1.goto(`/${project.slug}`);
  await expect(page1.getByTestId('project-name')).toBeVisible();

  // User 2 (Bob) joins
  const bob = await joinProjectViaApi(project.slug, 'Bob');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto('/');
  await seedIdentity(page2, project.slug, bob.token, bob.member.id);
  await page2.goto(`/${project.slug}`);
  await expect(page2.getByTestId('project-name')).toBeVisible();

  // Wait for both to appear online - check on page2 (it connects after page1)
  await expect(page2.getByTestId('presence-bar').locator('[data-online="true"]')).toHaveCount(2, {
    timeout: 15000,
  });

  // Bob disconnects (close his browser context)
  await ctx2.close();

  // Alice should see Bob go offline in the presence bar (1 online avatar left)
  await expect(page1.getByTestId('presence-bar').locator('[data-online="true"]')).toHaveCount(1, {
    timeout: 15000,
  });

  await ctx1.close();
});
