import { test, expect, type Browser, type Page, type Locator } from '@playwright/test';
import { seedIdentity, setupProject } from '../helpers/fixtures';
import {
  createProjectViaApi,
  joinProjectViaApi,
  createItemViaApi,
  apiRequest,
} from '../helpers/api';

// SortableJS runs with forceFallback, so Playwright's dragTo() (which drives
// native HTML5 DnD) does nothing. Drive its pointer engine by hand: press on
// the source, move in several small steps so the drag registers, drop on the
// target's top edge. We interpolate BOTH axes: a cross-list target sits in a
// different column on desktop, so the pointer must travel horizontally to
// enter the destination container — for a same-column drag the X term is ~0,
// so this stays identical to a plain vertical drag. Desktop has no long-press
// delay (delayOnTouchOnly), so no hold is needed. Across cards the exact
// landing slot isn't guaranteed — those tests assert membership, not order.
async function dragRowAbove(page: Page, sourceText: string, targetText: string) {
  const source = page.getByTestId('list-item').filter({ hasText: sourceText });
  const target = page.getByTestId('list-item').filter({ hasText: targetText });
  const from = await source.boundingBox();
  const sourceElement = await source.elementHandle();
  const targetElement = await target.elementHandle();
  if (!from || !sourceElement || !targetElement) throw new Error('row not visible');

  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  try {
    // Cross fallbackTolerance, then wait until Sortable confirms it has lifted
    // the real source node. Under parallel load, racing straight to the target
    // could deliver every move before its fallback loop had entered drag mode.
    await page.mouse.move(startX, startY + 10, { steps: 4 });
    await expect
      .poll(() => sourceElement.evaluate((node) => node.classList.contains('sortable-chosen')))
      .toBe(true);

    // onStart expands every destination drop zone, so measure the target only
    // after the lift rather than aiming at its stale pre-drag coordinates.
    const activeTarget = await target.boundingBox();
    if (!activeTarget) throw new Error('drop target not visible');
    await page.mouse.move(activeTarget.x + activeTarget.width / 2, activeTarget.y + 2, {
      steps: 12,
    });

    // Wait for the actual Sortable insertion, not a guessed timer interval.
    await expect
      .poll(
        () =>
          sourceElement.evaluate((sourceNode, targetNode) => {
            if (
              !(targetNode instanceof Element) ||
              sourceNode.parentElement !== targetNode.parentElement
            ) {
              return false;
            }
            const siblings = [...sourceNode.parentElement!.querySelectorAll('[data-item-id]')];
            return siblings.indexOf(sourceNode) < siblings.indexOf(targetNode);
          }, targetElement),
        { timeout: 5000 },
      )
      .toBe(true);
  } finally {
    await page.mouse.up();
  }
}

// Drop a row onto a list's open SECTION (not a specific sibling row) — the case
// of dragging into an empty or short list. That section is only a hittable size
// mid-drag (ListCard enlarges every drop zone while a drag is active), so press,
// nudge to start the drag, THEN measure the now-expanded [data-list-id] zone and
// move onto its centre.
async function dragRowIntoList(page: Page, sourceText: string, listTestId: string) {
  const source = page.getByTestId('list-item').filter({ hasText: sourceText });
  const from = await source.boundingBox();
  if (!from) throw new Error('row not visible');
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Two small nudges register the drag so the destination drop zone expands.
  await page.mouse.move(startX + 4, startY + 4);
  await page.mouse.move(startX + 8, startY + 8);

  const zone = page.getByTestId(listTestId).locator('[data-list-id]');
  const to = await zone.boundingBox();
  if (!to) throw new Error('drop zone not visible');
  const dropX = to.x + to.width / 2;
  const dropY = to.y + to.height / 2;
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(
      startX + ((dropX - startX) * step) / 6,
      startY + ((dropY - startY) * step) / 6,
    );
  }
  // Sortable's fallback engine inserts only on a 50ms interval tick; dropping
  // immediately can land between ticks and turn the drag into a no-op.
  await page.waitForTimeout(120);
  await page.mouse.up();
}

function orderedTexts(page: Page): Promise<string[]> {
  return page.getByTestId('item-text').allInnerTexts();
}

async function openProjectAs(
  browser: Browser,
  slug: string,
  token: string,
  memberId: string,
  expectedItemCount = 3,
): Promise<{ ctx: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await seedIdentity(page, slug, token, memberId);
  await page.goto(`/${slug}`);
  // Gate on the initial item load so the SSE stream is live before any action.
  await expect(page.getByTestId('item-text')).toHaveCount(expectedItemCount);
  return { ctx, page };
}

test('drag a row to the top and the new order persists across reload', async ({ page }) => {
  const { project, token } = await setupProject(page);
  for (const text of ['First', 'Second', 'Third']) {
    await createItemViaApi(project.slug, token, text);
  }

  await page.goto(`/${project.slug}`);
  await expect(page.getByTestId('item-text')).toHaveCount(3);
  expect(await orderedTexts(page)).toEqual(['First', 'Second', 'Third']);

  await dragRowAbove(page, 'Third', 'First');

  await expect
    .poll(() => orderedTexts(page), { timeout: 5000 })
    .toEqual(['Third', 'First', 'Second']);

  // Persisted: a hard reload re-fetches from the server and keeps the order.
  await page.reload();
  await expect(page.getByTestId('item-text')).toHaveCount(3);
  expect(await orderedTexts(page)).toEqual(['Third', 'First', 'Second']);
});

test('drag a row into another list moves it there and persists', async ({ page }) => {
  const { project, token } = await setupProject(page);
  await createItemViaApi(project.slug, token, 'Move me');

  // A checklist panel is just a second list rendered as a side card. Create one
  // and seed a row so there's a stable drop target inside its open section.
  const auth = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const { panel } = await apiRequest<{ panel: { id: string; listId: string } }>(
    `/projects/${project.slug}/panels`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ type: 'checklist', title: 'Errands' }),
    },
  );
  await apiRequest(`/projects/${project.slug}/items`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ text: 'Buy milk', listId: panel.listId }),
  });

  await page.goto(`/${project.slug}`);
  const hero = page.getByTestId('list-card');
  const checklist = page.getByTestId('checklist-card');
  await expect(hero.getByTestId('item-text')).toHaveText(['Move me']);
  await expect(checklist.getByTestId('item-text')).toHaveText(['Buy milk']);

  // Drop "Move me" onto the checklist's seeded row — a cross-card drag.
  await dragRowAbove(page, 'Move me', 'Buy milk');

  // The row leaves the hero list and now lives in the checklist (its exact
  // slot there isn't the point — sort to compare membership).
  const sorted = (locator: Locator) => locator.allInnerTexts().then((t) => t.sort());
  await expect
    .poll(() => hero.getByTestId('item-text').allInnerTexts(), { timeout: 5000 })
    .toEqual([]);
  await expect
    .poll(() => sorted(checklist.getByTestId('item-text')), { timeout: 5000 })
    .toEqual(['Buy milk', 'Move me']);

  // Persisted: a hard reload re-fetches from the server and keeps the move.
  await page.reload();
  await expect(checklist.getByTestId('item-text')).toHaveCount(2);
  await expect(checklist.getByTestId('item-text').filter({ hasText: 'Move me' })).toHaveCount(1);
  await expect(hero.getByTestId('item-text')).toHaveCount(0);
});

test('drag a row into an empty list moves it there and persists', async ({ page }) => {
  const { project, token } = await setupProject(page);
  await createItemViaApi(project.slug, token, 'Move me');

  // An EMPTY checklist panel: no seeded row, so the only drop target is the open
  // section's drop zone — which must enlarge during the drag to be hittable.
  // This is the regression behind "drag-and-drop does nothing": before the drop
  // zone grew on drag, an empty list was ~1px tall and impossible to drop onto.
  await apiRequest(`/projects/${project.slug}/panels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'checklist', title: 'Errands' }),
  });

  await page.goto(`/${project.slug}`);
  const hero = page.getByTestId('list-card');
  const checklist = page.getByTestId('checklist-card');
  await expect(hero.getByTestId('item-text')).toHaveText(['Move me']);
  await expect(checklist.getByTestId('item-text')).toHaveCount(0);

  await dragRowIntoList(page, 'Move me', 'checklist-card');

  await expect
    .poll(() => hero.getByTestId('item-text').allInnerTexts(), { timeout: 5000 })
    .toEqual([]);
  await expect
    .poll(() => checklist.getByTestId('item-text').allInnerTexts(), { timeout: 5000 })
    .toEqual(['Move me']);

  // Persisted: a hard reload re-fetches from the server and keeps the move.
  await page.reload();
  await expect(checklist.getByTestId('item-text')).toHaveText(['Move me']);
  await expect(hero.getByTestId('item-text')).toHaveCount(0);
});

test('a second client converges to the new order over SSE', async ({ browser }) => {
  const alice = await createProjectViaApi('Reorder Sync', 'Alice');
  const { project, token } = alice;
  for (const text of ['First', 'Second', 'Third']) {
    await createItemViaApi(project.slug, token, text);
  }
  const bob = await joinProjectViaApi(project.slug, 'Bob');

  const page1 = await openProjectAs(browser, project.slug, token, alice.member.id);
  const page2 = await openProjectAs(browser, project.slug, bob.token, bob.member.id);

  // Let both SSE streams connect before the reorder.
  await page2.page.waitForTimeout(1000);

  await dragRowAbove(page1.page, 'Third', 'First');

  await expect
    .poll(() => orderedTexts(page1.page), { timeout: 5000 })
    .toEqual(['Third', 'First', 'Second']);
  await expect
    .poll(() => orderedTexts(page2.page), { timeout: 5000 })
    .toEqual(['Third', 'First', 'Second']);

  await page1.ctx.close();
  await page2.ctx.close();
});

test('a second client converges when a row moves to another list over SSE', async ({ browser }) => {
  const alice = await createProjectViaApi('Cross-list Sync', 'Alice');
  const { project, token } = alice;
  await createItemViaApi(project.slug, token, 'Move me');

  // A checklist panel is a second list; seed a row as the cross-card drop target.
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const { panel } = await apiRequest<{ panel: { id: string; listId: string } }>(
    `/projects/${project.slug}/panels`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ type: 'checklist', title: 'Errands' }),
    },
  );
  await apiRequest(`/projects/${project.slug}/items`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ text: 'Target', listId: panel.listId }),
  });

  const bob = await joinProjectViaApi(project.slug, 'Bob');

  // Two items total ('Move me' in the hero list, 'Target' in the checklist).
  const page1 = await openProjectAs(browser, project.slug, token, alice.member.id, 2);
  const page2 = await openProjectAs(browser, project.slug, bob.token, bob.member.id, 2);

  // Let both SSE streams connect before the move.
  await page2.page.waitForTimeout(1000);

  await dragRowAbove(page1.page, 'Move me', 'Target');

  // Membership, not order: the cross-list landing slot isn't guaranteed.
  const checklistTexts = (page: Page) =>
    page
      .getByTestId('checklist-card')
      .getByTestId('item-text')
      .allInnerTexts()
      .then((t) => t.sort());
  const heroTexts = (page: Page) =>
    page.getByTestId('list-card').getByTestId('item-text').allInnerTexts();

  // The actor sees the row leave the hero list and land in the checklist…
  await expect
    .poll(() => checklistTexts(page1.page), { timeout: 5000 })
    .toEqual(['Move me', 'Target']);
  await expect.poll(() => heroTexts(page1.page), { timeout: 5000 }).toEqual([]);
  // …and the second client converges to the same split over SSE.
  await expect
    .poll(() => checklistTexts(page2.page), { timeout: 5000 })
    .toEqual(['Move me', 'Target']);
  await expect.poll(() => heroTexts(page2.page), { timeout: 5000 }).toEqual([]);

  await page1.ctx.close();
  await page2.ctx.close();
});
