import { test, expect } from '@playwright/test';
import { seedIdentity, setupProject } from '../helpers/fixtures';
import { createProjectViaApi, verifyMemberViaApi } from '../helpers/api';

const API_BASE = `http://localhost:${process.env.E2E_API_PORT ?? '3000'}/api`;

test('members panel opens from header', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  // Click members button
  await page.getByTestId('presence-bar').click();

  // Panel should open
  await expect(page.getByTestId('member-list-panel')).toBeVisible();
  await expect(page.getByTestId('member-row')).toBeVisible();
});

test('creator has admin role', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  // Open members panel
  await page.getByTestId('presence-bar').click();

  // Creator should have admin badge
  await expect(page.getByTestId('member-list-panel')).toContainText('admin');
});

test('link joining off blocks new joins', async ({ context }) => {
  // Create project via API
  const email = `private-admin-${Date.now()}@test.local`;
  const result = await createProjectViaApi('Link Joining Off Space', 'Admin', email);
  const { project, token } = result;
  await verifyMemberViaApi(project.slug, token, email);

  // Turn link joining off via API.
  const settingsRes = await fetch(`${API_BASE}/projects/${project.slug}/auth/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sharingMode: 'private' }),
  });
  expect(settingsRes.ok).toBe(true);

  // Try to join from a new browser (no identity)
  const page2 = await context.newPage();
  await page2.goto(`/${project.slug}/join`);

  // Should see that new link joins are closed.
  await expect(page2.getByText('Joining is off', { exact: false })).toBeVisible({
    timeout: 5000,
  });
});

test('link joining off header hides the join link button', async ({ page }) => {
  const email = `private-link-${Date.now()}@test.local`;
  const result = await createProjectViaApi('Link Joining Off Header', 'Admin', email);
  const { project, member, token } = result;
  await verifyMemberViaApi(project.slug, token, email);

  const settingsRes = await fetch(`${API_BASE}/projects/${project.slug}/auth/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sharingMode: 'private' }),
  });
  expect(settingsRes.ok).toBe(true);

  await page.goto('/');
  await seedIdentity(page, project.slug, token, member.id);

  await page.goto(`/${project.slug}`);
  // Link joining is off, so there is no join link to copy — the button is gone.
  await expect(page.getByTestId('space-link-button')).toHaveCount(0);
});

test('project info endpoint returns sharing mode', async () => {
  const result = await createProjectViaApi('Info Test', 'Alice');
  const { project } = result;

  const res = await fetch(`${API_BASE}/projects/${project.slug}/info`);
  const info = await res.json();

  expect(info.name).toBe('Info Test');
  expect(info.sharingMode).toBe('open');
});
