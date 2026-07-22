import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';
import { createItemViaApi } from '../helpers/api';

test('long task titles clamp cleanly and keep their complete text available', async ({ page }) => {
  const { project, token } = await setupProject(page);
  const title =
    'Review the complete project plan with everyone before the next coordination meeting. '
      .repeat(5)
      .trim();
  await createItemViaApi(project.slug, token, title);
  await createItemViaApi(project.slug, token, 'Task after the long title');

  await page.goto(`/${project.slug}`);
  const longRow = page.getByTestId('list-item').filter({ hasText: title });
  const nextRow = page.getByTestId('list-item').filter({ hasText: 'Task after the long title' });
  const titleButton = longRow.getByTestId('item-text');
  const titleText = titleButton.locator('span').first();

  await expect(titleButton).toHaveAttribute('title', title);
  const metrics = await titleText.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      lineClamp: style.webkitLineClamp,
      lineHeight: Number.parseFloat(style.lineHeight),
      scrollHeight: element.scrollHeight,
    };
  });
  expect(metrics.lineClamp).toBe('4');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.lineHeight * 4 + 1);

  const longBox = await longRow.boundingBox();
  const nextBox = await nextRow.boundingBox();
  expect(longBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(longBox!.y + longBox!.height).toBeLessThanOrEqual(nextBox!.y + 1);

  const checkbox = longRow.getByTestId('item-checkbox');
  await checkbox.click();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(() => titleText.evaluate((element) => getComputedStyle(element).textDecorationLine))
    .toContain('line-through');
});

test('narrow hover layouts move empty task actions into the overflow menu', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Requires a hover-capable browser context');
  await page.setViewportSize({ width: 320, height: 800 });

  const { project, token } = await setupProject(page);
  const title = 'Review the project plan before the coordination meeting';
  await createItemViaApi(project.slug, token, title);
  await page.goto(`/${project.slug}`);

  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);
  const row = page.getByTestId('list-item').filter({ hasText: title });

  await expect(row.getByTestId('assign-button')).toHaveCSS('display', 'none');
  await expect(row.getByTestId('reminder-button')).toHaveCSS('display', 'none');
  await expect(row.getByTestId('delete-item-button')).toHaveCSS('display', 'none');
  await expect(row.getByTestId('more-actions-button')).toHaveCSS('display', 'flex');
});
