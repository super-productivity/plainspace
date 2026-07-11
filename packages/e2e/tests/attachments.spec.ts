import { test, expect } from '@playwright/test';
import { setupProject } from '../helpers/fixtures';
import { createItemViaApi, uploadAttachmentViaApi } from '../helpers/api';

test('upload and display an attachment on an item', async ({ page }) => {
  const { project, token } = await setupProject(page);
  const itemResult = await createItemViaApi(project.slug, token, 'Test item');

  await uploadAttachmentViaApi(project.slug, token, itemResult.item.id, 'notes.txt', 'Hello world');

  await page.goto(`/${project.slug}`);

  await expect(page.getByTestId('attachment-item')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('attachment-item')).toContainText('notes.txt');
});

test('upload attachment via UI button', async ({ page }) => {
  const { project } = await setupProject(page);

  await page.goto(`/${project.slug}`);

  await page.getByTestId('add-item-input').fill('Attach to me');
  await page.getByTestId('add-item-input').press('Enter');
  await expect(page.getByTestId('item-text')).toHaveText('Attach to me');

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Test file content'),
  });

  await expect(page.getByTestId('attachment-item')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('attachment-item')).toContainText('test.txt');
});
