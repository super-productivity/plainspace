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
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ addEventListener: vi.fn(), cancel: vi.fn() })),
  });
  api.updateItem.mockReset().mockResolvedValue({ item: item(), activity: { id: 'a1' } });
  addActivity.mockReset();
  addToast.mockReset();
  ensurePushSubscription.mockReset().mockResolvedValue(undefined);
});

describe('ListItem animation', () => {
  it('keeps the row clipped while its enter animation is running', () => {
    renderItem({}, { animateIn: true });

    expect(screen.getByTestId('list-item').style.overflow).toBe('hidden');
  });
});

describe('ListItem checkbox', () => {
  it('names the checkbox after the task', () => {
    renderItem({ text: 'Buy milk', checked: false });
    expect(screen.getByRole('checkbox', { name: 'Buy milk' })).toBeTruthy();
  });

  // The name must not flip with the state — aria-checked already carries it.
  it('keeps the checkbox name stable once the task is complete', () => {
    renderItem({ text: 'Buy milk', checked: true });
    expect(screen.getByRole('checkbox', { name: 'Buy milk' })).toBeTruthy();
  });

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
    const checkbox = screen.getByTestId('item-checkbox');
    checkbox.focus();
    fireEvent.click(checkbox);
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addActivity).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(checkbox);
  });

  it('moves focus to the next task and announces a completed focused task', async () => {
    const onAnnounce = vi.fn();
    render(() => (
      <div>
        <ListItem
          item={item({ id: 'i1', text: 'Buy milk' })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
          onAnnounce={onAnnounce}
        />
        <ListItem
          item={item({ id: 'i2', text: 'Buy oats', position: 1 })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
      </div>
    ));
    const checkboxes = screen.getAllByTestId('item-checkbox');
    checkboxes[0]!.focus();

    fireEvent.click(checkboxes[0]!);

    await waitFor(() => expect(document.activeElement).toBe(checkboxes[1]));
    expect(onAnnounce).toHaveBeenCalledWith('Completed "Buy milk".');
  });

  it('does not steal focus when the user moves on before completion finishes', async () => {
    let resolveUpdate!: (value: unknown) => void;
    api.updateItem.mockImplementationOnce(
      () => new Promise((resolve) => (resolveUpdate = resolve)),
    );
    render(() => (
      <div>
        <ListItem
          item={item({ id: 'i1', text: 'Buy milk' })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
        <ListItem
          item={item({ id: 'i2', text: 'Buy oats', position: 1 })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
        <button type="button">Elsewhere</button>
      </div>
    ));
    const first = screen.getAllByTestId('item-checkbox')[0]!;
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    first.focus();
    fireEvent.click(first);
    elsewhere.focus();

    resolveUpdate({ item: item({ checked: true }), activity: { id: 'a1' } });

    await waitFor(() => expect(addActivity).toHaveBeenCalledWith({ id: 'a1' }));
    expect(document.activeElement).toBe(elsewhere);
  });

  it('moves focus and announces when a focused completed task is reopened', async () => {
    const onAnnounce = vi.fn();
    render(() => (
      <div>
        <ListItem
          item={item({ id: 'i1', text: 'Buy milk', checked: true })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
          onAnnounce={onAnnounce}
        />
        <ListItem
          item={item({ id: 'i2', text: 'Buy oats', checked: true, position: 1 })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
      </div>
    ));
    const checkboxes = screen.getAllByTestId('item-checkbox');
    checkboxes[0]!.focus();

    fireEvent.click(checkboxes[0]!);

    await waitFor(() => expect(document.activeElement).toBe(checkboxes[1]));
    expect(onAnnounce).toHaveBeenCalledWith('Marked "Buy milk" incomplete.');
  });

  it('hides a leaving task from interaction and assistive technology', () => {
    renderItem({}, { leaving: true });

    const row = screen.getByTestId('list-item') as HTMLDivElement;
    expect(row.getAttribute('aria-hidden')).toBe('true');
    expect(row.inert).toBe(true);
  });

  it('skips an adjacent leaving task when moving focus after completion', async () => {
    render(() => (
      <div>
        <ListItem
          item={item({ id: 'i1', text: 'Buy milk' })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
        <ListItem
          item={item({ id: 'i2', text: 'Leaving task', position: 1 })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          leaving
          onDelete={vi.fn()}
        />
        <ListItem
          item={item({ id: 'i3', text: 'Buy oats', position: 2 })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
      </div>
    ));
    const checkboxes = screen.getAllByTestId('item-checkbox');
    checkboxes[0]!.focus();

    fireEvent.click(checkboxes[0]!);

    await waitFor(() => expect(document.activeElement).toBe(checkboxes[2]));
  });
});

describe('ListItem inline edit', () => {
  it('names the inline editor after the task being edited', () => {
    renderItem({ text: 'Buy milk' });
    fireEvent.click(screen.getByTestId('item-text'));

    expect(screen.getByRole('textbox', { name: 'Edit item: Buy milk' })).toBeTruthy();
  });

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
  it('gives each repeated task action a task-specific name', () => {
    renderItem({ text: 'Buy milk' });

    expect(screen.getByRole('button', { name: 'Set reminder for "Buy milk"' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign someone to "Buy milk"' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete "Buy milk"' })).toBeTruthy();
  });

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

describe('ListItem actions menu', () => {
  it('opens the labelled ⋯ menu and reflects it in aria-expanded', () => {
    renderItem();
    const more = screen.getByTestId('more-actions-button');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-label')).toBe('Actions for Buy milk');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('actions-menu')).toBeTruthy();
    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Actions for Buy milk');
  });

  it('focuses the first action and supports menu arrow keys', async () => {
    renderItem();
    fireEvent.click(screen.getByTestId('more-actions-button'));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('menu-reminder')));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('menu-assign'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('menu-delete'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('menu-reminder'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('menu-delete'));
  });

  it('shows a decorative icon beside every menu action', () => {
    renderItem();
    fireEvent.click(screen.getByTestId('more-actions-button'));

    for (const testId of ['menu-reminder', 'menu-assign', 'menu-delete']) {
      const icon = screen.getByTestId(testId).querySelector('svg');
      expect(icon).toBeTruthy();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('adds a backdrop that dismisses the actions menu', () => {
    renderItem();
    fireEvent.click(screen.getByTestId('more-actions-button'));

    const backdrop = document.querySelector('[role="presentation"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(screen.queryByTestId('actions-menu')).toBeNull();
  });

  it('deletes via the menu Delete item', () => {
    const { onDelete } = renderItem();
    fireEvent.click(screen.getByTestId('more-actions-button'));
    fireEvent.click(screen.getByTestId('menu-delete'));
    expect(onDelete).toHaveBeenCalledWith('i1');
  });

  it('opens the reminder picker from the menu', () => {
    renderItem();
    fireEvent.click(screen.getByTestId('more-actions-button'));
    fireEvent.click(screen.getByTestId('menu-reminder'));
    // The menu closes and the reminder picker takes over.
    expect(screen.queryByTestId('actions-menu')).toBeNull();
    expect(screen.getByTestId('reminder-picker')).toBeTruthy();
  });

  it('closes an open picker before reopening the actions menu', () => {
    renderItem();
    fireEvent.click(screen.getByTestId('more-actions-button'));
    fireEvent.click(screen.getByTestId('menu-reminder'));
    expect(screen.getByTestId('reminder-picker')).toBeTruthy();

    fireEvent.click(screen.getByTestId('more-actions-button'));
    expect(screen.queryByTestId('reminder-picker')).toBeNull();
    expect(screen.getByTestId('actions-menu')).toBeTruthy();
  });

  it('dismisses one row menu before another can open', () => {
    renderItem();
    renderItem({ id: 'i2', text: 'Buy oats' });
    const first = screen.getByLabelText('Actions for Buy milk');
    const second = screen.getByLabelText('Actions for Buy oats');

    fireEvent.click(first);
    expect(screen.getAllByTestId('actions-menu')).toHaveLength(1);
    fireEvent.click(document.querySelector('[role="presentation"]')!);
    expect(screen.queryByTestId('actions-menu')).toBeNull();
    fireEvent.click(second);
    expect(screen.getAllByTestId('actions-menu')).toHaveLength(1);
  });
});

describe('ListItem delete', () => {
  it('asks the parent to delete on click (parent owns the undo flow)', () => {
    const { onDelete } = renderItem();
    fireEvent.click(screen.getByTestId('delete-item-button'));
    expect(onDelete).toHaveBeenCalledWith('i1');
  });

  it('moves focus only after a focused row deletion is confirmed', async () => {
    let confirmDelete!: (deleted: boolean) => void;
    const onDelete = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          confirmDelete = resolve;
        }),
    );
    render(() => (
      <div>
        <ListItem
          item={item({ id: 'i1', text: 'Buy milk' })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={onDelete}
        />
        <ListItem
          item={item({ id: 'i2', text: 'Buy oats', position: 1 })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
      </div>
    ));
    const deleteButton = screen.getAllByTestId('delete-item-button')[0]!;
    const nextCheckbox = screen.getAllByTestId('item-checkbox')[1]!;
    deleteButton.focus();

    fireEvent.click(deleteButton);

    expect(document.activeElement).toBe(deleteButton);
    expect(onDelete).toHaveBeenCalledWith('i1');
    confirmDelete(true);
    await waitFor(() => expect(document.activeElement).toBe(nextCheckbox));
  });

  it('restores focus to the source control when deleting a focused row fails', async () => {
    const onDelete = vi.fn().mockResolvedValue(false);
    render(() => (
      <div>
        <ListItem
          item={item({ id: 'i1', text: 'Buy milk' })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={onDelete}
        />
        <ListItem
          item={item({ id: 'i2', text: 'Buy oats', position: 1 })}
          members={members}
          attachments={[]}
          slug="abc"
          myId="m1"
          onDelete={vi.fn()}
        />
      </div>
    ));
    const deleteButton = screen.getAllByTestId('delete-item-button')[0]!;
    deleteButton.focus();

    fireEvent.click(deleteButton);

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('i1'));
    expect(document.activeElement).toBe(deleteButton);
  });
});
