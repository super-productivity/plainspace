import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { Item, Member } from '@plainspace/shared';

const { api, addActivity, updateItem, addToast, ensurePushSubscription } = vi.hoisted(() => ({
  api: { updateItem: vi.fn() },
  addActivity: vi.fn(),
  updateItem: vi.fn(),
  addToast: vi.fn(),
  ensurePushSubscription: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api }));
vi.mock('../../lib/store', () => ({ addActivity, updateItem }));
vi.mock('../../lib/toast', () => ({ addToast }));
vi.mock('../../lib/push', () => ({ ensurePushSubscription }));

import ListItem from './ListItem';

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    listId: 'list-1',
    projectId: 'p1',
    text: 'Buy milk',
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'c1',
    position: 0,
    createdBy: null,
    remindAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    repeat: null,
    ...over,
  };
}

const members: Member[] = [];

function renderItem(
  over: Partial<Item> = {},
  handlers: Partial<Parameters<typeof ListItem>[0]> = {},
) {
  const onDelete = vi.fn();
  const onBeforeToggle = vi.fn();
  render(() => (
    <ListItem
      item={item(over)}
      members={members}
      attachments={[]}
      slug="abc"
      myId="m1"
      onDelete={onDelete}
      onBeforeToggle={onBeforeToggle}
      {...handlers}
    />
  ));
  return { onDelete, onBeforeToggle };
}

beforeEach(() => {
  api.updateItem.mockReset().mockResolvedValue({ item: item(), activity: { id: 'a1' } });
  addActivity.mockReset();
  addToast.mockReset();
  ensurePushSubscription.mockReset().mockResolvedValue(undefined);
});

describe('ListItem checkbox', () => {
  it('reflects the checked state via aria-checked', () => {
    renderItem({ checked: true });
    expect(screen.getByTestId('item-checkbox').getAttribute('aria-checked')).toBe('true');
  });

  it('toggles checked, notifies the parent before the request, and records the activity', async () => {
    const { onBeforeToggle } = renderItem({ checked: false });
    fireEvent.click(screen.getByTestId('item-checkbox'));

    // Parent is told the *pre-toggle* state so it can own the animation window.
    expect(onBeforeToggle).toHaveBeenCalledWith('i1', false, false);
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith('abc', 'i1', { checked: true }),
    );
    await waitFor(() => expect(addActivity).toHaveBeenCalledWith({ id: 'a1' }));
  });

  it('flags a recurring item as such when toggling', () => {
    const { onBeforeToggle } = renderItem({
      repeat: { freq: 'daily', interval: 1, tz: 'UTC', anchor: '2026-01-01T00:00:00.000Z' },
    });
    fireEvent.click(screen.getByTestId('item-checkbox'));
    expect(onBeforeToggle).toHaveBeenCalledWith('i1', false, true);
  });

  it('toasts when the toggle request fails', async () => {
    api.updateItem.mockRejectedValueOnce(new Error('network'));
    renderItem();
    fireEvent.click(screen.getByTestId('item-checkbox'));
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addActivity).not.toHaveBeenCalled();
  });
});

describe('ListItem inline edit', () => {
  it('exposes the full title in the native hover tooltip', () => {
    const title =
      'A task title long enough to wrap across several lines while keeping the complete text available';
    renderItem({ text: title });

    expect(screen.getByTestId('item-text').getAttribute('title')).toBe(title);
  });

  it('saves a changed title on Enter', async () => {
    renderItem({ text: 'Buy milk' });
    fireEvent.click(screen.getByTestId('item-text'));
    const input = screen.getByTestId('item-edit-input') as HTMLInputElement;
    expect(input.value).toBe('Buy milk');

    fireEvent.input(input, { target: { value: 'Buy oat milk' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith('abc', 'i1', { text: 'Buy oat milk' }),
    );
  });

  it('does not call the API when the title is unchanged', async () => {
    renderItem({ text: 'Buy milk' });
    fireEvent.click(screen.getByTestId('item-text'));
    const input = screen.getByTestId('item-edit-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('item-text')).toBeTruthy());
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it('discards the edit on Escape without saving', async () => {
    renderItem({ text: 'Buy milk' });
    fireEvent.click(screen.getByTestId('item-text'));
    const input = screen.getByTestId('item-edit-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.getByTestId('item-text')).toBeTruthy());
    expect(api.updateItem).not.toHaveBeenCalled();
  });
});

describe('ListItem reminder', () => {
  it('saves a reminder via a preset and subscribes to push in parallel', async () => {
    renderItem();
    // Open the picker, then pick the always-present "In 1 hour" preset, which
    // commits a non-null reminder in one click.
    fireEvent.click(screen.getByTestId('reminder-button'));
    fireEvent.click(screen.getByTestId('reminder-preset-1h'));

    // A reminder with a fire time subscribes to push (best-effort) alongside
    // the PATCH; the activity is recorded once the PATCH resolves.
    await waitFor(() => expect(ensurePushSubscription).toHaveBeenCalledWith('abc'));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith(
        'abc',
        'i1',
        expect.objectContaining({ remindAt: expect.any(String), repeat: null }),
      ),
    );
    await waitFor(() => expect(addActivity).toHaveBeenCalledWith({ id: 'a1' }));
  });
});

describe('ListItem mobile actions disclosure', () => {
  it('toggles the ⋯ trigger open and closed (CSS reveals the actions on touch)', () => {
    renderItem();
    const more = screen.getByTestId('more-actions-button');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ListItem delete', () => {
  it('asks the parent to delete on click (parent owns the undo flow)', () => {
    const { onDelete } = renderItem();
    fireEvent.click(screen.getByTestId('delete-item-button'));
    expect(onDelete).toHaveBeenCalledWith('i1');
  });
});
