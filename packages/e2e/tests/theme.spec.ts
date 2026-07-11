import { test, expect, type Page } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';

async function storeManualTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((storedTheme) => {
    window.localStorage.setItem('spaces.theme', storedTheme);
  }, theme);
}

async function getThemeOverride(page: Page) {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

test('document declares light and dark scheme support before rendering', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });

  await page.goto('/');

  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe('light dark');
});

test('routes without a theme toggle ignore stored manual theme overrides', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await storeManualTheme(page, 'dark');

  await page.goto('/');

  await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
  await expect.poll(() => getThemeOverride(page)).toBeNull();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(236, 229, 212)');
});

test('routes follow automatic dark system theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await storeManualTheme(page, 'light');

  await page.goto('/');

  await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
  await expect.poll(() => getThemeOverride(page)).toBeNull();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(26, 24, 22)');
});

test('project route ignores stored manual theme overrides on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await storeManualTheme(page, 'dark');

  const { project } = await setupProject(page, 'Mobile Theme Space');
  await page.goto(`/${project.slug}`);

  await expect(page.getByTestId('project-header')).toBeVisible();
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
  await expect.poll(() => getThemeOverride(page)).toBeNull();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(236, 229, 212)');
});

test('project route ignores stored manual theme overrides on wide screens', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await storeManualTheme(page, 'dark');

  const { project } = await setupProject(page, 'Desktop Theme Space');
  await page.goto(`/${project.slug}`);

  await expect(page.getByTestId('project-header')).toBeVisible();
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
  await expect.poll(() => getThemeOverride(page)).toBeNull();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(236, 229, 212)');
});
