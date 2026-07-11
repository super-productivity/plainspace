import { test, expect, type Browser, type Page } from '@playwright/test';
import { seedIdentity, setupProject } from '../helpers/fixtures';
import { createProjectViaApi, joinProjectViaApi } from '../helpers/api';

// A checklist panel reuses ListCard, so it renders the same chrome and rows as
// the hero list (data-testid list-item / item-checkbox / add-item-input). The
// card itself is tagged `checklist-card`; its header `panel-menu` button opens
// an actions menu (rendered in a portal) with Rename / Collapse / Delete.
// Delete (`checklist-delete`) is gated by the shared ConfirmDialog.

async function openPage(browser: Browser, slug: string, token: string, memberId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await seedIdentity(page, slug, token, memberId);
  await page.goto(`/${slug}`);
  return { ctx, page };
}

async function createChecklistViaUi(page: Page, title: string) {
  await page.getByTestId('add-panel-button').click();
  await expect(page.getByTestId('add-panel-dialog')).toBeVisible();
  await page.getByTestId('add-panel-type-checklist').click();
  await page.getByTestId('add-panel-title').fill(title);
  await page.getByTestId('add-panel-checklist-submit').click();
  await expect(page.getByTestId('add-panel-dialog')).toBeHidden();
}

// AddItem is shared with the hero list, so scope the input to the checklist card.
async function addChecklistItem(page: Page, text: string) {
  const input = page.getByTestId('checklist-card').getByTestId('add-item-input');
  await input.fill(text);
  await input.press('Enter');
}

// The actions menu opens from the card's `panel-menu` button; its items render
// in a portal (outside the card), so click them at the page level.
async function openChecklistMenu(page: Page) {
  await page.getByTestId('checklist-card').getByTestId('panel-menu').click();
}

test('create a checklist, add an item, and delete it (confirm required)', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createChecklistViaUi(page, 'Packing list');

  const card = page.getByTestId('checklist-card');
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.getByTestId('list-name')).toHaveText('Packing list');

  await addChecklistItem(page, 'Passport');
  await expect(card.getByTestId('list-item')).toHaveCount(1, { timeout: 5000 });

  // Deleting requires confirmation. Cancel first — the card must survive.
  await openChecklistMenu(page);
  await page.getByTestId('checklist-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  await expect(card).toBeVisible();

  // Confirm — the card is removed (SSE panel.deleted; list + items cascade).
  await openChecklistMenu(page);
  await page.getByTestId('checklist-delete').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('checklist-card')).toHaveCount(0, { timeout: 5000 });
});

test('rename a checklist via the actions menu', async ({ page }) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createChecklistViaUi(page, 'Groceries');
  const card = page.getByTestId('checklist-card');
  await expect(card.getByTestId('list-name')).toHaveText('Groceries');

  await openChecklistMenu(page);
  await page.getByTestId('panel-rename').click();

  // The heading becomes an inline input; Enter commits and the SSE echo
  // (panel.updated) updates the heading.
  const input = card.getByTestId('panel-rename-input');
  await expect(input).toBeVisible();
  await input.fill('Shopping list');
  await input.press('Enter');

  await expect(card.getByTestId('list-name')).toHaveText('Shopping list', { timeout: 5000 });
});

test('collapse folds a checklist via the header chevron and persists across reload', async ({
  page,
}) => {
  const { project } = await setupProject(page);
  await page.goto(`/${project.slug}`);

  await createChecklistViaUi(page, 'Packing list');
  const card = page.getByTestId('checklist-card');
  await addChecklistItem(page, 'Passport');
  await expect(card.getByTestId('list-item')).toHaveCount(1, { timeout: 5000 });

  // Collapse is a one-tap header chevron (not a menu item). aria-expanded
  // reflects the state, and a count appears next to the title when folded.
  const toggle = card.getByTestId('panel-collapse');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('· 1');

  // The preference is per-device (localStorage), so it survives a reload.
  await page.reload();
  const reToggle = page.getByTestId('checklist-card').getByTestId('panel-collapse');
  await expect(reToggle).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 });

  // Expanding restores the body and drops the count.
  await reToggle.click();
  await expect(reToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(reToggle).not.toContainText('·');
});

test('two users see checklist creation, item add, and delete in real-time', async ({ browser }) => {
  const {
    project,
    member: alice,
    token: aliceToken,
  } = await createProjectViaApi('Checklist Sync', 'Alice');
  const bob = await joinProjectViaApi(project.slug, 'Bob');

  const a = await openPage(browser, project.slug, aliceToken, alice.id);
  const b = await openPage(browser, project.slug, bob.token, bob.member.id);

  await expect(a.page.getByTestId('add-panel-button')).toBeVisible();
  await expect(b.page.getByTestId('add-panel-button')).toBeVisible();

  // Alice creates a checklist and adds an item.
  await createChecklistViaUi(a.page, 'Groceries');
  await addChecklistItem(a.page, 'Milk');

  // Bob sees the checklist and the item via SSE.
  const bobCard = b.page.getByTestId('checklist-card');
  await expect(bobCard).toBeVisible({ timeout: 5000 });
  await expect(bobCard.getByTestId('list-name')).toHaveText('Groceries');
  await expect(bobCard.getByTestId('list-item')).toHaveCount(1, { timeout: 5000 });

  // Bob adds an item; Alice sees both.
  await addChecklistItem(b.page, 'Eggs');
  await expect(a.page.getByTestId('checklist-card').getByTestId('list-item')).toHaveCount(2, {
    timeout: 5000,
  });

  // Alice renames the checklist; Bob sees the new title via SSE (panel.updated).
  await openChecklistMenu(a.page);
  await a.page.getByTestId('panel-rename').click();
  const renameInput = a.page.getByTestId('checklist-card').getByTestId('panel-rename-input');
  await renameInput.fill('Shopping');
  await renameInput.press('Enter');
  await expect(bobCard.getByTestId('list-name')).toHaveText('Shopping', { timeout: 5000 });

  // Alice deletes the checklist (with confirm); Bob sees it disappear.
  await openChecklistMenu(a.page);
  await a.page.getByTestId('checklist-delete').click();
  await a.page.getByTestId('confirm-dialog-confirm').click();
  await expect(b.page.getByTestId('checklist-card')).toHaveCount(0, { timeout: 5000 });

  await a.ctx.close();
  await b.ctx.close();
});
