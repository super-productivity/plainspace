import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { Item, List } from '@plainspace/shared';
import { createSignal } from 'solid-js';

const {
  api,
  state,
  addActivity,
  moveItem,
  removeItem,
  restoreItem,
  updateItem,
  addToast,
  sortableCreate,
  ApiError,
} = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(
      public status: number,
      public body: { error: string },
    ) {
      super(body.error);
    }
  }
  return {
    api: {
      updateItem: vi.fn(),
      reorderItems: vi.fn(),
      createItem: vi.fn(),
      deleteItem: vi.fn(),
      restoreItem: vi.fn(),
    },
    state: { items: [] as Item[] },
    addActivity: vi.fn(),
    moveItem: vi.fn(),
    removeItem: vi.fn(),
    restoreItem: vi.fn(),
    updateItem: vi.fn(),
    addToast: vi.fn(),
    sortableCreate: vi.fn(() => ({ destroy: vi.fn() })),
    ApiError: TestApiError,
  };
});

vi.mock('sortablejs', () => ({ default: { create: sortableCreate } }));
vi.mock('../../lib/api', () => ({ api, ApiError }));
vi.mock('../../lib/store', () => ({
  state,
  addActivity,
  moveItem,
  removeItem,
  restoreItem,
  updateItem,
}));
vi.mock('../../lib/toast', () => ({ addToast }));
vi.mock('../../lib/push', () => ({ ensurePushSubscription: vi.fn() }));

import ListCard from './ListCard';
import ChecklistCard from '../panels/ChecklistCard';

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

const rejectedReorder = () => new ApiError(422, { error: 'Rejected' });

// The store mocks reposition for real, and the card re-renders from a signal.
// A reorder test whose row never moves proves almost nothing — that is how a
// focus bug survived this entire suite. Items are mutated in place so their
// identity is preserved exactly as produce() does in store.ts, which makes
// <For> re-insert the existing row rather than remount a new one.
function renderCard(initialItems: Item[], options: { slug?: string; list?: List } = {}) {
  let items = initialItems;
  const cardList = options.list ?? list;
  const [rows, setRows] = createSignal(items);
  const publish = (next: Item[]) => {
    items = next;
    state.items = next;
    setRows(next);
  };
  const reposition = (itemId: string, listId: string, position: number) => {
    const target = items.find((i) => i.id === itemId);
    if (target) Object.assign(target, { listId, position });
    publish([...items].sort((a, b) => a.position - b.position));
  };
  moveItem.mockImplementation(reposition);
  state.items = items;
  const rendered = render(() => (
    <ListCard
      list={cardList}
      items={rows()}
      members={[]}
      attachments={[]}
      slug={options.slug ?? 'abc'}
      myId="m1"
      onDeleteItem={vi.fn()}
    />
  ));
  // Exercise the defensive remount path (for example, when an item crosses a
  // checked/open boundary while another update is in flight).
  const remoteEdit = (id: string, patch: Partial<Item>) =>
    publish(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return Object.assign(rendered, { remoteEdit, getItems: () => items });
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ addEventListener: vi.fn(), cancel: vi.fn() })),
  });
  api.updateItem.mockReset().mockResolvedValue({});
  api.reorderItems.mockReset().mockResolvedValue(undefined);
  api.deleteItem.mockReset().mockResolvedValue(undefined);
  api.restoreItem.mockReset();
  moveItem.mockReset();
  removeItem.mockReset();
  restoreItem.mockReset();
  updateItem.mockReset();
  addActivity.mockReset();
  addToast.mockReset();
  sortableCreate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
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
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    expect(moveItem).toHaveBeenCalledWith('i1', 'list-1', 2500);
    expect(api.updateItem).toHaveBeenCalledWith(
      'abc',
      'i1',
      { position: 2500 },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('status').textContent).toBe('');

    confirmUpdate({});
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Moved "First task" down.'),
    );
  });

  // <For> re-inserts the moved row, and re-inserting a node blurs its focused
  // descendant — so the trigger has to be handed focus back explicitly.
  it('keeps focus on the trigger after the row actually moves', async () => {
    renderCard([item('i1', 'First task', 1000), item('i2', 'Second task', 2000)]);

    const trigger = screen.getByLabelText('Actions for First task');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    await waitFor(() =>
      expect(screen.getAllByTestId('item-text').map((n) => n.textContent)).toEqual([
        'Second task',
        'First task',
      ]),
    );
    expect(document.activeElement).toBe(trigger);
    // Let the commit settle before the test ends: the per-Space session is
    // module scope, so an in-flight move would refuse the next test's reorder.
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Moved "First task" down.'),
    );
  });

  // Exercise a worst-case row remount mid-save: focus has to be re-found by id.
  it('keeps focus on the row when a remote edit remounts it mid-reorder', async () => {
    let confirmUpdate!: (value: unknown) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((resolve) => {
        confirmUpdate = resolve;
      }),
    );
    const { remoteEdit } = renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    remoteEdit('i1', { assignedTo: 'm2' });
    expect(document.activeElement).toBe(document.body);

    confirmUpdate({});
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Actions for First task')),
    );
  });

  // Toast is itself role="status", so a failure that also wrote to the live
  // region would be read out twice. The rollback is a second store write, so it
  // re-parents the row a second time — focus has to survive that too.
  it('reports a failed keyboard reorder once and keeps focus through the rollback', async () => {
    api.updateItem.mockRejectedValueOnce(rejectedReorder());
    renderCard([item('i1', 'First task', 1000), item('i2', 'Second task', 2000)]);

    const trigger = screen.getByLabelText('Actions for First task');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getAllByTestId('item-text').map((n) => n.textContent)).toEqual([
      'First task',
      'Second task',
    ]);
    // The toast fires inside commitMove's catch, a microtask before the commit
    // settles and focus is restored, so this has to wait for it.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('refuses a second keyboard reorder while one is still saving', async () => {
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

    // The row moved optimistically, so the order is now Second, First, Third.
    // Every row still offers the move actions its POSITION allows while the save
    // is in flight — finding a live Move up below is what proves it.
    const third = screen.getByLabelText('Actions for Third task');
    fireEvent.click(third);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));

    // …but committing it is refused, with feedback rather than a silent no-op.
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledTimes(1);

    rejectUpdate(rejectedReorder());
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    fireEvent.click(screen.getByLabelText('Actions for Second task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(2));
  });

  it('renumbers a gap-exhausted list atomically and rolls the whole batch back once', async () => {
    api.reorderItems.mockRejectedValueOnce(rejectedReorder());
    const { getItems } = renderCard([
      item('i1', 'First task', 1),
      item('i2', 'Second task', 2),
      item('i3', 'Third task', 3),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(api.reorderItems).toHaveBeenCalledWith(
      'abc',
      {
        updates: [
          { id: 'i2', listId: 'list-1', position: 1000 },
          { id: 'i1', listId: 'list-1', position: 2000 },
          { id: 'i3', listId: 'list-1', position: 3000 },
        ],
      },
      expect.any(AbortSignal),
    );
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(
      getItems()
        .map(({ id, position }) => ({ id, position }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([
      { id: 'i1', position: 1 },
      { id: 'i2', position: 2 },
      { id: 'i3', position: 3 },
    ]);
  });

  it('does not roll back a newer remote position when a reorder request fails', async () => {
    let rejectUpdate!: (error: Error) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const { remoteEdit, getItems } = renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    rejectUpdate(new Error('network'));
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    // Authoritative SSE still applies after the uncertain write is blocked.
    remoteEdit('i1', { position: 9000 });

    expect(getItems().find((candidate) => candidate.id === 'i1')?.position).toBe(9000);
  });

  it('keeps a committed move when its matching SSE echo precedes a lost response', async () => {
    let rejectUpdate!: (error: Error) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const { remoteEdit, getItems } = renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    remoteEdit('i1', { position: 3000 });
    rejectUpdate(new Error('response lost'));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(getItems().map(({ id }) => id)).toEqual(['i2', 'i1']);
    expect(getItems().find((candidate) => candidate.id === 'i1')?.position).toBe(3000);
  });

  it('blocks further moves after an ambiguous failure', async () => {
    api.updateItem.mockRejectedValueOnce(new Error('network'));
    renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
      item('i3', 'Third task', 3000),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Actions for Third task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenLastCalledWith('Reload before moving another item.');
  });

  it('does not announce a move superseded by a remote completion and restores adjacent focus', async () => {
    let confirmUpdate!: (value: unknown) => void;
    api.updateItem.mockReturnValueOnce(
      new Promise((resolve) => {
        confirmUpdate = resolve;
      }),
    );
    const { remoteEdit } = renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    remoteEdit('i1', { checked: true });
    confirmUpdate({});

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Actions for Second task')),
    );
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('aborts an unmounted Space reorder without blocking a different Space', async () => {
    let firstSignal: AbortSignal | undefined;
    let rejectFirst!: (error: Error) => void;
    api.updateItem.mockImplementationOnce(
      (_slug: string, _id: string, _data: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          firstSignal = signal;
          rejectFirst = reject;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const first = renderCard([item('a1', 'Alpha task', 1000), item('a2', 'Alpha second', 2000)], {
      slug: 'space-a',
    });

    fireEvent.click(screen.getByLabelText('Actions for Alpha task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    first.unmount();

    const second = renderCard([item('b1', 'Beta task', 1000), item('b2', 'Beta second', 2000)], {
      slug: 'space-b',
    });
    fireEvent.click(screen.getByLabelText('Actions for Beta task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    try {
      expect(firstSignal?.aborted).toBe(true);
      await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(2));
    } finally {
      if (!firstSignal?.aborted) rejectFirst(new Error('cleanup'));
      second.unmount();
      await Promise.resolve();
    }
  });

  it('times out a stalled reorder, preserves its state, and blocks another move', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let rejectUpdate!: (error: Error) => void;
    api.updateItem.mockImplementationOnce(
      (_slug: string, _id: string, _data: unknown, requestSignal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = requestSignal;
          rejectUpdate = reject;
          requestSignal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const { getItems } = renderCard([
      item('i1', 'First task', 1000),
      item('i2', 'Second task', 2000),
    ]);

    fireEvent.click(screen.getByLabelText('Actions for First task'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(signal?.aborted).toBe(true);
      expect(addToast).toHaveBeenCalledTimes(1);
      expect(getItems().map(({ id }) => id)).toEqual(['i2', 'i1']);

      fireEvent.click(screen.getByLabelText('Actions for Second task'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(api.updateItem).toHaveBeenCalledTimes(1);
      expect(addToast).toHaveBeenLastCalledWith('Reload before moving another item.');
    } finally {
      if (!signal?.aborted) rejectUpdate(new Error('cleanup'));
      await Promise.resolve();
    }
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
      name: 'Second task',
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
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'First task' }));
  });

  it('cancels the leaving phase and keeps focus when a task update fails', async () => {
    api.updateItem.mockRejectedValueOnce(new Error('network'));
    renderCard([item('i1', 'First task', 1000), item('i2', 'Second task', 2000)]);
    const first = screen.getByRole('checkbox', { name: 'First task' });
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
    const first = screen.getByRole('checkbox', { name: 'First task' });
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

describe('ChecklistCard item deletion', () => {
  function renderChecklist() {
    const items = [item('i1', 'First task', 1000), item('i2', 'Second task', 2000)];
    state.items = items;
    render(() => (
      <ChecklistCard
        panel={{
          id: 'panel-1',
          projectId: 'p1',
          type: 'checklist',
          createdBy: 'm1',
          createdAt: '2026-01-01T00:00:00.000Z',
          listId: list.id,
          title: 'Packing',
        }}
        items={items}
        members={[]}
        slug="abc"
        myId="m1"
      />
    ));
  }

  it('moves focus after the checklist owner confirms deletion', async () => {
    renderChecklist();
    const source = screen.getAllByTestId('delete-item-button')[0]!;
    source.focus();

    fireEvent.click(source);

    await waitFor(() => expect(removeItem).toHaveBeenCalledWith('i1'));
    expect(document.activeElement).toBe(screen.getAllByTestId('item-checkbox')[1]);
  });

  it('keeps focus on the checklist row when its owner reports failure', async () => {
    api.deleteItem.mockRejectedValueOnce(new Error('network'));
    renderChecklist();
    const source = screen.getAllByTestId('delete-item-button')[0]!;
    source.focus();

    fireEvent.click(source);

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(removeItem).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(source);
  });
});
