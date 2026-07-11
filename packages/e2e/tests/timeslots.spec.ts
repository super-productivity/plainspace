import { test, expect, type Browser, type Page } from '@playwright/test';
import { seedIdentity, setupProject } from '../helpers/fixtures';
import { createProjectViaApi, joinProjectViaApi } from '../helpers/api';

const API_BASE = `http://localhost:${process.env.E2E_API_PORT ?? '3000'}/api`;

// Mirrors MAX_TIMESLOT_SLOTS in @plainspace/shared. Kept local so the e2e
// package stays dependency-free; bump together if the shared cap changes.
const MAX_TIMESLOT_SLOTS = 15;

async function createTimeSlotViaApi(
  slug: string,
  token: string,
  data: { title: string; slots: string[] },
) {
  return fetch(`${API_BASE}/projects/${slug}/panels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'timeslot', ...data }),
  });
}

async function createPollViaApi(
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

async function respondTimeSlotViaApi(
  slug: string,
  token: string,
  panelId: string,
  slotId: string,
  available: boolean,
) {
  return fetch(`${API_BASE}/projects/${slug}/panels/${panelId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ slotId, available }),
  });
}

async function votePollViaApi(slug: string, token: string, panelId: string, optionId: string) {
  return fetch(`${API_BASE}/projects/${slug}/panels/${panelId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ optionId }),
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

async function createTimeSlotViaUi(page: Page, title: string, slots: string[]) {
  await page.getByTestId('add-panel-button').click();
  await expect(page.getByTestId('add-panel-dialog')).toBeVisible();
  // Pick the time-slot panel from the card chooser.
  await page.getByTestId('add-panel-type-timeslot').click();
  await page.getByTestId('add-panel-title').fill(title);

  const inputs = page.getByTestId('add-panel-slot');
  // Two slot rows are seeded by default; add more if needed.
  for (let i = 2; i < slots.length; i++) {
    await page.getByTestId('add-panel-add-slot').click();
  }
  for (let i = 0; i < slots.length; i++) {
    await inputs.nth(i).fill(slots[i]);
  }
  await page.getByTestId('add-panel-timeslot-submit').click();
  await expect(page.getByTestId('add-panel-dialog')).toBeHidden();
}

// Delete + Rename live behind the card's `panel-menu` button; its items render
// in a portal, so open the menu here and click items at the page level.
async function openTimeSlotMenu(page: Page) {
  await page.getByTestId('timeslot-card').getByTestId('panel-menu').click();
}

test('create timeslot, toggle slots (multi-select), then delete (single user)', async ({
  page,
}) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createTimeSlotViaUi(page, 'When can we meet?', ['Mon 9am', 'Tue 2pm']);

  // SSE-driven render.
  await expect(page.getByTestId('timeslot-card')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('timeslot-card')).toContainText('When can we meet?');

  const slots = page.getByTestId('timeslot-slot');
  await expect(slots).toHaveCount(2);
  const monCount = slots.nth(0).getByTestId('timeslot-slot-count');
  const tueCount = slots.nth(1).getByTestId('timeslot-slot-count');

  // Mark Mon available.
  await slots.nth(0).click();
  await expect(slots.nth(0)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await expect(monCount).toHaveText('1');
  await expect(tueCount).toHaveText('0');

  // Untoggle Mon (re-click clears it).
  await slots.nth(0).click();
  await expect(slots.nth(0)).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
  await expect(monCount).toHaveText('0');

  // The core differentiator vs a poll: mark BOTH slots available at once.
  // A poll's unique(panel, member) forbids this; a timeslot allows it.
  await slots.nth(0).click();
  await expect(slots.nth(0)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await slots.nth(1).click();
  await expect(slots.nth(1)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await expect(monCount).toHaveText('1');
  await expect(tueCount).toHaveText('1');

  // Creator can delete (deletion is confirm-gated).
  await openTimeSlotMenu(page);
  await page.getByTestId('timeslot-delete').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('timeslot-card')).toHaveCount(0, { timeout: 5000 });
});

test('two users see timeslot creation, responses, and deletion in real-time', async ({
  browser,
}) => {
  const created = await createProjectViaApi('TimeSlot Sync', 'Alice');
  const { project, member: alice, token: aliceToken } = created;

  const bob = await joinProjectViaApi(project.slug, 'Bob');

  const a = await openPage(browser, project.slug, aliceToken, alice.id);
  const b = await openPage(browser, project.slug, bob.token, bob.member.id);

  await expect(a.page.getByTestId('add-panel-button')).toBeVisible();
  await expect(b.page.getByTestId('add-panel-button')).toBeVisible();

  // Alice creates a timeslot.
  await createTimeSlotViaUi(a.page, 'Best time for the call?', ['Tue 10am', 'Thu 4pm']);

  // Bob sees it via SSE.
  await expect(b.page.getByTestId('timeslot-card')).toBeVisible({ timeout: 5000 });
  await expect(b.page.getByTestId('timeslot-card')).toContainText('Best time for the call?');

  // Bob marks the second slot available.
  await b.page.getByTestId('timeslot-slot').nth(1).click();

  // Alice sees the count update. Scope to the slot's count cell so we don't
  // accidentally match a stray '1' anywhere else inside the button.
  await expect(
    a.page.getByTestId('timeslot-slot').nth(1).getByTestId('timeslot-slot-count'),
  ).toHaveText('1', { timeout: 5000 });

  // Alice deletes the panel (confirm-gated).
  await openTimeSlotMenu(a.page);
  await a.page.getByTestId('timeslot-delete').click();
  await a.page.getByTestId('confirm-dialog-confirm').click();

  // Bob sees the panel disappear.
  await expect(b.page.getByTestId('timeslot-card')).toHaveCount(0, { timeout: 5000 });

  await a.ctx.close();
  await b.ctx.close();
});

test('a timeslot response does not touch a poll vote in the same project', async () => {
  // Regression net for setTimeSlotResponse's type guard: a timeslot.response and a
  // poll.vote target different panels but the store keys both by panel id.
  const created = await createProjectViaApi('Cross Event', 'Owner');
  const { project, token } = created;

  const pollRes = await createPollViaApi(project.slug, token, {
    question: 'Which lunch?',
    options: ['Soup', 'Salad'],
  });
  const { panel: poll } = (await pollRes.json()) as {
    panel: { id: string; options: Array<{ id: string }> };
  };

  const timeslotRes = await createTimeSlotViaApi(project.slug, token, {
    title: 'Which day?',
    slots: ['Mon', 'Tue'],
  });
  const { panel: timeslot } = (await timeslotRes.json()) as {
    panel: { id: string; slots: Array<{ id: string }> };
  };

  // Vote on the poll and respond on the timeslot.
  expect((await votePollViaApi(project.slug, token, poll.id, poll.options[0].id)).status).toBe(204);
  expect(
    (await respondTimeSlotViaApi(project.slug, token, timeslot.id, timeslot.slots[0].id, true))
      .status,
  ).toBe(204);

  // The full load must keep each panel's state on its own type.
  const projRes = await fetch(`${API_BASE}/projects/${project.slug}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const projData = (await projRes.json()) as {
    panels: Array<{
      id: string;
      type: string;
      votes?: Array<{ optionId: string }>;
      responses?: Array<{ slotId: string }>;
    }>;
  };
  const freshPoll = projData.panels.find((p) => p.id === poll.id)!;
  const freshTimeSlot = projData.panels.find((p) => p.id === timeslot.id)!;

  expect(freshPoll.type).toBe('poll');
  expect(freshPoll.votes).toHaveLength(1);
  expect(freshPoll.responses).toBeUndefined();

  expect(freshTimeSlot.type).toBe('timeslot');
  expect(freshTimeSlot.responses).toHaveLength(1);
  expect(freshTimeSlot.votes).toBeUndefined();
});

test('activity feed surfaces added/removed timeslot', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createTimeSlotViaUi(page, 'Plan the offsite', ['Week 1', 'Week 2']);
  await expect(page.getByTestId('activity-feed')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('activity-entry').first()).toContainText('added');
  await expect(page.getByTestId('activity-entry').first()).toContainText('time slot');

  await openTimeSlotMenu(page);
  await page.getByTestId('timeslot-delete').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('activity-entry').first()).toContainText('removed', {
    timeout: 5000,
  });
});

test('validation: server rejects malformed timeslot create requests', async () => {
  const created = await createProjectViaApi('TimeSlot Validation', 'Owner');
  const { project, token } = created;

  // Fewer than MIN_TIMESLOT_SLOTS.
  const tooFew = await createTimeSlotViaApi(project.slug, token, {
    title: 'Q?',
    slots: ['only one'],
  });
  expect(tooFew.status).toBe(422);

  // More than MAX_TIMESLOT_SLOTS (build from the constant, not a literal).
  const tooMany = await createTimeSlotViaApi(project.slug, token, {
    title: 'Q?',
    slots: Array.from({ length: MAX_TIMESLOT_SLOTS + 1 }, (_, i) => `slot-${i}`),
  });
  expect(tooMany.status).toBe(422);

  // Empty title.
  const emptyTitle = await createTimeSlotViaApi(project.slug, token, {
    title: '',
    slots: ['A', 'B'],
  });
  expect(emptyTitle.status).toBe(422);

  // 281-char title exceeds MAX_TIMESLOT_TITLE_LENGTH.
  const longTitle = await createTimeSlotViaApi(project.slug, token, {
    title: 'x'.repeat(281),
    slots: ['A', 'B'],
  });
  expect(longTitle.status).toBe(422);
});

test('respond integrity: 404 on missing panel, 422 on bogus slot, idempotent toggle', async () => {
  const created = await createProjectViaApi('Respond Integrity', 'Owner');
  const { project, token } = created;

  const createRes = await createTimeSlotViaApi(project.slug, token, {
    title: 'When?',
    slots: ['One', 'Two'],
  });
  const { panel } = (await createRes.json()) as {
    panel: { id: string; slots: Array<{ id: string }> };
  };

  // Respond on a non-existent panel -> 404.
  const missing = await respondTimeSlotViaApi(
    project.slug,
    token,
    '00000000-0000-0000-0000-000000000000',
    panel.slots[0].id,
    true,
  );
  expect(missing.status).toBe(404);

  // Bogus slotId -> 422.
  const bogus = await respondTimeSlotViaApi(project.slug, token, panel.id, 'does-not-exist', true);
  expect(bogus.status).toBe(422);

  // Mark the same slot available twice -- the second is a no-op insert, not a
  // duplicate row. A retract with no row still returns 204.
  expect(
    (await respondTimeSlotViaApi(project.slug, token, panel.id, panel.slots[0].id, true)).status,
  ).toBe(204);
  expect(
    (await respondTimeSlotViaApi(project.slug, token, panel.id, panel.slots[0].id, true)).status,
  ).toBe(204);
  // Mark the other slot available too (multi-select).
  expect(
    (await respondTimeSlotViaApi(project.slug, token, panel.id, panel.slots[1].id, true)).status,
  ).toBe(204);

  // GET the project and verify exactly two response rows for this member (one
  // per slot) -- the duplicate available toggle did not add a third.
  const projRes = await fetch(`${API_BASE}/projects/${project.slug}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const projData = (await projRes.json()) as {
    panels: Array<{ id: string; responses: Array<{ slotId: string; memberId: string }> }>;
  };
  const fresh = projData.panels.find((p) => p.id === panel.id)!;
  expect(fresh.responses).toHaveLength(2);
  expect(fresh.responses.map((r) => r.slotId).sort()).toEqual(
    [panel.slots[0].id, panel.slots[1].id].sort(),
  );
});
