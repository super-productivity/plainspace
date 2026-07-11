import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { seedIdentity } from '../helpers/fixtures';
import { seedDemoSpace } from '../helpers/seed';

const outDir = fileURLToPath(new URL('../screenshots', import.meta.url));

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const THEMES = ['light', 'dark'] as const;

// Captures the landing page and one seeded Space at every viewport × theme.
// Theme follows the OS color scheme (see theme.spec.ts), so `colorScheme` on
// the context is all that's needed. Home is shot from a fresh context with no
// identity (pristine landing); the Space is shot from a context carrying the
// creator's identity in localStorage.
test('capture marketing screenshots', async ({ browser }) => {
  const { slug, identity } = await seedDemoSpace();

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        colorScheme: theme,
      });
      const page = await context.newPage();

      await page.goto('/');
      await page.getByRole('heading', { name: 'Plainspace' }).waitFor();
      await page.screenshot({ path: `${outDir}/${vp.name}/home-${theme}.png` });

      await seedIdentity(page, slug, identity.token, identity.memberId);
      await page.goto(`/${slug}`);
      await page.getByTestId('list-card').waitFor({ state: 'visible' });
      // Let entry animations and the activity feed settle before the shot.
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${outDir}/${vp.name}/space-${theme}.png` });

      await context.close();
    }
  }
});
