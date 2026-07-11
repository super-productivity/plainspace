import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Screenshot-capture config. Reuses the dev-server boot + ports from
 * playwright.config.ts; only the test dir, timeout, and project list differ.
 * Viewports and light/dark themes are driven inside the spec via explicit
 * browser contexts, so a single Chromium project is enough here.
 *
 * Run:    npm run screenshots --workspace @plainspace/e2e
 * Output: packages/e2e/screenshots/<viewport>/<view>-<theme>.png
 */
export default defineConfig({
  ...base,
  testDir: './capture',
  testIgnore: [],
  timeout: 120_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Reveal the output folder once every shot is written.
  globalTeardown: './capture/open-output.ts',
});
