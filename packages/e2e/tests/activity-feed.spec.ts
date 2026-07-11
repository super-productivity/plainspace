import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';

test('activity feed shows item creation', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('list-card')).toBeVisible();

  await page.getByTestId('add-item-input').fill('Test activity');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Test activity');

  await expect(page.getByTestId('activity-feed')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('activity-entry').first()).toContainText('Test activity');
});

test('activity feed shows item checked', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);

  await page.getByTestId('add-item-input').fill('Check me');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Check me');
  await page.getByTestId('item-checkbox').click();

  await expect(page.getByTestId('activity-feed')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('activity-entry').first()).toContainText('completed');
});

test('consecutive same-actor events show the avatar only once', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('list-card')).toBeVisible();

  // A burst of items by the same member — the "who" never changes between rows.
  // Wait for each row to land before adding the next: the input drops an Enter
  // pressed while a create is still in flight, which would silently lose an item.
  for (const text of ['First trip idea', 'Second trip idea', 'Third trip idea']) {
    await page.getByTestId('add-item-input').fill(text);
    await page.getByTestId('add-item-input').press('Enter');
    await expect(page.getByTestId('item-text').filter({ hasText: text })).toBeVisible();
  }

  const feed = page.getByTestId('activity-feed');
  await expect(feed).toBeVisible({ timeout: 5000 });
  await expect(
    feed.getByTestId('activity-entry').filter({ hasText: 'Third trip idea' }),
  ).toBeVisible({ timeout: 5000 });

  // Every visible row is by the same actor, so the run collapses to one avatar
  // even though each event keeps its own row (and timestamp).
  const rows = feed.getByTestId('activity-row');
  const avatars = feed.getByTestId('activity-avatar');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(3);
  await expect(avatars).toHaveCount(1);
});

test('activity bar shows scratchpad edits as latest activity', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('scratchpad-card')).toBeVisible();

  await page.getByTestId('scratchpad-content').click();
  await page.getByTestId('scratchpad-textarea').fill('Latest shared note');
  await page.getByTestId('scratchpad-textarea').blur();

  await expect(page.getByTestId('activity-feed').first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('activity-entry').first()).toContainText('scratchpad', {
    timeout: 5000,
  });
});

test('collapse folds the scratchpad via the header chevron and persists across reload', async ({
  page,
}) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  const card = page.getByTestId('scratchpad-card');
  await expect(card).toBeVisible();

  // The scratchpad folds on one tap like every other card. The content stays
  // mounted but is clipped away, so aria-expanded is the reliable signal.
  const toggle = card.getByTestId('panel-collapse');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // The preference is per-device (localStorage), so it survives a reload.
  await page.reload();
  const reToggle = page.getByTestId('scratchpad-card').getByTestId('panel-collapse');
  await expect(reToggle).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 });
});

test('scratchpad read-only content is aligned to the top', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('scratchpad-card')).toBeVisible();

  await page.getByTestId('scratchpad-content').click();
  await page.getByTestId('scratchpad-textarea').fill('Top aligned note');
  await page.getByTestId('scratchpad-textarea').blur();

  const display = page.getByTestId('scratchpad-content');
  await expect(display).toHaveText('Top aligned note');

  const topOffset = await display.evaluate((element) => {
    const range = document.createRange();
    const textNode = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode) throw new Error('Scratchpad display has no text node');
    range.selectNodeContents(textNode);
    const textTop = range.getBoundingClientRect().top;
    range.detach();
    return textTop - element.getBoundingClientRect().top;
  });

  // Guards top alignment (a centered or bottom-anchored layout puts the text
  // far below the container top). The display has 4px vertical padding, so the
  // text top lands within a line-height of it.
  expect(topOffset).toBeGreaterThanOrEqual(0);
  expect(topOffset).toBeLessThan(16);
});
