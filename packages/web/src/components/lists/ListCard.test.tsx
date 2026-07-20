import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { Item, List } from '@plainspace/shared';
import { createSignal } from 'solid-js';

const {
  api,
  state,
  addActivity,
  moveItem,
  setItemPosition,
  updateItem,
  addToast,
  sortableCreate,
} = vi.hoisted(() => ({
  api: {
    updateItem: vi.fn(),
    createItem: vi.fn(),
  },
  state: { items: [] as Item[] },
  addActivity: vi.fn(),
  moveItem: vi.fn(),
  setItemPosition: vi.fn(),
  updateItem: vi.fn(),
  addToast: vi.fn(),
  sortableCreate: vi.fn(() => ({ destroy: vi.fn() })),
}));

vi.mock('sortablejs', () => ({ default: { create: sortableCreate } }));
vi.mock('../../lib/api', () => ({ api }));
vi.mock('../../lib/store', () => ({
  state,
  addActivity,
  moveItem,
  setItemPosition,
  updateItem,
}));
vi.mock('../../lib/toast', () => ({ addToast }));
vi.mock('../../lib/push', () => ({ ensurePushSubscription: vi.fn() }));

import ListCard from './ListCard';

const list: List = {
  id: 'list-1',
  projectId: 'p1',
  columns: null,
  createdBy: 'm1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function item(id: string, text: string, position: number): Item {
  return {
    id,
    listId: list.id,
    projectId: list.projectId,
    text,
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'c1',
    position,
    createdBy: null,
    remindAt: null,
    repeat: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderCard(items: Item[]) {
  state.items = items;
  return render(() => (
    <ListCard
      list={list}
      items={items}
      members={[]}
      attachments={[]}
      slug="abc"
      myId="m1"
      onDeleteItem={vi.fn()}
    />
  ));
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ addEventListener: vi.fn(), cancel: vi.fn() })),
  });
  api.updateItem.mockReset().mockResolvedValue({});
  moveItem.mockReset();
  setItemPosition.mockReset();
  updateItem.mockReset();
  addActivity.mockReset();
  addToast.mockReset();
  sortableCreate.mockClear();
});

describe('ListCard accessibility', () => {
  it('exposes the visible list title as a level-two heading', () => {
    renderCard([item('i1', 'First task', 1000)]);

    expect(screen.getByRole('heading', { level: 2, name: 'What needs doing' })).toBeTruthy();
  });

  it('connects its collapse toggle to the card body', () => {
    renderCard([item('i1', 'First task', 1000)]);

    const toggle = screen.getByTestId('panel-collapse');
    const controls = toggle.getAttribute('aria-controls');

    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeTruthy();
  });

  it('moves a task down from the keyboard-reachable actions menu via the reorder flow', async () => {
    let confirmUpdate!: (value: unknown) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((resolve) => {
        confirmUpdate = resolve;
      }),
    );
    renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
      item('i3', 'Third task', 3000),
    ]);

    const actions = screen.getByLabelText('Actions for First task');
    expect(actions.className).toContain('reorderAvailable');
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    expect(moveItem).toHaveBeenCalledWith('i1', 'list-1', 2500);
    expect(api.updateItem).toHaveBeenCalledWith('abc', 'i1', { position: 2500 });
    expect(screen.getByRole('status').textContent).toBe('');

    confirmUpdate({});
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Moved "First task" down.'),
    );
  });

  it('announces that the new order could not be saved when keyboard reorder fails', async () => {
    api.updateItem.mockRejectedValueOnce(new Error('network'));
    renderCard([item('i1', 'First task', 1000), item('i2', 'Second task', 2000)]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toBe(
      'Could not fully save the new order after moving "First task" down.',
    );
  });

  it('allows only one keyboard reorder to be pending at a time', async () => {
    let rejectUpdate!: (error: Error) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
      item('i3', 'Third task', 3000),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Actions for Second task'));
    expect(screen.queryByRole('menuitem', { name: 'Move up' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Move down' })).toBeNull();

    rejectUpdate(new Error('network'));
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeTruthy());

    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(2));
  });

  it('refreshes the live region when the same announcement occurs consecutively', async () => {
    renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
      item('i3', 'Third task', 3000),
    ]);
    const status = screen.getByRole('status');
    const actions = screen.getByLabelText('Actions for First task');

    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(status.textContent).toBe('Moved "First task" down.'));
    const firstAnnouncement = status.firstChild;

    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    await waitFor(() => expect(status.firstChild).not.toBe(firstAnnouncement));
    expect(status.textContent).toBe('Moved "First task" down.');
  });

  it('keeps focus on the next task when an SSE update remounts the completed row', async () => {
    const second = item('i2', 'Second task', 1000);
    const first = item('i1', 'First task', 2000);
    const completedSecond = { ...second, checked: true };
    const [items, setItems] = createSignal([second, first]);
    let resolveUpdate!: (value: { item: Item }) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    updateItem.mockImplementation((updated: Item) => {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === updated.id && JSON.stringify(candidate) !== JSON.stringify(updated)
            ? updated
            : candidate,
        ),
      );
    });
    state.items = [second, first];
    render(() => (
      <ListCard
        list={list}
        items={items()}
        members={[]}
        attachments={[]}
        slug="abc"
        myId="m1"
        onDeleteItem={vi.fn()}
      />
    ));
    const secondCheckbox = screen.getByRole('checkbox', {
      name: 'Mark "Second task" complete',
    });
    secondCheckbox.focus();

    fireEvent.click(secondCheckbox);
    // The SSE echo can replace the focused item before its PATCH response
    // resolves, remounting that row while the outro still pins it in Open.
    setItems([completedSecond, first]);
    resolveUpdate({ item: completedSecond });

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Completed "Second task".'),
    );
    await waitFor(() => expect(screen.getAllByTestId('item-checkbox')).toHaveLength(1));
    expect(document.activeElement).toBe(
      screen.getByRole('checkbox', { name: 'Mark "First task" complete' }),
    );
  });

  it('cancels the leaving phase and keeps focus when a task update fails', async () => {
    api.updateItem.mockRejectedValueOnce(new Error('network'));
    renderCard([item('i1', 'First task', 1000), item('i2', 'Second task', 2000)]);
    const first = screen.getByRole('checkbox', { name: 'Mark "First task" complete' });
    first.focus();

    fireEvent.click(first);

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 170));
    expect(first.closest('[data-item-id]')?.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it('restores a visibly focused source row when the toggle fails after its leave animation', async () => {
    let rejectUpdate!: (error: Error) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    renderCard([item('i1', 'First task', 1000), item('i2', 'Second task', 2000)]);
    const first = screen.getByRole('checkbox', { name: 'Mark "First task" complete' });
    const sourceRow = first.closest<HTMLElement>('[data-item-id]')!;
    const leaveAnimation = { addEventListener: vi.fn(), cancel: vi.fn() };
    Object.defineProperty(sourceRow, 'animate', {
      configurable: true,
      value: vi.fn(() => leaveAnimation as unknown as Animation),
    });
    first.focus();

    fireEvent.click(first);
    await new Promise((resolve) => setTimeout(resolve, 310));
    rejectUpdate(new Error('network'));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(leaveAnimation.cancel).toHaveBeenCalled();
    expect(sourceRow.style.overflow).toBe('');
    expect(sourceRow.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(first);
  });
});
