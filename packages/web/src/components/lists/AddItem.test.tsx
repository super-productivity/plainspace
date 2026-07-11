import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { Item } from '@plainspace/shared';

const { api, addItem } = vi.hoisted(() => ({
  api: { createItem: vi.fn() },
  addItem: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api }));
vi.mock('../../lib/store', () => ({ addItem }));

import AddItem from './AddItem';

function item(text: string): Item {
  return {
    id: 'i1',
    listId: 'list-1',
    projectId: 'p1',
    text,
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'c1',
    position: 0,
    createdBy: null,
    remindAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    repeat: null,
  };
}

beforeEach(() => {
  api.createItem.mockReset();
  addItem.mockReset();
});

describe('AddItem', () => {
  it('keeps the submit button disabled until there is non-whitespace text', () => {
    render(() => <AddItem slug="abc" listId="list-1" />);
    const button = screen.getByTestId('add-item-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.input(screen.getByTestId('add-item-input'), { target: { value: '   ' } });
    expect(button.disabled).toBe(true); // whitespace only

    fireEvent.input(screen.getByTestId('add-item-input'), { target: { value: 'Buy milk' } });
    expect(button.disabled).toBe(false);
  });

  it('creates the item from trimmed text, seeds the store, and clears the field', async () => {
    api.createItem.mockResolvedValue({ item: item('Buy milk'), activity: {} });
    render(() => <AddItem slug="abc" listId="list-1" />);
    const input = screen.getByTestId('add-item-input') as HTMLInputElement;

    fireEvent.input(input, { target: { value: '  Buy milk  ' } });
    fireEvent.click(screen.getByTestId('add-item-button'));

    await waitFor(() =>
      expect(api.createItem).toHaveBeenCalledWith('abc', { text: 'Buy milk', listId: 'list-1' }),
    );
    // Seeds from the POST response so the creator sees its own row before the
    // SSE echo arrives.
    await waitFor(() => expect(addItem).toHaveBeenCalledWith(item('Buy milk')));
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('surfaces an error and preserves the text when creation fails', async () => {
    api.createItem.mockRejectedValue(new Error('network'));
    render(() => <AddItem slug="abc" listId="list-1" />);
    const input = screen.getByTestId('add-item-input') as HTMLInputElement;

    fireEvent.input(input, { target: { value: 'Buy milk' } });
    fireEvent.click(screen.getByTestId('add-item-button'));

    await waitFor(() => expect(screen.getByText(/Couldn't add task/)).toBeTruthy());
    expect(input.value).toBe('Buy milk'); // not cleared, so the user can retry
    expect(addItem).not.toHaveBeenCalled();
  });

  it('clears the field on Escape', () => {
    render(() => <AddItem slug="abc" listId="list-1" />);
    const input = screen.getByTestId('add-item-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Buy milk' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });
});
