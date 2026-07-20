import type { Locator, Page } from '@playwright/test';

type ItemAction = 'assign' | 'delete' | 'reminder';

const inlineButtonIds: Record<ItemAction, string> = {
  assign: 'assign-button',
  delete: 'delete-item-button',
  reminder: 'reminder-button',
};

export async function clickItemAction(
  page: Page,
  action: ItemAction,
  item: Locator = page.getByTestId('list-item').first(),
): Promise<void> {
  const inlineButton = item.getByTestId(inlineButtonIds[action]);
  if (await inlineButton.isVisible()) {
    await inlineButton.click();
    return;
  }

  await item.getByTestId('more-actions-button').click();
  await page.getByTestId(`menu-${action}`).click();
}
