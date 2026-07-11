import { type Page } from '@playwright/test';
import { createProjectViaApi, joinProjectViaApi } from './api';

// Mirrors the web app's private localStorage contract — STORAGE_PREFIX and
// PLAINSPACE_EMAIL_KEY in packages/web/src/lib/identity.ts. Must stay in sync.
const STORAGE_PREFIX = 'spaces:projects:';
const PLAINSPACE_EMAIL_KEY = 'spaces:plainspaceEmail';

export function projectStorageKey(slug: string): string {
  return STORAGE_PREFIX + slug;
}

// Store a member identity in the live page's localStorage, in the exact JSON
// shape the web app reads (see StoredIdentity in packages/web/src/lib/identity.ts).
// Runs via page.evaluate, so the page must already be on the app origin and
// the write takes effect immediately (before the next navigation).
export async function seedIdentity(
  page: Page,
  slug: string,
  token: string,
  memberId: string,
  name?: string,
) {
  await page.evaluate(
    ({ key, token, memberId, name }) => {
      // JSON.stringify drops undefined properties, so a nameless identity
      // serializes to exactly { token, memberId }.
      localStorage.setItem(key, JSON.stringify({ token, memberId, name }));
    },
    { key: projectStorageKey(slug), token, memberId, name },
  );
}

// Store the device-wide saved email (PLAINSPACE_EMAIL_KEY in
// packages/web/src/lib/identity.ts). Immediate, via the live page — unlike an
// init script it is NOT re-applied on later navigations.
export async function seedPlainspaceEmail(page: Page, email: string) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: PLAINSPACE_EMAIL_KEY,
    value: email,
  });
}

export async function setupProject(page: Page, projectName = 'Test Project', userName = 'Alice') {
  const result = await createProjectViaApi(projectName, userName);
  const { project, member, token } = result;

  // Store identity in the browser
  await page.goto('/');
  await seedIdentity(page, project.slug, token, member.id);

  return { project, member, token };
}

// Create a project (owned by Alice) and join it as a second, non-creator
// member whose identity is stored in the browser. Use when a test needs a
// member who is allowed to leave the Space — the creator cannot (server
// returns 409).
export async function setupJoinedMember(page: Page, projectName = 'Test Project') {
  const { project } = await createProjectViaApi(projectName, 'Alice');
  const { member, token } = await joinProjectViaApi(project.slug, 'Bob');

  await page.goto('/');
  await seedIdentity(page, project.slug, token, member.id);

  return { project, member, token };
}
