import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT ?? 5173);
const apiPort = Number(process.env.E2E_API_PORT ?? 3000);
const webBaseURL = process.env.E2E_BASE_URL ?? `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './tests',
  // Attachment routes are intentionally unmounted (see CLAUDE.md). Restore
  // this spec when the feature is re-enabled.
  testIgnore: ['**/attachments.spec.ts'],
  timeout: 30000,
  // Retry in CI to absorb inherent SSE-timing flakiness; keep 0 locally so
  // flakes surface loudly during development.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: webBaseURL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `PORT=${apiPort} npm run dev --workspace @plainspace/server`,
      port: apiPort,
      reuseExistingServer: true,
      timeout: 10000,
    },
    {
      command: `npm run dev --workspace @plainspace/web -- --port ${webPort}`,
      port: webPort,
      reuseExistingServer: true,
      timeout: 10000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
