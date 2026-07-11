import { test, expect, type Browser, type Page } from '@playwright/test';
import { seedIdentity, setupProject } from '../helpers/fixtures';
import { createProjectViaApi, joinProjectViaApi } from '../helpers/api';

const API_BASE = `http://localhost:${process.env.E2E_API_PORT ?? '3000'}/api`;

async function createPanelViaApi(
  slug: string,
  token: string,
  data: { question: string; options: string[] },
) {
  return fetch(`${API_BASE}/projects/${slug}/panels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'poll', ...data }),
  });
}

async function votePollViaApi(
  slug: string,
  token: string,
  panelId: string,
  optionId: string | null,
) {
  return fetch(`${API_BASE}/projects/${slug}/panels/${panelId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ optionId }),
  });
}

async function deletePanelViaApi(slug: string, token: string, panelId: string) {
  return fetch(`${API_BASE}/projects/${slug}/panels/${panelId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function openPage(browser: Browser, slug: string, token: string, memberId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await seedIdentity(page, slug, token, memberId);
  await page.goto(`/${slug}`);
  return { ctx, page };
}

// Delete + Rename live behind the card's `panel-menu` button now; its items
// render in a portal, so open the menu here and click items at the page level.
async function openPollMenu(page: Page) {
  await page.getByTestId('poll-card').getByTestId('panel-menu').click();
}

async function createPollViaUi(page: Page, question: string, options: string[]) {
  await page.getByTestId('add-panel-button').click();
  await expect(page.getByTestId('add-panel-dialog')).toBeVisible();
  // Pick the poll panel from the card chooser.
  await page.getByTestId('add-panel-type-poll').click();
  await page.getByTestId('add-panel-question').fill(question);

  const inputs = page.getByTestId('add-panel-option');
  // Two option rows are seeded by default; add more if needed.
  for (let i = 2; i < options.length; i++) {
    await page.getByTestId('add-panel-add-option').click();
  }
  for (let i = 0; i < options.length; i++) {
    await inputs.nth(i).fill(options[i]);
  }
  await page.getByTestId('add-panel-submit').click();
  await expect(page.getByTestId('add-panel-dialog')).toBeHidden();
}

test('add-panel button is always visible (empty state)', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('panel-column')).toBeVisible();
  await expect(page.getByTestId('add-panel-button')).toBeVisible();
  await expect(page.getByTestId('poll-card')).toHaveCount(0);
});

test('create poll, vote, retract, then delete (single user)', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createPollViaUi(page, 'Which day works?', ['Mon', 'Tue']);

  // SSE-driven render.
  await expect(page.getByTestId('poll-card')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('poll-card')).toContainText('Which day works?');

  const options = page.getByTestId('poll-option');
  await expect(options).toHaveCount(2);
  const monCount = options.nth(0).getByTestId('poll-option-count');
  const tueCount = options.nth(1).getByTestId('poll-option-count');

  // Vote for Mon.
  await options.nth(0).click();
  await expect(options.nth(0)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await expect(monCount).toHaveText('1');
  await expect(tueCount).toHaveText('0');

  // Switch to Tue.
  await options.nth(1).click();
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await expect(options.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(monCount).toHaveText('0');
  await expect(tueCount).toHaveText('1');

  // Retract (re-click the voted option clears it). Asserting Tue's count
  // specifically -- Mon's was already 0, so a count-of-first check would
  // pass even if the retract silently failed.
  await options.nth(1).click();
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
  await expect(tueCount).toHaveText('0');

  // Creator can delete (deletion is confirm-gated).
  await openPollMenu(page);
  await page.getByTestId('poll-delete').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('poll-card')).toHaveCount(0, { timeout: 5000 });
});

test('rename a poll via the actions menu', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createPollViaUi(page, 'Which day works?', ['Mon', 'Tue']);
  const card = page.getByTestId('poll-card');
  await expect(card).toContainText('Which day works?', { timeout: 5000 });

  await openPollMenu(page);
  await page.getByTestId('panel-rename').click();
  const input = card.getByTestId('panel-rename-input');
  await expect(input).toBeVisible();
  await input.fill('Which evening works?');
  await input.press('Enter');

  // Renaming a poll edits its question; the SSE echo (panel.updated) updates it.
  await expect(card).toContainText('Which evening works?', { timeout: 5000 });
});

test('two users see poll creation, voting, and deletion in real-time', async ({ browser }) => {
  const created = await createProjectViaApi('Panel Sync', 'Alice');
  const { project, member: alice, token: aliceToken } = created;

  const bob = await joinProjectViaApi(project.slug, 'Bob');

  const a = await openPage(browser, project.slug, aliceToken, alice.id);
  const b = await openPage(browser, project.slug, bob.token, bob.member.id);

  await expect(a.page.getByTestId('add-panel-button')).toBeVisible();
  await expect(b.page.getByTestId('add-panel-button')).toBeVisible();

  // Alice creates a poll.
  await createPollViaUi(a.page, 'Dinner spot?', ['Sushi', 'Pizza']);

  // Bob sees it via SSE.
  await expect(b.page.getByTestId('poll-card')).toBeVisible({ timeout: 5000 });
  await expect(b.page.getByTestId('poll-card')).toContainText('Dinner spot?');

  // Bob votes for Pizza.
  await b.page.getByTestId('poll-option').nth(1).click();

  // Alice sees count update. Scope to the option's count cell so we don't
  // accidentally match a stray '1' anywhere else inside the button.
  await expect(
    a.page.getByTestId('poll-option').nth(1).getByTestId('poll-option-count'),
  ).toHaveText('1', { timeout: 5000 });

  // Alice deletes the panel (confirm-gated).
  await openPollMenu(a.page);
  await a.page.getByTestId('poll-delete').click();
  await a.page.getByTestId('confirm-dialog-confirm').click();

  // Bob sees the panel disappear.
  await expect(b.page.getByTestId('poll-card')).toHaveCount(0, { timeout: 5000 });

  await a.ctx.close();
  await b.ctx.close();
});

test('activity feed surfaces panel.created and panel.deleted', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createPollViaUi(page, 'Where to meet?', ['Park', 'Cafe']);
  await expect(page.getByTestId('activity-feed')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('activity-entry').first()).toContainText('added');
  await expect(page.getByTestId('activity-entry').first()).toContainText('poll');

  await openPollMenu(page);
  await page.getByTestId('poll-delete').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('activity-entry').first()).toContainText('removed', {
    timeout: 5000,
  });
});

test('any member (not the creator) can delete a panel via API (204)', async () => {
  // Panels are shared, collaborative content: deletion isn't owner-scoped, so a
  // plain member who didn't create the panel may still remove it.
  const created = await createProjectViaApi('Panel Auth', 'Owner');
  const { project, token: ownerToken } = created;
  const member = await joinProjectViaApi(project.slug, 'Joiner');

  // Owner creates the panel.
  const createRes = await createPanelViaApi(project.slug, ownerToken, {
    question: 'Pick one',
    options: ['A', 'B'],
  });
  expect(createRes.status).toBe(201);
  const { panel } = (await createRes.json()) as { panel: { id: string } };

  // Joiner (regular member, not the creator) deletes it.
  const deleted = await deletePanelViaApi(project.slug, member.token, panel.id);
  expect(deleted.status).toBe(204);
});

test('vote integrity: bogus optionId is 422, duplicate vote is one row', async () => {
  const created = await createProjectViaApi('Vote Integrity', 'Owner');
  const { project, token } = created;

  const createRes = await createPanelViaApi(project.slug, token, {
    question: 'Q?',
    options: ['One', 'Two'],
  });
  const { panel } = (await createRes.json()) as {
    panel: { id: string; options: Array<{ id: string }> };
  };

  // Bogus optionId.
  const bogus = await votePollViaApi(project.slug, token, panel.id, 'does-not-exist');
  expect(bogus.status).toBe(422);

  // Vote twice on the same option -- second is an upsert, not a duplicate.
  const ok1 = await votePollViaApi(project.slug, token, panel.id, panel.options[0].id);
  expect(ok1.status).toBe(204);
  const ok2 = await votePollViaApi(project.slug, token, panel.id, panel.options[1].id);
  expect(ok2.status).toBe(204);

  // GET the project and verify only one vote row for this member exists.
  const projRes = await fetch(`${API_BASE}/projects/${project.slug}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const projData = (await projRes.json()) as {
    panels: Array<{ id: string; votes: Array<{ optionId: string; memberId: string }> }>;
  };
  const fresh = projData.panels.find((p) => p.id === panel.id)!;
  expect(fresh.votes).toHaveLength(1);
  expect(fresh.votes[0].optionId).toBe(panel.options[1].id);
});

test('vote on non-existent panel is 404', async () => {
  const created = await createProjectViaApi('Missing Panel', 'Owner');
  const { project, token } = created;

  const res = await votePollViaApi(
    project.slug,
    token,
    '00000000-0000-0000-0000-000000000000',
    'whatever',
  );
  expect(res.status).toBe(404);
});

test('panel-create rate limit returns 429 after 5 in a minute', async () => {
  // Member-keyed limit is 5/min. The 6th create on the same token must 429.
  const created = await createProjectViaApi('Panel Throttle', 'Owner');
  const { project, token } = created;

  for (let i = 0; i < 5; i++) {
    const res = await createPanelViaApi(project.slug, token, {
      question: `Q${i}`,
      options: ['A', 'B'],
    });
    expect(res.status).toBe(201);
  }
  const throttled = await createPanelViaApi(project.slug, token, {
    question: 'over the line',
    options: ['A', 'B'],
  });
  expect(throttled.status).toBe(429);
});

test('panel-delete rate limit returns 429 after 10 in a minute', async () => {
  // Member-keyed limit is 10/min. The limiter runs before the panel lookup, so
  // a missing id returns 404 ten times, then 429 on the 11th -- exercising the
  // throttle without needing 11 real panels (create is itself capped at 5/min).
  const created = await createProjectViaApi('Panel Delete Throttle', 'Owner');
  const { project, token } = created;
  const missingId = '00000000-0000-0000-0000-000000000000';

  for (let i = 0; i < 10; i++) {
    const res = await deletePanelViaApi(project.slug, token, missingId);
    expect(res.status).toBe(404);
  }
  const throttled = await deletePanelViaApi(project.slug, token, missingId);
  expect(throttled.status).toBe(429);
});

test('removed voter leaves no ghost avatar on the poll', async ({ browser }) => {
  // Owner creates a poll; Bob joins, votes; Owner removes Bob via the admin
  // endpoint. After the member.removed SSE arrives the PollCard joins votes
  // against state.members and drops Bob's avatar. Without that filter Bob
  // would linger as a ghost; this test guards that defensive join.
  const created = await createProjectViaApi('Ghost Avatar', 'Owner');
  const { project, member: owner, token: ownerToken } = created;
  const bob = await joinProjectViaApi(project.slug, 'Bob');

  const createRes = await createPanelViaApi(project.slug, ownerToken, {
    question: 'Best snack?',
    options: ['Chips', 'Fruit'],
  });
  expect(createRes.status).toBe(201);
  const { panel } = (await createRes.json()) as {
    panel: { id: string; options: Array<{ id: string }> };
  };

  const voteRes = await votePollViaApi(project.slug, bob.token, panel.id, panel.options[0].id);
  expect(voteRes.status).toBe(204);

  const ownerPage = await openPage(browser, project.slug, ownerToken, owner.id);

  // Bob's vote is present and his avatar visible before removal.
  await expect(ownerPage.page.getByTestId('poll-card')).toBeVisible({ timeout: 5000 });
  const firstOption = ownerPage.page.getByTestId('poll-option').first();
  await expect(firstOption.getByTestId('poll-option-count')).toHaveText('1', { timeout: 5000 });
  await expect(firstOption.getByTestId('poll-voter-avatar')).toHaveCount(1);

  const removeRes = await fetch(
    `${API_BASE}/projects/${project.slug}/auth/members/${bob.member.id}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    },
  );
  expect(removeRes.status).toBe(204);

  // After the member.removed SSE the join-against-members filter drops both
  // Bob's avatar AND his vote from the rendered card (since the count is
  // derived from filtered avatars). The DB cascade has already removed the
  // poll_votes row, so a refresh would agree.
  await expect(firstOption.getByTestId('poll-voter-avatar')).toHaveCount(0, { timeout: 5000 });
  await expect(firstOption.getByTestId('poll-option-count')).toHaveText('0');

  await ownerPage.ctx.close();
});

test('validation: server rejects malformed create requests', async () => {
  const created = await createProjectViaApi('Panel Validation', 'Owner');
  const { project, token } = created;

  // 0 options.
  const noOpts = await createPanelViaApi(project.slug, token, {
    question: 'Q?',
    options: [],
  });
  expect(noOpts.status).toBe(422);

  // 11 options exceeds MAX_POLL_OPTIONS.
  const tooMany = await createPanelViaApi(project.slug, token, {
    question: 'Q?',
    options: Array.from({ length: 11 }, (_, i) => `opt-${i}`),
  });
  expect(tooMany.status).toBe(422);

  // Empty question.
  const emptyQ = await createPanelViaApi(project.slug, token, {
    question: '',
    options: ['A', 'B'],
  });
  expect(emptyQ.status).toBe(422);

  // 281-char question exceeds MAX_POLL_QUESTION_LENGTH.
  const longQ = await createPanelViaApi(project.slug, token, {
    question: 'x'.repeat(281),
    options: ['A', 'B'],
  });
  expect(longQ.status).toBe(422);
});
